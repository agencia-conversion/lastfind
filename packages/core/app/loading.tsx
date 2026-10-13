'use client';
import { LASTFIND_APP_ICON } from '@/lib/lastfind-brand';
import { useI18n } from '@/lib/i18n';
export default function Loading() {
  const { locale } = useI18n();
  return (
    <main className="loading-page" aria-busy="true">
      <output className="lastfind-loading" aria-live="polite">
        <span className="loading-telescope" aria-hidden="true">
          {/* Current shared telescope mark; motion uses only a CSS transform. */}
          {/* eslint-disable-next-line next/no-img-element */}
          <img src={LASTFIND_APP_ICON.src} alt="" width={64} height={64} />
        </span>
        <span>
          {locale === 'en' ? 'Loading Lastfind…' : 'Carregando Lastfind…'}
        </span>
      </output>
    </main>
  );
}
