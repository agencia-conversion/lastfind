'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, EllipsisVertical, Eye, ListOrdered, Merge, MessageSquare, Radar, RotateCcw, ScanSearch, X } from 'lucide-react';
import { requestJson } from '@/lib/client';
import { useReport } from '@/hooks/use-report';
import { useKeptReport } from '@/hooks/use-kept-report';
import { useTableColumns, visibleColumns } from '@/hooks/use-table-columns';
import type { Project } from '@/lib/types';
import { type CompetitorsReport, type SummaryReport } from '@/lib/report-types';
import { aliasTargets, brandKey, type BrandRow, type BrandsOverview } from '@/lib/brand-decisions';
import { ROLE_LABELS, evaluableDiscovery } from '@/lib/brand-roles';
import { Alert } from '@/components/ui/alert';
import {
  ConfirmDialog,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SelectField } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { DetailBody, DetailHeader, DetailPage } from '@/components/lastfind/presentation/detail-page';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { toast } from '@/components/ui/toast';
import { Progress } from '@/components/ui/progress';
import { ColumnPicker, DataTable, DataTableScreen, DataTableToolbar } from '@/components/lastfind/presentation/data-table';
import { MetricCard, MetricGrid, MetricGridSkeleton, MetricValueSkeleton } from '@/components/lastfind/presentation/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { ALL_BRANDS, brandShown, type BrandFilter } from '@/lib/brand-filter';
import { BrandReportTabs, type BrandReportView } from './brand-report-tabs';
import type { BrandResearchReport } from './brand-research-panel';
import { BrandSentimentAnalysis, SentimentBar, sentimentLabel, sentimentShares } from './brand-sentiment-analysis';
import { ExcerptSnippet } from './answer-markdown';
import { sentimentIndexDefinition, sentimentScore } from './overview-sentiment-card';
import { DrillLink, type DrillTarget, type Linker } from './drill-link';
import { BrandPage, BrandPageSkeleton } from './brand-page';
import { researchReadPath } from './screen-reads';
import { discoveredInPeriod } from '@/lib/report-trend';
import { coveredPeriods } from '@/lib/period-coverage';
import { noComparisonNote, summaryComparable } from './overview-kpis';
import { Change, EmptyState, SearchField, useCopy, SiteFavicon, SummaryPager, useComparison, useNumbers, useSortedPage, WithChange } from './shared';

type Status = 'tracked' | 'discovered' | 'rejected';
type Row = {
  key: string;
  name: string;
  status: Status;
  own: boolean;
  domain: string;
  domainSuggested: boolean;
  domainSource: BrandRow['domainSource'];
  domainConfidence: BrandRow['domainConfidence'];
  domainCandidates: string[];
  domainSite: BrandRow['domainSite'];
  domainReview: boolean;
  review: boolean;
  reasons: string[];
  role: BrandRow['role'];
  /** A monitored competitor this discovery may be (BrandRow.sameAs): the person merges it or not. */
  sameAs: string | null;
  /**
   * In the report's period, under its filters: a discovered or rejected brand too, from the discoveries the brand analysis
   * stored in each answer. Before it stored them, such a brand is counted in the period only without a model,
   * topic, tag or text filter; otherwise (or with no daily counts) it shows its saved answers of the last 90 days (`mentionsSaved`).
   */
  mentions: number | null;
  mentionsSaved: boolean;
  visibility: number | null;
  shareOfVoice: number | null;
  /** Whether share of voice counts the brand: a monitored one, or a discovered competitor (settled, not rejected). */
  counted: boolean;
  /** The brand in the comparison period (the report's); absent without an answer then. */
  previous?: CompetitorsReport['platforms'][number]['previous'];
  /** Saved answers that mention it as its decisions record them: the last 90 days' for a discovered or rejected brand. */
  answers: number | null;
  aliases: string[];
  sense: string;
  rejectEventId: string | null;
  evidence: BrandRow['evidence'];
  /** UTC day → answers of that day that mention a discovered brand. */
  days: Record<string, number>;
};
/** Brand percentages overlap and must not be added across brands; the mentions share of voice counts add up. */
export function brandSummary(rows: Pick<Row, 'mentions' | 'counted' | 'mentionsSaved'>[]) {
  const measured = rows.filter((row) => row.counted && !row.mentionsSaved && row.mentions != null);
  return { mentions: measured.length ? measured.reduce((sum, row) => sum + row.mentions!, 0) : null };
}

/** What the brand page reads of a row. */
export type BrandPageRow = Row;

/**
 * One ranking: monitored brands next to discovered and rejected ones, all from the report under its filters. A
 * report without the stored discoveries (an analysis made before) falls back to their daily mentions in the summary's
 * window (`measured` false under a model, topic, tag or text filter: they have no such breakdown).
 */
export function buildBrandRows(
  project: Pick<Project, 'name' | 'domain' | 'competitors'>,
  report: CompetitorsReport | null,
  overview: BrandsOverview | undefined,
  period: { summary: SummaryReport | null | undefined; measured: boolean } = { summary: null, measured: false },
): Row[] {
  const measured = new Map((report?.platforms ?? []).map((row) => [row.name, row]));
  // The answers' stored discoveries, measured like the monitored brands under any filter.
  const counts = report?.discovered && Object.keys(report.discovered).length ? report.discovered : null;
  const totals = report?.totals;
  const share = (part: number, whole: number | undefined) => (whole ? (part / whole) * 100 : null);
  const tracked: Row[] = [
    { name: project.name, domain: project.domain, aliases: [] as string[], own: true },
    ...project.competitors.map((target) => ({ name: target.name, domain: target.domain, aliases: target.aliases ?? [], own: false })),
  ].map((target) => {
    const row = measured.get(target.name);
    const key = brandKey(target.name);
    // A brand just monitored has no count of its own until the brand analysis relabels the saved answers (minutes on a big
    // project): meanwhile it keeps the count it had as a discovery, so it never drops to the end of the list.
    const found = !row && !target.own ? [target.name, ...(target.aliases ?? [])].map((name) => counts?.[brandKey(name)]).find(Boolean) : undefined;
    return {
      key,
      name: target.name,
      status: 'tracked',
      own: target.own,
      domain: target.domain,
      domainSuggested: false,
      domainSource: null,
      domainConfidence: null,
      domainCandidates: [],
      domainSite: null,
      domainReview: false,
      review: false,
      reasons: [],
      role: 'competitor',
      sameAs: null,
      mentions: row ? row.mentions : found ? found.mentions : null,
      mentionsSaved: false,
      counted: true,
      visibility: row && row.responses ? row.visibility : found ? share(found.weightedMentions, totals?.weightedAnalysed ?? totals?.weightedResponses) : null,
      shareOfVoice: row?.shareOfVoice ?? (found?.counted ? share(found.weightedMentions, totals?.weightedMentions) : null),
      previous: row?.previous,
      answers: row ? row.mentions : found ? found.mentions : null,
      aliases: target.aliases,
      sense: '',
      rejectEventId: null,
      evidence: [],
      days: {},
    };
  });
  // Right after Undo the project is fresh but the analysis list can still hold the brand as rejected: monitored wins (one row per key).
  const monitored = new Set(tracked.map((row) => row.key));
  const others: Row[] = (overview?.rows ?? []).filter((row) => !monitored.has(row.key)).map((row) => {
    const measured = counts?.[row.key] ?? (counts ? { mentions: 0, previous: 0, counted: false, weightedMentions: 0, weightedPrevious: 0 } : null);
    const inPeriod = measured || !period.measured ? { mentions: null, visibility: null } : discoveredInPeriod(period.summary, row.days ?? {});
    const mentions = measured ? measured.mentions : inPeriod.mentions;
    // Every brand shows a count: when the period cannot be measured for it, its saved answers of the last 90 days.
    const saved = mentions == null && row.responses != null;
    return {
      key: row.key,
      name: row.name,
      status: row.status,
      own: false,
      domain: row.domain ?? '',
      domainSuggested: row.domainSuggested,
      domainSource: row.domainSource,
      domainConfidence: row.domainConfidence,
      domainCandidates: row.domainCandidates,
      domainSite: row.domainSite ?? null,
      domainReview: row.domainReview,
      review: row.review,
      reasons: row.reasons,
      role: row.role,
      sameAs: row.status === 'discovered' ? (row.sameAs ?? null) : null,
      mentions: saved ? row.responses : mentions,
      mentionsSaved: saved,
      // Rates are topic-weighted (lib/topic-weights), counts real.
      // A discovery is known only in the answers the brand analysis read: its visibility is over those (run-rows voiceSql).
      visibility: measured ? share(measured.weightedMentions, totals?.weightedAnalysed ?? totals?.weightedResponses) : inPeriod.visibility,
      // Only a counted competitor has a share of the mentions share of voice divides.
      shareOfVoice: measured?.counted ? share(measured.weightedMentions, totals?.weightedMentions) : null,
      counted: !!measured?.counted,
      // Only where the analysis read enough of the earlier period (lib/period-coverage): before it, the brand is unknown, not 0.
      ...(measured && totals?.previousResponses && coveredPeriods(totals.previousAnalysed, totals.analysed)
        ? { previous: {
            responses: totals.previousResponses,
            mentions: measured.previous,
            visibility: share(measured.weightedPrevious, totals.weightedPreviousAnalysed ?? totals.weightedPreviousResponses) ?? 0,
            shareOfVoice: measured.counted ? share(measured.weightedPrevious, totals.weightedPreviousMentions) : null,
          } }
        : {}),
      answers: row.responses,
      aliases: row.aliases,
      sense: row.sense,
      rejectEventId: row.rejectEventId,
      evidence: row.evidence,
      days: row.days ?? {},
    };
  });
  return [...tracked, ...others].sort(byMentions);
}

// The sortable columns, ordered over the whole list before it is paged.
const BRAND_SORT = {
  brand: (row: Row) => row.name,
  visibility: (row: Row) => row.visibility,
  sov: (row: Row) => row.shareOfVoice,
  mentions: (row: Row) => row.mentions,
};

// Ranked by mentions, your brand among the others (10/11/2026: kept first, a rival leading every metric showed #2); the
// "You" label marks yours.
const byMentions = (a: Row, b: Row) => (b.mentions ?? -1) - (a.mentions ?? -1) || a.name.localeCompare(b.name);

/** Optimistic status until the server matches; `row` is the brand as it was at the X. */
type Pending = { status: Status; rejectEventId?: string | null; sense?: string; was?: Status; row?: Row };

export function withPending(built: Row[], pending: Record<string, Pending>): Row[] {
  const rows = [...built];
  // Undo before any list has the brand back (slow server), or Monitor before the project read has it (the fresh list no longer
  // holds it as a discovery): show the row saved at the click, so it never blinks out.
  for (const overlay of Object.values(pending))
    if (overlay.row && overlay.status !== 'rejected' && !rows.some((row) => row.key === overlay.row?.key || row.name === overlay.row?.name)) rows.push(overlay.row);
  return rows.sort(byMentions).map((row) => {
    const overlay = pending[row.key];
    // Just monitored and not measured yet: it keeps the count it had as a discovery (buildBrandRows does the same from the report).
    if (overlay?.status === 'tracked' && row.status === 'tracked' && row.mentions == null && overlay.row?.mentions != null)
      return { ...row, mentions: overlay.row.mentions, mentionsSaved: overlay.row.mentionsSaved, visibility: overlay.row.visibility, answers: overlay.row.answers };
    // Server already matches: ignore the overlay (no effect needed to clear it).
    if (!overlay || overlay.status === row.status) return row;
    return {
      ...row,
      status: overlay.status,
      rejectEventId: overlay.rejectEventId !== undefined ? overlay.rejectEventId : row.rejectEventId,
      sense: overlay.sense !== undefined ? overlay.sense : row.sense,
    };
  });
}


type ConfirmAction =
  | { kind: 'reject'; row: Row; sense?: string; close?: boolean }
  | { kind: 'merge'; row: Row; into: string; intoKey: string; intoName: string };

export function BrandsScreen({
  project,
  report: reportProp,
  loading: reportLoading,
  view,
  refresh,
  busy,
  demo,
  request = requestJson,
  read = request,
  t,
  link,
  onTargetsChanged,
  onDecided,
  error,
  clearError,
  onEvidence,
  filters,
  summary = null,
  summaryLoading = false,
  api,
  page: pageKey,
  onPageTitle,
  operator = false,
  listed = ALL_BRANDS,
}: {
  project: Project;
  report: CompetitorsReport | null;
  loading: boolean;
  view: BrandReportView;
  refresh: number | string;
  busy: boolean;
  demo: boolean;
  /** The app's own transport: the demo answers from its client, not the network. */
  request?: typeof requestJson;
  /**
   * The reports' reads (the app's kept request): the brand page's summary and the sentiment report are the same reads as the
   * app's own and the ones sent with the page, so they are asked once. Brand writes and the lists stay on `request`.
   */
  read?: typeof requestJson;
  t: (en: string, pt: string) => string;
  link: Linker;
  /** Soft workspace refresh when a decision changes monitored competitors; `reports` also reads the reports again. */
  onTargetsChanged?: (reports?: boolean) => Promise<void>;
  /** Any decision landed (a rejection too): the app drops its kept discoveries and reports of the project (analytics-cache). */
  onDecided?: () => void;
  error: string;
  clearError: () => void;
  onEvidence: (runId: string) => void;
  filters: URLSearchParams;
  /** Overview summary already used on Visão geral — position and SoV deltas, no new backend metric. */
  summary?: SummaryReport | null;
  /** While the summary loads, its card keeps its slot so the grid does not reflow. */
  summaryLoading?: boolean;
  /** Reports endpoint of the app (the demo has its own). */
  api: string;
  /** Key of the brand whose page is open, or null for the list. */
  page: string | null;
  /** Display name of the open brand page (list name, including discoveries) for the top path. */
  onPageTitle?: (title: string | null) => void;
  /** The viewer runs this installation (independent edition): server setup may be named. */
  operator?: boolean;
  /** The header's Brands filter: the monitored and discovered brands listed; rejected ones are the status list's. */
  listed?: BrandFilter;
}) {
  const { locale, number, percent } = useNumbers();
  const comparison = useComparison(t);
  // Monitored brands carry their change against the comparison period; the others have no such measurement.
  const changeNote = comparison.off ? '' : ` ${t(`Beside it, the brand’s change in percentage points against ${comparison.period}; none when that period measured fewer than half the answers of this one (for a discovered brand, the answers the brand analysis read).`, `Ao lado, a variação da marca, em pontos percentuais, ante o ${comparison.period}; nenhuma quando esse período mediu menos da metade das respostas deste (para uma marca descoberta, as respostas que a análise de marcas leu).`)}`;
  const [poll, setPoll] = useState(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [mergeInto, setMergeInto] = useState('');
  const [sense, setSense] = useState('');
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  /** Lets confirm run after a menu click even when the dialog has not re-rendered yet (fixture tests). */
  const confirmIntent = useRef<ConfirmAction | null>(null);
  /** Optimistic status overlays until the next overview/project match. */
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [stayed, setStayed] = useState<{ view: string; keys: string[] }>({ view: '', keys: [] });
  const columnsPref = useTableColumns('brands', demo);
  // The demo reads the discoveries of its own project through the app's transport; there, only Reject and Reopen exist.
  const url = `/api/projects/${encodeURIComponent(project.id)}/brands`;
  // The first read may be the server's last list (`cachedAt`): it paints at once and is read again now. Every later read
  // (a decision, the analysis progress, that follow-up) asks for the list as it is now.
  const remote = useReport<BrandsOverview>(poll ? `${url}?fresh=1` : url, `${refresh}:${poll}`, request);
  if (remote.data?.cachedAt && !poll) setPoll(1);
  // Keep the last answer while a refresh is in flight so the table never flashes.
  // The last list this tab read for the project paints at once when the screen opens again (a reload, another
  // screen and back); the fresh one replaces it when it arrives. Session storage only: it goes with the tab.
  const storageKey = `lastfind:brands:${project.id}`;
  const [kept, setKept] = useState<BrandsOverview | undefined>(() => {
    if (demo || typeof window === 'undefined') return undefined;
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as BrandsOverview) : undefined;
    } catch {
      return undefined;
    }
  });
  if (remote.data && remote.data !== kept) setKept(remote.data);
  useEffect(() => {
    if (demo || !remote.data) return;
    try {
      const value = JSON.stringify(remote.data);
      // ponytail: one list per project, up to ~2 MB; a bigger one is simply not kept.
      if (value.length < 2_000_000) window.sessionStorage.setItem(storageKey, value);
    } catch {
      /* A full or blocked storage only costs the instant paint. */
    }
  }, [demo, remote.data, storageKey]);
  const overview = remote.data ?? kept;
  // Same for the report: a decision that changes the monitored brands reads it again, and the table keeps its rows meanwhile
  // (only meanwhile: once a read settles without a report, the rows of other filters are not shown as these).
  const [keptReport, setKeptReport] = useState<CompetitorsReport | null>(null);
  if (reportProp && reportProp !== keptReport) setKeptReport(reportProp);
  const report = reportProp ?? (reportLoading ? keptReport : null);
  const loading = reportLoading && !report;
  // The same read as the Overview card and Prompts (screen-reads.ts), so all three share one kept copy for these filters.
  const researchUrl = researchReadPath(demo, project.id, filters);
  // Sentiment is read on its own and takes longer than the list: the last reading of this tab stays on screen meanwhile.
  const research = useKeptReport<BrandResearchReport>(researchUrl, demo ? null : `lastfind:brand-research:${researchUrl}`, refresh, read);
  const scope = `${researchUrl}\0${refresh}\0${view}`;
  const [selection, setSelection] = useState<{ scope: string; brand: string } | null>(null);
  const evidencePanel = useRef<HTMLElement>(null);
  const sentimentBrand = selection?.scope === scope && research.data?.brands.some(item => item.brand === selection.brand && item.assessed > 0) ? selection.brand : null;
  useEffect(() => {
    if (sentimentBrand) {
      evidencePanel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      evidencePanel.current?.focus({ preventScroll: true });
    }
  }, [sentimentBrand]);
  const label = (value: string) => sentimentLabel(value, t);
  // Server setup notes explain a missing score, never sit beside a saved one.
  const scored = !!research.data?.brands.some((item) => item.assessed > 0);
  /** Every monitored brand and every discovery the decision model settled as a competitor or partner has a page and a score. */
  const hasPage = (row: Row) => row.status === 'tracked' || (row.status === 'discovered' && evaluableDiscovery(row));
  function sentimentStatus(row: Row) {
    if (row.status === 'rejected') return '—';
    if (!hasPage(row)) return t('Awaiting confirmation', 'Aguardando confirmação');
    if (research.loading) return t('Loading…', 'Carregando…');
    if (research.error || !research.data) return t('Unavailable', 'Indisponível');
    const data = research.data, reading = data.brands.find(item => item.brand === row.name);
    if (data.selectedChannels > 0 && reading && reading.assessed > 0) return null;
    if (!data.configuration?.enabled) return t('Not evaluated', 'Não avaliado');
    if (!data.selectedChannels) return t('No responses', 'Sem respostas');
    if (data.unread?.includes(row.name)) return t('No reading', 'Sem leitura');
    // Before the evaluation has read anything, a discovery is waiting, not absent: it was found in these answers.
    if (row.status === 'discovered' && !reading && !scored) return t('Not evaluated yet', 'Ainda sem avaliação');
    // Sentiment reads the latest answer per question and model; a brand the period's answers do mention is not "No mention" when
    // only those latest ones leave it out (10/11/2026: a rival with 30 mentions said "No mention").
    if (row.status === 'discovered' ? !reading : reading && reading.prompts > 0 && reading.absent === reading.prompts)
      return row.mentions ? t('Not in the latest answers', 'Fora das últimas respostas') : t('No mention', 'Sem menção');
    return t('No evaluations', 'Sem avaliação');
  }
  const ensuring = useRef(false);
  // The analysis state an ensure was sent for: sent again only once that state moves (an ensure that changed nothing would
  // otherwise follow every read of the list), and after a failure only after a pause that doubles each time (8 s to 2 min).
  const ensuredFor = useRef('');
  const failures = useRef(0);
  const analysisState = overview && !remote.loading
    ? [project.id, overview.analysis.status, overview.analysis.processed, overview.analysis.publicationPending, overview.analysis.stale].join('\0')
    : '';
  useEffect(() => {
    if (demo || !overview?.analysis.needsEnsure || !analysisState || ensuring.current || ensuredFor.current === analysisState) return;
    ensuring.current = true;
    requestJson(`/api/projects/${encodeURIComponent(project.id)}/competitor-analysis`, 'POST', { action: 'ensure' })
      .then(() => {
        failures.current = 0;
        ensuredFor.current = analysisState;
        return 0;
      })
      .catch(() => Math.min(120_000, 8000 * 2 ** failures.current++))
      .then((pause) =>
        // A busy store answers 503: wait before asking again instead of hammering it.
        window.setTimeout(() => {
          ensuring.current = false;
          setPoll((value) => value + 1);
        }, pause),
      );
  }, [demo, overview?.analysis.needsEnsure, analysisState, project.id]);
  // The demo also waits for its analysis (a preview's first visit starts it), more patiently: it only reads.
  const running = overview?.analysis.status === 'pending' || overview?.analysis.status === 'running' || !!overview?.analysis.unavailable;
  // Brands without a domain: the server looks for it (free first, paid only when configured) in one request per visit, batch
  // after batch, and at most once every few minutes per project whoever asks (discoverBrandDomainsOnVisit). Nothing on screen
  // waits for it; the list is read again once when it found something.
  const discovering = useRef(false);
  const asked = useRef('');
  const owed = (overview?.domainDiscovery.pending ?? 0) + (overview?.domainDiscovery.sites ?? 0);
  useEffect(() => {
    if (demo || !owed || running || discovering.current || asked.current === project.id || !url) return;
    discovering.current = true;
    asked.current = project.id;
    requestJson<{ processed: number }>(url, 'POST', { action: 'discover-domains' })
      .then((result) => {
        if (result.processed) setPoll((value) => value + 1);
      })
      .catch(() => {})
      .finally(() => {
        discovering.current = false;
      });
  }, [demo, owed, running, project.id, url]);
  // A screen that already shows its list (the analysis reruns after a Monitor, say) reads it again every 6 s, not every 1.5 s:
  // each read recomputes the whole list beside the running analysis, and nothing on screen moves until it ends.
  const showing = !!overview?.rows.length;
  // Read again once the last read answered (a read cut by the next one never answers), less and less often while it runs.
  const polls = useRef(0);
  useEffect(() => {
    if (!running) polls.current = 0;
    if (!running || remote.loading) return;
    // A busy store gets the same patience as the ensure call, not the short progress interval.
    const base = demo || overview?.analysis.unavailable ? 8000 : showing ? 6000 : 1500;
    const timer = window.setTimeout(() => {
      // An ensure under way reads the list itself when it answers.
      if (ensuring.current) return;
      polls.current++;
      setPoll((value) => value + 1);
    }, Math.min(30_000, base * 1.5 ** polls.current));
    return () => window.clearTimeout(timer);
  }, [running, poll, remote.loading, overview?.analysis.unavailable, demo, showing]);
  // A finished analysis relabels the answers (a brand just monitored gets its numbers): the app reads its reports again.
  const analysing = overview?.analysis.status === 'pending' || overview?.analysis.status === 'running';
  const wasAnalysing = useRef(false);
  useEffect(() => {
    if (wasAnalysing.current && !analysing && overview?.analysis.status === 'complete' && !demo) void onTargetsChanged?.(true);
    wasAnalysing.current = analysing;
  }, [analysing, overview?.analysis.status, demo, onTargetsChanged]);

  // The analysis runs in the background: a screen with a result keeps showing it, untouched. Only a screen with nothing to
  // show yet (the first analysis, or a list rebuilt from scratch) shows the processing state below, with its progress.
  const updating = (
    <div data-testid="brands-updating">
      <EmptyState
        frame="bare"
        tone="progress"
        title={t('Updating brands', 'Atualizando marcas')}
        description={t('We are reading your saved answers. This page fills in by itself when it is done; your decisions are safe.', 'Estamos lendo suas respostas salvas. Esta página se completa sozinha ao terminar; suas decisões estão preservadas.')}
        action={overview?.analysis.total ? (
          <Progress
            value={Math.round((100 * overview.analysis.processed) / overview.analysis.total)}
            aria-label={t('Answers read', 'Respostas lidas')}
            className="w-full max-w-xs"
          />
        ) : undefined}
      />
    </div>
  );
  // Discovered brands count in the summary's window, and only with no filter that narrows the answers (as on the Overview).
  const discoveredMeasured = !['engine', 'topic', 'tags', 'query'].some((key) => filters.get(key));
  const allRows = withPending(buildBrandRows(project, report, overview, { summary, measured: discoveredMeasured }), pending);
  // The cards count every brand; the list is the header filter's.
  const total = (status: Status) => allRows.filter((row) => row.status === status).length;
  // No answer collected yet (the list's own empty state): nothing could be discovered.
  const noAnswers = !report?.platforms.length && !overview?.rows.length;
  const rows = allRows.filter(
    (row) => row.status === 'rejected' || brandShown(listed, row.key, row.own ? 'own' : row.status === 'tracked' ? 'monitored' : 'discovered'),
  );
  const unmeasured = discoveredMeasured
    ? t('Shown when the analysis of the saved answers finishes.', 'Aparece quando a análise das respostas salvas termina.')
    : t('Discovered brands are counted over every answer: clear the model, topic, tag and text filters to see them.', 'Marcas descobertas são contadas sobre todas as respostas: limpe os filtros de modelo, tema, tag e texto para vê-las.');
  const savedMentions = t(
    'Answers of the last 90 days that mention it, with every model, topic and tag: discovered brands have no count by filter or for this period.',
    'Respostas dos últimos 90 dias que a mencionam, com todos os modelos, temas e tags: marcas descobertas não têm contagem por filtro nem para este período.',
  );
  // A brand monitored from this list stays in it, now marked Monitored, until the list is left.
  const stays = (row: Row) => stayed.view === view && stayed.keys.includes(row.key);
  const wanted = view === 'general' ? (row: Row) => row.status !== 'rejected' : (row: Row) => row.status === view || stays(row);
  const needle = search.trim().toLowerCase();
  const visible = rows.filter(
    (row) => wanted(row) && (!needle || `${row.name} ${row.aliases.join(' ')} ${row.domain}`.toLowerCase().includes(needle)),
  );
  const brandSort = {
    ...BRAND_SORT,
    sentiment: (row: Row) => {
      if (row.status !== 'tracked' || !research.data) return null;
      const reading = research.data.brands.find((item) => item.brand === row.name);
      return reading && reading.assessed > 0 ? sentimentScore(reading) : null;
    },
  };
  const interactive = !!overview;
  /** Confirming, renaming, domains and merges write to the project; the demo only rejects and reopens, in the visitor's session. */
  const editable = interactive && !demo;
  const page = useSortedPage(visible, brandSort, `${project.id}|${view}|${search}`, 25, t, t('Brands', 'Marcas'));
  const current = allRows.find((row) => row.key === selected) ?? null;
  // The list carries run ids only; the excerpts of the brand whose panel is open are read on their own.
  const evidenceKey = current?.evidence.some((item) => !item.excerpt) ? current.key : null;
  const evidenceRead = useReport<{ evidence: Row['evidence'] }>(evidenceKey ? `${url}?evidence=${encodeURIComponent(evidenceKey)}` : null, refresh, request);
  const currentEvidence = evidenceKey ? (evidenceRead.data?.evidence ?? []) : (current?.evidence ?? []);
  const base = `/api/projects/${encodeURIComponent(project.id)}/brands`;
  const statusLabel = (status: Status) =>
    status === 'tracked' ? t('Monitored', 'Monitorada') : status === 'discovered' ? t('Discovered', 'Descoberta') : t('Rejected', 'Rejeitada');

  const showDecisionToast = (
    title: string,
    eventId: string | null | Promise<string | null>,
    undoKey: string | null = null,
    undoLabel = t('Undo', 'Desfazer'),
    redo: Record<string, unknown> | null = null,
  ) => {
    const canUndo = eventId !== null || redo !== null;
    const id = toast.add({
      title,
      type: 'success',
      timeout: 8_000,
      ...(canUndo
        ? {
            actionProps: {
              children: undoLabel,
              onClick: () => {
                toast.close(id);
                void (async () => {
                  if (redo) {
                    void decide(redo, null, false, true);
                    return;
                  }
                  const resolved = await eventId;
                  if (!resolved) return;
                  void decide(
                    { action: 'undo', eventId: resolved, ...(undoKey ? { key: undoKey } : {}) },
                    null,
                  );
                })();
              },
            },
          }
        : {}),
    });
    return id;
  };
  async function decide(
    body: Record<string, unknown>,
    message: string | null,
    close = false,
    optimistic = true,
    redo?: Record<string, unknown>,
  ) {
    const action = body.action as string;
    const key =
      typeof body.key === 'string'
        ? body.key
        : typeof body.name === 'string'
          ? brandKey(body.name)
          : '';
    const previous = key ? pending[key] : undefined;
    const undoable =
      action === 'reject' ||
      action === 'confirm' ||
      action === 'alias' ||
      action === 'rename' ||
      action === 'domain';
    // Reject/confirm toast at click time; Undo resolves when POST returns the event id.
    const instantToast =
      optimistic && !!message && (action === 'reject' || action === 'confirm');
    let settleEvent: ((id: string | null) => void) | undefined;
    let toastId: string | undefined;
    if (instantToast && message) {
      const eventReady = new Promise<string | null>((resolve) => {
        settleEvent = resolve;
      });
      toastId = showDecisionToast(message, eventReady, key || null);
      message = null;
    }
    clearError();
    if (optimistic && key && (action === 'reject' || action === 'confirm' || action === 'undo')) {
      if (action === 'reject') {
        // Remember the status before the X so Undo puts a monitored brand back as monitored.
        const row = allRows.find((item) => item.key === key);
        const was = row?.status;
        setPending((current) => ({
          ...current,
          [key]: {
            status: 'rejected',
            sense: typeof body.sense === 'string' ? body.sense : '',
            rejectEventId: null,
            was,
            row,
          },
        }));
      } else if (action === 'confirm') {
        // The row as it was: the fresh list drops it (a monitored brand is not a discovery) before the project read adds it.
        const row = allRows.find((item) => item.key === key);
        setPending((current) => ({ ...current, [key]: { status: 'tracked', was: row?.status, row } }));
      } else if (action === 'undo') {
        setPending((current) => ({
          ...current,
          [key]: { status: current[key]?.was ?? 'discovered', rejectEventId: null, row: current[key]?.row },
        }));
      }
      if (close) setSelected(null);
    }
    setWorking(true);
    try {
      const result = await request<{ id: string; changed?: boolean }>(base, 'POST', body);
      settleEvent?.(result.id);
      // The project and reports are read again in the background: the other rows stay usable meanwhile. The overlay of an
      // undone monitored brand is dropped only after that, so it never blinks out.
      if (!result.changed) onDecided?.();
      const refreshed = result.changed ? onTargetsChanged?.().catch(() => undefined) : undefined;
      if (action === 'reject' && key) {
        setPending((current) => ({
          ...current,
          [key]: {
            ...current[key],
            status: 'rejected',
            sense: typeof body.sense === 'string' ? body.sense : '',
            rejectEventId: result.id,
          },
        }));
      } else if (action === 'undo' && key) {
        void Promise.resolve(refreshed).then(() =>
          setPending((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          }),
        );
      }
      setPoll((value) => value + 1);
      if (message) {
        if (redo) showDecisionToast(message, null, null, t('Undo', 'Desfazer'), redo);
        else showDecisionToast(message, undoable ? result.id : null, undoable ? key || null : null);
      }
      return true;
    } catch (cause) {
      settleEvent?.(null);
      if (toastId) toast.close(toastId);
      if (key) {
        setPending((current) => {
          const next = { ...current };
          if (previous) next[key] = previous;
          else delete next[key];
          return next;
        });
      }
      const text = cause instanceof Error ? cause.message : String(cause);
      toast.add({ title: text, type: 'error' });
      return false;
    } finally {
      setWorking(false);
    }
  }
  const subject = (row: Row) => ({
    name: row.name,
    key: row.key,
    domain: row.domain || undefined,
    responses: row.answers,
    evidence: row.evidence.map((item) => item.runId),
    // The names the row is also counted as: a confirmed brand keeps counting them.
    aliases: row.aliases,
  });
  const reopen = (row: Row, close = false) =>
    void decide(
      { action: 'undo', eventId: row.rejectEventId, key: row.key },
      `${row.name}, ${t('Reopened', 'Reaberta')}`,
      close,
      true,
      { action: 'reject', ...subject(row), sense: row.sense ?? '' },
    );
  // The monitored brand a discovery may be, while it is still a merge destination (it was not removed since).
  const sameAsOf = (row: Row) => (row.sameAs ? allRows.find((item) => item.status === 'tracked' && !item.own && item.key === brandKey(row.sameAs!)) ?? null : null);
  const inspect = (row: Row) => {
    setSelected(row.key);
    setDomain(row.domain);
    setName(row.name);
    // Merge opens on the monitored brand it may be; the person still confirms.
    setMergeInto(sameAsOf(row)?.key ?? '');
    setSense('');
    clearError();
  };
  const monitor = (row: Row) => {
    // At the limit the server refuses: say why up front instead of showing it monitored and taking it back.
    const limit = overview?.maxCompetitors;
    const saved = new Set(project.competitors.map((target) => brandKey(target.name)));
    const monitoredNow = project.competitors.length + Object.entries(pending).filter(([key, item]) => item.status === 'tracked' && !saved.has(key)).length;
    if (limit && monitoredNow >= limit) {
      toast.add({
        title: t(
          `You already monitor ${limit} competitors. Stop monitoring one to add ${row.name}.`,
          `Você já monitora ${limit} concorrentes. Deixe de monitorar um para adicionar ${row.name}.`,
        ),
        type: 'info',
      });
      return;
    }
    if (!row.domain) {
      inspect(row);
      toast.add({
        title: t('Enter the domain to confirm this brand.', 'Informe o domínio para confirmar esta marca.'),
        type: 'info',
      });
      return;
    }
    setStayed((current) => ({ view, keys: current.view === view ? [...current.keys, row.key] : [row.key] }));
    void decide(
      { action: 'confirm', ...subject(row) },
      `${row.name}, ${t('Confirmed and now monitored', 'Confirmada e agora monitorada')}`,
    );
  };
  const askConfirm = (action: ConfirmAction) => {
    confirmIntent.current = action;
    setConfirm(action);
  };
  const runConfirm = () => {
    const action = confirm ?? confirmIntent.current;
    confirmIntent.current = null;
    setConfirm(null);
    if (!action) return;
    if (action.kind === 'reject') {
      void decide(
        { action: 'reject', ...subject(action.row), sense: action.sense ?? '' },
        `${action.row.name}, ${t('Rejected', 'Rejeitada')}`,
        action.close,
      );
      return;
    }
    void decide(
      { action: 'alias', ...subject(action.row), into: action.intoName, intoKey: action.intoKey },
      t(`${action.row.name} merged into ${action.intoName} as an alias`, `${action.row.name} unida a ${action.intoName} como apelido`),
      true,
      false,
    );
  };
  const validDomain = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain.trim().replace(/^https?:\/\//i, '').split('/')[0]);
  const mergeTargets = aliasTargets(rows, current);

  // Drill down: a brand's figures open the responses that name it (a discovered brand by its key, which the stored
  // discoveries of each answer carry).
  const answersOf = (row: Row): DrillTarget => ({ tab: 'responses', brand: row.status === 'tracked' ? (row.own ? null : row.name) : row.key, brandLabel: row.status === 'tracked' ? null : row.name, sentiment: null, mention: 'mentioned', cites: null, run: null });
  const allColumns = [
      { key: 'rank', width: 48, header: '#', align: 'center' as const, mobile: 'hide' as const, cell: (_: Row, index: number) => <span className="text-muted-foreground">{page.offset + index + 1}</span> },
      {
        key: 'brand',
        sortValue: BRAND_SORT.brand,
        header: t('Brand', 'Marca'),
        mobile: 'title' as const,
        // Gives up width first so the table fits the pane instead of scrolling sideways, down to 15rem: the name keeps room for a
        // short brand beside its Monitor button in a tablet-wide pane (Ask Lastfind docked), never cut to a stub.
        width: '28rem',
        shrinkTo: '15rem',
        cell: (row: Row) => {
          const domainText = row.domain
            ? row.domainSuggested
              ? `${row.domain} (${t('suggested', 'sugerido')})`
              : row.domain
            : t('Domain not confirmed', 'Domínio não confirmado');
          // The name truncates before any badge does: its balloon says it whole, with the domain.
          const nameTip = `${row.name}, ${domainText}`;
          // A discovery that may be a monitored brand (one name holds the other's): "Same brand?" in place of its status, whole; the merge
          // with that brand, and Review domain when it needs one, go to the row's menu.
          const hinted = editable && row.status === 'discovered' && !!sameAsOf(row);
          return (
            // Clipped sideways only: Review domain's touch target and focus ring reach past the line.
            <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-clip">
              <SiteFavicon
                className="shrink-0"
                domain={row.domain}
                name={row.name}
                title={row.domainSuggested ? t('Suggested domain, not confirmed', 'Domínio sugerido, não confirmado') : undefined}
              />
              {hasPage(row) ? (
                <DrillLink
                  link={link}
                  to={{ brandPage: row.key }}
                  className="min-w-0 max-w-full shrink truncate text-left text-body"
                  title={nameTip}
                  aria-label={`${t('Brand page', 'Página da marca')} ${row.name}`}
                >
                  {row.name}
                </DrillLink>
              ) : row.own || !editable ? (
                <Hint text={nameTip}><span className="min-w-0 shrink truncate">{row.name}</span></Hint>
              ) : (
                <Hint text={nameTip}>
                <button
                  type="button"
                  className="min-w-0 max-w-full shrink truncate text-left text-body"
                  onClick={() => inspect(row)}
                >
                  {row.name}
                </button>
                </Hint>
              )}
              {/* Badges take only the room the name and the action leave (no basis of their own), each one whole: one that does
                  not fit wraps to a hidden line instead of being cut mid-word (the empty first item holds the visible line, so even
                  the first badge wraps). So the name is never cut to a stub for a badge that would not show anyway. */}
              <span className="flex h-lh min-w-0 grow basis-0 flex-wrap items-center gap-x-1 overflow-hidden sm:gap-x-2">
                <span aria-hidden="true" className="-me-1 h-lh w-0 sm:-me-2" />
                {row.own && <TagBadge className="shrink-0 whitespace-nowrap" tone="primary">{t('You', 'Você')}</TagBadge>}
                {!row.own && !hinted && (
                  <TagBadge
                    className="shrink-0 whitespace-nowrap"
                    tone={row.status === 'tracked' ? 'primary' : row.status === 'rejected' ? 'danger' : 'neutral'}
                  >
                    {statusLabel(row.status)}
                  </TagBadge>
                )}
                {!row.domainReview && row.review && (
                  <TagBadge className="shrink-0 whitespace-nowrap" tone="quiet" title={row.reasons.join(', ') || undefined}>
                    {t('To review', 'A revisar')}
                  </TagBadge>
                )}
                {row.role !== 'competitor' && (
                  <TagBadge className="shrink-0 whitespace-nowrap" tone="quiet" title={row.reasons.join(', ') || undefined}>
                    {t(...ROLE_LABELS[row.role])}
                  </TagBadge>
                )}
              </span>
              {hinted && (
                <TagBadge className="shrink-0 whitespace-nowrap" tone="quiet" title={t(`Discovered. May be the same brand as ${row.sameAs}: merge it from the row's menu, or keep it apart.`, `Descoberta. Pode ser a mesma marca que ${row.sameAs}: mescle pelo menu da linha, ou mantenha separada.`)}>
                  {t('Same brand?', 'Mesma marca?')}
                </TagBadge>
              )}
              {row.domainReview && !hinted && (
                // The domain is what needs the person: one click opens where it is confirmed or corrected. Outside the badges
                // that give up room, so it is never cut, with a 40 px touch target that leaves the row's height alone (the margin
                // keeps its focus ring inside the cell).
                <TagBadge
                  className="me-1 shrink-0 whitespace-nowrap"
                  tone="warning"
                  title={row.domain ? t('We are not sure about this domain', 'Não temos certeza deste domínio') : t('Choose the official domain', 'Escolha o domínio oficial')}
                  touch={editable}
                  render={editable ? <button type="button" aria-label={`${t('Review domain', 'Revisar domínio')} ${row.name}`} onClick={() => inspect(row)} /> : undefined}
                >
                  {t('Review domain', 'Revisar domínio')}
                </TagBadge>
              )}
              {row.status === 'discovered' && editable && (
                // The shortest way to monitor a discovery: a white compact button with a check at the cell's end, shown on the row's
                // hover or focus (touch screens always), in its own room.
                <Button
                  size="xs"
                  variant="outline"
                  reveal="row"
                  className="ms-auto me-1 shrink-0"
                  disabled={busy || row.key in pending}
                  aria-label={`${t('Monitor', 'Monitorar')} ${row.name}`}
                  onClick={() => monitor(row)}
                >
                  {t('Monitor', 'Monitorar')}
                </Button>
              )}
            </div>
          );
        },
      },
      {
        key: 'sentiment',
        header: t('Sentiment', 'Sentimento'),
        info: sentimentIndexDefinition(t),
        label: t('Sentiment', 'Sentimento'),
        sortValue: (row: Row) => {
          if (row.status !== 'tracked' || !research.data) return null;
          const reading = research.data.brands.find((item) => item.brand === row.name);
          return reading && reading.assessed > 0 ? sentimentScore(reading) : null;
        },
        cell: (row: Row) => {
          // Sentiment still on its way: a line of skeleton where the score goes, the row already at its loaded height (a status or the
          // Monitor action would take another line, then give it back: the page jumped on a phone).
          if (research.loading && row.status !== 'rejected' && hasPage(row))
            return <span aria-busy="true"><span className="sr-only">{t('Loading…', 'Carregando…')}</span><Skeleton inline className="h-lh w-20 max-w-full align-top" /></span>;
          const status = sentimentStatus(row);
          // A discovery without a score offers the way to measure it: monitoring (share of voice and sentiment are measured
          // among monitored brands). Only this row waits for its own decision.
          if (status && row.status === 'discovered' && editable && !row.own)
            return (
              <Button
                size="xs"
                variant="quiet"
                disabled={busy || row.key in pending}
                aria-label={`${t('Monitor brand', 'Monitorar marca')} ${row.name}`}
                onClick={() => monitor(row)}
              >
                {t('Monitor to measure', 'Monitorar para medir')}
              </Button>
            );
          if (status) return <span className="text-muted-foreground" aria-busy={research.loading || undefined}>{status}</span>;
          const reading = research.data!.brands.find((item) => item.brand === row.name)!;
          const score = sentimentScore(reading);
          const summary = sentimentShares(reading.distribution, reading.assessed, locale, t);
          return (
            <button
              type="button"
              className="flex items-center gap-2 text-left hover:text-primary"
              aria-label={`${row.name}: ${t('sentiment', 'sentimento')} ${score}. ${summary}. ${t('Show answer evidence', 'Ver evidências das respostas')}`}
              aria-expanded={sentimentBrand === row.name}
              aria-controls="brand-sentiment-evidence"
              onClick={() => setSelection({ scope, brand: row.name })}
            >
              <span className="tabular-nums">{number(score!)}</span>
              <SentimentBar distribution={reading.distribution} assessed={reading.assessed} locale={locale} t={t} />
            </button>
          );
        },
      },
      {
        key: 'visibility',
        sortValue: BRAND_SORT.visibility,
        header: t('Visibility', 'Visibilidade'),
        info: t('Share of answers mentioning each brand. Summary is blank because the same answer can mention several brands.', 'Parcela das respostas que mencionam cada marca. O Resumo fica vazio porque a mesma resposta pode mencionar várias marcas.') + changeNote,
        label: t('Visibility', 'Visibilidade'),
        align: 'end' as const,
        cell: (row: Row) =>
          row.visibility != null ? (
            <WithChange change={row.previous ? <Change value={row.visibility - row.previous.visibility} locale={locale} margin={0} /> : null}><DrillLink link={link} to={answersOf(row)}>{percent(row.visibility)}</DrillLink></WithChange>
          ) : (
            <Hint
              text={
                row.status === 'tracked'
                  ? undefined
                  : unmeasured
              }
            >
              <span>—</span>
            </Hint>
          ),
      },
      {
        key: 'sov',
        sortValue: BRAND_SORT.sov,
        header: t('Share of voice', 'Share of voice'),
        info: t('Share of the mentions of every identified competitor, monitored and discovered. Rejected brands, names the model did not settle as competitors and names still in review do not count, and show no share. Counted over the answers the brand analysis read (the 10,000 most recent of the last 90 days); a newer one counts once it is read.', 'Parcela das menções de todos os concorrentes identificados, monitorados e descobertos. Marcas rejeitadas, nomes que o modelo não confirmou como concorrentes e nomes ainda em revisão não contam e ficam sem share. Contado sobre as respostas que a análise de marcas leu (as 10.000 mais recentes dos últimos 90 dias); uma mais nova conta depois de lida.') + changeNote,
        label: t('Share of voice', 'Share of voice'),
        align: 'end' as const,
        cell: (row: Row) =>
          row.shareOfVoice == null ? '—' : (
            // Shares are compared only while the monitored brands are the same in both periods.
            <WithChange change={row.previous?.shareOfVoice != null && summary?.comparison.comparable ? <Change value={row.shareOfVoice - row.previous.shareOfVoice} locale={locale} margin={0} /> : null}><DrillLink link={link} to={answersOf(row)}>{percent(row.shareOfVoice)}</DrillLink></WithChange>
          ),
      },
      {
        key: 'mentions',
        sortValue: BRAND_SORT.mentions,
        header: t('Mentions', 'Menções'),
        info: t(
          'Summary adds the mentions of the brands share of voice counts (monitored and discovered competitors) in the filtered list, across every page. Rejected brands and names still in review are left out. Discoveries: found in the answers of the last 90 days and counted in the selected period, with no model, topic, tag or text filter (with one, their mentions are those of the last 90 days, in gray); share of voice once confirmed.',
          'O Resumo soma as menções das marcas que entram no share of voice (monitoradas e concorrentes descobertas) na lista filtrada, em todas as páginas. Marcas rejeitadas e nomes ainda em revisão ficam fora da soma. Descobertas: encontradas nas respostas dos últimos 90 dias e contadas no período do filtro, sem filtro de modelo, tema, tag ou texto (com filtro, as menções são as dos últimos 90 dias, em cinza); share of voice depois de confirmadas.',
        ),
        label: t('Mentions', 'Menções'),
        align: 'end' as const,
        cell: (row: Row) =>
          row.mentions == null ? (
            row.status === 'tracked' ? '—' : <Hint text={unmeasured}><span>—</span></Hint>
          ) : !row.mentionsSaved ? (
            <DrillLink link={link} to={answersOf(row)}>{number(row.mentions)}</DrillLink>
          ) : (
            <Hint text={savedMentions}>
            <span className="text-muted-foreground">
              {number(row.mentions)}
              <span className="sr-only">, {savedMentions}</span>
            </span>
            </Hint>
          ),
      },
      {
        // Menu only (Monitor lives in the brand column): the last column stays one icon wide.
        key: 'actions',
        width: 48,
        header: <span className="sr-only">{t('Actions', 'Ações')}</span>,
        mobile: 'actions' as const,
        align: 'end' as const,
        cell: (row: Row) => {
          if (row.own || !interactive) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={working || busy}
                    aria-label={`${t('Actions', 'Ações')} ${row.name}`}
                  />
                }
              >
                <EllipsisVertical size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {editable && (
                  <DropdownMenuItem onClick={() => inspect(row)}>
                    <Eye size={14} />
                    {t('Edit', 'Editar')}
                  </DropdownMenuItem>
                )}
                {editable && row.status === 'discovered' && sameAsOf(row) && (
                  <DropdownMenuItem onClick={() => {
                    const target = sameAsOf(row)!;
                    askConfirm({ kind: 'merge', row, into: target.name, intoKey: target.key, intoName: target.name });
                  }}>
                    <Merge size={14} />
                    {t(`Merge with ${row.sameAs}?`, `Mesclar com ${row.sameAs}?`)}
                  </DropdownMenuItem>
                )}
                {editable && row.status === 'discovered' && sameAsOf(row) && row.domainReview && (
                  // Its badge gave way to "Same brand?": the domain is reviewed from here.
                  <DropdownMenuItem onClick={() => inspect(row)}>
                    <ScanSearch size={14} />
                    {t('Review domain', 'Revisar domínio')}
                  </DropdownMenuItem>
                )}
                {editable && row.status !== 'rejected' && (
                  <DropdownMenuItem onClick={() => inspect(row)}>
                    <Merge size={14} />
                    {t('Merge', 'Mesclar')}
                  </DropdownMenuItem>
                )}
                {row.status === 'rejected' && row.rejectEventId && (
                  <DropdownMenuItem
                    disabled={working || busy}
                    onClick={() => reopen(row)}
                  >
                    <RotateCcw size={14} />
                    {t('Reopen', 'Reabrir')}
                  </DropdownMenuItem>
                )}
                {row.status !== 'rejected' && (editable || row.status === 'discovered') && (
                  <DropdownMenuItem
                    disabled={working || busy}
                    aria-label={`${t('Reject', 'Rejeitar')} ${row.name}`}
                    onClick={() => askConfirm({ kind: 'reject', row })}
                  >
                    <X size={14} />
                    {t('Reject', 'Rejeitar')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
  ];
  const columns = visibleColumns(allColumns, columnsPref.hidden, ['brand', 'actions']);
  const brandTable = (rows: Row[], extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) => (
    <DataTable compact fill singleLine stackColumns={3} rows={rows} rowKey={(row) => row.key} sort={page.sort} onSortChange={page.onSortChange} columns={columns} {...extra} />
  );

  let body: ReactNode;
  if (loading || (url && remote.loading && !overview)) {
    body = brandTable([], { loading: true, ariaLabel: t('Loading brands…', 'Carregando marcas…') });
  } else if (url && remote.error && !overview) {
    body = (
      <EmptyState
        tone="error"
        title={t('We could not load the brands.', 'Não foi possível carregar as marcas.')}
        description={t('Your answers and decisions are safe.', 'Suas respostas e decisões estão preservadas.')}
        onRetry={() => setPoll((value) => value + 1)}
      />
    );
  } else if (running && !search && (!visible.length || (!report?.platforms.length && !overview?.rows.length))) {
    // Only where an empty state would otherwise stand.
    body = updating;
  } else if (!report?.platforms.length && !overview?.rows.length) {
    body = <EmptyState title={t('No collected answers yet.', 'Ainda não há respostas coletadas.')} description={t('Brands appear after answers are collected.', 'As marcas aparecem depois que as respostas são coletadas.')} />;
  } else if (!visible.length) {
    body = (
      <EmptyState
        title={t('No brands in this list', 'Nenhuma marca nesta lista')}
        description={
          search
            ? t('Try another search.', 'Tente outra busca.')
            : view === 'discovered'
              ? t('No new brand stood out in the analyzed answers. Rejected brands are in their own list.', 'Nenhuma marca nova se destacou nas respostas analisadas. As rejeitadas ficam na própria lista.')
              : view === 'rejected'
                ? t('Rejecting a brand removes it from the reports and keeps the decision here, where you can reopen it.', 'Rejeitar uma marca a remove dos relatórios e guarda a decisão aqui, onde você pode reabri-la.')
                : t('Try another list.', 'Tente outra lista.')
        }
      />
    );
  } else {
    const totals = brandSummary(visible);
    body = brandTable(page.rows, {
        summary: {
          brand: `${t('Summary', 'Resumo')} (${number(visible.length)})`,
          mentions: totals.mentions == null ? null : number(totals.mentions),
        },
        summaryAside: <SummaryPager page={page} total={visible.length} t={t} />,
      });
  }

  const ownRow = report?.platforms.find((row) => row.name === project.name);
  const sovAvailable = Boolean(summary?.availability.shareOfVoice.current) || ownRow?.shareOfVoice != null;
  const positionAvailable = Boolean(summary?.availability.mentionPosition.current);
  const positionPending = !summary && summaryLoading;
  const sovComparable = !!summary && summaryComparable(summary, 'shareOfVoice');
  const positionComparable = !!summary && summaryComparable(summary, 'mentionPosition');
  // Why a card shows no change goes in its info balloon (rule 8), as on the Overview.
  const why = (comparable: boolean) => (summary && !comparable && !comparison.off ? ` ${noComparisonNote(summary, locale, t, comparison.period)}` : '');
  // Until the report answers, the share-of-voice card keeps its slot (most projects have one).
  const sovPending = !report && !sovAvailable;
  const metricCount = 2 + (sovAvailable || sovPending ? 1 : 0) + (positionAvailable || positionPending ? 1 : 0);
  const pickerColumns = [
    { key: 'rank', label: '#' },
    { key: 'brand', label: t('Brand', 'Marca') },
    { key: 'sentiment', label: t('Sentiment', 'Sentimento') },
    { key: 'visibility', label: t('Visibility', 'Visibilidade') },
    { key: 'sov', label: t('Share of voice', 'Share of voice') },
    { key: 'mentions', label: t('Mentions', 'Menções') },
  ];

  const open = pageKey ? allRows.find((row) => row.key === pageKey && row.status !== 'rejected') ?? null : null;
  useEffect(() => {
    onPageTitle?.(pageKey ? open?.name ?? null : null);
  }, [pageKey, open?.name, onPageTitle]);
  // A discovered brand's answer evidence comes only in a read that names it: its page, or its sentiment evidence here.
  const evidenceBrand = demo ? null : open ? (open.status === 'tracked' ? null : open.name)
    : sentimentBrand && research.data?.brands.find((item) => item.brand === sentimentBrand)?.discovered ? sentimentBrand : null;
  const evidenceUrl = evidenceBrand ? `${researchUrl}&evidenceBrand=${encodeURIComponent(evidenceBrand)}` : null;
  const brandEvidence = useKeptReport<BrandResearchReport>(evidenceUrl, evidenceUrl && `lastfind:brand-research:${evidenceUrl}`, refresh, request);
  // Its aggregate is the list's meanwhile; its evidence waits for its read.
  const brandResearch = evidenceUrl ? { ...brandEvidence, data: brandEvidence.data ?? research.data } : research;
  // Why the sentiment column has no score, said once under the table; nothing when the scores are there.
  const sentimentNote = research.error ? (
    <p role="alert">{t('Could not load sentiment. Reopen Brands to try again.', 'Não foi possível carregar o sentimento. Reabra Marcas para tentar novamente.')}</p>
  ) : research.data && !research.loading ? (
    !research.data.configuration?.enabled ? (
      <p>{t('Evaluation is off. Enable it in Settings > Competitors. Saved scores remain visible.', 'A avaliação está desligada. Ative em Configurações > Concorrentes. Notas salvas continuam visíveis.')}</p>
    ) : !demo && !scored && !research.data.configured ? (
      <p>{operator ? t('The evaluator is not configured on this server.', 'O avaliador não está configurado neste servidor.') : t('Not evaluated yet.', 'Ainda não avaliado.')}</p>
    ) : !demo && !scored && !research.data.allowed ? (
      <p>{t('Evaluation is not enabled for this project.', 'A avaliação não está habilitada para este projeto.')}</p>
    ) : !research.data.selectedChannels ? (
      <p>{t('No responses in this period.', 'Sem respostas neste período.')}</p>
    ) : research.data.truncated ? (
      <p>{t('Partial report: narrow the global filters.', 'Relatório parcial: restrinja os filtros globais.')}</p>
    ) : null
  ) : null;
  const evidenceOpen = !!sentimentBrand && !!research.data && !research.loading && !research.error;
  if (pageKey && !open && (loading || (url && remote.loading && !overview)))
    return <BrandPageSkeleton />;
  // A brand's identity, decisions and evidence take the whole main content, with the way back to where it opened.
  const brandEditor = current && (
    <DetailPage>
      <DetailHeader
        leading={
          <>
            <SidebarTrigger className="md:hidden" aria-label={t('Toggle navigation', 'Alternar navegação')} />
            <Hint text={t('Back', 'Voltar')}>
              <Button variant="ghost" size="icon" aria-label={t('Back', 'Voltar')} onClick={() => setSelected(null)}>
                <ArrowLeft />
              </Button>
            </Hint>
          </>
        }
        title={<h1>{current.name}</h1>}
        meta={t('Identity, decisions and answer evidence', 'Identidade, decisões e evidências das respostas')}
      />
      <DetailBody>
            <div className="space-y-6">
              {error && <Alert variant="destructive">{error}</Alert>}
              <section className="space-y-3">
                <h3 className="text-section">{t('Identity', 'Identidade')}</h3>
                <label className="block space-y-2 text-body">
                  <span>{t('Displayed name', 'Nome exibido')}</span>
                  <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </label>
                <Button
                  variant="outline"
                  disabled={working || busy || name.trim().length < 2 || name.trim() === current.name}
                  onClick={() => void decide({ action: 'rename', ...subject(current), displayName: name.trim() }, `${t('Renamed to', 'Renomeada para')} ${name.trim()}`)}
                >
                  {t('Save name', 'Salvar nome')}
                </Button>
                <label className="block space-y-2 text-body">
                  <span>{t('Official domain', 'Domínio oficial')}</span>
                  <Input value={domain} placeholder="example.com" onChange={(event) => setDomain(event.target.value)} />
                </label>
                {current.domainSource && current.status !== 'tracked' && (
                  <p className="text-caption text-muted-foreground" data-testid="brand-domain-origin">
                    {{
                      user: t('Confirmed by you', 'Confirmado por você'),
                      answers: t('From the answers', 'Das respostas'),
                      search: t('From a Google search', 'Da busca no Google'),
                      site: t('The brand’s name as a .com', 'O nome da marca como .com'),
                    }[current.domainSource]}
                    {current.domainConfidence &&
                      `, ${current.domainConfidence === 'high' ? t('high confidence', 'alta confiança') : t('low confidence', 'baixa confiança')}`}
                  </p>
                )}
                {current.domainSite && current.status !== 'tracked' && (
                  <p className="text-caption text-muted-foreground" data-testid="brand-domain-site">
                    {{
                      confirmed: t('Site checked: its home page names this brand.', 'Site conferido: a página inicial cita esta marca.'),
                      unconfirmed: t('Site checked: its home page does not name this brand.', 'Site conferido: a página inicial não cita esta marca.'),
                      unreachable: t('The site did not answer when we checked it.', 'O site não respondeu quando conferimos.'),
                    }[current.domainSite]}
                  </p>
                )}
                {current.domainSuggested && !current.domainReview && (
                  <p className="text-caption text-muted-foreground">{t('This domain was suggested automatically. Confirm it or correct it.', 'Este domínio foi sugerido automaticamente. Confirme ou corrija.')}</p>
                )}
                {current.domainReview && (
                  <p className="text-caption text-muted-foreground" data-testid="brand-domain-review">
                    {current.domain
                      ? t('We are not sure about this domain. Confirm it or correct it.', 'Não temos certeza deste domínio. Confirme ou corrija.')
                      : current.domainCandidates.length > 0
                        ? t('We could not find this brand’s official domain with enough certainty. Enter it, or pick one of the candidates.', 'Não encontramos o domínio oficial desta marca com certeza suficiente. Informe-o ou escolha um dos candidatos.')
                        : t('We could not find this brand’s official domain with enough certainty. Enter it.', 'Não encontramos o domínio oficial desta marca com certeza suficiente. Informe-o.')}
                  </p>
                )}
                {current.domainCandidates.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption text-muted-foreground">{t('Other candidates', 'Outros candidatos')}:</span>
                    {current.domainCandidates.map((candidate) => (
                      <Button key={candidate} type="button" variant="outline" onClick={() => setDomain(candidate)}>
                        {candidate}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={working || busy || !validDomain}
                    onClick={() => void decide({ action: 'domain', ...subject(current), domain: domain.trim() }, `${current.name}, ${t('Domain corrected', 'Domínio corrigido')}`)}
                  >
                    {current.domainSuggested ? t('Confirm domain', 'Confirmar domínio') : t('Correct domain', 'Corrigir domínio')}
                  </Button>
                  {current.status !== 'tracked' && (
                    <Button
                      disabled={working || busy || !validDomain}
                      onClick={() => void decide({ action: 'confirm', ...subject(current), domain: domain.trim() }, `${current.name}, ${t('Confirmed and now monitored', 'Confirmada e agora monitorada')}`, true)}
                    >
                      {t('Confirm and monitor', 'Confirmar e monitorar')}
                    </Button>
                  )}
                </div>
                {current.aliases.length > 0 && (
                  <p className="text-body text-muted-foreground">
                    {t('Also counted as', 'Também contada como')}: {current.aliases.join(', ')}
                  </p>
                )}
              </section>
              <section className="space-y-3">
                <h3 className="text-section">{t('Merge as an alias', 'Juntar como apelido')}</h3>
                {current.status === 'discovered' && sameAsOf(current) && (
                  <p className="text-body text-muted-foreground" data-testid="brand-same-as">
                    {t(`May be the same brand as ${current.sameAs}: one name holds the other's.`, `Pode ser a mesma marca que ${current.sameAs}: um nome contém o outro.`)}
                  </p>
                )}
                <p className="text-body text-muted-foreground">
                  {t(
                    'Choose the main brand. Answers mentioning both count once. Undo restores both.',
                    'Escolha a marca principal. Respostas que mencionam as duas contam uma vez. Desfazer restaura as duas.',
                  )}
                </p>
                <SelectField
                  aria-label={t('Main brand', 'Marca principal')}
                  value={mergeInto}
                  onValueChange={setMergeInto}
                  options={[{ value: '', label: t('Choose a brand', 'Escolha uma marca') }, ...mergeTargets.map((row) => ({ value: row.key, label: row.name }))]}
                />
                <Button
                  disabled={working || busy || !mergeInto}
                  onClick={() => {
                    const target = allRows.find((row) => row.key === mergeInto);
                    if (target)
                      askConfirm({
                        kind: 'merge',
                        row: current,
                        into: target.name,
                        intoKey: target.key,
                        intoName: target.name,
                      });
                  }}
                >
                  {t('Merge alias', 'Juntar apelido')}
                </Button>
              </section>
              {current.status !== 'rejected' ? (
                <section className="space-y-3">
                  <h3 className="text-section">{t('Not a competitor', 'Não é um concorrente')}</h3>
                  <label className="block space-y-2 text-body">
                    <span>{t('Context (optional)', 'Contexto (opcional)')}</span>
                    <Input
                      value={sense}
                      maxLength={200}
                      placeholder={t('e.g. a different meaning of the name', 'ex.: outro sentido do nome')}
                      onChange={(event) => setSense(event.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    disabled={working || busy}
                    onClick={() => askConfirm({ kind: 'reject', row: current, sense, close: true })}
                  >
                    {t('Reject from reports', 'Rejeitar nos relatórios')}
                  </Button>
                </section>
              ) : (
                <section className="space-y-3">
                  <h3 className="text-section">{t('Rejected', 'Rejeitada')}</h3>
                  {current.sense ? (
                    <p className="text-body text-muted-foreground">
                      {t('Rejected as', 'Rejeitada como')} “{current.sense}”
                    </p>
                  ) : null}
                  {current.rejectEventId ? (
                    <Button
                      variant="outline"
                      disabled={working || busy}
                      onClick={() => reopen(current, true)}
                    >
                      {t('Reopen', 'Reabrir')}
                    </Button>
                  ) : null}
                </section>
              )}
              <section className="space-y-3">
                <h3 className="text-section">{t('Answer evidence', 'Evidências nas respostas')}</h3>
                {evidenceKey && evidenceRead.loading ? (
                  <p className="text-body text-muted-foreground" aria-busy="true">{t('Loading…', 'Carregando…')}</p>
                ) : currentEvidence.length ? (
                  currentEvidence.map((item) => (
                    <button
                      type="button"
                      key={item.runId}
                      className="grid w-full gap-1 rounded-md border border-border px-3 py-2 text-left text-caption hover:bg-(--table-hover)"
                      onClick={() => {
                        setSelected(null);
                        onEvidence(item.runId);
                      }}
                    >
                      <span className="block text-muted-foreground">{new Date(item.createdAt).toLocaleDateString(locale)}</span>
                      <span>
                        <ExcerptSnippet text={item.excerpt} names={[current.name, ...current.aliases]} />
                      </span>
                    </button>
                  ))
                ) : (
                  <DrillLink link={link} to={answersOf(current)}>
                    {t('Open the answers mentioning this brand', 'Abrir as respostas que mencionam esta marca')}
                  </DrillLink>
                )}
              </section>
            </div>
      </DetailBody>
    </DetailPage>
  );
  return (
    <>
    {brandEditor ? brandEditor : pageKey ? (
      <BrandPage
        row={open}
        project={project}
        api={api}
        filters={filters}
        request={read}
        refresh={refresh}
        t={t}
        link={link}
        demo={demo}
        analyzed={overview?.analysis.analyzed ?? 0}
        research={brandResearch}
        sentimentStatus={open ? sentimentStatus(open) : null}
        metricsLoading={loading}
        editable={editable}
        busy={busy || working}
        onEdit={() => open && inspect(open)}
        onMonitor={() => open && monitor(open)}
        onEvidence={onEvidence}
      />
    ) : (
    <BrandReportTabs value={view}>
    <>
    <DataTableScreen
      className="live-brands-list"
      cards={(
            <MetricGrid
              columns={metricCount}
              mobilePairs
              label={t('Brand metrics', 'Métricas de marcas')}
            >
              <MetricCard
                icon={<Radar size={14} aria-hidden="true" />}
                label={t('Monitored brands', 'Marcas monitoradas')}
                definition={t('Your brand plus competitors you chose to track.', 'Sua marca e os concorrentes que você escolheu acompanhar.')}
                value={number(total('tracked'))}
              />
              <MetricCard
                icon={<ScanSearch size={14} aria-hidden="true" />}
                label={t('Discovered brands', 'Marcas descobertas')}
                definition={t('New names found in analyzed saved answers, not yet monitored.', 'Nomes novos nas respostas salvas analisadas, ainda não monitorados.')}
                // Before any answer there is nothing to discover in: said in words on the card (as the Overview's cards), never 0.
                value={!overview ? <MetricValueSkeleton /> : noAnswers ? <span className="text-body">{t('Awaiting answers', 'Aguardando respostas')}</span> : number(total('discovered'))}
                description={overview && noAnswers ? t('Found in the answers, once they are collected.', 'Aparecem nas respostas, depois que forem coletadas.') : undefined}
              />
              {sovPending ? (
                <MetricCard
                  icon={<MessageSquare size={14} aria-hidden="true" />}
                  label={t('Your share of voice', 'Seu share of voice')}
                  definition={t('Your brand’s mentions ÷ mentions of every identified brand (monitored and discovered). Counted over the answers the brand analysis read (the 10,000 most recent of the last 90 days); a newer one counts once it is read.', 'Menções à sua marca ÷ menções a todas as marcas identificadas (monitoradas e descobertas). Contado sobre as respostas que a análise de marcas leu (as 10.000 mais recentes dos últimos 90 dias); uma mais nova conta depois de lida.')}
                  value={<MetricValueSkeleton />}
                />
              ) : sovAvailable ? (
                <MetricCard
                  icon={<MessageSquare size={14} aria-hidden="true" />}
                  label={t('Your share of voice', 'Seu share of voice')}
                  definition={t('Your brand’s mentions ÷ mentions of every identified brand (monitored and discovered). Counted over the answers the brand analysis read (the 10,000 most recent of the last 90 days); a newer one counts once it is read.', 'Menções à sua marca ÷ menções a todas as marcas identificadas (monitoradas e descobertas). Contado sobre as respostas que a análise de marcas leu (as 10.000 mais recentes dos últimos 90 dias); uma mais nova conta depois de lida.') + why(sovComparable)}
                  value={
                    summary?.availability.shareOfVoice.current
                      ? percent(summary.metrics.shareOfVoice)
                      : percent(ownRow!.shareOfVoice!)
                  }
                  delta={sovComparable ? <Change value={summary!.comparison.delta.shareOfVoice} unit=" pp" locale={locale} /> : undefined}
                />
              ) : null}
              {positionAvailable || positionPending ? (
                <MetricCard
                  icon={<ListOrdered size={14} aria-hidden="true" />}
                  label={t('Average position', 'Posição média')}
                  definition={t(
                    'Average rank of the brand’s first mention among the competitors the answer names, monitored and discovered (1 = named first). Lower is better.',
                    'Posição média da primeira menção à marca entre os concorrentes que a resposta cita, monitorados e descobertos (1 = citada primeiro). Quanto menor, melhor.',
                  ) + why(positionComparable)}
                  value={summary ? number(summary.metrics.mentionPosition, 1) : <MetricValueSkeleton />}
                  delta={positionComparable ? <Change value={summary!.comparison.delta.mentionPosition} locale={locale} invert /> : undefined}
                />
              ) : null}
            </MetricGrid>
          )}
    >
          <DataTableToolbar
            label={t('Brand filters', 'Filtros de marcas')}
            actions={<ColumnPicker label={t('Columns', 'Colunas')} columns={pickerColumns} hidden={columnsPref.hidden} onChange={columnsPref.setHidden} required={['brand']} />}
          >
            <SearchField value={search} onChange={setSearch} placeholder={t('Search brands or aliases', 'Buscar marcas ou apelidos')} />
          </DataTableToolbar>
          {body}
          {/* Under the table only what the moment needs: why sentiment is missing, or the evidence of a clicked score. The legend
              and the coverage notes live in the column headers' (i). */}
          {(sentimentNote || evidenceOpen) && (
            <div className="live-brands-sentiment space-y-4 p-4">
              {sentimentNote && <div className="text-caption text-muted-foreground">{sentimentNote}</div>}
              {evidenceOpen && <section id="brand-sentiment-evidence" className="scroll-mt-24" ref={evidencePanel} tabIndex={-1} aria-label={`${t('Sentiment evidence', 'Evidências de sentimento')}, ${sentimentBrand}`}>
                <SectionCard inset="padded" loading={!demo && brandResearch.loading} title={`${t('Sentiment evidence', 'Evidências de sentimento')}, ${sentimentBrand}`}>
                  {demo ? <p className="text-body text-muted-foreground">{t('The public demo shows only the sentiment aggregate. Private evaluations and answer excerpts are not exposed here.', 'A demo pública mostra somente o agregado de sentimento. Avaliações privadas e trechos das respostas não são expostos aqui.')}</p> :
                    <BrandSentimentAnalysis key={`${scope}:${sentimentBrand}`} evidenceBrand={sentimentBrand!} report={brandResearch.data!} project={project} onEvidence={onEvidence} label={label}
                      link={link} answersOf={(band) => {
                        const row = allRows.find((item) => item.name === sentimentBrand);
                        // The band's answers already mention the brand (the effective mention): no mention filter rides along.
                        return { ...(row ? answersOf(row) : { tab: 'responses', brand: sentimentBrand! }), sentiment: band, mention: 'all' as const };
                      }} />}
                </SectionCard>
              </section>}
            </div>
          )}
    </DataTableScreen>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => { if (!open) { confirmIntent.current = null; setConfirm(null); } }}
        title={confirm?.kind === 'merge' ? t(`Merge with ${confirm.intoName}?`, `Mesclar com ${confirm.intoName}?`) : t('Reject this brand?', 'Rejeitar esta marca?')}
        description={confirm?.kind === 'merge'
          ? t(
              `${confirm.row.name} will become an alias of ${confirm.intoName}. You can undo right after.`,
              `${confirm.row.name} passará a ser um apelido de ${confirm.intoName}. Você pode desfazer logo em seguida.`,
            )
          : t(
              `${confirm?.row.name ?? ''} will leave the reports. You can undo right after.`,
              `${confirm?.row.name ?? ''} sairá dos relatórios. Você pode desfazer logo em seguida.`,
            )}
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={confirm?.kind === 'merge' ? t('Merge', 'Mesclar') : t('Reject', 'Rejeitar')}
        destructive={confirm?.kind === 'reject'}
        onConfirm={runConfirm}
      />
    </>
    </BrandReportTabs>
    )}
    </>
  );
}

/**
 * The Brands screen while the workspace loads (shell.md section 9): the same cards, toolbar and table, with the table's own
 * columns, each in its loading state, so nothing moves when the list arrives.
 */
export function BrandsSkeleton() {
  const l = useCopy();
  const label = l('Loading brands…', 'Carregando marcas…');
  const columns = [
    { key: 'rank', width: 48, header: '#', align: 'center' as const, mobile: 'hide' as const },
    { key: 'brand', header: l('Brand', 'Marca'), mobile: 'title' as const, width: '28rem', shrinkTo: '12rem' },
    { key: 'sentiment', header: l('Sentiment', 'Sentimento') },
    { key: 'visibility', header: l('Visibility', 'Visibilidade'), align: 'end' as const },
    { key: 'sov', header: l('Share of voice', 'Share of voice'), align: 'end' as const },
    { key: 'mentions', header: l('Mentions', 'Menções'), align: 'end' as const },
    { key: 'actions', width: 48, header: <span className="sr-only">{l('Actions', 'Ações')}</span>, mobile: 'actions' as const },
  ].map((column) => ({ ...column, cell: () => null }));
  return (
    <BrandReportTabs value="general">
      <DataTableScreen className="live-brands-list" cards={<MetricGridSkeleton count={4} label={label} />}>
        <DataTableToolbar label={label}>
          <SearchField value="" onChange={() => {}} placeholder={l('Search brands or aliases', 'Buscar marcas ou apelidos')} />
        </DataTableToolbar>
        <DataTable compact fill singleLine loading ariaLabel={label} rows={[]} rowKey={String} columns={columns} />
      </DataTableScreen>
    </BrandReportTabs>
  );
}
