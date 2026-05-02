"""
Database models for People Analytics data storage
"""
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Date, Text, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os

Base = declarative_base()


class PeopleAnalyticsRecord(Base):
    """Model for storing people analytics data from Videoloft"""
    __tablename__ = 'people_analytics_records'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    
    # Device/Camera information
    uidd = Column(String(100), nullable=False, index=True)
    device_id = Column(String(100), index=True)
    
    # Time information
    first_timestamp = Column(DateTime, nullable=False, index=True)
    last_timestamp = Column(DateTime, nullable=False)
    interval_type = Column(String(50))  # 'date', 'hour', '60000' (minute)
    timezone = Column(String(50), default='Asia/Kuwait')
    
    # People count data
    people_in = Column(Integer, default=0)
    people_out = Column(Integer, default=0)
    net_traffic = Column(Integer, default=0)
    total_traffic = Column(Integer, default=0)
    
    # Calculated metrics
    traffic_ratio = Column(Float)
    traffic_pattern = Column(String(50))  # 'Normal', 'High Inflow', 'High Outflow', 'Busy Period', 'Quiet Period'
    duration_hours = Column(Float)
    event_count = Column(Integer, default=0)
    
    # Raw data storage (JSON string)
    raw_data = Column(Text)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    synced_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Indexes and unique constraints for common queries
    __table_args__ = (
        Index('idx_uidd_timestamp', 'uidd', 'first_timestamp'),
        Index('idx_synced_at', 'synced_at'),
        # Unique constraint to prevent duplicate records for same device/time period
        UniqueConstraint('uidd', 'first_timestamp', 'last_timestamp', 'interval_type', 
                        name='uq_uidd_timestamp_interval'),
    )


class SyncLog(Base):
    """Model for tracking sync operations"""
    __tablename__ = 'sync_logs'

    id = Column(Integer, primary_key=True, autoincrement=True)
    sync_started_at = Column(DateTime, default=datetime.utcnow, index=True)
    sync_completed_at = Column(DateTime)
    status = Column(String(50))  # 'success', 'failed', 'partial'
    records_synced = Column(Integer, default=0)
    error_message = Column(Text)
    uidds_processed = Column(Text)  # JSON array of processed device IDs


class WasteAnalysisReason(Base):
    """User-entered reason for waste analysis result per machine per date"""
    __tablename__ = 'waste_analysis_reasons'

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String(64), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    reason = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('machine_id', 'date', name='uq_waste_reasons_machine_date'),
        Index('idx_waste_reasons_machine_date', 'machine_id', 'date'),
    )


class RemoteCreditReason(Base):
    """User-entered reason for Refund Tests (Reason Unidentified) per log"""
    __tablename__ = 'remote_credit_reasons'

    id = Column(Integer, primary_key=True, autoincrement=True)
    log_id = Column(String(128), nullable=False, index=True)
    machine_id = Column(String(64), nullable=False, index=True)
    timestamp_val = Column(Integer, nullable=False, index=True)  # Unix seconds
    reason = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('log_id', 'machine_id', 'timestamp_val', name='uq_remote_credit_reasons_key'),
        Index('idx_remote_credit_reasons_machine_ts', 'machine_id', 'timestamp_val'),
    )


class IntraDayCheckup(Base):
    """Midday operator readiness check per machine per day (control staff)."""
    __tablename__ = 'intra_day_checkups'

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String(64), nullable=False, index=True)
    operator_id = Column(String(64), nullable=False, index=True)
    operator_name = Column(String(256))
    check_date = Column(Date, nullable=False, index=True)
    status = Column(String(32), nullable=False)  # 'ready' | 'not_ready'
    recorded_at = Column(DateTime, default=datetime.utcnow)
    recorded_by = Column(String(128))

    __table_args__ = (
        UniqueConstraint('machine_id', 'operator_id', 'check_date', name='uq_intra_day_checkup_machine_operator_date'),
        Index('idx_intra_day_checkups_machine_date', 'machine_id', 'check_date'),
        Index('idx_intra_day_checkups_check_date', 'check_date'),
    )


class VendonEventCache(Base):
    """Cached Vendon /event rows for a specific day (Delay Risk / Events tab)."""
    __tablename__ = 'vendon_events_cache'

    id = Column(Integer, primary_key=True, autoincrement=True)
    cache_date = Column(Date, nullable=False, index=True)

    # Stable de-dupe key per (cache_date, event_key)
    event_key = Column(Text, nullable=False)
    vendon_event_id = Column(Text)

    machine_id = Column(Text, index=True)
    machine_name = Column(Text)

    name = Column(Text)
    base_code = Column(Text)
    display_name = Column(Text)

    received_at = Column(Integer, index=True)  # Unix seconds
    resolved_at = Column(Integer)
    duration = Column(Integer)

    payload_json = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        UniqueConstraint('cache_date', 'event_key', name='uq_vendon_events_cache_date_key'),
        Index('idx_vendon_events_cache_machine_date', 'machine_id', 'cache_date'),
        Index('idx_vendon_events_cache_date_received', 'cache_date', 'received_at'),
    )


class VendonDailyMachineRevenueCache(Base):
    """Cached per-machine revenue for a single day (used for top-N revenue preloads)."""
    __tablename__ = 'vendon_daily_machine_revenue_cache'

    id = Column(Integer, primary_key=True, autoincrement=True)
    cache_date = Column(Date, nullable=False, index=True)
    machine_id = Column(Text, nullable=False)
    machine_name = Column(Text)
    total_sales_kwd = Column(Float, nullable=False, default=0)
    total_transactions = Column(Integer, nullable=False, default=0)
    payload_json = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        UniqueConstraint('cache_date', 'machine_id', name='uq_vendon_daily_machine_revenue_cache_day_machine'),
        Index('idx_vendon_daily_machine_revenue_cache_date', 'cache_date'),
    )


class RemoteCreditsPreloadCache(Base):
    """Cached payload for Remote Credits autoload (top machine yesterday + its logs)."""
    __tablename__ = 'remote_credits_preload_cache'

    id = Column(Integer, primary_key=True, autoincrement=True)
    cache_date = Column(Date, nullable=False, unique=True, index=True)
    best_machine_id = Column(Text)
    best_machine_name = Column(Text)
    best_machine_count = Column(Integer, nullable=False, default=0)
    from_date = Column(Text)
    to_date = Column(Text)
    payload_json = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


def get_database_url():
    """Get database URL from environment variables"""
    db_user = os.getenv('DB_USER', 'postgres')
    db_password = os.getenv('DB_PASSWORD', 'postgres')
    db_host = os.getenv('DB_HOST', 'localhost')
    db_port = os.getenv('DB_PORT', '5432')
    db_name = os.getenv('DB_NAME', 'people_analytics')
    
    # Digital Ocean databases require SSL
    # Add SSL parameters if port is 25060 (Digital Ocean SSL port)
    # Default to 'require' for Digital Ocean, 'prefer' for local
    if db_port == '25060' or db_port == '25061':
        ssl_mode = os.getenv('DB_SSLMODE', 'require')
    else:
        ssl_mode = os.getenv('DB_SSLMODE', 'prefer')
    
    return f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?sslmode={ssl_mode}"


def create_engine_and_session():
    """Create database engine and session"""
    import logging
    logger = logging.getLogger(__name__)
    
    database_url = get_database_url()
    # Mask password in URL for logging
    safe_url = database_url.split('@')[0].split(':')[0] + ':***@' + '@'.join(database_url.split('@')[1:]) if '@' in database_url else database_url
    
    logger.info(f"Connecting to database: {safe_url}")
    
    # Add connect_args for SSL if needed (Digital Ocean)
    connect_args = {}
    db_port = os.getenv('DB_PORT', '5432')
    if db_port == '25060' or db_port == '25061':
        # Digital Ocean requires SSL
        ssl_mode = os.getenv('DB_SSLMODE', 'require')
        connect_args['sslmode'] = ssl_mode
        logger.info(f"Using SSL mode: {ssl_mode} (Digital Ocean port {db_port})")
    else:
        ssl_mode = os.getenv('DB_SSLMODE', 'prefer')
        if ssl_mode != 'prefer':
            connect_args['sslmode'] = ssl_mode
        logger.info(f"Using SSL mode: {ssl_mode} (port {db_port})")
    
    try:
        engine = create_engine(
            database_url, 
            pool_pre_ping=True,
            connect_args=connect_args,
            echo=False  # Set to True for SQL query logging
        )
        # Test connection
        with engine.connect() as conn:
            logger.info("Database connection successful")
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        return engine, SessionLocal
    except Exception as e:
        logger.error(f"Failed to create database connection: {str(e)}")
        logger.error(f"Database URL (masked): {safe_url}")
        logger.error(f"Port: {db_port}, SSL mode: {connect_args.get('sslmode', 'not set')}")
        raise


def init_database():
    """Initialize database tables"""
    engine, _ = create_engine_and_session()
    Base.metadata.create_all(bind=engine)
    return engine


