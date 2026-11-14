'use client';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { formatNumber, formatPercent } from '@/lib/number-format';
import { useReport } from '@/hooks/use-report';
import type { requestJson } from '@/lib/client';
import type { CompetitorsReport } from '@/lib/report-types';
import type { Project } from '@/lib/types';
import { brandKey } from '@/lib/brand-decisions';
import { sentimentScore } from '@/lib/brand-research';
import { Skeleton } from '@/components/ui/skeleton';
import { researchPanelPath, type BrandResearchReport } from './brand-research-panel';
import { SentimentBar, sentimentShares } from './brand-sentiment-analysis';
import { ALL_BRANDS, brandShown, type BrandFilter } from '@/lib/brand-filter';
import type { BrandChoice } from './brands-filter';
import { EmptyState, SiteFavicon } from './shared';

type Translate = (en: string, pt: string) => string;

type RankedBrand = { name: string; domain: string; mentions: number; visibility: number; shareOfVoice?: number | null };

/**
 * Who the AIs name for this prompt, from the existing competitors report scoped to the prompt: the monitored brands and
 * the discovered competitors its answers name, by relevance, as the header's Brands filter lists them. A discovery
 * is named from `discovered` (the 50 most mentioned); one beyond them is left out.
 */
/** The read of {@link PromptBrandRanking}: the prompt page starts it with the prompt's own report, so the two run together. */
export function promptRankingPath(api: string, filters: URLSearchParams, promptId: string) {
  const params = new URLSearchParams(filters);
  params.set('view', 'competitors');
  params.set('prompt', promptId);
  return `${api}/reports?${params}`;
}
/**
 * The sentiment readings of this prompt's latest answers (the read the prompt page starts with its report, researchPanelPath):
 * each brand's score for the prompt and each answer's per brand. None in the public demo.
 */
export function usePromptSentiment(project: Project, filters: URLSearchParams, promptId: string, demo: boolean, request?: typeof requestJson) {
  return useReport<BrandResearchReport>(demo ? null : researchPanelPath(project.id, filters, { promptId }), 0, request);
}
export function PromptBrandRanking({ api, filters, promptId, project, locale, t, listed = ALL_BRANDS, discovered = new Map(), request, demo = false }: { api: string; filters: URLSearchParams; promptId: string; project: Project; locale: string; t: Translate; listed?: BrandFilter; discovered?: ReadonlyMap<string, BrandChoice>; request?: typeof requestJson; demo?: boolean }) {
  const report = useReport<CompetitorsReport>(promptRankingPath(api, filters, promptId), 0, request);
  const sentiment = usePromptSentiment(project, filters, promptId, demo, request);
  const reading = (name: string) => sentiment.data?.brands.find((item) => item.brand === name && item.assessed > 0);
  const totals = report.data?.totals;
  const share = (part: number, whole: number | undefined) => (whole ? (part / whole) * 100 : 0);
  const rows: RankedBrand[] = [
    ...(report.data?.platforms ?? []).filter((row) => row.responses > 0 && brandShown(listed, brandKey(row.name), row.name === project.name ? 'own' : 'monitored')),
    // Rates are topic-weighted, as the Brands screen measures them; only a counted competitor has a share of voice.
    ...Object.entries(report.data?.discovered ?? {}).flatMap(([key, found]) => {
      const brand = discovered.get(key);
      return brand && found.counted && found.mentions > 0 && brandShown(listed, key, 'discovered')
        ? [{ name: brand.name, domain: brand.domain, mentions: found.mentions, visibility: share(found.weightedMentions, totals?.weightedAnalysed ?? totals?.weightedResponses), shareOfVoice: share(found.weightedMentions, totals?.weightedMentions) }]
        : [];
    }),
  ].sort((left, right) => right.mentions - left.mentions || left.name.localeCompare(right.name));
  return (
    <SectionCard title={t('Brands the AIs mention', 'Marcas que as IAs mencionam')} info={t('Brands in the answers to this prompt, most mentioned first, with their share of the mentions of every identified brand: the monitored ones (0% when not mentioned) and the discovered competitors the answers name.', 'Marcas nas respostas deste prompt, das mais mencionadas para as menos, com sua parcela das menções de todas as marcas identificadas: as monitoradas (0% quando não mencionadas) e as concorrentes descobertas que as respostas citam.')}>
      {report.error ? (
        <EmptyState frame="bare" tone="error" title={t('Could not load the brand ranking.', 'Não foi possível carregar o ranking de marcas.')} />
      ) : !report.loading && !rows.length ? (
        <EmptyState frame="bare" title={t('No answer was collected for this prompt in the selected period, so there is no ranking yet.', 'Nenhuma resposta foi coletada para este prompt no período selecionado, então ainda não há ranking.')} />
      ) : (
        <DataTable
          // Four figures per brand do not fit a phone's row: stacked cards there, one line from a tablet up.
          singleLine="wide"
          minWidth={0}
          rows={rows}
          loading={report.loading ? 3 : undefined}
          ariaLabel={report.loading ? t('Loading brands…', 'Carregando marcas…') : undefined}
          rowKey={(row) => row.name}
          rowClassName={(row) => (row.domain === project.domain || row.name === project.name ? 'own-brand-row' : undefined)}
          columns={[
            { key: 'rank', header: '#', width: '2rem', align: 'center', mobile: 'hide', cell: (_, index) => <span className="text-muted-foreground">{formatNumber(locale, index + 1, 0)}</span> },
            { key: 'brand', header: t('Brand', 'Marca'), mobile: 'title', sortValue: (row) => row.name, cell: (row) => <span className="flex items-center gap-2"><SiteFavicon domain={row.domain} name={row.name} />{row.name}{(row.domain === project.domain || row.name === project.name) && <TagBadge tone="primary">{t('You', 'Você')}</TagBadge>}</span> },
            { key: 'visibility', header: t('Visibility', 'Visibilidade'), label: t('Visibility', 'Visibilidade'), align: 'end', sortValue: (row) => row.visibility, cell: (row) => formatPercent(locale, row.visibility) },
            { key: 'sov', header: t('Share of voice', 'Share of voice'), label: t('Share of voice', 'Share of voice'), align: 'end', sortValue: (row) => row.shareOfVoice, cell: (row) => (row.shareOfVoice != null ? formatPercent(locale, row.shareOfVoice) : '—') },
            {
              key: 'sentiment',
              header: t('Sentiment', 'Sentimento'),
              label: t('Sentiment', 'Sentimento'),
              info: t(
                'Sentiment of the brand in this prompt, 0 to 100: the mean of its scores in the latest answer of each AI (60–100 promoter, 40–59 neutral, 0–39 detractor). The bar splits them by band; the detail is under Brand sentiment below.',
                'Sentimento da marca neste prompt, de 0 a 100: a média das notas na resposta mais recente de cada IA (60–100 promotor, 40–59 neutro, 0–39 detrator). A barra as divide por faixa; o detalhe está em Sentimento da marca, abaixo.',
              ),
              sortValue: (row) => {
                const found = reading(row.name);
                return found ? sentimentScore(found) : null;
              },
              cell: (row) => {
                if (!row.mentions) return <span className="text-muted-foreground">{t('No mention', 'Sem menção')}</span>;
                if (sentiment.loading && !sentiment.data) return <Skeleton className="h-4 w-16" />;
                if (sentiment.error) return <span className="text-muted-foreground">{t('Unavailable', 'Indisponível')}</span>;
                const found = reading(row.name);
                const score = found ? sentimentScore(found) : null;
                if (!found || score == null) return <span className="text-muted-foreground">{t('Not evaluated', 'Não avaliado')}</span>;
                return (
                  <span className="flex items-center gap-2" aria-label={`${t('Sentiment', 'Sentimento')} ${score}. ${sentimentShares(found.distribution, found.assessed, locale, t)}`}>
                    <span className="tabular-nums">{formatNumber(locale, score, 0)}</span>
                    <SentimentBar distribution={found.distribution} assessed={found.assessed} locale={locale} t={t} />
                  </span>
                );
              },
            },
          ]}
        />
      )}
    </SectionCard>
  );
}
