# GitHub Pages Frontend Migration Plan

## Purpose

Move the public `dropbop.xyz` frontend off Vercel and onto GitHub Pages to remove the current dependency on Vercel serverless functions for sensor data reads.

The immediate reason for the migration is the current production failure mode:

- The browser loads `https://www.dropbop.xyz`.
- Frontend JavaScript calls `/api/sensor`, `/api/sensor/log`, and `/api/sensor/calibration`.
- Vercel runs `api/index.py`.
- `api/index.py` proxies those requests to `https://thinkpad.tail824ac3.ts.net`.
- Vercel intermittently fails the outbound HTTPS connection to the Tailscale Funnel endpoint and returns HTTP 502.

The local sensor stack is healthy, so the unreliable part is the Vercel proxy hop. GitHub Pages cannot run server-side code, so the migration intentionally removes that proxy and makes the frontend a static site that talks directly to the sensor API.

## Current Architecture

```text
Browser
  |
  | GET https://www.dropbop.xyz/
  v
Vercel
  |
  | serves Flask-rendered template from api/index.py
  v
Frontend JavaScript
  |
  | GET /api/sensor?device=office&hours=24
  | GET /api/sensor/log?device=office&hours=24&limit=50
  | GET /api/sensor/calibration?device=office
  v
Vercel Python function
  |
  | requests.get("https://thinkpad.tail824ac3.ts.net/...")
  v
Tailscale Funnel
  |
  | proxy to http://127.0.0.1:5001
  v
Local sensor-api.service on ThinkPad
  |
  v
PostgreSQL sensor database
```

Observed problem:

- `sensor-api.service` is running locally.
- ESP32 uploads are reaching the ThinkPad.
- Local API reads return fresh data.
- Tailscale Funnel is enabled.
- Vercel still returns 502 because its function fails while connecting to the Funnel URL.

## Target Architecture

```text
Browser
  |
  | GET https://www.dropbop.xyz/
  v
GitHub Pages
  |
  | serves static index.html, CSS, JS
  v
Frontend JavaScript
  |
  | GET https://thinkpad.tail824ac3.ts.net/api/sensor?device=office&hours=24
  | GET https://thinkpad.tail824ac3.ts.net/api/sensor/log?device=office&hours=24&limit=50
  | GET https://thinkpad.tail824ac3.ts.net/api/sensor/calibration?device=office
  v
Tailscale Funnel
  |
  | proxy to http://127.0.0.1:5001
  v
Local sensor-api.service on ThinkPad
  |
  v
PostgreSQL sensor database
```

This removes Vercel from the runtime path. GitHub Pages only serves static files. Live sensor data still depends on the ThinkPad, local power, local internet, Tailscale Funnel, and the sensor API.

## Expected Outage Behavior

If the sensor API or ThinkPad is down, the site should still load from GitHub Pages.

The frontend should not sit forever in a loading state or show empty panels. Instead, it should switch into an explicit stale/example mode:

- Show clearly labeled example readings.
- Mark the data source as offline or unavailable.
- Display a visible message such as `LIVE DATA OFFLINE - SHOWING EXAMPLE DATA`.
- Set `ESP32` and `DB` status LEDs to offline.
- Keep `WEB` online because GitHub Pages is still serving the frontend.
- Keep charts populated with example trend data so the UI remains legible.
- Make it obvious that the values are not current sensor readings.

The example data should be deterministic and local to the frontend. It should not pretend to be cached production data unless it actually came from a previous successful live request.

Optional improvement:

- Store the most recent successful live sensor response in `localStorage`.
- If the live API is unavailable, prefer that browser-local cached data over generic example data.
- Label it as stale with the timestamp of the last successful live fetch.
- Fall back to bundled example data only when no cached live data exists.

Recommended display states:

```text
LIVE
  Data came from the sensor API during the current page session.

STALE
  Data came from a previous successful browser-local cache.
  Show the last successful fetch time.

EXAMPLE
  Data came from bundled placeholder data because no live or cached data is available.
```

## Repository Changes

### 1. Convert the site to static HTML

Current page source:

- `templates/index.html`

GitHub Pages will not run Flask templates. Move or copy this file to:

- `index.html`

Update asset paths from absolute Vercel-style paths to GitHub Pages-safe paths:

```html
<link rel="stylesheet" href="./static/css/style.css">
<script src="./static/js/script.js" defer></script>
```

If the site will be served from a custom root domain like `https://www.dropbop.xyz`, absolute paths such as `/static/js/script.js` work. Relative paths are more portable and also work for project-page preview URLs like `https://dropbop.github.io/bopzone/`.

### 2. Change the frontend API base

Current JavaScript:

```js
const API_BASE = '/api/sensor';
```

Target:

```js
const API_BASE = 'https://thinkpad.tail824ac3.ts.net/api/sensor';
```

This points the browser directly at the existing Tailscale Funnel endpoint.

Before shipping, confirm that the sensor API sends CORS headers for all needed routes:

- `/api/sensor`
- `/api/sensor/log`
- `/api/sensor/calibration`

Current observed upstream responses include:

```text
access-control-allow-origin: *
```

That should allow the GitHub Pages-hosted browser page to read the API directly.

### 3. Add stale/example data handling

Modify `static/js/script.js` so failed fetches do not leave the UI blank.

Add bundled example data in the frontend, for example:

```js
const EXAMPLE_SENSOR_DATA = [
  { co2: 620, temp: 22.1, humidity: 48.5, ts: '2026-01-01T08:00:00-06:00' },
  { co2: 655, temp: 22.3, humidity: 48.9, ts: '2026-01-01T09:00:00-06:00' },
  { co2: 690, temp: 22.6, humidity: 49.2, ts: '2026-01-01T10:00:00-06:00' }
];
```

Use enough points to make the 24-hour trend chart look intentional.

Add a small data-source state object:

```js
let dataMode = 'loading'; // loading | live | stale | example
let lastLiveFetchAt = null;
```

On successful sensor fetch:

- Save response into `sensorData`.
- Set `dataMode = 'live'`.
- Set `lastLiveFetchAt = new Date().toISOString()`.
- Store the response and fetch timestamp in `localStorage`.
- Set `ESP32` and `DB` LEDs online.
- Update the display and chart.

On failed sensor fetch:

- Try to load browser-local cached sensor data from `localStorage`.
- If cache exists, set `sensorData` to cached data and `dataMode = 'stale'`.
- If cache does not exist, set `sensorData` to bundled example data and `dataMode = 'example'`.
- Set `ESP32` and `DB` LEDs offline.
- Update the display and chart.
- Show a visible stale/example indicator.

### 4. Add a clear UI indicator

Add a small status indicator near the environmental monitor panel title or status bar.

Example copy:

```text
LIVE DATA
STALE DATA - LAST LIVE FETCH 21:47:11
EXAMPLE DATA - SENSOR API OFFLINE
```

The key requirement is that stale or example values cannot be mistaken for live readings.

Possible HTML addition:

```html
<span id="data-source-status" class="data-source-status">CONNECTING</span>
```

Possible CSS states:

```css
.data-source-status.live { color: #00ff66; }
.data-source-status.stale { color: #ffd24a; }
.data-source-status.example { color: #ff6b6b; }
```

### 5. Make event and calibration fallback explicit

Events and calibration should follow the same principle:

- If `/api/sensor/log` fails, show an explicit offline/example event row.
- If calibration lookup fails, show `UNKNOWN` or `OFFLINE`, not a misleading date.
- If stale event data exists in `localStorage`, show it with a stale label.

Example event row:

```text
--:--:--  WARN  Sensor event API offline - showing example/status fallback
```

### 6. Remove or bypass Vercel-specific files

After the static site is verified, Vercel files can be left in the repo temporarily but should no longer be part of production hosting:

- `api/index.py`
- `requirements.txt`
- `vercel.json`

Recommended cleanup after cutover:

- Keep them for one commit as rollback context.
- Remove them once GitHub Pages production is working.

## GitHub Pages Setup

1. Add `index.html` at the repository root.
2. Keep static assets under `static/`.
3. Commit and push the static-site changes.
4. In GitHub repository settings, enable Pages.
5. Use the `main` branch and repository root as the Pages source, or use a GitHub Actions Pages workflow if branch/root publishing is not available.
6. Confirm the GitHub Pages URL loads correctly.
7. Configure the custom domain.
8. Move DNS for `www.dropbop.xyz` from Vercel to GitHub Pages.
9. Enable HTTPS in the GitHub Pages settings.
10. Verify:
    - page loads
    - CSS loads
    - JS loads
    - live sensor data loads
    - stale/example mode works when the API is blocked or down

## DNS Notes

For a `www` subdomain, GitHub Pages typically uses a CNAME record pointing to the GitHub Pages hostname.

Example:

```text
www.dropbop.xyz CNAME dropbop.github.io
```

If using the apex domain `dropbop.xyz`, GitHub Pages usually requires `A` records to GitHub Pages IPs plus repository domain configuration. Keep `www.dropbop.xyz` as the primary target unless there is a reason to serve the apex directly.

Add a `CNAME` file to the repo root if GitHub Pages requires it:

```text
www.dropbop.xyz
```

## Testing Plan

### Local static test

Run a local static server from the repo root:

```sh
python3 -m http.server 8000
```

Open:

```text
http://127.0.0.1:8000/
```

Verify:

- CSS and JS load using relative paths.
- The browser can fetch from `https://thinkpad.tail824ac3.ts.net`.
- The trend chart draws.
- Sensor cards update with live values.
- Alarm/event list updates.
- Calibration status updates or falls back clearly.

### Offline fallback test

Temporarily change `API_BASE` locally to an invalid URL, or block the request in browser devtools.

Verify:

- No endless loading state.
- No blank chart.
- `EXAMPLE DATA - SENSOR API OFFLINE` or equivalent appears.
- ESP32 and DB LEDs are offline.
- Values are visibly marked as example or stale.

### GitHub Pages preview test

After publishing to GitHub Pages:

- Test the `github.io` URL before moving DNS.
- Confirm no mixed-content issues.
- Confirm CORS works from the GitHub Pages origin.
- Confirm direct raw API links still open.

### Production cutover test

After DNS points to GitHub Pages:

- Open `https://www.dropbop.xyz`.
- Hard refresh to avoid cached Vercel assets.
- Confirm the page source no longer comes from Vercel.
- Confirm Network tab has no calls to `/api/sensor`.
- Confirm API calls go directly to `https://thinkpad.tail824ac3.ts.net`.
- Confirm the site remains usable if the sensor API is unreachable.

## Rollback Plan

Keep the Vercel deployment available until GitHub Pages is verified.

Rollback options:

1. Point DNS back to Vercel.
2. Revert the frontend `API_BASE` to `/api/sensor`.
3. Restore Vercel as production if GitHub Pages has a DNS or CORS problem.

Because this migration is mostly DNS plus static frontend changes, rollback should be low-risk as long as Vercel settings are not deleted immediately.

## Risks and Tradeoffs

### GitHub Pages cannot run backend code

This is intentional. The move removes Vercel's backend proxy from the runtime path. Any future dynamic behavior must either:

- run in the browser,
- call the ThinkPad API directly,
- use another serverless provider,
- or move to a more durable backend later.

### Home infrastructure is still required for live data

GitHub Pages keeps the frontend online, but live sensor data still depends on:

- the ThinkPad,
- local power,
- local internet,
- Tailscale Funnel,
- `sensor-api.service`,
- PostgreSQL,
- and the ESP32.

If any of those are down, the page should display stale or example data clearly.

### Public direct API exposure remains

The browser will call the Tailscale Funnel URL directly. That means the sensor read endpoints remain public through Funnel. This is already effectively true today because Vercel proxies public requests to those endpoints.

If write endpoints are exposed on the same API, they should be protected separately. At minimum, confirm that public unauthenticated access cannot mutate sensor data or system state.

### CORS must remain configured

Direct browser calls require CORS. The local API currently appears to send `access-control-allow-origin: *`. If that changes, GitHub Pages sensor reads will fail even if the API is otherwise healthy.

## Recommended Implementation Order

1. Add root `index.html` copied from `templates/index.html`.
2. Change asset paths to relative paths.
3. Change `API_BASE` to `https://thinkpad.tail824ac3.ts.net/api/sensor`.
4. Add `dataMode` handling for `live`, `stale`, and `example`.
5. Add bundled example sensor and event data.
6. Add a visible data source indicator.
7. Add `localStorage` cache for last successful live sensor and event responses.
8. Test locally with live API.
9. Test locally with broken API.
10. Publish to GitHub Pages on the GitHub Pages URL.
11. Test GitHub Pages before DNS cutover.
12. Point `www.dropbop.xyz` DNS to GitHub Pages.
13. Verify production.
14. Remove Vercel runtime files in a later cleanup commit.

## Success Criteria

The migration is successful when:

- `https://www.dropbop.xyz` is served by GitHub Pages.
- The site no longer depends on Vercel for runtime requests.
- Browser network requests do not call `/api/sensor` on `www.dropbop.xyz`.
- Live data loads directly from `https://thinkpad.tail824ac3.ts.net`.
- If live data fails, the UI explicitly shows stale or example data.
- The user can distinguish live readings from non-live readings at a glance.
- The Vercel 502 failure mode is removed from normal operation.
