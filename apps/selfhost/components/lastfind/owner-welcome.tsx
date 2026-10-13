'use client';
import { LASTFIND_APP_ICON } from '@/lib/lastfind-brand';
import { LanguageSwitcher, useI18n } from '@/lib/i18n';
import { OwnerLogin } from './owner-login';
export function OwnerWelcome() {
  const { locale, conversionUrl } = useI18n();
  const l = (en: string, pt: string) => (locale === 'en' ? en : pt);
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-2 text-xl font-semibold">
          {/* eslint-disable-next-line next/no-img-element */}
          <img src={LASTFIND_APP_ICON.src} alt="" width={40} height={40} />
          lastfind.
        </a>
        <LanguageSwitcher compact />
      </div>
      <a
        href={conversionUrl}
        className="text-xs text-muted-foreground"
        target="_blank"
        rel="noopener noreferrer"
      >
        by Conversion
      </a>
      <h1 className="mt-12 text-3xl font-semibold">
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
      <a
        href="/app/preview"
        className="mt-6 block rounded-lg border border-border px-4 py-3 text-center text-sm font-medium text-primary hover:bg-sidebar-accent"
      >
        {l(
          'Explore the new interface with sample data',
          'Explorar a nova interface com dados de exemplo',
        )}
      </a>
      <a href="/docs" className="mt-6 inline-block text-primary">
        {l('Installation guide', 'Guia de instalação')}
      </a>
    </main>
  );
}
