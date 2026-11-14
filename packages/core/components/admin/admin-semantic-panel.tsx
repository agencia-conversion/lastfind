'use client';
// Admin > Overview: the operational side of Semantic Branding that left the product screen. For each project's latest round,
// the AIs that gave no notes and the provider's own message, and how much the brands' order moved the notes. Both editions.
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { DataTable, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { ENGINE_LABELS } from '@/lib/engines';
import type { Engine } from '@/lib/types';

type Diagnosis = {
  projectId: string;
  project: string;
  owner: string | null;
  day: string;
  status: string;
  failures: { engine: Engine; method: 'llm' | 'scrape'; model: string; status: string; error: string | null }[];
  orderEffect: { points: number | null; pairs: number };
};

export function AdminSemanticPanel() {
  const { locale } = useI18n();
  const t = (en: string, pt: string) => (locale === 'pt-BR' ? pt : en);
  const [rounds, setRounds] = useState<Diagnosis[] | null | 'failed'>(null);
  useEffect(() => {
    fetch('/api/admin/semantic-panel')
      .then((response) => (response.ok ? (response.json() as Promise<{ rounds: Diagnosis[] }>) : Promise.reject()))
      .then((data) => setRounds(data.rounds), () => setRounds('failed'));
  }, []);
  const number = (value: number, digits = 0) => value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const day = (value: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  const title = t('Semantic Branding collections', 'Coletas do Semantic Branding');
  const columns: DataColumn<Diagnosis>[] = [
    {
      key: 'project', header: t('Project', 'Projeto'), mobile: 'title', headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal align-top',
      cell: (row) => (
        <span className="grid min-w-0 [overflow-wrap:anywhere]">
          <span className="font-(--weight-label)">{row.project}</span>
          {row.owner && <span className="text-caption text-muted-foreground">{row.owner}</span>}
        </span>
      ),
    },
    { key: 'day', header: t('Latest collection', 'Última coleta'), label: t('Latest collection', 'Última coleta'), cellClassName: 'align-top', cell: (row) => day(row.day) },
    {
      key: 'failures', header: t('AIs without notes', 'IAs sem notas'), label: t('AIs without notes', 'IAs sem notas'), mobile: 'wide',
      headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal align-top',
      cell: (row) => row.failures.length ? (
        <ul className="grid gap-1 [overflow-wrap:anywhere]">
          {row.failures.map((failure) => (
            <li key={`${failure.engine}:${failure.method}:${failure.model}`}>
              {/* A pure model's query (until 6/11/2026) names its model; an interface is the AI itself. */}
              <span className="font-(--weight-label)">{ENGINE_LABELS[failure.engine]}{failure.method === 'llm' ? `, ${failure.model}` : ''}</span>
              <span className="block text-caption text-muted-foreground">{failure.error || failure.status}</span>
            </li>
          ))}
        </ul>
      ) : <span className="text-muted-foreground">{t('Every AI gave notes', 'Todas as IAs deram notas')}</span>,
    },
    {
      key: 'order', header: t('Order effect', 'Efeito de ordem'), label: t('Order effect', 'Efeito de ordem'), mobile: 'wide', headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal align-top',
      cell: ({ orderEffect: effect }) => effect.points === null
        ? <span className="text-muted-foreground">{t('Not measurable: no brand changed place between the two orders', 'Não mensurável: nenhuma marca mudou de lugar entre as duas ordens')}</span>
        : <>{t(`${effect.points >= 0 ? '+' : '−'}${number(Math.abs(effect.points), 1)} points`, `${effect.points >= 0 ? '+' : '−'}${number(Math.abs(effect.points), 1)} pontos`)}<span className="block text-caption text-muted-foreground">{t(`${number(effect.pairs)} pairs`, `${number(effect.pairs)} pares`)}</span></>,
    },
  ];
  return (
    <SectionCard
      title={title}
      description={t(
        "Each project's latest round. Why an AI gave no notes, in the provider's own words, and how much being listed earlier moved the notes. The score averages both orders, so the order effect favours no brand. Only admins see this.",
        'A última rodada de cada projeto. Por que uma IA não deu notas, nas palavras do provedor, e quanto aparecer antes na lista mudou as notas. O score faz a média das duas ordens, então o efeito de ordem não favorece nenhuma marca. Só admins veem isto.',
      )}
    >
      {rounds === 'failed' ? (
        <Note tone="danger">{t('Could not read the Semantic Branding collections. Reload and try again.', 'Não foi possível ler as coletas do Semantic Branding. Recarregue e tente de novo.')}</Note>
      ) : rounds?.length === 0 ? (
        <p className="px-5 pb-5 text-body text-muted-foreground">{t('No project has a Semantic Branding collection yet.', 'Nenhum projeto tem coleta do Semantic Branding ainda.')}</p>
      ) : (
        <div className="live-table-scroll">
          <DataTable ariaLabel={title} rows={rounds ?? []} loading={rounds ? undefined : 3} rowKey={(row) => row.projectId} columns={columns} />
        </div>
      )}
    </SectionCard>
  );
}
