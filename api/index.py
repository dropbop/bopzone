import os
import time
from datetime import datetime, timezone
from flask import Flask, request, jsonify, render_template
import logging
from .db import get_db_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Simple in-memory cache: {key: (data, expiry_timestamp)}
_cache = {}

def get_cached(key, ttl_seconds, fetch_fn):
    """Return cached data if valid, otherwise fetch and cache."""
    now = time.time()
    if key in _cache and _cache[key][1] > now:
        return _cache[key][0]
    data = fetch_fn()
    _cache[key] = (data, now + ttl_seconds)
    return data

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

@app.route('/api/sensor/batch', methods=['POST'])
def ingest_batch():
    """Receive batched readings from ESP32"""
    token = request.headers.get('X-Sensor-Token')
    if token != SENSOR_TOKEN:
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json()
    if not data or 'readings' not in data:
        return jsonify({"error": "no readings"}), 400

    device = data.get('device')
    readings = data.get('readings', [])

    if not readings:
        return jsonify({"status": "ok", "inserted": 0})

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "db connection failed"}), 500

    try:
        with conn.cursor() as cur:
            # Bulk insert using executemany
            cur.executemany(
                """INSERT INTO readings (device, co2, temp, humidity, created_at)
                   VALUES (%s, %s, %s, %s, %s)""",
                [(device, r['co2'], r['temp'], r['humidity'], r['ts']) for r in readings]
            )
        logger.info(f"Batch insert: {len(readings)} readings for {device}")
        return jsonify({"status": "ok", "inserted": len(readings)})
    except Exception as e:
        logger.error(f"Batch insert error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/sensor', methods=['GET'])
def fetch():
    device = request.args.get('device', 'office')
    hours = int(request.args.get('hours', 24))
    cache_key = f"sensor:{device}:{hours}"

    def fetch_from_db():
        conn = get_db_connection()
        if not conn:
            return None
        try:
            with conn.cursor() as cur:
                # Fetch relative to the most recent reading, not NOW()
                # This ensures the graph shows data even when sensor is offline
                cur.execute("""
                    SELECT co2, temp, humidity, created_at
                    FROM readings
                    WHERE device = %s
                      AND created_at > (
                          SELECT MAX(created_at) FROM readings WHERE device = %s
                      ) - INTERVAL '%s hours'
                    ORDER BY created_at ASC
                """, (device, device, hours))
                rows = cur.fetchall()
            return [
                {"co2": r[0], "temp": r[1], "humidity": r[2], "ts": r[3].isoformat()}
                for r in rows
            ]
        except Exception as e:
            logger.error(f"Fetch error: {e}")
            return None
        finally:
            conn.close()

    data = get_cached(cache_key, 60, fetch_from_db)  # 60s TTL
    if data is None:
        return jsonify({"error": "db connection failed"}), 500
    return jsonify(data)

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

        # Detect calibration event and update cache immediately
        message = data.get('message', '')
        if 'FRC successful' in message:
            device = data.get('device')
            cache_key = f"calibration:{device}"
            result = {"date": datetime.now(timezone.utc).isoformat()}
            _cache[cache_key] = (result, time.time() + 3600)
            logger.info(f"Calibration cache updated for {device}")

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

    # Use longer cache for calibration queries (360+ hours)
    cache_ttl = 3600 if hours >= 360 else 60
    cache_key = f"events:{device}:{hours}:{limit}:{event_type or 'all'}"

    def fetch_from_db():
        conn = get_db_connection()
        if not conn:
            return None
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
            return [
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
            ]
        except Exception as e:
            logger.error(f"Fetch events error: {e}")
            return None
        finally:
            conn.close()

    data = get_cached(cache_key, cache_ttl, fetch_from_db)
    if data is None:
        return jsonify({"error": "db connection failed"}), 500
    return jsonify(data)

@app.route('/api/sensor/calibration', methods=['GET'])
def fetch_calibration():
    """Get last calibration date for a device - lightweight endpoint"""
    device = request.args.get('device', 'office')
    cache_key = f"calibration:{device}"

    # Check cache first
    if cache_key in _cache and _cache[cache_key][1] > time.time():
        return jsonify(_cache[cache_key][0])

    # Cache miss - do targeted query
    conn = get_db_connection()
    if not conn:
        return jsonify({"date": None, "error": "db connection failed"}), 500

    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT created_at FROM sensor_events
                WHERE device = %s AND message LIKE '%%FRC successful%%'
                ORDER BY created_at DESC
                LIMIT 1
            """, (device,))
            row = cur.fetchone()

        if row:
            result = {"date": row[0].isoformat()}
        else:
            result = {"date": None}

        # Cache for 1 hour (serverless instances don't share memory)
        _cache[cache_key] = (result, time.time() + 3600)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Calibration fetch error: {e}")
        return jsonify({"date": None, "error": str(e)}), 500
    finally:
        conn.close()


@app.route('/api/sensor/stats', methods=['GET'])
def fetch_stats():
    """Get aggregated stats for a device"""
    device = request.args.get('device', 'office')
    hours = int(request.args.get('hours', 24))
    cache_key = f"stats:{device}:{hours}"

    def fetch_from_db():
        conn = get_db_connection()
        if not conn:
            return None
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

            return {
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
            }
        except Exception as e:
            logger.error(f"Stats error: {e}")
            return None
        finally:
            conn.close()

    data = get_cached(cache_key, 120, fetch_from_db)  # 120s TTL
    if data is None:
        return jsonify({"error": "db connection failed"}), 500
    return jsonify(data)

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