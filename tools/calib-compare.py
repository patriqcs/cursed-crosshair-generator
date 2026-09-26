#!/usr/bin/env python3
"""Vergleicht erwartete Crosshair-Pixel (tools/calib-expected.mjs) mit CS2-Screenshots.
   python3 tools/calib-compare.py data/calibration-v2 [outdir]
Pro Fall: Hintergrund aus dem Ausschnittrand geschaetzt, erwartetes Bild darueber
komponiert, Pixel mit Farbabstand > Schwelle als Abweichung gezaehlt; Diff-Bilder."""
import json, sys, os
import numpy as np
from PIL import Image

d = sys.argv[1] if len(sys.argv) > 1 else 'data/calibration-v2'
out = sys.argv[2] if len(sys.argv) > 2 else f'{d}/diff'
os.makedirs(out, exist_ok=True)
meta = json.load(open(f'{d}/expected/meta.json'))
TH = 12  # Farbabstand (0..441) ab dem ein Pixel als abweichend gilt
report = []
for m in meta:
    n, x0, y0, w, h = m['n'], m['x0'], m['y0'], m['w'], m['h']
    shot = np.asarray(Image.open(f'{d}/shots/{n}.png').convert('RGB'), dtype=np.float32)
    roi = shot[y0:y0+h, x0:x0+w]
    exp = np.frombuffer(open(f'{d}/expected/{n}.f32','rb').read(), dtype=np.float32).reshape(h, w, 4)
    # Hintergrund: Zeilen-/Spaltenweise linear aus dem Rand interpoliert (Himmelverlauf)
    top, bot = roi[0], roi[-1]
    ty = np.linspace(0, 1, h)[:, None, None]
    bg = top[None] * (1 - ty) + bot[None] * ty
    # Blend-Modell des Spiels (aus Screenshots belegt): Shader liefert premultiplied rgb_pm und a;
    # Blend SRC_ALPHA/ONE_MINUS_SRC_ALPHA in linearem Licht auf sRGB-Framebuffer:
    #   out_lin = rgb_pm * a + dst_lin * (1 - a),  rgb_pm = srgb2lin(farbe) * a
    a = exp[..., 3:4]
    def s2l(v):
        v = v / 255.0
        return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
    def l2s(l):
        l = np.clip(l, 0, 1)
        return 255 * np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055)
    rgb_pm = exp[..., :3]            # bereits linear + premultiplied (calib-expected.mjs)
    comp = l2s(rgb_pm * a + s2l(bg) * (1 - a))
    dist = np.sqrt(((comp - roi) ** 2).sum(-1))
    bad = dist > TH
    # nur Pixel zaehlen, die im Erwartungsbild ODER im Screenshot vom Hintergrund abweichen
    shot_fg = np.sqrt(((roi - bg) ** 2).sum(-1)) > TH
    exp_fg = a[..., 0] > 0.2
    missing = (exp_fg & ~shot_fg)     # erwartet, aber im Screenshot nicht da
    extra = (shot_fg & ~exp_fg)       # im Screenshot, aber nicht erwartet
    wrong = bad & exp_fg & shot_fg    # beide da, aber andere Farbe
    def coords(mask, k=12):
        ys, xs = np.nonzero(mask)
        return [(int(x - w//2), int(y - h//2)) for x, y in list(zip(xs, ys))[:k]]
    rep = dict(n=n, expected_px=int(exp_fg.sum()), shot_px=int(shot_fg.sum()), missing=int(missing.sum()),
               extra=int(extra.sum()), wrong=int(wrong.sum()), missing_at=coords(missing), extra_at=coords(extra), wrong_at=coords(wrong))
    report.append(rep)
    # Diff-Bild: links Screenshot, Mitte erwartet, rechts Abweichungen (rot fehlt, gelb extra, cyan falsch) — 6x vergroessert
    vis = np.repeat(roi[..., None, :], 1, axis=2)[:, :, 0]
    diff = roi.copy()
    diff[missing] = [255, 0, 0]; diff[extra] = [255, 255, 0]; diff[wrong] = [0, 255, 255]
    panel = np.concatenate([roi, comp, diff], axis=1).clip(0, 255).astype(np.uint8)
    Image.fromarray(panel).resize((panel.shape[1]*4, panel.shape[0]*4), Image.NEAREST).save(f'{out}/{n}.png')
    print(f"{n}: erwartet {rep['expected_px']:5d} px, im Shot {rep['shot_px']:5d} | fehlt {rep['missing']:4d} extra {rep['extra']:4d} falsch {rep['wrong']:4d}"
          + (f"  fehlt@{rep['missing_at'][:4]} extra@{rep['extra_at'][:4]} falsch@{rep['wrong_at'][:4]}" if rep['missing'] or rep['extra'] or rep['wrong'] else "  OK"))
json.dump(report, open(f'{out}/report.json', 'w'), indent=1)
