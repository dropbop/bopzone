# agents.md

## Purpose
This repository is a Vercel monorepo that hosts three apps:
- `/` and `/homepage` → static homepage
- `/camping` → Flask app
- `/movies` → Flask app

## Routing (source of truth)
All routing is defined in **`vercel.json`**:
- Static assets:
  - `/homepage/static/*` → `homepage/static/*`
  - `/camping/static/*` → `camping/static/*`
  - `/movies/static/*` → `movies/static/*`
- Apps:
  - `/camping/*` → `camping/api/index.py`
  - `/movies/*` → `movies/api/index.py`
- Homepage:
  - `/` and `/homepage/*` → `homepage/templates/index.html`

## Flask under subpaths
Each Flask app is mounted at a subpath using a tiny WSGI **PrefixMiddleware**. This ensures:
- `url_for('static', ...)` produces `/APP/static/...`
- App routes remain coded as `/...`, but are served at `/APP/...`

## JS fetch calls
**Never** call absolute paths like `/api/...`.  
Always prefix‑aware:
- Either use a helper like:
  ```js
  const APP_PREFIX = '/' + window.location.pathname.split('/')[1]; // "/movies" or "/camping"
  const api = (p) => `${APP_PREFIX}/${p.replace(/^\/+/, '')}`;
  // fetch(api('api/endpoint'))

    Or rely on relative paths plus a <base href="{{ url_for('index') }}"> in templates.

Adding another app

    Create /<appname>/{api,templates,static}/...

    Implement Flask entry at /<appname>/api/index.py (copy PrefixMiddleware and set default prefix /<appname>).

    Update vercel.json:

        Add builds for /<appname>/api/index.py (python) and /<appname>/static/** (static)

        Add routes:

            ^/<appname>$ → 301 to /<appname>/

            ^/<appname>/(.*)$ → /<appname>/api/index.py

            ^/<appname>/static/(.*)$ → /<appname>/static/$1

    Ensure all JS uses the prefix‑aware helper shown above.


---
