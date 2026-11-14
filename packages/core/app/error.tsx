'use client';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { isStaleChunk, reloadForNewVersion } from '@/lib/client';
export default function ErrorPage({ error, reset }: { error?: Error; reset: () => void }) {
  const { locale } = useI18n();
  // A part of the app that a tab opened before a deploy can no longer load: the new version, in place of this page. Any
  // other failure (the database busy for a moment, a deploy rolling out) is tried again once by itself after a short wait;
  // at most once a minute (reloadForNewVersion), so a failure that stays still shows this page.
  useEffect(() => {
    if (isStaleChunk(error)) return void reloadForNewVersion();
    const timer = window.setTimeout(reloadForNewVersion, 2000);
    return () => window.clearTimeout(timer);
  }, [error]);
  const l = (en: string, pt: string) => (locale === 'en' ? en : pt);
  return (
    <main className="page-shell">
      <h1>
        {l(
          'We could not open this page.',
          'Não conseguimos abrir esta página.',
        )}
      </h1>
      <p>
        {l(
          'Your data is still saved. Try loading again.',
          'Seus dados permanecem salvos. Tente carregar novamente.',
        )}
      </p>
      <button className="btn btn-primary mt-6" onClick={reset}>
        {l('Try again', 'Tentar novamente')}
      </button>
      <a className="btn btn-light" href="/">
        {l('Back to home', 'Voltar ao início')}
      </a>
    </main>
  );
}
