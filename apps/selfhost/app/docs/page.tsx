'use client';
import { LanguageSwitcher, useI18n } from '@/lib/i18n';
export default function Documentation() {
  const { locale } = useI18n();
  const l = (en: string, pt: string) => (locale === 'en' ? en : pt);
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex justify-between">
        <a href="/app" className="text-primary">
          ← Lastfind
        </a>
        <LanguageSwitcher compact />
      </div>
      <h1 className="mt-8 text-3xl font-semibold">
        {l('Your independent installation', 'Sua instalação independente')}
      </h1>
      <p className="mt-5">
        {l(
          'Lastfind stores your projects separately, preserves original provider responses, and monitors your prompts every day at 4 AM Brasília time.',
          'O Lastfind armazena seus projetos separadamente, preserva as respostas originais do provedor e acompanha seus prompts todos os dias às 4h de Brasília.',
        )}
      </p>
      <section id="deploy" className="mt-8">
        <h2 className="text-xl font-semibold">{l('Setup', 'Configuração')}</h2>
        <p className="mt-3">
          {l(
            'Run the installer from your checkout. It guides you through Cloudflare and DataForSEO configuration, deployment and the owner key.',
            'Execute o instalador no seu checkout. Ele orienta a configuração da Cloudflare e do DataForSEO, a publicação e a chave do proprietário.',
          )}
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-4">
          npm ci{'\n'}npm run setup
        </pre>
        <a
          className="mt-4 inline-block text-primary"
          href="https://github.com/agencia-conversion/lastfind#readme"
        >
          {l(
            'Complete installation instructions',
            'Instruções completas de instalação',
          )}{' '}
          ↗
        </a>
      </section>
      <section id="scheduler" className="mt-8">
        <h2 className="text-xl font-semibold">
          {l('Monitoring and credentials', 'Monitoramento e credenciais')}
        </h2>
        <p className="mt-3">
          {l(
            'The installer configures the scheduled worker. DataForSEO credentials stay on the server. Enable monitoring in project settings and verify the latest scheduler check there. Standard batch collection is used when supported by the channel.',
            'O instalador configura o agendamento. As credenciais DataForSEO ficam no servidor. Ative o monitoramento nas configurações do projeto e confira ali a última verificação do agendador. A coleta Standard em lote é usada quando o canal permite.',
          )}
        </p>
      </section>
    </main>
  );
}
