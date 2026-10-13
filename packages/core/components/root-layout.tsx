import { Plus_Jakarta_Sans, Geist_Mono } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import { LocaleProvider } from '@/lib/i18n';
import { ApplicationStyles } from './application-styles';
// Variable face (wght 200–800). /app uses named 400/500/600 only so the
// browser never synthesizes a missing file; home/blog keep their own CSS.
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
}: {
  children: React.ReactNode;
  messages?: Record<string, string>;
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
      <body
        className={`${jakartaSans.variable} ${geistMono.variable} antialiased`}
      >
        <ApplicationStyles />
        <LocaleProvider initialLocale={locale} messages={messages}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
