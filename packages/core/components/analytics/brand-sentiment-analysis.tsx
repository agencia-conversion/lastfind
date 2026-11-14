'use client';
import { formatNumber, formatPercent } from '@/lib/number-format';
import { useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { CRITERIA, SENTIMENT_CRITERIA, SENTIMENTS, type SentimentCriterion } from '@/lib/brand-research';
import type { Project } from '@/lib/types';
import type { BrandResearchReport } from './brand-research-panel';
import { FilterSelect, SiteFavicon } from './shared';
import { ExcerptMarkdown } from './answer-markdown';
import { EngineBadge } from '@/components/lastfind/identity-icons';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { relativeReportDate } from '@/lib/report-date';
import { SectionHeader } from '@/components/lastfind/presentation/section-header';
import { DrillLink, type DrillTarget, type Linker } from './drill-link';
/** The colour of each sentiment band (shell.md section 11): green, yellow (`--sentiment-neutral`, never the gray of "no change"), red. */
export const sentimentTone = {
  positive: 'var(--state-good)',
  neutral: 'var(--sentiment-neutral)',
  negative: 'var(--state-bad)',
};
/**
 * The fill of each band in a bar (`--sentiment-*-fill`, tokens.css): the state tokens, each at least 3:1 on the card in both themes
 * (9/11/2026: the pastel tints read washed out); the figures stay in `sentimentTone`.
 */
export const sentimentFill = {
  positive: 'var(--sentiment-positive-fill)',
  neutral: 'var(--sentiment-neutral-fill)',
  negative: 'var(--sentiment-negative-fill)',
};
const bandTone = (band: keyof typeof sentimentTone) => ({ '--band-tone': sentimentTone[band] }) as CSSProperties;
/** "Promoters 40%, Neutral 35%, Detractors 25%": every band's share of the evaluated questions. */
export function sentimentShares(distribution: Record<(typeof SENTIMENTS)[number], number>, assessed: number, locale: string, t: (en: string, pt: string) => string) {
  return SENTIMENTS.map((band) => `${sentimentLabel(band, t)} ${formatPercent(locale, (100 * (distribution[band] ?? 0)) / assessed, 0)}`).join(', ');
}
/**
 * The only sentiment bar (Overview card, brand page, Brands table): promoter, neutral and detractor shares of the evaluated
 * questions as one stacked bar, beside the index on its line. `shares` prints each segment's percentage under it; the band
 * names and shares are read by screen readers and shown in its tooltip.
 */
export function SentimentBar({
  distribution,
  assessed,
  locale,
  t,
  shares = false,
  className,
  link,
  band,
}: {
  distribution: Record<(typeof SENTIMENTS)[number], number>;
  assessed: number;
  locale: string;
  t: (en: string, pt: string) => string;
  shares?: boolean;
  className?: string;
  /** Drill down: with `shares`, each band's share opens the answers in that band (`band` builds the destination). */
  link?: Linker;
  band?: (value: (typeof SENTIMENTS)[number]) => DrillTarget;
}) {
  const summary = sentimentShares(distribution, assessed, locale, t);
  const to = band;
  const bands = SENTIMENTS.map((band) => ({ band, share: (100 * (distribution[band] ?? 0)) / assessed })).filter((item) => item.share > 0);
  return (
    <Hint text={summary}>
      <span className={cn('sentiment-bar', className)}>
        <span className="sr-only">{summary}</span>
        <span className="sentiment-bar-track" aria-hidden="true">
          {bands.map(({ band, share }) => <span key={band} data-band={band} style={{ flexGrow: share, background: sentimentFill[band] }} />)}
        </span>
        {shares && (
          <span className="sentiment-bar-shares" aria-hidden={link && to ? undefined : 'true'}>
            {bands.map(({ band, share }) => (
              <span key={band} data-band={band} style={{ flexGrow: share, ...bandTone(band) }}>
                {link && to ? (
                  <DrillLink link={link} to={to(band)} aria-label={`${sentimentLabel(band, t)} ${formatPercent(locale, share, 0)}. ${t('Open these answers', 'Abrir estas respostas')}`}>
                    {formatPercent(locale, share, 0)}
                  </DrillLink>
                ) : formatPercent(locale, share, 0)}
              </span>
            ))}
          </span>
        )}
      </span>
    </Hint>
  );
}
/** The scores of each band of the 0–100 scale (`sentimentBand`). */
export const SENTIMENT_RANGES = { positive: '60–100', neutral: '40–59', negative: '0–39' };
/** What each criterion of the score means on screen (its points: `SENTIMENT_CRITERIA`). */
export function criterionLabel(criterion: SentimentCriterion, t: (en: string, pt: string) => string) {
  return {
    recommended: t('Recommended', 'Recomendou'),
    leader: t('Presented as the best or the leader', 'Apresentou como a melhor ou líder'),
    praised: t('Praised with a concrete fact', 'Elogiou com fato concreto'),
    reservation: t('Stated a reservation', 'Fez ressalva'),
    criticized: t('Criticized with a negative fact', 'Criticou com fato negativo'),
    against: t('Advised against it', 'Desaconselhou'),
  }[criterion];
}
/** "+20", "−30". */
export const criterionPoints = (criterion: SentimentCriterion) => `${SENTIMENT_CRITERIA[criterion] > 0 ? '+' : '−'}${Math.abs(SENTIMENT_CRITERIA[criterion])}`;
/** The rule in one line, for the definitions: "recommended +20, ..., advised against it −30". */
export const criteriaRule = (t: (en: string, pt: string) => string) =>
  CRITERIA.map((criterion) => `${criterionLabel(criterion, t).toLowerCase()} ${criterionPoints(criterion)}`).join(', ');
/** The why of one answer's score: "Starts at 50, +20 −15 = 55." */
export function scoreWhy(score: number, criteria: Partial<Record<SentimentCriterion, number>>, t: (en: string, pt: string) => string) {
  const met = CRITERIA.filter((criterion) => criteria[criterion] != null);
  if (!met.length) return t('No criterion met: a plain mention scores 50.', 'Nenhum critério atendido: menção simples fica com 50.');
  const sum = met.reduce((total, criterion) => total + SENTIMENT_CRITERIA[criterion], 50);
  const steps = met.map(criterionPoints).join(' ');
  return sum === score
    ? t(`Starts at 50, ${steps} = ${score}.`, `Parte de 50, ${steps} = ${score}.`)
    : t(`Starts at 50, ${steps} = ${score} (the score stays between 0 and 100).`, `Parte de 50, ${steps} = ${score} (a nota fica entre 0 e 100).`);
}
export function sentimentLabel(value: string, t: (en: string, pt: string) => string) {
  return ({
      positive: t('Promoters', 'Promotores'),
      neutral: t('Neutral', 'Neutros'),
      negative: t('Detractors', 'Detratores'),
      insufficient: t('Insufficient evidence', 'Evidência insuficiente'),
      ambiguous: t('Ambiguous identity', 'Identidade ambígua'),
      absent: t('No mention', 'Sem menção'),
      unassessed: t('Not evaluated', 'Não avaliado'),
      pending: t('Pending', 'Pendente'),
      partial: t('Partial coverage', 'Cobertura parcial'),
      submitting: t('Evaluating', 'Avaliando'),
      completed: t('Evaluated', 'Avaliado'),
      unsettled: t('Evaluated', 'Avaliado'),
      cancelled: t('Cancelled', 'Cancelado'),
      failed: t('Evaluation failed', 'Falha na avaliação'),
      unknown: t('Not evaluated', 'Não avaliado'),
    })[value] || value;
}
export function BrandSentimentAnalysis({
  report,
  project,
  onEvidence,
  label,
  evidenceBrand,
  link,
  answersOf,
}: {
  report: Pick<
    BrandResearchReport,
    'brands' | 'unread' | 'details' | 'detailsTruncated' | 'truncated'
  >;
  project: Project;
  onEvidence: (runId: string) => void;
  label: (value: string) => string;
  evidenceBrand?: string;
  /** Drill down: with one band chosen, the evidence brand's answers in that band open in Responses. */
  link?: Linker;
  answersOf?: (band: (typeof SENTIMENTS)[number]) => DrillTarget;
}) {
  const { locale } = useI18n(),
    t = (en: string, pt: string) => (locale === 'en' ? en : pt);
  const [brand, setBrand] = useState(project.name),
    [polarity, setPolarity] = useState('all'),
    [limit, setLimit] = useState(20);
  const compared = report.brands.filter((item) => !item.discovered || item.brand === evidenceBrand);
  const selectedBrand = evidenceBrand ?? (compared.some((item) => item.brand === brand)
    ? brand
    : 'all');
  const selectBrand = (value: string) => {
    setBrand(value);
    setPolarity('all');
    setLimit(20);
  };
  const details = (report.details ?? []).filter(
    (item) =>
      ((!evidenceBrand && (selectedBrand === 'all' || selectedBrand.split(',').includes(item.brand))) ||
        item.brand === selectedBrand) &&
      (polarity === 'all' || (item.sentiment != null && polarity.split(',').includes(item.sentiment))),
  );
  const evidenceTools = (
    <div className="ml-auto flex flex-wrap gap-2">
      {link && answersOf && evidenceBrand && SENTIMENTS.some((band) => band === polarity) && (
        <Button variant="outline" nativeButton={false} render={<a {...link(answersOf(polarity as (typeof SENTIMENTS)[number]))} aria-label={`${sentimentLabel(polarity, t)}: ${t('open these answers in Responses', 'abrir estas respostas em Respostas')}`} />}>
          {t('Open in Responses', 'Abrir em Respostas')}
        </Button>
      )}
      {!evidenceBrand && <FilterSelect
        label={t('Evidence brand', 'Marca nas evidências')}
        value={selectedBrand}
        onChange={selectBrand}
        options={[
          { value: 'all', label: t('All brands', 'Todas as marcas') },
          ...compared.map((item) => ({
            value: item.brand,
            label: item.brand,
          })),
        ]}
      />}
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
  );
  // A count only when a filter hides answers ("5 of 13"); with nothing filtered the list speaks for itself.
  const scope = evidenceBrand ? (report.details ?? []).filter((item) => item.brand === evidenceBrand).length : (report.details ?? []).length;
  const shownCount = details.length < scope
    ? t(`${formatNumber(locale, details.length)} of ${formatNumber(locale, scope)} brand readings in the latest answers`, `${formatNumber(locale, details.length)} de ${formatNumber(locale, scope)} leituras de marca nas últimas respostas`)
    : null;
  return (
    <div className={cn('min-w-0 space-y-7', !evidenceBrand && 'mt-6')}>
      {!evidenceBrand && <section
        aria-label={t('Sentiment comparison', 'Comparação de sentimentos')}
      >
        <SectionHeader
          as="h3"
          className="px-0 pt-0 pb-3"
          title={t(
            'Distribution of evaluated questions',
            'Distribuição das perguntas avaliadas',
          )}
          description={t(
            'Select a brand to inspect its responses.',
            'Selecione uma marca para inspecionar suas respostas.',
          )}
          action={
            <ul
              className="flex flex-wrap gap-x-4 gap-y-2 text-caption"
              aria-label={t('Sentiment legend', 'Legenda de sentimentos')}
            >
              {SENTIMENTS.map((sentiment) => (
                <li key={sentiment} className="flex items-center gap-1.5">
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: sentimentFill[sentiment] }}
                    aria-hidden="true"
                  />
                  {label(sentiment)} {SENTIMENT_RANGES[sentiment]}
                </li>
              ))}
            </ul>
          }
        />
        {compared.length ? (
          <div className="divide-y">
            {compared.map((item) => {
              const summary = SENTIMENTS.map(
                (sentiment) =>
                  `${label(sentiment)}: ${formatNumber(locale, item.distribution[sentiment])}`,
              ).join(', ');
              return (
                <article
                  key={item.brand}
                  className={`rounded-sm px-2 py-4 first:pt-0 ${selectedBrand === item.brand ? 'bg-muted/30' : ''}`}
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(140px,1fr)_minmax(0,2fr)]">
                    <div className="min-w-0">
                      <button
                        className="flex max-w-full items-center gap-2 text-left text-body hover:text-primary"
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
                      <p className="mt-1 text-caption text-muted-foreground">
                        {/* Sentiment reads the latest answer per question and model, not every answer of the period
                            (10/11/2026: "0 with mention" beside a 40% visibility read as a contradiction). */}
                        {t(
                          `Latest answers: mentioned in ${formatNumber(locale, item.prompts - item.absent)} of ${formatNumber(locale, item.prompts)} questions, ${formatNumber(locale, item.assessed)} evaluated`,
                          `Últimas respostas: citada em ${formatNumber(locale, item.prompts - item.absent)} de ${formatNumber(locale, item.prompts)} perguntas, ${formatNumber(locale, item.assessed)} avaliadas`,
                        )}
                      </p>
                    </div>
                    <div className="min-w-0">
                      {item.assessed ? (
                        <Hint text={summary}>
                        <button
                          className="flex h-7 w-full gap-0.5 overflow-hidden rounded-sm bg-muted"
                          aria-pressed={selectedBrand === item.brand}
                          onClick={() => selectBrand(item.brand)}
                          aria-label={`${item.brand}: ${summary}. ${t(`Of ${formatNumber(locale, item.assessed)} evaluated questions. View all response evidence.`, `De ${formatNumber(locale, item.assessed)} perguntas avaliadas. Ver todas as evidências por resposta.`)}`}
                        >
                          {SENTIMENTS.map(
                            (sentiment) =>
                              item.distribution[sentiment] > 0 && (
                                <span
                                  key={sentiment}
                                  aria-hidden="true"
                                  className="h-full basis-0"
                                  style={{ background: sentimentFill[sentiment], flexGrow: item.distribution[sentiment] }}
                                />
                              ),
                          )}
                        </button>
                        </Hint>
                      ) : (
                        <div className="flex h-7 items-center rounded-sm bg-muted px-2 text-caption text-muted-foreground">
                          {t(
                            'No evaluated sentiment',
                            'Sem sentimento avaliado',
                          )}
                        </div>
                      )}
                      <p
                        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption"
                        aria-label={`${item.brand}: ${summary}`}
                      >
                        {SENTIMENTS.map((sentiment) => (
                          <span key={sentiment}>
                            {label(sentiment)}{' '}
                            <span className="tabular-nums">
                              {item.assessed
                                ? formatNumber(locale, item.distribution[sentiment])
                                : '—'}
                            </span>
                          </span>
                        ))}
                      </p>
                      <p className="mt-2 text-caption text-muted-foreground">
                        {t('Not mentioned in the latest answers', 'Sem menção nas últimas respostas')}: {formatNumber(locale, item.absent)},{' '}
                        {t('Partial coverage', 'Cobertura parcial')}:{' '}
                        {formatNumber(locale, item.partial)}
                        {[
                          ['pending', item.pending],
                          ['insufficient', item.insufficient],
                          ['ambiguous', item.ambiguous],
                          ['failed', item.failed],
                        ].map(
                          ([state, count]) =>
                            Number(count) > 0 && (
                              <span key={state}>
                                {', '}
                                {label(String(state))}: {formatNumber(locale, Number(count))}
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
          <p className="mt-4 text-body text-muted-foreground">
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
        {!!report.unread?.length && (
          <ul
            className="mt-4 divide-y border-t"
            aria-label={t(
              'Competitors without a sentiment reading',
              'Concorrentes sem leitura de sentimento',
            )}
          >
            {report.unread.map((name) => (
              <li
                key={name}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-3"
              >
                <SiteFavicon
                  name={name}
                  domain={
                    project.competitors.find((item) => item.name === name)
                      ?.domain || ''
                  }
                />
                <span className="text-body break-words">{name}</span>
                <span className="text-caption text-muted-foreground">
                  {t(
                    'No sentiment reading: Sentiment reads your brand and the first five competitors.',
                    'Sem leitura de sentimento: o Sentiment lê sua marca e os cinco primeiros concorrentes.',
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>}
      <section
        className={evidenceBrand ? '' : 'border-t pt-5'}
        aria-label={t('Answer evidence', 'Evidências das respostas')}
      >
        {evidenceBrand ? (
          // The card around names the brand and the section: only the filters and the count here, never a second title.
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {shownCount && <p className="text-caption text-muted-foreground">{shownCount}</p>}
            {evidenceTools}
          </div>
        ) : (
          <>
            <SectionHeader
              as="h3"
              className="px-0 pt-0 pb-3"
              title={t('Answer evidence', 'Evidências das respostas')}
              description={t(
                'Filters below affect loaded answer details only. Each answer has its own score from 0 to 100, with the criteria that explain it; a question takes the mean of its models. The comparison above stays unchanged.',
                'Os filtros abaixo afetam somente os detalhes de respostas carregados. Cada resposta tem a sua nota de 0 a 100, com os critérios que a explicam; uma pergunta fica com a média dos seus modelos. A comparação acima permanece igual.',
              )}
              action={evidenceTools}
            />
            {shownCount && <p className="mt-3 text-caption text-muted-foreground">{shownCount}</p>}
          </>
        )}
        {report.detailsTruncated && (
          // Only when the report's limit was reached, in one plain sentence.
          <output className="mt-3 block text-caption text-muted-foreground">
            {t(
              'Only the most recent answers are listed; narrow the period to see older ones.',
              'Só as respostas mais recentes aparecem; restrinja o período para ver as anteriores.',
            )}
          </output>
        )}
        {details.length ? (
          <Accordion multiple className="mt-3">
            {details.slice(0, limit).map((detail) => (
              <AccordionItem className="min-w-0" key={`${detail.runId}:${detail.brand}`} value={`${detail.runId}:${detail.brand}`}>
                <AccordionTrigger className="min-w-0 items-start gap-3 py-4 text-body font-(--weight-text) hover:no-underline">
                  <span className="min-w-0">
                    <span className="block break-words">
                      {detail.prompt}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                      <span>
                        {detail.brand},{' '}
                        {detail.score != null
                          ? t(`score ${detail.score}/100`, `nota ${detail.score}/100`)
                          : label(detail.state)}
                      </span>
                      <EngineBadge engine={detail.engine} />
                      <time dateTime={detail.date}>{relativeReportDate(detail.date, locale)}</time>
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent keepMounted className="pb-4 text-body">
                  <Button
                    variant="outline"
                    onClick={() => onEvidence(detail.runId)}
                  >
                    {t('Open full response', 'Abrir resposta completa')}
                  </Button>
                  {detail.criteria && detail.score != null && (
                    <p className="mt-3 text-caption">{scoreWhy(detail.score, detail.criteria, t)}</p>
                  )}
                  {detail.evidence.map((excerpt, index) => {
                    // The criteria this quote shows, above it.
                    const met = CRITERIA.filter((criterion) => detail.criteria?.[criterion] === index);
                    return (
                      <figure key={index} className="mt-3">
                        {met.length > 0 && (
                          <figcaption className="mb-1 text-caption">
                            {met.map((criterion) => `${criterionLabel(criterion, t)} ${criterionPoints(criterion)}`).join(', ')}
                          </figcaption>
                        )}
                        <blockquote className="break-words border-l-2 pl-3 text-muted-foreground">
                          <ExcerptMarkdown text={excerpt} brands={[detail.brand]} />
                        </blockquote>
                      </figure>
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="mt-4 text-body text-muted-foreground">
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
            onClick={() => setLimit((value) => value + 20)}
          >
            {t('Show more evidence', 'Mostrar mais evidências')}
          </Button>
        )}
      </section>
    </div>
  );
}
