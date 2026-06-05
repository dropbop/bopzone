from flask import Flask, render_template, jsonify, request
import requests
import time

app = Flask(__name__, template_folder='../templates', static_folder='../static')

TAILSCALE_BASE = 'https://thinkpad.tail824ac3.ts.net'
# Supported devices. Whitelisting keeps the cache key space bounded and stops
# arbitrary `device` values from being forwarded upstream on a public deploy.
ALLOWED_DEVICES = {'office'}
# Module-level cache: best-effort on Vercel (resets on cold start, not shared
# across instances). Key space is bounded by the device whitelist + clamped params.
_cache = {}


def normalize_device(value):
    """Return the device if it's a supported one, else None (callers reject)."""
    return value if value in ALLOWED_DEVICES else None


def clamp_int(value, default, lo, hi):
    """Coerce a query param to an int within [lo, hi], falling back to default."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def get_cached(key, ttl_seconds, fetch_fn):
    """Return cached data if valid, otherwise fetch and cache."""
    now = time.time()
    if key in _cache and _cache[key][1] > now:
        return _cache[key][0]
    try:
        data = fetch_fn()
        _cache[key] = (data, now + ttl_seconds)
        return data
    except Exception:
        # Return stale cache if fetch fails
        if key in _cache:
            return _cache[key][0]
        raise


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/sensor')
def proxy_sensor():
    device = normalize_device(request.args.get('device', 'office'))
    if device is None:
        return jsonify({"error": "unknown device"}), 400
    hours = clamp_int(request.args.get('hours'), 24, 1, 168)
    cache_key = f"sensor:{device}:{hours}"

    def fetch():
        r = requests.get(f"{TAILSCALE_BASE}/api/sensor",
                         params={'device': device, 'hours': hours}, timeout=10)
        r.raise_for_status()
        return r.json()

    try:
        data = get_cached(cache_key, 60, fetch)  # 60s TTL
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route('/api/sensor/log')
def proxy_log():
    device = normalize_device(request.args.get('device', 'office'))
    if device is None:
        return jsonify({"error": "unknown device"}), 400
    hours = clamp_int(request.args.get('hours'), 24, 1, 168)
    limit = clamp_int(request.args.get('limit'), 50, 1, 200)
    cache_key = f"log:{device}:{hours}:{limit}"

    def fetch():
        r = requests.get(f"{TAILSCALE_BASE}/api/sensor/log",
                         params={'device': device, 'hours': hours, 'limit': limit}, timeout=10)
        r.raise_for_status()
        return r.json()

    try:
        data = get_cached(cache_key, 60, fetch)  # 60s TTL
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route('/api/sensor/calibration')
def proxy_calibration():
    device = normalize_device(request.args.get('device', 'office'))
    if device is None:
        return jsonify({"error": "unknown device"}), 400
    cache_key = f"calibration:{device}"

    def fetch():
        r = requests.get(f"{TAILSCALE_BASE}/api/sensor/calibration",
                         params={'device': device}, timeout=10)
        r.raise_for_status()
        return r.json()

    try:
        data = get_cached(cache_key, 3600, fetch)  # 1hr TTL
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 502
