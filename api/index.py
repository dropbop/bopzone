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

@app.route('/api/sensor/log', methods=['POST'])
def log_event():
    """Receive and store events/errors from sensor devices"""
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
            cur.execute("""
                INSERT INTO sensor_events 
                (device, event_type, message, uptime_seconds, heap_bytes, total_measurements, i2c_errors) 
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                data.get('device'),
                data.get('event_type', 'info'),
                data.get('message', ''),
                data.get('uptime'),
                data.get('heap'),
                data.get('total_measurements'),
                data.get('i2c_errors')
            ))
        logger.info(f"Event logged: [{data.get('event_type')}] {data.get('device')}: {data.get('message')}")
        return jsonify({"status": "ok"})
    except Exception as e:
        logger.error(f"Event log error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/sensor/log', methods=['GET'])
def fetch_events():
    """Fetch recent events for display"""
    device = request.args.get('device', 'office')
    hours = int(request.args.get('hours', 24))
    limit = min(int(request.args.get('limit', 100)), 500)  # Cap at 500
    event_type = request.args.get('type')  # Optional filter by type
    
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "db connection failed"}), 500
    
    try:
        with conn.cursor() as cur:
            if event_type:
                cur.execute("""
                    SELECT id, device, event_type, message, uptime_seconds, heap_bytes, 
                           total_measurements, i2c_errors, created_at 
                    FROM sensor_events 
                    WHERE device = %s 
                      AND event_type = %s
                      AND created_at > NOW() - INTERVAL '%s hours'
                    ORDER BY created_at DESC
                    LIMIT %s
                """, (device, event_type, hours, limit))
            else:
                cur.execute("""
                    SELECT id, device, event_type, message, uptime_seconds, heap_bytes, 
                           total_measurements, i2c_errors, created_at 
                    FROM sensor_events 
                    WHERE device = %s AND created_at > NOW() - INTERVAL '%s hours'
                    ORDER BY created_at DESC
                    LIMIT %s
                """, (device, hours, limit))
            rows = cur.fetchall()
        
        return jsonify([
            {
                "id": r[0],
                "device": r[1],
                "event_type": r[2],
                "message": r[3],
                "uptime": r[4],
                "heap": r[5],
                "total_measurements": r[6],
                "i2c_errors": r[7],
                "ts": r[8].isoformat()
            } 
            for r in rows
        ])
    except Exception as e:
        logger.error(f"Fetch events error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/sensor/stats', methods=['GET'])
def fetch_stats():
    """Get aggregated stats for a device"""
    device = request.args.get('device', 'office')
    hours = int(request.args.get('hours', 24))
    
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "db connection failed"}), 500
    
    try:
        with conn.cursor() as cur:
            # Get reading stats
            cur.execute("""
                SELECT 
                    COUNT(*) as reading_count,
                    MIN(created_at) as first_reading,
                    MAX(created_at) as last_reading,
                    AVG(co2) as avg_co2,
                    MIN(co2) as min_co2,
                    MAX(co2) as max_co2,
                    AVG(temp) as avg_temp,
                    AVG(humidity) as avg_humidity
                FROM readings 
                WHERE device = %s AND created_at > NOW() - INTERVAL '%s hours'
            """, (device, hours))
            reading_stats = cur.fetchone()
            
            # Get event counts by type
            cur.execute("""
                SELECT event_type, COUNT(*) 
                FROM sensor_events 
                WHERE device = %s AND created_at > NOW() - INTERVAL '%s hours'
                GROUP BY event_type
            """, (device, hours))
            event_counts = dict(cur.fetchall())
            
            # Get most recent event
            cur.execute("""
                SELECT event_type, message, created_at 
                FROM sensor_events 
                WHERE device = %s 
                ORDER BY created_at DESC 
                LIMIT 1
            """, (device,))
            last_event = cur.fetchone()
        
        return jsonify({
            "readings": {
                "count": reading_stats[0],
                "first": reading_stats[1].isoformat() if reading_stats[1] else None,
                "last": reading_stats[2].isoformat() if reading_stats[2] else None,
                "avg_co2": round(reading_stats[3], 1) if reading_stats[3] else None,
                "min_co2": reading_stats[4],
                "max_co2": reading_stats[5],
                "avg_temp": round(reading_stats[6], 1) if reading_stats[6] else None,
                "avg_humidity": round(reading_stats[7], 1) if reading_stats[7] else None
            },
            "events": {
                "info": event_counts.get('info', 0),
                "warning": event_counts.get('warning', 0),
                "error": event_counts.get('error', 0),
                "critical": event_counts.get('critical', 0)
            },
            "last_event": {
                "type": last_event[0],
                "message": last_event[1],
                "ts": last_event[2].isoformat()
            } if last_event else None
        })
    except Exception as e:
        logger.error(f"Stats error: {e}")
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
            # Original readings table
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
            
            # New events table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sensor_events (
                    id SERIAL PRIMARY KEY,
                    device VARCHAR(50) NOT NULL,
                    event_type VARCHAR(20) NOT NULL DEFAULT 'info',
                    message TEXT,
                    uptime_seconds INTEGER,
                    heap_bytes INTEGER,
                    total_measurements INTEGER,
                    i2c_errors INTEGER,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_events_device_time 
                ON sensor_events(device, created_at DESC)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_events_type 
                ON sensor_events(event_type)
            """)
            
        return jsonify({
            "status": "success", 
            "message": "readings and sensor_events tables created"
        })
    except Exception as e:
        logger.error(f"Init error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()