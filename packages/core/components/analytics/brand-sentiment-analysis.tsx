'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { SENTIMENTS } from '@/lib/brand-research';
import type { Project } from '@/lib/types';
import type { BrandResearchReport } from './brand-research-panel';
import { FilterSelect, SiteFavicon } from './shared';
import { EngineBadge } from '@/components/lastfind/identity-icons';
import { Button } from '@/components/ui/button';
const colors = {
  positive: 'bg-emerald-600',
  neutral: 'bg-slate-400',
  negative: 'bg-rose-600',
  mixed: 'bg-violet-500',
};
export function BrandSentimentAnalysis({
  report,
  project,
  onEvidence,
  label,
}: {
  report: Pick<
    BrandResearchReport,
    'brands' | 'details' | 'detailsTruncated' | 'truncated'
  >;
  project: Project;
  onEvidence: (runId: string) => void;
  label: (value: string) => string;
}) {
  const { locale } = useI18n(),
    t = (en: string, pt: string) => (locale === 'en' ? en : pt);
  const [brand, setBrand] = useState(project.name),
    [polarity, setPolarity] = useState('all'),
    [limit, setLimit] = useState(20);
  const selectedBrand = report.brands.some((item) => item.brand === brand)
    ? brand
    : 'all';
  const selectBrand = (value: string) => {
    setBrand(value);
    setPolarity('all');
    setLimit(20);
  };
  const details = report.details.filter(
    (item) =>
      (selectedBrand === 'all' || item.brand === selectedBrand) &&
      (polarity === 'all' || item.sentiment === polarity),
  );
  return (
    <div className="mt-6 space-y-7 min-w-0">
      <section
        aria-label={t('Sentiment comparison', 'Comparação de sentimentos')}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">
            {t(
              'Distribution of evaluated questions',
              'Distribuição das perguntas avaliadas',
            )}
          </h4>
          <ul
            className="flex flex-wrap gap-x-4 gap-y-2 text-xs"
            aria-label={t('Sentiment legend', 'Legenda de sentimentos')}
          >
            {SENTIMENTS.map((sentiment) => (
              <li key={sentiment} className="flex items-center gap-1.5">
                <span
                  className={`size-2.5 rounded-sm ${colors[sentiment]}`}
                  aria-hidden="true"
                />
                {label(sentiment)}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t(
            'Select a brand to inspect its responses.',
            'Selecione uma marca para inspecionar suas respostas.',
          )}
        </p>
        {report.brands.length ? (
          <div className="mt-4 divide-y">
            {report.brands.map((item) => {
              const summary = SENTIMENTS.map(
                (sentiment) =>
                  `${label(sentiment)}: ${item.distribution[sentiment]}`,
              ).join(', ');
              return (
                <article
                  key={item.brand}
                  className={`rounded-sm px-2 py-4 first:pt-0 ${selectedBrand === item.brand ? 'bg-muted/30' : ''}`}
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(140px,1fr)_minmax(0,2fr)]">
                    <div className="min-w-0">
                      <button
                        className="flex max-w-full items-center gap-2 text-left text-sm font-medium hover:text-primary focus-visible:outline-primary"
                        aria-pressed={selectedBrand === item.brand}
                        onClick={() => selectBrand(item.brand)}
                      >
                        <SiteFavicon
                          name={item.brand}
                          domain={
                            item.brand === project.name
                              ? project.domain
                              : project.competitors.find(
                                  (candidate) => candidate.name === item.brand,
                                )?.domain || ''
                          }
                        />
                        <span className="break-words">{item.brand}</span>
                      </button>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t(
                          `${item.assessed} evaluated / ${item.prompts - item.absent} with mention / ${item.prompts} monitored questions`,
                          `${item.assessed} avaliadas / ${item.prompts - item.absent} com menção / ${item.prompts} perguntas monitoradas`,
                        )}
                      </p>
                    </div>
                    <div className="min-w-0">
                      {item.assessed ? (
                        <button
                          className="flex h-7 w-full overflow-hidden rounded-sm bg-muted focus-visible:outline-primary"
                          aria-pressed={selectedBrand === item.brand}
                          onClick={() => selectBrand(item.brand)}
                          aria-label={`${item.brand}: ${summary}. ${t(`Of ${item.assessed} evaluated questions. View all response evidence.`, `De ${item.assessed} perguntas avaliadas. Ver todas as evidências por resposta.`)}`}
                          title={summary}
                        >
                          {SENTIMENTS.map(
                            (sentiment) =>
                              item.distribution[sentiment] > 0 && (
                                <span
                                  key={sentiment}
                                  aria-hidden="true"
                                  className={`h-full ${colors[sentiment]}`}
                                  style={{
                                    width: `${(item.distribution[sentiment] / item.assessed) * 100}%`,
                                  }}
                                />
                              ),
                          )}
                        </button>
                      ) : (
                        <div className="flex h-7 items-center rounded-sm bg-muted px-2 text-xs text-muted-foreground">
                          {t(
                            'No evaluated sentiment',
                            'Sem sentimento avaliado',
                          )}
                        </div>
                      )}
                      <p
                        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"
                        aria-label={`${item.brand}: ${summary}`}
                      >
                        {SENTIMENTS.map((sentiment) => (
                          <span key={sentiment}>
                            {label(sentiment)}{' '}
                            <strong>
                              {item.assessed
                                ? item.distribution[sentiment]
                                : '—'}
                            </strong>
                          </span>
                        ))}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t('No mention', 'Sem menção')}: {item.absent} ·{' '}
                        {t('Partial coverage', 'Cobertura parcial')}:{' '}
                        {item.partial}
                        {[
                          ['pending', item.pending],
                          ['insufficient', item.insufficient],
                          ['ambiguous', item.ambiguous],
                          ['failed', item.failed],
                        ].map(
                          ([state, count]) =>
                            Number(count) > 0 && (
                              <span key={state}>
                                {' '}
                                · {label(String(state))}: {count}
                              </span>
                            ),
                        )}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {report.truncated
              ? t(
                  'No answers fit this report limit. Narrow the global filters.',
                  'Nenhuma resposta cabe neste limite de relatório. Restrinja os filtros globais.',
                )
              : t(
                  'No completed monitored answers in this scope.',
                  'Nenhuma resposta monitorada completa neste recorte.',
                )}
          </p>
        )}
      </section>
      <section
        className="border-t pt-5"
        aria-label={t('Answer evidence', 'Evidências das respostas')}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold">
              {t('Answer evidence', 'Evidências das respostas')}
            </h4>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              {t(
                'Filters below affect loaded answer details only. A mixed question can combine positive and negative answers from different models. The comparison above stays unchanged.',
                'Os filtros abaixo afetam somente os detalhes de respostas carregados. Uma pergunta mista pode combinar respostas positivas e negativas de modelos diferentes. A comparação acima permanece igual.',
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              label={t('Evidence brand', 'Marca nas evidências')}
              value={selectedBrand}
              onChange={selectBrand}
              options={[
                { value: 'all', label: t('All brands', 'Todas as marcas') },
                ...report.brands.map((item) => ({
                  value: item.brand,
                  label: item.brand,
                })),
              ]}
            />
            <FilterSelect
              label={t('Response sentiment', 'Sentimento nesta resposta')}
              value={polarity}
              onChange={(value) => {
                setPolarity(value);
                setLimit(20);
              }}
              options={[
                {
                  value: 'all',
                  label: t(
                    'All response sentiments',
                    'Todos os sentimentos por resposta',
                  ),
                },
                ...SENTIMENTS.map((sentiment) => ({
                  value: sentiment,
                  label: label(sentiment),
                })),
              ]}
            />
          </div>
        </div>
        {report.detailsTruncated && (
          <output className="mt-3 block text-sm text-muted-foreground">
            {t(
              'Evidence is limited to the first 120 brand/answer details before these filters. Missing matches do not mean the full scope has no evidence. Narrow the global filters.',
              'As evidências são limitadas aos primeiros 120 detalhes marca/resposta antes destes filtros. Ausência de resultados não significa falta de evidência no recorte completo. Restrinja os filtros globais.',
            )}
          </output>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t(
            `Showing ${Math.min(limit, details.length)} of ${details.length} loaded brand/answer details.`,
            `Exibindo ${Math.min(limit, details.length)} de ${details.length} detalhes marca/resposta carregados.`,
          )}
        </p>
        {details.length ? (
          <div className="mt-3 divide-y">
            {details.slice(0, limit).map((detail) => (
              <details
                className="min-w-0 py-4 first:pt-0 text-sm"
                key={`${detail.runId}:${detail.brand}`}
              >
                <summary className="cursor-pointer">
                  <span className="block break-words font-medium">
                    {detail.prompt}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {detail.brand} ·{' '}
                      {detail.sentiment
                        ? label(detail.sentiment)
                        : label(detail.state)}
                    </span>
                    <EngineBadge engine={detail.engine} />
                    <time dateTime={detail.date}>
                      {new Date(detail.date).toLocaleDateString(locale)}
                    </time>
                    <span className="text-primary">
                      {t('View evidence', 'Ver evidências')}
                    </span>
                  </span>
                </summary>
                <div className="mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEvidence(detail.runId)}
                  >
                    {t('Open full response', 'Abrir resposta completa')}
                  </Button>
                  {detail.evidence.map((excerpt, index) => (
                    <blockquote
                      key={index}
                      className="mt-3 whitespace-pre-wrap break-words border-l-2 pl-3 text-muted-foreground"
                    >
                      {excerpt}
                    </blockquote>
                  ))}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {t(
              'No loaded answer details match these evidence filters.',
              'Nenhum detalhe de resposta carregado corresponde a estes filtros de evidência.',
            )}
          </p>
        )}
        {details.length > limit && (
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => setLimit((value) => value + 20)}
          >
            {t('Show more evidence', 'Mostrar mais evidências')}
          </Button>
        )}
      </section>
    </div>
  );
}
