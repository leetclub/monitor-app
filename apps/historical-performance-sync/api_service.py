"""
API service for Historical Performance data
Serves cached historical performance data from database
"""
import os
import json
import logging
from datetime import datetime, date
from types import SimpleNamespace
from flask import Flask, request, jsonify
from sqlalchemy import and_
from models import (
    HistoricalPerformanceRecord,
    create_engine_and_session
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Global session (will be initialized on first request)
_session = None


def get_session():
    """Get or create database session"""
    global _session
    if _session is None:
        try:
            _, Session = create_engine_and_session()
            _session = Session()
        except Exception as e:
            logger.error(f"Failed to create database session: {str(e)}")
            raise
    return _session


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'service': 'historical-performance-api'}), 200


@app.route('/historical-performance', methods=['GET'])
def get_historical_performance():
    """Get historical performance data for a machine and date range"""
    try:
        machine_id = request.args.get('machine_id')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        if not machine_id or not start_date or not end_date:
            return jsonify({
                'success': False,
                'error': 'Missing required parameters: machine_id, start_date, end_date'
            }), 400
        
        # Parse dates
        try:
            start_dt = datetime.strptime(start_date, '%Y-%m-%d').date()
            end_dt = datetime.strptime(end_date, '%Y-%m-%d').date()
        except ValueError as e:
            return jsonify({
                'success': False,
                'error': f'Invalid date format. Use YYYY-MM-DD: {str(e)}'
            }), 400
        
        session = get_session()
        
        # Query database - find record where the requested date range matches
        # The sync service stores daily records (start_date = end_date = sale_date) in UTC
        # We need to convert the requested date (assumed to be in Kuwait timezone) to UTC for querying
        from datetime import timezone as tz, timedelta
        from sqlalchemy import func
        kuwait_tz = tz(timedelta(hours=3))
        
        # Convert requested dates to UTC (matching how sync service stores them)
        start_dt_kuwait = datetime.combine(start_dt, datetime.min.time(), tzinfo=kuwait_tz)
        end_dt_kuwait = datetime.combine(end_dt, datetime.max.time(), tzinfo=kuwait_tz)
        start_datetime_utc = start_dt_kuwait.astimezone(tz.utc).replace(tzinfo=None)
        end_datetime_utc = end_dt_kuwait.astimezone(tz.utc).replace(tzinfo=None)
        
        # For single-day requests, find records where the requested date matches the stored date
        # We store daily records where start_date and end_date represent the full UTC range for a Kuwait day
        # (e.g., Kuwait 2026-01-17 00:00:00 to 23:59:59 = UTC 2026-01-16 21:00:00 to 2026-01-17 20:59:59)
        # IMPORTANT: We need to match EXACTLY the stored UTC range to avoid matching old 30-day range records
        if start_dt == end_dt:
            # Single day request - find record where the stored UTC range EXACTLY matches the requested Kuwait date's UTC range
            # This ensures we only match daily records, not old 30-day range records
            record = session.query(HistoricalPerformanceRecord).filter(
                and_(
                    HistoricalPerformanceRecord.machine_id == machine_id,
                    # Exact match: stored start_date should equal our calculated start_datetime_utc
                    HistoricalPerformanceRecord.start_date == start_datetime_utc,
                    # Exact match: stored end_date should equal our calculated end_datetime_utc
                    HistoricalPerformanceRecord.end_date == end_datetime_utc
                )
            ).first()
            
            # If exact match not found, try range overlap but ONLY for daily records (filter out old 30-day ranges)
            if not record:
                # Calculate the time difference in seconds for comparison
                # Only match records where the stored range is approximately one day (between 23 and 25 hours)
                # This filters out old 30-day range records while allowing for timezone conversion differences
                record = session.query(HistoricalPerformanceRecord).filter(
                    and_(
                        HistoricalPerformanceRecord.machine_id == machine_id,
                        HistoricalPerformanceRecord.start_date <= end_datetime_utc,
                        HistoricalPerformanceRecord.end_date >= start_datetime_utc,
                        # Only match records that represent approximately one day (23-25 hours)
                        # This filters out old 30-day range records
                        func.extract('epoch', HistoricalPerformanceRecord.end_date - HistoricalPerformanceRecord.start_date) >= 23 * 3600,  # At least 23 hours
                        func.extract('epoch', HistoricalPerformanceRecord.end_date - HistoricalPerformanceRecord.start_date) <= 25 * 3600   # At most 25 hours
                    )
                ).first()
        else:
            # Multi-day request - aggregate multiple daily records
            # Find all daily records in the requested range (using UTC datetimes)
            # Daily records have start_date and end_date representing a Kuwait day's UTC range
            daily_records = session.query(HistoricalPerformanceRecord).filter(
                and_(
                    HistoricalPerformanceRecord.machine_id == machine_id,
                    # Find records where the stored UTC range overlaps with the requested UTC range
                    HistoricalPerformanceRecord.start_date <= end_datetime_utc,
                    HistoricalPerformanceRecord.end_date >= start_datetime_utc
                )
            ).all()
            
            if not daily_records:
                record = None
            else:
                # Aggregate the daily records
                total_revenue = sum(r.total_revenue for r in daily_records)
                total_quantity = sum(r.total_quantity for r in daily_records)
                raw_vends_count = sum(r.raw_vends_count for r in daily_records)
                
                # Aggregate product breakdowns
                combined_product_breakdown = {}
                all_top_products = []
                all_bottom_products = []
                
                for r in daily_records:
                    try:
                        product_breakdown = json.loads(r.product_breakdown) if r.product_breakdown else {}
                        for product, data in product_breakdown.items():
                            if product not in combined_product_breakdown:
                                combined_product_breakdown[product] = {'revenue': 0.0, 'quantity': 0}
                            combined_product_breakdown[product]['revenue'] += data.get('revenue', 0.0)
                            combined_product_breakdown[product]['quantity'] += data.get('quantity', 0)
                        
                        top_products = json.loads(r.top_products) if r.top_products else []
                        all_top_products.extend(top_products)
                        
                        bottom_products = json.loads(r.bottom_products) if r.bottom_products else []
                        all_bottom_products.extend(bottom_products)
                    except json.JSONDecodeError:
                        continue
                
                # Sort and get top/bottom 10
                all_top_products.sort(key=lambda x: x.get('revenue', 0), reverse=True)
                all_bottom_products.sort(key=lambda x: x.get('revenue', 0))
                top_products = all_top_products[:10]
                bottom_products = [p for p in all_bottom_products if p.get('revenue', 0) > 0][:10]
                
                # Create a synthetic record for the aggregated data
                record = SimpleNamespace(
                    machine_id=machine_id,
                    machine_name=daily_records[0].machine_name if daily_records else None,
                    start_date=start_datetime,
                    end_date=end_datetime,
                    total_revenue=total_revenue,
                    total_quantity=total_quantity,
                    product_breakdown=json.dumps(combined_product_breakdown),
                    top_products=json.dumps(top_products),
                    bottom_products=json.dumps(bottom_products),
                    raw_vends_count=raw_vends_count,
                    synced_at=daily_records[0].synced_at if daily_records else None
                )
        
        if not record:
            # No exact match found - return no data to force frontend fallback to direct Vendon API
            logger.info(f"No exact date range match for machine {machine_id}: requested {start_date} to {end_date}, will fallback to direct Vendon API")
            return jsonify({
                'success': False,
                'error': f'No cached data found for exact date range {start_date} to {end_date}. Please use direct Vendon API.'
            }), 404
        
        # Parse JSON fields
        try:
            product_breakdown = json.loads(record.product_breakdown) if record.product_breakdown else {}
            top_products = json.loads(record.top_products) if record.top_products else []
            bottom_products = json.loads(record.bottom_products) if record.bottom_products else []
        except json.JSONDecodeError as e:
            logger.error(f"Error parsing JSON fields: {str(e)}")
            product_breakdown = {}
            top_products = []
            bottom_products = []
        
        result = {
            'success': True,
            'data': {
                'machineId': record.machine_id,
                'machineName': record.machine_name,
                'startDate': start_date,
                'endDate': end_date,
                'totalRevenue': round(record.total_revenue, 2),
                'totalQuantity': record.total_quantity,
                'productRevenue': product_breakdown,
                'topProducts': top_products,
                'bottomProducts': bottom_products,
                'syncedAt': record.synced_at.isoformat() + 'Z' if record.synced_at else None
            }
        }
        
        return jsonify(result), 200
        
    except Exception as e:
        logger.error(f"Error in get_historical_performance: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/historical-performance/best-yesterday', methods=['GET'])
def get_best_machine_yesterday():
    """Get the best performing machine from yesterday (for preload optimization)"""
    try:
        exclude_ids = request.args.get('exclude_ids', '').split(',')
        exclude_ids = [id.strip() for id in exclude_ids if id.strip()]
        
        session = get_session()
        
        # Calculate yesterday in Kuwait timezone
        from datetime import timezone, timedelta
        kuwait_tz = timezone(timedelta(hours=3))
        yesterday = (datetime.now(kuwait_tz) - timedelta(days=1)).date()
        
        # Convert yesterday to datetime for comparison
        yesterday_dt = datetime.combine(yesterday, datetime.min.time())
        
        # Query for best machine - find records where yesterday falls within the stored date range
        # The sync service stores one record per machine for a date range (e.g., last 30 days)
        # So we need to find records where start_date <= yesterday <= end_date
        query = session.query(HistoricalPerformanceRecord).filter(
            and_(
                HistoricalPerformanceRecord.start_date <= yesterday_dt,
                HistoricalPerformanceRecord.end_date >= yesterday_dt
            )
        )
        
        if exclude_ids:
            query = query.filter(~HistoricalPerformanceRecord.machine_id.in_(exclude_ids))
        
        # Order by revenue descending and get the first one
        best_record = query.order_by(HistoricalPerformanceRecord.total_revenue.desc()).first()
        
        if not best_record:
            return jsonify({
                'success': True,
                'bestMachine': None,
                'message': f'No data found for yesterday ({yesterday.isoformat()})'
            }), 200
        
        result = {
            'success': True,
            'bestMachine': {
                'machineId': best_record.machine_id,
                'machineName': best_record.machine_name,
                'revenue': round(best_record.total_revenue, 2),
                'quantity': best_record.total_quantity,
                'date': yesterday.isoformat()
            }
        }
        
        return jsonify(result), 200
        
    except Exception as e:
        logger.error(f"Error in get_best_machine_yesterday: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


if __name__ == '__main__':
    port = int(os.getenv('API_PORT', '5002'))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)

