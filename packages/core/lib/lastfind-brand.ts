// Shared app icon: the official 3D glass telescope mark from the public
// site's brand lockup, served from this shared public directory so both
// editions render the exact same asset inside the logged-in app.
export const LASTFIND_APP_ICON = {
  src: '/lastfind/brand/icon-3d.png',
  alt: 'Lastfind',
} as const;

// Favicon: the official `Lastfind/Brand/Favicon` mark from the brandbook
// (Figma node 6-24), exported verbatim to `docs/brand/assets/favicon-oficial.svg`
// and served from the shared public directory. The ICO and touch icon are
// rasters of the same asset, not redrawn (see docs/brand/README.md).
export const LASTFIND_FAVICON = {
  svg: '/favicon.svg',
  ico: '/favicon.ico',
  apple: '/apple-touch-icon.png',
} as const;
