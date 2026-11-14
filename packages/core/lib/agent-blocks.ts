// Data blocks bound to the project's data (```live in an artifact's Markdown): what they may read, how they are drawn,
// and the figures they keep. Pure, shared by the screen (agent-blocks.tsx draws them), the server (lib/server/agent-blocks.ts
// computes them from the project's own reports, no model and no paid provider) and the tests.
//
// A block keeps its query and the figures it last showed (`snapshot`, `captured_at`). A live one is computed again each
// time the artifact opens; a frozen one shows its figures as they were. `mode` absent follows the artifact's own setting.
//
// Besides the six shortcuts, a `report` block draws any series of any report of the app: one of the read tools the agent
// and AI apps call (lib/server/mcp-tools.ts) with its own filters, the list in its answer (`rows`), each row's name (`x`)
// and its numbers (`series`, or `by` for one row per name and series). Its figures are kept by series label.
import { ENGINE_LABELS, type Engine } from './engines';

export const LIVE_DATA = ['overview', 'models', 'brands', 'prompts', 'sources', 'source-types', 'report'] as const;
export type LiveData = (typeof LIVE_DATA)[number];
export const LIVE_SHAPES = ['metrics', 'line', 'bar', 'donut', 'table'] as const;
export type LiveShape = (typeof LIVE_SHAPES)[number];
export const LIVE_METRICS = ['visibility', 'shareOfVoice', 'citationPresence', 'mentionPosition'] as const;
export type LiveMetric = (typeof LIVE_METRICS)[number];

/** What each kind of data can be drawn as. */
export const LIVE_SHAPES_OF: Record<LiveData, readonly LiveShape[]> = {
  overview: ['metrics', 'line'],
  models: ['bar', 'table'],
  brands: ['table', 'bar', 'donut'],
  prompts: ['table'],
  sources: ['table'],
  'source-types': ['donut', 'table'],
  report: ['bar', 'line', 'donut', 'table', 'metrics'],
};
/** The reads a `report` block may run: every report of the app, never answer texts, settings or other projects. */
export const REPORT_TOOLS = [
  'get_overview',
  'list_prompts',
  'get_prompt',
  'compare_brands',
  'list_discovered_brands',
  'get_sentiment',
  'list_sources',
  'get_source_types',
  'get_source',
  'compare_ai_models',
  'get_query_fanout',
  'list_opportunities',
  'get_semantic_branding',
  'get_products',
  'get_ai_bots',
  'get_comparison',
] as const;
export type ReportTool = (typeof REPORT_TOOLS)[number];

export type LiveRow = Record<string, string | number | null>;
export type LiveBlock = {
  id: string;
  data: LiveData;
  shape: LiveShape;
  metric?: LiveMetric;
  period: { days: number } | { start: string; end: string };
  limit?: number;
  title?: string;
  mode?: 'live' | 'frozen';
  snapshot?: LiveRow[];
  captured_at?: string;
  /** `report`: the read and its own arguments (the period is the block's), the list in its answer and what each row draws. */
  tool?: ReportTool;
  args?: Record<string, unknown>;
  rows?: string;
  x?: string;
  /** What a row is (Brand, Topic): the table's first column. */
  name?: string;
  series?: { key: string; label: string }[];
  /** Long rows (one per name and series): each value of this field is a series, its number at `series[0].key`. */
  by?: string;
  unit?: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pick = <T extends string>(list: readonly T[], value: unknown) => (list as readonly string[]).includes(String(value)) ? (value as T) : undefined;

/** A new block id: `b_` and six hex digits. */
export const blockId = () => `b_${Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

/** A valid block (bounded: days 1 to 90, limit 1 to 50, a shape its data has), or null; it never runs anything. */
export function readLiveBlock(value: unknown): LiveBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const data = pick(LIVE_DATA, input.data);
  if (!data) return null;
  const shape = pick(LIVE_SHAPES_OF[data], input.shape) ?? LIVE_SHAPES_OF[data][0];
  const period = (input.period && typeof input.period === 'object' ? input.period : {}) as Record<string, unknown>;
  const days = Number(period.days);
  const block: LiveBlock = {
    id: typeof input.id === 'string' && /^b_[0-9a-f]{6}$/.test(input.id) ? input.id : blockId(),
    data,
    shape,
    period: DAY.test(String(period.start)) && DAY.test(String(period.end)) ? { start: String(period.start), end: String(period.end) } : { days: Number.isInteger(days) && days >= 1 && days <= 90 ? days : 28 },
  };
  const metric = pick(LIVE_METRICS, input.metric);
  if (metric) block.metric = metric;
  const limit = Number(input.limit);
  if (Number.isInteger(limit) && limit >= 1 && limit <= 50) block.limit = limit;
  if (typeof input.title === 'string' && input.title.trim()) block.title = input.title.replace(/\s+/g, ' ').trim().slice(0, 120);
  const mode = pick(['live', 'frozen'] as const, input.mode);
  if (mode) block.mode = mode;
  if (Array.isArray(input.snapshot)) block.snapshot = input.snapshot.filter((row): row is LiveRow => !!row && typeof row === 'object' && !Array.isArray(row)).slice(0, 100);
  if (typeof input.captured_at === 'string' && !Number.isNaN(Date.parse(input.captured_at))) block.captured_at = input.captured_at;
  return data === 'report' ? readReport(block, input) : block;
}

/** A field of a row: `a.b`, or `list[field=value].c` for the item of a list whose field has that value. */
const PATH = /^[^.[\]]+(\[[^=\]]+=[^\]]*\])?(\.[^.[\]]+(\[[^=\]]+=[^\]]*\])?)*$/;
const path = (value: unknown) => (typeof value === 'string' && value.length <= 160 && PATH.test(value.trim()) ? value.trim() : undefined);
const words = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, max) : undefined);

function readReport(block: LiveBlock, input: Record<string, unknown>): LiveBlock | null {
  const tool = pick(REPORT_TOOLS, input.tool);
  const x = path(input.x);
  const series = (Array.isArray(input.series) ? input.series : []).flatMap((item) => {
    const key = path((item as Record<string, unknown>)?.key);
    const label = words((item as Record<string, unknown>)?.label, 60);
    return key && label && label !== 'x' ? [{ key, label }] : [];
  });
  if (!tool || !x || !series.length || series.length > 8) return null;
  // The project and the period are the block's own; a cursor would read one page forever.
  const { project: _project, days: _days, start: _start, end: _end, cursor: _cursor, ...args } = (input.args && typeof input.args === 'object' && !Array.isArray(input.args) ? input.args : {}) as Record<string, unknown>;
  if (JSON.stringify(args).length > 2000) return null;
  const out: LiveBlock = { ...block, tool, args, x, series };
  const rows = path(input.rows);
  if (rows) out.rows = rows;
  const by = path(input.by);
  if (by) out.by = by;
  const name = words(input.name, 40);
  if (name) out.name = name;
  if (typeof input.unit === 'string' && input.unit.length <= 6) out.unit = input.unit;
  return out;
}

/** A report block's error the agent can fix (a list or a field that is not in the answer). */
export class BlockError extends Error {}

/** The value at a field of a row (see PATH), or undefined. */
export function valueAt(value: unknown, field: string): unknown {
  return field.split('.').reduce<unknown>((current, part) => {
    const match = /^([^[]+)(?:\[([^=]+)=(.*)\])?$/.exec(part);
    if (!match || !current || typeof current !== 'object') return undefined;
    const next = (current as Record<string, unknown>)[match[1]];
    if (match[2] === undefined) return next;
    const wanted = match[3].toLowerCase();
    return Array.isArray(next) ? next.find((item) => item && typeof item === 'object' && String((item as Record<string, unknown>)[match[2]]).toLowerCase() === wanted) : undefined;
  }, value);
}

/** The lists in an answer, by field (one level down too), for an error that says where the rows are. */
const listsOf = (answer: unknown) =>
  Object.entries((answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>).flatMap(([key, value]) =>
    Array.isArray(value) ? [key] : value && typeof value === 'object' ? Object.entries(value).filter(([, inner]) => Array.isArray(inner)).map(([inner]) => `${key}.${inner}`) : [],
  );
const fieldsOf = (row: unknown) => (row && typeof row === 'object' ? Object.keys(row).slice(0, 30).join(', ') : 'none');
/** A name as the screens say it: an AI model by its label. */
const named = (value: unknown, max = 80) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  const label = ENGINE_LABELS[text as Engine] ?? text;
  return !label ? null : label.length > max ? `${label.slice(0, max - 1)}…` : label;
};
const figure = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null);

/**
 * A report block's figures from its read's answer: one row per name, its numbers by series label (or, with `by`, one
 * series per value of that field), in the report's order, at most `limit` (20). Rows that exist but carry no number at the
 * series' fields, or a list or name not in the answer, are a BlockError that says what the answer has.
 */
export function reportRows(answer: unknown, block: LiveBlock): LiveRow[] {
  const x = block.x ?? '';
  const series = block.series ?? [];
  const list = block.rows ? valueAt(answer, block.rows) : (listsOf(answer).map((key) => valueAt(answer, key)).find(Array.isArray) ?? answer);
  if (!Array.isArray(list)) throw new BlockError(`rows "${block.rows ?? ''}" is not a list in the answer of ${block.tool}; its lists: ${listsOf(answer).join(', ') || 'none'}.`);
  if (!list.length) return [];
  let rows: LiveRow[];
  if (block.by) {
    const table = new Map<string, LiveRow>();
    const labels = new Set<string>();
    for (const item of list) {
      const name = named(valueAt(item, x));
      const label = named(valueAt(item, block.by), 60);
      if (!name || !label || label === 'x' || (!labels.has(label) && labels.size >= 8)) continue;
      labels.add(label);
      const row = table.get(name) ?? { x: name };
      row[label] = figure(valueAt(item, series[0].key));
      table.set(name, row);
    }
    rows = [...table.values()];
  } else
    rows = list.flatMap((item) => {
      const name = named(valueAt(item, x));
      return name ? [{ x: name, ...Object.fromEntries(series.map(({ key, label }) => [label, figure(valueAt(item, key))])) }] : [];
    });
  if (!rows.length) throw new BlockError(`x "${x}" names no row of ${block.rows ?? 'the list'}; a row's fields: ${fieldsOf(list[0])}.`);
  if (!rows.some((row) => Object.entries(row).some(([key, value]) => key !== 'x' && typeof value === 'number')))
    throw new BlockError(`no number at ${block.by ? series[0].key : series.map((item) => item.key).join(', ')} in the rows of ${block.rows ?? 'the list'}; a row's fields: ${fieldsOf(list[0])}.`);
  return rows.slice(0, block.limit ?? 20);
}

/** Whether the block follows the project's data: its own setting, or the artifact's. */
export const isLive = (block: LiveBlock, artifactLive: boolean) => (block.mode ? block.mode === 'live' : artifactLive);

/** The block as it is written in the Markdown (a fenced ```live JSON object). */
export const liveFence = (block: LiveBlock) => `\`\`\`live\n${JSON.stringify(block)}\n\`\`\``;

/**
 * Each ```live fence of a document, rewritten by `change` (null keeps it as written). The rest of the text is untouched;
 * a fence that is not a valid block stays as it is.
 */
export async function mapLiveFences(markdown: string, change: (block: LiveBlock) => Promise<LiveBlock | null> | LiveBlock | null) {
  const fence = /```live[^\n]*\n([\s\S]*?)\n?```/g;
  const parts: (string | Promise<string>)[] = [];
  let last = 0;
  for (const match of markdown.matchAll(fence)) {
    parts.push(markdown.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
    let block: LiveBlock | null = null;
    try {
      block = readLiveBlock(JSON.parse(match[1]));
    } catch {
      // Not JSON: kept as written.
    }
    const written = match[0];
    parts.push(block ? Promise.resolve(change(block)).then((next) => (next ? liveFence(next) : written)) : written);
  }
  parts.push(markdown.slice(last));
  return (await Promise.all(parts)).join('');
}

/** The four key figures' names, as the screens say them. */
const METRIC_NAMES: Record<LiveMetric, [string, string]> = {
  visibility: ['Visibility', 'Visibilidade'],
  shareOfVoice: ['Share of voice', 'Share of voice'],
  citationPresence: ['Citation presence', 'Presença em citações'],
  mentionPosition: ['Mention position', 'Posição da menção'],
};
type Preset = { key: string; label: [string, string]; group: [string, string]; block: Omit<LiveBlock, 'id' | 'period'> };
const GROUPS: Record<LiveData, [string, string]> = {
  overview: ['Overview', 'Visão geral'],
  models: ['AI models', 'Modelos de IA'],
  brands: ['Brands', 'Marcas'],
  prompts: ['Prompts', 'Prompts'],
  sources: ['Sources', 'Fontes'],
  'source-types': ['Sources', 'Fontes'],
  report: ['Reports', 'Relatórios'],
};
const each = (metrics: readonly LiveMetric[], make: (metric: LiveMetric, [en, pt]: [string, string]) => Preset) => metrics.map((metric) => make(metric, METRIC_NAMES[metric]));
const preset = (data: LiveData, item: Omit<Preset, 'group'>): Preset => ({ ...item, group: GROUPS[data] });
/** A report's series as a bar chart, grouped as its screen; its series label is the field, which the screen names. */
const reported = (group: [string, string], key: string, label: [string, string], tool: ReportTool, rows: string, x: string, field: string, unit = ''): Preset => ({
  key,
  label,
  group,
  block: { data: 'report', shape: 'bar', tool, args: {}, rows, x, series: [{ key: field, label: field }], unit, limit: 10 },
});

/**
 * The charts and figures the editor inserts (its chart picker and "/"): every shape each kind of data has, for every
 * metric it shows, named as the screens name them. The period is the app's default.
 */
export const LIVE_PRESETS: Preset[] = [
  preset('overview', { key: 'overview', label: ['Key figures of the overview', 'Números-chave da visão geral'], block: { data: 'overview', shape: 'metrics' } }),
  ...each(LIVE_METRICS, (metric, [en, pt]) => preset('overview', { key: `figure-${metric}`, label: [`${en}, one figure`, `${pt}, um número`], block: { data: 'overview', shape: 'metrics', metric } })),
  ...each(LIVE_METRICS, (metric, [en, pt]) => preset('overview', { key: `daily-${metric}`, label: [`${en} by day`, `${pt} por dia`], block: { data: 'overview', shape: 'line', metric } })),
  ...each(LIVE_METRICS, (metric, [en, pt]) => preset('models', { key: `models-${metric}`, label: [`${en} by AI model`, `${pt} por modelo de IA`], block: { data: 'models', shape: 'bar', metric } })),
  preset('models', { key: 'models-table', label: ['AI models, table', 'Modelos de IA, tabela'], block: { data: 'models', shape: 'table' } }),
  preset('brands', { key: 'brands', label: ['Brand ranking', 'Ranking de marcas'], block: { data: 'brands', shape: 'table' } }),
  ...each(['visibility', 'shareOfVoice'], (metric, [en, pt]) => preset('brands', { key: `brands-${metric}`, label: [`${en} by brand`, `${pt} por marca`], block: { data: 'brands', shape: 'bar', metric } })),
  preset('brands', { key: 'share-of-voice', label: ['Share of voice by brand, donut', 'Share of voice por marca, rosca'], block: { data: 'brands', shape: 'donut', metric: 'shareOfVoice' } }),
  preset('prompts', { key: 'prompts', label: ['Prompts with the most visibility', 'Prompts com mais visibilidade'], block: { data: 'prompts', shape: 'table', limit: 10 } }),
  preset('sources', { key: 'sources', label: ['Most cited sources', 'Fontes mais citadas'], block: { data: 'sources', shape: 'table', limit: 10 } }),
  preset('source-types', { key: 'source-types', label: ['Cited sources by site type', 'Fontes citadas por tipo de site'], block: { data: 'source-types', shape: 'donut' } }),
  preset('source-types', { key: 'source-types-table', label: ['Cited sources by site type, table', 'Fontes citadas por tipo de site, tabela'], block: { data: 'source-types', shape: 'table' } }),
  ...each(['visibility', 'shareOfVoice'], (metric, [en, pt]) => reported(['Topics', 'Tópicos'], `topics-${metric}`, [`${en} by topic`, `${pt} por tópico`], 'get_overview', 'topics', 'topic', metric, '%')),
  reported(['Sentiment', 'Sentimento'], 'sentiment-brands', ['Sentiment index by brand', 'Índice de sentimento por marca'], 'get_sentiment', 'brands', 'brand', 'sentiment_index'),
  reported(['Semantic Branding', 'Semantic Branding'], 'semantic-scores', ['Semantic Branding score by brand', 'Score de Semantic Branding por marca'], 'get_semantic_branding', 'scores', 'name', 'score'),
  reported(['Shopping', 'Shopping'], 'products-brands', ['Brands in the product cards', 'Marcas nos cards de produtos'], 'get_products', 'brands', 'name', 'answers'),
  reported(['Query fan-out', 'Query fan-out'], 'fanout-intents', ['Searches by intent', 'Buscas por intenção'], 'get_query_fanout', 'intents', 'name', 'occurrences'),
];
