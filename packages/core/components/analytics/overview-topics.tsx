'use client';
// Topic coverage: the brand's share of voice or visibility in each topic, beside both figures in each AI model. Both
// cards read the Overview's summary report (its rows per topic and per model): no other read.
import { useState } from 'react';
import { Eye, MessageSquare } from 'lucide-react';
import { formatPercent } from '@/lib/number-format';
import { ENGINE_LABELS } from '@/lib/engines';
import type { SummaryReport } from '@/lib/report-types';
import { BarList } from '@/components/lastfind/presentation/bar-list';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Hint } from '@/components/ui/tooltip';
import { DrillLink, ViewAllAction, type DrillTarget, type Linker } from './drill-link';
import { EmptyState, ModelMark, useCopy } from './shared';

type Translate = (en: string, pt: string) => string;
type Metric = 'shareOfVoice' | 'visibility';
/** Topics listed before "Show all". */
const SHOWN = 8;

export function OverviewTopicCoverage({ summary, topics, brand, link, locale, t }: {
  summary: SummaryReport;
  /** The project's brand: the player each bar measures, named in the bar's balloon ("Your brand" without it). */
  brand?: string;
  /** The project's topics in the header's selection: one without answers in the period is listed too, without a bar. */
  topics: string[];
  link: Linker;
  locale: string;
  t: Translate;
  /** Before "View all" was a link (ViewAllAction): no longer read. */
  onViewModels?: () => void;
}) {
  const [metric, setMetric] = useState<Metric>('shareOfVoice');
  const [expanded, setExpanded] = useState(false);
  const sov = t('Share of voice', 'Share of voice');
  const visibility = t('Visibility', 'Visibilidade');
  const metricName = metric === 'shareOfVoice' ? sov : visibility;
  // Each figure opens the answers it is measured on, with the header's filters, as the cards above do.
  const answers: DrillTarget = { tab: 'responses', brand: null, mention: 'mentioned', cites: null, run: null };
  const measured = new Map((summary.topics ?? []).map((row) => [row.topic, row]));
  const rows = [...new Set([...topics, ...measured.keys()])]
    .map((topic) => ({ topic, row: measured.get(topic), value: measured.get(topic)?.[metric] ?? null }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.topic.localeCompare(b.topic));
  const shown = expanded ? rows : rows.slice(0, SHOWN);
  const figure = (value: number | null, label: string, to: DrillTarget | null) => {
    if (value == null) return '—';
    const text = formatPercent(locale, value);
    return to ? <DrillLink link={link} to={to} aria-label={`${label}: ${text}. ${t('Open the responses behind it', 'Abrir as respostas por trás')}`}>{text}</DrillLink> : text;
  };
  // Why a figure is missing: no complete answer, or (share of voice) no brand named in them.
  const absent = (value: number | null, answered: boolean, kind: Metric) => value != null ? undefined : !answered
    ? t('No complete answers in the period', 'Sem respostas completas no período')
    : kind === 'shareOfVoice' ? t('No brand named in these answers', 'Nenhuma marca citada nessas respostas') : undefined;
  return (
    <div className="overview-grid overview-pair">
      <SectionCard
        title={t('Topic coverage', 'Cobertura de tópicos')}
        info={t(
          'Your brand in each topic, in the period and filters of the header. Share of voice: its mentions ÷ mentions of every identified brand in the topic’s answers. Visibility: the topic’s answers that mention it ÷ all of them. The tick on the bar is the leader (the runner-up where your brand leads). A topic without answers or brand mentions has no bar, never a zero.',
          'Sua marca em cada tópico, no período e nos filtros do cabeçalho. Share of voice: as menções a ela ÷ as menções a todas as marcas identificadas nas respostas do tópico. Visibilidade: as respostas do tópico que a mencionam ÷ todas elas. O traço na barra é o líder (o segundo lugar onde sua marca lidera). Tópico sem respostas ou sem menções a marcas fica sem barra, nunca com zero.',
        )}
        action={
          <ToggleGroup multiple={false} value={[metric]} onValueChange={(value) => { if (value[0]) setMetric(value[0] as Metric); }} size="sm" variant="outline" spacing={0} aria-label={t('Coverage metric', 'Métrica da cobertura')}>
            <Hint text={sov}><ToggleGroupItem value="shareOfVoice" aria-label={sov}><MessageSquare />SOV</ToggleGroupItem></Hint>
            <ToggleGroupItem value="visibility"><Eye />{visibility}</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {!summary.topics ? (
          <EmptyState frame="bare" title={t('Reload the page to see the topic coverage.', 'Recarregue a página para ver a cobertura de tópicos.')} />
        ) : (
          <>
            <BarList
              label={`${t('Topic coverage', 'Cobertura de tópicos')}: ${metricName}`}
              rows={shown.map(({ topic, row, value }) => {
                const name = topic || t('No topic', 'Sem tópico');
                // A tick where the brand's top rival stands (no position beside the topic: rankings keep their "#" column only).
                const rivalValue = row?.rival?.[metric] ?? null;
                const rival = row?.rival && rivalValue != null
                  ? `${row.position === 1 ? t('Runner-up', 'Segundo lugar') : t('Leader', 'Líder')}: ${row.rival.name}, ${formatPercent(locale, rivalValue)}` : '';
                return {
                  key: topic, label: name, value,
                  mark: rival ? { value: rivalValue!, label: rival } : undefined,
                  // Who the bar is (the brand), then the rival the tick stands for.
                  hint: value == null ? undefined : [`${brand ?? t('Your brand', 'Sua marca')}, ${metricName}: ${formatPercent(locale, value)}`, rival].filter(Boolean).join('. '),
                  figure: figure(value, `${name}, ${metricName}`, topic ? { ...answers, topic } : null),
                  text: [`${name}: ${value == null ? '—' : formatPercent(locale, value)}`, rival].filter(Boolean).join('. '),
                  missing: absent(value, !!row?.responses, metric),
                };
              })}
            />
            {rows.length > SHOWN && (
              <Note action={<Button variant="outline" onClick={() => setExpanded((open) => !open)}>{expanded ? t('Show fewer', 'Mostrar menos') : t(`Show all ${rows.length}`, `Mostrar os ${rows.length}`)}</Button>}>
                {expanded ? t(`All ${rows.length} topics.`, `Todos os ${rows.length} tópicos.`) : t(`The ${SHOWN} topics with the highest ${metricName.toLowerCase()} of ${rows.length}.`, `Os ${SHOWN} tópicos com maior ${metricName.toLowerCase()} de ${rows.length}.`)}
              </Note>
            )}
          </>
        )}
      </SectionCard>
      <SectionCard
        title={t('SOV and visibility by AI', 'SOV e visibilidade por IA')}
        info={t(
          'Your brand’s share of voice and visibility in each AI model, in the period and filters of the header (the same figures as the cards above). A model without answers or brand mentions shows a dash, never a zero.',
          'O share of voice e a visibilidade da sua marca em cada modelo de IA, no período e nos filtros do cabeçalho (os mesmos números dos cards acima). Modelo sem respostas ou sem menções a marcas mostra um traço, nunca zero.',
        )}
        action={<ViewAllAction link={link} to={{ tab: 'models' }}>{t('View all', 'Ver todos')}</ViewAllAction>}
      >
        {summary.channels?.length ? (
          <DataTable
            singleLine
            minWidth={0}
            rows={summary.channels}
            rowKey={(row) => row.engine}
            ariaLabel={t('Share of voice and visibility by AI model', 'Share of voice e visibilidade por modelo de IA')}
            columns={[
              { key: 'engine', header: t('AI model', 'Modelo de IA'), mobile: 'title', cell: (row) => <Hint text={ENGINE_LABELS[row.engine]}><ModelMark model={row.engine} truncate /></Hint> },
              ...(['shareOfVoice', 'visibility'] as const).map((key) => ({
                key, header: key === 'shareOfVoice' ? sov : visibility, label: key === 'shareOfVoice' ? sov : visibility, align: 'end' as const,
                // Compact figures: the model's name keeps the rest, whole on a phone ("AI Overviews", never "AI Over…").
                width: '6.5rem',
                cell: (row: NonNullable<SummaryReport['channels']>[number]) => {
                  const why = absent(row[key], row.visibility != null, key);
                  const cell = figure(row[key], `${ENGINE_LABELS[row.engine]}, ${key === 'shareOfVoice' ? sov : visibility}`, { ...answers, engine: row.engine });
                  return why ? <Hint text={why}><span className="text-muted-foreground">{cell}<span className="sr-only">: {why}</span></span></Hint> : cell;
                },
              })),
            ]}
          />
        ) : (
          <EmptyState frame="bare" title={t('No AI model answered in this period.', 'Nenhum modelo de IA respondeu neste período.')} />
        )}
      </SectionCard>
    </div>
  );
}

/** The Topics screen while the workspace loads: the add card and the topics table, in their loading state. */
export function TopicsSkeleton() {
  const l = useCopy();
  const label = l('Loading topics…', 'Carregando tópicos…');
  return (
    <div aria-busy="true" aria-label={label}>
      <SectionCard title={l('Add a topic', 'Adicionar um tópico')} loading lines={1} />
      <SectionCard>
        <DataTable singleLine loading={5} rows={[]} rowKey={String} ariaLabel={label}
          columns={[{ key: 'name', header: l('Topic', 'Tópico'), cell: () => null }, { key: 'rename', header: <span className="sr-only">{l('Rename', 'Renomear')}</span>, cell: () => null }]} />
      </SectionCard>
    </div>
  );
}
