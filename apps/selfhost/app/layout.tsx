import { LASTFIND_FAVICON } from '@/lib/lastfind-brand';
export { default } from '@/components/root-layout';
export const metadata = {
  title: { default: 'Lastfind — AI visibility', template: '%s | Lastfind' },
  description:
    'Track AI visibility, competitors and sources with your own Lastfind installation.',
  icons: {
    icon: [
      { url: LASTFIND_FAVICON.svg, type: 'image/svg+xml' },
      { url: LASTFIND_FAVICON.ico, sizes: '48x48 32x32 16x16', type: 'image/x-icon' },
    ],
    apple: { url: LASTFIND_FAVICON.apple, sizes: '180x180', type: 'image/png' },
  },
};
