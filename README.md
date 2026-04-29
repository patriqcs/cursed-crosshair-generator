# Cursed Crosshair Generator

Self-hosted web app for designing **CS2 Cursed Crosshair** configs. Public users build and submit crosshairs through a Cloudflare Turnstile-protected form; the admin reviews, edits, approves, and exports a working `cursed_crosshair.cfg` ready to drop into your CS2 config folder.

Deployed via Docker on Unraid (or any Docker host) and exposed publicly through a Cloudflare Tunnel.

---

## Features

- **Public submit page** — vanilla HTML editor with live SVG preview. No login. Cloudflare Turnstile protects the submission endpoint.
- **Admin dashboard** — tabbed interface (Presets / Submissions), full editor, restore-crosshair editor, key-binding editor, one-click `.cfg` export.
- **Approval workflow** — review, edit, and approve user submissions. Approved presets get a `(by <name>)` echo line in the exported cfg.
- **Atomic JSON storage** — `presets.json` and `submissions.json` in a mounted Docker volume (`/data`).
- **Single-admin auth** — env-var based (`ADMIN_USER`, `ADMIN_PASSWORD`). Auto-generates a random password on first run if none is set.
- **Real-IP rate limiting** — `CF-Connecting-IP` header is honored. 5 logins / 15 min, 10 submissions / hour per IP.
- **Cloudflare Tunnel ready** — `trust proxy` enabled, secure cookies, plain HTTP on port 3000.

---

## Quick start (local)

```bash
cp .env.example .env
# (optional) fill in ADMIN_PASSWORD and TURNSTILE_* keys
docker compose up -d
```

Open `http://localhost:3000/` for the public page and `http://localhost:3000/admin/login` for the admin.

If `ADMIN_PASSWORD` is unset, a random 24-char password is generated on first run and written to `data/admin-credentials.txt`. It is also printed once to the container logs:

```
=== INITIAL ADMIN PASSWORD: xxxxxxxxxxxxxxxxxxxxxxxx ===
```

You can read it with `docker logs cursed-crosshair-generator` or `cat data/admin-credentials.txt`.

---

## Required environment variables

| Variable | Required? | Notes |
|---|---|---|
| `PORT` | optional | Defaults to `3000`. |
| `DATA_DIR` | optional | Defaults to `/data` (matches the Docker volume). |
| `ADMIN_USER` | optional | Defaults to `admin`. |
| `ADMIN_PASSWORD` | optional | If unset, a 24-char password is auto-generated and stored in `/data/admin-credentials.txt`. **Set this in production.** |
| `SESSION_SECRET` | optional | Auto-generated and persisted to `/data/.session-secret` if unset. |
| `TURNSTILE_SITE_KEY` | required for prod | Public site key from Cloudflare Turnstile. |
| `TURNSTILE_SECRET_KEY` | required for prod | Server-side secret. **If both Turnstile vars are missing, captcha verification is skipped and a warning is logged.** Useful for local dev; never run prod without it. |

---

## Unraid deployment

### Option A — Pull from GHCR (recommended)

After the GitHub Actions workflow has run successfully on `main`:

1. Add a new container in Unraid with:
   - **Repository:** `ghcr.io/patriqcs/cursed-crosshair-generator:latest`
   - **Network type:** `bridge`
   - **Port:** `3000:3000`
   - **Volume:** `/mnt/user/appdata/cursed-crosshair-generator/data` → `/data`
2. Add the env vars from the table above as container variables.
3. Apply.

### Option B — Build from source on Unraid

```bash
cd /mnt/user/appdata/
git clone https://github.com/patriqcs/cursed-crosshair-generator.git
cd cursed-crosshair-generator
cp .env.example .env
# edit .env with your credentials
docker compose up -d
```

---

## Cloudflare Tunnel

The app speaks plain HTTP on port `3000`. The Cloudflare Tunnel terminates TLS and forwards to the container. The app already has `app.set('trust proxy', true)` and reads the real client IP from `CF-Connecting-IP` for rate limiting.

In the Cloudflare Zero Trust dashboard:

1. Create or open a tunnel.
2. Add a public hostname:
   - **Subdomain:** `crosshair`
   - **Domain:** `your-domain.tld`
   - **Service:** `HTTP` → `http://<unraid-ip>:3000`
3. Save. The app is now reachable at `https://crosshair.your-domain.tld/`.

### Optional hardening

For defense in depth on the admin area, you can either:

- **Cloudflare Access policy** on `/admin/*` requiring email/Google/GitHub auth (most flexible).
- **Cloudflare WAF rule** allowing `/admin/*` only from specific source IPs.

The app's own admin login still applies on top.

---

## Cloudflare Turnstile setup

1. Visit https://dash.cloudflare.com/?to=/:account/turnstile and create a site.
2. Add the public hostname you configured in the tunnel section (and `localhost` for testing).
3. Copy the **Site Key** and **Secret Key**.
4. Set them as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in your env.

If you skip this step, the app will log `[WARN] Turnstile keys not configured — submissions captcha disabled` and accept submissions without captcha. This is fine for local dev but never for production.

---

## API reference

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/public/config` | Returns `{ turnstileSiteKey, captchaEnabled }`. |
| `GET` | `/api/public/defaults` | Returns starter param set for the public editor. |
| `POST` | `/api/submissions` | Body `{ submitterName, presetName, params, cfTurnstileToken }`. Verifies Turnstile, validates, appends to `submissions.json`. |

### Admin (requires session cookie)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/state` | Returns full presets state (`{ presets, restore, keys }`). |
| `PUT` | `/api/admin/state` | Replace state. |
| `POST` | `/api/admin/presets` | Create a new preset. |
| `PUT` | `/api/admin/presets/:id` | Update a preset. |
| `DELETE` | `/api/admin/presets/:id` | Delete a preset. |
| `POST` | `/api/admin/presets/:id/move` | Body `{ direction: "up"\|"down" }`. |
| `GET` | `/api/admin/submissions?status=pending\|approved\|rejected\|all` | List submissions. |
| `PUT` | `/api/admin/submissions/:id` | Edit a pending submission. |
| `POST` | `/api/admin/submissions/:id/approve` | Approve and add to presets. |
| `POST` | `/api/admin/submissions/:id/reject` | Mark as rejected. |
| `DELETE` | `/api/admin/submissions/:id` | Permanently remove. |
| `POST` | `/api/admin/submissions/cleanup` | Purge all non-pending. |
| `GET` | `/api/admin/export` | Returns the generated `cursed_crosshair.cfg` as `text/plain` attachment. |

---

## How the exported `.cfg` works

The exporter splits each preset into **three chained aliases** (`_cN`, `_cNb`, `_cNc`) because the source-engine console has a per-alias string-length limit. Each preset:

- `_cN` — sets style, size, thickness, gap, dot, T, recoil; chains to `_cNb`.
- `_cNb` — sets outline, alpha, optionally `cl_crosshair_dynamic_splitdist`; chains to `_cNc`.
- `_cNc` — sets RGB and emits an `echo [CURSED #N] <name> (by <submitter>)` banner.

Rotation:

- `_link1`...`_linkN` chain via `alias cursed_next _linkX`. After preset N, it loops back to `_link1`.
- The next-key (default `o`) is bound to `cursed_next`.

Restore:

- `cursed_restore` runs your green default in four chained aliases (`cursed_restore` → `_rb` → `_rc` → `_rd`).
- The restore-key (default `p`) is bound to `cursed_restore`.

Re-`exec`'ing the cfg in CS2 is safe: every key bind is preceded by `unbind`, so old binds don't conflict.

---

## Local development without Docker

```bash
npm ci
DATA_DIR=./data npm start
```

The app will listen on `:3000`, create the `./data` directory, and seed `presets.json` + `submissions.json` on first request.

---

## License

MIT — see [LICENSE](LICENSE).
