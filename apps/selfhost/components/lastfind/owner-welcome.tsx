'use client';
import { LastfindLogo } from '@/components/lastfind/lastfind-logo';
import { useI18n } from '@/lib/i18n';
import { LanguageMenu } from '@/components/lastfind/public-menu';
import { OwnerLogin } from './owner-login';
export function OwnerWelcome() {
  const { locale, conversionUrl, setLocale } = useI18n();
  const l = (en: string, pt: string) => (locale === 'en' ? en : pt);
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <a href="/" aria-label={l('Lastfind, home', 'Lastfind, início')} className="flex items-center gap-2">
          <LastfindLogo style={{ height: 40, width: 126 }} />
        </a>
        <LanguageMenu locale={locale} instance="page" onSelect={setLocale} />
      </div>
      <a
        href={conversionUrl}
        className="text-body text-muted-foreground"
        target="_blank"
        rel="noopener noreferrer"
      >
        by Conversion
      </a>
      <h1 className="mt-12 text-title">
        {l(
          'Your AI visibility workspace',
          'Seu workspace de visibilidade em IA',
        )}
      </h1>
      <p className="mt-4 mb-8 text-muted-foreground">
        {l(
          'Sign in with the owner key configured for this installation.',
          'Entre com a chave do proprietário configurada nesta instalação.',
        )}
      </p>
      <OwnerLogin />
      <a href="/docs" className="mt-6 inline-block text-primary">
        {l('Installation guide', 'Guia de instalação')}
      </a>
    </main>
  );
}
