import os
import logging
import psycopg2
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_db_connection():
    try:
        database_url = os.getenv('BACKUP_DATABASE_URL')
        if not database_url:
            logger.error("BACKUP_DATABASE_URL not set")
            return None
        conn = psycopg2.connect(database_url)
        conn.autocommit = True
        return conn
    except Exception as e:
        logger.error(f"Database connection error: {e}")
        return None
