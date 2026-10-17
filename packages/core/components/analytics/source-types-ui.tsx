'use client';

import type { ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { ArrowUpRight, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import {
  SOURCE_OWNER_LABELS,
  SOURCE_TYPE_COLORS,
  SOURCE_TYPE_DEFINITIONS,
  UNCLASSIFIED,
  UNCLASSIFIED_LABEL,
  type SourceOwner,
  type SourceTypeClassifier,
} from '@/lib/source-types';
import type { ContentTypesReport, SourceRow, SourceTypesReport, SourceTypeValue } from '@/lib/report-types';
import { DrillLink, type Linker } from './drill-link';
import { SiteFavicon } from './shared';
import './source-types.css';

type Translate = (en: string, pt: string) => string;

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
  classifying,
  onClassify,
  onConfigure,
  t,
  noun,
}: {
  classifier: SourceTypeClassifier;
  pending?: boolean;
  unclassified: number;
  classifying?: boolean;
  onClassify?: () => void;
  onConfigure?: () => void;
  t: Translate;
  noun: string;
}) {
  let message: ReactNode = null;
  if (classifier.state === 'demo')
    message =
      unclassified > 0
        ? t(
            'Some sources in this demo have not been classified yet.',
            'Algumas fontes deste demo ainda não foram classificadas.',
          )
        : null;
  else if (classifier.state === 'disabled')
    message = t(
      'The source evaluator is off, so these sources are not classified. Turn it on in Settings › Competitors.',
      'O avaliador de fontes está desligado, então estas fontes não foram classificadas. Ative em Configurações › Concorrentes.',
    );
  else if (classifier.state === 'unconfigured')
    message = t(
      'The OpenRouter key is not configured on this server, so sources cannot be classified. Check Settings › Competitors.',
      'A chave do OpenRouter não está configurada neste servidor, então as fontes não podem ser classificadas. Veja Configurações › Concorrentes.',
    );
  else if (classifier.state === 'unavailable')
    message = t(
      'Source classification is not enabled for this project. See Settings › Competitors.',
      'A classificação de fontes não está habilitada para este projeto. Veja Configurações › Concorrentes.',
    );
  else if (pending)
    message = t('Classification is running. Results appear here as they finish.', 'A classificação está em andamento. Os resultados aparecem aqui conforme terminam.');
  else if (unclassified > 0)
    message = t(
      `Classifying uses your evaluator (${classifier.model}) in limited batches and runs only when you ask.`,
      `A classificação usa seu avaliador (${classifier.model}) em lotes limitados e só roda quando você pede.`,
    );
  if (!message) return null;
  return (
    <output className="st-notice">
      <Info size={14} aria-hidden="true" />
      <p>{message}</p>
      {classifier.state === 'ready' && !pending && unclassified > 0 && onClassify && (
        <Button size="sm" variant="outline" disabled={classifying} onClick={onClassify}>
          {classifying ? t('Classifying…', 'Classificando…') : t(`Classify ${noun}`, `Classificar ${noun}`)}
        </Button>
      )}
      {classifier.state !== 'ready' && onConfigure && (
        <Button size="sm" variant="outline" onClick={onConfigure}>
          {t('Open settings', 'Abrir configurações')}
        </Button>
      )}
    </output>
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
  onViewAll?: () => void;
  onRetry?: () => void;
};

/** Donut, legend with percentages and the unclassified remainder for one kind of type. */
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
  onViewAll,
  onRetry,
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
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat(locale);
  const share = (value: number) => `${percent.format(value)}%`;
  const unclassifiedShare = report && report.citations ? (report.unclassified / report.citations) * 100 : 0;
  return (
    <SectionCard
      className="st-panel"
      title={title}
      titleId={id}
      action={onViewAll && (
        <Button variant="ghost" size="sm" onClick={onViewAll}>
          {t('View all', 'Ver todas')}
          <ArrowUpRight size={13} />
        </Button>
      )}
    >
      {loading ? (
        <output className="st-empty" aria-busy="true">{loadingText}</output>
      ) : failed || !report ? (
        <p className="st-empty" role="alert">
          {failedText}{' '}
          {onRetry && (
            <button type="button" className="st-link" onClick={onRetry}>
              {t('Retry', 'Tentar novamente')}
            </button>
          )}
        </p>
      ) : report.citations === 0 ? (
        <p className="st-empty">{emptyText}</p>
      ) : (
        <div className="st-body">
          <p className="st-caption">
            {caption} · {integer.format(report.citations)} {t('citations', 'citações')}
          </p>
          <div className="st-chart">
            <figure className="st-donut" aria-label={ariaLabel}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 168, height: 168 }}>
                <PieChart>
                  <Pie
                    data={report.types}
                    dataKey="citations"
                    nameKey="type"
                    innerRadius="62%"
                    outerRadius="100%"
                    paddingAngle={report.types.length > 1 ? 1.5 : 0}
                    stroke="none"
                    isAnimationActive={false}
                    onClick={(slice) => onSelectType((slice as unknown as { type: SourceTypeValue }).type)}
                  >
                    {report.types.map((item) => (
                      <Cell key={item.type} fill={colorOf(item.type)} cursor="pointer" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <figcaption>
                <strong>{integer.format(report.citations)}</strong>
                <span>{t('citations', 'citações')}</span>
              </figcaption>
            </figure>
            <ul className="st-legend">
              {report.types.map((item) => (
                <li key={item.type}>
                  <button
                    type="button"
                    onClick={() => onSelectType(item.type)}
                    aria-label={`${sourceTypeLabel(item.type, t)}: ${share(item.share)}, ${integer.format(item.citations)} ${t('citations', 'citações')}. ${openLabel}`}
                  >
                    <i style={{ background: colorOf(item.type) }} aria-hidden="true" />
                    <span className="st-legend-label">{sourceTypeLabel(item.type, t)}</span>
                    <span className="st-legend-value">{share(item.share)}</span>
                    <small>{integer.format(item.citations)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {report.unclassified > 0 && (
            <output className="st-partial">
              {report.classified === 0
                ? t('Not classified yet: nothing in this period has a type.', 'Ainda não classificado: nada deste período tem tipo.')
                : t(`${share(unclassifiedShare)} not classified yet.`, `${share(unclassifiedShare)} ainda não classificado.`)}
              {report.truncated && <> {truncatedText}</>}
            </output>
          )}
          <ClassifierNotice
            classifier={report.classifier}
            pending={report.pendingBatches > 0}
            unclassified={report.unclassified}
            classifying={classifying}
            onClassify={onClassify}
            onConfigure={onConfigure}
            t={t}
            noun={noun}
          />
          {actionError && (
            <p role="alert" className="st-error">
              {actionError}
            </p>
          )}
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
      caption={t('Share of citations by type of site', 'Participação das citações por tipo de site')}
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
      caption={t('Share of citations by type of content', 'Participação das citações por tipo de conteúdo')}
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


/**
 * Body of the Overview "Top sources" card. Three distinct states: loading, failed, and
 * ("no sources") only when the report came back empty.
 */
export function TopSourcesList({
  state,
  rows,
  link,
  t,
}: {
  state: 'loading' | 'failed' | 'ready';
  rows: SourceRow[];
  link: Linker;
  t: Translate;
}) {
  if (state === 'loading')
    return (
      <output className="p-5 text-muted-foreground" aria-busy="true">
        {t('Loading sources…', 'Carregando fontes…')}
      </output>
    );
  if (state === 'failed')
    return (
      <p className="p-5 text-muted-foreground" role="alert">
        {t('Could not load the sources.', 'Não foi possível carregar as fontes.')}
      </p>
    );
  if (!rows.length)
    return <p className="p-5 text-muted-foreground">{t('No cited sources in this period.', 'Sem fontes citadas neste período.')}</p>;
  return (
    <div className="live-frequency" aria-label={t('Citation frequency by source', 'Frequência de citação por fonte')}>
      {rows.slice(0, 5).map((item) => (
        <DrillLink key={item.key} link={link} to={{ tab: 'sources', entity: { kind: 'domain', key: item.key } }} disabled={!item.key} title={item.key ? undefined : unknownDomainHint(t)}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              {item.domain && <SiteFavicon domain={item.domain} name={item.domain} />}
              <span className="truncate">{item.domain || unknownDomainLabel(t)}</span>
            </span>
            <span className="st-type-text"><span className="st-dot" style={{ background: sourceTypeColor(item.sourceType) }} aria-hidden="true" />{sourceTypeLabel(item.sourceType, t)}{item.ownership !== 'third-party' && <> · <span className={`st-owner-text st-owner-text-${item.ownership}`}>{sourceOwnerLabel(item.ownership, t)}</span></>}</span>
          </span>
          <i style={{ width: `${(100 * item.responses) / Math.max(1, rows[0].responses)}%` }} />
          <span className="st-count">{item.responses}</span>
        </DrillLink>
      ))}
    </div>
  );
}
