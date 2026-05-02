"""
Initialize database tables
"""
import os
from dotenv import load_dotenv
from models import init_database

# Load environment variables
load_dotenv()

if __name__ == '__main__':
    print("Initializing database...")
    engine = init_database()
    print("Database initialized successfully!")
    print(f"Database URL: {os.getenv('DB_HOST', 'localhost')}:{os.getenv('DB_PORT', '5432')}/{os.getenv('DB_NAME', 'people_analytics')}")


