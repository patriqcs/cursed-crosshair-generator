# Cursed Crosshair Generator — Build Specification

A self-hosted web app for designing CS2 "Cursed Crosshair" configs. Public users can submit crosshairs; admin reviews, edits, approves, and exports a working `cursed_crosshair.cfg`. Deployed via Docker on Unraid, exposed publicly through a Cloudflare Tunnel.

---

## 1. Project Setup

- Create a new GitHub repo named **`cursed-crosshair-generator`** under my account.
- Initialize git, commit incrementally with sensible messages, push to `main`.
- After first commit: `gh repo create cursed-crosshair-generator --public --source=. --remote=origin --push`.
- Add `.gitignore` (Node, IDE files, `data/`, `.env`).
- Add MIT LICENSE.

---

## 2. Tech Stack — Keep It Minimal

- **Backend:** Node.js + Express, single `server.js`. No TypeScript, no build step.
- **Frontend:** vanilla HTML + CSS + JS in `public/`. No frameworks, no bundler. ES modules ok.
- **Storage:** JSON files in `/data/` (mounted Docker volume). Atomic writes (write `.tmp`, fsync, rename).
- **Auth:** `express-session` with signed cookie. Single admin from env vars.
- **Captcha:** Cloudflare Turnstile on the public submission form.
- **Deployment:** Docker behind a Cloudflare Tunnel. App speaks plain HTTP on port 3000; the tunnel handles TLS.

Dependencies (suggested): `express`, `express-session`, `express-rate-limit`, `cookie-parser`, `nanoid` (or use `crypto.randomUUID`). Nothing else needed.

---

## 3. High-Level Structure

Two distinct areas:

1. **Public area (`/`)** — no login. Anyone with the link can build and submit a crosshair. Submitter must enter a name and pass a Turnstile captcha.
2. **Admin area (`/admin`)** — login required. Full editor + Submissions tab to review, edit, approve, or delete.

---

## 4. Authentication

- Single-admin auth. No user management. No registration.
- Credentials from env: `ADMIN_USER`, `ADMIN_PASSWORD`.
- If `ADMIN_PASSWORD` is unset on first start: generate a random 24-char password, write it to `/data/admin-credentials.txt`, and log it once to the container logs (clearly framed: `=== INITIAL ADMIN PASSWORD: xxxx ===`).
- `SESSION_SECRET` from env; auto-generated and persisted to `/data/.session-secret` on first start if missing.
- Session cookie: `httpOnly: true`, `sameSite: 'lax'`, `secure: true` (tunnel terminates TLS — see Section 12).
- Login page at `/admin/login`. POST credentials, redirect to `/admin` on success.
- Logout at `/admin/logout` (POST).
- `requireAuth` middleware protects all `/admin/*` routes and `/api/admin/*` endpoints. Returns 401 JSON for API, redirects to login for HTML.
- Rate limit login: **5 attempts per 15 min per IP** (real IP from `CF-Connecting-IP` — see Section 12).

---

## 5. Captcha (Cloudflare Turnstile)

Turnstile protects the public submission endpoint. Free, privacy-friendly, integrates naturally with Cloudflare Tunnel.

**Env vars:**
- `TURNSTILE_SITE_KEY` — public site key, exposed to the frontend
- `TURNSTILE_SECRET_KEY` — secret, server-side only

**Behavior when env vars are missing:**
If both are unset, log a warning at startup (`[WARN] Turnstile keys not configured — submissions captcha disabled`) and skip captcha verification. This keeps local dev / first-run unblocked. In production they MUST be set.

**Frontend:**
- Load Turnstile JS once in the public page: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`.
- Render the widget inside the submission modal: `<div class="cf-turnstile" data-sitekey="<TURNSTILE_SITE_KEY>" data-theme="dark"></div>`.
- The site key must be injected into the page (e.g. via a small `/api/public/config` endpoint returning `{ turnstileSiteKey }`, or templated into the HTML at request time — your call).
- On submit: read the token via `turnstile.getResponse()` and POST it as `cfTurnstileToken` along with the rest of the form.
- After a successful or failed submit, call `turnstile.reset()` so the widget is ready for the next attempt.

**Backend:**
- In `POST /api/submissions`, before doing anything else, verify the token by POSTing to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with form-urlencoded body `secret=<TURNSTILE_SECRET_KEY>&response=<token>&remoteip=<client_ip>`.
- Reject the submission with `400 { error: "captcha_failed" }` if `success` is not `true`.
- Use a 5-second fetch timeout for the verification call; if Turnstile is unreachable, reject with `503 { error: "captcha_unavailable" }`.

Login page does **not** use Turnstile (single admin + rate limiting is sufficient).

---

## 6. Data Model

Two JSON files in `/data/`, each written atomically.

**`presets.json`** — curated/approved presets that end up in the exported `.cfg`:
```json
{
  "presets": [
    {
      "id": "...",
      "name": "Inferno",
      "params": { /* see param schema */ },
      "submittedBy": "PatriQ"
    }
  ],
  "restore": { "params": { /* see green default in Section 9 */ } },
  "keys": { "next": "o", "restore": "p" }
}
```

**`submissions.json`** — pending submissions:
```json
{
  "submissions": [
    {
      "id": "...",
      "submitterName": "Someone",
      "presetName": "Cursed Banana",
      "params": { /* same param schema */ },
      "submittedAt": "2026-04-29T12:34:56Z",
      "status": "pending"
    }
  ]
}
```

`status`: `pending` | `approved` | `rejected`.

**Param schema** (used in both files):
```js
{
  cl_crosshairstyle: 0..5,
  cl_crosshairsize: number,           // allow 0.01 .. 999
  cl_crosshairthickness: number,
  cl_crosshairgap: number,            // allow -999 .. 9999
  cl_crosshairdot: 0|1,
  cl_crosshair_t: 0|1,
  cl_crosshair_recoil: 0|1,
  cl_crosshair_drawoutline: 0|1,
  cl_crosshair_outlinethickness: number,
  cl_crosshairusealpha: 0|1,
  cl_crosshairalpha: 0..255,
  cl_crosshaircolor_r: 0..255,
  cl_crosshaircolor_g: 0..255,
  cl_crosshaircolor_b: 0..255,
  cl_crosshair_dynamic_splitdist: number | null  // null = not emitted
}
```

The `restore` object additionally carries: `cl_crosshairgap_useweaponvalue`, `cl_fixedcrosshairgap`, `cl_crosshair_dynamic_maxdist_splitratio`, `cl_crosshair_dynamic_splitalpha_innermod`, `cl_crosshair_dynamic_splitalpha_outermod`, `cl_crosshair_dynamic_splitdist`.

**First-run seed:** create `presets.json` with one starter preset and the green restore (Section 9). Create empty `submissions.json` with `{ "submissions": [] }`.

---

## 7. Public Page (`/`)

Same crosshair editor as admin (sliders, color picker, live SVG preview), but **no preset list, no restore editor, no key bindings, no export button**.

**Layout:** centered card-like layout. Title + tagline ("Submit your cursed crosshair"). Editor on the left or top, live preview on the right or bottom — responsive.

**Editor controls** (full list in Section 8 — public uses the same set).

**Submit flow:**
1. User adjusts the crosshair, sees live preview.
2. Clicks **"Submit Crosshair"**.
3. Modal opens with:
   - "Your name" (required, 2–40 chars, trimmed)
   - "Crosshair name" (required, 2–60 chars)
   - Turnstile widget (dark theme)
   - Submit / Cancel buttons. Submit disabled until name + preset name are filled and Turnstile token is present.
4. POST to `/api/submissions` with `{ submitterName, presetName, params, cfTurnstileToken }`.
5. On success: thank-you state ("Thanks <name>, your crosshair was submitted for review"). Show "Submit another" button that resets the editor.
6. On failure: inline error, reset Turnstile.

Subtle link to `/admin/login` in the footer.

**Rate limit:** 10 submissions per hour per IP.

---

## 8. Admin Page (`/admin`)

Tabbed interface. Top bar: app name + "Admin" badge + logout button.

### Tab 1: Presets

Three-column layout on desktop, stacks on mobile.

**Left column — preset list:**
- Vertical list of all presets with mini SVG preview + name + style badge.
- Click selects for editing (highlighted).
- Per-row buttons: ↑ ↓ (reorder), 📋 (duplicate), 🗑 (delete with confirm).
- "by <name>" badge on presets that have `submittedBy`.
- Top: "+ Add Preset" button + counter "X presets".

**Center column — live preview:**
- Big SVG canvas (~500×500), dark background, renders the currently selected preset.
- Re-render on every parameter change.
- Approximation of CS2 rendering rules:
  - `cl_crosshairsize` = line length in px
  - `cl_crosshairthickness` = line width in px
  - `cl_crosshairgap` = distance from center (negative = overlap)
  - `cl_crosshairdot 1` = center square sized by thickness
  - `cl_crosshair_t 1` = top line removed
  - `cl_crosshair_drawoutline 1` + `cl_crosshair_outlinethickness` = black stroke around lines
  - `cl_crosshairalpha` (when `cl_crosshairusealpha 1`) = opacity 0–255
  - Color = RGB
  - Doesn't need pixel-perfect match, just clearly recognizable.

**Right column — editor:** all fields with both slider AND number input where a range makes sense; live-syncs to preview.
- Name (text)
- `cl_crosshairstyle` (0–5, segmented buttons)
- `cl_crosshairsize` (decimal, allow extreme values like 0.01 and 999)
- `cl_crosshairthickness` (decimal)
- `cl_crosshairgap` (allow -999 to 9999)
- `cl_crosshairdot`, `cl_crosshair_t`, `cl_crosshair_recoil` (toggles)
- `cl_crosshair_drawoutline` (toggle), `cl_crosshair_outlinethickness` (number)
- `cl_crosshairusealpha` (toggle), `cl_crosshairalpha` (0–255 slider)
- RGB color picker + 3 number inputs (0–255)
- Collapsible "Advanced" section: `cl_crosshair_dynamic_splitdist` (only emitted to `.cfg` when enabled)

**Top bar buttons:**
- "Edit Restore Crosshair" (modal with same editor for the green default; pre-filled with my green crosshair on first run — see below)
- "Key Bindings" (modal: next-key default `o`, restore-key default `p`)
- "Export .cfg" (triggers download of generated cfg)
- Auto-save indicator (debounced PUT to `/api/admin/state` on change, ~500ms).

**Restore (green default) seed values for first run:**
- `cl_crosshairstyle 4`, `cl_crosshairsize 0.8`, `cl_crosshairthickness 0.9`, `cl_crosshairgap -4.3`
- `cl_crosshairdot 0`, `cl_crosshair_t 0`, `cl_crosshair_recoil 0`
- `cl_crosshairgap_useweaponvalue 0`, `cl_fixedcrosshairgap 3`
- `cl_crosshair_drawoutline 1`, `cl_crosshair_outlinethickness 0`
- `cl_crosshaircolor 5`, RGB `0 / 255 / 91`, `cl_crosshairusealpha 0`, `cl_crosshairalpha 255`
- `cl_crosshair_dynamic_maxdist_splitratio 1`, `cl_crosshair_dynamic_splitalpha_innermod 0`, `cl_crosshair_dynamic_splitalpha_outermod 1`, `cl_crosshair_dynamic_splitdist 3`

### Tab 2: Submissions

Tab label shows pending count badge: "Submissions (3)".

- Table or card list of submissions, newest first.
- Each row shows: submitter name, preset name, relative submitted date ("2 hours ago"), mini SVG preview, action buttons.
- Filter dropdown: All / Pending / Approved / Rejected. Default = Pending.
- "Clear all approved/rejected" button.

**Per-row buttons:**
- **View / Edit** — opens the full editor in a modal, pre-loaded with the submission's params. Two save options:
  - "Save changes to submission" (keeps it `pending`, params updated)
  - "Approve & Add to Presets" (moves to `presets.json` with `submittedBy = submitterName`, marks submission `approved`, closes modal, switches to Presets tab with new entry selected)
- **Approve & Add** (without editing) — appends as-is to `presets.json`, marks `approved`.
- **Reject** — marks submission `rejected` (kept for the audit log; can be cleared with the cleanup button).
- **Delete** — removes the submission entirely (with confirm).

When a preset has `submittedBy`, append it to the echo line in the exported `.cfg` (Section 10).

---

## 9. API Endpoints

**Public (no auth):**
- `GET  /api/public/config` → `{ turnstileSiteKey: "..." | null }`
- `GET  /api/public/defaults` → starter param set so the public editor opens with sensible defaults
- `POST /api/submissions` → body `{ submitterName, presetName, params, cfTurnstileToken }`. Verifies Turnstile, validates input, appends to `submissions.json`. Returns `{ ok: true, id }` or `400`/`503`.

**Admin (require auth):**
- `GET    /api/admin/state` — full presets state
- `PUT    /api/admin/state` — replace state
- `POST   /api/admin/presets` / `PUT /api/admin/presets/:id` / `DELETE /api/admin/presets/:id`
- `POST   /api/admin/presets/:id/move` — body `{ direction: "up"|"down" }`
- `GET    /api/admin/submissions?status=pending|approved|rejected|all`
- `PUT    /api/admin/submissions/:id` — edit a submission
- `POST   /api/admin/submissions/:id/approve` — moves to presets, marks approved. Optional body `{ params, presetName }` to override before approving.
- `POST   /api/admin/submissions/:id/reject`
- `DELETE /api/admin/submissions/:id`
- `POST   /api/admin/submissions/cleanup` — purges all non-pending
- `GET    /api/admin/export` → returns the `.cfg` as `text/plain` with `Content-Disposition: attachment; filename="cursed_crosshair.cfg"`

---

## 10. Validation Rules (Server-Side)

Apply on submission AND admin edits:

- `submitterName`: 2–40 chars; trim; strip control chars + non-printable.
- `presetName`: 2–60 chars; same sanitization; **also strip `"` and `;`** (would break the echo line / inject into the cfg).
- params: clamp numeric ranges (use the schema in Section 6); reject NaN; coerce booleans (`0`/`1`/`true`/`false` → `0`/`1`); unknown keys ignored.
- **Reject any field value containing `"` or `;`** — cfg injection guard, server side, even if client sanitized.

---

## 11. `.cfg` Export Format — EXACT Structure Required

Source console has a per-alias string length limit, so each preset MUST be split into 3 chained aliases `_cN / _cNb / _cNc`. The output structure is non-negotiable:

```
// =======================================================
//            CURSED CROSSHAIR CONFIG
//            <N> PRESETS
// =======================================================

echo " "
echo "====================================="
echo "  CURSED CROSSHAIR LAEDT (<N> Presets)"
echo "====================================="

// --- KEY CONFIG (single line, unbind + bind for both keys) ---
alias _setup_keys "unbind <next>; bind <next> cursed_next; unbind <restore>; bind <restore> cursed_restore"

// --- PRESETS ---
// For each preset N (1-indexed):
//   alias _cN  "cl_crosshairstyle X; cl_crosshairsize X; cl_crosshairthickness X; cl_crosshairgap X; cl_crosshairdot X; cl_crosshair_t X; cl_crosshair_recoil X; _cNb"
//   alias _cNb "cl_crosshair_drawoutline X; cl_crosshair_outlinethickness X; cl_crosshairusealpha X; cl_crosshairalpha X[; cl_crosshair_dynamic_splitdist X]; _cNc"
//   alias _cNc "cl_crosshaircolor 5; cl_crosshaircolor_r X; cl_crosshaircolor_g X; cl_crosshaircolor_b X; echo [CURSED #N] <NAME>[ (by <submittedBy>)]"

// --- ROTATION ---
// alias _link1  "_c1;  alias cursed_next _link2"
// ... through _linkN  "_cN;  alias cursed_next _link1"
// alias cursed_next _link1

// --- RESTORE ---
// alias cursed_restore "cl_crosshairstyle X; cl_crosshairsize X; cl_crosshairthickness X; cl_crosshairgap X; cl_crosshairdot X; cl_crosshair_t X; _rb"
// alias _rb "cl_crosshair_recoil X; cl_crosshairgap_useweaponvalue X; cl_fixedcrosshairgap X; cl_crosshair_drawoutline X; cl_crosshair_outlinethickness X; _rc"
// alias _rc "cl_crosshaircolor 5; cl_crosshaircolor_r X; cl_crosshaircolor_g X; cl_crosshaircolor_b X; cl_crosshairusealpha X; cl_crosshairalpha X; _rd"
// alias _rd "cl_crosshair_dynamic_maxdist_splitratio X; cl_crosshair_dynamic_splitalpha_innermod X; cl_crosshair_dynamic_splitalpha_outermod X; cl_crosshair_dynamic_splitdist X; echo [NORMAL] Gruenes Crosshair zurueck"

// --- APPLY KEY BINDS ---
_setup_keys

// --- DEFAULT ON LOAD ---
// Loads green default, NOT preset #1
cursed_restore

echo " "
echo "====================================="
echo "  <next> = naechstes cursed (<N> total)"
echo "  <restore> = gruenes crosshair zurueck"
echo "====================================="
echo " "
```

**Critical details:**
- Always emit `unbind <key>; bind <key> cmd` so re-exec doesn't conflict with previous binds.
- `cursed_next` pointer is initialized to `_link1` so the first keypress shows preset #1.
- On config load, `cursed_restore` runs (green default) — NOT the first cursed preset.
- If a preset has `submittedBy`, append ` (by <submittedBy>)` to the echo line so it shows ingame on rotation.
- `cl_crosshair_dynamic_splitdist` only emitted on `_cNb` when present in the preset's params.

---

## 12. Cloudflare Tunnel Deployment

This app is exposed publicly via a Cloudflare Tunnel (the user already runs `cloudflared`). The tunnel terminates TLS and forwards plain HTTP to the container on port 3000.

**Required app behavior:**
- `app.set('trust proxy', true)` in Express. Otherwise:
  - `req.ip` will be the tunnel/loopback address, not the real client.
  - `express-rate-limit` will rate-limit everyone as a single IP.
  - Secure cookies will be rejected because Express won't recognize the connection as HTTPS.
- Read client IP from `CF-Connecting-IP` header for rate limit keys (it's the canonical Cloudflare-injected real IP). Fall back to `req.ip` if missing.
- Set the session cookie with `secure: true` and `sameSite: 'lax'`. With `trust proxy` enabled and Cloudflare forwarding `X-Forwarded-Proto: https`, Express will allow this.
- Do NOT set the cookie domain to anything specific; let it default to the host.

**Cloudflare Tunnel config (user-side, NOT in repo)** — add a public hostname pointing to `http://<unraid-ip>:3000` in the Cloudflare Zero Trust dashboard, e.g. `crosshair.patriq.de`. The README should mention this.

**Hardening recommendations** (in README, not enforced in code):
- Put the `/admin/*` paths behind a Cloudflare Access policy (email/Google/etc.) for defense in depth.
- Or use a Cloudflare WAF rule to allow `/admin/*` only from specific IPs.

---

## 13. Docker Setup

**`Dockerfile`:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

**`docker-compose.yml`:**
```yaml
services:
  crosshair-gen:
    build: .
    image: ghcr.io/<owner>/cursed-crosshair-generator:latest
    container_name: cursed-crosshair-generator
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - PORT=3000
      - DATA_DIR=/data
      - ADMIN_USER=${ADMIN_USER:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
      - SESSION_SECRET=${SESSION_SECRET:-}
      - TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY:-}
      - TURNSTILE_SECRET_KEY=${TURNSTILE_SECRET_KEY:-}
    restart: unless-stopped
```

**`.dockerignore`:** `node_modules`, `.git`, `data`, `.env`, `README.md` (optional).

**`.env.example`:**
```
ADMIN_USER=admin
ADMIN_PASSWORD=changeme
SESSION_SECRET=
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

---

## 14. GitHub Actions

Add `.github/workflows/docker-publish.yml` that builds and pushes to GitHub Container Registry on push to `main` and on tags.

- Use `docker/build-push-action`.
- Image: `ghcr.io/<owner>/cursed-crosshair-generator:latest` and tag-based versions.
- Permissions: `contents: read`, `packages: write`.
- Login with `${{ secrets.GITHUB_TOKEN }}`.

After this workflow runs successfully, I can pull `ghcr.io/<owner>/cursed-crosshair-generator:latest` directly in Unraid.

---

## 15. README.md Requirements

- Project description + screenshot placeholder.
- **Quick start (local):** `cp .env.example .env`, fill in values, `docker compose up -d`.
- **Unraid deployment** — two paths:
  1. **Pull from GHCR (recommended):** Repository = `ghcr.io/<owner>/cursed-crosshair-generator:latest`, network type = bridge, port mapping `3000:3000`, volume mapping `/mnt/user/appdata/cursed-crosshair-generator` → `/data`. List all required env vars with descriptions.
  2. **Build from source on Unraid:** clone repo to `/mnt/user/appdata/`, run `docker compose up -d`.
- **Cloudflare Tunnel section:** instructions to add a public hostname in the Zero Trust dashboard pointing to `http://<unraid-ip>:3000`. Note that TLS is handled by the tunnel and the app must run with `trust proxy` enabled (already configured in code).
- **Turnstile setup:** how to create a site at https://dash.cloudflare.com/?to=/:account/turnstile, copy site key + secret key into env vars. Note the "graceful degradation" behavior when keys are missing.
- **First-run admin password:** if `ADMIN_PASSWORD` is unset, the app generates one and writes it to `/data/admin-credentials.txt`. Tell the user to read it via `docker logs <container>` or by mounting/inspecting the file.
- **Optional hardening:** Cloudflare Access on `/admin/*`.
- API documentation section (the endpoints from Section 9).
- Note that re-execing the generated cfg in CS2 is safe (unbind+bind pattern).

---

## 16. UI Details

- Dark gaming theme, consistent across public + admin.
- **Public page header:** app name + tagline "Submit your cursed crosshair". No mention of admin functionality except a subtle footer link.
- **Admin page header:** app name + "Admin" badge + logout button.
- **Login page:** minimal, centered card.
- All forms use vanilla JS fetch + JSON. No frameworks.
- Toast notifications for save/approve/delete actions.
- Mobile-responsive: editor and preview stack on narrow viewports.

---

## 17. Acceptance Criteria

1. **Local:** `docker compose up -d` → app reachable on `http://<unraid-ip>:3000`.
2. **First-run state:** Fresh start shows one default preset + green restore pre-loaded; admin password is generated and visible in logs/file.
3. **Public submit (no login):** Visiting `/` works without auth. I can build a crosshair, hit Submit, fill name + preset name, pass Turnstile, and see the thank-you state. Submission appears in `submissions.json`.
4. **Captcha:** Submitting without a Turnstile token returns 400. Disabling Turnstile env vars logs a warning and skips verification (for dev).
5. **Admin login:** `/admin` redirects to `/admin/login`. Wrong creds fail. Correct creds (from env or generated) land me on the dashboard.
6. **Admin Submissions tab:** Lists my submission. I can View/Edit it (full editor), tweak it, and Approve. It now appears in the Presets tab with a "by <name>" badge.
7. **Live editing:** Adjusting any slider live-updates the SVG preview in both public and admin editors.
8. **Persistence:** Add / duplicate / reorder / delete persist across container restarts (data volume).
9. **Export:** "Export .cfg" downloads a working `cursed_crosshair.cfg` that, when placed in CS2's cfg folder and `exec`'d, loads the green crosshair on load and lets `o`/`p` cycle through presets / restore. Approved submissions appear with `(by <name>)` in echo lines.
10. **Logout** clears the session; `/admin` redirects back to login.
11. **Rate limits:** 5 logins / 10 submissions per window per IP work correctly behind the tunnel (real IP via `CF-Connecting-IP`).
12. **Cloudflare Tunnel:** App runs behind tunnel with `trust proxy`, secure cookies, real-IP rate limiting, all working over HTTPS via the tunnel hostname.
13. **GitHub repo `cursed-crosshair-generator` exists on GitHub with all code pushed to `main`.**
14. **GH Actions workflow builds successfully** on first push and publishes to GHCR.

---

## 18. Final Output

After completion, print to the terminal:

- The exact `docker compose up -d` command
- All required env vars with notes on which are mandatory (Turnstile keys for prod, `ADMIN_PASSWORD` if you want a known one)
- The public submit URL and admin login URL (relative to `<unraid-ip>:3000`, plus a note that the tunnel hostname will be the public-facing one)
- The location of the auto-generated admin password file inside the container if `ADMIN_PASSWORD` was unset
- The exact GHCR image path for pulling on Unraid

---

Build it. Commit incrementally with sensible messages: auth scaffolding → public submit flow → Turnstile integration → admin presets editor → admin submissions tab → export logic → Docker + CI → README. Push to `main` when done.
