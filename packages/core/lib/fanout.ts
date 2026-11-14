import type { Engine } from './engines.ts';
import type {
  FanoutIntent,
  FanoutIntentRow,
  FanoutQueryRow,
  FanoutReport,
  FanoutTermTrend,
  QueryGap,
} from './report-types.ts';

// The fan-out view is computed from what the runs already store
// (`search_queries_json`). Nothing here reads a provider or writes data.

/** Same query, same key: case, accents, punctuation and spacing do not create a new query. */
export function normalizeQuery(query: string) {
  return query
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}:./-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Host of a `site:` operator, or '' when the query has none. */
export function siteOf(query: string) {
  const match = /(?:^|\s)site:(\S+)/i.exec(query);
  return match
    ? match[1].replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase()
    : '';
}

/**
 * Stop words per language, written without accents (keys are compared after `normalizeQuery`). A search's language is not
 * known, so every list applies to every search. Words that are also content in another language stay out ("son", "sin").
 * ponytail: English, Portuguese and Spanish; add a language here when a project's searches show its articles as terms.
 */
const STOP_WORDS = {
  en: ['a', 'an', 'and', 'the', 'of', 'to', 'in', 'for', 'on', 'is', 'are', 'what', 'which', 'how', 'with', 'from', 'by', 'at', 'or', 'vs', 'it', 'its', 'my', 'be', 'as', 'that', 'this', 'me', 'i'],
  pt: ['de', 'da', 'do', 'e', 'em', 'para', 'com', 'um', 'uma', 'que', 'por', 'como'],
  es: ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'al', 'y', 'o', 'en', 'con', 'por', 'para', 'que', 'como', 'es', 'se', 'su', 'sus', 'lo', 'mi', 'mis', 'tu', 'tus', 'cual', 'cuales', 'donde', 'cuando'],
} as const;
const STOP: ReadonlySet<string> = new Set(Object.values(STOP_WORDS).flat());

// Words that end in "s" and are not the plural of another word ("news" is not "new", "series" is not "serie").
const NOT_PLURAL = new Set(['news', 'series']);

/**
 * One key for singular and plural ("service" and "services", "documentary" and "documentaries"). Trailing "s"
 * only, which covers English and Portuguese plurals ("ss", "us" and "is" endings like "business" and "status"
 * are not plurals), then "-ie" folds into "-y" so "-ies" plurals meet their "-y" singular. The key is for
 * matching, never shown: the screen shows `termLabel`.
 * ponytail: no "-es" rule, add it when a real plural shows up split in the report.
 */
export const stem = (word: string) => {
  if (word.length <= 3 || NOT_PLURAL.has(word)) return word;
  const singular = /[^sui]s$/.test(word) ? word.slice(0, -1) : word;
  return singular.length > 3 && singular.endsWith('ie') ? `${singular.slice(0, -2)}y` : singular;
};

/** Content words of a text: normalized, without stop words, as written (before `stem`). */
const wordsOf = (text: string) => normalizeQuery(text).split(' ').filter((word) => word.length > 1 && !STOP.has(word));
/**
 * The same need written another way: a search's words in lowercase, without accents or stop words, sorted. Two searches with
 * the same key differ only in word order, accents or stop words ("melhor agência de SEO em São Paulo" and "sao paulo agencia seo
 * melhor"), so they share an intent. '' when nothing but stop words is left.
 */
export const intentTokenKey = (text: string) => wordsOf(text).sort().join(' ');

/** Content keys of a text: plural folded into singular. The year is kept: it is part of what the AI searches. */
export function contentWords(text: string) {
  return wordsOf(text).map(stem);
}

/** How each key is written in the searches, so the screen shows a real word ("documentaries"), never the key. */
export type TermForms = Map<string, Map<string, number>>;

/**
 * Counts how a text writes each key. `text` is the search as the AI wrote it: the form keeps its accents ("conversão"),
 * the key does not, so "conversão" and "conversao" are one term shown as it is written most.
 */
export function countForms(forms: TermForms, text: string) {
  const written = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}:./-]+/gu, ' ').trim().split(' ');
  for (const form of written) {
    const word = normalizeQuery(form);
    if (word.length <= 1 || STOP.has(word)) continue;
    const seen = forms.get(stem(word)) ?? new Map<string, number>();
    forms.set(stem(word), seen);
    seen.set(form, (seen.get(form) ?? 0) + 1);
  }
}

/** The form of a key that appears most in the searches (on a tie the accented one, then alphabetical, so the report is stable). */
export function termLabel(forms: TermForms, key: string) {
  const written = forms.get(key);
  const plain = (form: string) => Number(normalizeQuery(form) === form);
  return written ? [...written].sort((a, b) => b[1] - a[1] || plain(a[0]) - plain(b[0]) || a[0].localeCompare(b[0]))[0][0] : key;
}

/**
 * The key of a word or a phrase the screen filters by: its content words, plural folded, in order ("Agência de SEO" and
 * "agencias seo" are "agencia seo"). One word gives its `stem`, so a word's key is the same as before phrases.
 */
export const termKey = (text: string) => contentWords(text).join(' ');

/** Whether a search's content words (`contentWords`) hold a term key, its words side by side. */
export const hasTerm = (words: string[], key: string) => ` ${words.join(' ')} `.includes(` ${key} `);

/** Longest phrase the report counts: three words ("agencia marketing digital"); a longer one rarely repeats. */
export const PHRASE_WORDS = 3;

/**
 * Every run of 1 to `PHRASE_WORDS` content words of a search, keyed as `termKey` keys it, with the words as written from its
 * first to its last word ("agência de SEO": the stop word inside stays in the form, never in the key, nor at either end).
 */
export function phrasesOf(text: string): { key: string; form: string }[] {
  const written = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}:./-]+/gu, ' ').trim().split(' ');
  const content = written.flatMap((form, at) => {
    const word = normalizeQuery(form);
    return word.length > 1 && !STOP.has(word) ? [{ at, key: stem(word) }] : [];
  });
  const phrases: { key: string; form: string }[] = [];
  for (let start = 0; start < content.length; start++)
    for (let end = start; end < Math.min(content.length, start + PHRASE_WORDS); end++)
      phrases.push({
        key: content.slice(start, end + 1).map((word) => word.key).join(' '),
        form: written.slice(content[start].at, content[end].at + 1).join(' '),
      });
  return phrases;
}

/** Words of a search that the prompt did not already contain (prompt x search, in the order of the search). */
export function addedWords(prompt: string, query: string) {
  const known = new Set(contentWords(prompt));
  return [...new Set(contentWords(query))].filter((word) => !known.has(word));
}

export type FanoutInput = {
  id: string;
  engine: Engine;
  prompt_id: string;
  prompt_text: string;
  topic: string;
  created_at: string;
  queries: string[];
  mentioned: boolean;
  cited: boolean;
};

export const FANOUT_TABLE_LIMIT = 200;
const TREND_TERMS = 16;
const ADDED_TERMS = 30;
/** Words, and phrases of 2 or 3 words, the report lists of each (single words outnumber phrases: one list would hide them). */
export const PHRASE_LIMIT = 30;
const PHRASE_PARTNERS = 3;
/**
 * A word or phrase inside a longer listed one that holds at least this share of its searches says nothing more ("sao" when
 * "sao paulo" has 9 of its 10 searches): only the longer one is listed.
 * ponytail: one ratio for every language, tune it when a real report hides a word people look for.
 */
const SUBSUMED = 0.8;
// A gap needs enough responses to mean something and a clear distance from the engine's own average.
export const GAP_MIN_RESPONSES = 15;
export const GAP_MIN_DISTANCE = 8;
export const GAP_LIMIT = 8;

const share = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;

/**
 * Occurrence = one query in one response (repeats inside the same response count once), so a
 * total never exceeds responses x queries. Distinct = number of normalized keys.
 */
export function buildFanout(
  runs: FanoutInput[],
  coverage: { engine: Engine; responses: number }[],
  brands: { name: string; own: boolean }[],
  /** Only the table of queries narrows to the searches with this word; every other number stays whole. */
  term = '',
  /** Responses of the period right before this one, same length: what each word's change is measured against. */
  previousRuns: FanoutInput[] = [],
  /**
   * The project's search intents and each classified search key's intent ('' fits none; lib/fanout-intents.ts). With
   * `intent`, the table lists every search of that intent, like `term`.
   */
  grouping: { intents?: FanoutIntent[]; assignments?: ReadonlyMap<string, string>; intent?: string } = {},
): FanoutReport {
  const queries = new Map<string, { raw: Map<string, number>; engines: Set<Engine>; prompts: Set<string>; topics: Map<string, number>; occurrences: number; mentioned: number; cited: number }>();
  const topicRows = new Map<string, { occurrences: number; keys: Set<string>; mentioned: number }>();
  const termDays = new Map<string, Map<string, Partial<Record<Engine, number>>>>();
  const forms: TermForms = new Map();
  const termTotals = new Map<string, number>();
  const added = new Map<string, number>();
  const byEngine = new Map<Engine, { withFanout: number; occurrences: number; keys: Set<string> }>();
  const daily = new Map<string, Partial<Record<Engine, number>>>();
  // Words and phrases (1 to 3 words) the prompt did not have, per search of a response; how each is written.
  const phraseCounts = new Map<string, number>();
  const phraseForms: TermForms = new Map();
  const searchPhrases: string[][] = [];
  const sites = new Map<string, number>();
  let occurrences = 0;
  const wanted = term ? termKey(term) : '';
  for (const run of runs) {
    const seen = new Set<string>();
    const known = new Set(contentWords(run.prompt_text));
    const engine = byEngine.get(run.engine) ?? { withFanout: 0, occurrences: 0, keys: new Set<string>() };
    byEngine.set(run.engine, engine);
    for (const text of run.queries) {
      const key = normalizeQuery(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const row = queries.get(key) ?? { raw: new Map(), engines: new Set(), prompts: new Set(), topics: new Map(), occurrences: 0, mentioned: 0, cited: 0 };
      queries.set(key, row);
      row.raw.set(text, (row.raw.get(text) ?? 0) + 1);
      row.engines.add(run.engine);
      row.prompts.add(run.prompt_id);
      row.topics.set(run.topic, (row.topics.get(run.topic) ?? 0) + 1);
      row.occurrences++;
      if (run.mentioned) row.mentioned++;
      if (run.cited) row.cited++;
      engine.occurrences++;
      engine.keys.add(key);
      occurrences++;
      const date = run.created_at.slice(0, 10);
      const day = daily.get(date) ?? {};
      day[run.engine] = (day[run.engine] ?? 0) + 1;
      daily.set(date, day);
      const topic = topicRows.get(run.topic) ?? { occurrences: 0, keys: new Set<string>(), mentioned: 0 };
      topicRows.set(run.topic, topic);
      topic.occurrences++;
      topic.keys.add(key);
      if (run.mentioned) topic.mentioned++;
      const site = siteOf(key);
      if (site) sites.set(site, (sites.get(site) ?? 0) + 1);
      const words = contentWords(key);
      countForms(forms, text);
      const phrases = new Set<string>();
      for (const phrase of phrasesOf(text)) {
        const seenForms = phraseForms.get(phrase.key) ?? new Map<string, number>();
        phraseForms.set(phrase.key, seenForms);
        seenForms.set(phrase.form, (seenForms.get(phrase.form) ?? 0) + 1);
        if (phrase.key.split(' ').every((word) => !known.has(word))) phrases.add(phrase.key);
      }
      for (const phrase of phrases) phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
      if (phrases.size) searchPhrases.push([...phrases]);
      // A phrase the screen is narrowed to has its own series, as a word does.
      const series = wanted.includes(' ') && hasTerm(words, wanted) ? [...new Set(words), wanted] : new Set(words);
      for (const word of series) {
        termTotals.set(word, (termTotals.get(word) ?? 0) + 1);
        const days = termDays.get(word) ?? new Map<string, Partial<Record<Engine, number>>>();
        termDays.set(word, days);
        const counts = days.get(date) ?? {};
        counts[run.engine] = (counts[run.engine] ?? 0) + 1;
        days.set(date, counts);
      }
      for (const word of addedWords(run.prompt_text, key)) added.set(word, (added.get(word) ?? 0) + 1);
    }
    if (seen.size) engine.withFanout++;
  }
  const intentById = new Map((grouping.intents ?? []).map((intent) => [intent.id, intent]));
  // A search of an intent that is not there any more fits none; one without a decision waits (null).
  const intentOf = (key: string) => {
    const id = grouping.assignments?.get(key);
    return id === undefined ? null : intentById.has(id) ? id : '';
  };
  const rows: FanoutQueryRow[] = [...queries].map(([key, row]) => ({
    key,
    text: [...row.raw].sort((a, b) => b[1] - a[1])[0][0],
    kind: siteOf(key) ? 'site' : 'search',
    occurrences: row.occurrences,
    prompts: row.prompts.size,
    topic: [...row.topics].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    engines: [...row.engines],
    mentionedRate: share(row.mentioned, row.occurrences),
    citedRate: share(row.cited, row.occurrences),
    intent: intentOf(key),
  }));
  rows.sort((a, b) => b.occurrences - a.occurrences || a.text.localeCompare(b.text));
  // Each intent over every search of the period (not only the listed ones), weighted like the table's summary.
  const grouped = new Map<string, { queries: number; occurrences: number; prompts: Set<string>; engines: Set<Engine>; mentioned: number; cited: number }>();
  const unassigned = { other: 0, pending: 0 };
  for (const [key, row] of queries) {
    const id = intentOf(key);
    if (!id) {
      unassigned[id === null ? 'pending' : 'other']++;
      continue;
    }
    const group = grouped.get(id) ?? { queries: 0, occurrences: 0, prompts: new Set<string>(), engines: new Set<Engine>(), mentioned: 0, cited: 0 };
    grouped.set(id, group);
    group.queries++;
    group.occurrences += row.occurrences;
    group.mentioned += row.mentioned;
    group.cited += row.cited;
    row.prompts.forEach((prompt) => group.prompts.add(prompt));
    row.engines.forEach((engine) => group.engines.add(engine));
  }
  const intents: FanoutIntentRow[] = [...grouped]
    .map(([id, group]) => ({
      ...intentById.get(id)!,
      queries: group.queries,
      occurrences: group.occurrences,
      prompts: group.prompts.size,
      engines: [...group.engines],
      mentionedRate: share(group.mentioned, group.occurrences),
      citedRate: share(group.cited, group.occurrences),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name));
  const listed = wanted
    ? rows.filter((row) => hasTerm(contentWords(row.key), wanted))
    : grouping.intent
      ? rows.filter((row) => row.intent === grouping.intent)
      : rows;
  const brandRows = brands
    .map((brand) => {
      const name = normalizeQuery(brand.name);
      const pattern = name ? new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`) : null;
      let count = 0;
      if (pattern) for (const [key, row] of queries) if (pattern.test(key)) count += row.occurrences;
      return { name: brand.name, own: brand.own, count };
    })
    .filter((brand) => brand.count > 0)
    .sort(byCount);
  const engines = coverage
    .map(({ engine, responses }) => {
      const found = byEngine.get(engine);
      return {
        engine,
        responses,
        withFanout: found?.withFanout ?? 0,
        occurrences: found?.occurrences ?? 0,
        distinct: found?.keys.size ?? 0,
      };
    })
    .sort((a, b) => b.occurrences - a.occurrences || b.responses - a.responses);
  const withFanout = engines.reduce((sum, engine) => sum + engine.withFanout, 0);
  const dates = [...daily.keys()].sort();
  const addedRows = [...added]
    .map(([term, count]) => ({ term, count, rate: share(count, occurrences) }))
    .filter((row) => row.count > 1)
    .sort(byCount)
    .slice(0, ADDED_TERMS);
  const gaps = buildQueryGaps(runs);
  // The terms offered as a series: the most frequent, the ones the AI adds and the ones a gap points at.
  const trendTerms = new Set([
    ...[...termTotals].map(([term, count]) => ({ term, count })).sort(byCount).slice(0, TREND_TERMS).map((row) => row.term),
    ...addedRows.map((row) => row.term),
    // A gap names its term as written ("conversão"); its series is under the key (normalized, without accents).
    ...gaps.map((gap) => stem(normalizeQuery(gap.term))),
    // The word the table is narrowed to always has its series, even when it is not among the most frequent.
    ...(termDays.has(wanted) ? [wanted] : []),
  ]);
  const previous = previousTermTotals(previousRuns, wanted);
  const labelOf = (key: string) => (key.includes(' ') ? termLabel(phraseForms, key) : termLabel(forms, key));
  const termTrend: FanoutTermTrend[] = [...trendTerms]
    .map((term) => {
      const days = termDays.get(term)!;
      const series = dates.map((date) => ({ date, counts: days.get(date) ?? {} }));
      const count = termTotals.get(term) ?? 0;
      const before = previous.get(term) ?? 0;
      return {
        term: labelOf(term),
        count,
        // No searches with the word in the previous period is "no comparison", never 0% or infinity.
        change: before > 0 ? ((count - before) / before) * 100 : null,
        daily: series,
      };
    })
    .sort(byCount);
  return {
    responses: engines.reduce((sum, engine) => sum + engine.responses, 0),
    withFanout,
    occurrences,
    distinct: queries.size,
    engines,
    daily: [...daily].sort((a, b) => a[0].localeCompare(b[0])).map(([date, counts]) => ({ date, counts })),
    // A word or an intent asked for lists every search with it (the pages are local); the general table keeps the most frequent.
    queries: wanted || grouping.intent ? listed : listed.slice(0, FANOUT_TABLE_LIMIT),
    hasMoreQueries: !wanted && !grouping.intent && listed.length > FANOUT_TABLE_LIMIT,
    phrases: topPhrases(phraseCounts, searchPhrases).map((row) => ({
      term: labelOf(row.key),
      words: row.key.split(' ').length,
      count: row.count,
      rate: share(row.count, occurrences),
      with: row.with.map((partner) => ({ term: labelOf(partner.key), count: partner.count })),
    })),
    brands: brandRows.slice(0, 12),
    sites: [...sites].map(([site, count]) => ({ site, count })).sort(byCount).slice(0, 10),
    topics: [...topicRows]
      .map(([topic, row]) => ({ topic, occurrences: row.occurrences, distinct: row.keys.size, mentionedRate: share(row.mentioned, row.occurrences) }))
      .sort((a, b) => b.occurrences - a.occurrences || a.topic.localeCompare(b.topic)),
    added: addedRows.map((row) => ({ ...row, term: termLabel(forms, row.term) })),
    termTrend,
    fanoutEngines: [],
    truncated: false,
    intents,
    unassigned,
  };
}

/** Searches with each word (plural and singular together), and with the phrase asked for, counted like the report: a query once per response. */
function previousTermTotals(runs: FanoutInput[], phrase = '') {
  const totals = new Map<string, number>();
  for (const run of runs)
    for (const key of new Set(run.queries.map(normalizeQuery))) {
      const words = contentWords(key);
      for (const word of new Set(words)) totals.set(word, (totals.get(word) ?? 0) + 1);
      if (phrase.includes(' ') && hasTerm(words, phrase)) totals.set(phrase, (totals.get(phrase) ?? 0) + 1);
    }
  return totals;
}

/**
 * The words and phrases the AI searches beyond the prompt, most searches first: one that a longer listed phrase holds almost
 * whole is left to that phrase (`SUBSUMED`), and each keeps the listed terms that appear with it in the same search (no word
 * in common), most frequent first. A term in a single search is not a pattern: two at least.
 */
export function topPhrases(counts: Map<string, number>, searches: string[][]) {
  const order = (a: [string, number], b: [string, number]) => b[1] - a[1] || b[0].split(' ').length - a[0].split(' ').length || a[0].localeCompare(b[0]);
  const repeated = [...counts].filter(([, count]) => count > 1);
  // ponytail: only the most frequent of each are compared (n² below), enough for lists of PHRASE_LIMIT.
  const ranked = [false, true].flatMap((phrase) => repeated.filter(([key]) => key.includes(' ') === phrase).sort(order).slice(0, PHRASE_LIMIT * 10));
  const open = ranked.filter(([key, count]) => !ranked.some(([longer, total]) => longer.length > key.length && total >= count * SUBSUMED && hasTerm(longer.split(' '), key)));
  const kept = [false, true].flatMap((phrase) => open.filter(([key]) => key.includes(' ') === phrase).slice(0, PHRASE_LIMIT)).sort(order);
  const listed = new Set(kept.map(([key]) => key));
  const partners = new Map<string, Map<string, number>>();
  for (const search of searches) {
    const here = search.filter((key) => listed.has(key));
    for (const key of here)
      for (const other of here) {
        if (other === key || other.split(' ').some((word) => key.split(' ').includes(word))) continue;
        const found = partners.get(key) ?? new Map<string, number>();
        partners.set(key, found);
        found.set(other, (found.get(other) ?? 0) + 1);
      }
  }
  return kept.map(([key, count]) => ({
    key,
    count,
    with: [...(partners.get(key) ?? [])]
      .filter(([, together]) => together > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, PHRASE_PARTNERS)
      .map(([partner, together]) => ({ key: partner, count: together })),
  }));
}

/**
 * Where the brand disappears: per AI and per word in the searches, the share of responses that mention
 * the brand, against that AI's own average. Rates are never averaged across AIs, and an AI that returns
 * no searches has no row (not informed, not zero).
 */
export function buildQueryGaps(runs: FanoutInput[]): QueryGap[] {
  const engines = new Map<Engine, { responses: number; mentioned: number; terms: Map<string, { responses: number; mentioned: number }> }>();
  const forms: TermForms = new Map();
  for (const run of runs) {
    for (const query of run.queries) countForms(forms, query);
    const words = new Set(run.queries.flatMap(contentWords));
    if (!words.size) continue;
    const engine = engines.get(run.engine) ?? { responses: 0, mentioned: 0, terms: new Map() };
    engines.set(run.engine, engine);
    engine.responses++;
    if (run.mentioned) engine.mentioned++;
    for (const word of words) {
      const term = engine.terms.get(word) ?? { responses: 0, mentioned: 0 };
      engine.terms.set(word, term);
      term.responses++;
      if (run.mentioned) term.mentioned++;
    }
  }
  const gaps: QueryGap[] = [];
  for (const [engine, found] of engines) {
    const baseline = share(found.mentioned, found.responses);
    for (const [term, row] of found.terms) {
      const rate = share(row.mentioned, row.responses);
      if (term.length > 2 && row.responses >= GAP_MIN_RESPONSES && baseline - rate >= GAP_MIN_DISTANCE)
        gaps.push({ term, engine, responses: row.responses, missing: row.responses - row.mentioned, rate, baseline });
    }
  }
  return gaps
    .sort((a, b) => b.missing - a.missing || b.baseline - b.rate - (a.baseline - a.rate) || a.term.localeCompare(b.term))
    .slice(0, GAP_LIMIT)
    .map((gap) => ({ ...gap, term: termLabel(forms, gap.term) }));
}
