"""
Database models for Historical Performance data caching
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Index, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()


class HistoricalPerformanceRecord(Base):
    """Model for storing historical performance data (aggregated by machine and date range)"""
    __tablename__ = 'historical_performance_records'

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(String(100), nullable=False, index=True)
    machine_name = Column(String(255))
    start_date = Column(DateTime, nullable=False, index=True)
    end_date = Column(DateTime, nullable=False, index=True)
    total_revenue = Column(Float, default=0.0)
    total_quantity = Column(Integer, default=0)
    product_breakdown = Column(Text)  # JSON string of product revenue/quantity
    top_products = Column(Text)  # JSON string of top 10 products
    bottom_products = Column(Text)  # JSON string of bottom 10 products
    raw_vends_count = Column(Integer, default=0)  # Number of vends processed
    created_at = Column(DateTime, default=datetime.utcnow)
    synced_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index('idx_machine_date_range', 'machine_id', 'start_date', 'end_date'),
        Index('idx_start_date', 'start_date'),
        Index('idx_end_date', 'end_date'),
        Index('idx_synced_at_historical', 'synced_at'),
        UniqueConstraint('machine_id', 'start_date', 'end_date', name='uq_machine_date_range'),
    )


class HistoricalPerformanceSyncLog(Base):
    """Model for tracking historical performance sync operations"""
    __tablename__ = 'historical_performance_sync_logs'

    id = Column(Integer, primary_key=True, autoincrement=True)
    sync_started_at = Column(DateTime, default=datetime.utcnow, index=True)
    sync_completed_at = Column(DateTime)
    status = Column(String(50))
    records_synced = Column(Integer, default=0)
    error_message = Column(Text)
    machines_processed = Column(Text)


def create_engine_and_session():
    """Create database engine and session"""
    import os
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    db_host = os.getenv('DB_HOST')
    db_port = os.getenv('DB_PORT', '5432')
    db_name = os.getenv('DB_NAME')
    db_user = os.getenv('DB_USER')
    db_password = os.getenv('DB_PASSWORD')

    if not all([db_host, db_name, db_user, db_password]):
        raise ValueError("Missing required database environment variables")

    connection_string = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
    engine = create_engine(connection_string, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)
    return engine, Session


def init_database(engine):
    """Initialize database tables"""
    Base.metadata.create_all(engine)

