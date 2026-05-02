#!/usr/bin/env python3
"""Create admin tables in database"""
import os
import sys
from sqlalchemy import create_engine, text

# Add /tmp to path for admin_models
sys.path.insert(0, '/tmp')

try:
    from admin_models import AdminUser, AlertLog, SyncVerificationResult, Base
except ImportError:
    print("Error: admin_models.py not found. Copy it to /tmp/admin_models.py first.")
    sys.exit(1)

def main():
    db_user = os.getenv('DB_USER', 'doadmin')
    db_password = os.getenv('DB_PASSWORD')
    db_host = os.getenv('DB_HOST')
    db_port = os.getenv('DB_PORT', '25060')
    db_name = os.getenv('DB_NAME', 'people_analytics')
    
    if not db_password or not db_host:
        print("Error: DB_PASSWORD and DB_HOST must be set")
        sys.exit(1)
    
    database_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?sslmode=require"
    engine = create_engine(database_url)
    
    # Create tables
    print("Creating admin tables...")
    Base.metadata.create_all(bind=engine)
    
    # Create default admin user if doesn't exist
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    
    try:
        admin_username = os.getenv('ADMIN_USERNAME', 'admin')
        admin_password = os.getenv('ADMIN_PASSWORD', 'admin123')
        
        existing = session.query(AdminUser).filter(AdminUser.username == admin_username).first()
        if not existing:
            admin_user = AdminUser(
                username=admin_username,
                password_hash=AdminUser.hash_password(admin_password),
                is_active=True
            )
            session.add(admin_user)
            session.commit()
            print(f"✅ Created default admin user: {admin_username}")
        else:
            print(f"✅ Admin user already exists: {admin_username}")
        
        print("✅ Admin tables created successfully")
    except Exception as e:
        print(f"Error: {str(e)}")
        session.rollback()
        sys.exit(1)
    finally:
        session.close()

if __name__ == '__main__':
    main()
