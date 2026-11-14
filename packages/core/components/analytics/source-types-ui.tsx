'use client';
// The donut's balloon is a controlled catalog Tooltip (it follows the pointer and a tap keeps it open): Hint has no open state.
import { Hint, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';

import { useRef, useState, type ReactNode } from 'react';
import { formatNumber } from '@/lib/number-format';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Info } from 'lucide-react';
import { ChartLegend } from '@/components/lastfind/presentation/trend-chart';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import {
  SOURCE_OWNER_LABELS,
  SOURCE_TYPE_COLORS,
  SOURCE_TYPE_DEFINITIONS,
  UNCLASSIFIED,
  UNCLASSIFIED_LABEL,
  type SourceOwner,
  type PublicSourceTypeClassifier,
} from '@/lib/source-types';
import type { ContentTypesReport, SourceRow, SourceTypesReport, SourceTypeValue } from '@/lib/report-types';
import { orderSeriesByTotal } from '@/lib/chart-series';
import { useTouchDismiss } from '@/lib/use-touch-dismiss';
import { ViewAllAction, type DrillTarget, type Linker } from './drill-link';
import { EmptyState, SiteFavicon } from './shared';
import './source-types.css';

type Translate = (en: string, pt: string) => string;

/** Overview: types listed in the Site types and Content types panels (the rest, "Other" included, add up in "Other types"). */
export const OVERVIEW_TYPES_SHOWN = 6;

export function sourceTypeLabel(type: SourceTypeValue | undefined, t: Translate) {
  const label = type && type !== UNCLASSIFIED ? SOURCE_TYPE_DEFINITIONS[type].label : UNCLASSIFIED_LABEL;
  return t(label[0], label[1]);
}
/** A citation without a usable address has no domain; say so instead of naming it. */
export const unknownDomainLabel = (t: Translate) => t('Unknown domain', 'Domínio desconhecido');
export const unknownDomainHint = (t: Translate) =>
  t('These citations have no web address, so the domain cannot be determined.', 'Estas citações não têm endereço web, então não dá para saber o domínio.');
export const sourceTypeDescription = (type: SourceTypeValue | undefined, t: Translate) =>
  type && type !== UNCLASSIFIED ? t(...SOURCE_TYPE_DEFINITIONS[type].description) : '';
export const sourceTypeColor = (type: SourceTypeValue | undefined) =>
  SOURCE_TYPE_COLORS[type ?? UNCLASSIFIED] ?? SOURCE_TYPE_COLORS.other;
const colorOf = sourceTypeColor;

export const sourceOwnerLabel = (owner: SourceOwner, t: Translate, plural = false) =>
  t(...SOURCE_OWNER_LABELS[owner][plural ? 'plural' : 'label']);

/**
 * Seal for a domain that is yours or a tracked competitor's. It is a mark next to the
 * site type, never a type; third-party domains carry no seal.
 */
export function OwnerBadge({ owner, t, className }: { owner: SourceOwner | undefined; t: Translate; className?: string }) {
  if (!owner || owner === 'third-party') return null;
  return <TagBadge tone={owner === 'own' ? 'primary' : 'danger'} className={className}>{sourceOwnerLabel(owner, t)}</TagBadge>;
}

/** Type chip: every site and content type uses its fixed hue, and the label always accompanies it. */
export function SourceTypeBadge({ type, t, quiet, className }: { type: SourceTypeValue | undefined; t: Translate; quiet?: boolean; className?: string }) {
  const missing = !type || type === UNCLASSIFIED || quiet;
  return (
    <TagBadge tone={missing ? 'quiet' : 'neutral'} dotColor={colorOf(type)} title={sourceTypeDescription(type, t) || undefined} className={className}>
      {sourceTypeLabel(type, t)}
    </TagBadge>
  );
}

/** Why sources may be unclassified, and the one allowed next step. Never implies a value. */
export function ClassifierNotice({
  classifier,
  pending,
  unclassified,
  classified = 0,
  classifying,
  onClassify,
  onConfigure,
  t,
  noun,
  quiet,
}: {
  classifier: PublicSourceTypeClassifier;
  pending?: boolean;
  unclassified: number;
  /** Already-typed citations; with quiet overview, setup/off notices must not contradict the chart. */
  classified?: number;
  classifying?: boolean;
  onClassify?: () => void;
  onConfigure?: () => void;
  t: Translate;
  noun: string;
  /** Overview: say nothing that only describes how classification works; keep what needs an action or a fix. */
  quiet?: boolean;
}) {
  let message: ReactNode = null;
  if (quiet && (classifier.state === 'demo' || (classifier.state === 'ready' && (pending || classifier.automatic)))) message = null;
  else if (classifier.state === 'demo')
    message =
      unclassified > 0
        ? t(
            'Some sources in this demo have not been classified yet.',
            'Algumas fontes deste demo ainda não foram classificadas.',
          )
        : null;
  // Nothing without a type: whatever the evaluator's state, there is nothing to explain.
  else if (unclassified === 0 && !pending) message = null;
  // Overview already draws type shares: "not available" / off + Open settings contradicts the chart.
  else if (quiet && classified > 0 && classifier.state !== 'ready') message = null;
  else if (classifier.state === 'disabled')
    message = t(
      'The source evaluator is off, so these sources are not classified. Turn it on in Settings, under Competitors.',
      'O avaliador de fontes está desligado, então estas fontes não foram classificadas. Ative em Configurações, na seção Concorrentes.',
    );
  else if (classifier.state === 'unconfigured')
    message = (
      <>
        {t(
          'Source classification is not available on this installation yet.',
          'A classificação de fontes ainda não está disponível nesta instalação.',
        )}{' '}
        <a href="/docs" className="text-primary hover:underline">
          {t('Installation guide', 'Guia de instalação')}
        </a>
      </>
    );
  else if (classifier.state === 'unavailable')
    message = t(
      'Source classification is not enabled for this project. See Settings, under Competitors.',
      'A classificação de fontes não está habilitada para este projeto. Veja Configurações, na seção Concorrentes.',
    );
  else if (pending)
    message = t('Classification is running. Results appear here as they finish.', 'A classificação está em andamento. Os resultados aparecem aqui conforme terminam.');
  else if (classifier.automatic && classifier.activity === 'ceiling')
    message = t(
      "This project reached this month's limit for automatic classification. It resumes next month.",
      'Este projeto atingiu o limite do mês para a classificação automática. Ela retoma no mês que vem.',
    );
  // Automatic waiting/paused/idle and the manual how-to are conceptual: no banner (info icon covers that).
  else if (classifier.automatic) message = null;
  else if (!onClassify) message = null;
  else
    message = t(
      'Classifying uses your source evaluator in limited batches and runs only when you ask.',
      'A classificação usa seu avaliador de fontes em lotes limitados e só roda quando você pede.',
    );
  if (!message) return null;
  return (
    <Note
      status
      icon={<Info size={14} />}
      action={
        <>
          {classifier.state === 'ready' && !classifier.automatic && !pending && unclassified > 0 && onClassify && (
            <Button variant="outline" disabled={classifying} onClick={onClassify}>
              {classifying ? t('Classifying…', 'Classificando…') : t(`Classify ${noun}`, `Classificar ${noun}`)}
            </Button>
          )}
          {classifier.state !== 'ready' && onConfigure && (
            <Button variant="outline" onClick={onConfigure}>
              {t('Open settings', 'Abrir configurações')}
            </Button>
          )}
        </>
      }
    >
      {message}
    </Note>
  );
}

type TypeShareReport = Pick<
  SourceTypesReport,
  'classifier' | 'citations' | 'classified' | 'unclassified' | 'truncated' | 'pendingBatches'
> & { types: { type: SourceTypeValue; citations: number; share: number }[] };

type TypeSharePanelProps = {
  report: TypeShareReport | null;
  loading: boolean;
  failed: boolean;
  locale: string;
  t: Translate;
  classifying?: boolean;
  actionError?: string;
  onSelectType: (type: SourceTypeValue) => void;
  onClassify?: () => void;
  onConfigure?: () => void;
  /** The header's View all: the same ViewAllAction as the card beside it. */
  viewAll?: { link: Linker; to: DrillTarget };
  onRetry?: () => void;
  /** Most types listed; the rest (and "Other") add up in one "Other types" slice so the shares still total 100%. */
  limit?: number;
  /** Overview: drop the notices that only describe how classification works. */
  quiet?: boolean;
};

const OTHERS = '__others__' as SourceTypeValue;

/** Donut + legend of classified types only; shares are among typed citations (not the unclassified remainder). */
function TypeSharePanel({
  id,
  title,
  caption,
  ariaLabel,
  openLabel,
  loadingText,
  failedText,
  emptyText,
  truncatedText,
  noun,
  report,
  loading,
  failed,
  locale,
  t,
  classifying,
  actionError,
  onSelectType,
  onClassify,
  onConfigure,
  viewAll,
  onRetry,
  limit,
  quiet,
}: TypeSharePanelProps & {
  id: string;
  title: string;
  caption: string;
  ariaLabel: string;
  openLabel: string;
  loadingText: string;
  failedText: string;
  emptyText: string;
  truncatedText: string;
  noun: string;
}) {
  // Balloon on the chart slice (mouse + touch). Legend is labels + open only — not the hover highlight.
  const [activeType, setActiveType] = useState<SourceTypeValue | null>(null);
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const share = (value: number) => `${percent.format(value)}%`;
  const typed = orderSeriesByTotal(
    (report?.types ?? []).filter((item) => item.type !== UNCLASSIFIED),
    (item) => item.citations,
  );
  const typedTotal = typed.reduce((sum, item) => sum + item.citations, 0);
  const allTypes = typed.map((item) => ({
    ...item,
    share: typedTotal ? (item.citations / typedTotal) * 100 : 0,
  }));
  // "Other" (a type of its own) and the types past the limit are one grey slice, last: two slices named alike read as one.
  // The summed slice only shows when it is worth a row (it never reads "0%").
  const top = allTypes.filter((item) => item.type !== 'other');
  const shown = limit != null ? top.slice(0, limit) : top;
  const rest = allTypes.filter((item) => !shown.includes(item));
  const restShare = rest.reduce((sum, item) => sum + item.share, 0);
  const orderedTypes = rest.length === 1 ? [...shown, rest[0]]
    : rest.length && restShare >= 0.05
      ? [...shown, { type: OTHERS, citations: rest.reduce((sum, item) => sum + item.citations, 0), share: restShare }]
      : shown;
  const labelOf = (type: SourceTypeValue) => (type === OTHERS ? t('Other types', 'Outros tipos') : sourceTypeLabel(type, t));
  const sliceType = (slice: unknown) => (slice as { type: SourceTypeValue }).type;
  const showSlice = (type: SourceTypeValue) => setActiveType(type);
  const clearSlice = () => setActiveType(null);
  const tipItem = orderedTypes.find((item) => item.type === activeType);
  const donut = useRef<HTMLElement>(null);
  useTouchDismiss({ root: () => donut.current, point: () => activeType ?? undefined, close: clearSlice });
  return (
    <SectionCard
      className="st-panel"
      title={title}
      titleId={id}
      info={caption}
      action={viewAll && <ViewAllAction link={viewAll.link} to={viewAll.to}>{t('View all', 'Ver todos')}</ViewAllAction>}
    >
      {loading ? (
        <div className="st-chart" aria-busy="true" aria-label={loadingText}>
          <Skeleton className="size-42 rounded-full" />
          <div className="grid gap-0.5">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-8 w-full" />)}
          </div>
        </div>
      ) : failed || !report ? (
        <EmptyState frame="bare" tone="error" title={failedText} onRetry={onRetry} />
      ) : report.citations === 0 ? (
        <EmptyState frame="bare" title={emptyText} />
      ) : (
        <div className="st-body">
          {orderedTypes.length > 0 && (
            <div className="st-chart">
              {/* The balloon is the catalog Tooltip, in a portal over the page: it never stretches or scrolls the card. It follows
                  the pointer; the slice under it (or the one touched) picks the content. */}
              <Tooltip open={!!tipItem} onOpenChange={(open) => !open && clearSlice()} trackCursorAxis="both">
              <TooltipTrigger closeOnClick={false} render={<figure ref={donut} className="st-donut" aria-label={ariaLabel} />}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 168, height: 168 }}>
                  <PieChart>
                    <Pie
                      data={orderedTypes}
                      dataKey="citations"
                      nameKey="type"
                      innerRadius="62%"
                      outerRadius="100%"
                      paddingAngle={orderedTypes.length > 1 ? 1.5 : 0}
                      stroke="none"
                      isAnimationActive={false}
                      onMouseEnter={(slice) => showSlice(sliceType(slice))}
                      onMouseMove={(slice) => showSlice(sliceType(slice))}
                      onMouseLeave={clearSlice}
                      onClick={(slice) => showSlice(sliceType(slice))}
                    >
                      {orderedTypes.map((item) => (
                        <Cell key={item.type} fill={colorOf(item.type)} opacity={activeType && activeType !== item.type ? 0.25 : 1} cursor="default" />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </TooltipTrigger>
              {tipItem && (
                <TooltipContent side="bottom" sideOffset={12} className="flex-col items-start gap-0">
                  <div>{labelOf(tipItem.type)}</div>
                  <div>{share(tipItem.share)}, {formatNumber(locale, tipItem.citations)}</div>
                </TooltipContent>
              )}
              </Tooltip>
              <ChartLegend
                layout="list"
                series={orderedTypes.map((item) => ({ id: item.type, name: labelOf(item.type), color: colorOf(item.type), value: share(item.share), static: item.type === OTHERS }))}
                onSelect={(type) => onSelectType(type as SourceTypeValue)}
                selectLabel={(item) => `${openLabel}: ${item.name}, ${item.value}`}
              />
            </div>
          )}
          {orderedTypes.length === 0 && <Note status>{t('Nothing in this period has a type yet.', 'Nada deste período tem tipo ainda.')}</Note>}
          {report.truncated && <Note status>{truncatedText}</Note>}
          <ClassifierNotice
            classifier={report.classifier}
            pending={report.pendingBatches > 0}
            unclassified={report.unclassified}
            classified={report.classified}
            classifying={classifying}
            onClassify={onClassify}
            onConfigure={onConfigure}
            t={t}
            noun={noun}
            quiet={quiet}
          />
          {actionError && <Note tone="danger">{actionError}</Note>}
        </div>
      )}
    </SectionCard>
  );
}

/** Distribution of citations by type of site (corporate, editorial, UGC…); ownership is not a type. */
export function SourceTypesPanel(props: TypeSharePanelProps & { report: SourceTypesReport | null }) {
  const { t } = props;
  return (
    <TypeSharePanel
      {...props}
      id="source-types-title"
      title={t('Site types', 'Tipos de site')}
      caption={t('Share of citations (%) among classified domains only. Each domain counts once per response that cites it; one response can cite several domains.', 'Participação nas citações (%) só entre os domínios classificados. Cada domínio conta uma vez por resposta que o cita; uma resposta pode citar vários domínios.')}
      ariaLabel={t('Distribution of citations by site type', 'Distribuição das citações por tipo de site')}
      openLabel={t('Open domains of this type', 'Abrir domínios deste tipo')}
      loadingText={t('Loading site types…', 'Carregando tipos de site…')}
      failedText={t('Site types could not be loaded.', 'Não foi possível carregar os tipos de site.')}
      emptyText={t('No cited sources in this period.', 'Sem fontes citadas neste período.')}
      truncatedText={t('Only the most cited domains are typed.', 'Somente os domínios mais citados recebem tipo.')}
      noun={t('domains', 'domínios')}
    />
  );
}

/** Distribution of citations by content type of the cited URLs (list, comparison, article…). */
export function ContentTypesPanel(props: TypeSharePanelProps & { report: ContentTypesReport | null }) {
  const { t } = props;
  return (
    <TypeSharePanel
      {...props}
      id="content-types-title"
      title={t('Content types', 'Tipos de conteúdo')}
      caption={t('Share of citations (%) among classified pages only. Each URL counts once per response that cites it; one response can cite several URLs.', 'Participação nas citações (%) só entre as páginas classificadas. Cada URL conta uma vez por resposta que a cita; uma resposta pode citar várias URLs.')}
      ariaLabel={t('Distribution of citations by content type', 'Distribuição das citações por tipo de conteúdo')}
      openLabel={t('Open pages of this type', 'Abrir conteúdos deste tipo')}
      loadingText={t('Loading content types…', 'Carregando tipos de conteúdo…')}
      failedText={t('Content types could not be loaded.', 'Não foi possível carregar os tipos de conteúdo.')}
      emptyText={t('No cited pages in this period.', 'Sem páginas citadas neste período.')}
      truncatedText={t('Only the most cited pages are typed.', 'Somente as páginas mais citadas recebem tipo.')}
      noun={t('pages', 'páginas')}
    />
  );
}


/** Overview "Most cited domains" and "Most cited pages": the top 5 in a table. States: loading, failed, and "no sources" only when the report came back empty. */
export function TopSourcesList({
  state,
  rows,
  link,
  t,
  locale = 'en',
  group = 'domain',
  limit = 5,
  tableRef,
}: {
  state: 'loading' | 'failed' | 'ready';
  rows: SourceRow[];
  link: Linker;
  t: Translate;
  locale?: string;
  group?: 'domain' | 'url';
  /** How many rows show: beside a donut, the rows that fit the height it gives the row (`.rows-fit`, with `tableRef`). */
  limit?: number;
  tableRef?: (node: HTMLDivElement | null) => void;
}) {
  const kind = group;
  if (state === 'failed')
    return <EmptyState frame="bare" tone="error" title={kind === 'url' ? t('Could not load the pages.', 'Não foi possível carregar as páginas.') : t('Could not load the sources.', 'Não foi possível carregar as fontes.')} />;
  if (state === 'ready' && !rows.length)
    return <EmptyState frame="bare" title={kind === 'url' ? t('No cited pages in this period.', 'Sem páginas citadas neste período.') : t('No cited sources in this period.', 'Sem fontes citadas neste período.')} />;
  const ordered = orderSeriesByTotal(rows, (item) => item.presence?.presence ?? item.responses).slice(0, limit);
  return (
    <DataTable
      singleLine
      minWidth={0}
      containerProps={tableRef ? { ref: tableRef } : undefined}
      loading={state === 'loading' ? 5 : undefined}
      rows={state === 'loading' ? [] : ordered}
      rowKey={(row) => row.key || row.domain || 'unknown'}
      ariaLabel={state === 'loading' ? t('Loading sources…', 'Carregando fontes…') : kind === 'url' ? t('Most cited pages', 'Páginas mais citadas') : t('Most cited domains', 'Domínios mais citados')}
      rowLink={(row) => (row.key ? link({ tab: 'sources', entity: { kind, key: row.key } }) : undefined)}
      columns={[
        {
          key: 'source',
          header: kind === 'url' ? t('Page', 'Página') : t('Domain', 'Domínio'),
          mobile: 'title',
          cell: (row) => {
            const label = kind === 'url' ? row.title || row.key || unknownDomainLabel(t) : row.domain || unknownDomainLabel(t);
            return (
              <span className="st-name-line min-w-0">
                {row.domain && <SiteFavicon domain={row.domain} name={row.domain} />}
                <Hint text={kind === 'url' ? label : undefined}>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                </Hint>
                <span className="st-name-marks">
                  <SourceTypeBadge type={row.sourceType} t={t} className="st-type-mark" />
                  <OwnerBadge owner={row.ownership} t={t} />
                </span>
              </span>
            );
          },
        },
        {
          key: 'presence',
          header: t('Presence', 'Presença'),
          label: t('Presence', 'Presença'),
          align: 'end',
          width: '7.5rem',
          cell: (row) => (row.presence ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(row.presence.presence)}%` : '—'),
        },
      ]}
    />
  );
}
