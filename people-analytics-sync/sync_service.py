"""
People Analytics Sync Service
Fetches data from Videoloft API and stores it in the database
"""
import os
import sys
import json
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
from zoneinfo import ZoneInfo
import requests
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert
from models import (
    PeopleAnalyticsRecord, SyncLog, 
    create_engine_and_session, init_database
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def _sync_timezone() -> ZoneInfo:
    tz_name = (os.getenv("TIMEZONE") or "Asia/Kuwait").strip() or "Asia/Kuwait"
    try:
        return ZoneInfo(tz_name)
    except Exception:
        logger.warning("Invalid TIMEZONE=%s; using Asia/Kuwait", tz_name)
        return ZoneInfo("Asia/Kuwait")


def _env_flag(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in ("0", "false", "no", "")


def _align_bucket_timestamps(
    first_naive: datetime,
    last_naive: datetime,
    interval: str,
    tz: ZoneInfo,
) -> Tuple[datetime, datetime]:
    """
    Canonical bucket boundaries in the configured timezone (default Asia/Kuwait).
    Prevents duplicate hour rows that share the same Kuwait hour but different UTC keys.
    """
    first_utc = first_naive.replace(tzinfo=ZoneInfo("UTC"))
    first_local = first_utc.astimezone(tz)

    if interval == "hour":
        start_local = first_local.replace(minute=0, second=0, microsecond=0)
        end_local = start_local + timedelta(hours=1) - timedelta(seconds=1)
    elif interval == "date":
        start_local = first_local.replace(hour=0, minute=0, second=0, microsecond=0)
        end_local = start_local.replace(hour=23, minute=59, second=59, microsecond=0)
    else:
        return first_naive, last_naive

    return (
        start_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None),
        end_local.astimezone(ZoneInfo("UTC")).replace(tzinfo=None),
    )


def _compute_sync_window(
    days_back: int,
    interval: str,
) -> Tuple[datetime, datetime, str]:
    """
    Return (start_dt, end_dt, mode_label) in the configured timezone (default Asia/Kuwait).

    Live sync (cron): SYNC_DAYS_BACK=0 and SYNC_LIVE_DAYS>=1 re-fetches full calendar days
    (today + yesterday by default) on each run so Videoloft bucket revisions upsert into Postgres.

    Legacy hourly: SYNC_DAYS_BACK=0 and no SYNC_LIVE_DAYS → previous hour only.
    Backfill: SYNC_DAYS_BACK>0 → last N days (hour rows aligned to midnight).
    """
    tz = _sync_timezone()
    now = datetime.now(tz)
    live_days = int(os.getenv("SYNC_LIVE_DAYS", "0") or "0")
    hours_back = int(os.getenv("SYNC_HOURS_BACK", "0") or "0")

    if days_back == 0:
        if live_days > 0:
            start_dt = (now - timedelta(days=live_days - 1)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            if interval == "hour":
                # Include the current in-progress hour bucket (Videoloft endTime is exclusive-ish).
                end_dt = (now + timedelta(hours=1)).replace(
                    minute=0, second=0, microsecond=0
                )
            else:
                end_dt = now.replace(hour=23, minute=59, second=59, microsecond=0)
            return start_dt, end_dt, f"live_days={live_days}"

    if interval == "hour":
        end_dt = now.replace(minute=0, second=0, microsecond=0)
    else:
        end_dt = now

    if days_back == 0:
        if hours_back > 0 and interval == "hour":
            start_dt = end_dt - timedelta(hours=hours_back)
            return start_dt, end_dt, f"hours_back={hours_back}"
        if interval == "hour":
            start_dt = end_dt - timedelta(hours=1)
            return start_dt, end_dt, "last_hour"
        start_dt = now - timedelta(hours=1)
        return start_dt, end_dt, "last_hour"

    start_dt = end_dt - timedelta(days=days_back)
    if interval == "hour":
        start_dt = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_dt, end_dt, f"days_back={days_back}"


class VideoloftClient:
    """Client for interacting with Videoloft API"""
    
    def __init__(self):
        # Support both email and username (Videoloft API accepts either)
        self.email = os.getenv('VIDEOLOFT_EMAIL') or os.getenv('VIDEOLOFT_USERNAME')
        self.password = os.getenv('VIDEOLOFT_PASSWORD')
        self.auth_token = None
        self.authenticator = None
        self.provider = None
        self.uid = None
        
        if not self.email or not self.password:
            raise ValueError("VIDEOLOFT_EMAIL (or VIDEOLOFT_USERNAME) and VIDEOLOFT_PASSWORD must be set")
    
    def authenticate(self) -> bool:
        """Authenticate with Videoloft and get auth token"""
        try:
            login_url = "https://auth1.manything.com/login"
            payload = {
                "email": self.email,
                "password": self.password
            }
            
            response = requests.post(
                login_url,
                json=payload,
                headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
                timeout=30
            )
            
            if response.status_code != 200:
                logger.error(f"Authentication failed with status {response.status_code}: {response.text}")
                return False
            
            data = response.json()
            
            # Check if we need to redirect to a specific region
            if data.get('location'):
                logger.info(f"Redirecting to region: {data['location']}")
                region_url = f"{data['location']}/login"
                region_response = requests.post(
                    region_url,
                    json=payload,
                    headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
                    timeout=30
                )
                
                if region_response.status_code != 200:
                    logger.error(f"Regional login failed: {region_response.text}")
                    return False
                
                region_data = region_response.json()
                result = region_data.get('result', {})
            else:
                result = data.get('result', {})
            
            self.auth_token = result.get('authToken')
            self.authenticator = result.get('authenticator')
            self.provider = result.get('provider')
            self.uid = result.get('uid')
            
            if not self.auth_token:
                logger.error("No auth token received from Videoloft")
                return False
            
            logger.info("Successfully authenticated with Videoloft")
            return True
            
        except Exception as e:
            logger.error(f"Error during authentication: {str(e)}")
            return False
    
    def get_cameras(self) -> List[Dict]:
        """Get list of available cameras"""
        if not self.auth_token:
            if not self.authenticate():
                return []
        
        try:
            devices_url = f"{self.authenticator}/devices"
            response = requests.get(
                devices_url,
                headers={
                    'Authorization': f'ManythingToken {self.auth_token}',
                    'Accept': 'application/json'
                },
                timeout=30
            )
            
            if response.status_code != 200:
                logger.error(f"Failed to get devices: {response.text}")
                return []
            
            data = response.json()
            cameras = []
            
            if data.get('result'):
                for uid in data['result']:
                    user_devices = data['result'][uid]
                    if user_devices.get('devices'):
                        for device_id in user_devices['devices']:
                            device = user_devices['devices'][device_id]
                            cameras.append({
                                'id': device.get('uidd'),
                                'name': device.get('phonename', f'Camera {device_id}'),
                                'alias': user_devices.get('alias', f'User {uid}')
                            })
            
            logger.info(f"Found {len(cameras)} cameras")
            return cameras
            
        except Exception as e:
            logger.error(f"Error getting cameras: {str(e)}")
            return []
    
    def fetch_people_analytics(
        self, 
        uidds: List[str], 
        start_time: int, 
        end_time: int, 
        interval: str = "date",
        timezone: str = "Asia/Kuwait"
    ) -> Optional[Dict]:
        """Fetch people analytics data from Videoloft API"""
        if not self.auth_token:
            if not self.authenticate():
                return None
        
        try:
            analytics_url = "https://euwest1-analytics.manything.com/people"
            
            # Convert interval to API format
            # Videoloft API accepts: "date" or a number (milliseconds)
            api_interval = interval
            if interval == "hour":
                # 1 hour = 3600000 milliseconds
                api_interval = 3600000
            elif interval == "60000" or interval == "minute":
                # 1 minute = 60000 milliseconds
                api_interval = 60000
            
            payload = {
                "uidds": uidds,
                "startTime": start_time,
                "endTime": end_time,
                "interval": api_interval,
                "timeZone": timezone
            }
            
            response = requests.post(
                analytics_url,
                json=payload,
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': f'ManythingToken {self.auth_token}'
                },
                timeout=60
            )
            
            if response.status_code != 200:
                logger.error(f"People analytics API failed: {response.status_code} - {response.text}")
                return None
            
            data = response.json()
            logger.info(f"Fetched {len(data) if isinstance(data, list) else 0} records from Videoloft")
            return data
            
        except Exception as e:
            logger.error(f"Error fetching people analytics: {str(e)}")
            return None


class PeopleAnalyticsSync:
    """Service to sync people analytics data from Videoloft to database"""
    
    def __init__(self):
        self.videoloft = VideoloftClient()
        self.engine, self.SessionLocal = create_engine_and_session()
        self.sync_log = None
    
    def start_sync(self):
        """Start a sync operation"""
        session = self.SessionLocal()
        try:
            self.sync_log = SyncLog(
                sync_started_at=datetime.utcnow(),
                status='in_progress',
                records_synced=0
            )
            session.add(self.sync_log)
            session.commit()
            session.refresh(self.sync_log)
            logger.info(f"Started sync operation: {self.sync_log.id}")
            return self.sync_log.id
        except Exception as e:
            logger.error(f"Error creating sync log: {str(e)}")
            session.rollback()
            return None
        finally:
            session.close()
    
    def complete_sync(self, status: str, records_synced: int, error_message: Optional[str] = None):
        """Complete a sync operation"""
        if not self.sync_log:
            return
        
        session = self.SessionLocal()
        try:
            sync_log = session.query(SyncLog).filter(SyncLog.id == self.sync_log.id).first()
            if sync_log:
                sync_log.sync_completed_at = datetime.utcnow()
                sync_log.status = status
                sync_log.records_synced = records_synced
                sync_log.error_message = error_message
                session.commit()
                logger.info(f"Completed sync {sync_log.id}: {status}, {records_synced} records")
        except Exception as e:
            logger.error(f"Error updating sync log: {str(e)}")
            session.rollback()
        finally:
            session.close()

    def _should_chunk_window(self, start_dt: datetime, end_dt: datetime, interval: str) -> bool:
        span_days = (end_dt - start_dt).total_seconds() / 86400
        chunk_min_days = float(os.getenv("SYNC_CHUNK_MIN_DAYS", "1" if interval == "hour" else "7"))
        return span_days >= chunk_min_days

    def _fetch_raw_for_range(
        self,
        uidds: List[str],
        range_start: datetime,
        range_end: datetime,
        interval: str,
        timezone: str,
    ) -> List[Dict]:
        start_ms = int(range_start.timestamp() * 1000)
        end_ms = int(range_end.timestamp() * 1000)
        per_device = _env_flag("SYNC_PER_DEVICE", "1") and len(uidds) > 1

        if per_device:
            merged: List[Dict] = []
            for uidd in uidds:
                part = self.videoloft.fetch_people_analytics(
                    uidds=[uidd],
                    start_time=start_ms,
                    end_time=end_ms,
                    interval=interval,
                    timezone=timezone,
                )
                if part and isinstance(part, list):
                    merged.extend(part)
            logger.info(
                "Per-device fetch (%s -> %s): %s records across %s devices",
                range_start.strftime("%Y-%m-%d %H:%M"),
                range_end.strftime("%Y-%m-%d %H:%M"),
                len(merged),
                len(uidds),
            )
            return merged

        data = self.videoloft.fetch_people_analytics(
            uidds=uidds,
            start_time=start_ms,
            end_time=end_ms,
            interval=interval,
            timezone=timezone,
        )
        return data if isinstance(data, list) else []

    def _sync_window_to_db(
        self,
        uidds: List[str],
        start_dt: datetime,
        end_dt: datetime,
        interval: str,
        timezone: str,
    ) -> int:
        """Fetch Videoloft data for a window and upsert into Postgres (chunked when large)."""
        chunk_days = int(os.getenv("SYNC_CHUNK_DAYS", "7"))
        records_synced = 0

        if not self._should_chunk_window(start_dt, end_dt, interval):
            raw_data = self._fetch_raw_for_range(
                uidds, start_dt, end_dt, interval, timezone
            )
            if raw_data:
                records_synced = self._store_records(raw_data, uidds, interval)
            return records_synced

        logger.info("Time-chunked fetch+store enabled: SYNC_CHUNK_DAYS=%s", chunk_days)
        chunk_start = start_dt
        while chunk_start < end_dt:
            chunk_end = min(chunk_start + timedelta(days=chunk_days), end_dt)
            chunk_data = self._fetch_raw_for_range(
                uidds, chunk_start, chunk_end, interval, timezone
            )
            if chunk_data:
                stored = self._store_records(chunk_data, uidds, interval)
                records_synced += stored
                logger.info(
                    "Chunk %s -> %s: fetched %s, stored %s (running total %s)",
                    chunk_start.strftime("%Y-%m-%d %H:%M"),
                    chunk_end.strftime("%Y-%m-%d %H:%M"),
                    len(chunk_data),
                    stored,
                    records_synced,
                )
            chunk_start = chunk_end
        return records_synced
    
    def sync_data(
        self, 
        uidds: Optional[List[str]] = None,
        days_back: int = 1,
        interval: str = "date"
    ) -> bool:
        """
        Sync people analytics data from Videoloft
        
        Args:
            uidds: List of device IDs to sync. If None, syncs all available cameras
            days_back: Number of days to fetch (default: 1, includes today and yesterday)
            interval: Time interval ('date', 'hour', or '60000' for minute)
            
        Note: days_back=1 means it will fetch today + yesterday (2 days total)
        """
        sync_id = self.start_sync()
        if not sync_id:
            return False
        
        try:
            # Get cameras if not provided
            if not uidds:
                cameras = self.videoloft.get_cameras()
                if not cameras:
                    self.complete_sync('failed', 0, "No cameras found")
                    return False
                uidds = [cam['id'] for cam in cameras]
            
            logger.info(f"Syncing data for {len(uidds)} devices, days_back={days_back}, interval={interval}")

            start_dt, end_dt, window_mode = _compute_sync_window(days_back, interval)
            tz = _sync_timezone()
            timezone = os.getenv("TIMEZONE", "Asia/Kuwait")
            logger.info(
                "Fetch window (%s, %s): %s -> %s",
                window_mode,
                tz.key,
                start_dt.strftime("%Y-%m-%d %H:%M"),
                end_dt.strftime("%Y-%m-%d %H:%M"),
            )

            records_synced = self._sync_window_to_db(
                uidds, start_dt, end_dt, interval, timezone
            )

            if records_synced == 0:
                logger.info("No records stored for this window (Videoloft may have returned no data)")
                self.complete_sync('success', 0, None)
                return True
            
            # Update sync log - 0 records is not a failure, just no data available
            if records_synced > 0:
                self.complete_sync('success', records_synced)
                logger.info(f"✅ Successfully synced {records_synced} records")
            else:
                self.complete_sync('success', 0, "No new records (data may not be available yet or already synced)")
                logger.info("✅ Sync completed successfully - no new records (data may not be available for this time period yet)")
            
            return True
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Error during sync: {error_msg}")
            self.complete_sync('failed', 0, error_msg)
            return False
    
    def _store_records(self, raw_data: List[Dict], uidds: List[str], interval: str) -> int:
        """Store records in database"""
        session = self.SessionLocal()
        records_synced = 0
        
        try:
            for record in raw_data:
                try:
                    # Debug: log record structure for first record
                    if records_synced == 0:
                        logger.debug(f"Sample record structure: {json.dumps(record, default=str)}")
                    
                    # Parse timestamps (handle both milliseconds and seconds)
                    first_ts = record.get('firstTimestamp', 0)
                    last_ts = record.get('lastTimestamp', 0)
                    # Convert to milliseconds if needed (if timestamp is in seconds)
                    if first_ts > 0 and first_ts < 1e10:
                        first_ts = first_ts * 1000
                    if last_ts > 0 and last_ts < 1e10:
                        last_ts = last_ts * 1000
                    
                    # Store timestamps as UTC-naive to keep comparisons consistent in DB.
                    first_timestamp = datetime.utcfromtimestamp(first_ts / 1000)
                    last_timestamp = datetime.utcfromtimestamp(last_ts / 1000)
                    first_timestamp, last_timestamp = _align_bucket_timestamps(
                        first_timestamp,
                        last_timestamp,
                        interval,
                        _sync_timezone(),
                    )
                    
                    # Calculate metrics
                    people_in = int(record.get('in', 0)) if record.get('in') is not None else 0
                    people_out = int(record.get('out', 0)) if record.get('out') is not None else 0
                    net_traffic = people_in - people_out
                    total_traffic = people_in + people_out
                    # traffic_ratio should never crash; handle zero-in safely.
                    # If people_in == 0:
                    # - and people_out == 0 -> ratio 0
                    # - and people_out > 0  -> treat as 0 (or could be None); keep 0 for stability
                    if people_in > 0:
                        traffic_ratio = people_out / people_in
                    else:
                        traffic_ratio = 0
                    
                    # Determine traffic pattern
                    traffic_pattern = "Normal"
                    if net_traffic > 10:
                        traffic_pattern = "High Inflow"
                    elif net_traffic < -10:
                        traffic_pattern = "High Outflow"
                    elif total_traffic > 50:
                        traffic_pattern = "Busy Period"
                    elif total_traffic < 5:
                        traffic_pattern = "Quiet Period"
                    
                    duration_hours = (last_timestamp - first_timestamp).total_seconds() / 3600
                    
                    # Create database record
                    # Convert uid and deviceId to strings (uid might be int)
                    uid_str = str(record.get('uid', '')) if record.get('uid') is not None else ''
                    device_id_str = str(record.get('deviceId', '')) if record.get('deviceId') is not None else ''
                    uidd = f"{uid_str}.{device_id_str}" if uid_str and device_id_str else (uid_str or device_id_str or '')
                    
                    # Use upsert (INSERT ... ON CONFLICT DO UPDATE) to prevent duplicates
                    # This updates the record if it exists, or inserts if it doesn't
                    stmt = insert(PeopleAnalyticsRecord).values(
                        uidd=uidd,
                        device_id=device_id_str,
                        first_timestamp=first_timestamp,
                        last_timestamp=last_timestamp,
                        interval_type=interval,
                        timezone=os.getenv('TIMEZONE', 'Asia/Kuwait'),
                        people_in=people_in,
                        people_out=people_out,
                        net_traffic=net_traffic,
                        total_traffic=total_traffic,
                        traffic_ratio=traffic_ratio,
                        traffic_pattern=traffic_pattern,
                        duration_hours=duration_hours,
                        event_count=record.get('events', 0),
                        raw_data=json.dumps(record),
                        synced_at=datetime.utcnow()
                    )
                    
                    # On conflict, update the synced_at timestamp and metrics (in case data changed)
                    stmt = stmt.on_conflict_do_update(
                        constraint='uq_uidd_timestamp_interval',
                        set_=dict(
                            people_in=stmt.excluded.people_in,
                            people_out=stmt.excluded.people_out,
                            net_traffic=stmt.excluded.net_traffic,
                            total_traffic=stmt.excluded.total_traffic,
                            traffic_ratio=stmt.excluded.traffic_ratio,
                            traffic_pattern=stmt.excluded.traffic_pattern,
                            duration_hours=stmt.excluded.duration_hours,
                            event_count=stmt.excluded.event_count,
                            raw_data=stmt.excluded.raw_data,
                            synced_at=stmt.excluded.synced_at
                        )
                    )
                    
                    session.execute(stmt)
                    records_synced += 1
                    
                except IntegrityError as e:
                    # Fallback if unique constraint name doesn't match
                    logger.warning(f"Integrity error (record may already exist): {str(e)}")
                    session.rollback()
                    continue
                except Exception as e:
                    logger.warning(f"Error storing record: {str(e)}")
                    session.rollback()
                    continue
            
            session.commit()
            logger.info(f"Stored {records_synced} records in database")
            
        except Exception as e:
            logger.error(f"Error storing records: {str(e)}")
            session.rollback()
        finally:
            session.close()
        
        return records_synced


def main():
    """Main entry point for sync service"""
    try:
        # Initialize database
        logger.info("Initializing database...")
        init_database()

        if _env_flag("RUN_DB_RECONCILE", "0"):
            logger.info("RUN_DB_RECONCILE=1 — cleaning duplicate hours and legacy date rows")
            from reconcile_people_db import reconcile_all

            if not reconcile_all():
                logger.error("DB reconcile failed")
                sys.exit(1)
        
        # Create sync service
        sync_service = PeopleAnalyticsSync()
        
        # Get configuration from environment
        days_back = int(os.getenv('SYNC_DAYS_BACK', '1'))
        interval = os.getenv('SYNC_INTERVAL', 'date')
        uidds_str = os.getenv('SYNC_UIDDS')  # Comma-separated list
        
        uidds = None
        if uidds_str:
            uidds = [uid.strip() for uid in uidds_str.split(',')]
        
        # Run sync
        logger.info(f"Starting sync: days_back={days_back}, interval={interval}")
        success = sync_service.sync_data(
            uidds=uidds,
            days_back=days_back,
            interval=interval
        )

        if success and interval == "hour" and _env_flag("SYNC_ALSO_DATE", "0"):
            live_days = int(os.getenv("SYNC_LIVE_DAYS", "0") or "0")
            if days_back == 0 and live_days > 0:
                logger.info("Also syncing daily (date) buckets for live window")
                success = sync_service.sync_data(
                    uidds=uidds, days_back=0, interval="date"
                ) and success
            elif days_back > 0:
                logger.info(
                    "Also syncing daily (date) buckets for backfill (days_back=%s)",
                    days_back,
                )
                success = sync_service.sync_data(
                    uidds=uidds, days_back=days_back, interval="date"
                ) and success
        
        if success:
            logger.info("Sync completed successfully")
            sys.exit(0)
        else:
            logger.error("Sync failed")
            sys.exit(1)
            
    except Exception as e:
        logger.error(f"Fatal error: {str(e)}")
        sys.exit(1)


if __name__ == '__main__':
    main()


