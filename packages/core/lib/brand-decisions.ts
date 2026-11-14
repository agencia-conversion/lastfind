import type { BrandRole } from './brand-roles.ts';
import type { BrandTarget } from './types.ts';
import {
  domainConfidence,
  domainFitsBrand,
  brandLabel,
  guessDomains,
  registrableDomain,
  siteNamesBrand,
  type DomainConfidence,
  type DomainLookup,
  type DomainSite,
  type DomainSource,
  type SiteCheck,
} from './brand-domain.ts';

/** Monitored competitors per project (own brand not included). */
export const MAX_COMPETITORS = 10;

export type DecisionKind =
  | 'confirm'
  | 'reject'
  | 'alias'
  | 'domain'
  | 'rename'
  | 'undo';

/**
 * What a decision did to the monitored competitor list. Only effective changes
 * are recorded, so inverting them restores exactly what the decision touched.
 */
export type TargetOp =
  | { op: 'add'; target: BrandTarget }
  | { op: 'remove'; target: BrandTarget }
  | { op: 'alias'; key: string; names: string[] }
  | { op: 'unalias'; key: string; names: string[] }
  | { op: 'set'; key: string; field: 'name' | 'domain'; from: string; to: string };

export type DecisionEvidence = { runId: string; sha256: string | null };
export type DecisionPayload = {
  name: string;
  /** confirm / domain: the domain; reject: the domain known at the time. */
  domain?: string | null;
  previous?: string | null;
  displayName?: string;
  /** reject: the sense or context being rejected (e.g. "Conversion Rate Optimization"). */
  sense?: string;
  /** alias: destination brand and what was merged. */
  into?: string;
  intoKey?: string;
  names?: string[];
  /** Responses known for the brand when the decision was taken. */
  responses?: number | null;
  /** alias into a brand that is not monitored: answers mentioning both sides. */
  overlap?: number | null;
  evidence?: DecisionEvidence[];
  ops: TargetOp[];
};
export type DecisionEvent = {
  id: string;
  seq: number;
  kind: DecisionKind;
  brandKey: string;
  undoes: string | null;
  payload: DecisionPayload;
  author: string;
  createdAt: string;
};

/** Comparison key for a brand name: keeps "+" and "&" ("Paramount+" is not "Paramount"). */
export function brandKey(name: string) {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+&]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

/** Path crumb for a brand page: display name when known, otherwise the key from the URL. */
export function brandPathLabel(pageKey: string, names: Array<string | null | undefined>) {
  return names.find((name) => name && brandKey(name) === pageKey) ?? pageKey;
}

const sameBrand = (target: BrandTarget, key: string) =>
  brandKey(target.name) === key;

/** Eligible destinations in the alias panel, excluding the project's own brand. */
export function aliasTargets<T extends { key: string; own: boolean; status: string }>(
  rows: T[],
  current: { key: string; status: string } | null,
): T[] {
  return rows.filter((row) =>
    !row.own && row.key !== current?.key && row.status !== 'rejected' &&
    (current?.status !== 'tracked' || row.status === 'tracked'),
  );
}

export function applyOps(targets: BrandTarget[], ops: TargetOp[]): BrandTarget[] {
  let list = targets.map((target) => ({ ...target }));
  for (const op of ops) {
    if (op.op === 'add') {
      const key = brandKey(op.target.name);
      if (!list.some((t) => sameBrand(t, key) || t.domain === op.target.domain))
        list.push({ ...op.target });
    } else if (op.op === 'remove') {
      const key = brandKey(op.target.name);
      list = list.filter((t) => !sameBrand(t, key));
    } else if (op.op === 'alias' || op.op === 'unalias') {
      const drop = new Set(op.names.map(brandKey));
      list = list.map((t) => {
        if (!sameBrand(t, op.key)) return t;
        const current = t.aliases ?? [];
        const aliases =
          op.op === 'alias'
            ? [
                ...current,
                ...op.names.filter(
                  (name) =>
                    brandKey(name) !== op.key &&
                    !current.some((alias) => brandKey(alias) === brandKey(name)),
                ),
              ]
            : current.filter((alias) => !drop.has(brandKey(alias)));
        return { ...t, aliases };
      });
    } else {
      list = list.map((t) =>
        sameBrand(t, op.key) ? { ...t, [op.field]: op.to } : t,
      );
    }
  }
  return list;
}

/**
 * Applies `ops` and says whether each one actually changed the list. An undo
 * whose inversion changes nothing (the brand was renamed, its domain was taken
 * by another brand, ...) must be refused, not recorded as done.
 */
export function applyOpsChecked(targets: BrandTarget[], ops: TargetOp[]) {
  let list = targets;
  let effective = true;
  for (const op of ops) {
    if ((op.op === 'alias' || op.op === 'unalias') && !op.names.length) continue;
    const next = applyOps(list, [op]);
    if (JSON.stringify(next) === JSON.stringify(list)) effective = false;
    list = next;
  }
  return { list, effective };
}

export function invertOps(ops: TargetOp[]): TargetOp[] {
  return ops
    .map((op): TargetOp => {
      if (op.op === 'add') return { op: 'remove', target: op.target };
      if (op.op === 'remove') return { op: 'add', target: op.target };
      if (op.op === 'alias') return { ...op, op: 'unalias' };
      if (op.op === 'unalias') return { ...op, op: 'alias' };
      return {
        ...op,
        key: op.field === 'name' ? brandKey(op.to) : op.key,
        from: op.to,
        to: op.from,
      };
    })
    .reverse();
}

/** Events that still count: not an undo and not reversed by one. */
export function activeEvents(events: DecisionEvent[]) {
  const undone = new Set(events.map((event) => event.undoes));
  return events
    .filter((event) => event.kind !== 'undo' && !undone.has(event.id))
    .sort((a, b) => a.seq - b.seq);
}

export type MergedSource = {
  key: string;
  name: string;
  responses: number | null;
  overlap: number | null;
};
export type DecisionState = {
  confirmed: Record<string, { name: string; domain: string | null; eventId: string }>;
  rejected: Record<
    string,
    { name: string; sense: string; domain: string | null; responses: number | null; eventId: string }
  >;
  /** destination key → brands merged into it, directly. */
  merged: Record<string, MergedSource[]>;
  mergedInto: Record<string, string>;
  domains: Record<string, string>;
  names: Record<string, string>;
};

/** The state is a pure function of the active events, in order; the last decision on a brand wins. */
export function deriveState(events: DecisionEvent[]): DecisionState {
  const state: DecisionState = {
    confirmed: {},
    rejected: {},
    merged: {},
    mergedInto: {},
    domains: {},
    names: {},
  };
  for (const event of activeEvents(events)) {
    const { payload } = event;
    const key = event.brandKey;
    if (event.kind === 'confirm') {
      delete state.rejected[key];
      state.confirmed[key] = {
        name: payload.name,
        domain: payload.domain ?? null,
        eventId: event.id,
      };
      if (payload.domain) state.domains[key] = payload.domain;
    } else if (event.kind === 'reject') {
      delete state.confirmed[key];
      state.rejected[key] = {
        name: payload.name,
        sense: payload.sense ?? '',
        domain: payload.domain ?? null,
        responses: payload.responses ?? null,
        eventId: event.id,
      };
    } else if (event.kind === 'alias' && payload.intoKey) {
      state.mergedInto[key] = payload.intoKey;
      (state.merged[payload.intoKey] ??= []).push({
        key,
        name: payload.name,
        responses: payload.responses ?? null,
        overlap: payload.overlap ?? null,
      });
    } else if (event.kind === 'domain' && payload.domain) {
      state.domains[key] = payload.domain;
    } else if (event.kind === 'rename' && payload.displayName) {
      state.names[key] = payload.displayName;
    }
  }
  return state;
}

/** Follows merges to the brand that finally holds an identity. */
export function resolveMerge(state: DecisionState, key: string) {
  const seen = new Set<string>();
  while (state.mergedInto[key] && !seen.has(key)) {
    seen.add(key);
    key = state.mergedInto[key];
  }
  return key;
}

/** Every name folded into `key`, directly or through other merged brands. */
function mergedSources(state: DecisionState, key: string, seen = new Set<string>()): MergedSource[] {
  if (seen.has(key)) return [];
  seen.add(key);
  return (state.merged[key] ?? []).flatMap((source) => [
    source,
    ...mergedSources(state, source.key, seen),
  ]);
}

export type Suggestion = {
  name: string;
  domain: string | null;
  score?: number;
  answerCount: number;
  evidence: { runId: string; excerpt: string; createdAt: string }[];
  /** Added by the free detector; absent in older analyses. */
  key?: string;
  ambiguous?: boolean;
  reasons?: string[];
  /** Client or supplier of the project's brands, not a competitor; absent means competitor. */
  role?: BrandRole;
  /** UTC day → answers of that day that mention the name. */
  days?: Record<string, number>;
  /** Other spellings, sub-brands and divisions the detector folded into this name ("Accenture Song" under "Accenture"). */
  aliases?: string[];
};
export type BrandRow = {
  key: string;
  name: string;
  status: 'discovered' | 'rejected';
  domain: string | null;
  /** The domain only comes from the analysis; nobody confirmed it. */
  domainSuggested: boolean;
  /** Where the domain came from; null while there is none. */
  domainSource: DomainSource | null;
  /** How sure the system is of a suggested domain (a confirmed one has no confidence to report). */
  domainConfidence: DomainConfidence | null;
  /** Other domains the discovery considered, for the person to pick from. */
  domainCandidates: string[];
  /** What the brand's home page said about a suggested domain; null while unread (or the person gave the domain). */
  domainSite: DomainSite | null;
  /** Ambiguous candidate or an unsure domain: needs a human decision. */
  review: boolean;
  /** The domain, not the brand, is what needs the decision (no domain found, or a low-confidence one). */
  domainReview: boolean;
  reasons: string[];
  /** Client or supplier, not a competitor: kept out of the competitor ranking. */
  role: BrandRole;
  /** UTC day → answers of that day that mention the name (the discovered brand's own trend). */
  days: Record<string, number>;
  responses: number | null;
  aliases: string[];
  sense: string;
  rejectEventId: string | null;
  evidence: Suggestion['evidence'];
  /**
   * A discovery that may be a monitored competitor (one name holds the other's whole name, `sameBrandHint`): the person decides,
   * merging it or not. Set by the Brands list only; null or absent otherwise.
   */
  sameAs?: string | null;
};

/**
 * Rows for brands that are not monitored: the analysis suggestions with the
 * project's decisions applied, plus rejected brands (also those that used to be
 * monitored). Monitored brands come from the report itself.
 */
export function deriveRows(
  competitors: BrandTarget[],
  suggestions: Suggestion[],
  state: DecisionState,
  lookups: Record<string, DomainLookup> = {},
  /** Project's own site: never suggested as another brand's domain (True Crime → netflix.com). */
  ownDomain?: string | null,
  /** Reads of the brands' sites by host, and the project's country (for the `.com.br` guess). */
  { sites = {}, locationCode }: { sites?: Record<string, SiteCheck>; locationCode?: number | null } = {},
): BrandRow[] {
  const monitored = new Set(competitors.map((target) => brandKey(target.name)));
  const monitoredDomains = new Set(competitors.map((target) => target.domain));
  const bySuggestion = new Map<string, Suggestion>();
  for (const suggestion of suggestions)
    bySuggestion.set(suggestion.key ?? brandKey(suggestion.name), suggestion);
  const keys = new Set([...bySuggestion.keys(), ...Object.keys(state.rejected)]);
  const rows: BrandRow[] = [];
  for (const key of keys) {
    const suggestion = bySuggestion.get(key);
    const rejected = state.rejected[key];
    if (monitored.has(key) || state.mergedInto[key]) continue;
    if (suggestion?.domain && monitoredDomains.has(suggestion.domain) && !rejected) continue;
    const sources = mergedSources(state, key);
    const own = suggestion?.answerCount ?? rejected?.responses ?? null;
    const known = [own, ...sources.map((source) => bySuggestion.get(source.key)?.answerCount ?? source.responses)];
    const responses = known.every((value) => value == null)
      ? null
      : Math.max(
          ...known.map((value) => value ?? 0),
          known.reduce<number>((sum, value) => sum + (value ?? 0), 0) -
            sources.reduce((sum, source) => sum + (source.overlap ?? 0), 0),
        );
    const confirmedDomain = state.domains[key];
    const userDomain = confirmedDomain ?? rejected?.domain ?? null;
    const name = state.names[key] ?? suggestion?.name ?? rejected.name;
    // Analysis / lookup domains that do not fit the brand (google.com, the project's own site, …) never become
    // a suggested domain or favicon: the row shows the initial and "Domain not confirmed".
    const suggestionDomain =
      suggestion?.domain && domainFitsBrand(name, suggestion.domain, ownDomain) ? suggestion.domain : null;
    const guess = !!suggestion?.domain && !suggestionDomain;
    const found = !userDomain && (!suggestionDomain || guess) ? lookups[key] : undefined;
    const foundDomain = found?.domain && domainFitsBrand(name, found.domain, ownDomain) ? found.domain : null;
    // Last, the free guess (`nickelodeon.com`), only when its home page names the brand. Where it leads stands instead when
    // that is another name that fits too (`amazonprime.com` → `amazon.com`), not the same name in the reader's country (`.com.br`).
    const guessHost = userDomain || foundDomain || suggestionDomain || rejected
      ? undefined
      : guessDomains(name, locationCode).find((host) => domainFitsBrand(name, host, ownDomain) && sites[host]?.reachable && siteNamesBrand(name, sites[host]!));
    const siteGuess = guessHost ? sites[guessHost] : undefined;
    const label = (host: string) => registrableDomain(host).split('.')[0];
    const landed = siteGuess?.host && label(siteGuess.host) !== label(guessHost!) && domainFitsBrand(name, siteGuess.host, ownDomain) ? siteGuess.host : null;
    const guessed = guessHost ? (landed ?? guessHost) : null;
    const domain = userDomain ?? foundDomain ?? suggestionDomain ?? guessed ?? null;
    // A name whose site is a monitored brand's ("Amazon Prime" on primevideo.com) is that brand, as with the analysis' own domain.
    if (!rejected && !userDomain && domain && monitoredDomains.has(domain)) continue;
    const domainSource: DomainSource | null = userDomain
      ? 'user'
      : foundDomain
        ? found!.source
        : suggestionDomain
          ? 'answers'
          : guessed
            ? 'site'
            : null;
    // A suggested domain whose home page names the brand is confirmed; one whose site does not answer goes to review. A site
    // that only contains the name and calls itself by its own longer name ("Android Central" for Android) is someone else's.
    const check = domain && !userDomain ? (guessed ? siteGuess : sites[domain]) : undefined;
    const site = registrableDomain(domain ?? '').split('.')[0]!;
    const otherSite = !guessed && site !== brandLabel(name) && !!check && siteNamesBrand(site, check);
    const domainSite: DomainSite | null = !check ? null : !check.reachable ? 'unreachable' : siteNamesBrand(name, check) && !otherSite ? 'confirmed' : 'unconfirmed';
    const domainTrust = userDomain
      ? null
      : domainSite === 'unreachable' || guessed
        ? 'low'
        : domainSite === 'confirmed'
          ? 'high'
          : foundDomain
            ? domainConfidence(found!.confidence)
            : suggestionDomain
              ? 'high'
              : null;
    const domainCandidates = (found?.candidates ?? []).filter((candidate) => domainFitsBrand(name, candidate, ownDomain));
    // Only a decision the person can take in one click is asked: a low-confidence domain, or candidates to pick from.
    // A brand nothing was found for (or not looked up yet) keeps its initial and is not "to review" for the domain.
    const domainReview =
      !userDomain &&
      ((!!domain && domainTrust !== 'high') || (!domain && (guess || !!found) && domainCandidates.length > 0));
    const evidence = [suggestion, ...sources.map((source) => bySuggestion.get(source.key))]
      .flatMap((item) => item?.evidence ?? [])
      .filter((item, index, all) => all.findIndex((other) => other.runId === item.runId) === index)
      .slice(0, 6);
    rows.push({
      key,
      name,
      status: rejected ? 'rejected' : 'discovered',
      domain,
      domainSuggested: !!domain && !userDomain,
      domainSource,
      domainConfidence: domainTrust,
      domainCandidates,
      domainSite,
      review: !!suggestion?.ambiguous || domainReview,
      domainReview,
      reasons: suggestion?.reasons ?? [],
      role: suggestion?.role ?? 'competitor',
      days: suggestion?.days ?? {},
      responses,
      // What the person merged, then what the detector folded in (a name the person merged is listed once).
      aliases: [...new Map([...sources.map((source) => source.name), ...(suggestion?.aliases ?? [])].map((alias) => [brandKey(alias), alias])).values()],
      sense: rejected?.sense ?? '',
      rejectEventId: rejected?.eventId ?? null,
      evidence,
    });
  }
  rows.sort((a, b) => (b.responses ?? -1) - (a.responses ?? -1) || a.name.localeCompare(b.name));
  // Two discovered names of one role on the same confident site, one inside the other ("Amazon Prime" and
  // "Amazon Prime Video"), are one brand under the most cited name. Their answers may overlap, so the count is the larger one.
  const merged: BrandRow[] = [];
  // Kept rows by site, so each row is compared with the few on its own site, not with the whole list.
  const bySite = new Map<string, BrandRow[]>();
  for (const row of rows) {
    const site = row.status === 'discovered' && row.domain && row.domainConfidence !== 'low' ? row.domain : null;
    const into =
      site &&
      bySite.get(site)?.find(
        (other) => other.role === row.role && (` ${other.key} `.includes(` ${row.key} `) || ` ${row.key} `.includes(` ${other.key} `)),
      );
    if (!into) {
      merged.push(row);
      if (site) bySite.set(site, [...(bySite.get(site) ?? []), row]);
      continue;
    }
    into.aliases = [...into.aliases, row.name, ...row.aliases];
    into.evidence = [...into.evidence, ...row.evidence.filter((item) => !into.evidence.some((seen) => seen.runId === item.runId))].slice(0, 6);
    into.days = { ...into.days };
    for (const [day, count] of Object.entries(row.days)) into.days[day] = Math.max(into.days[day] ?? 0, count);
  }
  return merged;
}

/** Wire format of GET /api/projects/:id/brands. */
export type BrandsOverview = {
  /** Set when the list is the last one computed (a finished analysis only), not read now: the screen then asks with `fresh`. */
  cachedAt?: string;
  maxCompetitors: number;
  rows: BrandRow[];
  /**
   * Domain discovery for brands without one: `pending` brands still owe a step; `sites` home pages of the most mentioned
   * brands are still to read (free); `paid` says Google + the model are on.
   */
  domainDiscovery: { pending: number; sites?: number; paid: boolean; capped: boolean };
  state: DecisionState;
  history: {
    id: string;
    seq: number;
    kind: DecisionKind;
    name: string;
    into: string | null;
    undoes: string | null;
    active: boolean;
    author: string;
    createdAt: string;
  }[];
  /** Latest active decision: what "Undo" reverses. */
  undoable: { id: string; kind: DecisionKind; name: string } | null;
  analysis: {
    status: 'idle' | 'pending' | 'running' | 'complete' | 'failed';
    processed: number;
    total: number;
    truncated: boolean;
    needsEnsure: boolean;
    /** The list is the one reviewed before the analysis restarted. */
    stale: boolean;
    /** Answers the discovered brands were counted in (0 when unknown). */
    analyzed: number;
    /** The project store did not answer; decisions are still shown. */
    unavailable: boolean;
    publicationPending: boolean;
    error: string | null;
  };
};

/** The most mentioned discovered competitors the Overview reads (`?top=`), not the whole list (hundreds of rows). */
export const BRANDS_DIGEST_MAX = 50;
export type BrandsDigest<A = BrandsOverview['analysis']> = { cachedAt?: string; rows: BrandRow[]; analysis: A;
  /** Every discovered brand, the ones left out included. */
  discovered: number;
};
/**
 * What the Overview ranks: discovered competitors that need no review, most mentioned first, `top` of them; the other
 * discovered names are only counted.
 */
export function brandsDigest<A>(overview: { cachedAt?: string; rows: BrandRow[]; analysis: A }, top: number): BrandsDigest<A> {
  const discovered = overview.rows.filter((row) => row.status === 'discovered');
  const rows = discovered
    .filter((row) => !row.review && row.role === 'competitor')
    .sort((left, right) => (right.responses ?? 0) - (left.responses ?? 0))
    .slice(0, Math.max(1, Math.min(BRANDS_DIGEST_MAX, Math.floor(top) || 1)));
  return { ...(overview.cachedAt ? { cachedAt: overview.cachedAt } : {}), rows, analysis: overview.analysis, discovered: discovered.length };
}

export type SnippetPart = { text: string; match: boolean };

/**
 * A readable piece of an answer around the brand: markdown links, citations and
 * bare URLs removed (the stored excerpt can be cut in the middle of one), cut at
 * word boundaries, the brand marked.
 */
export function evidenceSnippet(excerpt: string, names: string[], max = 220): SnippetPart[] {
  const cleaned = excerpt
    .replace(/\[\[\d+\]\]\([^)\s]*\)?/g, ' ')
    .replace(/\[\[\d+\]\]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)?/g, '$1')
    .replace(/\(?https?:\/\/\S*/g, ' ')
    .replace(/\\/g, '')
    .replace(/[*_`#>]+/g, ' ')
    .split(/\s+/)
    // Tokens that are (the tail of) a URL or an id say nothing about the brand.
    .filter(
      (word) =>
        word && !(word.includes('/') && word.includes('.')) && !/[?=&]/.test(word) && word.length <= 30,
    );
  // A leading ")" closes something the cut removed.
  while (cleaned[0]?.includes(')') && !cleaned[0].includes('(')) cleaned.shift();
  // The stored excerpt is cut at a fixed size: its first and last words can be partial.
  let cutStart = false;
  if (/^[^\p{Lu}\p{N}"“'(]/u.test(cleaned[0] ?? '') && cleaned.length > 3) {
    cleaned.shift();
    cutStart = true;
  }
  const cutEnd = cleaned.length > 3 && excerpt.length >= 100 && !/[.!?:;)”"'»]$/.test(cleaned.at(-1)!);
  if (cutEnd) cleaned.pop();
  const text = cleaned.join(' ');
  const lower = text.toLowerCase();
  const wanted = names.map((name) => name.trim().toLowerCase()).filter((name) => name.length > 1);
  const hit = Math.min(...wanted.map((name) => lower.indexOf(name)).filter((index) => index >= 0), text.length);
  let start = hit === text.length ? 0 : Math.max(0, hit - 80);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  let end = Math.min(text.length, start + max);
  if (end < text.length) end = text.lastIndexOf(' ', end) > start ? text.lastIndexOf(' ', end) : end;
  const piece = `${start > 0 || cutStart ? '… ' : ''}${text.slice(start, end)}${end < text.length || cutEnd ? ' …' : ''}`;
  if (!wanted.length) return [{ text: piece, match: false }];
  const pattern = new RegExp(`(${wanted.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return piece
    .split(pattern)
    .filter(Boolean)
    .map((part) => ({ text: part, match: wanted.includes(part.toLowerCase()) }));
}
