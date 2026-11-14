'use client';
import { formatNumber } from '@/lib/number-format';
import { Heart } from 'lucide-react';
import { useKeptReport } from '@/hooks/use-kept-report';
import type { requestJson } from '@/lib/client';
import { MetricCard } from '@/components/lastfind/presentation/metric-card';
import { ENGINE_LABELS, isEngine } from '@/lib/engines';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import type { BrandResearchReport } from './brand-research-panel';

type Props = {
  brand: string;
  /** Drill down: the index and each model's row open the brand's page (sentiment and its answer evidence). */
  link?: Linker;
  locale: string;
  demo: boolean;
  /** The project's channels, one row each, as on the other Overview cards. */
  engines?: string[];
  report?: BrandResearchReport;
  loading?: boolean;
  error?: string;
  /** The viewer runs this installation (independent edition): server setup may be named. */
  operator?: boolean;
  /** A new project's first answers are still being processed (live-app.tsx): an index not there yet is on its way. */
  settling?: boolean;
};

// The score lives in the shared library so the Cloud email digest reads the same definition.
import { sentimentScore } from '@/lib/brand-research';
import { researchReadPath } from './screen-reads';
import { criteriaRule, SentimentBar } from './brand-sentiment-analysis';
import { DrillLink, type Linker } from './drill-link';
import { brandKey } from '@/lib/brand-decisions';
export { sentimentScore };

/** What the sentiment index is, for every screen that shows it (its formula is `sentimentScore`). */
export const sentimentIndexDefinition = (t: (en: string, pt: string) => string) =>
  t(
    `Sentiment index from 0 to 100: the mean of the scores the brand gets in each answer. Each answer starts at 50 and the evaluator answers yes or no to fixed criteria: ${criteriaRule(t)}. The score stays between 0 and 100; a plain mention is 50. Each question counts once, with the mean of its models (latest answer per question and model). Promoters score 60–100, neutral 40–59, detractors 0–39; the bar beside the index shows their shares in green, yellow and red.`,
    `Índice de sentimento de 0 a 100: a média das notas que a marca recebe em cada resposta. Cada resposta parte de 50 e o avaliador responde sim ou não a critérios fixos: ${criteriaRule(t)}. A nota fica entre 0 e 100; uma menção simples fica com 50. Cada pergunta conta uma vez, com a média dos seus modelos (última resposta por pergunta e modelo). Promotores têm nota 60–100, neutros 40–59 e detratores 0–39; a barra ao lado do índice mostra a parcela de cada um em verde, amarelo e vermelho.`,
  );
/** Presentation consumes the server's question-level aggregate, never its detail sample. */
export function OverviewSentimentCard({
  brand,
  locale,
  demo,
  engines,
  report,
  loading,
  error,
  operator = false,
  link,
  settling = false,
}: Props) {
  const t = (en: string, pt: string) => (locale === 'en' ? en : pt);
  const row = report?.brands.find((item) => item.brand === brand);
  const measured =
    !loading &&
    !error &&
    !!report?.selectedChannels &&
    row &&
    sentimentScore(row) != null;
  const integer = (value: number) => formatNumber(locale, value);
  // The public demo has no band filter in Responses: every figure of the card is plain there, never some links and not others.
  const drill = demo ? undefined : link;
  const openBrand = t('Open brand page', 'Abrir página da marca');
  let reason: string;
  let status = t('Not evaluated', 'Não avaliado');
  if (loading) {
    status = t('Loading…', 'Carregando…');
    reason = t(
      'Loading sentiment for this period.',
      'Carregando sentimento deste período.',
    );
  } else if (demo && (error || !report?.configuration?.enabled))
    reason = t(
      'Sentiment is not available in this demo.',
      'Sentimento não está disponível nesta demonstração.',
    );
  else if (error || !report) {
    status = t('Unavailable', 'Indisponível');
    reason = t(
      'Could not load sentiment. Try again by reopening Overview.',
      'Não foi possível carregar o sentimento. Tente novamente ao reabrir a Visão geral.',
    );
  } else if (!report.configuration?.enabled)
    reason = t(
      'Sentiment evaluation is off for this project.',
      'A avaliação de sentimento está desligada neste projeto.',
    );
  // A measured index shows its promoter, neutral and detractor shares as a bar beside it; an unmeasured one gets one neutral line.
  // Queue, coverage and failure states are operational, not for the Overview. Only the owner of an independent installation hears
  // about server setup.
  else if (measured) reason = '';
  else if (operator && !report.configured)
    reason = t(
      'The evaluator is not configured on this server.',
      'O avaliador não está configurado neste servidor.',
    );
  else if (!report.selectedChannels)
    reason = t('No responses in this period.', 'Sem respostas neste período.');
  else if (row && row.prompts > 0 && row.absent === row.prompts)
    reason = t(
      'No brand mentions in the selected responses.',
      'Sem menções à marca nas respostas selecionadas.',
    );
  else if (settling) {
    status = t('Evaluating…', 'Avaliando…');
    reason = t('The first answers are being evaluated. This card updates on its own.', 'As primeiras respostas estão sendo avaliadas. Este card se atualiza sozinho.');
  } else reason = t('Waiting for the evaluation of these answers.', 'Aguardando a avaliação destas respostas.');
  return (
    <MetricCard
      // "Sentiment" alone keeps the header on one line in both languages (card-row harmony); the info says it is an index.
      label={t('Sentiment', 'Sentimento')}
      icon={<Heart size={15} />}
      // The definition only: no count of evaluated questions on the Overview (since 10/11/2026).
      definition={sentimentIndexDefinition(t)}
      value={
        measured ? (
          <>
            {drill ? (
              <DrillLink link={drill} to={{ tab: 'competitors', brandPage: brandKey(brand) }} aria-label={`${t('Sentiment index', 'Índice de sentimento')}: ${integer(sentimentScore(row)!)}. ${openBrand}`}>
                {integer(sentimentScore(row)!)}
              </DrillLink>
            ) : integer(sentimentScore(row)!)}
            <SentimentBar
              distribution={row.distribution}
              assessed={row.assessed}
              locale={locale}
              t={t}
              shares
              link={drill}
              // The band's answers: the drill already holds only answers that mention the brand (the effective mention), so
              // no mention filter rides along.
              band={(band) => ({ tab: 'responses', brand: null, brandLabel: null, sentiment: band, mention: 'all', cites: null, run: null })}
            />
          </>
        ) : (
          <span className="text-body">{status}</span>
        )
      }
      rows={measured ? engines?.map((engine) => {
        const channel = row?.channels?.find((item) => item.engine === engine);
        const score = channel ? sentimentScore(channel) : null;
        return {
          key: engine,
          icon: <EngineIcon engine={engine} size={14} />,
          label: isEngine(engine) ? ENGINE_LABELS[engine] : engine,
          value: score == null ? '—' : drill ? (
            <DrillLink link={drill} to={{ tab: 'competitors', brandPage: brandKey(brand), engine }} aria-label={`${t('Sentiment index', 'Índice de sentimento')}, ${isEngine(engine) ? ENGINE_LABELS[engine] : engine}: ${integer(score)}. ${openBrand}`}>
              {integer(score)}
            </DrillLink>
          ) : integer(score),
        };
      }) : undefined}
      description={
        reason ? (
          <span
            role={error ? 'alert' : undefined}
            aria-busy={loading || undefined}
          >
            {reason}
          </span>
        ) : undefined
      }
    />
  );
}

/** The answers name the brand and the evaluator is on, but they have no index yet: their evaluation is on its way. */
export function awaitingEvaluation(report: BrandResearchReport | null | undefined, brand: string) {
  const row = report?.brands.find((item) => item.brand === brand);
  if (!report?.configuration?.enabled || !report.configured || !report.selectedChannels) return false;
  return !(row && row.prompts > 0 && row.absent === row.prompts) && !(row && sentimentScore(row) != null);
}

/**
 * The sentiment read of the Overview. The screen calls it as soon as it opens, beside the reports, so the card never waits for the
 * summary to arrive before its own request starts. The demo reads the public aggregate (`/api/demo/brand-research`), never the private endpoint.
 */
export function useOverviewSentiment({
  projectId,
  filters,
  refresh,
  demo,
  request,
}: {
  request?: typeof requestJson;
  /** Null while the Overview is not the open screen: nothing is fetched. */
  projectId: string | null;
  filters: URLSearchParams;
  refresh: string | number;
  demo: boolean;
}) {
  const url = projectId ? researchReadPath(demo, projectId, filters) : null;
  // The same copy the Brands screen keeps for this reading: the card paints at once on a later visit.
  const remote = useKeptReport<BrandResearchReport>(url, url && !demo ? `lastfind:brand-research:${url}` : null, refresh, request);
  return { report: remote.data, loading: remote.loading, error: remote.error };
}
