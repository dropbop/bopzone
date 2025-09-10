# Deploying Apps Under a Subpath (and a Subdomain) Without Breaking CSS/JS

This guide explains how to make a web app work both:
- at its own subdomain (e.g., `https://camping.example.com/`), and
- mounted under a subpath of a different site via proxy/rewrites (e.g., `https://example.com/camping/`).

It’s written so you can follow it without access to any specific codebase. It includes concrete snippets mirroring what worked in the “campingcalendar” project.


## Objective

- Preferred: host apps under a subpath (e.g., `/camping/`) via rewrites/proxy and make them base-path aware so assets and API calls work correctly.
- Also support the same app at the root of its own subdomain when needed.

This guide is subpath-first: the examples and checklist focus on making apps work reliably when mounted under a base path. Redirecting to a subdomain is treated as a fallback when a sub-app cannot be made base-path aware.


## Why Things Break Under a Subpath

When your homepage uses a reverse proxy/rewrites to mount another app at `/project/`, the browser URL stays on `https://example.com/project/...`.

If the sub-app uses root-absolute URLs like `/assets/...` or `/api/...`, the browser requests `https://example.com/assets/...` instead of `https://example.com/project/assets/...`. Those requests miss the proxy rules and 404—so CSS/JS don’t load.

The fix is to make the sub-app “base-path aware.”


## Strategy: Subpath vs. Subdomain

Pick one per project (subpath preferred):

- Preferred: keep the app under the main site at `/project/` (base-path aware)
  - Continue using rewrites/proxy at `/project/` and ensure the sub-app uses relative asset paths and prefix-aware API calls (instructions below). The rest of this guide focuses on this approach.

- Fallback: link/redirect to the subdomain (avoids base-path issues)
  - Example: link to `https://camping.example.com/` instead of `/camping/`.
  - If you currently rewrite `/project/:path*` → subdomain, switching to a redirect ensures the browser lands on the subdomain so root-absolute `/assets` works. Use this only when you cannot modify the sub-app to be base-path aware.


## How To Make a Sub-App Base-Path Aware

1) Use relative asset links in HTML (no leading slash)

- Do NOT do this (root-absolute; breaks under `/project/`):
  - `<link rel="stylesheet" href="/static/css/style.css">`
  - `<script src="/static/js/app.js"></script>`

- Instead, use relative URLs (work at both root and subpath):
  - `<link rel="stylesheet" href="static/css/style.css">`
  - `<script src="static/js/app.js"></script>`

These resolve to `/static/...` when the app is at a domain root, and to `/project/static/...` when mounted under `/project/`.


2) Prefix-aware API calls in JavaScript

If you fetch APIs as `/api/...`, that’s root-absolute and will break under a subpath. Prefix them by the current path segment.

Drop-in snippet:

```html
<!-- index.html (or main template) -->
<script>
  // Determine the first URL segment as a base prefix
  const firstSeg = (window.location.pathname.split('/')[1] || '').trim();
  const PREFIX = firstSeg ? `/${firstSeg}` : '';

  // Build API paths that work at both root and under /project
  const api = (p) => `${PREFIX}/${String(p).replace(/^\/+/, '')}`;

  // Example usage
  async function loadData() {
    const res = await fetch(api('api/preferences'));
    const data = await res.json();
    console.log(data);
  }
  loadData();
}</script>
```


3) Avoid `<base href="/">`

Do not set a global `<base href="/">` in your HTML. That forces all links to resolve from the domain root and breaks subpath hosting.


4) Framework/bundler base path settings

If you use a bundler or framework, configure its base so assets and router paths include your subpath when needed.

- Vite: `export default { base: '/project/' }`
- Create React App: add to `package.json` → `"homepage": "https://example.com/project"`
- Next.js: `basePath: '/project'` (and/or `assetPrefix`)
- SvelteKit: `paths: { base: '/project' }`
- Gatsby: `pathPrefix: '/project'`

This tells the tool to emit asset URLs (and sometimes router paths) that work under a subpath.


5) Server/static hosting alignment

Ensure the sub-app can serve static files at a path that works both at root and with the proxy. Two common patterns:

- Static folder exposed at `/static/...` when the app is at the domain root.
- When mounted under `/project/` via proxy, the same relative references `static/...` become `/project/static/...` (which the proxy forwards to the sub-app).

That alignment is what makes the relative links from step 1 work in both places.


## Concrete Examples (mirror of what works)

1) HTML template: relative CSS/JS

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>My App</title>
    <!-- Relative asset URLs; no leading slash -->
    <link rel="stylesheet" href="static/css/style.css" />
  </head>
  <body>
    <div id="app"></div>
    <script src="static/js/app.js"></script>
  </body>
  
  <!-- No <base href="/"> -->
</html>
```

2) JavaScript: prefix-aware fetch helper

```js
// static/js/app.js
document.addEventListener('DOMContentLoaded', () => {
  const firstSeg = (window.location.pathname.split('/')[1] || '').trim();
  const PREFIX = firstSeg ? `/${firstSeg}` : '';
  const api = (p) => `${PREFIX}/${String(p).replace(/^\/+/, '')}`;

  // Use api('api/...') instead of '/api/...'
  fetch(api('api/health'))
    .then((r) => r.json())
    .then((data) => console.log('health:', data))
    .catch(console.error);
});
```

3) Vercel: example patterns

- Homepage (container) project: path-mounted reverse proxy and redirects to keep trailing slash tidy.

```json
{
  "version": 2,
  "rewrites": [
    { "source": "/project/", "destination": "https://project.example.com/" },
    { "source": "/project/:path*", "destination": "https://project.example.com/:path*" }
  ],
  "redirects": [
    { "source": "/project", "destination": "/project/", "permanent": false }
  ]
}
```

- Sub-app (e.g., a Flask or static+API app) serving its own static at root:

```json
{
  "version": 2,
  "builds": [
    { "src": "api/index.py", "use": "@vercel/python" },
    { "src": "static/**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/static/(.*)", "dest": "/static/$1" },
    { "src": "/(.*)", "dest": "api/index.py" }
  ]
}
```

With this setup, when the sub-app lives at `https://project.example.com/`, the HTML’s `static/...` resolves to `/static/...`. When mounted under `https://example.com/project/`, it resolves to `/project/static/...` and still works via the homepage proxy rules.


## Framework Notes & Checklists

- General checklist
  - [ ] Change all `<link>`/`<script>`/`<img>` to relative paths (no leading slash) or use the framework’s base config.
  - [ ] Remove `<base href="/">` if present.
  - [ ] Prefix all fetch/XHR/WebSocket URLs with a computed base (as shown) or use framework routing helpers that respect the base path.
  - [ ] Check favicons/manifest: use relative `href="favicon.ico"` or `href="static/favicon.ico"` instead of `/favicon.ico`.
  - [ ] Cookies: if you set cookie `path`, consider `path=/` vs `path=/project` depending on your auth/session needs.

- Vite
  - Set `base: '/project/'` in `vite.config.js` when building for subpath hosting.
  - If you need to work in both environments from the same build, prefer relative links and runtime prefixing.

- Create React App
  - Add `"homepage": "https://example.com/project"` to `package.json` before `npm run build`.
  - Or migrate to Vite and use `base`.

- Next.js
  - Set `basePath: '/project'` in `next.config.js`.
  - If static asset URLs still resolve root-absolute, set `assetPrefix` to `'/project'` (or full URL when behind CDN).

- SvelteKit
  - In `svelte.config.js` or `+layout`, set `paths.base = '/project'`.

- Gatsby
  - Add `pathPrefix: '/project'` and build with `--prefix-paths`.


## How to Test

1) Visit the app at its subdomain (root hosting). Confirm:
   - CSS/JS load from `/static/...` (Network tab),
   - API calls hit `/api/...` (since `PREFIX` is empty at domain root).

2) Visit the app mounted under the homepage path: `https://example.com/project/`. Confirm:
   - CSS/JS load from `/project/static/...`,
   - API calls hit `/project/api/...` (you should see the path prefix in Network tab),
   - No 404s for assets.


## Common Pitfalls

- Root-absolute URLs in code (`/assets/...`, `/api/...`) — switch to relative or prefix-aware.
- `<base href="/">` in HTML — remove it.
- Bundler emitting root-absolute assets — configure base path (Vite/Next/CRA/etc.).
- Router links not respecting base — ensure router/basePath settings match your mount path.
- Service workers: check `scope` and asset paths; they often assume domain root.


## TL;DR Template

Use these minimal pieces across projects:

```html
<!-- Relative assets -->
<link rel="stylesheet" href="static/css/style.css" />
<script src="static/js/app.js"></script>
```

```js
// Prefix-aware API helper
const firstSeg = (location.pathname.split('/')[1] || '').trim();
const PREFIX = firstSeg ? `/${firstSeg}` : '';
const api = (p) => `${PREFIX}/${String(p).replace(/^\/+/, '')}`;
// fetch(api('api/endpoint'))
```

```json
// Homepage (container) proxy
{
  "rewrites": [
    { "source": "/project/", "destination": "https://project.example.com/" },
    { "source": "/project/:path*", "destination": "https://project.example.com/:path*" }
  ]
}
```

Stick to relative assets, prefix your API calls, avoid `<base href="/">`, and set your framework’s base path if you use a bundler.
