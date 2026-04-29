# Cursed Crosshair Debug Tooling

`tools/cs2-debug.js` — generate CS2 cfgs, launch the game, capture screenshots, and produce a side-by-side compare HTML (SVG preview vs in-game screenshot).

**VAC-safe.** The tool only:
- writes `.cfg` files into your CS2 cfg folder
- starts CS2 via the `steam://rungameid/730` URL
- watches the screenshots folder and copies new JPGs

It never injects keystrokes, modifies game memory, or hooks the CS2 process.

---

## Quick start

The web app must be running first (`http://localhost:3000` or wherever).

```bash
# 1) write debug cfgs into CS2's cfg folder + per-preset cfgs
node tools/cs2-debug.js prepare

# 2) launch CS2 (optional — you can also start it from Steam)
node tools/cs2-debug.js launch

# 3) in CS2: load a workshop map (e.g. aim_botz), open console, type:
#       exec cursed_debug
#    Press F1..F8 to switch crosshairs, F11 for screenshot, F12 for restore green

# 4) (in another terminal) watch the screenshots folder live
node tools/cs2-debug.js watch
# Ctrl+C when done.

# 5) generate the compare HTML
node tools/cs2-debug.js compare
```

Or in one go:

```bash
node tools/cs2-debug.js all
# Press Ctrl+C in the terminal when finished taking screenshots.
```

---

## Subcommands

| Command | What it does |
|---|---|
| `detect` | Print detected Steam / CS2 paths and exit. |
| `prepare` | Write `cursed_debug.cfg` plus one cfg per preset into CS2's cfg dir. Bind F1–F8 to presets 1–8, F11 to `screenshot`, F12 to restore. |
| `launch` | Start CS2 via `steam://rungameid/730` (uses Steam — Steam must be running). |
| `watch` | Poll the CS2 screenshots dir, copy any new JPG/TGA into `data/debug/screenshots/`. Ctrl+C to stop. |
| `compare` | Generate `data/debug/compare.html` (SVG preview vs in-game screenshot, side-by-side) and open it in your browser. |
| `all` | `prepare` → `launch` → `watch` → `compare` chained. |
| `clean` | Remove generated cfgs and the `data/debug/` directory. |

---

## Options

```
--app-url URL        Where the running app is (default http://localhost:3000)
--admin-user USER    Admin user (default $ADMIN_USER or "admin")
--admin-pass PASS    Admin password (default $ADMIN_PASSWORD or "testpass")
--steam PATH         Override Steam install path
--cfg-dir PATH       Override CS2 cfg dir (auto-detected from Steam)
--shots-dir PATH     Override CS2 screenshots dir
```

---

## In-game workflow

1. Start CS2 and load any map. Workshop **aim_botz** is recommended (free, downloads via the workshop search).
2. Open the developer console (default key: `~` or backtick — enable in Game Settings → Game → Enable Developer Console).
3. Type: `exec cursed_debug` and press Enter. You will see:
   ```
   =============================================
     CURSED CROSSHAIR DEBUG MODE
     N presets bound to F1..FN
     F11 = take screenshot
     F12 = restore green default
   =============================================
   Ready. Press F1..F<N> to switch crosshair, F11 for screenshot.
   ```
4. Press F1, F2, … to cycle through your presets. Each key prints `[DEBUG] active=#N <name>` to the console so you can confirm the switch.
5. Press F11 to take a screenshot. CS2 writes it as JPG into `<csgo>/screenshots/`.

---

## Adjusting the web preview to match CS2

The Live Preview now has four controls in addition to the background selector:

| Control | What it does |
|---|---|
| **Resolution** | Your CS2 display resolution (e.g. `1920x1080`). |
| **Aspect** | The CS2 *render* aspect (e.g. `4:3`). |
| **Mode** | `Native` (no stretching), `Stretched` (4:3 stretched on a 16:9 display), or `Black bars`. |
| **Zoom** | Visual zoom in the preview only; doesn't affect anything saved or exported. `1×` = pixel-perfect 1:1 with CS2. |

For the typical "**4:3 stretched**" setup:
- Aspect: `4:3`
- Mode: `Stretched`
- Resolution: your real display resolution (e.g. `1920x1080`)
- Zoom: pick whatever makes the crosshair comfortable to inspect

Stretched mode multiplies the X axis by `(display_aspect / source_aspect)` — so on a 16:9 display with a 4:3 game render, the crosshair gets ~33% wider horizontally, exactly like in-game. Vertical thickness is unchanged.

---

## Compare HTML

`data/debug/compare.html` shows for every keybind slot:

- left: SVG preview of the preset (using current zoom + stretch settings)
- right: any in-game screenshots that arrived during the watch window

Screenshots are matched to slots in arrival order (the simplest heuristic). If you only press F-keys in order F1 → F11 → F2 → F11 → … the matching is correct. If you take screenshots out of order you can rename them in `data/debug/screenshots/` before running `compare` again.

---

## Cleaning up

```bash
node tools/cs2-debug.js clean
```

This removes:
- `cursed_debug*.cfg` files from CS2's cfg dir
- The whole `data/debug/` directory

The web app's main `data/presets.json` and `data/submissions.json` are untouched.
