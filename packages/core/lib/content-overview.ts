// A content's Overview tab (both editions; the screen and the server share it): its publication fields and the comparison
// with Google's top 3 for its main keyword. The counts are the app's (words counted here, from the text and from the pages
// the agent read); only whether a text covers a topic or answers a question is the model's judgment. Pure.

/** How far a text covers a topic or answers a question: in full, in part (or without a fact the brand published), or not. */
export type Coverage = 'yes' | 'partial' | 'no';
export const COVERAGE = ['yes', 'partial', 'no'] as const;
/** Words of running text (paragraphs and list items) and in all (headings and tables too). */
export type WordCount = { running: number; total: number };
/** The publication fields, outside the text: written by the agent, edited by the person. */
export type ContentMeta = { title: string; description: string; slug: string; schema: string; links: string; images: string; open: string };
export const META_FIELDS = ['title', 'description', 'slug', 'schema', 'links', 'images', 'open'] as const;
/** What search shows of a title and a description (characters); the fields allow a little more to work with. */
export const META_LIMITS: Partial<Record<keyof ContentMeta, number>> = { title: 60, description: 155, slug: 75 };
const META_MAX = 2000;
/** `unreadable`: the agent tried to read the page and could not (its words are not measured, and the screen says why). */
export type Competitor = { position: number | null; url: string; title: string; words: WordCount | null; unreadable?: boolean };
export type ContentAnalysis = {
  keyword: string;
  competitors: Competitor[];
  topics: { name: string; ours: Coverage; them: Coverage[] }[];
  questions: { text: string; ours: Coverage; them: Coverage[] }[];
  /** Where the text stays behind, and why (a fact the brand has not published). */
  gaps: string;
  /** The text's version the coverage was judged on: a later one shows the judgment may be out of date. */
  version: number;
  checked_at: string;
};
export type ContentOverview = { meta?: ContentMeta; analysis?: ContentAnalysis };
export const TOPICS_MAX = 20;
export const QUESTIONS_MAX = 12;

// ---------------------------------------------------------------- counting words

const WORD = /[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu;
const words = (text: string) => text.match(WORD)?.length ?? 0;
/** A line's words without its Markdown: links keep their text, images and URLs go. */
const plain = (line: string) =>
  line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ');

/** The words of a Markdown text (or of a page read as headings and paragraphs): fenced blocks (data, charts) are not text. */
export function wordCount(markdown: string): WordCount {
  let running = 0;
  let total = 0;
  let fenced = false;
  for (const raw of markdown.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const line = raw.trim();
    if (!line || /^\|?[\s:|-]+\|?$/.test(line) || /^(?:-{3,}|\*{3,})$/.test(line)) continue;
    const count = words(plain(line.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')));
    total += count;
    if (!/^#{1,6}\s/.test(line) && !line.startsWith('|')) running += count;
  }
  return { running, total };
}

// ---------------------------------------------------------------- reading what was stored

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const coverage = (value: unknown): Coverage => ((COVERAGE as readonly unknown[]).includes(value) ? (value as Coverage) : 'no');
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const list = (value: unknown) => (Array.isArray(value) ? value.map(record) : []);

export function readWords(value: unknown): WordCount | null {
  const item = record(value);
  const running = count(item.running);
  const total = count(item.total);
  return running === null || total === null ? null : { running, total };
}

/** Publication fields from anything (a person's edit, the agent's call, storage): known fields, trimmed and bounded. */
export function readMeta(value: unknown, base?: ContentMeta): ContentMeta {
  const item = record(value);
  const meta = { ...(base ?? { title: '', description: '', slug: '', schema: '', links: '', images: '', open: '' }) };
  for (const field of META_FIELDS) if (field in item) meta[field] = text(item[field], META_MAX);
  return meta;
}

/** An Overview as stored (JSON text) or sent: what it does not hold, or holds wrong, is left out. */
export function readOverview(value: unknown): ContentOverview {
  let item: Record<string, unknown>;
  try {
    item = record(typeof value === 'string' ? (value ? JSON.parse(value) : {}) : value);
  } catch {
    return {};
  }
  const overview: ContentOverview = {};
  if (item.meta) overview.meta = readMeta(item.meta);
  const analysis = record(item.analysis);
  const competitors = list(analysis.competitors)
    .slice(0, 3)
    .map((each) => ({ position: count(each.position), url: text(each.url, 500), title: text(each.title, 200), words: readWords(each.words), ...(each.unreadable === true ? { unreadable: true } : {}) }))
    // Only web addresses: the model names them, and the screen links them.
    .filter((each) => /^https?:\/\//i.test(each.url));
  if (competitors.length) {
    const them = (value: unknown) => competitors.map((_, index) => coverage(Array.isArray(value) ? value[index] : undefined));
    overview.analysis = {
      keyword: text(analysis.keyword, 200),
      competitors,
      topics: list(analysis.topics)
        .map((each) => ({ name: text(each.name, 120), ours: coverage(each.ours), them: them(each.them) }))
        .filter((each) => each.name)
        .slice(0, TOPICS_MAX),
      questions: list(analysis.questions)
        .map((each) => ({ text: text(each.text, 200), ours: coverage(each.ours), them: them(each.them) }))
        .filter((each) => each.text)
        .slice(0, QUESTIONS_MAX),
      gaps: text(analysis.gaps, META_MAX),
      version: count(analysis.version) ?? 0,
      checked_at: text(analysis.checked_at, 40),
    };
  }
  return overview;
}

// ---------------------------------------------------------------- the comparison

/** good: meets (green); partial: in part, or a gap without a published fact (yellow); bad: does not (red). */
export type Tone = 'good' | 'partial' | 'bad';
export type Cell = { value: number | null; tone: Tone | null };

/** A count against the row's best: green from 90% of it, yellow from 60%, red below; one not measured has no colour. */
function tone(value: number | null, best: number): Tone | null {
  if (value === null || best <= 0) return null;
  return value >= best * 0.9 ? 'good' : value >= best * 0.6 ? 'partial' : 'bad';
}
const row = (values: (number | null)[]): Cell[] => {
  const best = Math.max(0, ...values.filter((value): value is number => value !== null));
  return values.map((value) => ({ value, tone: tone(value, best) }));
};
export const coverageTone = (value: Coverage): Tone => (value === 'yes' ? 'good' : value === 'partial' ? 'partial' : 'bad');

/**
 * The table of the Overview, our text first and then the top 3: words, topics covered and questions answered (in full)
 * of all of them; and, for the agent, where our text is behind the best of the three.
 */
export function compareOverview(analysis: ContentAnalysis, ours: WordCount) {
  const columns = analysis.competitors.length + 1;
  const covered = (items: { ours: Coverage; them: Coverage[] }[]) =>
    Array.from({ length: columns }, (_, index) => items.filter((item) => (index ? item.them[index - 1] : item.ours) === 'yes').length);
  const scored = (values: number[], of: number): Cell[] => values.map((value) => ({ value, tone: of ? tone(value, of) : null }));
  const running = row([ours.running, ...analysis.competitors.map((each) => each.words?.running ?? null)]);
  const total = row([ours.total, ...analysis.competitors.map((each) => each.words?.total ?? null)]);
  const topics = scored(covered(analysis.topics), analysis.topics.length);
  const questions = scored(covered(analysis.questions), analysis.questions.length);
  const behind: string[] = [];
  const best = (cells: Cell[]) => Math.max(0, ...cells.slice(1).map((cell) => cell.value ?? 0));
  if (running[0].value! < best(running)) behind.push(`running words: ${running[0].value} against ${best(running)} in the best of the top 3`);
  if (topics[0].value! < best(topics) || topics[0].value! < analysis.topics.length) behind.push(`topics: ${topics[0].value} of ${analysis.topics.length} covered in full (the best of the top 3 covers ${best(topics)})`);
  if (questions[0].value! < best(questions) || questions[0].value! < analysis.questions.length)
    behind.push(`Google questions: ${questions[0].value} of ${analysis.questions.length} answered in full (the best of the top 3 answers ${best(questions)})`);
  return { running, total, topics, questions, behind };
}

// ---------------------------------------------------------------- what the agent read in its conversation

type Part = { type: string; toolName?: string; state?: string; input?: unknown; output?: unknown; errorText?: string };
type ModelPart = { type?: string; toolName?: string; toolCallId?: string; input?: unknown; output?: { type?: string; value?: unknown } };
/**
 * A conversation's messages as the page keeps them (UI messages: `parts`) or as a step's model sees them (model messages: an
 * assistant's `tool-call` and a `tool` message's `tool-result` parts). The answer under way is only in the second until it ends.
 */
export type ReadMessage = { parts?: readonly Part[]; role?: string; content?: unknown };
/** A page's address as the reads and the Overview compare it: no scheme, `www.`, fragment or closing slash. */
export const pageKey = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
};

/** Every tool result in the messages: its tool's name and what it returned (a failed call: what it was asked, with `error`). */
function toolOutputs(messages: readonly ReadMessage[]) {
  const outputs: { name: string; output: Record<string, unknown> }[] = [];
  const asked = new Map<string, unknown>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const name = part.type === 'dynamic-tool' ? part.toolName : part.type.startsWith('tool-') ? part.type.slice(5) : null;
      if (!name) continue;
      if (part.state === 'output-available') outputs.push({ name, output: record(part.output) });
      if (part.state === 'output-error') outputs.push({ name, output: { ...record(part.input), error: part.errorText || true } });
    }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as ModelPart[]) {
      if (part?.type === 'tool-call' && part.toolCallId) asked.set(part.toolCallId, part.input);
      if (part?.type !== 'tool-result' || !part.toolName) continue;
      const kind = part.output?.type ?? '';
      let value = part.output?.value;
      if (kind === 'text' && typeof value === 'string')
        try {
          value = JSON.parse(value);
        } catch {
          value = {};
        }
      outputs.push({ name: part.toolName, output: kind.startsWith('error') ? { ...record(asked.get(part.toolCallId ?? '')), error: value || true } : record(value) });
    }
  }
  return outputs;
}

/**
 * The pages a conversation read (their words, counted when they were read, and the pages it tried and could not read), the
 * Google results it looked up (each keyword's organic results and questions, and every keyword it searched) and the tools that
 * answered: what the Overview's figures and the content's required steps come from, at no further cost. `sources`: the
 * conversation's kept messages and, during a turn, the messages of the step (the answer under way).
 */
export function conversationReads(...sources: readonly (readonly ReadMessage[])[]) {
  const pages = new Map<string, WordCount>();
  const unreadable = new Set<string>();
  const results = new Map<string, { position: number | null; url: string; title: string }[]>();
  const questions = new Map<string, string[]>();
  const searched: string[] = [];
  const tools = new Set<string>();
  for (const { name, output } of sources.flatMap(toolOutputs)) {
    tools.add(name);
    if (name === 'read_page' && typeof output.url === 'string') {
      const counted = readWords(output.words);
      if (counted) pages.set(pageKey(output.url), counted);
      else if (output.error) unreadable.add(pageKey(output.url));
    }
    if (name === 'search_results' && typeof output.keyword === 'string') {
      const keyword = output.keyword.trim().toLowerCase();
      searched.push(keyword);
      if (output.error) continue;
      results.set(keyword, list(output.organic).flatMap((item) => (typeof item.url === 'string' ? [{ position: count(item.position), url: item.url, title: text(item.title, 200) }] : [])));
      questions.set(keyword, (Array.isArray(output.people_also_ask) ? output.people_also_ask : []).filter((item): item is string => typeof item === 'string'));
    }
  }
  // A page read well once is read, whatever an earlier try said.
  for (const key of pages.keys()) unreadable.delete(key);
  return { pages, unreadable, results, questions, searched, tools };
}

/** The site a domain or address names, as `site:` searches write it: no scheme, `www.` or path. */
export const siteOf = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];

/**
 * What a first draft of a content still needs: the project's Brain consulted, and a Google search of what the brand
 * already published on the topic (`site:<its domain> ...`, its own pages as first-hand evidence). A search that came back with an
 * error counts as done: the attempt is in the trace, and the draft says what was not found.
 */
export function draftMissing(reads: ReturnType<typeof conversationReads>, domain: string) {
  const site = siteOf(domain);
  // A project without a domain has no site to search.
  const searchedSite = !site || reads.searched.some((keyword) => {
    const named = /(?:^|\s)site:(\S+)/.exec(keyword)?.[1];
    if (!named) return false;
    const host = siteOf(named);
    return host === site || host.endsWith(`.${site}`);
  });
  return [...(reads.tools.has('read_brain') ? [] : ['brain' as const]), ...(searchedSite ? [] : ['site' as const])];
}
