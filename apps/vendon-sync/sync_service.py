"""
Vendon Sales Sync Service
Fetches daily sales data from Vendon API and stores it in the database
"""
import os
import sys
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
import requests
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert
from models import (
    VendonSalesRecord, VendonSyncLog,
    create_engine_and_session, init_database
)

# Vendon uses Kuwait local date for daily boundaries (UTC+3)
KUWAIT_TZ = timezone(timedelta(hours=3))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def send_alert_to_admin(level: str, title: str, message: str, details: Optional[Dict] = None):
    """Send alert to admin panel"""
    admin_api_url = os.getenv('ADMIN_API_URL', 'https://vendon-api.theleetclub.com')
    admin_api_key = os.getenv('ADMIN_API_KEY', 'change-me-in-production')
    
    try:
        response = requests.post(
            f"{admin_api_url}/api/admin/receive-alert",
            json={
                'level': level,
                'source': 'sync',
                'title': title,
                'message': message,
                'details': details
            },
            headers={'X-API-Key': admin_api_key, 'Content-Type': 'application/json'},
            timeout=5
        )
        if response.status_code == 200:
            logger.debug(f"Alert sent to admin panel: {title}")
            return True
    except Exception as e:
        logger.warning(f"Failed to send alert to admin panel: {str(e)}")
    return False


class VendonClient:
    """Client for interacting with Vendon API"""
    
    def __init__(self):
        self.api_base = os.getenv('VENDON_API_BASE', 'https://cloud.vendon.net/rest/v1.9.0')
        self.api_key = os.getenv('VENDON_API_KEY', '7OMcvPEpSGsM6jRNZJnQVKZWlQEBWSqD')
        
        if not self.api_key:
            raise ValueError("VENDON_API_KEY must be set")
    
    def fetch_sales(
        self,
        from_timestamp: int,
        to_timestamp: int,
        machine_id: Optional[str] = None,
        limit: int = 10000
    ) -> Optional[List[Dict]]:
        """Fetch sales data from Vendon API with pagination support"""
        try:
            all_vends = []
            offset = 0
            max_iterations = 100  # Safety limit
            iteration = 0
            
            while iteration < max_iterations:
                iteration += 1
                url = f"{self.api_base}/stats/vends"
                params = {
                    'from_timestamp': from_timestamp,
                    'to_timestamp': to_timestamp,
                    'limit': limit,
                    'offset': offset
                }
                
                if machine_id:
                    params['machine_id'] = machine_id
                
                headers = {
                    'Authorization': f'Token {self.api_key}',
                    'Accept': 'application/json'
                }
                
                if iteration == 1:
                    logger.info(f"Fetching Vendon sales: machine_id={machine_id}, from={from_timestamp}, to={to_timestamp}")
                
                response = requests.get(url, params=params, headers=headers, timeout=60)
                
                if response.status_code != 200:
                    logger.error(f"Vendon API failed: {response.status_code} - {response.text}")
                    if iteration == 1:
                        return None
                    break
                
                data = response.json()
                
                if data.get('code') != 200:
                    logger.error(f"Vendon API error: {data.get('code')} - {data.get('message', 'Unknown error')}")
                    if iteration == 1:
                        return None
                    break
                
                result = data.get('result', [])
                if not result:
                    break
                
                all_vends.extend(result)
                logger.info(f"📥 Fetched chunk {iteration}: {len(result)} vends (total so far: {len(all_vends)})")
                
                # If we got fewer than the limit, we've reached the end
                if len(result) < limit:
                    logger.info(f"✅ Reached end of data (got {len(result)} < limit {limit})")
                    break
                
                offset += limit
                # Small delay to avoid rate limiting
                import time
                time.sleep(0.1)
            
            if iteration >= max_iterations:
                logger.warning(f"⚠️ Reached max_iterations limit ({max_iterations})! There may be more data not fetched. Total fetched: {len(all_vends)} vends")
            
            logger.info(f"✅ Fetched {len(all_vends)} vend records from Vendon (in {iteration} chunk(s))")
            return all_vends
            
        except Exception as e:
            logger.error(f"Error fetching Vendon sales: {str(e)}")
            return None
    
    def fetch_machines(self) -> List[Dict]:
        """Fetch list of machines from Vendon API"""
        try:
            # Use a recent date range to get machines that have recent activity
            now = int(datetime.now().timestamp())
            week_ago = now - (7 * 24 * 60 * 60)
            
            url = f"{self.api_base}/stats/vends"
            params = {
                'from_timestamp': week_ago,
                'to_timestamp': now,
                'limit': 1000
            }
            
            headers = {
                'Authorization': f'Token {self.api_key}',
                'Accept': 'application/json'
            }
            
            response = requests.get(url, params=params, headers=headers, timeout=60)
            
            if response.status_code != 200:
                logger.error(f"Failed to fetch machines: {response.status_code}")
                return []
            
            data = response.json()
            if data.get('code') != 200:
                return []
            
            # Extract unique machines from vends
            machines = {}
            for vend in data.get('result', []):
                machine_id = str(vend.get('machine_id', ''))
                if machine_id and machine_id not in machines:
                    machines[machine_id] = {
                        'id': machine_id,
                        'name': vend.get('machine_name', f'Machine {machine_id}')
                    }
            
            logger.info(f"Found {len(machines)} machines")
            return list(machines.values())
            
        except Exception as e:
            logger.error(f"Error fetching machines: {str(e)}")
            return []


class VendonSalesSync:
    """Service to sync Vendon sales data to database"""
    
    def __init__(self):
        self.vendon = VendonClient()
        self.engine, self.SessionLocal = create_engine_and_session()
        self.sync_log = None
    
    def start_sync(self):
        """Start a sync operation"""
        session = self.SessionLocal()
        try:
            self.sync_log = VendonSyncLog(
                sync_started_at=datetime.utcnow(),
                status='in_progress',
                records_synced=0
            )
            session.add(self.sync_log)
            session.commit()
            session.refresh(self.sync_log)
            logger.info(f"Started Vendon sync operation: {self.sync_log.id}")
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
            sync_log = session.query(VendonSyncLog).filter(VendonSyncLog.id == self.sync_log.id).first()
            if sync_log:
                sync_log.sync_completed_at = datetime.utcnow()
                sync_log.status = status
                sync_log.records_synced = records_synced
                sync_log.error_message = error_message
                session.commit()
                logger.info(f"Completed Vendon sync {sync_log.id}: {status}, {records_synced} records")
        except Exception as e:
            logger.error(f"Error updating sync log: {str(e)}")
            session.rollback()
        finally:
            session.close()
    
    def sync_daily_sales(
        self,
        machine_ids: Optional[List[str]] = None,
        days_back: int = 1,
        target_date: Optional[str] = None
    ) -> bool:
        """
        Sync daily sales data from Vendon
        
        Args:
            machine_ids: List of machine IDs to sync. If None, syncs all machines
            days_back: Number of days to fetch (default: 1, yesterday)
            target_date: Specific date to sync (YYYY-MM-DD). If provided, overrides days_back
        """
        sync_id = self.start_sync()
        if not sync_id:
            return False
        
        try:
            # Get machines if not provided
            if not machine_ids:
                # Use /machine endpoint to get ALL machines (not just ones with recent activity)
                try:
                    machines_url = f"{self.vendon.api_base}/machine"
                    headers = {
                        'Authorization': f'Token {self.vendon.api_key}',
                        'Accept': 'application/json'
                    }
                    response = requests.get(machines_url, headers=headers, timeout=60)
                    if response.status_code == 200:
                        data = response.json()
                        if data.get('code') == 200 and data.get('result'):
                            machines = [{'id': str(m.get('id', '')), 'name': m.get('name', '')} for m in data.get('result', [])]
                            logger.info(f"✅ Found {len(machines)} machines from /machine endpoint (ALL machines)")
                        else:
                            raise ValueError("Invalid response from /machine endpoint")
                    else:
                        raise ValueError(f"Failed to fetch machines: {response.status_code}")
                except Exception as e:
                    logger.warning(f"⚠️ Failed to get machines from /machine endpoint: {str(e)}, falling back to fetch_machines()")
                    # Fallback to extracting from vends (only machines with recent activity)
                    machines = self.vendon.fetch_machines()
                    if not machines:
                        self.complete_sync('failed', 0, "No machines found")
                        return False
                    logger.warning(f"⚠️ Using fallback method: Only found {len(machines)} machines with recent activity. Some machines may be missing.")
                
                machine_ids = [m['id'] for m in machines]
            
            logger.info(f"Syncing sales data for {len(machine_ids)} machines, days_back={days_back}")
            
            # Determine date range
            if target_date:
                # Sync specific date
                try:
                    target_dt = datetime.strptime(target_date, '%Y-%m-%d')
                    dates_to_sync = [target_dt.date()]
                except ValueError:
                    self.complete_sync('failed', 0, f"Invalid target_date format: {target_date}. Use YYYY-MM-DD")
                    return False
            else:
                # Sync last N days (yesterday and earlier, NOT today) - use Kuwait timezone
                # When days_back=1, sync yesterday's data (not today, since today is incomplete)
                dates_to_sync = []
                now_kuwait = datetime.now(KUWAIT_TZ)
                today_kuwait = now_kuwait.date()
                
                for i in range(1, days_back + 1):  # Start from 1 to skip today (i=0), sync yesterday (i=1) onwards
                    date = (now_kuwait - timedelta(days=i)).date()
                    dates_to_sync.append(date)
                    
                    # Validation: Warn if we're about to sync today (should never happen)
                    if date == today_kuwait:
                        error_msg = f"CRITICAL: Attempting to sync TODAY ({date})! This should never happen. Fix date calculation!"
                        logger.error(f"❌ {error_msg}")
                        send_alert_to_admin('critical', 'Date Calculation Error', error_msg, {'date': str(date), 'today': str(today_kuwait)})
                
                logger.info(f"Calculated dates to sync (Kuwait timezone, skipping today): {dates_to_sync}")
                logger.info(f"Today (Kuwait): {today_kuwait} - Will NOT sync today (correct)")
            
            total_records = 0
            
            # Sync each date
            for sale_date in dates_to_sync:
                # Vendon daily boundaries are in Kuwait local time (UTC+3).
                # e.g. "2026-01-16" = 2026-01-16 00:00:00 Kuwait to 23:59:59 Kuwait.
                start_dt = datetime.combine(sale_date, datetime.min.time(), tzinfo=KUWAIT_TZ)
                end_dt = datetime.combine(sale_date, datetime.max.time(), tzinfo=KUWAIT_TZ)
                from_timestamp = int(start_dt.timestamp())
                to_timestamp = int(end_dt.timestamp())
                
                logger.info(f"Syncing date: {sale_date} Kuwait ({from_timestamp} to {to_timestamp})")
                
                # Sync each machine
                for machine_id in machine_ids:
                    try:
                        # Fetch sales for this machine and date
                        vends = self.vendon.fetch_sales(
                            machine_id=machine_id,
                            from_timestamp=from_timestamp,
                            to_timestamp=to_timestamp
                        )
                        
                        if vends is None:
                            logger.warning(f"Failed to fetch sales for machine {machine_id} on {sale_date}")
                            continue
                        
                        # Calculate totals
                        total_revenue = sum(vend.get('price', 0) for vend in vends)
                        total_transactions = len(vends)
                        
                        # Log detailed info for debugging (especially if revenue seems low)
                        logger.info(f"📊 Machine {machine_id} on {sale_date}: fetched {len(vends)} vends, revenue={total_revenue:.2f} KWD, transactions={total_transactions}")
                        
                        # Warn if we got exactly 10,000 vends (might indicate pagination issue)
                        if len(vends) >= 10000:
                            logger.warning(f"⚠️ Machine {machine_id} on {sale_date}: Got exactly {len(vends)} vends (limit reached). There may be more data - check pagination!")
                        
                        # Get machine name from first vend (if available)
                        machine_name = None
                        if vends and len(vends) > 0:
                            machine_name = vends[0].get('machine_name')
                        
                        # Store in database
                        if self._store_daily_sales(
                            machine_id=machine_id,
                            machine_name=machine_name,
                            sale_date=sale_date,
                            total_revenue=total_revenue,
                            total_transactions=total_transactions,
                            raw_vends=vends
                        ):
                            total_records += 1
                            logger.info(f"✅ Stored: machine {machine_id} ({machine_name or 'unknown'}) on {sale_date}: {total_revenue:.2f} KWD, {total_transactions} transactions")
                        else:
                            logger.error(f"❌ Failed to store data for machine {machine_id} on {sale_date}")
                        
                    except Exception as e:
                        logger.warning(f"Error syncing machine {machine_id} for date {sale_date}: {str(e)}")
                        continue
            
            self.complete_sync('success', total_records)
            logger.info(f"✅ Successfully synced {total_records} daily sales records")
            return True
            
        except Exception as e:
            error_msg = str(e)
            logger.error(f"Error during Vendon sync: {error_msg}")
            self.complete_sync('failed', 0, error_msg)
            return False
    
    def _store_daily_sales(
        self,
        machine_id: str,
        machine_name: Optional[str],
        sale_date: datetime.date,
        total_revenue: float,
        total_transactions: int,
        raw_vends: List[Dict]
    ) -> bool:
        """Store daily sales record in database"""
        session = self.SessionLocal()
        
        try:
            # Convert date to datetime (midnight)
            sale_datetime = datetime.combine(sale_date, datetime.min.time())
            
            # Use upsert to prevent duplicates
            stmt = insert(VendonSalesRecord).values(
                machine_id=machine_id,
                machine_name=machine_name,
                sale_date=sale_datetime,
                total_revenue=total_revenue,
                total_transactions=total_transactions,
                raw_vends=json.dumps(raw_vends),
                synced_at=datetime.utcnow()
            )
            
            # On conflict, update the data (in case it changed)
            stmt = stmt.on_conflict_do_update(
                constraint='uq_machine_date',
                set_=dict(
                    machine_name=stmt.excluded.machine_name,
                    total_revenue=stmt.excluded.total_revenue,
                    total_transactions=stmt.excluded.total_transactions,
                    raw_vends=stmt.excluded.raw_vends,
                    synced_at=stmt.excluded.synced_at
                )
            )
            
            session.execute(stmt)
            session.commit()
            return True
            
        except Exception as e:
            logger.error(f"Error storing daily sales: {str(e)}")
            session.rollback()
            return False
        finally:
            session.close()


def main():
    """Main entry point for Vendon sync service"""
    try:
        # Initialize database
        logger.info("Initializing database...")
        init_database()
        
        # Create sync service
        sync_service = VendonSalesSync()
        
        # Get configuration from environment
        days_back = int(os.getenv('VENDON_SYNC_DAYS_BACK', '1'))
        target_date = os.getenv('VENDON_SYNC_TARGET_DATE')  # Optional: YYYY-MM-DD
        machine_ids_str = os.getenv('VENDON_SYNC_MACHINE_IDS')  # Optional: comma-separated
        
        machine_ids = None
        if machine_ids_str:
            machine_ids = [mid.strip() for mid in machine_ids_str.split(',')]
        
        # Run sync
        logger.info(f"Starting Vendon sync: days_back={days_back}, target_date={target_date}")
        success = sync_service.sync_daily_sales(
            machine_ids=machine_ids,
            days_back=days_back,
            target_date=target_date
        )
        
        if success:
            logger.info("Vendon sync completed successfully")
            sys.exit(0)
        else:
            logger.error("Vendon sync failed")
            sys.exit(1)
            
    except Exception as e:
        logger.error(f"Fatal error: {str(e)}")
        sys.exit(1)


if __name__ == '__main__':
    main()

