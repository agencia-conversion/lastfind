'use client';
import { useI18n } from '@/lib/i18n';
import { LanguageMenu } from '@/components/lastfind/public-menu';
import { DocsLayout } from '@/components/lastfind/docs/docs-layout';
import { selfhostDocsGroups, selfhostDocsSections } from './selfhost-docs';

export default function SelfhostDocs({ section }: { section?: string }) {
  const { locale, setLocale } = useI18n();
  const l = (en: string, pt: string) => (locale === 'en' ? en : pt);
  const sections = selfhostDocsSections(l);
  const page = sections.find((s) => s.id === section);
  return (
    <DocsLayout
      base="/docs"
      section={section}
      breadcrumbs={[
        { name: 'Lastfind', path: '/app' },
        { name: l('Documentation', 'Documentação'), path: '/docs' },
        ...(page ? [{ name: page.name, path: `/docs/${page.id}` }] : []),
      ]}
      header={
        <div className="docs-topbar">
          <a href="/app">{l('Back to Lastfind', 'Voltar ao Lastfind')}</a>
          <LanguageMenu locale={locale} instance="page" onSelect={setLocale} />
        </div>
      }
      groups={selfhostDocsGroups(l)}
      sections={sections}
      hero={{
        title: l('Your independent installation.', 'Sua instalação independente.'),
        lead: l('Every report and setting of Lastfind, and how to run, update and back up your own installation.', 'Cada relatório e configuração do Lastfind, e como rodar, atualizar e fazer backup da sua instalação.'),
      }}
    />
  );
}
