// The Prompts list filters beyond the header's (period, models, topic, tags): status, competitors only, metric ranges, mention,
// citation and creation date. All of them intersect (AND). They live in the URL so a filtered list can be shared and survives a reload.
// Absence is never a match: a prompt without answers in the period has no visibility, so a visibility range leaves it out.

export type PromptStatus = 'active' | 'inactive' | 'archived';
export const PROMPT_STATUSES: PromptStatus[] = ['active', 'inactive', 'archived'];
/** [min, max], either side open. */
export type Range = [number | null, number | null];
export type YesNo = '' | 'yes' | 'no';
export type MetricKey = 'visibility' | 'shareOfVoice' | 'sentiment' | 'position';
export const METRIC_KEYS: MetricKey[] = ['visibility', 'shareOfVoice', 'sentiment', 'position'];

export type PromptFilters = {
  status: PromptStatus;
  /** Only prompts whose answers name competitors but not the brand (the server's `gap=competitor-only`). */
  gap: boolean;
  visibility: Range;
  shareOfVoice: Range;
  sentiment: Range;
  position: Range;
  mention: YesNo;
  citation: YesNo;
  /** Creation day range, YYYY-MM-DD, either side ''. */
  created: [string, string];
};

export const EMPTY_PROMPT_FILTERS: PromptFilters = {
  status: 'active', gap: false,
  visibility: [null, null], shareOfVoice: [null, null], sentiment: [null, null], position: [null, null],
  mention: '', citation: '', created: ['', ''],
};

const PARAM: Record<MetricKey, string> = { visibility: 'vis', shareOfVoice: 'sov', sentiment: 'sent', position: 'pos' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const parseRange = (value: string | null): Range => {
  const [min = '', max = ''] = (value ?? '').split('..');
  const number = (text: string) => (text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text));
  return [number(min), number(max)];
};
const writeRange = ([min, max]: Range) => (min == null && max == null ? '' : `${min ?? ''}..${max ?? ''}`);
const yesNo = (value: string | null): YesNo => (value === 'yes' || value === 'no' ? value : '');

export function readPromptFilters(params: URLSearchParams): PromptFilters {
  const status = params.get('status') as PromptStatus;
  const [from = '', to = ''] = (params.get('created') ?? '').split('..');
  return {
    status: PROMPT_STATUSES.includes(status) ? status : 'active',
    gap: params.get('gap') === 'competitor-only',
    ...(Object.fromEntries(METRIC_KEYS.map((key) => [key, parseRange(params.get(PARAM[key]))])) as Record<MetricKey, Range>),
    mention: yesNo(params.get('mentioned')),
    citation: yesNo(params.get('cited')),
    created: [DAY.test(from) ? from : '', DAY.test(to) ? to : ''],
  };
}

/** Writes the filters that differ from the defaults and removes the others; `null` (another screen) removes them all. */
export function writePromptFilters(params: URLSearchParams, filters: PromptFilters | null) {
  const value = filters ?? EMPTY_PROMPT_FILTERS;
  const entries: [string, string][] = [
    ['status', value.status === 'active' ? '' : value.status],
    ['gap', value.gap ? 'competitor-only' : ''],
    ...METRIC_KEYS.map((key): [string, string] => [PARAM[key], writeRange(value[key])]),
    ['mentioned', value.mention],
    ['cited', value.citation],
    ['created', value.created[0] || value.created[1] ? `${value.created[0]}..${value.created[1]}` : ''],
  ];
  for (const [key, text] of entries) {
    if (text) params.set(key, text);
    else params.delete(key);
  }
}

/** The conditions of the filter panel in use (status and competitors-only have their own controls). */
export function activeConditions(filters: PromptFilters) {
  return [
    ...METRIC_KEYS.filter((key) => filters[key][0] != null || filters[key][1] != null),
    ...(filters.mention ? ['mention'] : []),
    ...(filters.citation ? ['citation'] : []),
    ...(filters.created[0] || filters.created[1] ? ['created'] : []),
  ];
}

/** What a prompt measured in the period; `undefined` metrics are still loading and do not filter yet. */
export type PromptMeasure = {
  createdAt: string;
  metric?: { responses: number; mentions: number; visibility: number; shareOfVoice: number | null; position?: number | null; cited?: number } | null;
  sentiment?: number | null;
};

const within = (value: number | null | undefined, [min, max]: Range) =>
  value != null && (min == null || value >= min) && (max == null || value <= max);
const open = ([min, max]: Range) => min == null && max == null;

/** Whether a prompt passes every condition. `measured`: the report has arrived (false while it loads: metric conditions wait). */
export function matchesPromptFilters(filters: PromptFilters, measure: PromptMeasure, measured: { metrics: boolean; sentiment: boolean }) {
  const day = measure.createdAt.slice(0, 10);
  if (filters.created[0] && day < filters.created[0]) return false;
  if (filters.created[1] && day > filters.created[1]) return false;
  if (measured.sentiment && !open(filters.sentiment) && !within(measure.sentiment, filters.sentiment)) return false;
  if (!measured.metrics) return true;
  const metric = measure.metric?.responses ? measure.metric : null;
  if (!open(filters.visibility) && !within(metric?.visibility, filters.visibility)) return false;
  if (!open(filters.shareOfVoice) && !within(metric?.shareOfVoice, filters.shareOfVoice)) return false;
  if (!open(filters.position) && !within(metric?.position, filters.position)) return false;
  // "Not mentioned" and "not cited" need answers: a prompt without any is unknown, not a no.
  if (filters.mention && (!metric || (metric.mentions > 0) !== (filters.mention === 'yes'))) return false;
  if (filters.citation && (!metric || metric.cited == null || (metric.cited > 0) !== (filters.citation === 'yes'))) return false;
  return true;
}

/** The header's topics in one string: a topic name may hold a comma, so they are joined by a line break (the URL repeats `topic`). */
export const TOPIC_SEPARATOR = '\n';

/**
 * Whether a prompt is in the header's scope: any of its topics (TOPIC_SEPARATOR), any of its tags (comma-separated) and any
 * of its models. The list, its status counts and the reports (the server's `topic`, `tags` and `engine`) select the same prompts.
 */
export function inHeaderFilters(
  prompt: { tag: string; tags: string[]; engine: string; engines?: string[] | null },
  header: { topic: string; tags: string; engine: string },
) {
  return (
    (!header.topic || header.topic.split(TOPIC_SEPARATOR).includes(prompt.tag)) &&
    (!header.tags || header.tags.split(',').some((tag) => prompt.tags.includes(tag))) &&
    (header.engine === 'all' || (prompt.engines ?? [prompt.engine]).some((engine) => header.engine.split(',').includes(engine)))
  );
}
