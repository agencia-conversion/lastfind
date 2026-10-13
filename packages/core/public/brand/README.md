# Lastfind brand asset

The canonical current mark is `../lastfind/brand/icon-3d.png`: a transparent 96 × 96 PNG, shared by the public header, application, onboarding and loading screens. `lib/lastfind-brand.ts` supplies its public path.

This is the current public-site telescope identified and approved as the product-wide reference on September 11, 2026. Its SHA256 is `c1d21af10da425517a6e99cbd45f4c0be333b8938085d0dd2fabf7b8553d460d`.

The superseded 1254px telescope PNG and flat SVG were removed from the source assets and publication manifest. This change reuses the approved mark without redrawing, recoloring or upscaling it. The original brand system remains available at https://www.figma.com/design/UBxACs4OUG1GDDhxOcOdHa/Lastfind .

## Favicon

`../favicon.svg` is the official `Lastfind/Brand/Favicon` mark from the brandbook (Figma node `6-24`), copied verbatim from `docs/brand/assets/favicon-oficial.svg`. `../favicon.ico` (16/32/48, 32-bit with alpha) and `../apple-touch-icon.png` (180 × 180, white background because iOS discards alpha) are Chromium rasters of that same SVG, generated without redrawing. Both editions declare the three files through `lib/lastfind-brand.ts` (`LASTFIND_FAVICON`). Real-size raster evidence lives in `docs/qa/shots/con-79/`.
