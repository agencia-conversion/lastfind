import { Plus_Jakarta_Sans, Geist_Mono } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import { LocaleProvider } from '@/lib/i18n';
import { Toaster } from '@/components/ui/toast';
import { ApplicationStyles } from './application-styles';
// Variable face (wght 200–800). /app uses tokens 450/550/600 on this axis;
// home/blog keep their own CSS.
const jakartaSans = Plus_Jakarta_Sans({
  variable: '--font-jakarta-sans',
  subsets: ['latin'],
  display: 'swap',
});
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});
export default async function RootLayout({
  children,
  messages,
  head,
}: {
  children: React.ReactNode;
  messages?: Record<string, string>;
  /** Extra tags for <head> that the metadata API cannot express (a page's JSON-LD), so crawlers find them there. */
  head?: React.ReactNode;
}) {
  const routeLocale = (await headers()).get('x-lastfind-public-route-locale');
  const locale =
    routeLocale === 'pt-BR' || routeLocale === 'en'
      ? routeLocale
      : (await cookies()).get('lastfind_locale')?.value === 'pt-BR'
        ? 'pt-BR'
        : 'en';
  return (
    <html lang={locale}>
      {/* oxlint-disable-next-line next/no-head-element -- App Router root layout: <head> is where these tags belong (next/head is the Pages Router). */}
      {head ? <head>{head}</head> : null}
      <body
        className={`${jakartaSans.variable} ${geistMono.variable} antialiased`}
      >
        <ApplicationStyles />
        <LocaleProvider initialLocale={locale} messages={messages}>
          <Toaster>{children}</Toaster>
        </LocaleProvider>
      </body>
    </html>
  );
}
