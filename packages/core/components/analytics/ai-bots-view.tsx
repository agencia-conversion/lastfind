'use client';

import { useCallback, useEffect, useId, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { requestJson } from '@/lib/client';
import {
  type AiBotsConnection,
  type AiBotsReport,
  type BotPurpose,
  type BotRow,
  type LlmRow,
  type LlmTrendRow,
  type StatusClass,
  type TrendRow,
  AI_BOTS_LIST,
  CLOUDFLARE_TOKEN_TEMPLATE_URL,
  LLMS,
  TOKEN_PERMISSIONS,
  dayOf,
  addDays,
  weekly,
} from '@/lib/ai-bots';
import { trendRange } from '@/lib/report-trend';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TrendCard, type TrendSeries } from '@/components/lastfind/presentation/trend-chart';
import { DataTable, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { BarList, BarListSkeleton } from '@/components/lastfind/presentation/bar-list';
import { Note } from '@/components/lastfind/presentation/note';
import { PageFilters } from '@/components/lastfind/presentation/page-heading';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Change, EmptyState, FilterSelect, WithChange, useComparison, useCopy, useNumbers, useSortedPage } from './shared';
import { DrillLink, ViewAllAction, type DrillTarget, type Linker } from './drill-link';

type Translate = (en: string, pt: string) => string;
type Problem = 'auth' | 'zones' | 'analytics' | 'network';
type Zone = { id: string; name: string; plan: string; paid: boolean };
type Answer = { connection: AiBotsConnection; report: AiBotsReport | null };

/**
 * The three pages of Traffic (the AI bots section, named Traffic on 13/11/2026), its sub-items in the sidebar (`aiBotsView` in the address): its overview, the bots that read the
 * site and the visits AI answers send (AI Traffic). A page's drill down travels after it: `bots?bot=gptbot`,
 * `ai?llm=chatgpt&page=/pricing`.
 */
export type AiBotsSection = 'overview' | 'bots' | 'traffic';
export const AI_BOTS_SECTIONS: Record<AiBotsSection, { page: string | null; label: [string, string]; title: [string, string]; description: [string, string] }> = {
  overview: {
    page: null,
    label: ['Overview', 'Visão geral'],
    title: ['Traffic', 'Tráfego'],
    description: ['Which AIs read your site, what they read and the visits their answers send you.', 'Quais IAs leem o seu site, o que elas leem e as visitas que as respostas delas mandam para você.'],
  },
  bots: {
    page: 'bots',
    label: ['AI Bots', 'Bots de IA'],
    title: ['AI Bots', 'Bots de IA'],
    description: ['The AI crawlers that read your site, the pages they read and what your site answered them.', 'Os robôs de IA que leem o seu site, as páginas que leem e o que o seu site respondeu a eles.'],
  },
  traffic: {
    page: 'ai',
    label: ['AI Traffic', 'Tráfego de IA'],
    title: ['AI Traffic', 'Tráfego de IA'],
    description: ['The visits that arrive from links in LLM answers: which LLMs send them and the pages they land on.', 'As visitas que chegam por links em respostas de LLMs: quais LLMs as mandam e as páginas onde chegam.'],
  },
};
const viewParts = (view: string | null | undefined) => {
  const [page = '', ...query] = (view ?? '').split('?');
  return { page, drill: new URLSearchParams(query.join('?')) };
};
export const aiBotsSection = (view: string | null | undefined): AiBotsSection => {
  const { page } = viewParts(view);
  return page === 'bots' ? 'bots' : page === 'ai' ? 'traffic' : 'overview';
};
type Drill = { bot?: string | null; llm?: string | null; page?: string | null };
/** An AI Bots page with its drill down (empty values left out). */
const pageTarget = (section: AiBotsSection, drill: Drill = {}): DrillTarget => {
  const page = AI_BOTS_SECTIONS[section].page;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(drill)) if (value) query.set(key, value);
  return { tab: 'ai-bots', aiBotsView: page ? (query.size ? `${page}?${query}` : page) : null };
};

const PURPOSE_COLOR: Record<BotPurpose, string> = { training: 'var(--chart-5)', search: 'var(--chart-1)', user: 'var(--chart-2)' };
const purposeLabel = (t: Translate, purpose: BotPurpose) =>
  purpose === 'training' ? t('Training', 'Treinamento') : purpose === 'search' ? t('Search', 'Busca') : t('User request', 'Pedido de usuário');
/** The LLMs drawn one by one in the trend, the most visits first; the rest are summed as "Other". */
const LLM_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
const OTHER_COLOR = 'var(--chart-6)';
const STATUS_COLOR: Record<StatusClass, string> = {
  ok: 'var(--state-good)',
  redirect: 'var(--chart-1)',
  not_found: 'var(--chart-3)',
  forbidden: 'var(--chart-4)',
  client_error: 'var(--chart-6)',
  server_error: 'var(--state-bad)',
};
const statusLabel = (t: Translate, status: StatusClass) =>
  ({
    ok: t('2xx Success', '2xx Sucesso'),
    redirect: t('3xx Redirect', '3xx Redirecionamento'),
    not_found: t('404 Not found', '404 Não encontrada'),
    forbidden: t('403 Blocked', '403 Bloqueada'),
    client_error: t('Other 4xx', 'Outros 4xx'),
    server_error: t('5xx Server error', '5xx Erro do servidor'),
  })[status];
const problemText = (t: Translate, problem: Problem) =>
  ({
    auth: t('Cloudflare did not accept this token. Check that it is active and that you copied all of it.', 'A Cloudflare não aceitou este token. Confira se ele está ativo e se você copiou ele inteiro.'),
    zones: t('This token does not see your site. Give it Zone > Zone > Read and include your site’s zone.', 'Este token não enxerga o seu site. Dê a ele Zone > Zone > Read e inclua a zona do seu site.'),
    analytics: t('This token cannot read analytics. Give it Account > Account Analytics > Read and Zone > Analytics > Read.', 'Este token não lê as análises. Dê a ele Account > Account Analytics > Read e Zone > Analytics > Read.'),
    network: t('Cloudflare did not answer. Try again in a moment.', 'A Cloudflare não respondeu. Tente de novo em instantes.'),
  })[problem];

/** A change in percent of a count; none when the earlier period had nothing (a growth from zero is no percentage). */
const growth = (current: number, previous: number | null) => (previous ? ((current - previous) / previous) * 100 : null);
/** The top of the chart's scale: 1, 2 or 5 times a power of ten, at least the peak. */
function niceTop(peak: number) {
  if (peak <= 0) return 10;
  const power = 10 ** Math.floor(Math.log10(peak));
  return ([1, 2, 5, 10].map((step) => step * power).find((value) => value >= peak) ?? 10 * power);
}

const BOT_SORT: Record<string, (row: BotRow) => string | number> = {
  bot: (row) => row.name,
  purpose: (row) => row.purpose,
  visits: (row) => row.visits,
  pages: (row) => row.pages,
  errors: (row) => row.errors / Math.max(1, row.visits),
  last: (row) => row.lastDay,
};
const LLM_SORT: Record<string, (row: LlmRow) => string | number> = {
  llm: (row) => row.name,
  visits: (row) => row.visits,
  share: (row) => row.visits,
  pages: (row) => row.pages,
  last: (row) => row.lastDay,
};

/** The Settings section of the connection (live-app.tsx `settingsSection === 'ai-bots'`). */
const SETTINGS: DrillTarget = { tab: 'settings', section: 'ai-bots' };

/**
 * AI Bots: which AI crawlers read the site, what they read and what the site answered them, and the visits AI answers send
 * back (AI Traffic), from the customer's own Cloudflare zone (a read-only token, connected in Settings; nothing installed on
 * the site). Only the header's period applies here; the drill downs (one bot, one LLM, one page) are the page's own filters.
 */
export function AiBotsView({ projectId, view, filters, demo = false, link }: { projectId: string; view: string | null; filters: URLSearchParams; demo?: boolean; link: Linker }) {
  const t = useCopy();
  const section = aiBotsSection(view);
  const { drill } = viewParts(view);
  const query = new URLSearchParams();
  for (const key of ['days', 'start', 'end', 'compareStart', 'compareEnd']) {
    const value = filters.get(key);
    if (value) query.set(key, value);
  }
  for (const key of ['bot', 'llm', 'page']) {
    const value = drill.get(key);
    if (value) query.set(key, value);
  }
  const path = `/api/projects/${encodeURIComponent(projectId)}/ai-bots?${query}`;
  const [found, setFound] = useState<{ path: string; data: Answer | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (demo) return;
    let active = true;
    requestJson<Answer>(path)
      .then((data) => active && setFound({ path, data, failed: false }))
      .catch((error) => active && error?.name !== 'AbortError' && setFound({ path, data: null, failed: true }));
    return () => {
      active = false;
    };
  }, [path, attempt, demo]);
  // While the first days are read, the screen looks again every 20 seconds.
  const backfilling = found?.data?.connection.backfilling && !found.data.report?.trend.length;
  useEffect(() => {
    if (!backfilling) return;
    const timer = window.setTimeout(reload, 20_000);
    return () => window.clearTimeout(timer);
  }, [backfilling, reload, found]);

  if (demo)
    return (
      <EmptyState
        title={t('The demo has no site connected', 'A demo não tem site conectado')}
        description={t('In your project, Traffic shows which AI crawlers read your site and the visits AI answers send you, from your own Cloudflare analytics.', 'No seu projeto, Tráfego mostra quais robôs de IA leem o seu site e as visitas que as respostas de IA mandam para você, a partir das análises da sua própria Cloudflare.')}
      />
    );
  const current = found?.path === path ? found : null;
  if (current?.failed) return <EmptyState tone="error" title={t('The report did not load.', 'O relatório não carregou.')} onRetry={reload} />;
  const data = current?.data ?? (found?.data && found.data.connection.state !== 'active' ? found.data : null);
  if (!data) return <AiBotsSkeleton section={section} />;
  const { connection, report } = data;
  if (connection.state === 'none' || connection.state === 'zone') return <NotConnected connection={connection} link={link} t={t} />;
  return (
    <>
      {connection.state === 'invalid' && (
        <Note
          tone="danger"
          className="mb-5 px-0"
          action={connection.canManage ? <Button variant="outline" nativeButton={false} render={<a {...link(SETTINGS)} aria-label={t('Reconnect in Settings', 'Reconectar em Configurações')} />}>{t('Reconnect in Settings', 'Reconectar em Configurações')}</Button> : undefined}
        >
          {connection.problem === 'zone'
            ? t('Cloudflare no longer shows this zone to the token, so the collection stopped. The history stays.', 'A Cloudflare não mostra mais esta zona ao token, então a coleta parou. O histórico fica.')
            : t('Cloudflare stopped accepting the token (revoked, expired or missing a permission), so the collection stopped. The history stays.', 'A Cloudflare parou de aceitar o token (revogado, expirado ou sem uma permissão), então a coleta parou. O histórico fica.')}
        </Note>
      )}
      {report && <Report report={report} section={section} drill={{ bot: drill.get('bot'), llm: drill.get('llm'), page: drill.get('page') }} link={link} t={t} />}
    </>
  );
}

/** The screen's skeleton: the KPI strip and the first row of cards, in their places. */
export function AiBotsSkeleton({ section = 'overview' }: { section?: AiBotsSection }) {
  return (
    <div aria-busy="true" data-screen-skeleton="">
      <MetricGridSkeleton count={section === 'overview' ? 5 : 4} description />
      <div className="overview-grid mt-5">
        <SectionCard loading lines={6} />
        <SectionCard loading>
          <BarListSkeleton rows={4} />
        </SectionCard>
      </div>
    </div>
  );
}

function NotConnected({ connection, link, t }: { connection: AiBotsConnection; link: Linker; t: Translate }) {
  const zone = connection.state === 'zone';
  const action = zone ? t('Choose the zone in Settings', 'Escolher a zona em Configurações') : t('Connect in Settings', 'Conectar em Configurações');
  return (
    <EmptyState
      title={zone ? t('Choose your site’s zone', 'Escolha a zona do seu site') : t('See which AIs read your site', 'Veja quais IAs leem o seu site')}
      description={
        zone
          ? t('The token is saved. Choose the Cloudflare zone of this project’s site in Settings to start collecting.', 'O token está salvo. Escolha em Configurações a zona da Cloudflare do site deste projeto para começar a coletar.')
          : connection.canManage
            ? t(
                'Connect your site’s Cloudflare zone in Settings with a read-only token. Lastfind reads its analytics once a day: the AI bots that visit, the pages they read, what your site answered them and, on paid Cloudflare plans, the visits that AI answers send you. Nothing is installed on your site.',
                'Conecte em Configurações a zona da Cloudflare do seu site com um token só de leitura. O Lastfind lê as análises dela uma vez por dia: os robôs de IA que visitam, as páginas que leem, o que o seu site respondeu e, nos planos pagos da Cloudflare, as visitas que as respostas de IA mandam para você. Nada é instalado no seu site.',
              )
            : t('A workspace admin connects the site’s Cloudflare zone in Settings. Ask one to connect it.', 'Um admin do workspace conecta em Configurações a zona da Cloudflare do site. Peça a um deles para conectar.')
      }
      action={connection.canManage ? <Button nativeButton={false} render={<a {...link(SETTINGS)} aria-label={action} />}>{action}</Button> : undefined}
    />
  );
}

function useDateCopy() {
  const { locale } = useNumbers();
  const t = useCopy();
  const today = dayOf(new Date().toISOString());
  return {
    day: (day: string) =>
      day === today
        ? t('Today', 'Hoje')
        : day === addDays(today, -1)
          ? t('Yesterday', 'Ontem')
          : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`)),
    moment: (iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)),
  };
}

/** Where the figures come from and how fresh they are: the page's last line. */
function statusLine(t: Translate, connection: AiBotsConnection, moment: (iso: string) => string) {
  if (connection.preview) return t('Example data for this preview: these figures do not come from a real Cloudflare zone.', 'Dados de exemplo desta prévia: estes números não vêm de uma zona real da Cloudflare.');
  if (connection.backfilling) return t('Reading the last 30 days from Cloudflare. The figures fill in as each day arrives.', 'Lendo os últimos 30 dias da Cloudflare. Os números se completam conforme cada dia chega.');
  if (connection.lastSyncAt) return t(`Updated ${moment(connection.lastSyncAt)}, collected once a day; today is partial.`, `Atualizado em ${moment(connection.lastSyncAt)}, coletado uma vez por dia; hoje é parcial.`);
  return t('Waiting for the first collection.', 'Aguardando a primeira coleta.');
}

/** A programmatic move to another address of the app (a filter menu's choice): the app reads it like the back button. */
function go(link: Linker, to: DrillTarget) {
  window.history.pushState(null, '', link(to).href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function Report({ report, section, drill, link, t }: { report: AiBotsReport; section: AiBotsSection; drill: Drill; link: Linker; t: Translate }) {
  const { number, percent, locale } = useNumbers();
  const dates = useDateCopy();
  const comparison = useComparison(t);
  const [grain, setGrain] = useState<'day' | 'week'>('day');
  const [source, setSource] = useState<'bots' | 'llms'>('bots');
  // Long lists show 10 rows a page (the catalog's pager), sorted over the whole list; a new drill down starts at page 1.
  const scope = `${section}|${drill.bot}|${drill.llm}|${drill.page}`;
  const botRows = useSortedPage(report.bots, BOT_SORT, scope, 10, t, t('Bots', 'Bots'));
  const pageRows = useSortedPage(report.pages, {}, scope, 10, t, t('Most read pages', 'Páginas mais lidas'));
  const llmRows = useSortedPage(report.llms, LLM_SORT, scope, 10, t, 'LLMs');
  const landingRows = useSortedPage(report.landings, {}, scope, 10, t, t('Landing pages', 'Páginas de entrada'));
  const { totals, period, connection } = report;
  const paid = connection.capabilities.referrals;
  // The drill downs, in the top bar beside the period: one bot (AI Bots), one LLM (AI Traffic), one page (both). Each choice
  // is an address of its own, so it can be shared and the back button undoes it.
  const filterBar = section !== 'overview' && (
    <PageFilters>
      {section === 'bots' ? (
        <FilterSelect
          multiple={false}
          label={t('Bot', 'Bot')}
          value={drill.bot ?? 'all'}
          onChange={(value) => go(link, pageTarget('bots', { ...drill, bot: value === 'all' ? null : value }))}
          options={[{ value: 'all', label: t('All bots', 'Todos os bots') }, ...AI_BOTS_LIST.map((bot) => ({ value: bot.id, label: bot.id === 'other' ? t('Other AI bots', 'Outros bots de IA') : bot.name }))]}
        />
      ) : (
        <FilterSelect
          multiple={false}
          label="LLM"
          value={drill.llm ?? 'all'}
          disabled={!paid}
          onChange={(value) => go(link, pageTarget('traffic', { ...drill, llm: value === 'all' ? null : value }))}
          options={[{ value: 'all', label: t('All LLMs', 'Todos os LLMs') }, ...LLMS.map((llm) => ({ value: llm.id, label: llm.name }))]}
        />
      )}
      {drill.page && (
        <TagBadge tone="primary" className="max-w-full">
          <span className="truncate">{t('Page', 'Página')}: {drill.page}</span>
          <a {...link(pageTarget(section, { ...drill, page: null }))} aria-label={t('Clear page filter', 'Limpar filtro de página')}><X size={12} /></a>
        </TagBadge>
      )}
    </PageFilters>
  );
  if (!period.covered)
    return (
      <>
        {filterBar}
        {connection.backfilling ? (
          <EmptyState tone="progress" title={t('Reading your site’s last 30 days', 'Lendo os últimos 30 dias do seu site')} description={t('This takes a few minutes. The screen updates by itself.', 'Isso leva alguns minutos. A tela se atualiza sozinha.')} />
        ) : (
          <EmptyState title={t('No days collected in this period', 'Nenhum dia coletado neste período')} description={t('The collection keeps the days from the connection on (and the 30 before it). Choose a later period.', 'A coleta guarda os dias a partir da conexão (e os 30 anteriores). Escolha um período mais recente.')} />
        )}
      </>
    );
  // Why there is no change (lib/period-coverage.ts): the earlier period was read for fewer than half the days.
  const thin = !period.compared && period.previousCovered > 0 && !comparison.off
    ? ` ${t(`No comparison: ${comparison.period} was collected for ${number(period.previousCovered)} days against ${number(period.covered)} now, fewer than half.`, `Sem comparação: o ${comparison.period} foi coletado em ${number(period.previousCovered)} dias ante ${number(period.covered)} agora, menos da metade.`)}`
    : '';
  const sampled = t('Estimated from Cloudflare’s sampled analytics.', 'Estimado a partir das análises por amostragem da Cloudflare.');
  const freePlan = t('Cloudflare reports where a visit came from only on paid plans (Pro and above). This zone is on the Free plan, so this figure is not available; it is not zero.', 'A Cloudflare informa de onde veio uma visita só nos planos pagos (Pro ou superior). Esta zona está no plano Free, então este número não está disponível; não é zero.');
  const rate = totals.visits ? totals.errors / totals.visits : null;
  const change = (value: number | null, unit = '%', margin = 0, invert = false) => (value === null ? undefined : <Change value={value} unit={unit} margin={margin} invert={invert} />);
  const days = (date: string, event: MouseEvent) => link({ range: trendRange(date, grain) }).onClick(event as unknown as MouseEvent<HTMLAnchorElement>);
  const footer = (
    <Note className="px-0">
      {statusLine(t, connection, dates.moment)}{' '}
      {t(
        'Bot visits: requests to your zone on Cloudflare, recognized by the name each bot declares, estimated from sampled analytics. Visits from AIs: where visits came from, on paid Cloudflare plans. Cited in answers: the answers this project monitors.',
        'Visitas de bots: requisições à sua zona na Cloudflare, reconhecidas pelo nome que cada robô declara, estimadas por amostragem. Visitas vindas de IAs: a origem das visitas, nos planos pagos da Cloudflare. Citada nas respostas: as respostas monitoradas neste projeto.',
      )}
    </Note>
  );

  // --- The pieces the pages share -------------------------------------------------------------------------------------
  const botKpis = [
    <MetricCard
      key="visits"
      label={t('AI bot visits', 'Visitas de bots de IA')}
      definition={`${t('Requests to your site from the AI bots Lastfind recognizes, by the name each bot declares (a name can be faked).', 'Requisições ao seu site dos robôs de IA que o Lastfind reconhece, pelo nome que cada robô declara (um nome pode ser falsificado).')} ${sampled}${thin}`}
      value={number(totals.visits)}
      delta={change(growth(totals.visits, totals.previousVisits))}
      description={totals.requests ? t(`${percent((totals.visits / totals.requests) * 100)} of all visits`, `${percent((totals.visits / totals.requests) * 100)} de todas as visitas`) : undefined}
    />,
    <MetricCard
      key="pages"
      label={t('Pages read', 'Páginas lidas')}
      definition={`${t('Distinct pages of your site that AI bots read and that answered without an error.', 'Páginas distintas do seu site que os robôs de IA leram e que responderam sem erro.')}${totals.sitePages ? ` ${t('Beside it, the pages of your site anyone visited in the period.', 'Ao lado, as páginas do seu site que alguém visitou no período.')}` : ''}${thin}`}
      value={number(totals.pages)}
      delta={change(growth(totals.pages, totals.previousPages))}
      description={totals.sitePages ? t(`of ${number(totals.sitePages)} pages visited`, `de ${number(totals.sitePages)} páginas visitadas`) : undefined}
    />,
    <MetricCard
      key="bots"
      label={t('Distinct bots', 'Bots diferentes')}
      definition={`${t('AI bots with at least one visit in the period, and the companies that run them.', 'Robôs de IA com ao menos uma visita no período, e as empresas que os operam.')}${thin}`}
      value={number(totals.bots)}
      delta={change(totals.previousBots === null ? null : totals.bots - totals.previousBots, '')}
      description={t(`from ${number(totals.operators)} ${totals.operators === 1 ? 'company' : 'companies'}`, `de ${number(totals.operators)} ${totals.operators === 1 ? 'empresa' : 'empresas'}`)}
    />,
    <MetricCard
      key="errors"
      label={t('Error rate', 'Taxa de erro')}
      definition={`${t('Share of AI bot visits your site answered with 404 (not found), 403 (blocked) or 5xx (server error).', 'Parcela das visitas de robôs de IA que o seu site respondeu com 404 (não encontrada), 403 (bloqueada) ou 5xx (erro do servidor).')}${thin}`}
      value={rate === null ? '—' : percent(rate * 100)}
      delta={rate === null || totals.previousErrorRate === null ? undefined : change((rate - totals.previousErrorRate) * 100, ' pp', undefined, true)}
      description={t('404, 403 and 5xx', '404, 403 e 5xx')}
    />,
  ];
  const referralsCard = (
    <MetricCard
      key="referrals"
      label={t('Visits from AIs', 'Visitas vindas de IAs')}
      definition={paid ? `${t('Visits that arrived from a link in an AI answer (ChatGPT, Perplexity, Claude, Gemini, Copilot and others), by the page they came from, or by the utm_source the AI adds to its links when the app opens them without one (ChatGPT\'s apps).', 'Visitas que chegaram por um link numa resposta de IA (ChatGPT, Perplexity, Claude, Gemini, Copilot e outras), pela página de onde vieram, ou pelo utm_source que a IA põe nos links quando o app os abre sem ela (os apps do ChatGPT).')} ${sampled}${thin}` : freePlan}
      value={totals.referrals === null ? '—' : number(totals.referrals)}
      delta={totals.referrals === null ? undefined : change(growth(totals.referrals, totals.previousReferrals))}
      description={paid ? t('from links in AI answers', 'de links em respostas de IA') : t('Paid Cloudflare plans', 'Planos pagos da Cloudflare')}
    />
  );
  const freeState = (frame?: 'bare') => (
    <EmptyState
      frame={frame}
      title={t('Available on paid Cloudflare plans', 'Disponível nos planos pagos da Cloudflare')}
      description={t('On the Free plan, Cloudflare does not report which site a visit came from, so the visits sent by AI answers cannot be counted. The bots’ reads are complete.', 'No plano Free, a Cloudflare não informa de qual site veio uma visita, então as visitas mandadas pelas respostas de IA não podem ser contadas. As leituras dos robôs estão completas.')}
    />
  );
  const noVisitsSent = (frame?: 'bare') => (
    <EmptyState
      frame={frame}
      title={t('No visits from AI answers in this period', 'Nenhuma visita vinda de respostas de IA neste período')}
      description={t(`The ${number(period.covered)} days collected show no visit from a link in an AI answer${drill.page ? ' to this page' : ''}. This is a measured zero.`, `Os ${number(period.covered)} dias coletados não mostram nenhuma visita por link de resposta de IA${drill.page ? ' para esta página' : ''}. Este é um zero medido.`)}
    />
  );
  const grainToggle = (
    <ToggleGroup multiple={false} value={[grain]} onValueChange={(value) => { if (value[0]) setGrain(value[0] as 'day' | 'week'); }} size="sm" variant="outline" spacing={0} aria-label={t('Grouping', 'Agrupamento')}>
      <ToggleGroupItem value="day">{t('Day', 'Dia')}</ToggleGroupItem>
      <ToggleGroupItem value="week">{t('Week', 'Semana')}</ToggleGroupItem>
    </ToggleGroup>
  );
  const scaleOf = <Row extends Record<string, unknown>>(rows: Row[], keys: string[]) => {
    const top = niceTop(Math.max(0, ...rows.flatMap((row) => keys.map((key) => Number(row[key]) || 0))));
    return { domain: [0, top], ticks: [0, top / 2, top] };
  };
  const tick = (value: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  // The bots' visits by purpose.
  const botTrend = grain === 'week' ? weekly(report.trend) : report.trend;
  const botSeries: TrendSeries[] = (['training', 'search', 'user'] as const).map((purpose) => ({ id: purpose, key: purpose, name: purposeLabel(t, purpose), color: PURPOSE_COLOR[purpose] }));
  // The visits AI answers sent, by LLM: the five that sent the most, the rest as "Other".
  const shown = report.llms.slice(0, LLM_COLORS.length);
  const rest = report.llms.slice(LLM_COLORS.length).map((llm) => llm.id);
  const llmDays: LlmTrendRow[] = report.llmTrend.map((row) => ({
    date: row.date,
    ...Object.fromEntries(shown.map((llm) => [llm.id, Number(row[llm.id]) || 0])),
    ...(rest.length ? { other: rest.reduce((sum, id) => sum + (Number(row[id]) || 0), 0) } : {}),
  }));
  const llmTrend = grain === 'week' ? weekly(llmDays) : llmDays;
  const llmSeries: TrendSeries[] = [
    ...shown.map((llm, index) => ({ id: llm.id, key: llm.id, name: llm.name, color: LLM_COLORS[index]! })),
    ...(rest.length ? [{ id: 'other', key: 'other', name: t('Other LLMs', 'Outros LLMs'), color: OTHER_COLOR }] : []),
  ];
  const trendCard = (mode: 'bots' | 'llms', toggle: boolean) => {
    const llms = mode === 'llms';
    const sourceToggle = toggle && (
      <ToggleGroup multiple={false} value={[source]} onValueChange={(value) => { if (value[0]) setSource(value[0] as 'bots' | 'llms'); }} size="sm" variant="outline" spacing={0} aria-label={t('Visits of', 'Visitas de')}>
        <ToggleGroupItem value="bots">Bots</ToggleGroupItem>
        <ToggleGroupItem value="llms">LLMs</ToggleGroupItem>
      </ToggleGroup>
    );
    const empty = llms && (!paid ? freeState('bare') : !totals.referrals ? noVisitsSent('bare') : undefined);
    return llms ? (
      <TrendCard<LlmTrendRow>
        key="llms"
        title={t('Visits by LLM', 'Visitas por LLM')}
        info={t('Visits that arrived from a link in an AI answer, per day or week, by the LLM that sent them. Days not collected are left out, never drawn as zero. Choose a day to read only that day.', 'Visitas que chegaram por um link numa resposta de IA, por dia ou semana, pelo LLM que as mandou. Dias não coletados ficam de fora, nunca como zero. Escolha um dia para ler só aquele dia.')}
        action={<span className="flex items-center gap-2">{sourceToggle}{grainToggle}</span>}
        data={llmTrend}
        series={empty ? [] : llmSeries}
        empty={empty || undefined}
        scale={scaleOf(llmTrend, llmSeries.map((item) => item.key))}
        locale={locale}
        formatValue={(value) => number(value)}
        formatTick={tick}
        onSelectDate={days}
      />
    ) : (
      <TrendCard<TrendRow>
        key="bots"
        title={t('Visits by purpose', 'Visitas por finalidade')}
        info={t('AI bot visits per day or week, by what each bot fetches for. Days not collected are left out, never drawn as zero. Choose a day to read only that day.', 'Visitas de robôs de IA por dia ou semana, pelo que cada robô busca. Dias não coletados ficam de fora, nunca como zero. Escolha um dia para ler só aquele dia.')}
        action={<span className="flex items-center gap-2">{sourceToggle}{grainToggle}</span>}
        data={botTrend}
        series={botSeries}
        scale={scaleOf(botTrend, ['training', 'search', 'user'])}
        locale={locale}
        formatValue={(value) => number(value)}
        formatTick={tick}
        onSelectDate={days}
      />
    );
  };
  const llmRanking = (
    <SectionCard
      title={t('LLM ranking', 'Ranking de LLMs')}
      info={paid ? t('The LLMs whose answers sent the most visits to your site in the period. Open one to see its days and the pages its visits landed on.', 'Os LLMs cujas respostas mais mandaram visitas para o seu site no período. Abra um para ver os dias e as páginas onde as visitas chegaram.') : freePlan}
      action={paid && report.llms.length > 0 && section === 'overview' ? <ViewAllAction link={link} to={pageTarget('traffic')}>{t('View all', 'Ver tudo')}</ViewAllAction> : undefined}
      inset={paid && report.llms.length > 0 ? 'padded' : undefined}
    >
      {!paid ? (
        freeState('bare')
      ) : !report.llms.length ? (
        noVisitsSent('bare')
      ) : (
        <BarList
          label={t('Visits from AI answers, by LLM', 'Visitas vindas de respostas de IA, por LLM')}
          rows={report.llms.slice(0, 6).map((row) => {
            const share = totals.referrals ? (row.visits / totals.referrals) * 100 : 0;
            return {
              key: row.id,
              label: <DrillLink link={link} to={pageTarget('traffic', { llm: row.id })}>{row.name}</DrillLink>,
              value: Math.max(1, (row.visits / Math.max(1, report.llms[0]!.visits)) * 100),
              figure: number(row.visits),
              text: `${row.name}: ${number(row.visits)}`,
              hint: t(`${row.name}: ${number(row.visits)} visits, ${percent(share)} of the visits from AIs`, `${row.name}: ${number(row.visits)} visitas, ${percent(share)} das visitas vindas de IAs`),
            };
          })}
        />
      )}
    </SectionCard>
  );
  const pagesCard = (rows: AiBotsReport['pages'], all: boolean, controls?: ReactNode) => (
    <SectionCard
      title={t('Most read pages', 'Páginas mais lidas')}
      info={t('The pages AI bots read most in the period. Cited in answers: an answer this project monitors cited the page in the period. Open a page to see the bots that read it.', 'As páginas que os robôs de IA mais leram no período. Citada nas respostas: uma resposta monitorada neste projeto citou a página no período. Abra uma página para ver os robôs que a leram.')}
      action={all ? <ViewAllAction link={link} to={pageTarget('bots')}>{t('View all', 'Ver tudo')}</ViewAllAction> : undefined}
    >
      <DataTable
        singleLine="wide"
        minWidth={0}
        compact
        rows={rows}
        rowKey={(row) => row.path}
        rowLink={(row) => link(pageTarget('bots', { bot: section === 'bots' ? drill.bot : null, page: row.path }))}
        columns={[
          { key: 'page', header: t('Page', 'Página'), mobile: 'title', hint: (row) => row.path, cell: (row) => <span className="block min-w-0 truncate">{row.path}</span> },
          { key: 'visits', header: t('Visits', 'Visitas'), label: t('Visits', 'Visitas'), align: 'end', width: '6rem', cell: (row) => number(row.visits) },
          { key: 'bots', header: t('Bots', 'Bots'), label: t('Bots', 'Bots'), align: 'end', width: '5rem', cell: (row) => number(row.bots) },
          {
            key: 'cited',
            header: t('Cited in answers', 'Citada nas respostas'),
            label: t('Cited in answers', 'Citada nas respostas'),
            width: '10rem',
            cell: (row) => (row.cited ? <TagBadge tone="success">{t('Yes', 'Sim')}</TagBadge> : <span className="text-muted-foreground">{t('Not yet', 'Ainda não')}</span>),
          },
        ]}
      />
      {controls}
    </SectionCard>
  );
  const statusTotal = report.statuses.reduce((sum, row) => sum + row.visits, 0);
  const statusCard = (
    <SectionCard title={t('What your site answered', 'O que o seu site respondeu')} info={t('The status your site gave the AI bots’ visits in the period.', 'O status que o seu site deu às visitas dos robôs de IA no período.')} inset="padded">
      <BarList
        label={t('Responses to AI bots by status', 'Respostas aos bots de IA por status')}
        rows={report.statuses.map((row) => {
          const share = statusTotal ? (row.visits / statusTotal) * 100 : 0;
          return {
            key: row.status,
            label: statusLabel(t, row.status),
            value: share,
            figure: percent(share),
            color: STATUS_COLOR[row.status],
            text: `${statusLabel(t, row.status)}: ${percent(share)}`,
            hint: t(`${number(row.visits)} visits`, `${number(row.visits)} visitas`),
          };
        })}
      />
    </SectionCard>
  );
  const noBots = (
    <EmptyState
      title={drill.bot || drill.page ? t('No visits of this bot or page in this period', 'Nenhuma visita deste bot ou página neste período') : t('No AI bot visits in this period', 'Nenhuma visita de bot de IA neste período')}
      description={t(`The ${number(period.covered)} days collected show no AI bot here. This is a measured zero: check that your site does not block them.`, `Os ${number(period.covered)} dias coletados não mostram nenhum robô de IA aqui. Este é um zero medido: confira se o seu site não os bloqueia.`)}
    />
  );

  // --- Overview ----------------------------------------------------------------------------------------------------------
  if (section === 'overview')
    return (
      <>
        <MetricGrid columns={5} mobilePairs label={t('AI bot metrics', 'Métricas de bots de IA')}>
          {botKpis}
          {referralsCard}
        </MetricGrid>
        <div className="overview-grid mt-5">
          {trendCard(source, true)}
          {llmRanking}
        </div>
        {totals.visits ? (
          <div className="overview-grid">
            {pagesCard(report.pages.slice(0, 10), true)}
            {statusCard}
          </div>
        ) : (
          <div className="mb-5">{noBots}</div>
        )}
        {footer}
      </>
    );

  // --- AI Bots -----------------------------------------------------------------------------------------------------------
  if (section === 'bots') {
    const botColumns: DataColumn<BotRow>[] = [
      {
        key: 'bot',
        header: t('Bot', 'Bot'),
        mobile: 'title',
        shrinkTo: '12rem',
        width: '20rem',
        sortValue: (row) => row.name,
        hint: (row) => `${row.name}, ${row.operator}`,
        cell: (row) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">{row.id === 'other' ? t('Other AI bots', 'Outros bots de IA') : row.name}</span>
            <span className="min-w-0 truncate text-muted-foreground">{row.id === 'other' ? '' : row.operator}</span>
          </span>
        ),
      },
      {
        key: 'purpose',
        header: t('Purpose', 'Finalidade'),
        label: t('Purpose', 'Finalidade'),
        info: t('Training: collects pages to train models. Search: builds the index an AI search answers from. User request: fetches a page because someone asked an assistant right now.', 'Treinamento: coleta páginas para treinar modelos. Busca: monta o índice de onde uma busca com IA responde. Pedido de usuário: busca uma página porque alguém perguntou a um assistente agora.'),
        width: '12rem',
        sortValue: (row) => row.purpose,
        cell: (row) => <TagBadge dotColor={PURPOSE_COLOR[row.purpose]}>{purposeLabel(t, row.purpose)}</TagBadge>,
      },
      { key: 'visits', header: t('Visits', 'Visitas'), label: t('Visits', 'Visitas'), align: 'end', sortValue: (row) => row.visits, cell: (row) => <WithChange change={change(growth(row.visits, row.previous), '')}>{number(row.visits)}</WithChange> },
      { key: 'pages', header: t('Pages', 'Páginas'), label: t('Pages', 'Páginas'), align: 'end', sortValue: (row) => row.pages, cell: (row) => number(row.pages) },
      {
        key: 'errors',
        header: t('Errors', 'Erros'),
        label: t('Errors', 'Erros'),
        info: t('Share of its visits answered with 404, 403 or 5xx.', 'Parcela das visitas dele respondidas com 404, 403 ou 5xx.'),
        align: 'end',
        sortValue: (row) => row.errors / Math.max(1, row.visits),
        cell: (row) => percent((row.errors / Math.max(1, row.visits)) * 100),
      },
      { key: 'last', header: t('Last visit', 'Última visita'), label: t('Last visit', 'Última visita'), align: 'end', sortValue: (row) => row.lastDay, cell: (row) => dates.day(row.lastDay) },
    ];
    return (
      <>
        {filterBar}
        <MetricGrid columns={4} mobilePairs label={t('AI bot metrics', 'Métricas de bots de IA')}>
          {botKpis}
        </MetricGrid>
        {totals.visits ? (
          <>
            <div className="overview-grid mt-5">
              {trendCard('bots', false)}
              {statusCard}
            </div>
            <SectionCard
              title={t('Bots', 'Bots')}
              info={t('Each AI bot that visited in the period, with its company, what it fetches for, its visits, the distinct pages it read, its share of errors and the last day it came. Open a bot to see only its visits.', 'Cada robô de IA que visitou no período, com a empresa, o que busca, as visitas, as páginas distintas que leu, a parcela de erros e o último dia em que veio. Abra um bot para ver só as visitas dele.')}
              className="mb-5"
            >
              <DataTable singleLine="wide" minWidth={0} rows={botRows.rows} sort={botRows.sort} onSortChange={botRows.onSortChange} rowKey={(row) => row.id} rowLink={(row) => link(pageTarget('bots', { ...drill, bot: row.id }))} columns={botColumns} />
              {botRows.pages > 1 && botRows.controls}
            </SectionCard>
            <div className="mb-5">{pagesCard(pageRows.rows, false, pageRows.pages > 1 && pageRows.controls)}</div>
          </>
        ) : (
          <div className="my-5">{noBots}</div>
        )}
        {footer}
      </>
    );
  }

  // --- AI Traffic --------------------------------------------------------------------------------------------------------
  if (!paid)
    return (
      <>
        {filterBar}
        {freeState()}
        <div className="mt-5">{footer}</div>
      </>
    );
  const sentShare = totals.requests && totals.referrals !== null ? (totals.referrals / totals.requests) * 100 : null;
  const llmColumns: DataColumn<LlmRow>[] = [
    { key: 'llm', header: 'LLM', mobile: 'title', sortValue: (row) => row.name, hint: (row) => `${row.name}, ${row.operator}`, cell: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate">{row.name}</span>
        <span className="min-w-0 truncate text-muted-foreground">{row.operator}</span>
      </span>
    ) },
    { key: 'visits', header: t('Visits', 'Visitas'), label: t('Visits', 'Visitas'), align: 'end', sortValue: (row) => row.visits, cell: (row) => <WithChange change={change(growth(row.visits, row.previous), '')}>{number(row.visits)}</WithChange> },
    {
      key: 'share',
      header: t('Share', 'Parcela'),
      label: t('Share', 'Parcela'),
      info: t('Its share of the visits from AIs in the period.', 'A parcela dele nas visitas vindas de IAs no período.'),
      align: 'end',
      sortValue: (row) => row.visits,
      cell: (row) => (totals.referrals ? percent((row.visits / totals.referrals) * 100) : '—'),
    },
    { key: 'pages', header: t('Landing pages', 'Páginas de entrada'), label: t('Landing pages', 'Páginas de entrada'), align: 'end', sortValue: (row) => row.pages, cell: (row) => number(row.pages) },
    { key: 'last', header: t('Last visit', 'Última visita'), label: t('Last visit', 'Última visita'), align: 'end', sortValue: (row) => row.lastDay, cell: (row) => dates.day(row.lastDay) },
  ];
  const landingsNote = report.landingsFrom && report.landingsFrom > period.from
    ? t(`Landing pages are collected from ${dates.day(report.landingsFrom)} on.`, `As páginas de entrada são coletadas a partir de ${dates.day(report.landingsFrom)}.`)
    : '';
  return (
    <>
      {filterBar}
      <MetricGrid columns={4} mobilePairs label={t('AI traffic metrics', 'Métricas de tráfego de IA')}>
        {referralsCard}
        <MetricCard
          label={t('LLMs sending visits', 'LLMs que mandam visitas')}
          definition={t('The LLMs with at least one visit to your site from a link in their answers in the period.', 'Os LLMs com ao menos uma visita ao seu site por um link nas respostas deles no período.')}
          value={number(report.llms.length)}
          description={report.llms[0] ? t(`${report.llms[0].name} first`, `${report.llms[0].name} em primeiro`) : undefined}
        />
        <MetricCard
          label={t('Landing pages', 'Páginas de entrada')}
          definition={`${t('Distinct pages of your site the visits from AI answers arrived on.', 'Páginas distintas do seu site onde chegaram as visitas vindas de respostas de IA.')}${landingsNote ? ` ${landingsNote}` : ''}`}
          value={totals.landingPages === null ? '—' : number(totals.landingPages)}
          description={t('where the visits arrived', 'onde as visitas chegaram')}
        />
        <MetricCard
          label={t('Share of all visits', 'Parcela de todas as visitas')}
          definition={`${t('Visits from AI answers against every request to your site in the period.', 'Visitas vindas de respostas de IA ante todas as requisições ao seu site no período.')} ${sampled}`}
          value={sentShare === null ? '—' : percent(sentShare, 2)}
          description={t('of all requests', 'de todas as requisições')}
        />
      </MetricGrid>
      {totals.referrals ? (
        <>
          {/* One LLM: its ranking would be a single bar, so its days take the whole row. */}
          {drill.llm ? (
            <div className="my-5">{trendCard('llms', false)}</div>
          ) : (
            <div className="overview-grid mt-5">
              {trendCard('llms', false)}
              {llmRanking}
            </div>
          )}
          <SectionCard
            title="LLMs"
            info={t('Each LLM whose answers sent visits in the period, with its company, its visits, its share, the pages they landed on and the last day. Open one to see only its visits.', 'Cada LLM cujas respostas mandaram visitas no período, com a empresa, as visitas, a parcela, as páginas onde chegaram e o último dia. Abra um para ver só as visitas dele.')}
            className="mb-5"
          >
            <DataTable singleLine="wide" minWidth={0} rows={llmRows.rows} sort={llmRows.sort} onSortChange={llmRows.onSortChange} rowKey={(row) => row.id} rowLink={(row) => link(pageTarget('traffic', { ...drill, llm: row.id }))} columns={llmColumns} />
            {llmRows.pages > 1 && llmRows.controls}
          </SectionCard>
          <SectionCard
            title={t('Landing pages', 'Páginas de entrada')}
            info={`${t('The pages of your site the visits from AI answers arrived on, the most first. Cited in answers: an answer this project monitors cited the page in the period. Open a page to see the LLMs that sent visits to it.', 'As páginas do seu site onde chegaram as visitas vindas de respostas de IA, as mais visitadas primeiro. Citada nas respostas: uma resposta monitorada neste projeto citou a página no período. Abra uma página para ver os LLMs que mandaram visitas para ela.')}${landingsNote ? ` ${landingsNote}` : ''}`}
            className="mb-5"
          >
            {report.landings.length ? (
              <>
              <DataTable
                singleLine="wide"
                minWidth={0}
                compact
                rows={landingRows.rows}
                rowKey={(row) => row.path}
                rowLink={(row) => link(pageTarget('traffic', { llm: drill.llm, page: row.path }))}
                columns={[
                  { key: 'page', header: t('Page', 'Página'), mobile: 'title', hint: (row) => row.path, cell: (row) => <span className="block min-w-0 truncate">{row.path}</span> },
                  { key: 'visits', header: t('Visits', 'Visitas'), label: t('Visits', 'Visitas'), align: 'end', width: '6rem', cell: (row) => number(row.visits) },
                  { key: 'llms', header: 'LLMs', label: 'LLMs', align: 'end', width: '5rem', cell: (row) => number(row.llms) },
                  {
                    key: 'cited',
                    header: t('Cited in answers', 'Citada nas respostas'),
                    label: t('Cited in answers', 'Citada nas respostas'),
                    width: '10rem',
                    cell: (row) => (row.cited ? <TagBadge tone="success">{t('Yes', 'Sim')}</TagBadge> : <span className="text-muted-foreground">{t('Not yet', 'Ainda não')}</span>),
                  },
                ]}
              />
              {landingRows.pages > 1 && landingRows.controls}
              </>
            ) : (
              <EmptyState
                frame="bare"
                title={t('Landing pages not collected yet', 'Páginas de entrada ainda não coletadas')}
                description={t('Lastfind reads the page each visit from an AI answer arrived on from 13 Nov 2026 on. The next daily collection fills it in.', 'O Lastfind lê a página onde chegou cada visita vinda de resposta de IA a partir de 13 de novembro de 2026. A próxima coleta diária preenche esta lista.')}
              />
            )}
          </SectionCard>
        </>
      ) : (
        <div className="my-5">{noVisitsSent()}</div>
      )}
      {footer}
    </>
  );
}

/**
 * Traffic in Settings (13/11/2026: the connection lives here, not on the report): the site's Cloudflare zone, how it is read and
 * the actions of a workspace admin. The states are AiBotsConnectionCard's.
 */
export function AiBotsSettings({ projectId, demo = false, reportLink }: { projectId: string; demo?: boolean; reportLink: ReturnType<Linker> }) {
  const t = useCopy();
  const path = `/api/projects/${encodeURIComponent(projectId)}/ai-bots`;
  const [state, setState] = useState<{ connection: AiBotsConnection | null; failed: boolean }>({ connection: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (demo) return;
    let active = true;
    requestJson<Answer>(`${path}?connection=only`)
      .then((data) => active && setState({ connection: data.connection, failed: false }))
      .catch((cause) => active && cause?.name !== 'AbortError' && setState({ connection: null, failed: true }));
    return () => {
      active = false;
    };
  }, [path, attempt, demo]);
  if (demo)
    return <SectionCard inset="padded" title={t('Cloudflare connection', 'Conexão com a Cloudflare')} description={t('Connecting a site is unavailable in this temporary demo.', 'Conectar um site não está disponível nesta demo temporária.')}><Button variant="outline" nativeButton={false} render={<a href="/docs/ai-bots" aria-label={t('How it works', 'Como funciona')} />}>{t('How it works', 'Como funciona')}</Button></SectionCard>;
  if (state.failed) return <EmptyState tone="error" title={t('The connection did not load.', 'A conexão não carregou.')} onRetry={reload} />;
  if (!state.connection) return <SectionCard loading lines={3} />;
  return <AiBotsConnectionCard projectId={projectId} connection={state.connection} reportLink={reportLink} onChanged={reload} />;
}

/**
 * The connection's states, one card: not connected (the token form inline), the zone still to be chosen, connected (zone,
 * plan, token, last collection; replace the token or disconnect), the token no longer working (replace it), and read-only for
 * the roles that do not manage it. Pure on its `connection` (the catalog shows each state with a fixture).
 */
export function AiBotsConnectionCard({ projectId, connection, reportLink, onChanged }: { projectId: string; connection: AiBotsConnection; reportLink?: ReturnType<Linker>; onChanged: () => void }) {
  const t = useCopy();
  const dates = useDateCopy();
  const path = `/api/projects/${encodeURIComponent(projectId)}/ai-bots`;
  const [dialog, setDialog] = useState<null | 'replace' | 'disconnect'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const leave = async () => {
    setBusy(true);
    try {
      await requestJson(path, 'POST', { action: 'disconnect' });
      setDialog(null);
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };
  const manage = connection.canManage && !connection.preview;
  const connected = connection.state === 'active' || connection.state === 'invalid';
  const title = t('Cloudflare connection', 'Conexão com a Cloudflare');
  const description = t('Read-only access to your site’s Cloudflare analytics: the AI bots that read it and, on paid Cloudflare plans, the visits AI answers send. Nothing is installed on your site.', 'Acesso só de leitura às análises da Cloudflare do seu site: os robôs de IA que o leem e, nos planos pagos da Cloudflare, as visitas que as respostas de IA mandam. Nada é instalado no seu site.');
  // Not connected yet (or the zone still to be chosen): the form itself, for whoever manages it.
  if (manage && (connection.state === 'none' || connection.state === 'zone'))
    return (
      <SectionCard inset="padded" title={title} description={description}>
        {connection.state === 'zone' && <p className="mb-4 text-body">{t('The token is saved. Choose the zone of this project’s site to start collecting.', 'O token está salvo. Escolha a zona do site deste projeto para começar a coletar.')}</p>}
        <ConnectForm inline projectId={projectId} startAtZone={connection.state === 'zone'} onConnected={onChanged} t={t} />
      </SectionCard>
    );
  const details: [string, string][] = connected
    ? [
        [t('Zone', 'Zona'), connection.zone ?? '—'],
        [t('Cloudflare plan', 'Plano da Cloudflare'), connection.plan ?? '—'],
        ...(connection.tokenHint ? [[t('Token', 'Token'), t(`read only, ending in ${connection.tokenHint}`, `só leitura, terminado em ${connection.tokenHint}`)] as [string, string]] : []),
        ...(connection.connectedAt ? [[t('Connected', 'Conectado'), dates.moment(connection.connectedAt)] as [string, string]] : []),
        [t('Last collection', 'Última coleta'), connection.lastSyncAt ? dates.moment(connection.lastSyncAt) : t('Not yet', 'Ainda não')],
      ]
    : [];
  const problem = connection.state === 'invalid'
    ? connection.problem === 'zone'
      ? t('Cloudflare no longer shows this zone to the token, so the collection stopped. Replace the token to go on; the history stays.', 'A Cloudflare não mostra mais esta zona ao token, então a coleta parou. Troque o token para continuar; o histórico fica.')
      : t('Cloudflare stopped accepting the token (revoked, expired or missing a permission), so the collection stopped. Replace it to go on; the history stays.', 'A Cloudflare parou de aceitar o token (revogado, expirado ou sem uma permissão), então a coleta parou. Troque o token para continuar; o histórico fica.')
    : '';
  return (
    <>
      <SectionCard inset="padded" title={title} description={description}>
        <div className="grid gap-4">
          {connection.preview && <p className="text-body">{t('Example data for this preview: no real Cloudflare zone is connected.', 'Dados de exemplo desta prévia: nenhuma zona real da Cloudflare está conectada.')}</p>}
          {!connected && !connection.preview && <p className="text-body">{connection.canManage ? t('No site connected.', 'Nenhum site conectado.') : t('No site connected. A workspace admin connects it here; ask one to connect it.', 'Nenhum site conectado. Um admin do workspace conecta aqui; peça a um deles para conectar.')}</p>}
          {problem && <FieldError>{problem}</FieldError>}
          {details.length > 0 && !connection.preview && (
            <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-[max-content_1fr]">
              {details.map(([term, value]) => (
                <div key={term} className="contents">
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {connected && !connection.paid && !connection.preview && (
            <p className="text-body text-muted-foreground">{t('This zone is on a Free Cloudflare plan: AI Traffic needs a paid plan (Pro and above), because only those report where a visit came from.', 'Esta zona está num plano Free da Cloudflare: Tráfego de IA precisa de um plano pago (Pro ou superior), porque só eles informam de onde veio uma visita.')}</p>
          )}
          {error && <FieldError>{error}</FieldError>}
          {(manage && connected) || (connected && reportLink) ? (
            <div className="flex flex-wrap gap-2">
              {manage && connected && <Button variant={connection.state === 'invalid' ? 'default' : 'outline'} onClick={() => setDialog('replace')}>{t('Replace token', 'Trocar token')}</Button>}
              {manage && connected && <Button variant="outline" onClick={() => setDialog('disconnect')}>{t('Disconnect', 'Desconectar')}</Button>}
              {connected && reportLink && <Button variant="outline" nativeButton={false} render={<a {...reportLink} aria-label={t('Open Traffic', 'Abrir Tráfego')} />}>{t('Open Traffic', 'Abrir Tráfego')}</Button>}
            </div>
          ) : null}
        </div>
      </SectionCard>
      {dialog === 'replace' && <ConnectForm projectId={projectId} startAtZone={false} onCancel={() => setDialog(null)} onConnected={() => { setDialog(null); onChanged(); }} t={t} />}
      <ConfirmDialog
        open={dialog === 'disconnect'}
        onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}
        title={t('Disconnect Cloudflare?', 'Desconectar a Cloudflare?')}
        description={t('The token is deleted now and the daily collection stops. The days already collected stay for a reconnection.', 'O token é apagado agora e a coleta diária para. Os dias já coletados ficam para uma reconexão.')}
        confirmLabel={t('Disconnect', 'Desconectar')}
        cancelLabel={t('Cancel', 'Cancelar')}
        destructive
        pending={busy}
        pendingLabel={t('Disconnecting…', 'Desconectando…')}
        onConfirm={() => void leave()}
      />
    </>
  );
}

/**
 * Creating the token (12/11/2026: a button, not a recipe): Cloudflare's token form opens already filled in with the three read-only
 * permissions and the name (CLOUDFLARE_TOKEN_TEMPLATE_URL); the customer picks the site's zone, creates it and pastes it here.
 */
function TokenSteps({ t }: { t: Translate }) {
  return (
    <div className="grid gap-3">
      <div>
        <Button variant="outline" nativeButton={false} render={<a href={CLOUDFLARE_TOKEN_TEMPLATE_URL} target="_blank" rel="noreferrer" aria-label={t('Create token in Cloudflare (opens in a new tab)', 'Criar token na Cloudflare (abre em nova aba)')} />}>
          {t('Create token in Cloudflare', 'Criar token na Cloudflare')}
        </Button>
      </div>
      <ol className="grid list-decimal gap-2 pl-5 text-body text-muted-foreground">
        <li>
          {t('Cloudflare opens with the token ready, read only: ', 'A Cloudflare abre com o token pronto, só leitura: ')}
          {TOKEN_PERMISSIONS.map(({ label }) => label.join(' > ')).join(', ')}.
        </li>
        <li>{t('Under Zone Resources you may keep all zones or pick your site’s zone. Then choose Continue to summary and Create Token.', 'Em Zone Resources, mantenha todas as zonas ou escolha a do seu site. Depois escolha Continue to summary e Create Token.')}</li>
        <li>{t('Copy the token and paste it below: Lastfind checks it right away.', 'Copie o token e cole abaixo: o Lastfind confere na hora.')}</li>
      </ol>
    </div>
  );
}

/**
 * Connecting the zone: the token (pasted and checked at once), then the zone of the site. Inline in Settings when nothing is
 * connected (or the zone is still to be chosen), in a dialog when the token is replaced.
 */
function ConnectForm({ projectId, startAtZone, onConnected, onCancel, inline = false, t }: { projectId: string; startAtZone: boolean; onConnected: () => void; onCancel?: () => void; inline?: boolean; t: Translate }) {
  const id = useId();
  const path = `/api/projects/${encodeURIComponent(projectId)}/ai-bots`;
  const [token, setToken] = useState('');
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [zone, setZone] = useState('');
  const [error, setError] = useState('');
  const [listProblem, setListProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  /** The pasted token was accepted: said once, above the zone choice. */
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (!startAtZone) return;
    let active = true;
    requestJson<{ ok: boolean; zones?: Zone[]; current?: string | null; problem?: Problem }>(path, 'POST', { action: 'zones' })
      .then((answer) => {
        if (!active) return;
        if (answer.ok && answer.zones) {
          setZones(answer.zones);
          setZone(answer.current ?? answer.zones[0]?.id ?? '');
        } else setListProblem(answer.problem ?? 'network');
      })
      .catch((cause: Error) => active && setError(cause.message));
    return () => {
      active = false;
    };
  }, [startAtZone, path]);
  /** Checks a token with Cloudflare (the same check as saving it): on success the zones it sees, on failure what it lacks. */
  const check = async (value: string) => {
    setError('');
    if (!value.trim()) return setError(t('Paste the token you created.', 'Cole o token que você criou.'));
    setBusy(true);
    try {
      const answer = await requestJson<{ ok: boolean; zones?: Zone[]; current?: string | null; problem?: Problem }>(path, 'POST', { action: 'token', token: value.trim() });
      if (!answer.ok || !answer.zones) return setError(problemText(t, answer.problem ?? 'network'));
      setToken('');
      setAccepted(true);
      setZones(answer.zones);
      setZone(answer.current ?? answer.zones[0]?.id ?? '');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!zones) return check(token);
    if (!zone) return setError(t('Choose a zone.', 'Escolha uma zona.'));
    setBusy(true);
    try {
      const answer = await requestJson<{ ok: boolean; problem?: Problem }>(path, 'POST', { action: 'zone', zone });
      if (!answer.ok) return setError(problemText(t, answer.problem ?? 'network'));
      onConnected();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choosing = !!zones;
  const actions = (
    <>
      {onCancel && <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{t('Cancel', 'Cancelar')}</Button>}
      <Button type="submit" form={`${id}-form`} disabled={startAtZone && !choosing} pending={busy} pendingLabel={choosing ? t('Connecting…', 'Conectando…') : t('Checking…', 'Verificando…')}>
        {choosing ? t('Connect', 'Conectar') : t('Check token', 'Verificar token')}
      </Button>
    </>
  );
  const form = (
    <form id={`${id}-form`} onSubmit={(event) => void submit(event)} noValidate>
      <FieldGroup className="gap-5">
        {!choosing && !startAtZone && <TokenSteps t={t} />}
        {choosing ? (
          <Field data-invalid={Boolean(error) || undefined}>
            <FieldLabel htmlFor={`${id}-zone`}>{t('Zone', 'Zona')}</FieldLabel>
            <SelectField id={`${id}-zone`} value={zone} disabled={busy} onValueChange={(value) => { setZone(value); setError(''); }} options={zones.map((item) => ({ value: item.id, label: `${item.name} (${item.plan})` }))} />
            {accepted && (
              <output className="block text-body text-foreground">
                {zones.length === 1 ? t('Token accepted: it reads 1 zone.', 'Token aceito: ele lê 1 zona.') : t(`Token accepted: it reads ${zones.length} zones.`, `Token aceito: ele lê ${zones.length} zonas.`)}
              </output>
            )}
            <FieldDescription>{t('Choosing another site than the one collected before starts a new history.', 'Escolher outro site que não o coletado antes começa um histórico novo.')}</FieldDescription>
            {error && <FieldError>{error}</FieldError>}
          </Field>
        ) : startAtZone ? (
          error || listProblem ? <FieldError>{error || problemText(t, listProblem!)}</FieldError> : <p className="text-body text-muted-foreground">{t('Reading the zones this token sees…', 'Lendo as zonas que este token enxerga…')}</p>
        ) : (
          <Field data-invalid={Boolean(error) || undefined} className="max-w-md">
            <FieldLabel htmlFor={`${id}-token`}>{t('API token', 'Token de API')}</FieldLabel>
            <Input
              id={`${id}-token`}
              type="password"
              value={token}
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
              disabled={busy}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => { setToken(event.target.value); setError(''); }}
              // A paste is checked at once: no button to find after copying the token from Cloudflare.
              onPaste={(event) => {
                const pasted = event.clipboardData.getData('text');
                if (!pasted.trim()) return;
                event.preventDefault();
                setToken(pasted.trim());
                void check(pasted);
              }}
            />
            <FieldDescription>{busy ? t('Checking the token with Cloudflare…', 'Conferindo o token com a Cloudflare…') : t('Paste it and it is checked right away.', 'Cole e ele é conferido na hora.')}</FieldDescription>
            {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
          </Field>
        )}
      </FieldGroup>
    </form>
  );
  if (inline)
    return (
      <div className="grid gap-5">
        {form}
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
    );
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel?.()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{choosing ? t('Choose your site’s zone', 'Escolha a zona do seu site') : t('Replace the token', 'Trocar o token')}</DialogTitle>
          <DialogDescription>
            {choosing
              ? t('The zone of this project’s site. Lastfind reads its last 30 days now and one more day every day.', 'A zona do site deste projeto. O Lastfind lê os últimos 30 dias agora e mais um dia todos os dias.')
              : t('Create a read-only API token in Cloudflare: it only reads analytics and cannot change anything in your account. Lastfind stores it encrypted and never shows it again.', 'Crie um token de API só de leitura na Cloudflare: ele só lê as análises e não muda nada na sua conta. O Lastfind guarda o token criptografado e nunca o mostra de novo.')}
          </DialogDescription>
        </DialogHeader>
        {form}
        <DialogFooter>{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
