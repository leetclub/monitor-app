"""
SQLAlchemy models for dashboard tab permissions — stored in database DASHBOARD_DB_NAME
(default: monitoring_dashboard), separate from people_analytics.
"""
import os
from sqlalchemy import Boolean, Column, Integer, Text, DateTime, Date, Numeric, UniqueConstraint, Index
from sqlalchemy.sql import func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.dialects.postgresql import JSONB

Base = declarative_base()


class DashboardAccessDefault(Base):
    """Singleton row (id=1): default tab list for users not listed in dashboard_access_user."""
    __tablename__ = 'dashboard_access_default'

    id = Column(Integer, primary_key=True)
    default_tabs = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DashboardAccessUser(Base):
    """Per-email allowed tabs (Google SSO email, lowercased)."""
    __tablename__ = 'dashboard_access_user'

    email = Column(Text, primary_key=True)
    allowed_tabs = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LiveMachineConfig(Base):
    """Per-machine thresholds and contacts for Live Ops board (monitoring-app-v2)."""
    __tablename__ = 'live_machine_config'

    machine_id = Column(Text, primary_key=True)
    min_sale_interval_minutes = Column(Integer, nullable=False, default=10)
    max_hours_without_cleaning = Column(Numeric(10, 2), nullable=True)
    max_hours_without_qc = Column(Numeric(10, 2), nullable=True)
    strike_operator_email = Column(Text, nullable=True)
    daily_sales_target = Column(Numeric(14, 4), nullable=True)
    expected_shift_start = Column(Text, nullable=True)
    shift_timezone = Column(Text, nullable=True)
    shift_grace_minutes = Column(Integer, nullable=False, default=15)
    last_cleaning_at = Column(DateTime(timezone=True), nullable=True)
    last_qc_visit_at = Column(DateTime(timezone=True), nullable=True)
    red_alert_operator_name = Column(Text, nullable=True)
    exclude_cleaning_timeouts_pfa = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index('idx_live_machine_config_updated', 'updated_at'),)


class AlertMachineProfile(Base):
    """
    Per-Vendon-machine admin profile for Alert (location hours, operating days, cleaning, contacts).
    Synced to machine_cleaning_schedule on save for Red Alert cleaning-window logic.
    """

    __tablename__ = "alert_machine_profile"

    machine_id = Column(Text, primary_key=True)
    machine_name = Column(Text, nullable=True)
    location_owner = Column(Text, nullable=True)
    location_hours = Column(Text, nullable=True)
    operating_days = Column(JSONB, nullable=False)
    cleaning_windows = Column(JSONB, nullable=False)
    operator_hours = Column(JSONB, nullable=False)
    technician_schedule = Column(JSONB, nullable=False)
    qa_schedule = Column(JSONB, nullable=False)
    timezone = Column(Text, nullable=False, default="Asia/Kuwait")
    updated_by = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MachineCleaningSchedule(Base):
    """
    DC cleaning schedule: substring match on Vendon machine name (case-insensitive).
    Used by Red Alert to ignore OFF/vend/no-tx signals during scheduled cleaning windows (Asia/Kuwait).
    Source: DC Cleaning Schedule PDF (operator + location + time).
    """

    __tablename__ = "machine_cleaning_schedule"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name_pattern = Column(Text, nullable=False)
    cleaning_operator = Column(Text, nullable=False)
    timezone = Column(Text, nullable=False, default="Asia/Kuwait")
    windows = Column(JSONB, nullable=False)
    priority = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("idx_machine_cleaning_schedule_priority", "priority"),)


class RedAlertSnapshotCache(Base):
    """
    Precomputed Red Alert board payload (Vendon is slow to aggregate on each HTTP request).
    Single logical row (id=1). Updated by cron POST /api/red-alert/internal/refresh.
    """
    __tablename__ = 'red_alert_snapshot_cache'

    id = Column(Integer, primary_key=True)
    payload_json = Column(JSONB, nullable=False)
    generated_at = Column(DateTime(timezone=True), nullable=True)
    compute_error = Column(Text, nullable=True)


class MachineOperatorLive(Base):
    """
    Latest operator name inferred from Vendon WEB cashless vends (Token API /stats/vends),
    updated whenever Red Alert snapshot is recomputed. Used for live board + avoids GAS
    per-machine settingChangeLog UrlFetch for operators.
    """

    __tablename__ = 'machine_operator_live'

    machine_id = Column(Text, primary_key=True)
    operator_name = Column(Text, nullable=False)
    last_credit_ts = Column(Integer, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LiveShiftClockIn(Base):
    """Latest operator shift clock-in per machine per calendar day (in shift_timezone)."""
    __tablename__ = 'live_shift_clock_in'

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_id = Column(Text, nullable=False, index=True)
    shift_date = Column(Date, nullable=False, index=True)
    clock_in_at = Column(DateTime(timezone=True), nullable=False)
    recorded_by = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('machine_id', 'shift_date', name='uq_live_shift_machine_date'),
        Index('idx_live_shift_machine_date', 'machine_id', 'shift_date'),
    )


def get_dashboard_database_url() -> str:
    """Same host/credentials as main app; different database name."""
    db_user = os.getenv('DB_USER', 'postgres')
    db_password = os.getenv('DB_PASSWORD', 'postgres')
    db_host = os.getenv('DB_HOST', 'localhost')
    db_port = os.getenv('DB_PORT', '5432')
    db_name = os.getenv('DASHBOARD_DB_NAME', 'monitoring_dashboard')

    if db_port == '25060' or db_port == '25061':
        ssl_mode = os.getenv('DB_SSLMODE', 'require')
    else:
        ssl_mode = os.getenv('DB_SSLMODE', 'prefer')

    return f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?sslmode={ssl_mode}"


def create_dashboard_engine_and_session():
    """Engine + session factory for the dashboard permissions database only."""
    import logging
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    logger = logging.getLogger(__name__)
    database_url = get_dashboard_database_url()
    safe_url = database_url.split('@')[0].split(':')[0] + ':***@' + '@'.join(database_url.split('@')[1:]) if '@' in database_url else database_url
    logger.info(f"Dashboard access DB: {safe_url}")

    connect_args = {}
    db_port = os.getenv('DB_PORT', '5432')
    if db_port == '25060' or db_port == '25061':
        connect_args['sslmode'] = os.getenv('DB_SSLMODE', 'require')
    else:
        sm = os.getenv('DB_SSLMODE', 'prefer')
        if sm != 'prefer':
            connect_args['sslmode'] = sm

    engine = create_engine(database_url, pool_pre_ping=True, connect_args=connect_args, echo=False)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return engine, SessionLocal
