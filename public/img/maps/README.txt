Map preview backgrounds
=======================

Drop image files here named after the map slug. Files are loaded from
/static/img/maps/<slug>.<ext> — the loader probes these extensions in
order and uses the first one it finds: jpg, jpeg, png, webp.

Recommended: 1440x1080 or higher in 4:3 aspect (the preview is 4:3).
JPG is preferred (smaller files); PNG/WebP also work.

Recognised slugs (any of the above extensions):
  dust2
  mirage
  inferno
  nuke
  ancient
  anubis
  vertigo
  overpass
  cache

If no image is found for a slug, the app falls back to a CSS gradient
that approximates the map's color palette.
