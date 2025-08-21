import os
from flask import Flask, render_template, request, jsonify
import calendar
from datetime import date, datetime
import logging
import traceback
from .db import get_preferences, save_preference, delete_preference, get_db_connection

# Configure more detailed logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__, template_folder='../templates', static_folder='../static')

# --- Mount under /camping while keeping route decorators unchanged ---
PREFIX = os.getenv("URL_PREFIX", "/camping").rstrip("/")

class PrefixMiddleware:
    def __init__(self, app, prefix=""):
        self.app = app
        self.prefix = prefix
    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "")
        if self.prefix and path.startswith(self.prefix):
            environ["SCRIPT_NAME"] = self.prefix
            environ["PATH_INFO"] = path[len(self.prefix):] or "/"
        return self.app(environ, start_response)

if PREFIX:
    app.wsgi_app = PrefixMiddleware(app.wsgi_app, PREFIX)
# -------------------------------------------------------------------

# Define users and months
USERS = ["Jack", "Payton", "Nick", "Alyssa"]
MONTHS_YEAR = [(2025, m) for m in range(5, 9)]  # May to August 2025
VALID_PREFERENCES = ['prefer_not', 'no', 'clear']

def get_calendar_data(year, month):
    """Generates calendar data for a given month and year."""
    try:
        calendar.setfirstweekday(6)  # 6 is Sunday
        month_calendar = calendar.monthcalendar(year, month)
        month_name = calendar.month_name[month]
        days = [day for week in month_calendar for day in week if day != 0]
        return {
            "year": year,
            "month": month,
            "month_name": month_name,
            "days": days,
            "calendar_grid": month_calendar
        }
    except Exception as e:
        logger.error(f"Error generating calendar data: {e}")
        return None

def process_preferences(raw_preferences):
    """Processes raw db preferences into a nested dict for easier template lookup."""
    processed = {}
    try:
        for pref in raw_preferences:
            event_date = pref['event_date']
            user = pref['user_name']
            ptype = pref['preference_type']
            if event_date not in processed:
                processed[event_date] = {}
            processed[event_date][user] = ptype
    except Exception as e:
        logger.error(f"Error processing preferences: {e}")
    return processed

def validate_date_format(date_str):
    """Validate date string is in YYYY-MM-DD format."""
    try:
        datetime.strptime(date_str, '%Y-%m-%d')
        return True
    except ValueError:
        return False

@app.route('/')
def index():
    """Renders the main calendar page."""
    try:
        raw_prefs = get_preferences()
        processed_prefs = process_preferences(raw_prefs)
        calendar_months_data = [get_calendar_data(y, m) for y, m in MONTHS_YEAR]
        return render_template(
            'index.html',
            users=USERS,
            preferences=processed_prefs,
            calendar_months=calendar_months_data
        )
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error rendering index page: {e}\n{error_details}")
        return "An error occurred loading the page. Please check server logs.", 500

@app.route('/api/preferences', methods=['POST'])
def update_preferences():
    """API endpoint to save or delete preferences."""
    data = request.get_json()
    if not data:
        logger.warning("Invalid request body - empty or not JSON")
        return jsonify({"status": "error", "message": "Invalid request body"}), 400

    user_name = data.get('user_name')
    event_date_str = data.get('event_date')
    preference_type = data.get('preference_type')
    logger.info(f"Preference update request: user={user_name}, date={event_date_str}, pref={preference_type}")

    if not user_name:
        return jsonify({"status": "error", "message": "Missing user_name"}), 400
    if user_name not in USERS:
        return jsonify({"status": "error", "message": f"Invalid user_name. Must be one of: {', '.join(USERS)}"}), 400
    if not event_date_str:
        return jsonify({"status": "error", "message": "Missing event_date"}), 400
    if not validate_date_format(event_date_str):
        return jsonify({"status": "error", "message": "Invalid date format. Use YYYY-MM-DD"}), 400
    if preference_type not in VALID_PREFERENCES:
        return jsonify({"status": "error", "message": f"Invalid preference_type. Must be one of: {', '.join(VALID_PREFERENCES)}"}), 400

    try:
        if preference_type == 'clear':
            success = delete_preference(user_name, event_date_str)
            if success:
                logger.info(f"Cleared preference: {user_name}, {event_date_str}")
                return jsonify({"status": "success", "message": "Preference cleared"})
            else:
                logger.info(f"No preference to clear: {user_name}, {event_date_str}")
                return jsonify({"status": "success", "message": "Preference not found or already clear"})
        else:
            success = save_preference(user_name, event_date_str, preference_type)
            if success:
                logger.info(f"Saved preference: {user_name}, {event_date_str}, {preference_type}")
                return jsonify({"status": "success", "message": "Preference saved"})
            else:
                logger.error(f"Failed to save preference: {user_name}, {event_date_str}, {preference_type}")
                return jsonify({"status": "error", "message": "Failed to save preference to database"}), 500

    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error processing preference update: {e}\n{error_details}")
        return jsonify({
            "status": "error",
            "message": "An internal server error occurred",
            "error": str(e)
        }), 500

@app.route('/api/preferences', methods=['GET'])
def get_all_preferences_api():
    """API endpoint to fetch all preferences."""
    try:
        raw_prefs = get_preferences()
        logger.info(f"Successfully fetched {len(raw_prefs)} preferences")
        return jsonify(raw_prefs)
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error fetching preferences via API: {e}\n{error_details}")
        return jsonify({"status": "error", "message": "Failed to fetch preferences"}), 500

# (Other diagnostic routes left unchanged)

# This is needed if running locally with `python api/index.py`
if __name__ == '__main__':
    debug_mode = os.getenv('FLASK_ENV') == 'development'
    logger.info(f"Starting Flask app in {'debug' if debug_mode else 'production'} mode")
    app.run(debug=debug_mode, port=5000)
