import os
from flask import Flask, render_template, request, jsonify, Response
import logging
import traceback
from .db import (
    get_db_connection,
    init_movie_tables,
    add_movie,
    get_user_movies,
    update_movie_elo,
    update_elo_pair,
    delete_movie,
    create_user,
    verify_user,
    get_all_users,
    delete_user,
    update_user_password,
    admin_update_movie,
    rescale_all_elos,
    MIN_ELO,
    MAX_ELO,
)
import base64

ADMIN_USER = os.getenv('ADMIN_USER', 'admin')
ADMIN_PASS = os.getenv('ADMIN_PASS', 'adminpass')

# Configure more detailed logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__, template_folder='../templates', static_folder='../static')


def _get_basic_auth_credentials():
    """Extract basic auth credentials from the request."""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Basic '):
        return None, None
    try:
        decoded = base64.b64decode(auth_header.split(' ', 1)[1]).decode('utf-8')
        user, password = decoded.split(':', 1)
        return user, password
    except Exception:
        return None, None


def _require_auth(expected_user=None):
    user, password = _get_basic_auth_credentials()
    if not user or not password:
        return False
    if expected_user and user != expected_user:
        return False
    return verify_user(user, password)

def _require_admin():
    user, password = _get_basic_auth_credentials()
    return user == ADMIN_USER and password == ADMIN_PASS

@app.route('/')
def index():
    """Renders the main movie ratings page."""
    try:
        return render_template('index.html')
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error rendering index page: {e}\n{error_details}")
        return "An error occurred loading the page. Please check server logs.", 500


@app.route('/admin')
def admin_page():
    if not _require_admin():
        return Response('Unauthorized', 401, {'WWW-Authenticate': 'Basic realm="Admin"'})
    return render_template('admin.html')


@app.route('/register', methods=['POST'])
def register():
    """Create a new user account."""
    try:
        data = request.get_json()
        if not data or 'user_name' not in data or 'password' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        if create_user(data['user_name'], data['password']):
            return jsonify({'status': 'success'})
        return jsonify({'error': 'User already exists or could not be created'}), 400
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error registering user: {e}\n{error_details}")
        return jsonify({'error': 'Failed to register user'}), 500


@app.route('/login', methods=['POST'])
def login():
    """Verify user credentials."""
    try:
        data = request.get_json()
        if not data or 'user_name' not in data or 'password' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        if verify_user(data['user_name'], data['password']):
            return jsonify({'status': 'success'})
        return jsonify({'error': 'Invalid credentials'}), 401
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error logging in: {e}\n{error_details}")
        return jsonify({'error': 'Login failed'}), 500


@app.route('/api/users')
def list_users():
    """Return a list of all user names."""
    try:
        users = get_all_users()
        return jsonify(users)
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error fetching users: {e}\n{error_details}")
        return jsonify({'error': 'Failed to fetch users'}), 500


@app.route('/admin/api/users')
def admin_list_users():
    if not _require_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    return jsonify(get_all_users())


@app.route('/admin/api/users/<user_name>', methods=['DELETE', 'PUT'])
def admin_modify_user(user_name):
    if not _require_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    if request.method == 'DELETE':
        if delete_user(user_name):
            return jsonify({'status': 'success'})
        return jsonify({'error': 'User not found'}), 404
    else:
        data = request.get_json()
        if not data or 'password' not in data:
            return jsonify({'error': 'Missing password'}), 400
        if update_user_password(user_name, data['password']):
            return jsonify({'status': 'success'})
        return jsonify({'error': 'Failed to update password'}), 400

@app.route('/api/movies', methods=['GET'])
def get_movies():
    """Get movies for a user, optionally filtered by category."""
    try:
        user_name = request.args.get('user', 'Jack')
        category = request.args.get('category')
        
        movies = get_user_movies(user_name, category)
        return jsonify(movies)
        
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error getting movies: {e}\n{error_details}")
        return jsonify({"error": "Failed to fetch movies"}), 500

@app.route('/api/movies', methods=['POST'])
def create_movie():
    """Add a new movie."""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "Invalid request body"}), 400
            
        user_name = data.get('user_name')
        movie_title = data.get('movie_title')
        initial_rating = data.get('initial_rating')

        if not _require_auth(user_name):
            return jsonify({'error': 'Unauthorized'}), 401
        
        # Validation
        if not user_name or not movie_title or not initial_rating:
            return jsonify({"error": "Missing required fields"}), 400
            
        if initial_rating not in ['thumbs_down', 'okay', 'thumbs_up']:
            return jsonify({"error": "Invalid initial_rating"}), 400
            
        # Add movie
        movie = add_movie(user_name, movie_title, initial_rating)
        
        if movie:
            return jsonify({"status": "success", "movie": movie}), 201
        else:
            return jsonify({"error": "Movie already exists or could not be added"}), 400
            
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error creating movie: {e}\n{error_details}")
        return jsonify({"error": "Failed to create movie"}), 500

@app.route('/api/movies/<int:movie_id>', methods=['PUT'])
def update_movie(movie_id):
    """Update a movie's ELO rating."""
    try:
        if not _require_auth():
            return jsonify({'error': 'Unauthorized'}), 401
        data = request.get_json()
        
        if not data or 'elo_rating' not in data:
            return jsonify({"error": "Missing elo_rating"}), 400
            
        elo_rating = data['elo_rating']
        
        # Validate ELO range
        if not isinstance(elo_rating, (int, float)) or elo_rating < MIN_ELO or elo_rating > MAX_ELO:
            return jsonify({"error": f"Invalid elo_rating (must be {MIN_ELO}-{MAX_ELO})"}), 400
            
        success = update_movie_elo(movie_id, int(elo_rating))
        
        if success:
            return jsonify({"status": "success"})
        else:
            return jsonify({"error": "Failed to update movie"}), 400
            
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error updating movie: {e}\n{error_details}")
        return jsonify({"error": "Failed to update movie"}), 500


@app.route('/admin/api/movies/<int:movie_id>', methods=['PUT'])
def admin_edit_movie(movie_id):
    if not _require_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json() or {}
    if admin_update_movie(movie_id, **data):
        return jsonify({'status': 'success'})
    return jsonify({'error': 'Failed to update movie'}), 400


@app.route('/admin/api/rescale_elos', methods=['POST'])
def admin_rescale_elos():
    if not _require_admin():
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        rescale_all_elos()
        return jsonify({'status': 'success'})
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error rescaling elos: {e}\n{error_details}")
        return jsonify({'error': 'Failed to rescale elos'}), 500

@app.route('/api/compare', methods=['POST'])
def compare_movies():
    """Compare two movies and update their ELO ratings."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid request body"}), 400

        movie_a_id = data.get("movie_a_id")
        movie_b_id = data.get("movie_b_id")
        result = data.get("result")

        if not all([movie_a_id, movie_b_id, result]):
            return jsonify({"error": "Missing required fields"}), 400

        update_result = update_elo_pair(int(movie_a_id), int(movie_b_id), result)
        if update_result:
            return jsonify({"status": "success", **update_result})
        else:
            return jsonify({"error": "Failed to update ratings"}), 400

    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error comparing movies: {e}\n{error_details}")
        return jsonify({"error": "Comparison failed"}), 500

@app.route('/api/movies/<int:movie_id>', methods=['DELETE'])
def delete_movie_endpoint(movie_id):
    """Delete a movie."""
    try:
        if not _require_auth():
            return jsonify({'error': 'Unauthorized'}), 401
        success = delete_movie(movie_id)
        
        if success:
            return jsonify({"status": "success"})
        else:
            return jsonify({"error": "Movie not found"}), 404
            
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error deleting movie: {e}\n{error_details}")
        return jsonify({"error": "Failed to delete movie"}), 500

@app.route('/init-movie-database')
def init_database():
    """Initialize the movie ratings database tables."""
    try:
        success = init_movie_tables()
        
        if success:
            return jsonify({
                "status": "success",
                "message": "Movie ratings table initialized successfully"
            })
        else:
            return jsonify({
                "status": "error",
                "message": "Failed to initialize movie tables"
            }), 500
            
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Database initialization failed: {e}\n{error_details}")
        return jsonify({
            "status": "error",
            "message": "Database initialization failed",
            "error": str(e)
        }), 500

@app.route('/tests')
def tests():
    """Renders the test page."""
    try:
        return render_template('tests.html')
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error rendering tests page: {e}\n{error_details}")
        return "An error occurred loading the tests page.", 500


@app.route('/database-status')
def database_status():
    """Check database connectivity and table status."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"status": "error", "message": "Connection failed"}), 500
        
    try:
        with conn.cursor() as cursor:
            # Check if movie_ratings table exists
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'movie_ratings'
                )
                """
            )
            movie_table_exists = cursor.fetchone()[0]

            # Check if users table exists
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'users'
                )
                """
            )
            user_table_exists = cursor.fetchone()[0]
            
            movie_count = 0
            if movie_table_exists:
                cursor.execute("SELECT COUNT(*) FROM movie_ratings")
                movie_count = cursor.fetchone()[0]
            
            return jsonify({
                "status": "connected",
                "movie_table_exists": movie_table_exists,
                "user_table_exists": user_table_exists,
                "movie_count": movie_count,
                "message": "Database connection successful"
            })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Database error: {str(e)}"
        }), 500
    finally:
        conn.close()

# This is needed if running locally with `python api/index.py`
if __name__ == '__main__':
    # Make sure debug=False for production environments
    debug_mode = os.getenv('FLASK_ENV') == 'development'
    logger.info(f"Starting Flask app in {'debug' if debug_mode else 'production'} mode")
    app.run(debug=debug_mode, port=5000)
