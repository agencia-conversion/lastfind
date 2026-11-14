'use client';
import { useState } from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';
import { ENGINE_LABELS } from '@/lib/engines';
import { formatNumber, formatPercent } from '@/lib/number-format';
import { relativeReportDate } from '@/lib/report-date';
import { useReport } from '@/hooks/use-report';
import type { PromptDetail } from '@/lib/report-types';
import type { Engine, Project, Run } from '@/lib/types';
import { AnswerMarkdown } from './answer-markdown';
import { DrillLink, type Linker } from './drill-link';
import { SiteFavicon } from './shared';
import { sentimentBand } from '@/lib/brand-research';
import { sentimentTone } from './brand-sentiment-analysis';
import type { BrandResearchReport } from './brand-research-panel';
import { usePromptSentiment } from './prompt-brand-ranking';
import type { requestJson } from '@/lib/client';

type Translate = (en: string, pt: string) => string;
/** The roles of the answer's brands its view marks: the monitored ones and every brand the answer names (not a pending or ambiguous name). */
const MARKED = new Set(['competitor', 'client', 'supplier', 'partner']);
/** Every brand the answer view marks: the project's own, the monitored ones and the discovered brands it names, with their aliases. */
export const answerHighlight = (project: Project, run: Run) => ({
  own: [run.brand_name || project.name, ...project.aliases],
  others: [
    ...(run.targets ?? []).flatMap((target) => [target.name, ...(target.aliases ?? [])]),
    ...(run.brands ?? []).filter((brand) => MARKED.has(brand.role)).flatMap((brand) => [brand.name, ...(brand.aliases ?? [])]),
  ].filter((name) => name !== (run.brand_name || project.name)),
});

/** The header's Brands filter: whether it lists a brand, monitored or discovered. */
type Listed = (name: string, monitored: boolean) => boolean;

// The newest complete answer of one model, with the monitored brands highlighted and, beside them, the competitors it names.
/** One brand's score in one answer (the prompt's sentiment read, `details`), with its band. */
type AnswerSentiment = BrandResearchReport['details'][number];
const bandName = (score: number, t: Translate) =>
  ({ positive: t('promoter', 'promotor'), neutral: t('neutral', 'neutro'), negative: t('detractor', 'detrator') })[sentimentBand(score)];

function LatestAnswer({ runId, api, project, link, locale, t, listed, sentiment }: { runId: string; api: string; project: Project; link: Linker; locale: string; t: Translate; listed: Listed; sentiment?: AnswerSentiment[] }) {
  const run = useReport<Run>(`${api}/runs/${encodeURIComponent(runId)}`);
  if (run.error) return <p className="px-5 pb-4 text-muted-foreground" role="alert">{t('This response is unavailable.', 'Esta resposta está indisponível.')}</p>;
  if (!run.data)
    return (
      <div className="grid grid-cols-1 gap-3 px-5 pb-5" aria-busy="true">
        <span className="sr-only">{t('Loading response…', 'Carregando resposta…')}</span>
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  const data = run.data;
  const mentioned = [
    ...Object.entries(data.mentions ?? {}).filter(([name, value]) => value && listed(name, true)).map(([name]) => name),
    ...(data.brands ?? []).filter((brand) => brand.role === 'competitor' && listed(brand.name, false)).map((brand) => brand.name),
  ];
  return (
    <div className="grid grid-cols-1 gap-3 px-5 pb-5">
      <p className="live-run-meta">
        <time dateTime={data.created_at}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.created_at))}</time>
        {mentioned.length ? (
          <span className="flex flex-wrap gap-1">
            {mentioned.map((name) => {
              // The brand's score in this answer, when it was evaluated: its band's colour and the number beside the name.
              const score = sentiment?.find((item) => item.runId === runId && item.brand === name)?.score;
              const why = score != null ? `${t('Sentiment in this answer', 'Sentimento nesta resposta')}: ${formatNumber(locale, score, 0)}/100, ${bandName(score, t)}` : undefined;
              return (
                <TagBadge key={name} tone={name === data.brand_name ? 'primary' : 'neutral'} dotColor={score != null ? sentimentTone[sentimentBand(score)] : undefined} title={why}>
                  {name}
                  {score != null && (
                    <>
                      <span className="tabular-nums text-muted-foreground" aria-hidden="true">{formatNumber(locale, score, 0)}</span>
                      <span className="sr-only">{why}</span>
                    </>
                  )}
                </TagBadge>
              );
            })}
          </span>
        ) : (
          <span>{t('No brand the Brands filter lists is mentioned in this answer.', 'Nenhuma marca listada pelo filtro Marcas é mencionada nesta resposta.')}</span>
        )}
      </p>
      {data.answer ? <AnswerMarkdown text={data.answer} highlight={answerHighlight(project, data)} /> : <p>{t('Answer not available yet.', 'Resposta ainda indisponível.')}</p>}
      {data.sources.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          <span>{t('Cited sources', 'Fontes citadas')}:</span>
          {[...new Set(data.sources.map((source) => source.domain))].slice(0, 6).map((domain) => (
            <DrillLink key={domain} link={link} to={{ tab: 'sources', prompt: null, entity: { kind: 'domain', key: domain } }} className="inline-flex items-center gap-1">
              <SiteFavicon domain={domain} name={domain} />{domain}
            </DrillLink>
          ))}
        </p>
      ) : (
        <p className="text-caption text-muted-foreground">{t('This model returned no citations for this answer.', 'Este modelo não retornou citações nesta resposta.')}</p>
      )}
      <DrillLink link={link} to={{ tab: 'responses', prompt: null, run: runId }} plain className={`${buttonVariants({ variant: 'ghost' })} justify-self-start`}>
        {t('Open full response', 'Abrir resposta completa')}<ArrowUpRight size={13} aria-hidden="true" />
      </DrillLink>
    </div>
  );
}

/** Every model side by side (visibility, position) with its newest answer one click away. */
export function PromptAnswersByModel({ detail, api, project, link, locale, t, listed = () => true, filters, promptId, demo = false, request }: { detail: PromptDetail; api: string; project: Project; link: Linker; locale: string; t: Translate; listed?: Listed; /** With them, each brand's score in each latest answer (the prompt's sentiment read); none in the demo. */ filters?: URLSearchParams; promptId?: string; demo?: boolean; request?: typeof requestJson }) {
  const sentiment = usePromptSentiment(project, filters ?? new URLSearchParams(), promptId ?? '', demo || !promptId, request).data?.details;
  const [open, setOpen] = useState<Engine | null>(detail.platforms[0]?.engine ?? null);
  return (
    <SectionCard
      title={t('How each AI answers', 'Como cada IA responde')}
      info={t('Visibility and position by model, with the newest answer and the brands highlighted. The number beside a brand is its sentiment in that answer, 0 to 100 (60–100 promoter, 40–59 neutral, 0–39 detractor).', 'Visibilidade e posição por modelo, com a resposta mais recente e as marcas destacadas. O número ao lado de uma marca é o sentimento dela naquela resposta, de 0 a 100 (60–100 promotor, 40–59 neutro, 0–39 detrator).')}
    >
      {!detail.platforms.length && (
        <p className="px-5 pb-5 text-muted-foreground">{t('No AI has answered this prompt in the selected period yet. Each model appears here, with its newest answer, as soon as one is collected.', 'Nenhuma IA respondeu a este prompt no período selecionado ainda. Cada modelo aparece aqui, com a resposta mais recente, assim que houver uma coletada.')}</p>
      )}
      <ul className="divide-y">
        {detail.platforms.map((row) => {
          const expanded = open === row.engine;
          return (
            <li key={row.engine}>
              <button
                type="button"
                aria-expanded={expanded}
                disabled={!row.latestRunId}
                onClick={() => setOpen(expanded ? null : row.engine)}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2 px-5 py-3 text-left sm:grid-cols-[minmax(0,12rem)_1fr_5rem_5rem_auto]"
              >
                <span className="flex items-center gap-2 text-body"><EngineIcon engine={row.engine} />{ENGINE_LABELS[row.engine]}</span>
                <span className="order-last col-span-3 sm:order-none sm:col-span-1" aria-hidden="true"><span className="prompt-visibility-bar"><span style={{ width: `${Math.min(100, row.visibility)}%` }} /></span></span>
                <Hint text={t('Share of answers that mention the brand', 'Parcela das respostas que mencionam a marca')}>
                <span className="text-body">
                  {row.responses ? formatPercent(locale, row.visibility) : '—'}
                  <span className="block text-caption text-muted-foreground">{t('visibility', 'visibilidade')}</span>
                </span>
                </Hint>
                <Hint text={t('Mean rank of the first mention in the text', 'Posição média da primeira menção no texto')}>
                <span className="hidden text-body sm:block">
                  {row.position != null ? formatNumber(locale, row.position, 1) : '—'}
                  <span className="block text-caption text-muted-foreground">{row.position != null ? t('position', 'posição') : t('not mentioned', 'sem menção')}</span>
                </span>
                </Hint>
                <ChevronDown size={14} aria-hidden="true" className={expanded ? 'rotate-180' : ''} />
              </button>
              <p className="px-5 pb-3 text-caption text-muted-foreground">
                {formatNumber(locale, row.responses, 0)} {t('responses', 'respostas')}, {formatNumber(locale, row.mentions, 0)} {t('mentions', 'menções')}
                <span className="sm:hidden">, {t('position', 'posição')} {row.position != null ? formatNumber(locale, row.position, 1) : t('not mentioned', 'sem menção')}</span>
                {row.latestRunId && row.latestAt && <>, {t('latest', 'última')} {relativeReportDate(row.latestAt, locale)}</>}
                {!row.latestRunId && <>, {t('no complete answer in this period', 'sem resposta completa neste período')}</>}
              </p>
              {expanded && row.latestRunId && <LatestAnswer runId={row.latestRunId} api={api} project={project} link={link} locale={locale} t={t} listed={listed} sentiment={sentiment} />}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
