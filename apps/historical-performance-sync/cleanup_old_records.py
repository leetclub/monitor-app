#!/usr/bin/env python3
"""
Script to clean up old 30-day range records from historical_performance_records table
Only keeps daily records (where end_date - start_date is approximately 24 hours)
"""
import os
import sys
import logging
from datetime import timedelta
from sqlalchemy import func, and_
from models import HistoricalPerformanceRecord, create_engine_and_session

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def cleanup_old_records():
    """Remove old 30-day range records, keeping only daily records"""
    engine, Session = create_engine_and_session()
    session = Session()
    
    try:
        # Find all records where the date range is more than 25 hours (indicating multi-day ranges)
        # Daily records should be between 23-25 hours (accounting for timezone conversion)
        old_records = session.query(HistoricalPerformanceRecord).filter(
            func.extract('epoch', HistoricalPerformanceRecord.end_date - HistoricalPerformanceRecord.start_date) > 25 * 3600
        ).all()
        
        logger.info(f"Found {len(old_records)} old multi-day range records to delete")
        
        if old_records:
            for record in old_records:
                duration_hours = (record.end_date - record.start_date).total_seconds() / 3600
                logger.info(f"Deleting old record: machine_id={record.machine_id}, start={record.start_date}, end={record.end_date}, duration={duration_hours:.1f} hours, revenue={record.total_revenue}")
                session.delete(record)
            
            session.commit()
            logger.info(f"✅ Deleted {len(old_records)} old multi-day range records")
        else:
            logger.info("✅ No old records to clean up")
        
    except Exception as e:
        logger.error(f"Error cleaning up old records: {str(e)}")
        session.rollback()
        sys.exit(1)
    finally:
        session.close()

if __name__ == '__main__':
    cleanup_old_records()

