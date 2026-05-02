"""
Sync service for Historical Performance data
Fetches data from Vendon API and stores aggregated results in database
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
    HistoricalPerformanceRecord, HistoricalPerformanceSyncLog,
    create_engine_and_session, init_database
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Vendon uses Kuwait local date for daily boundaries (UTC+3)
KUWAIT_TZ = timezone(timedelta(hours=3))


class VendonClient:
    """Client for Vendon API"""
    
    def __init__(self, api_key: str, api_base: str = "https://cloud.vendon.net/rest/v1.9.0"):
        self.api_key = api_key
        self.api_base = api_base
    
    def fetch_vends(
        self,
        from_timestamp: int,
        to_timestamp: int,
        machine_id: Optional[str] = None,
        limit: int = 10000,
        offset: int = 0
    ) -> Optional[List[Dict]]:
        """Fetch vends from Vendon API with pagination"""
        try:
            url = f"{self.api_base}/stats/vends"
            headers = {
                'Authorization': f'Token {self.api_key}',
                'Accept': 'application/json'
            }
            params = {
                'from_timestamp': from_timestamp,
                'to_timestamp': to_timestamp,
                'limit': limit,
                'offset': offset
            }
            if machine_id:
                params['machine_id'] = machine_id
            
            logger.info(f"Fetching vends: {url} with params: {params}")
            response = requests.get(url, headers=headers, params=params, timeout=120)
            
            if response.status_code != 200:
                logger.error(f"Failed to fetch vends: {response.status_code} - {response.text}")
                return None
            
            data = response.json()
            if data.get('code') != 200:
                logger.error(f"Vendon API error: {data.get('code')} - {data.get('message', 'Unknown error')}")
                return None
            
            return data.get('result', [])
            
        except Exception as e:
            logger.error(f"Error fetching vends: {str(e)}")
            return None
    
    def fetch_machines(self) -> List[Dict]:
        """Fetch list of all machines from Vendon API"""
        try:
            url = f"{self.api_base}/machine"
            headers = {
                'Authorization': f'Token {self.api_key}',
                'Accept': 'application/json'
            }
            
            logger.info(f"Fetching all machines from Vendon API: {url}")
            response = requests.get(url, headers=headers, timeout=60)
            
            if response.status_code != 200:
                logger.error(f"Failed to fetch all machines: {response.status_code} - {response.text}")
                return []
            
            data = response.json()
            if data.get('code') != 200:
                logger.error(f"Vendon API error fetching machines: {data.get('code')} - {data.get('message', 'Unknown error')}")
                return []
            
            machines = []
            for m in data.get('result', []):
                machines.append({
                    'id': str(m.get('id')),
                    'name': m.get('name', f'Machine {m.get("id")}')
                })
            
            logger.info(f"Found {len(machines)} machines from /machine endpoint")
            return machines
            
        except Exception as e:
            logger.error(f"Error fetching all machines: {str(e)}")
            return []


def aggregate_vends(vends: List[Dict]) -> Dict:
    """Aggregate vends into product breakdown, totals, etc."""
    product_revenue = {}
    total_revenue = 0.0
    total_quantity = 0
    
    for vend in vends:
        price = float(vend.get('price', 0) or 0)
        product_name = vend.get('name', 'Unknown Product')
        
        total_revenue += price
        total_quantity += 1
        
        if product_name not in product_revenue:
            product_revenue[product_name] = {
                'name': product_name,
                'revenue': 0.0,
                'quantity': 0
            }
        
        product_revenue[product_name]['revenue'] += price
        product_revenue[product_name]['quantity'] += 1
    
    # Convert to arrays and sort
    products_array = list(product_revenue.values())
    
    # Top 10 products by revenue
    top_products = sorted(products_array, key=lambda x: x['revenue'], reverse=True)[:10]
    
    # Bottom 10 products by revenue (excluding zero revenue)
    bottom_products = sorted(
        [p for p in products_array if p['revenue'] > 0],
        key=lambda x: x['revenue']
    )[:10]
    
    # Simplified product breakdown (just revenue values for charts)
    product_breakdown_simple = {p['name']: p['revenue'] for p in products_array}
    
    return {
        'total_revenue': round(total_revenue, 2),
        'total_quantity': total_quantity,
        'product_breakdown': product_breakdown_simple,
        'top_products': top_products,
        'bottom_products': bottom_products,
        'raw_vends_count': len(vends)
    }


def fetch_all_vends_for_range(
    vendon: VendonClient,
    machine_id: str,
    from_timestamp: int,
    to_timestamp: int
) -> List[Dict]:
    """Fetch all vends for a date range using pagination"""
    all_vends = []
    offset = 0
    limit = 10000
    max_iterations = 50
    iteration = 0
    
    while iteration < max_iterations:
        iteration += 1
        logger.info(f"Fetching chunk {iteration} for machine {machine_id} (offset: {offset})")
        
        vends = vendon.fetch_vends(
            from_timestamp=from_timestamp,
            to_timestamp=to_timestamp,
            machine_id=machine_id,
            limit=limit,
            offset=offset
        )
        
        if not vends or len(vends) == 0:
            break
        
        all_vends.extend(vends)
        logger.info(f"Fetched {len(vends)} vends (total so far: {len(all_vends)})")
        
        if len(vends) < limit:
            break
        
        offset += limit
        # Small delay to avoid rate limiting
        import time
        time.sleep(0.2)
    
    return all_vends


def sync_historical_performance(
    machine_id: str,
    machine_name: str,
    start_date: datetime.date,
    end_date: datetime.date,
    vendon: VendonClient,
    session
) -> bool:
    """Sync historical performance data for a specific machine and date range"""
    try:
        # Calculate timestamp range (Kuwait timezone)
        # Vendon daily boundaries are in Kuwait local time (UTC+3)
        # e.g. "2026-01-16" = 2026-01-16 00:00:00 Kuwait to 23:59:59.999999 Kuwait
        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=KUWAIT_TZ)
        end_dt = datetime.combine(end_date, datetime.max.time(), tzinfo=KUWAIT_TZ)
        from_timestamp = int(start_dt.timestamp())
        to_timestamp = int(end_dt.timestamp())
        
        logger.info(f"Syncing historical performance for {machine_name} ({machine_id}): {start_date} to {end_date}")
        
        # Fetch all vends
        vends = fetch_all_vends_for_range(vendon, machine_id, from_timestamp, to_timestamp)
        
        if not vends:
            logger.warning(f"No vends found for machine {machine_id} in date range {start_date} to {end_date}")
            # Store empty record
            aggregated = {
                'total_revenue': 0.0,
                'total_quantity': 0,
                'product_breakdown': {},
                'top_products': [],
                'bottom_products': [],
                'raw_vends_count': 0
            }
        else:
            logger.info(f"Fetched {len(vends)} vends, aggregating...")
            aggregated = aggregate_vends(vends)
        
        # Store in database (convert from Kuwait timezone to UTC for storage)
        # The timestamps used for API calls are in Kuwait time, but we store UTC datetimes
        utc_tz = timezone.utc
        start_datetime = start_dt.astimezone(utc_tz).replace(tzinfo=None)
        end_datetime = end_dt.astimezone(utc_tz).replace(tzinfo=None)
        
        stmt = insert(HistoricalPerformanceRecord).values(
            machine_id=machine_id,
            machine_name=machine_name,
            start_date=start_datetime,
            end_date=end_datetime,
            total_revenue=aggregated['total_revenue'],
            total_quantity=aggregated['total_quantity'],
            product_breakdown=json.dumps(aggregated['product_breakdown']),
            top_products=json.dumps(aggregated['top_products']),
            bottom_products=json.dumps(aggregated['bottom_products']),
            raw_vends_count=aggregated['raw_vends_count'],
            synced_at=datetime.utcnow()
        )
        
        # On conflict, update the data
        stmt = stmt.on_conflict_do_update(
            constraint='uq_machine_date_range',
            set_=dict(
                machine_name=stmt.excluded.machine_name,
                total_revenue=stmt.excluded.total_revenue,
                total_quantity=stmt.excluded.total_quantity,
                product_breakdown=stmt.excluded.product_breakdown,
                top_products=stmt.excluded.top_products,
                bottom_products=stmt.excluded.bottom_products,
                raw_vends_count=stmt.excluded.raw_vends_count,
                synced_at=stmt.excluded.synced_at
            )
        )
        
        session.execute(stmt)
        session.commit()
        
        logger.info(f"✅ Synced historical performance for {machine_name}: {aggregated['total_revenue']} KWD, {aggregated['total_quantity']} vends")
        return True
        
    except Exception as e:
        logger.error(f"Error syncing historical performance for {machine_id}: {str(e)}")
        session.rollback()
        return False


def main():
    """Main sync function"""
    logger.info("🚀 Starting Historical Performance sync...")
    
    # Get environment variables
    vendon_api_key = os.getenv('VENDON_API_KEY')
    vendon_api_base = os.getenv('VENDON_API_BASE', 'https://cloud.vendon.net/rest/v1.9.0')
    sync_days_back = int(os.getenv('HISTORICAL_SYNC_DAYS_BACK', '30'))  # Default: sync last 30 days
    
    if not vendon_api_key:
        logger.error("VENDON_API_KEY environment variable is required")
        sys.exit(1)
    
    # Initialize database
    try:
        engine, Session = create_engine_and_session()
        init_database(engine)
        session = Session()
    except Exception as e:
        logger.error(f"Failed to initialize database: {str(e)}")
        sys.exit(1)
    
    # Initialize sync log
    sync_log = HistoricalPerformanceSyncLog(
        sync_started_at=datetime.utcnow(),
        status='running'
    )
    session.add(sync_log)
    session.commit()
    
    try:
        # Initialize Vendon client
        vendon = VendonClient(vendon_api_key, vendon_api_base)
        
        # Fetch all machines
        machines = vendon.fetch_machines()
        if not machines:
            logger.error("No machines found")
            sync_log.status = 'failed'
            sync_log.error_message = "No machines found"
            sync_log.sync_completed_at = datetime.utcnow()
            session.commit()
            sys.exit(1)
        
        logger.info(f"Found {len(machines)} machines to sync")
        
        # Calculate date range (last N days)
        today = datetime.now(KUWAIT_TZ).date()
        end_date = today - timedelta(days=1)  # Yesterday
        start_date = end_date - timedelta(days=sync_days_back - 1)
        
        logger.info(f"Syncing date range: {start_date} to {end_date} ({sync_days_back} days)")
        
        records_synced = 0
        machines_processed = []
        
        # Sync each machine for EACH DAY in the date range (store daily records, not range records)
        # This allows the API to return exact daily data when requested
        current_date = start_date
        while current_date <= end_date:
            logger.info(f"Syncing date: {current_date.isoformat()}")
            
            for machine in machines:
                machine_id = machine['id']
                machine_name = machine['name']
                
                try:
                    # Store one record per machine per day (start_date = end_date = current_date)
                    success = sync_historical_performance(
                        machine_id=machine_id,
                        machine_name=machine_name,
                        start_date=current_date,
                        end_date=current_date,  # Same date for daily records
                        vendon=vendon,
                        session=session
                    )
                    
                    if success:
                        records_synced += 1
                        if machine_id not in machines_processed:
                            machines_processed.append(machine_id)
                    
                except Exception as e:
                    logger.error(f"Error processing machine {machine_id} for date {current_date}: {str(e)}")
                    continue
            
            # Move to next day
            current_date += timedelta(days=1)
        
        # Update sync log
        sync_log.status = 'completed'
        sync_log.records_synced = records_synced
        sync_log.machines_processed = ','.join(machines_processed)
        sync_log.sync_completed_at = datetime.utcnow()
        session.commit()
        
        logger.info(f"✅ Sync complete! Processed {records_synced} machines")
        
    except Exception as e:
        logger.error(f"Sync failed: {str(e)}")
        sync_log.status = 'failed'
        sync_log.error_message = str(e)
        sync_log.sync_completed_at = datetime.utcnow()
        session.commit()
        sys.exit(1)
    finally:
        session.close()


if __name__ == '__main__':
    main()

