# Cursed Crosshair Debug Tooling

Two ways to check the app's preview against the real game:

1. **Visual side-by-side** — `tools/cs2-debug.js`: generate CS2 cfgs for the current presets, launch the game, capture screenshots, and open a compare page (app preview vs in-game screenshot).
2. **Pixel-exact comparison** — `tools/calib-codes.mjs` → `tools/calib-expected.mjs` → `tools/calib-compare.py`: fixed calibration cases, imported as share codes, compared pixel by pixel against PNG screenshots (see [Pixel-exact comparison](#pixel-exact-comparison)).

Both work on the CS2 crosshair system since the 2026-09-22 update (18 pixel-based cvars, `public/js/cvars.js`). Everything under `data/` (screenshots, cfg state, calibration results) is git-ignored.

**VAC-safe.** The tools only:
- write `.cfg` files into your CS2 cfg folder
- start CS2 via the `steam://rungameid/730` URL
- watch the screenshots folder and copy new files

They never inject keystrokes, modify game memory, or hook the CS2 process.

Requires Node >= 22.12 (the tools load the shared browser modules `public/js/cvars.js` / `preview.js`).

---

## Quick start

The web app must be running first (`http://localhost:3000` or wherever — pass `--app-url`).

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

# 5) generate and serve the compare page (Ctrl+C to stop the server)
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
| `prepare` | Write `cursed_debug.cfg` plus one cfg per preset (all 18 cvars, `cl_crosshair_screen_height` last) into CS2's cfg dir. Bind F1–F8 to presets 1–8, F11 to `screenshot`, F12 to restore. |
| `launch` | Start CS2 via `steam://rungameid/730` (uses Steam — Steam must be running). |
| `watch` | Poll the CS2 screenshots dir, copy any new JPG/PNG/TGA into `data/debug/screenshots/`. Ctrl+C to stop. |
| `compare` | Generate `data/debug/compare.html` and serve it on `http://127.0.0.1:3777/` (app preview vs in-game screenshot, side by side); opens it in your browser. Ctrl+C to stop. |
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
--port N             Port of the local compare server (default 3777)
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
5. Press F11 to take a screenshot. CS2 writes it into `<csgo>/screenshots/`.

---

## The web preview and CS2

The preview is no longer an approximation: `public/js/preview.js` is a port of the game's crosshair pixel shader plus the geometry code from the client (`csgo_crosshair.cpp`), rendered in real game pixels and blended in linear light like the game. The Live Preview controls (shared by public + admin, persisted in localStorage):

| Control | What it does |
|---|---|
| **Background** | Map screenshot the crosshair is composited onto (affects blending exactly like a real background would). |
| **Resolution** | Simulated *game* resolution (default 1280×960). The cvars are pixel values relative to `cl_crosshair_screen_height`; the game scales them with `current_height / screen_height` (same rounding), so the same preset looks different at 960p and 1080p. |
| **Zoom** | Visual zoom only (viewBox crop around the centre); doesn't affect anything saved or exported. `Original` = whole render surface, 1 SVG unit = 1 game pixel. |
| **Spread** / **Dynamic Preview** | Simulated weapon spread in pixels for the dynamic styles (default 7 = standing still with a rifle, AK-47 at 1080p; 0 = knife), or an animation of walk/stop/shoot like the Dynamic Preview in the CS2 settings. |

There are no display-aspect / stretch settings any more (the old `4:3 stretched` emulation is gone): what you see is the game's render surface at the chosen resolution.

---

## Compare page

`data/debug/compare.html` shows for every keybind slot:

- left: the preset rendered by the app's real renderer (`renderCrosshair` from `public/js/preview.js`, loaded as an ES module) at the preview's simulated resolution (default 1280×960), with a zoom selector
- right: any in-game screenshots that arrived during the watch window

`compare` serves the page from a small local HTTP server (`http://127.0.0.1:3777/`) that proxies `/static/*` to the running app, because the app's `/static` route sends no CORS headers and a `file://` page could not import the module otherwise. The app must be running while the page is open.

Take screenshots with the console command `screenshot` (dumps the real render buffer) or as a PNG at native resolution (Win+PrtScn / Xbox Game Bar). Do not use scaled or recompressed captures — the point is to compare pixels 1:1.

Screenshots are matched to slots in arrival order (the simplest heuristic). If you only press F-keys in order F1 → F11 → F2 → F11 → … the matching is correct. If you take screenshots out of order you can rename them in `data/debug/screenshots/` before running `compare` again.

---

## Pixel-exact comparison

For a numeric check (missing / extra / wrongly coloured pixels) instead of eyeballing, use the three calibration tools. Python 3 with `numpy` and `Pillow` is needed for the last step.

```bash
# 1) generate the calibration share codes (fixed test cases, magenta, Full Outline)
node tools/calib-codes.mjs                      # -> data/calibration-v2/codes.md + codes.json

# 2) in CS2: import each code (Settings -> Crosshair -> Share Code), take a screenshot,
#    save as data/calibration-v2/shots/NN.png   (NN = case number from codes.md: 01.png, 02.png, ...)

# 3) render the expected pixels for every 1080p case
node tools/calib-expected.mjs data/calibration-v2     # -> data/calibration-v2/expected/NN.f32 + meta.json

# 4) compare and write diff images + report
python3 tools/calib-compare.py data/calibration-v2    # -> data/calibration-v2/diff/NN.png + report.json
```

Screenshot procedure for step 2:

- Play at **1920×1080 native** (no stretching, no scaling). Two cases in `codes.md` are marked for 1280×960: import them at that resolution, then copy the share code back and take the shot with the console command `screenshot`.
- Save as **PNG**, not JPG — Win+PrtScn (Windows saves to `Pictures/Screenshots`) or Xbox Game Bar (Win+Alt+PrtScn) both produce lossless PNGs of the full screen.
- Stand still, **knife** out (no weapon spread), and aim at the **sky or a plain, evenly lit wall** so the background around the centre is a smooth gradient — `calib-compare.py` estimates the background from the edge of the crop.
- Cases that say "knife AND rifle" (Dynamic Quad / Dynamic Circle) want two shots; the comparison uses the knife one (spread 0).
- File names are exactly `NN.png` (two digits) under `data/calibration-v2/shots/`.

`calib-compare.py` composites the expected crosshair over the estimated background using the game's blend model (shader output premultiplied; `SRC_ALPHA / ONE_MINUS_SRC_ALPHA` in linear light on an sRGB framebuffer) and prints per case: expected pixels, pixels found, missing, extra, wrong colour, with the first few coordinates relative to the screen centre. Diff images are 4× magnified panels: screenshot | expected | differences (red = missing, yellow = extra, cyan = wrong colour).

---

## Cleaning up

```bash
node tools/cs2-debug.js clean
```

This removes:
- `cursed_debug*.cfg` files from CS2's cfg dir
- The whole `data/debug/` directory

The web app's main `data/presets.json` and `data/submissions.json` are untouched. `data/calibration-v2/` is left alone.
