"""
People Analytics Sync Service
Fetches data from Videoloft API and stores it in the database
"""
import os
import sys
import json
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional
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
            
            # Calculate time range
            now = datetime.now()
            # For hourly syncs, always align to hour boundaries to match Videoloft bucketing.
            # Otherwise Videoloft may return shifted buckets like 17:27->18:27 which won't match UI expectations.
            if interval == "hour":
                end_dt = now.replace(minute=0, second=0, microsecond=0)
            else:
                end_dt = now
            end_time = int(end_dt.timestamp() * 1000)
            
            # If days_back=0, fetch only the last hour (for hourly cronjobs)
            # Otherwise, fetch the specified number of days
            if days_back == 0:
                # Fetch only last hour for hourly syncs
                if interval == "hour":
                    start_dt = end_dt - timedelta(hours=1)
                else:
                    start_dt = now - timedelta(hours=1)
                start_time = int(start_dt.timestamp() * 1000)
            else:
                # Fetch the last N days.
                # For hourly backfills we must align to day boundaries, otherwise we only fetch partial days
                # (e.g. starting at 17:27) which will NEVER match a full-day hourly query in the UI.
                start_dt = end_dt - timedelta(days=days_back)
                if interval == "hour":
                    start_dt = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
                start_time = int(start_dt.timestamp() * 1000)
            
            # Use UTC for logs/consistency (timestamps are epoch-based).
            start_date_str = datetime.utcfromtimestamp(start_time / 1000).strftime('%Y-%m-%d %H:%M')
            end_date_str = datetime.utcfromtimestamp(end_time / 1000).strftime('%Y-%m-%d %H:%M')
            logger.info(f"Fetching data from {start_date_str} to {end_date_str} (inclusive)")

            # Large hourly backfills must be chunked to avoid huge responses/timeouts.
            # For interval='hour' and long ranges, split into chunks (default 7 days).
            chunk_days = int(os.getenv("SYNC_CHUNK_DAYS", "7"))
            should_chunk = (interval == "hour") and (days_back >= chunk_days)

            total_raw = []
            if should_chunk:
                logger.info(f"Chunked backfill enabled: SYNC_CHUNK_DAYS={chunk_days}")
                chunk_start = datetime.utcfromtimestamp(start_time / 1000)
                chunk_end_global = datetime.utcfromtimestamp(end_time / 1000)

                while chunk_start < chunk_end_global:
                    chunk_end = min(chunk_start + timedelta(days=chunk_days), chunk_end_global)
                    cs = int(chunk_start.timestamp() * 1000)
                    ce = int(chunk_end.timestamp() * 1000)
                    logger.info(
                        f"Fetching chunk: {chunk_start.strftime('%Y-%m-%d %H:%M')} -> {chunk_end.strftime('%Y-%m-%d %H:%M')}"
                    )
                    chunk_data = self.videoloft.fetch_people_analytics(
                        uidds=uidds,
                        start_time=cs,
                        end_time=ce,
                        interval=interval,
                        timezone=os.getenv('TIMEZONE', 'Asia/Kuwait')
                    )
                    if chunk_data and isinstance(chunk_data, list):
                        total_raw.extend(chunk_data)
                        logger.info(f"Chunk fetched {len(chunk_data)} records (running total {len(total_raw)})")
                    else:
                        logger.info("Chunk returned 0 records")
                    # advance
                    chunk_start = chunk_end
                raw_data = total_raw
            else:
                # Fetch data from Videoloft (single request)
                raw_data = self.videoloft.fetch_people_analytics(
                    uidds=uidds,
                    start_time=start_time,
                    end_time=end_time,
                    interval=interval,
                    timezone=os.getenv('TIMEZONE', 'Asia/Kuwait')
                )
            
            if not raw_data or not isinstance(raw_data, list):
                logger.warning("No data received from Videoloft API (empty response)")
                self.complete_sync('success', 0, None)  # Not an error, just no data
                return True  # Still successful, just no data to sync
            
            if len(raw_data) == 0:
                logger.info("Videoloft returned empty data array - no records for this time period")
                self.complete_sync('success', 0, None)  # Not an error, just no data
                return True  # Still successful, just no data to sync
            
            # Store data in database
            records_synced = self._store_records(raw_data, uidds, interval)
            
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
                    # (API converts local day boundaries -> UTC before filtering.)
                    first_timestamp = datetime.utcfromtimestamp(first_ts / 1000)
                    last_timestamp = datetime.utcfromtimestamp(last_ts / 1000)
                    
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


