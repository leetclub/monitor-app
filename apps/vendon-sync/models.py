"""
Database models for Vendon Sales data storage
"""
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, Index, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os

Base = declarative_base()


class VendonSalesRecord(Base):
    """Model for storing Vendon sales data (daily revenue per machine)"""
    __tablename__ = 'vendon_sales_records'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    
    # Machine information
    machine_id = Column(String(100), nullable=False, index=True)
    machine_name = Column(String(255))  # Optional: cached machine name
    
    # Date information (stored as date, not datetime)
    sale_date = Column(DateTime, nullable=False, index=True)  # Date only (time set to 00:00:00)
    
    # Sales metrics
    total_revenue = Column(Float, default=0.0)
    total_transactions = Column(Integer, default=0)
    
    # Raw data storage (JSON string of all vends for this day)
    raw_vends = Column(Text)  # JSON array of vend records
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    synced_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Indexes and unique constraints
    __table_args__ = (
        Index('idx_machine_date', 'machine_id', 'sale_date'),
        Index('idx_sale_date', 'sale_date'),
        # Unique constraint to prevent duplicate records for same machine/date
        UniqueConstraint('machine_id', 'sale_date', name='uq_machine_date'),
    )


class VendonSyncLog(Base):
    """Model for tracking Vendon sync operations"""
    __tablename__ = 'vendon_sync_logs'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    sync_started_at = Column(DateTime, default=datetime.utcnow, index=True)
    sync_completed_at = Column(DateTime)
    status = Column(String(50))  # 'success', 'failed', 'partial'
    records_synced = Column(Integer, default=0)
    error_message = Column(Text)
    machines_processed = Column(Text)  # JSON array of processed machine IDs


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



