"""
Database models for Admin Panel
"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Index
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import hashlib
import secrets

Base = declarative_base()


class AdminUser(Base):
    """Admin user model"""
    __tablename__ = 'admin_users'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)  # SHA256 hash
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Hash password using SHA256"""
        return hashlib.sha256(password.encode()).hexdigest()
    
    def verify_password(self, password: str) -> bool:
        """Verify password against hash"""
        return self.password_hash == self.hash_password(password)


class AlertLog(Base):
    """Alert/Log entry model"""
    __tablename__ = 'alert_logs'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    level = Column(String(20), nullable=False, index=True)  # info, warning, error, critical
    source = Column(String(100), nullable=False, index=True)  # sync, verify, api, etc.
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    details = Column(Text, nullable=True)  # JSON string for additional data
    is_resolved = Column(Boolean, default=False, index=True)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    __table_args__ = (
        Index('idx_alert_level_created', 'level', 'created_at'),
        Index('idx_alert_source_created', 'source', 'created_at'),
        Index('idx_alert_unresolved', 'is_resolved', 'created_at'),
    )


class SyncVerificationResult(Base):
    """Sync verification result model"""
    __tablename__ = 'sync_verification_results'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    sync_date = Column(DateTime, nullable=False, index=True)
    verification_date = Column(DateTime, default=datetime.utcnow, index=True)
    status = Column(String(20), nullable=False, index=True)  # passed, failed, warning
    sync_type = Column(String(50), nullable=True, index=True)  # vendon-sync, people-analytics-sync, historical-performance-sync
    date_check = Column(Boolean, default=False)
    sync_logs_check = Column(Boolean, default=False)
    data_completeness_check = Column(Boolean, default=False)
    api_verification_check = Column(Boolean, default=False)
    summary = Column(Text, nullable=True)
    errors = Column(Text, nullable=True)  # JSON string for errors
    warnings = Column(Text, nullable=True)  # JSON string for warnings
    machine_count = Column(Integer, default=0)
    total_revenue = Column(String(50), nullable=True)
    total_transactions = Column(Integer, default=0)
    
    __table_args__ = (
        Index('idx_verification_date_status', 'sync_date', 'status'),
        Index('idx_verification_sync_type', 'sync_type', 'verification_date'),
    )
