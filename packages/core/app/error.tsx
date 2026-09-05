'use client';
import { useI18n } from '@/lib/i18n';
export default function ErrorPage({ reset }: { reset: () => void }) {
  const { locale } = useI18n();
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
      <button className="btn btn-dark mt-6" onClick={reset}>
        {l('Try again', 'Tentar novamente')}
      </button>
      <a className="btn btn-light" href="/">
        {l('Back to home', 'Voltar ao início')}
      </a>
    </main>
  );
}
