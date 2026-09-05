import { Plus_Jakarta_Sans, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { LocaleProvider } from '@/lib/i18n';
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
  const locale =
    (await cookies()).get('lastfind_locale')?.value === 'pt-BR'
      ? 'pt-BR'
      : 'en';
  return (
    <html lang={locale}>
      <body
        className={`${jakartaSans.variable} ${geistMono.variable} antialiased`}
      >
        <LocaleProvider initialLocale={locale} messages={messages}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
