import os
import logging
import traceback
import psycopg2
import psycopg2.extras
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file (when running locally)
load_dotenv()

# Configure enhanced logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Constants
VALID_PREFERENCE_TYPES = ['prefer_not', 'no']
VALID_USERS = ['Jack', 'Payton', 'Nick', 'Alyssa']

def get_db_connection():
    """Create a connection to the database."""
    try:
        # Get the DATABASE_URL from environment variables
        database_url = os.getenv('DATABASE_URL')
        if not database_url:
            logger.error("DATABASE_URL environment variable not set")
            return None
            
        # Connect to the database
        logger.info("Connecting to database")
        conn = psycopg2.connect(database_url)
        conn.autocommit = True
        return conn
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Database connection error: {e}\n{error_details}")
        return None

def get_preferences():
    """Fetch all preferences from the database."""
    conn = get_db_connection()
    if not conn:
        logger.error("Failed to get database connection")
        return []
        
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cursor:
            cursor.execute("""
                SELECT user_name, event_date, preference_type 
                FROM preferences 
                ORDER BY event_date, user_name
            """)
            results = [dict(row) for row in cursor.fetchall()]
            
            # Convert date objects to strings for JSON serialization
            for row in results:
                row['event_date'] = row['event_date'].strftime('%Y-%m-%d')
                
            logger.info(f"Successfully retrieved {len(results)} preferences")
            return results
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error fetching preferences: {e}\n{error_details}")
        return []
    finally:
        conn.close()

def save_preference(user_name, event_date_str, preference_type):
    """Save or update a preference in the database."""
    # Validate inputs before attempting database operation
    if not user_name or user_name not in VALID_USERS:
        logger.error(f"Invalid user_name: {user_name}")
        return False
        
    if not event_date_str:
        logger.error("Missing event_date")
        return False
        
    if preference_type not in VALID_PREFERENCE_TYPES:
        logger.error(f"Invalid preference_type: {preference_type}. Must be one of: {VALID_PREFERENCE_TYPES}")
        return False
    
    # Convert date string to proper date format
    try:
        event_date = datetime.strptime(event_date_str, '%Y-%m-%d').date()
        logger.info(f"Parsed date: {event_date}")
    except ValueError as e:
        logger.error(f"Invalid date format: {event_date_str}. Error: {e}")
        return False
    
    conn = get_db_connection()
    if not conn:
        logger.error("Failed to get database connection")
        return False
        
    try:
        with conn.cursor() as cursor:
            # First try to delete any existing preference for this user and date
            logger.info(f"Deleting existing preference for user={user_name}, date={event_date}")
            cursor.execute("""
                DELETE FROM preferences
                WHERE user_name = %s AND event_date = %s
            """, (user_name, event_date))
            
            # Then insert the new preference
            logger.info(f"Inserting new preference: user={user_name}, date={event_date}, preference={preference_type}")
            cursor.execute("""
                INSERT INTO preferences (user_name, event_date, preference_type)
                VALUES (%s, %s, %s)
            """, (user_name, event_date, preference_type))
            
            logger.info("Preference saved successfully")
            return True
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error saving preference: {e}\n{error_details}")
        return False
    finally:
        conn.close()

def delete_preference(user_name, event_date_str):
    """Delete a preference from the database."""
    # Validate inputs
    if not user_name or not event_date_str:
        logger.error(f"Missing required parameters: user_name={user_name}, event_date={event_date_str}")
        return False
    
    # Convert date string to proper date format
    try:
        event_date = datetime.strptime(event_date_str, '%Y-%m-%d').date()
        logger.info(f"Parsed date: {event_date}")
    except ValueError as e:
        logger.error(f"Invalid date format: {event_date_str}. Error: {e}")
        return False
    
    conn = get_db_connection()
    if not conn:
        logger.error("Failed to get database connection")
        return False
        
    try:
        with conn.cursor() as cursor:
            logger.info(f"Deleting preference: user={user_name}, date={event_date}")
            cursor.execute("""
                DELETE FROM preferences
                WHERE user_name = %s AND event_date = %s
            """, (user_name, event_date))
            
            # Return True if a row was deleted
            rows_affected = cursor.rowcount
            logger.info(f"Deleted {rows_affected} preferences")
            return rows_affected > 0
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error deleting preference: {e}\n{error_details}")
        return False
    finally:
        conn.close()