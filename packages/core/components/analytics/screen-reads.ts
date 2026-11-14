import { TOPIC_SEPARATOR } from '../../lib/prompt-filters.ts';
import { BRANDS_DIGEST_MAX } from '../../lib/brand-decisions.ts';

// The reads the analytics screens send, as paths: the screens build them here, and the app page uses the same paths to send
// a screen's first reads along with itself (route-page.tsx), so the browser finds them already under way.

/** The Overview's ranking of discovered brands: the ones shown plus room for the ones rejected before it is read again. */
export const DISCOVERED_SHOWN = 5;

export type ReportFilterState = {
  projectId: string | null;
  days: string;
  startDate?: string;
  endDate?: string;
  /** Chosen comparison dates (both included); without them the reports compare with the period right before. */
  compareStart?: string;
  compareEnd?: string;
  engine?: string;
  /** Topics joined by TOPIC_SEPARATOR; each goes as its own `topic` parameter. */
  topic?: string;
  tags?: string;
  /** The text search of Responses or Sources. */
  query?: string;
  tab: string;
  mention?: string;
  brand?: string;
  /** Responses citing the brand's own domain ('own'), this domain or this page (a URL). */
  cites?: string;
  /** Responses whose reading of the brand is in this sentiment band (positive, neutral, negative). */
  sentiment?: string;
  /** Responses of this prompt (its unit). */
  prompt?: string;
  gap?: boolean;
  source?: {
    kind: string;
    group: string;
    page: number;
    type?: string;
    owner?: string;
    origin: string;
    sort?: { key: string; direction: string };
  };
};

/** The filters every read of a screen carries (the query string of its reports). */
export function reportFilterQuery(state: ReportFilterState) {
  const params = new URLSearchParams({ project: state.projectId || '', days: state.days });
  if (state.startDate && state.endDate) {
    params.set('start', state.startDate);
    params.set('end', state.endDate);
  }
  if (state.compareStart && state.compareEnd) {
    params.set('compareStart', state.compareStart);
    params.set('compareEnd', state.compareEnd);
  }
  if (state.engine !== undefined && state.engine !== 'all') params.set('engine', state.engine);
  for (const topic of state.topic?.split(TOPIC_SEPARATOR).filter(Boolean) ?? []) params.append('topic', topic);
  if (state.tags) params.set('tags', state.tags);
  if (state.query) params.set('query', state.query);
  if (state.tab === 'responses' && state.mention && state.mention !== 'all') params.set('mention', state.mention);
  if (state.tab === 'responses' && state.brand) params.set('brand', state.brand);
  if (state.tab === 'responses' && state.cites === 'own') params.set('own', '1');
  else if (state.tab === 'responses' && state.cites) {
    params.set('source', state.cites);
    if (/^https?:\/\//.test(state.cites)) params.set('sourceGroup', 'url');
  }
  if (state.tab === 'responses' && state.sentiment) params.set('sentiment', state.sentiment);
  if (state.tab === 'responses' && state.prompt) params.set('prompt', state.prompt);
  if (state.tab === 'prompts' && state.gap) params.set('gap', 'competitor-only');
  if (state.tab === 'sources' && state.source) {
    const source = state.source;
    params.set('kind', source.kind);
    // Each row says whether the answers cited it and whether they consulted it, whatever the filter, and its presence in
    // the comparison period.
    params.set('evidence', '1');
    params.set('change', '1');
    params.set('group', source.group);
    params.set('page', String(source.page));
    if (source.type) params.set('type', source.type);
    if (source.owner) params.set('owner', source.owner);
    params.set('origin', source.origin);
    if (source.sort) {
      params.set('sort', source.sort.key);
      params.set('dir', source.sort.direction);
    }
  }
  return params;
}

const SCREEN_VIEWS: Record<string, string> = {
  overview: 'summary',
  prompts: 'prompts',
  responses: 'history',
  sources: 'sources',
  products: 'products',
  competitors: 'competitors',
  models: 'analysis',
  fanout: 'fanout',
  opportunities: 'opportunities',
};
/** A report view for these filters. */
export function reportPath(api: string, filters: URLSearchParams, view: string) {
  const params = new URLSearchParams(filters);
  params.set('view', view);
  if (view === 'prompts') params.set('compact', '1');
  return `${api}/reports?${params}`;
}
/** The main report of a screen; null for a screen without one. */
export function screenReportPath(api: string, tab: string, filters: URLSearchParams) {
  const view = SCREEN_VIEWS[tab];
  return view ? reportPath(api, filters, view) : null;
}
/** The Overview's other reports: cited domains and pages by presence, the latest answers, Query Fan Out, site and content types. */
export function overviewReadPaths(api: string, filters: URLSearchParams) {
  const cited = (group: string) => {
    const params = new URLSearchParams(filters);
    params.set('view', 'sources');
    params.set('kind', 'cited');
    params.set('group', group);
    return `${api}/reports?${params}&order=presence`;
  };
  return {
    sources: cited('domain'),
    content: cited('url'),
    history: reportPath(api, filters, 'history'),
    fanout: reportPath(api, filters, 'fanout'),
    types: reportPath(api, filters, 'source-types'),
    contentTypes: reportPath(api, filters, 'content-types'),
  };
}
/** The project's sentiment report for these filters (the Overview card and Prompts read the same one; the demo its aggregate). */
export function researchReadPath(demo: boolean, projectId: string, filters: URLSearchParams) {
  const query = new URLSearchParams(filters);
  query.delete('provider');
  // Sentiment has no comparison: the same read whatever the header compares with.
  query.delete('compareStart');
  query.delete('compareEnd');
  return demo ? `/api/demo/brand-research?${query}` : `/api/projects/${encodeURIComponent(projectId)}/brand-research?${query}`;
}
/**
 * The most mentioned discovered competitors (the Brands decisions API), the 50 the header's Brands filter lists
 * (BRANDS_DIGEST_MAX): the Overview ranks its few from the same read, so the menu, the Overview and Responses share one kept
 * answer (analytics-cache.ts) instead of asking twice.
 */
export const discoveriesReadPath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/brands?top=${BRANDS_DIGEST_MAX}`;

/**
 * The first reads of a screen opened with no filter but the period (the address asks nothing else): what the screen sends as
 * soon as it knows the project. Any other address returns none and the screen reads as usual. `search` is the address's long
 * form (app-routes.ts expandAppPath), whose `project` and `tab` name the screen, not a filter.
 */
export function firstScreenReads(tab: string, projectId: string, search: URLSearchParams) {
  if ([...search.keys()].some((key) => !['days', 'project', 'tab'].includes(key))) return [];
  const days = search.get('days') || '28';
  if (!/^\d{1,2}$/.test(days)) return [];
  const filters = reportFilterQuery({
    projectId,
    days,
    tab,
    source: { kind: 'all', group: 'domain', page: 1, origin: 'all' },
  });
  const api = '/api';
  if (tab === 'overview') {
    const paths = overviewReadPaths(api, filters);
    return [
      reportPath(api, filters, 'summary'),
      paths.sources,
      paths.content,
      paths.history,
      paths.fanout,
      paths.types,
      paths.contentTypes,
      researchReadPath(false, projectId, filters),
      discoveriesReadPath(projectId),
    ];
  }
  if (tab === 'prompts') return [reportPath(api, filters, 'prompts'), researchReadPath(false, projectId, filters)];
  if (tab === 'competitors') return [reportPath(api, filters, 'competitors'), reportPath(api, filters, 'summary')];
  if (tab === 'responses') return [reportPath(api, filters, 'history'), reportPath(api, filters, 'summary'), discoveriesReadPath(projectId)];
  if (tab === 'sources' || tab === 'models') return [screenReportPath(api, tab, filters)!];
  return [];
}
