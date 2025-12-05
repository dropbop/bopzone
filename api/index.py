import os
from flask import Flask, request, jsonify, render_template
import logging
from .db import get_db_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, template_folder='../templates', static_folder='../static')

SENSOR_TOKEN = os.getenv('SENSOR_TOKEN', '')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/sensor', methods=['POST'])
def ingest():
    token = request.headers.get('X-Sensor-Token')
    if token != SENSOR_TOKEN:
        return jsonify({"error": "unauthorized"}), 401
    
    data = request.get_json()
    if not data:
        return jsonify({"error": "no data"}), 400
    
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "db connection failed"}), 500
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO readings (device, co2, temp, humidity) VALUES (%s, %s, %s, %s)",
                (data.get('device'), data.get('co2'), data.get('temp'), data.get('humidity'))
            )
        return jsonify({"status": "ok"})
    except Exception as e:
        logger.error(f"Insert error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/sensor', methods=['GET'])
def fetch():
    device = request.args.get('device', 'office')
    hours = int(request.args.get('hours', 24))
    
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "db connection failed"}), 500
    
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT co2, temp, humidity, created_at 
                FROM readings 
                WHERE device = %s AND created_at > NOW() - INTERVAL '%s hours'
                ORDER BY created_at ASC
            """, (device, hours))
            rows = cur.fetchall()
        
        return jsonify([
            {"co2": r[0], "temp": r[1], "humidity": r[2], "ts": r[3].isoformat()} 
            for r in rows
        ])
    except Exception as e:
        logger.error(f"Fetch error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/init-database')
def init_database():
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "db connection failed"}), 500
    
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS readings (
                    id SERIAL PRIMARY KEY,
                    device VARCHAR(50) NOT NULL,
                    co2 INTEGER,
                    temp REAL,
                    humidity REAL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_readings_device_time 
                ON readings(device, created_at DESC)
            """)
        return jsonify({"status": "success", "message": "readings table created"})
    except Exception as e:
        logger.error(f"Init error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()
```

**`requirements.txt`**:
```
Flask>=2.0
psycopg2-binary>=2.9
python-dotenv>=0.19
