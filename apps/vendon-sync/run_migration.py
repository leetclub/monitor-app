#!/usr/bin/env python3
"""
Run database migration to add sync_type column
"""
import os
from sqlalchemy import create_engine, text

def main():
    db_user = os.getenv('DB_USER', 'doadmin')
    db_password = os.getenv('DB_PASSWORD')
    db_host = os.getenv('DB_HOST')
    db_port = os.getenv('DB_PORT', '25060')
    db_name = os.getenv('DB_NAME', 'people_analytics')
    
    if not db_password or not db_host:
        print("Error: DB_PASSWORD and DB_HOST must be set")
        return 1
    
    database_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}?sslmode=require"
    engine = create_engine(database_url)
    
    print("Running database migration...")
    
    with engine.connect() as conn:
        # Add column
        print("1. Adding sync_type column...")
        conn.execute(text("""
            ALTER TABLE sync_verification_results 
            ADD COLUMN IF NOT EXISTS sync_type VARCHAR(50)
        """))
        conn.commit()
        print("   ✅ Column added")
        
        # Create index
        print("2. Creating index...")
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_verification_sync_type 
            ON sync_verification_results(sync_type, verification_date)
        """))
        conn.commit()
        print("   ✅ Index created")
        
        # Update existing records
        print("3. Updating existing records...")
        result = conn.execute(text("""
            UPDATE sync_verification_results 
            SET sync_type = 'vendon-sync' 
            WHERE sync_type IS NULL
        """))
        conn.commit()
        updated = result.rowcount
        print(f"   ✅ Updated {updated} records")
        
        # Verify migration
        print("4. Verifying migration...")
        result = conn.execute(text("""
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN sync_type IS NOT NULL THEN 1 END) as with_type
            FROM sync_verification_results
        """))
        row = result.fetchone()
        total = row[0]
        with_type = row[1]
        
        print(f"\n📊 Migration Status:")
        print(f"   Total verification results: {total}")
        print(f"   Results with sync_type: {with_type}")
        
        if with_type == total:
            print("\n✅ Migration completed successfully!")
            return 0
        else:
            print(f"\n⚠️  Migration incomplete: {total - with_type} records without sync_type")
            return 1

if __name__ == '__main__':
    exit(main())
