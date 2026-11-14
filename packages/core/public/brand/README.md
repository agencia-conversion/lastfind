# Lastfind brand asset

The canonical current mark is `../lastfind/brand/icon-3d.png`: a transparent 96 × 96 PNG, shared by the public header, application, onboarding and loading screens. `lib/lastfind-brand.ts` supplies its public path.

This is the current public-site telescope identified and approved as the product-wide reference on September 11, 2026. Its SHA256 is `c1d21af10da425517a6e99cbd45f4c0be333b8938085d0dd2fabf7b8553d460d`.

The superseded 1254px telescope PNG and flat SVG were removed from the source assets and publication manifest. This change reuses the approved mark without redrawing, recoloring or upscaling it.

## Favicon

`../favicon.svg` is the official `Lastfind/Brand/Favicon` mark from the brandbook, copied verbatim. `../favicon.ico` (16/32/48, 32-bit with alpha) and `../apple-touch-icon.png` (180 × 180, white background because iOS discards alpha) are Chromium rasters of that same SVG, generated without redrawing. Both editions declare the three files through `lib/lastfind-brand.ts` (`LASTFIND_FAVICON`).

## Animated telescope

`../lastfind/brand/telescope/{light,dark}.{mp4,webp}` animate one 2048 px render of the approved telescope (GPT Image 2.5 through Higgsfield, generated on October 28, 2026 from the 96 px mark as reference, same design, framing and colors). On October 29, 2026 Kling 3.0 Omni (frames) through Higgsfield animated that render, starting and ending on it, once on white (`light`, 384 px) and once on the night sky (`dark`, 192 px): the tube scans toward the star, which turns and twinkles. Five seconds, a seamless loop, H.264 without sound; the poster is the first frame. `components/lastfind/presentation/animated-telescope.tsx` plays the film blended into its backdrop (multiply on white, screen on the sky), so it needs no alpha; with reduced motion no source matches and the poster stays. The 96 px `icon-3d.png` remains the static mark.
