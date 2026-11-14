'use client';
// Semantic Branding as one report. It measures how AI models perceive the brand on the configured attributes, from the
// collection the project runs on its own (one question per AI covering every brand and attribute, see lib/server/semantic-panel-worker.ts).
// The KPI cards, the evolution and the score of each brand inside each AI (built like the Overview), the heatmap of brands by attribute, the
// justification of every note on the chosen attribute and the sources the AIs cited. The period and the AI filter are the page header's;
// the frequency of the evolution is the project's. Since 8/11/2026 every AI the project monitors is asked the way its daily collection asks it.
import { useEffect, useState, type ReactNode } from 'react';
import { ViewAllAction, type Linker } from './drill-link';
import { UrlCell } from './url-cell';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { BarList, type BarListRow } from '@/components/lastfind/presentation/bar-list';
import { Skeleton } from '@/components/ui/skeleton';
import { BarListSkeleton } from '@/components/lastfind/presentation/bar-list';
import { ENGINE_LABELS } from '@/lib/engines';
import type { Engine } from '@/lib/types';
import { type BrandScore } from '@/lib/semantic-perception';
import { CHART_SERIES_COUNT } from '@/lib/chart-series';
import { cutBrandRanking } from '@/lib/brand-ranking-cut';
import type { PanelFrequency } from '@/lib/semantic-panel';
import type { SemanticAggregate } from '@/lib/semantic-report';
import { EmptyState, FilterSelect, ModelMark, useCopy, useNumbers } from './shared';
import { Note } from '@/components/lastfind/presentation/note';
import { panelBlockCopy } from './spend-labels';
import { SemanticAssociationReport, SemanticRadarChart, brandColor, panelOrder } from './semantic-association-report';
import { measuredAssociationReport } from './semantic-measured-data';
import { BrandName, SemanticAssistantTable, SemanticEvolution, SemanticKpis, SemanticSkeleton, leftOutNote } from './semantic-summary';
import { SemanticJustifications } from './semantic-justifications';
import './semantic-perception.css';

export type Score = BrandScore & {
  name: string;
  domain: string;
  change: { delta: number; significant: boolean } | null;
  previousScore: number | null;
  /** The period's own score, from its notes alone (the shown `score` is smoothed over the latest collections). */
  daily?: number | null;
};
/** `unread`: the AI answered (an AI Overview in prose) but its answer rated none of these brands on these attributes. */
type QueryState = { engine: Engine; status: string; error?: string | null; unread?: boolean };
/** An AI the project monitors that Semantic Branding leaves out: it is not offered in the project's country. */
type LeftOut = { engine: Engine; reason: 'country' };
type Waiting = {
  reason: 'few-engines' | 'not-collecting' | 'scheduled' | 'blocked' | 'running' | 'no-notes';
  engines: Engine[];
  left: LeftOut[];
  minEngines: number;
  firstQueryDay: string;
  round: { day: string; status: string; queries?: QueryState[] } | null;
  /** When the first notes usually arrive (scheduled or running). */
  expectedBy?: string;
};
/** One AI of "Score by AI": its query's status and the overall score of each brand inside it. */
export type AssistantColumn = QueryState & { readings: number; scores: (number | null)[] };
export type Perception = {
  status: 'ready' | 'waiting' | 'disabled' | 'outside';
  configuration: { enabled: boolean; attributes: { id: string; name: string; description?: string }[] };
  frequency: PanelFrequency;
  ownBrand: string;
  minUnits: number;
  /** The header picks fewer AIs than the minimum: their mean is shown without a margin. */
  filter: { engines: Engine[] };
  period: string | null;
  periods: string[];
  latestPeriod?: string;
  /** `filtered`: the header's AI filter hides every AI this collection asked (without it some would show). */
  round: { day: string; status: string; queries: (QueryState & { method: 'llm' | 'scrape'; model: string; readings: number })[]; filtered?: boolean } | null;
  /** AIs that gave notes. */
  answered: Engine[];
  queries: number;
  waiting: Waiting | null;
  /** A spending limit refused the next round: which one. */
  blocked?: { reason: string } | null;
  scores: Score[];
  trend: Array<Record<string, number | string | null>>;
  /** Score by AI: the overall score of each brand (in `brands` order) inside each AI. */
  byAssistant: { brands: string[]; columns: AssistantColumn[] } | null;
  association: SemanticAggregate | null;
  sources: { domain: string; url: string; title: string; answers: number; engines: Engine[] }[];
  /** Brands listed today that the latest collection did not ask (added since): they enter the next one. */
  added: string[];
  /** The AIs the project monitors that Semantic Branding leaves out, with why. */
  left: LeftOut[];
};
type Request = <T>(path: string, method?: string, data?: unknown) => Promise<T>;

/** The part of the page's filters this report reads: the project, the date range and the AI filter with its mode. Topics and tags do not apply. */
export function panelQuery(filters: URLSearchParams) {
  const query = new URLSearchParams();
  for (const key of ['project', 'days', 'start', 'end', 'engine']) {
    const value = filters.get(key);
    if (value) query.set(key, value);
  }
  return query;
}

/**
 * The Semantic Branding report read by another screen (the AI models table), with the same filters as the Semantic Branding page.
 * Fetched only while `enabled`; `state` says whether it is loading, ready or failed.
 */
export function useSemanticReport({ projectId, filters, request, refresh, demo = false, enabled }: {
  projectId: string | null | undefined; filters: URLSearchParams; request: Request; refresh: number; demo?: boolean; enabled: boolean;
}) {
  const [found, setFound] = useState<{ key: string; data: Perception | null; state: 'ready' | 'failed' } | null>(null);
  const base = demo ? '/api/demo/semantic/panel' : `/api/projects/${encodeURIComponent(projectId ?? '')}/semantic/panel`;
  const key = `${base}?${panelQuery(filters).toString()}#${refresh}`;
  useEffect(() => {
    if (!enabled || !projectId) return;
    let active = true;
    request<Perception>(key.replace(/#\d+$/, ''))
      .then((report) => { if (active) setFound({ key, data: report, state: 'ready' }); })
      .catch((cause) => { if (active && cause?.name !== 'AbortError') setFound({ key, data: null, state: 'failed' }); });
    return () => { active = false; };
  }, [enabled, projectId, key, request]);
  return found?.key === key ? found : { key, data: null, state: 'loading' as const };
}

/** Why an AI of the collection gave no notes, in words. */
export function missingReason(query: QueryState, l: (en: string, pt: string) => string) {
  switch (query.status) {
    // Google shows an AI Overview for some searches only: for a search comparing the brands it often shows none (not a failure).
    case 'absent': return query.engine === 'google_ai_overviews'
      ? l('Google showed no AI Overview for the search comparing these brands. Google shows one for some searches only, so this is not a failure; the other AIs still give notes',
        'o Google não mostrou um AI Overview para a busca que compara estas marcas. O Google só mostra um em parte das buscas, então isso não é uma falha; as outras IAs seguem dando notas')
      : l('the AI showed no answer for this search', 'a IA não mostrou resposta para esta busca');
    case 'failed': return query.unread
      ? (query.engine === 'google_ai_overviews'
        ? l('Google showed an AI Overview for the search comparing these brands, but it rated none of them on these attributes', 'o Google mostrou um AI Overview para a busca que compara estas marcas, mas ele não avaliou nenhuma delas nestes atributos')
        : l('the AI answered, but rated none of these brands on these attributes', 'a IA respondeu, mas não avaliou nenhuma destas marcas nestes atributos'))
      : l('the provider returned no usable answer', 'o provedor não devolveu uma resposta utilizável');
    case 'unknown': return l('the provider did not confirm the request, so it was not sent again', 'o provedor não confirmou o pedido, então ele não foi reenviado');
    case 'cancelled': return l('not asked in this collection', 'não perguntada nesta coleta');
    case 'pending': case 'submitting': case 'submitted': return l('still waiting for the answer', 'ainda aguardando a resposta');
    default: return l('answered outside the expected format', 'respondeu fora do formato esperado');
  }
}

/** Sources, opened on what the AIs cited when asked about the brands and attributes (Semantic Branding's origin). */
const SEMANTIC_SOURCES = { tab: 'sources', origin: 'semantic-branding', kind: 'cited', group: 'domain', entity: null, engine: 'all', topic: '', tags: '', query: '' } as const;

export function SemanticPerception({ projectId, filters, request, refresh, onConfigure, link, demo = false, admin = false }: {
  projectId: string;
  /** The filters of the page header. */
  filters: URLSearchParams;
  request: Request;
  refresh: number;
  onConfigure: () => void;
  link: Linker;
  demo?: boolean;
  /** The reader can raise the brake for all projects (Admin > Usage and costs). */
  admin?: boolean;
}) {
  const l = useCopy();
  const { number, locale } = useNumbers();
  const [data, setData] = useState<Perception | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const base = demo ? '/api/demo/semantic/panel' : `/api/projects/${encodeURIComponent(projectId)}/semantic/panel`;
  const scoped = panelQuery(filters).toString();
  useEffect(() => {
    let active = true;
    queueMicrotask(() => active && setState('loading'));
    request<Perception>(`${base}?${scoped}`)
      .then((report) => { if (active) { setData(report); setState('ready'); } })
      .catch((cause) => { if (active && cause?.name !== 'AbortError') setState('failed'); });
    return () => { active = false; };
  }, [base, scoped, request, refresh, attempt]);
  useFollowCollection(data, setAttempt);

  const dayMonth = dayMonthOf(locale);
  const periodLabel = (date: string, frequency: PanelFrequency) => {
    if (frequency === 'monthly') return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
    return frequency === 'weekly' ? `${l('week of', 'semana de')} ${dayMonth(date)}` : dayMonth(date);
  };
  const own = data?.scores.find((score) => score.name === data.ownBrand);

  if (state === 'loading' && !data) return <SemanticSkeleton label={l('Loading how AI models perceive the brand…', 'Carregando como as IAs percebem a marca…')} />;
  if (state === 'failed' || !data)
    return <EmptyState tone="error" title={l('The Semantic Branding report is unavailable.', 'O relatório do Semantic Branding está indisponível.')} onRetry={() => setAttempt((count) => count + 1)} />;
  const configure = demo ? undefined : <Button variant="outline" onClick={onConfigure}>{l('Open Semantic Branding settings', 'Abrir a configuração do Semantic Branding')}</Button>;
  if (data.status === 'disabled' || !data.configuration.enabled || !data.configuration.attributes.length)
    return <EmptyState title={l('Choose the attributes to measure', 'Escolha os atributos a medir')}
      description={demo
        ? l('Semantic Branding is not enabled in this configuration.', 'O Semantic Branding não está ativado nesta configuração.')
        : l('Semantic Branding asks the AI models about the attributes you configure. Turn it on and choose them to start.', 'O Semantic Branding pergunta às IAs sobre os atributos que você configura. Ative-o e escolha os atributos para começar.')}
      action={configure} />;
  if (data.status === 'outside')
    return <EmptyState title={l('Nothing was collected in this period', 'Nada foi coletado neste período')}
      description={l(`Semantic Branding collected nothing between the dates chosen in the header. The latest collection is from ${periodLabel(data.latestPeriod!, data.frequency)}: choose a period that includes it.`,
        `O Semantic Branding não coletou nada entre as datas escolhidas no cabeçalho. A última coleta é de ${periodLabel(data.latestPeriod!, data.frequency)}: escolha um período que a inclua.`)} />;
  // The header's AI filter keeps no AI of this collection: said, never zeros.
  if (data.status === 'ready' && data.round?.filtered)
    return <EmptyState title={l('No answers for this AI filter', 'Nenhuma resposta para este filtro de IAs')}
      description={`${l('No AI of this collection matches the AI filter of the header. Clear the filter to see every AI.',
        'Nenhuma IA desta coleta corresponde ao filtro de IAs do cabeçalho. Limpe o filtro para ver todas as IAs.')}${leftOutNote(data.left.filter((item) => data.filter.engines.includes(item.engine)), l)}`} />;
  // No filter hides them: the collection is still asking, or it asked none of the AIs the project monitors now (switched off since, or out of the plan).
  if (data.status === 'ready' && data.round && !data.round.queries.length && data.round.status === 'running')
    return <EmptyState tone="progress" title={l('This collection is under way', 'Esta coleta está em andamento')}
      description={l(`The collection of ${dayMonth(data.round.day)} is still asking the AI models; its notes show here once they answer.`, `A coleta de ${dayMonth(data.round.day)} ainda está perguntando aos modelos de IA; as notas aparecem aqui quando eles responderem.`)} />;
  if (data.status === 'ready' && data.round && !data.round.queries.length)
    return <EmptyState title={l('No answers in this collection', 'Nenhuma resposta nesta coleta')}
      description={l(`The collection of ${dayMonth(data.round.day)} has no answer from the AIs this project monitors now; the next collection asks them.${leftOutNote(data.left, l)}`,
        `A coleta de ${dayMonth(data.round.day)} não tem resposta das IAs que este projeto monitora agora; a próxima coleta pergunta a elas.${leftOutNote(data.left, l)}`)} />;
  if (data.status === 'waiting' || !data.round || !own) return <WaitingState waiting={data.waiting} blocked={data.blocked ?? null} admin={admin} frequency={data.frequency} />;

  const attributeName = (id: string) => data.configuration.attributes.find((attribute) => attribute.id === id)?.name ?? id;
  // Why the score has no change beside it (the change itself, when there is one, is the figure beside the score).
  const changeNote = own.change ? null : data.periods.length < 2 ? l('First collection, no comparison', 'Primeira coleta, sem comparação') : l('No comparable previous period', 'Sem período anterior comparável');
  const missing = data.round.queries.filter((query) => query.readings === 0);
  const frequencyName = { daily: l('Daily', 'Diária'), weekly: l('Weekly', 'Semanal'), monthly: l('Monthly', 'Mensal') }[data.frequency];
  // The collection behind the notes and, when an AI gave none, which and why: the info of the "AIs that answered" card.
  const collection = [
    l(`${frequencyName} collection of ${dayMonth(data.round.day)}.`, `Coleta ${frequencyName.toLowerCase()} de ${dayMonth(data.round.day)}.`),
    missing.length ? `${l('No notes from: ', 'Sem notas de: ')}${missing.map((query) => `${ENGINE_LABELS[query.engine]}: ${missingReason(query, l)}`).join('; ')}.` : '',
  ].filter(Boolean).join(' ');
  const citing = new Set(data.sources.flatMap((source) => source.engines));
  const [withSources, withoutSources] = [data.answered.filter((engine) => citing.has(engine)), data.answered.filter((engine) => !citing.has(engine))];
  const names = (list: Engine[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(list.map((engine) => ENGINE_LABELS[engine]));
  const sourcesNote = !withSources.length ? l('No AI cited sources in this collection.', 'Nenhuma IA citou fontes nesta coleta.')
    : l(`${names(withSources)} cited sources${withoutSources.length ? `; ${names(withoutSources)} answered without citing any` : ''}.`,
      `${names(withSources)} ${withSources.length > 1 ? 'citaram' : 'citou'} fontes${withoutSources.length ? `; ${names(withoutSources)} ${withoutSources.length > 1 ? 'responderam' : 'respondeu'} sem citar nenhuma` : ''}.`);

  const method = l(
    `Each AI answered one question covering all brands and attributes, asked the way the daily collection asks it: ChatGPT, Gemini, Google AI Mode and AI Overviews in what a person sees, with their own search. ChatGPT, Google AI Mode and AI Overviews answer a search per group of brands, and their notes are read from the whole answer. The next collection asks with the brands in the reverse order, so no place in the list favours a brand. The score is the mean of the attribute scores (0–100): each AI gives one note per brand and attribute; an attribute is the mean across the AIs that answered and counts the same as the others. The score shown is steadied over the latest collections, so one collection alone moves it little: each AI's note is a weighted mean of its notes in the last 7 daily collections (3 weekly ones; monthly ones are not steadied), each collection weighing half as much every 2 days (every week). A real change shows within a few days: about a third of it the next day, half after two days. The period's own score, from its notes alone, is under the score ("on the day"), and the justifications show each AI's notes of the day. With two or more AIs the margin is an approximate 95% interval from their disagreement, so it is wide with few AIs, and it does not include the change from one collection to the next; with one AI there is no margin. A period without notes is a gap and a missing note is never a zero: "—" and "no evidence" mean no AI answered, and "next round" marks a brand added since this one.`,
    `Cada IA respondeu uma pergunta que cobre todas as marcas e atributos, feita do jeito que a coleta diária pergunta a ela: ChatGPT, Gemini, Google AI Mode e AI Overviews no que uma pessoa vê, com a busca da própria IA. ChatGPT, Google AI Mode e AI Overviews respondem uma busca por grupo de marcas, e as notas são lidas da resposta inteira. A coleta seguinte pergunta com as marcas na ordem inversa, para que nenhuma posição da lista favoreça uma marca. O score é a média das notas dos atributos (0–100): cada IA dá uma nota por marca e atributo; o atributo é a média entre as IAs que responderam e pesa igual aos outros. O score mostrado é estabilizado sobre as coletas mais recentes, para que uma coleta sozinha o mova pouco: a nota de cada IA é uma média ponderada das notas dela nas últimas 7 coletas diárias (3 semanais; as mensais não são estabilizadas), e cada coleta pesa metade a cada 2 dias (a cada semana). Uma mudança real aparece em poucos dias: cerca de um terço no dia seguinte e metade depois de dois dias. O score do próprio período, só com as notas dele, fica abaixo do score ("no dia"), e as justificativas mostram as notas de cada IA no dia. Com duas ou mais IAs a margem é um intervalo aproximado de 95% a partir da divergência entre elas, por isso é larga com poucas IAs, e não inclui a variação de uma coleta para a outra; com uma IA não há margem. Período sem notas é uma lacuna e nota ausente nunca vira zero: "—" e "sem evidência" significam que nenhuma IA respondeu, e "próxima rodada" marca uma marca adicionada depois desta.`);

  const lead = (select: (attributeId: string) => void) => (
    <div className="perception">
      {data.blocked && <Note status>{panelBlockCopy(data.blocked.reason, admin, l)}</Note>}
      <SemanticKpis data={data} own={own} method={method} changeNote={changeNote} collection={collection} attributeName={attributeName} onEvidence={select} />
      {/* The evolution and the ranking right below the cards, as on the Overview; Score by AI after them. */}
      <SemanticEvolution data={data} own={own} frequencyName={frequencyName} link={link} />
      <SemanticByAssistantCard data={data} />
    </div>
  );

  const after = (
    <div className="perception">
      <SectionCard className="perception-sources" title={l('Sources cited by the AIs', 'Fontes citadas pelas IAs')}
        action={<ViewAllAction link={link} to={SEMANTIC_SOURCES}>{l('View all', 'Ver todas')}</ViewAllAction>}
        info={`${l('The 10 pages the AIs cited most when asked about your brands and attributes.', 'As 10 páginas mais citadas pelas IAs ao serem perguntadas sobre suas marcas e atributos.')} ${sourcesNote}`}>
        {data.sources.length ? (
          <DataTable
            singleLine
            className="min-w-0!"
            rowKey={(source) => source.url}
            rows={[...data.sources].sort((a, b) => b.engines.length - a.engines.length || a.domain.localeCompare(b.domain)).slice(0, 10)}
            columns={[
              { key: 'page', header: l('Page', 'Página'), cell: (source) => <UrlCell link={link} url={source.url} title={source.title} domain={source.domain} t={l} /> },
              { key: 'cited', header: l('Cited by', 'Citada por'), align: 'end', cell: (source) => <>{number(source.engines.length)}/{number(data.answered.length)} {l('AIs', 'IAs')}</> },
              { key: 'engines', header: l('AIs', 'IAs'), headerClassName: 'perception-compare', cellClassName: 'perception-compare', cell: (source) => <span className="perception-engines">{source.engines.map((engine) => <ModelMark key={engine} model={engine} />)}</span> },
            ]}
          />
        ) : <EmptyState frame="bare" title={sourcesNote} />}
      </SectionCard>
    </div>
  );

  const evidence = { base: `${base}/evidence`, scope: scoped, period: data.period!, request };
  const overall = Object.fromEntries(data.scores.map((score) => [score.name, score.score]));
  return (
    <SemanticAssociationReport
      report={measuredAssociationReport({ enabled: true, attributes: data.configuration.attributes.map((attribute) => ({ ...attribute, description: attribute.description ?? '' })) }, data.association!)}
      idPrefix="semantic-perception"
      added={data.added}
      overall={overall}
      lead={lead}
      after={after}
      explanations={({ brandId, attributeId }) => (
        <SemanticJustifications key={`${brandId}|${attributeId}`} data={data} brand={brandId} attribute={attributeId}
          attributeName={attributeName} evidence={evidence} link={link} />
      )}
    />
  );
}

const dayMonthOf = (locale: string) => (day: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

/** A first collection under way: the report is read again every minute until its notes land (13/11/2026: the page and the Overview follow it on their own). */
function useFollowCollection(data: Perception | null, again: (bump: (count: number) => number) => void) {
  const collecting = data?.status === 'waiting' && (data.waiting?.reason === 'scheduled' || data.waiting?.reason === 'running');
  useEffect(() => {
    if (!collecting) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') again((count) => count + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [collecting, again]);
}

/**
 * The explained empty states: what the report is waiting for, in the order the reader can act on it. A first collection scheduled or under
 * way is in progress, with when its notes are expected (13/11/2026: it read as an empty report). `brief`: the Overview's card, without how a
 * collection works.
 */
function WaitingState({ waiting, blocked = null, admin = false, frequency, frame, brief = false }: { waiting: Waiting | null; blocked?: { reason: string } | null; admin?: boolean; frequency: PanelFrequency; frame?: 'bare'; brief?: boolean }) {
  const l = useCopy();
  const { number, locale } = useNumbers();
  const dayMonth = dayMonthOf(locale);
  const every = { daily: l('every day', 'todos os dias'), weekly: l('every week', 'toda semana'), monthly: l('every month', 'todo mês') }[frequency];
  const how = l(`Each collection asks every AI the project monitors, the way its daily collection does, one question covering all your brands and attributes, ${every}, alternating the order of the brands. Brands without a collection are not shown as a zero score.`,
    `Cada coleta faz a cada IA que o projeto monitora, do jeito que a coleta diária pergunta, uma pergunta que cobre todas as suas marcas e atributos, ${every}, alternando a ordem das marcas. Marcas sem coleta não aparecem como nota zero.`);
  if (!waiting) return <EmptyState frame={frame} title={l('No collection yet', 'Ainda não há coleta')} description={brief ? undefined : how} />;
  const { reason, engines, round } = waiting;
  const more = brief ? '' : ` ${how}`;
  const left = leftOutNote(waiting.left ?? [], l);
  if (reason === 'few-engines')
    return <EmptyState frame={frame} title={l('No AI to start', 'Nenhuma IA para começar')}
      description={`${l('Semantic Branding asks the AIs this project monitors, and none of them is available here for this country.',
        'O Semantic Branding pergunta às IAs que este projeto monitora, e nenhuma delas está disponível aqui para este país.')}${left}${more}`} />;
  if (reason === 'not-collecting')
    return <EmptyState frame={frame} title={l('Collection is not running', 'A coleta não está rodando')}
      description={l(`Semantic Branding needs the search data key (Admin > Providers) to ask the AIs, and this installation has none (or the collection is switched off).${more}`,
        `O Semantic Branding precisa da chave de dados de busca (Admin > Provedores) para perguntar às IAs, e esta instalação não tem (ou a coleta está desligada).${more}`)} />;
  // A spending limit refused the first round: paused, with where to raise that limit (never "within minutes").
  if (reason === 'blocked')
    return <EmptyState frame={frame} title={l('Paused by a spending limit', 'Pausado por um limite de gasto')}
      description={`${panelBlockCopy(blocked?.reason ?? 'project_budget', admin, l)}${more}`} />;
  if (reason === 'scheduled' || reason === 'running') {
    const at = waiting.expectedBy ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(waiting.expectedBy)) : null;
    const follows = brief ? l('This card updates on its own.', 'Este card se atualiza sozinho.') : l('This page updates on its own.', 'Esta página se atualiza sozinha.');
    return <EmptyState frame={frame} tone="progress" title={l('Collecting the first scores', 'Coletando as primeiras notas')}
      description={`${at
        ? l(`The AIs are scoring your brand and its competitors on the attributes now; the scores are expected by about ${at}.`, `As IAs estão dando nota à sua marca e aos concorrentes nos atributos agora; as notas são esperadas por volta das ${at}.`)
        : l('The AIs are scoring your brand and its competitors on the attributes now.', 'As IAs estão dando nota à sua marca e aos concorrentes nos atributos agora.')} ${follows}${more}`} />;
  }
  const failed = round?.queries?.filter((query) => !['pending', 'submitting', 'submitted'].includes(query.status)) ?? [];
  return (
    <EmptyState frame={frame} title={l('The first collection gave no notes', 'A primeira coleta não deu notas')}
      description={l(`The collection of ${dayMonth(round!.day)} ended without notes from any AI model${failed.length ? `: ${failed.map((query) => `${ENGINE_LABELS[query.engine]} (${missingReason(query, l)})`).join('; ')}` : ''}. ${number(engines.length)} AI models are available; the next collection will try again.${more}`,
        `A coleta de ${dayMonth(round!.day)} terminou sem notas de nenhum modelo de IA${failed.length ? `: ${failed.map((query) => `${ENGINE_LABELS[query.engine]} (${missingReason(query, l)})`).join('; ')}` : ''}. ${number(engines.length)} modelos de IA estão disponíveis; a próxima coleta tentará de novo.${more}`)} />
  );
}

/** The "Score by AI" card of Semantic Branding: the brands by AI and mode. Why an AI gave no notes and the order effect are Admin's (AdminSemanticPanel). */
function SemanticByAssistantCard({ data }: { data: Perception }) {
  const l = useCopy();
  if (!data.byAssistant?.columns.length) return null;
  return (
    <SectionCard title={l('Score by AI', 'Score por IA')}
      info={l('The overall score of each brand inside each AI (0–100), asked the way the daily collection asks that AI: where one AI sees a brand differently. One AI alone has no margin. 🏆 marks the highest score of each AI. An AI the project monitors that cannot be collected in its country has a column that says why.',
        'O score geral de cada marca dentro de cada IA (0–100), perguntado do jeito que a coleta diária pergunta a essa IA: onde uma IA vê uma marca diferente. Uma IA sozinha não tem margem. 🏆 marca o maior score de cada IA. Uma IA que o projeto monitora e que não pode ser coletada no país dele tem uma coluna que diz por quê.')}>
      <SemanticAssistantTable data={data} />
    </SectionCard>
  );
}

/**
 * The Overview's Semantic Branding row: the radar of the brands on the attributes beside their scores as bars (the overall
 * score, or one attribute picked in the card's menu), read from the same report and filters as the Semantic Branding page. Off, or
 * nothing to show for the period: one card that says why, never zeros.
 */
export function SemanticOverviewRow({ projectId, filters, request, refresh, demo = false, admin = false, link, onConfigure }: {
  projectId: string; filters: URLSearchParams; request: Request; refresh: number; demo?: boolean; admin?: boolean; link: Linker; onConfigure: () => void;
}) {
  const l = useCopy();
  const { number } = useNumbers();
  const [data, setData] = useState<Perception | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [attributeId, setAttributeId] = useState('overall');
  const base = demo ? '/api/demo/semantic/panel' : `/api/projects/${encodeURIComponent(projectId)}/semantic/panel`;
  const scoped = panelQuery(filters).toString();
  useEffect(() => {
    let active = true;
    queueMicrotask(() => active && setState('loading'));
    request<Perception>(`${base}?${scoped}`)
      .then((report) => { if (active) { setData(report); setState('ready'); } })
      .catch((cause) => { if (active && cause?.name !== 'AbortError') setState('failed'); });
    return () => { active = false; };
  }, [base, scoped, request, refresh, attempt]);
  useFollowCollection(data, setAttempt);
  const open = <ViewAllAction link={link} to={{ tab: 'semantic-branding' }}>{l('View report', 'Ver relatório')}</ViewAllAction>;
  const radarTitle = l('Semantic Branding radar', 'Radar do Semantic Branding');
  const radarInfo = l('Observed mean of each brand on every attribute (0–100), in the period of the header: your brand and every monitored competitor, all drawn; the legend turns each one off and on. Hover or focus an attribute to compare.',
    'Média observada de cada marca em cada atributo (0–100), no período do cabeçalho: sua marca e todos os concorrentes monitorados, todos desenhados; a legenda desliga e liga cada um. Passe o cursor ou foque um atributo para comparar.');
  const scoreTitle = l('Semantic Branding score', 'Score do Semantic Branding');
  const scoreInfo = l('The overall score of each brand (0–100), or its mean on the attribute picked in the menu, in the period of the header. A brand with too few AIs has no bar, never a zero.',
    'O score geral de cada marca (0–100), ou a média no atributo escolhido no menu, no período do cabeçalho. Marca com poucas IAs fica sem barra, nunca com zero.');
  // Nothing side by side to show: one card that says why.
  const alone = (note: ReactNode) => <SectionCard title="Semantic Branding" action={open}>{note}</SectionCard>;
  if (state === 'loading' && !data) return <SemanticOverviewSkeleton action={open} />;
  if (state === 'failed' || !data)
    return alone(<EmptyState frame="bare" tone="error" title={l('Semantic Branding is unavailable.', 'O Semantic Branding está indisponível.')} onRetry={() => setAttempt((count) => count + 1)} />);
  if (data.status === 'disabled' || !data.configuration.enabled || !data.configuration.attributes.length)
    return alone(
      <EmptyState
        frame="bare"
        title={demo ? l('Semantic Branding is not enabled in this demo.', 'O Semantic Branding não está ativado nesta demonstração.') : l('Semantic Branding is off.', 'O Semantic Branding está desligado.')}
        description={demo ? undefined : l('Turn it on and choose the attributes to see how the AIs place your brand and its rivals on them.', 'Ative-o e escolha os atributos para ver como as IAs posicionam sua marca e os concorrentes neles.')}
        action={demo ? undefined : <Button variant="outline" onClick={onConfigure}>{l('Open settings', 'Abrir configurações')}</Button>}
      />,
    );
  // Waiting for its first notes: why, as the report says it (a first collection under way is in progress, never an empty card).
  if (data.status === 'waiting') return alone(<WaitingState waiting={data.waiting} blocked={data.blocked ?? null} admin={admin} frequency={data.frequency} frame="bare" brief />);
  if (data.status !== 'ready' || !data.round?.queries.length || !data.association || !data.scores.some((score) => score.name === data.ownBrand))
    return alone(
      <EmptyState frame="bare" title={data.status === 'ready' && data.round?.filtered
        ? l('No AI of this collection matches the AI filter of the header.', 'Nenhuma IA desta coleta corresponde ao filtro de IAs do cabeçalho.')
        : data.status === 'ready' && data.round && !data.round.queries.length
          ? data.round.status === 'running'
            ? l('This collection is under way: its notes show once the AI models answer.', 'Esta coleta está em andamento: as notas aparecem quando os modelos de IA responderem.')
            : l('This collection has no answer from the AIs this project monitors now.', 'Esta coleta não tem resposta das IAs que este projeto monitora agora.')
        : data.status === 'outside'
          ? l('Semantic Branding collected nothing in the period of the header.', 'O Semantic Branding não coletou nada no período do cabeçalho.')
          : l('Semantic Branding has no notes yet: the first collection has not given any.', 'O Semantic Branding ainda não tem notas: a primeira coleta ainda não deu nenhuma.')} />,
    );
  const report = measuredAssociationReport({ enabled: true, attributes: data.configuration.attributes.map((attribute) => ({ ...attribute, description: attribute.description ?? '' })) }, data.association);
  const overall = Object.fromEntries(data.scores.map((score) => [score.name, score.score]));
  const brands = panelOrder(report, overall);
  const attribute = report.configuration.attributes.find((item) => item.id === attributeId);
  // The heatmap's figures: the overall score whole, an attribute's observed mean with one decimal (as the radar's balloon).
  const valueOf = (brand: (typeof brands)[number]) => (attribute ? brand.attributes.find((cell) => cell.attribute.id === attribute.id)?.observedValue : overall[brand.entity.name]) ?? null;
  const empty = l('No evidence', 'Sem evidência');
  // A brand added since the collection enters the next one: said instead of "no evidence".
  const added = new Set(data.added);
  const nextText = l('Added since this collection: it enters the next one', 'Adicionada depois desta coleta: entra na próxima');
  // The best CHART_SERIES_COUNT (10) bars, as every brand chart; your brand always among them (in its place, or last).
  const ranked = cutBrandRanking([...brands].sort((a, b) => (valueOf(b) ?? -1) - (valueOf(a) ?? -1)), (brand) => brand.entity.id === report.own?.entity.id, CHART_SERIES_COUNT).map(({ row }) => row);
  const rows: BarListRow[] = ranked.map((brand) => {
    const value = valueOf(brand);
    const figure = value == null ? (added.has(brand.entity.name) ? l('Next round', 'Próxima rodada') : empty) : number(value, attribute ? 1 : 0);
    return {
      key: brand.entity.id,
      label: <BrandName name={brand.entity.name} domain={brand.entity.domain} own={brand.entity.id === report.own?.entity.id} />,
      value, figure, text: `${brand.entity.name}: ${figure}${value == null ? '' : ' / 100'}`, color: brandColor(brand.entity.id, report),
      missing: added.has(brand.entity.name) ? nextText : l('No AI gave notes', 'Nenhuma IA deu notas'),
    };
  });
  return (
    <div className="overview-grid overview-pair semantic-overview">
      <SectionCard title={radarTitle} info={radarInfo} action={open}>
        {report.configuration.attributes.length >= 3
          ? <SemanticRadarChart report={report} brands={brands} />
          : <EmptyState frame="bare" title={l(`The radar needs at least ${number(3)} attributes; this project measures ${number(report.configuration.attributes.length)}.`, `O radar precisa de pelo menos ${number(3)} atributos; este projeto mede ${number(report.configuration.attributes.length)}.`)} />}
      </SectionCard>
      <SectionCard title={scoreTitle} info={scoreInfo}
        action={<FilterSelect multiple={false} label={l('Attribute', 'Atributo')} value={attribute?.id ?? 'overall'} onChange={setAttributeId}
          options={[{ value: 'overall', label: l('Overall score', 'Score geral') }, ...report.configuration.attributes.map((item) => ({ value: item.id, label: item.name }))]} />}>
        <BarList label={attribute ? `${scoreTitle}: ${attribute.name}` : scoreTitle} rows={rows} />
      </SectionCard>
    </div>
  );
}

/** The Overview's Semantic Branding row while it loads: the radar card beside the score card, each in its loading state. */
export function SemanticOverviewSkeleton({ action }: { action?: ReactNode }) {
  const l = useCopy();
  return (
    <div className="overview-grid overview-pair semantic-overview" aria-busy="true">
      <SectionCard title={l('Semantic Branding radar', 'Radar do Semantic Branding')} action={action}><div className="px-5 pb-5"><Skeleton className="aspect-[540/410] w-full" /></div></SectionCard>
      <SectionCard title={l('Semantic Branding score', 'Score do Semantic Branding')}><BarListSkeleton rows={5} /></SectionCard>
    </div>
  );
}
