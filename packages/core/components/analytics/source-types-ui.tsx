'use client';

import type { ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { ArrowUpRight, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SOURCE_TYPE_COLORS,
  SOURCE_TYPE_DEFINITIONS,
  UNCLASSIFIED,
  UNCLASSIFIED_LABEL,
  type DomainType,
  type SourceTypeClassifier,
} from '@/lib/source-types';
import type { SourceTypesReport, SourceTypeValue } from '@/lib/report-types';
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
const colorOf = (type: SourceTypeValue | undefined) =>
  SOURCE_TYPE_COLORS[(type as DomainType | typeof UNCLASSIFIED) ?? UNCLASSIFIED] ?? SOURCE_TYPE_COLORS.other;

/** Type chip. Page types reuse the neutral swatch; domain types use their fixed hue. */
export function SourceTypeBadge({ type, t, className = '' }: { type: SourceTypeValue | undefined; t: Translate; className?: string }) {
  const missing = !type || type === UNCLASSIFIED;
  return (
    <span className={`st-badge ${missing ? 'st-badge-missing' : ''} ${className}`} title={sourceTypeDescription(type, t) || undefined}>
      <i style={{ background: colorOf(type) }} aria-hidden="true" />
      {sourceTypeLabel(type, t)}
    </span>
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
  if (classifier.state === 'disabled')
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

/** Distribution of citations by domain type: donut, legend with percentages and the unclassified remainder. */
export function SourceTypesPanel({
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
}: {
  report: SourceTypesReport | null;
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
}) {
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat(locale);
  const share = (value: number) => `${percent.format(value)}%`;
  const unclassifiedShare = report && report.citations ? (report.unclassified / report.citations) * 100 : 0;
  return (
    <section className="analytics-panel st-panel" aria-labelledby="source-types-title">
      <div className="panel-heading">
        <h2 id="source-types-title">{t('Source types', 'Tipos de fonte')}</h2>
        {onViewAll && (
          <Button variant="ghost" size="sm" onClick={onViewAll}>
            {t('View all', 'Ver todas')}
            <ArrowUpRight size={13} />
          </Button>
        )}
      </div>
      {loading ? (
        <output className="st-empty">{t('Loading source types…', 'Carregando tipos de fonte…')}</output>
      ) : failed || !report ? (
        <p className="st-empty" role="alert">
          {t('Source types could not be loaded.', 'Não foi possível carregar os tipos de fonte.')}{' '}
          {onRetry && (
            <button type="button" className="st-link" onClick={onRetry}>
              {t('Retry', 'Tentar novamente')}
            </button>
          )}
        </p>
      ) : report.citations === 0 ? (
        <p className="st-empty">{t('No cited sources in this period.', 'Sem fontes citadas neste período.')}</p>
      ) : (
        <div className="st-body">
          <p className="st-caption">
            {t('Share of citations by type of domain', 'Participação das citações por tipo de domínio')} ·{' '}
            {integer.format(report.citations)} {t('citations', 'citações')}
          </p>
          <div className="st-chart">
            <figure className="st-donut" aria-label={t('Distribution of citations by source type', 'Distribuição das citações por tipo de fonte')}>
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
                    aria-label={`${sourceTypeLabel(item.type, t)}: ${share(item.share)}, ${integer.format(item.citations)} ${t('citations', 'citações')}. ${t('Open sources of this type', 'Abrir fontes deste tipo')}`}
                  >
                    <i style={{ background: colorOf(item.type) }} aria-hidden="true" />
                    <span className="st-legend-label">{sourceTypeLabel(item.type, t)}</span>
                    <b>{share(item.share)}</b>
                    <small>{integer.format(item.citations)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {report.unclassified > 0 && (
            <output className="st-partial">
              {report.classified === 0
                ? t('Not classified yet: no source in this period has a type.', 'Ainda não classificado: nenhuma fonte deste período tem tipo.')
                : t(`${share(unclassifiedShare)} not classified yet.`, `${share(unclassifiedShare)} ainda não classificado.`)}
              {report.truncated && (
                <>
                  {' '}
                  {t('Only the most cited domains are typed.', 'Somente os domínios mais citados recebem tipo.')}
                </>
              )}
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
            noun={t('domains', 'domínios')}
          />
          {actionError && (
            <p role="alert" className="st-error">
              {actionError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
