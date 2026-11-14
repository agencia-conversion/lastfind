import type { BrandTarget, Citation, Run } from './types.ts';

/** A bounded substring must never split a UTF-16 surrogate pair. */
export function sliceUnicode(text: string, start: number, end = text.length) {
  let from = Math.max(0, start), to = Math.min(text.length, end);
  const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
  const low = (code: number) => code >= 0xdc00 && code <= 0xdfff;
  if (low(text.charCodeAt(from)) && high(text.charCodeAt(from - 1))) from++;
  if (low(text.charCodeAt(to)) && high(text.charCodeAt(to - 1))) to--;
  return text.slice(from, Math.max(from, to));
}

function escapeExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds a selected brand's textual rank in an answer snapshot. URLs and
 * source-list lines never count as mentions; absent names stay unavailable.
 */
export function brandProse(answer: string | null | undefined) {
  return proseLines(answer).replace(LINK, '$1').replace(BARE_URL, ' ');
}

const LINK = /!?\[([^\]]*)\]\(([^)]*)\)/g;
const BARE_URL = /(?:https?:\/\/|www\.)[^\s)\]}>,]+/giu;
/** brandProse before its links become their text and bare URLs are dropped. */
function proseLines(answer: string | null | undefined) {
  let references = false;
  return (answer || '').replace(/```[\s\S]*?```/g, ' ').split('\n').filter((line) => {
    if (/^\s*(?:#{1,6}\s*)?(?:sources?|fontes?|references?|referências?)\s*:?\s*$/iu.test(line)) { references = true; return false; }
    if (references && /^\s*#{1,6}\s+\S/u.test(line)) references = false;
    return !references;
  }).join('\n')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]+\]\(https?:[^\n]*\)\s*$/gimu, ' ');
}
const hostOf = (url: string) => {
  try {
    return new URL(/^https?:/iu.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * The links of the answer's prose, in brandProse's offsets: a markdown link spans its text, a bare URL is an empty
 * span where brandProse left a space. brandProse itself is unchanged; this is read only where a mention is classified.
 */
export function proseLinks(answer: string | null | undefined) {
  const links: { start: number; end: number; host: string }[] = [];
  let shift = 0;
  const linked = proseLines(answer).replace(LINK, (match, label: string, target: string, offset: number) => {
    const start = offset - shift;
    links.push({ start, end: start + label.length, host: hostOf(target.trim().split(/\s+/u)[0] ?? '') });
    shift += match.length - label.length;
    return label;
  });
  // Each bare URL becomes one space: what follows it moves back by its length less one.
  const cuts = [...linked.matchAll(BARE_URL)].map((match) => ({ at: match.index, removed: match[0].length - 1, host: hostOf(match[0]) }));
  const moved = (position: number) => cuts.reduce((total, cut) => total + (cut.at + cut.removed < position ? cut.removed : 0), 0);
  return [
    ...links.map((link) => ({ ...link, start: link.start - moved(link.start), end: link.end - moved(link.start) })),
    ...cuts.map((cut) => ({ start: cut.at - moved(cut.at), end: cut.at - moved(cut.at), host: cut.host })),
  ];
}

/**
 * The project's names are found in every answer by text alone, whatever the discovery says: case and accents folded,
 * any apostrophe as one ("McDonald’s"), and any run of spaces, hyphens or dashes between a name's words, or spaces around
 * its "&", as the same spelling ("Coca-Cola" and "Coca Cola", "AT & T"). Offsets are read in this folded text, as before.
 */
export function mentionText(text: string) {
  return normalizeText(text).replace(/[‘’ʼ]/gu, "'").replace(/[‐-―−]/gu, '-');
}
export function namePattern(name: string) {
  return escapeExpression(name).replace(/\s*&\s*/gu, '&').replace(/[\s-]+/gu, '[\\s-]+').replace(/&/gu, '\\s*&\\s*');
}

// A report asks one answer about many names in a row: its prose is normalized once, not once per name.
let lastProse: { answer: string | null | undefined; normalized: string } | undefined;
function normalizedAnswerProse(answer: string | null | undefined) {
  if (lastProse?.answer !== answer || !lastProse) lastProse = { answer, normalized: mentionText(brandProse(answer)) };
  return lastProse.normalized;
}

function mentionOffsetReader(answer: string | null | undefined) {
  const normalizedProse = normalizedAnswerProse(answer);
  const first = (names: string[]) => {
    const positions = [
      ...new Set(names.map((name) => mentionText(name.trim())).filter(Boolean)),
    ]
      .map((name) => {
        const match = new RegExp(
          `(^|[^\\p{L}\\p{N}])${namePattern(name)}(?=$|[^\\p{L}\\p{N}])`,
          'iu',
        ).exec(normalizedProse);
        return match ? match.index + match[1].length : -1;
      })
      .filter((index) => index >= 0);
    return positions.length ? Math.min(...positions) : null;
  };
  return first;
}

export function firstMentionPosition(
  answer: string | null | undefined,
  selectedNames: string[],
  targets: BrandTarget[],
): number | null {
  const first = mentionOffsetReader(answer);
  const selected = first(selectedNames);
  if (selected == null) return null;
  const selectedKeys = new Set(
    selectedNames.map((name) => normalizeText(name)),
  );
  const earlier = targets.filter((target) => {
    if (selectedKeys.has(normalizeText(target.name)))
      return false;
    const position = first([target.name, ...(target.aliases || [])]);
    return position != null && position < selected;
  });
  return earlier.length + 1;
}
/** All snapshot target ranks in one prose normalization/search pass. Same definition as firstMentionPosition. */
/** Where each brand (its names) is first named in the answer's prose: the offsets ranks compare, null when absent. */
export function mentionOffsets(answer: string | null | undefined, brands: string[][]): (number | null)[] {
  const first = mentionOffsetReader(answer);
  return brands.map((names) => first(names));
}
export function mentionPositions(
  answer: string | null | undefined,
  targets: BrandTarget[],
  offsets = mentionOffsets(answer, targets.map((target) => [target.name, ...(target.aliases || [])])),
): (number | null)[] {
  return targets.map((target, index) => {
    const offset = offsets[index];
    if (offset == null) return null;
    const selectedKeys = new Set([target.name, ...(target.aliases || [])].map(normalizeText));
    return offsets.filter((other, otherIndex) => other != null && other < offset && !selectedKeys.has(normalizeText(targets[otherIndex].name))).length + 1;
  });
}
export function normalizeText(text: string) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}
export function normalizeDomain(input: string) {
  const value = input.trim().toLowerCase();
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes('.') ||
      url.port
    )
      throw 0;
    return url.hostname.replace(/^www\./, '');
  } catch {
    throw new Error('Informe um domínio válido, como sua-marca.com.');
  }
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function matchesBrand(answer: string, target: BrandTarget) {
  return mentionOffsetReader(answer)([target.name, ...(target.aliases || [])]) != null;
}
export function extractResponse(
  result: Record<string, unknown>,
  engine = 'chat_gpt',
) {
  const sources = new Map<string, Citation>(),
    consulted = new Map<string, Citation>();
  let consultedAvailable = false;
  const add = (target: Map<string, Citation>, entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const source of entries) {
      if (!source || typeof source !== 'object') continue;
      const url = safeUrl(source.url);
      if (url)
        target.set(url, {
          url,
          domain: new URL(url).hostname.replace(/^www\./, ''),
          title: String(source.title || source.source || new URL(url).hostname),
        });
    }
  };
  const visit = (node: unknown, depth = 0): string => {
    if (depth > 12 || !node || typeof node !== 'object') return '';
    if (Array.isArray(node))
      return node
        .map((x) => visit(x, depth + 1))
        .filter(Boolean)
        .join('\n\n');
    const o = node as Record<string, unknown>;
    // Only the final answer contributes to brand visibility and citations.
    if (o.type === 'reasoning') return '';
    add(sources, o.sources);
    add(sources, o.references);
    add(sources, o.annotations);
    if (Array.isArray(o.search_results)) {
      consultedAvailable = true;
      add(consulted, o.search_results);
    }
    // Inspect children for evidence even when a parent has its own full text.
    const children = [o.items, o.sections]
      .map((x) => visit(x, depth + 1))
      .filter(Boolean)
      .join('\n\n');
    for (const key of ['markdown', 'original_text', 'text', 'description']) {
      if (typeof o[key] === 'string' && o[key].trim()) return o[key] as string;
    }
    return children;
  };
  let input: unknown = result;
  if (engine === 'google_ai_overviews' || engine === 'google_ai_mode') {
    // Organic links are not evidence of the AI's answer or browsing activity.
    input = Array.isArray(result.items)
      ? result.items.filter(
          (x: Record<string, unknown>) => x.type === 'ai_overview',
        )
      : [];
  }
  const answer = visit(input);
  const available = !!answer.trim();
  if (!available && engine !== 'google_ai_overviews')
    throw new Error('A coleta retornou uma resposta vazia.');
  return {
    answer,
    sources: [...sources.values()],
    consultedSources: consultedAvailable ? [...consulted.values()] : null,
    searchQueries: Array.isArray(result.fan_out_queries)
      ? result.fan_out_queries.filter((x): x is string => typeof x === 'string')
      : [],
    responseAvailable: available,
    model:
      typeof result.model === 'string'
        ? result.model
        : typeof result.model_name === 'string'
          ? result.model_name
          : engine,
  };
}
/**
 * Every truthy `mentions` entry across a set of runs: the brands monitored
 * in each supplied run's effective interpretation (the active analytical
 * overlay when valid, otherwise its original collection snapshot), including
 * ones outside the current display roster — never untracked names merely
 * present in the answer. This is the
 * share-of-voice denominator both the period KPI (`summarize`) and the daily
 * chart series use; keeping it in one place avoids the two drifting apart.
 */
export function countAllMentions(runs: Run[]) {
  return runs.reduce(
    (sum, r) => sum + Object.values(r.mentions).filter(Boolean).length,
    0,
  );
}
export function summarize(runs: Run[], brandName: string, brandDomain = '') {
  const complete = runs.filter(
    (r) => r.status === 'complete' && r.response_available !== false,
  );
  const mentioned = complete.filter((r) => r.mentions[r.brand_name]).length;
  const totalMentions = countAllMentions(complete);
  const citations = new Set(
    complete.flatMap((r) => r.sources.map((s) => s.domain)),
  );
  const citedBrand = complete.filter((r) =>
    r.sources.some((source) => source.domain === brandDomain),
  ).length;
  const positions = complete.flatMap((r) => {
    if (!r.mentions[r.brand_name]) return [];
    const position = firstMentionPosition(
      r.answer,
      [r.brand_name, brandName],
      // Only the brands it mentions rank: a monitored name written as a common word pushes no one down.
      Object.keys(r.mentions).filter((name) => r.mentions[name]).map((name) => ({ name, domain: '' })),
    );
    return position == null ? [] : [position];
  });
  return {
    responses: complete.length,
    visibility: complete.length ? (mentioned / complete.length) * 100 : 0,
    shareOfVoice: totalMentions ? (mentioned / totalMentions) * 100 : 0,
    citationPresence: complete.length
      ? (citedBrand / complete.length) * 100
      : 0,
    mentionPosition: positions.length
      ? positions.reduce((sum, position) => sum + position, 0) /
        positions.length
      : 0,
    citedDomains: citations.size,
    mentions: mentioned,
    totalMentions,
    cost: runs.reduce((a, r) => a + (r.cost ?? 0), 0),
  };
}
export function csvCell(value: string | number | boolean | null | undefined) {
  let s = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
const RUNS_CSV_HEADER = [
  ['Date UTC', 'Data UTC'],
  ['Prompt', 'Prompt'],
  ['Engine', 'Motor'],
  ['Status', 'Status'],
  ['Brands mentioned', 'Marcas mencionadas'],
  ['Cited domains', 'Domínios citados'],
  ['Cited sources (URLs)', 'Fontes citadas (URLs)'],
  ['Consulted sources (URLs)', 'Fontes consultadas (URLs)'],
  ['Consulted data available', 'Dados de consulta disponíveis'],
  ['Cost USD', 'Custo USD'],
] as const;
/** `cost` adds the provider-cost column: only where the reader pays the provider directly (the independent edition). */
export function runsCsv(
  runs: Run[],
  { locale = 'en', cost = false }: { locale?: 'en' | 'pt-BR'; cost?: boolean } = {},
) {
  const columns = cost ? RUNS_CSV_HEADER.length : RUNS_CSV_HEADER.length - 1;
  return (
    '\uFEFF' +
    [
      RUNS_CSV_HEADER.map(([en, pt]) => (locale === 'pt-BR' ? pt : en)),
      ...runs.map((r) => [
        r.created_at,
        r.prompt_text,
        r.engine,
        r.status,
        Object.entries(r.mentions)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join('; '),
        r.sources.map((s) => s.domain).join('; '),
        r.sources.map((s) => s.url).join('; '),
        r.consulted_sources?.map((s) => s.url).join('; ') ?? '',
        r.consulted_sources != null,
        r.cost,
      ]),
    ]
      .map((row) => row.slice(0, columns).map(csvCell).join(','))
      .join('\r\n')
  );
}
