import os
import logging
import traceback
import psycopg2
import psycopg2.extras
from werkzeug.security import generate_password_hash, check_password_hash
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

# Constants for movie ratings
# Default starting Elo values when a movie is added.
INITIAL_ELO_VALUES = {
    'thumbs_down': 2000,
    'okay': 3000,
    'thumbs_up': 4000,
}

# Absolute Elo bounds used throughout the application
MIN_ELO = 0
MAX_ELO = 5000

# Modifier for how steeply rating differences impact the win probability.
# A larger scale spreads ratings out by making mismatches less decisive.
ELO_SCALE = 1000

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

def init_user_table():
    """Create the users table if it doesn't exist."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    user_name VARCHAR(50) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL
                )
                """
            )
        logger.info("Users table initialized successfully")
        return True
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error initializing users table: {e}\n{error_details}")
        return False
    finally:
        conn.close()

def create_user(user_name, password):
    """Create a new user with hashed password."""
    if not init_user_table():
        logger.error("Failed to initialize users table before creating user")
        return False
    conn = get_db_connection()
    if not conn:
        return False
    try:
        with conn.cursor() as cursor:
            password_hash = generate_password_hash(password)
            cursor.execute(
                "INSERT INTO users (user_name, password_hash) VALUES (%s, %s)",
                (user_name, password_hash),
            )
        return True
    except psycopg2.IntegrityError:
        logger.error(f"User already exists: {user_name}")
        return False
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error creating user: {e}\n{error_details}")
        return False
    finally:
        conn.close()

def verify_user(user_name, password):
    """Verify a user's credentials."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT password_hash FROM users WHERE user_name = %s",
                (user_name,),
            )
            row = cursor.fetchone()
            if row and check_password_hash(row[0], password):
                return True
            return False
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error verifying user: {e}\n{error_details}")
        return False
    finally:
        conn.close()


def get_all_users():
    """Fetch a list of all user names."""
    conn = get_db_connection()
    if not conn:
        return []
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT user_name FROM users ORDER BY user_name")
            rows = cursor.fetchall()
            return [row[0] for row in rows]
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error fetching users: {e}\n{error_details}")
        return []
    finally:
        conn.close()


def init_movie_tables():
    """Initialize the movie ratings table."""
    # Ensure the users table exists first
    init_user_table()
    conn = get_db_connection()
    if not conn:
        return False
        
    try:
        with conn.cursor() as cursor:
            # Create the movie_ratings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS movie_ratings (
                    id SERIAL PRIMARY KEY,
                    user_name VARCHAR(50) NOT NULL,
                    movie_title VARCHAR(255) NOT NULL,
                    elo_rating INTEGER NOT NULL DEFAULT 2500,
                    initial_rating VARCHAR(20) NOT NULL CHECK (initial_rating IN ('thumbs_down', 'okay', 'thumbs_up')),
                    rank_position INTEGER,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_name, movie_title)
                )
            """)
            
            # Create indexes for better query performance
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_movie_ratings_user 
                ON movie_ratings(user_name)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_movie_ratings_elo 
                ON movie_ratings(user_name, elo_rating DESC)
            """)
            
            logger.info("Movie ratings table initialized successfully")
            return True
            
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error initializing movie tables: {e}\n{error_details}")
        return False
    finally:
        conn.close()

def add_movie(user_name, movie_title, initial_rating):
    """Add a new movie with initial rating."""
    if initial_rating not in INITIAL_ELO_VALUES:
        logger.error(f"Invalid initial_rating: {initial_rating}")
        return None
        
    conn = get_db_connection()
    if not conn:
        return None
        
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cursor:
            # Get initial ELO based on rating
            initial_elo = INITIAL_ELO_VALUES[initial_rating]
            
            # Insert the movie
            cursor.execute("""
                INSERT INTO movie_ratings (user_name, movie_title, elo_rating, initial_rating)
                VALUES (%s, %s, %s, %s)
                RETURNING id, user_name, movie_title, elo_rating, initial_rating, created_at
            """, (user_name, movie_title, initial_elo, initial_rating))
            
            movie = dict(cursor.fetchone())
            
            # Update rank positions for this user
            update_rank_positions(user_name)
            
            logger.info(f"Added movie: {movie_title} for user: {user_name}")
            return movie
            
    except psycopg2.IntegrityError:
        logger.error(f"Movie already exists: {movie_title} for user: {user_name}")
        return None
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error adding movie: {e}\n{error_details}")
        return None
    finally:
        conn.close()

def get_user_movies(user_name, category=None):
    """Get all movies for a user, optionally filtered by category."""
    conn = get_db_connection()
    if not conn:
        return []
        
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cursor:
            if category:
                cursor.execute("""
                    SELECT id, user_name, movie_title, elo_rating, initial_rating, 
                           rank_position, created_at, updated_at
                    FROM movie_ratings
                    WHERE user_name = %s AND initial_rating = %s
                    ORDER BY elo_rating DESC
                """, (user_name, category))
            else:
                cursor.execute("""
                    SELECT id, user_name, movie_title, elo_rating, initial_rating, 
                           rank_position, created_at, updated_at
                    FROM movie_ratings
                    WHERE user_name = %s
                    ORDER BY elo_rating DESC
                """, (user_name,))
            
            movies = [dict(row) for row in cursor.fetchall()]
            return movies
            
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error getting user movies: {e}\n{error_details}")
        return []
    finally:
        conn.close()

def update_movie_elo(movie_id, new_elo):
    """Update a movie's ELO rating."""
    new_elo = max(MIN_ELO, min(MAX_ELO, int(new_elo)))
    conn = get_db_connection()
    if not conn:
        return False
        
    try:
        with conn.cursor() as cursor:
            # Update the ELO rating
            cursor.execute("""
                UPDATE movie_ratings
                SET elo_rating = %s, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (new_elo, movie_id))
            
            # Get the user_name to update ranks
            cursor.execute("SELECT user_name FROM movie_ratings WHERE id = %s", (movie_id,))
            result = cursor.fetchone()
            
            if result:
                update_rank_positions(result[0])
                
            logger.info(f"Updated movie {movie_id} ELO to {new_elo}")
            return True
            
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error updating movie ELO: {e}\n{error_details}")
        return False
    finally:
        conn.close()

def update_elo_pair(movie_a_id, movie_b_id, result, k_factor=64):
    """Update ELO ratings for two movies based on comparison result.

    Args:
        movie_a_id (int): ID for movie A (the first movie).
        movie_b_id (int): ID for movie B (the second movie).
        result (str): 'a', 'b', or 'equal' indicating which movie won.
        k_factor (int, optional): K-factor for ELO calculations. Defaults to 64.

    Returns:
        dict or None: Dictionary with new ratings if successful, else None.
    """

    if result not in {'a', 'b', 'equal'}:
        logger.error(f"Invalid comparison result: {result}")
        return None

    conn = get_db_connection()
    if not conn:
        return None

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cursor:
            cursor.execute(
                "SELECT id, user_name, elo_rating FROM movie_ratings WHERE id IN (%s, %s)",
                (movie_a_id, movie_b_id),
            )
            rows = cursor.fetchall()
            if len(rows) != 2:
                logger.error("One or both movie IDs not found for comparison")
                return None

            # Map rows by id for easy lookup
            movies = {row[0]: dict(row) for row in rows}
            movie_a = movies.get(movie_a_id)
            movie_b = movies.get(movie_b_id)

            elo_a = movie_a["elo_rating"]
            elo_b = movie_b["elo_rating"]

            expected_a = 1 / (1 + 10 ** ((elo_b - elo_a) / ELO_SCALE))
            expected_b = 1 / (1 + 10 ** ((elo_a - elo_b) / ELO_SCALE))

            score_a = 0.5
            score_b = 0.5
            if result == "a":
                score_a, score_b = 1, 0
            elif result == "b":
                score_a, score_b = 0, 1

            new_elo_a = round(elo_a + k_factor * (score_a - expected_a))
            new_elo_b = round(elo_b + k_factor * (score_b - expected_b))

            new_elo_a = max(MIN_ELO, min(MAX_ELO, new_elo_a))
            new_elo_b = max(MIN_ELO, min(MAX_ELO, new_elo_b))

            # Update both ratings
            cursor.execute(
                "UPDATE movie_ratings SET elo_rating=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
                (new_elo_a, movie_a_id),
            )
            cursor.execute(
                "UPDATE movie_ratings SET elo_rating=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
                (new_elo_b, movie_b_id),
            )

            # Update rank positions for affected users
            affected_users = {movie_a["user_name"], movie_b["user_name"]}
            for user in affected_users:
                update_rank_positions(user)

            logger.info(
                f"Updated ELOs - Movie {movie_a_id}: {elo_a}->{new_elo_a}, Movie {movie_b_id}: {elo_b}->{new_elo_b}"
            )

            return {
                "movie_a_id": movie_a_id,
                "movie_b_id": movie_b_id,
                "movie_a_rating": new_elo_a,
                "movie_b_rating": new_elo_b,
            }

    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error updating ELO pair: {e}\n{error_details}")
        return None
    finally:
        conn.close()

def update_rank_positions(user_name):
    """Update rank positions for all movies of a user based on ELO."""
    conn = get_db_connection()
    if not conn:
        return
        
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                WITH ranked AS (
                    SELECT id, ROW_NUMBER() OVER (ORDER BY elo_rating DESC) as new_rank
                    FROM movie_ratings
                    WHERE user_name = %s
                )
                UPDATE movie_ratings
                SET rank_position = ranked.new_rank
                FROM ranked
                WHERE movie_ratings.id = ranked.id
            """, (user_name,))
            
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error updating rank positions: {e}\n{error_details}")
    finally:
        conn.close()

def delete_movie(movie_id):
    """Delete a movie."""
    conn = get_db_connection()
    if not conn:
        return False
        
    try:
        with conn.cursor() as cursor:
            # Get user_name before deletion
            cursor.execute("SELECT user_name FROM movie_ratings WHERE id = %s", (movie_id,))
            result = cursor.fetchone()
            
            if result:
                user_name = result[0]
                
                # Delete the movie
                cursor.execute("DELETE FROM movie_ratings WHERE id = %s", (movie_id,))
                
                # Update rank positions
                update_rank_positions(user_name)
                
                logger.info(f"Deleted movie {movie_id}")
                return True
            
            return False
            
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error deleting movie: {e}\n{error_details}")
        return False
    finally:
        conn.close()

def delete_user(user_name):
    """Delete a user and all of their movies."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        with conn.cursor() as cursor:
            cursor.execute("DELETE FROM movie_ratings WHERE user_name = %s", (user_name,))
            cursor.execute("DELETE FROM users WHERE user_name = %s", (user_name,))
        return True
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error deleting user: {e}\n{error_details}")
        return False
    finally:
        conn.close()


def update_user_password(user_name, new_password):
    """Update a user's password."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        with conn.cursor() as cursor:
            password_hash = generate_password_hash(new_password)
            cursor.execute(
                "UPDATE users SET password_hash=%s WHERE user_name=%s",
                (password_hash, user_name),
            )
        return True
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error updating password: {e}\n{error_details}")
        return False
    finally:
        conn.close()


def admin_update_movie(movie_id, **fields):
    """Admin update of movie title or category."""
    allowed = {'movie_title', 'initial_rating'}
    sets = []
    values = []
    for key, val in fields.items():
        if key in allowed:
            sets.append(f"{key} = %s")
            values.append(val)
    if not sets:
        return False
    conn = get_db_connection()
    if not conn:
        return False
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                f"UPDATE movie_ratings SET {', '.join(sets)}, updated_at=CURRENT_TIMESTAMP WHERE id = %s",
                (*values, movie_id)
            )
        return True
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error updating movie: {e}\n{error_details}")
        return False
    finally:
        conn.close()


def rescale_user_elos(user_name):
    """Rescale a user's movie ELOs using a piecewise linear transform."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cursor:
            cursor.execute(
                "SELECT id, elo_rating FROM movie_ratings WHERE user_name=%s ORDER BY elo_rating",
                (user_name,),
            )
            rows = cursor.fetchall()
            if not rows:
                return True

            elos = [row["elo_rating"] for row in rows]
            min_elo = min(elos)
            max_elo = max(elos)
            mid_index = len(elos) // 2
            if len(elos) % 2:
                median = sorted(elos)[mid_index]
            else:
                ordered = sorted(elos)
                median = (ordered[mid_index - 1] + ordered[mid_index]) / 2

            updates = []
            for row in rows:
                rating = row["elo_rating"]
                if rating <= median:
                    if median == min_elo:
                        new_rating = MIN_ELO
                    else:
                        ratio = (rating - min_elo) / (median - min_elo)
                        new_rating = MIN_ELO + ratio * (3000 - MIN_ELO)
                else:
                    if max_elo == median:
                        new_rating = MAX_ELO
                    else:
                        ratio = (rating - median) / (max_elo - median)
                        new_rating = 3000 + ratio * (MAX_ELO - 3000)

                new_rating = max(MIN_ELO, min(MAX_ELO, round(new_rating)))
                updates.append((new_rating, row["id"]))

            psycopg2.extras.execute_batch(
                cursor,
                "UPDATE movie_ratings SET elo_rating=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
                updates,
            )

        update_rank_positions(user_name)
        return True
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error rescaling ELOs for {user_name}: {e}\n{error_details}")
        return False
    finally:
        conn.close()


def rescale_all_elos():
    """Rescale ELOs for all users."""
    for user in get_all_users():
        rescale_user_elos(user)
    return True
