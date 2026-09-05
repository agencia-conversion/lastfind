'use client';
import { useI18n } from '@/lib/i18n';
export default function NotFound() {
  const { locale } = useI18n();
  const l = (en: string, pt: string) => (locale === 'en' ? en : pt);
  return (
    <main className="page-shell">
      <span className="eyebrow">404</span>
      <h1>{l('The answer is not here.', 'A resposta não está aqui.')}</h1>
      <p>
        {l(
          'This page does not exist or has moved.',
          'Esta página não existe ou foi movida.',
        )}
      </p>
      <a className="btn btn-dark mt-6" href="/">
        {l('Back to home', 'Voltar ao início')}
      </a>
    </main>
  );
}
