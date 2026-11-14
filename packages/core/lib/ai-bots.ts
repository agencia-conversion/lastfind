/**
 * AI bots: how AI crawlers read the customer's site, from the customer's own Cloudflare zone analytics (a read-only token
 * they create; nothing is installed on the site). Pure code shared by the collector (lib/server/ai-bots.ts), the report
 * and the screen (components/analytics/ai-bots-view.tsx): the bot catalog lookups, the GraphQL query of one day, the
 * parsing of its answer into the rows the project store keeps, the period's days and the report's shape.
 */
import { AI_BOTS, AI_REFERRERS, OTHER_AI_TOKENS, OTHER_BOT, type AiReferrer, type BotPurpose, type CatalogBot } from './ai-bots-catalog.ts';
import { coveredPeriods } from './period-coverage.ts';
import type { StoreQuery } from './project-store-contract.ts';

export type { AiReferrer, BotPurpose, CatalogBot };

/**
 * The read-only token the customer creates, as Cloudflare's form names its permissions, and the link that opens that form already
 * filled in (12/11/2026: one button instead of building the token by hand). Cloudflare documents the user token template URL
 * (developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/): `permissionGroupKeys` a URL-encoded JSON
 * array of `{key, type}` (an unknown key is dropped silently), `accountId` and `zoneId` required (`*` and `all`, which the
 * customer may narrow to the site's zone), `name` optional. A third-party OAuth "Connect" needs an OAuth client Cloudflare
 * registers for the app (owner setup): not used yet.
 */
export const TOKEN_PERMISSIONS = [
  { key: 'account_analytics', label: ['Account', 'Account Analytics', 'Read'] },
  { key: 'analytics', label: ['Zone', 'Analytics', 'Read'] },
  { key: 'zone', label: ['Zone', 'Zone', 'Read'] },
] as const;
export const TOKEN_NAME = 'Lastfind, read only';
// Percent-encoded as in Cloudflare's example (a space as %20, never `+`).
export const CLOUDFLARE_TOKEN_TEMPLATE_URL = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
  JSON.stringify(TOKEN_PERMISSIONS.map(({ key }) => ({ key, type: 'read' }))),
)}&accountId=*&zoneId=all&name=${encodeURIComponent(TOKEN_NAME)}`;
export const BOT_PURPOSES: BotPurpose[] = ['training', 'search', 'user'];

const byToken = [
  ...AI_BOTS.flatMap((bot) => bot.tokens.map((token) => [token.toLowerCase(), bot] as const)),
  ...OTHER_AI_TOKENS.map((token) => [token.toLowerCase(), OTHER_BOT] as const),
].sort((a, b) => b[0].length - a[0].length);
const byId = new Map([...AI_BOTS, OTHER_BOT].map((bot) => [bot.id, bot]));

/** The catalog's bot a user agent declares (the longest token it contains), or null when it names none. */
export function matchBot(userAgent: string): CatalogBot | null {
  const agent = userAgent.toLowerCase();
  return byToken.find(([token]) => agent.includes(token))?.[1] ?? null;
}
/** Every bot the report names, "Other AI bots" last (the AI Bots page's filter). */
export const AI_BOTS_LIST: CatalogBot[] = [...AI_BOTS, OTHER_BOT];
/** A bot by its id; an id no longer in the catalog reads as "Other AI bots". */
export const botById = (id: string): CatalogBot => byId.get(id) ?? OTHER_BOT;
/** Every token the query asks Cloudflare for (its filter is case-sensitive: the tokens are written as the bots send them). */
export const BOT_TOKENS = [...new Set([...AI_BOTS.flatMap((bot) => bot.tokens), ...OTHER_AI_TOKENS])];
const referrerHosts = new Map(AI_REFERRERS.map((row) => [row.host, row]));
/** The LLM whose answer sent a visit (its referrer host), or null for any other host. */
export const referrerOf = (host: string) => referrerHosts.get(host.toLowerCase().replace(/^www\./, '')) ?? null;
/** The operator of an AI answer that sent a visit (its referrer host), or null for any other host. */
export const referrerOperator = (host: string) => referrerOf(host)?.operator ?? null;
export const REFERRER_HOSTS = AI_REFERRERS.flatMap((row) => [row.host, `www.${row.host}`]);
export type Llm = Omit<AiReferrer, 'host'>;
/** Each LLM of the classifier once, in its order. */
export const LLMS: Llm[] = [...new Map(AI_REFERRERS.map(({ id, name, operator }) => [id, { id, name, operator }])).values()];
export const llmById = (id: string) => LLMS.find((llm) => llm.id === id) ?? null;
/** The hosts the store keeps for an LLM (without `www.`, as parseDay writes them). */
const llmHosts = (id: string) => AI_REFERRERS.filter((row) => row.id === id).map((row) => row.host);

/** Response status classes of the report; errors are 403, 404 and 5xx. */
export type StatusClass = 'ok' | 'redirect' | 'not_found' | 'forbidden' | 'client_error' | 'server_error';
export const STATUS_CLASSES: StatusClass[] = ['ok', 'redirect', 'not_found', 'forbidden', 'client_error', 'server_error'];
export const statusClass = (status: number): StatusClass =>
  status === 404 ? 'not_found' : status === 403 ? 'forbidden' : status >= 500 ? 'server_error' : status >= 400 ? 'client_error' : status >= 300 ? 'redirect' : 'ok';
/** The SQL of an error status (the error rate's numerator), on a column named `status`. */
export const ERROR_STATUS_SQL = '(status IN (403,404) OR status>=500)';

/** The longest path kept: a longer one (a crawler probing random addresses) is cut. */
const MAX_PATH = 512;
const cleanPath = (path: unknown) => (typeof path === 'string' && path.startsWith('/') ? path.slice(0, MAX_PATH) : '/');

/**
 * What one day's query can read on this zone: found once, when the zone is connected (`probe`). `utm` (13/11/2026) is unknown
 * on a zone connected before it: the next collection finds it out.
 */
export type ZoneCapabilities = { pages: boolean; referrals: boolean; utm?: boolean };

const group = (alias: string, limit: number, filter: string, fields: string) =>
  `${alias}: httpRequestsAdaptiveGroups(limit: ${limit}, filter: {datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball"${filter}}, orderBy: [count_DESC]) { count ${fields} }`;
const quote = (value: string) => JSON.stringify(value);
/** The parts of a day's query, by alias. `bots` is required; the others depend on the zone's plan and token. */
export const QUERY_PARTS = {
  bots: () =>
    group('bots', 10000, `, OR: [${BOT_TOKENS.map((token) => `{userAgent_like: ${quote(`%${token}%`)}}`).join(', ')}]`, 'sum { edgeResponseBytes } dimensions { userAgent clientRequestPath edgeResponseStatus }'),
  total: () => group('total', 1, '', ''),
  pages: () => group('pages', 10000, ', edgeResponseStatus: 200, edgeResponseContentTypeName: "html"', 'dimensions { clientRequestPath }'),
  // The visits AI answers sent, by LLM host and the page they landed on (a referrer of an LLM's host is the landing itself: the
  // page's own assets carry the site's address as referrer).
  referrals: () => group('referrals', 1000, `, clientRefererHost_in: [${REFERRER_HOSTS.map(quote).join(', ')}]`, 'dimensions { clientRefererHost clientRequestPath }'),
  // The visits whose link names an LLM in `utm_source` and that carry no LLM referrer: ChatGPT adds `utm_source=chatgpt.com`
  // to the links of its answers, and a click from its apps (or any link opened without a referrer) arrives with only that
  // (13/11/2026: those visits went uncounted). A visit with both is counted once, by its referrer.
  utm: () =>
    group(
      'utm',
      1000,
      `, OR: [${AI_REFERRERS.map((row) => `{clientRequestQuery_like: ${quote(`%utm_source=${row.host}%`)}}`).join(', ')}], clientRefererHost_notin: [${REFERRER_HOSTS.map(quote).join(', ')}]`,
      'dimensions { clientRequestQuery clientRequestPath }',
    ),
};
/** The LLM a landing's query string names in `utm_source` (`utm_source=chatgpt.com`), or null. */
export const utmReferrer = (query: string) => referrerOf(new URLSearchParams(query.replace(/^\?/, '')).get('utm_source') ?? '');
export type QueryPart = keyof typeof QUERY_PARTS;
/** One GraphQL request for one zone and one UTC day: the bots' requests, every request, the site's pages and the AI referrals. */
export function dayQuery(parts: QueryPart[]) {
  return `query AiBots($zoneTag: string, $start: Time, $end: Time) { viewer { zones(filter: {zoneTag: $zoneTag}) { ${parts.map((part) => QUERY_PARTS[part]()).join(' ')} } } }`;
}
export const partsFor = (capabilities: ZoneCapabilities): QueryPart[] => [
  'bots',
  'total',
  ...(capabilities.pages ? (['pages'] as const) : []),
  ...(capabilities.referrals ? (['referrals'] as const) : []),
  ...(capabilities.referrals && capabilities.utm ? (['utm'] as const) : []),
];
export const dayVariables = (zoneTag: string, day: string) => ({ zoneTag, start: `${day}T00:00:00Z`, end: `${addDays(day, 1)}T00:00:00Z` });

/** One day as the project store keeps it (`bots-put`). `referrals` is null when the zone cannot report them. */
export type BotDay = {
  day: string;
  requests: number;
  complete: boolean;
  /** [bot id, path, status, requests, bytes], summed per bot after the user agents are read. */
  hits: [string, string, number, number, number][];
  /** Paths of the site's pages (HTML answered 200) seen that day, by anyone. */
  paths: string[];
  /** [referrer host, visits], or null when the zone cannot report them. */
  referrals: [string, number][] | null;
  /** [referrer host, landing path, visits], or null when the zone cannot report them (and in days read before 13/11/2026). */
  landings?: [string, string, number][] | null;
};
type Group = { count?: number; sum?: { edgeResponseBytes?: number }; dimensions?: Record<string, unknown> };
/** A day's GraphQL `data` as the store's rows; a user agent the catalog does not recognize is dropped. */
export function parseDay(day: string, data: unknown, { complete, referrals }: { complete: boolean; referrals: boolean }): BotDay {
  const zone = (data as { viewer?: { zones?: Record<string, Group[] | undefined>[] } } | null)?.viewer?.zones?.[0] ?? {};
  const hits = new Map<string, [string, string, number, number, number]>();
  for (const row of zone.bots ?? []) {
    const bot = matchBot(String(row.dimensions?.userAgent ?? ''));
    if (!bot) continue;
    const path = cleanPath(row.dimensions?.clientRequestPath);
    const status = Number(row.dimensions?.edgeResponseStatus) || 0;
    const key = `${bot.id}\n${path}\n${status}`;
    const found = hits.get(key) ?? [bot.id, path, status, 0, 0];
    found[3] += Number(row.count) || 0;
    found[4] += Number(row.sum?.edgeResponseBytes) || 0;
    hits.set(key, found);
  }
  const visits = new Map<string, number>();
  const landings = new Map<string, [string, string, number]>();
  // Each visit by the LLM host that sent it: its referrer, else the `utm_source` of its link.
  const sent = [
    ...(zone.referrals ?? []).map((row) => ({ row, host: String(row.dimensions?.clientRefererHost ?? '').toLowerCase().replace(/^www\./, '') })),
    ...(zone.utm ?? []).map((row) => ({ row, host: utmReferrer(String(row.dimensions?.clientRequestQuery ?? ''))?.host ?? '' })),
  ];
  for (const { row, host } of sent) {
    const count = Number(row.count) || 0;
    if (!referrerOf(host) || !count) continue;
    visits.set(host, (visits.get(host) ?? 0) + count);
    const path = cleanPath(row.dimensions?.clientRequestPath);
    const landing = landings.get(`${host}\n${path}`) ?? [host, path, 0];
    landing[2] += count;
    landings.set(`${host}\n${path}`, landing);
  }
  return {
    day,
    requests: Number(zone.total?.[0]?.count) || 0,
    complete,
    hits: [...hits.values()],
    paths: [...new Set((zone.pages ?? []).map((row) => cleanPath(row.dimensions?.clientRequestPath)))],
    referrals: referrals ? [...visits] : null,
    landings: referrals ? [...landings.values()] : null,
  };
}

/** What a GraphQL error list means for the connection: a token without access, the rate limit, or anything else. */
export function graphqlProblem(errors: unknown): 'auth' | 'budget' | 'other' | null {
  if (!Array.isArray(errors) || !errors.length) return null;
  const text = JSON.stringify(errors).toLowerCase();
  if (/"code":"(authz|authn|unauthorized|forbidden)"|not authorized|unauthorized|permission|access denied/.test(text)) return 'auth';
  if (/"code":"budget"|rate limit|too many/.test(text)) return 'budget';
  return 'other';
}

const DAY_MS = 86_400_000;
export const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
export const dayOf = (iso: string) => iso.slice(0, 10);
/** The first whole UTC day at or after an instant. */
const ceilDay = (iso: string) => (iso.slice(10) === 'T00:00:00.000Z' ? dayOf(iso) : addDays(dayOf(iso), 1));
/**
 * The days of a report period `[start, end)` (lib/server/report-filter.ts): a rolling period (ends now) holds today's
 * partial day and the 27 before it for 28 days; a chosen one its own days. `to` is exclusive.
 */
export const periodDays = (start: string, end: string) => ({ from: ceilDay(start), to: ceilDay(end) });
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The Monday that starts a day's week (the trend's weekly view). */
export function weekOf(day: string) {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}
export type TrendRow = { date: string } & Record<BotPurpose, number>;
/** A day of the visits AI answers sent: the visits of each LLM by its id. */
export type LlmTrendRow = { date: string } & Record<string, number | string>;
/** Daily rows summed by week, each under its Monday (every number of a row is summed). */
export function weekly<Row extends { date: string }>(rows: Row[]): Row[] {
  const weeks = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const date = weekOf(row.date);
    const week = weeks.get(date) ?? { date };
    for (const [key, value] of Object.entries(row)) if (key !== 'date' && typeof value === 'number') week[key] = (Number(week[key]) || 0) + value;
    weeks.set(date, week);
  }
  return ([...weeks.values()] as Row[]).sort((a, b) => a.date.localeCompare(b.date));
}

/** Where a connection stands. `zone`: a valid token was saved and its zone is still to be chosen. */
export type ConnectionState = 'none' | 'zone' | 'active' | 'invalid';
export type AiBotsConnection = {
  state: ConnectionState;
  zone: string | null;
  /** The zone's Cloudflare plan as the zone reports it ("Free Website", "Pro Website"...), and whether it is a paid one. */
  plan: string | null;
  paid: boolean;
  capabilities: ZoneCapabilities;
  /** The token's last four characters, so the person knows which one is saved. The token itself never leaves the server. */
  tokenHint: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  /** True while the first 30 days are still being read. */
  backfilling: boolean;
  /** Why the token stopped working: `auth` (revoked, expired or missing a permission), `zone` (the zone is gone). */
  problem: 'auth' | 'zone' | null;
  /** Example data of a preview, never a real zone. */
  preview: boolean;
  canManage: boolean;
};
export type BotRow = { id: string; name: string; operator: string; purpose: BotPurpose; visits: number; previous: number | null; pages: number; errors: number; lastDay: string };
/** An LLM that sent visits in the period: its visits, the distinct pages they landed on and the last day it sent one. */
export type LlmRow = Llm & { visits: number; previous: number | null; pages: number; lastDay: string };
/**
 * A drill down of the report: one bot (its catalog id), one LLM (its classifier id) or one page of the site (a path). The bot
 * narrows the bots' figures, the LLM the visits AI answers sent, the page both.
 */
export type ReportFilter = { bot?: string | null; llm?: string | null; page?: string | null };
export type AiBotsReport = {
  connection: AiBotsConnection;
  period: { from: string; to: string; compareFrom: string | null; compareTo: string | null; days: number; covered: number; previousCovered: number; compared: boolean };
  totals: {
    visits: number;
    previousVisits: number | null;
    requests: number;
    pages: number;
    previousPages: number | null;
    sitePages: number | null;
    bots: number;
    previousBots: number | null;
    operators: number;
    errors: number;
    previousErrorRate: number | null;
    referrals: number | null;
    previousReferrals: number | null;
    /** Distinct pages the visits from AI answers landed on; null when the zone cannot report where visits came from. */
    landingPages: number | null;
  };
  trend: TrendRow[];
  bots: BotRow[];
  operators: { operator: string; visits: number; referrals: number }[];
  pages: { path: string; visits: number; bots: number; cited: boolean }[];
  statuses: { status: StatusClass; visits: number }[];
  /** The LLMs that sent visits, the most first; empty when the zone cannot report them. */
  llms: LlmRow[];
  /** The visits from AI answers per day, by LLM id: only the days whose referrals were read (never a 0 for a day not read). */
  llmTrend: LlmTrendRow[];
  /** The pages visits from AI answers landed on, the most first. */
  landings: { path: string; visits: number; llms: number; cited: boolean }[];
  /** The first day kept with its landing pages (they are collected from 13/11/2026 on), or null when none is. */
  landingsFrom: string | null;
};

// --- The report, from the store's rows ---------------------------------------------------------------------------------

type Period = 'c' | 'p';
type Days = { from: string; to: string };
type Rows = Record<string, unknown>[];
const NUMBER = (value: unknown) => Number(value) || 0;
/** A path as the report compares it with a cited page: no trailing slash, lowercase. */
export const pathKey = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path).toLowerCase();

/** A filter's SQL conditions, appended to a statement's WHERE, and their parameters. */
function conditions(pairs: [column: string, value: string | string[] | null | undefined][]) {
  let sql = '';
  const params: string[] = [];
  for (const [column, value] of pairs) {
    if (Array.isArray(value)) {
      sql += ` AND ${column} IN (${value.map(() => '?').join(',') || 'NULL'})`;
      params.push(...value);
    } else if (value) {
      sql += ` AND ${column}=?`;
      params.push(value);
    }
  }
  return { sql, params };
}

/**
 * The report's reads of the project's store, one batch: `current` and `previous` are `[from, to)` days (periodDays);
 * `previous` is null when the comparison is off; `filter` narrows it to one bot, LLM or page. The results come back in this
 * order to `shapeReport`.
 */
export function reportStatements(current: Days, previous: Days | null, filter: ReportFilter = {}): StoreQuery[] {
  const before = previous ?? { from: '9999-12-31', to: '9999-12-31' };
  const period = "CASE WHEN day>=? AND day<? THEN 'c' ELSE 'p' END";
  const within = '((day>=? AND day<?) OR (day>=? AND day<?))';
  const both = [current.from, current.to, current.from, current.to, before.from, before.to];
  const now = [current.from, current.to];
  const hit = conditions([['bot', filter.bot], ['path', filter.page]]);
  const ref = conditions([['host', filter.llm ? llmHosts(filter.llm) : null], ['path', filter.page]]);
  // The visits of one page are kept only with their landing page (referral_pages); the totals by host also before it.
  const referrals = filter.page ? 'referral_pages' : 'bot_referrals';
  return [
    { sql: `SELECT ${period} period,COUNT(*) days,SUM(requests) requests,SUM(referrals) referrals,COUNT(referrals) referral_days FROM bot_days WHERE ${within} GROUP BY period`, params: both },
    {
      sql: `SELECT ${period} period,bot,SUM(hits) visits,COUNT(DISTINCT CASE WHEN status<400 THEN path END) pages,SUM(CASE WHEN ${ERROR_STATUS_SQL} THEN hits ELSE 0 END) errors,MAX(day) last_day
        FROM bot_hits WHERE ${within}${hit.sql} GROUP BY period,bot`,
      params: [...both, ...hit.params],
    },
    { sql: `SELECT ${period} period,COUNT(DISTINCT CASE WHEN status<400 THEN path END) pages FROM bot_hits WHERE ${within}${hit.sql} GROUP BY period`, params: [...both, ...hit.params] },
    { sql: `SELECT day,bot,SUM(hits) visits FROM bot_hits WHERE day>=? AND day<?${hit.sql} GROUP BY day,bot`, params: [...now, ...hit.params] },
    { sql: `SELECT status,SUM(hits) visits FROM bot_hits WHERE day>=? AND day<?${hit.sql} GROUP BY status`, params: [...now, ...hit.params] },
    { sql: `SELECT path,SUM(hits) visits,COUNT(DISTINCT bot) bots FROM bot_hits WHERE day>=? AND day<?${hit.sql} GROUP BY path ORDER BY visits DESC,path LIMIT 25`, params: [...now, ...hit.params] },
    // By day too: the period's sums, each LLM's last day and its daily trend all come from these rows (a batch holds 10 reads).
    { sql: `SELECT ${period} period,day,host,SUM(visits) visits FROM ${referrals} WHERE ${within}${ref.sql} GROUP BY period,day,host`, params: [...both, ...ref.params] },
    {
      sql: 'SELECT COUNT(*) pages,(SELECT MIN(day) FROM referral_pages) landings_from FROM (SELECT path FROM site_paths WHERE first_day<? AND last_day>=? UNION SELECT path FROM bot_hits WHERE day>=? AND day<? AND status<400)',
      params: [current.to, current.from, current.from, current.to],
    },
    { sql: 'SELECT day,referrals FROM bot_days WHERE day>=? AND day<?', params: now },
    // ponytail: the 1000 largest page and host pairs; a site with more spread loses the long tail of its landing pages.
    { sql: `SELECT path,host,SUM(visits) visits FROM referral_pages WHERE day>=? AND day<?${ref.sql} GROUP BY path,host ORDER BY visits DESC LIMIT 1000`, params: [...now, ...ref.params] },
  ];
}

/** The report from the results of `reportStatements` (in their order) and the paths the monitored answers cited (pathKey). */
export function shapeReport({ connection, results, current, previous, cited, filter = {} }: { connection: AiBotsConnection; results: Rows[]; current: Days; previous: Days | null; cited: Set<string>; filter?: ReportFilter }): AiBotsReport {
  const [days, bots, pages, trend, statuses, top, referrals, sitePages, coveredDays, landingRows = []] = results;
  const compare = !!previous;
  const of = <T extends Record<string, unknown>>(rows: T[], which: Period) => rows.filter((item) => item.period === which);
  const covered = NUMBER(of(days, 'c')[0]?.days);
  const previousCovered = NUMBER(of(days, 'p')[0]?.days);
  // Compared only when the earlier period was read for at least half as many days (lib/period-coverage.ts).
  const compared = compare && coveredPeriods(previousCovered, covered);
  const sum = (rows: Record<string, unknown>[], field: string) => rows.reduce((total, item) => total + NUMBER(item[field]), 0);
  const currentBots = of(bots, 'c'), previousBots = of(bots, 'p');
  const visits = sum(currentBots, 'visits'), previousVisits = sum(previousBots, 'visits');
  const errors = sum(currentBots, 'errors'), previousErrors = sum(previousBots, 'errors');
  const previousByBot = new Map(previousBots.map((item) => [String(item.bot), NUMBER(item.visits)]));
  const botRows = currentBots
    .map((item) => {
      const bot = botById(String(item.bot));
      return {
        id: bot.id,
        name: bot.name,
        operator: bot.operator,
        purpose: bot.purpose,
        visits: NUMBER(item.visits),
        previous: compared ? previousByBot.get(bot.id) ?? 0 : null,
        pages: NUMBER(item.pages),
        errors: NUMBER(item.errors),
        lastDay: String(item.last_day),
      };
    })
    .sort((a, b) => b.visits - a.visits);
  const referralDays = NUMBER(of(days, 'c')[0]?.referral_days);
  const readsReferrals = connection.capabilities.referrals && referralDays > 0;
  const referralRows = of(referrals, 'c');
  const operatorVisits = new Map<string, { operator: string; visits: number; referrals: number }>();
  for (const bot of botRows) {
    const entry = operatorVisits.get(bot.operator) ?? { operator: bot.operator, visits: 0, referrals: 0 };
    entry.visits += bot.visits;
    operatorVisits.set(bot.operator, entry);
  }
  for (const item of referralRows) {
    const operator = referrerOperator(String(item.host));
    if (!operator) continue;
    const entry = operatorVisits.get(operator) ?? { operator, visits: 0, referrals: 0 };
    entry.referrals += NUMBER(item.visits);
    operatorVisits.set(operator, entry);
  }
  // The LLMs: the current period's visits by LLM (its hosts summed), the earlier period's beside them when compared.
  const llmRows = new Map<string, LlmRow>();
  for (const item of referralRows) {
    const llm = referrerOf(String(item.host));
    if (!llm) continue;
    const entry = llmRows.get(llm.id) ?? { id: llm.id, name: llm.name, operator: llm.operator, visits: 0, previous: null, pages: 0, lastDay: '' };
    entry.visits += NUMBER(item.visits);
    if (String(item.day) > entry.lastDay) entry.lastDay = String(item.day);
    llmRows.set(llm.id, entry);
  }
  if (compared && NUMBER(of(days, 'p')[0]?.referral_days))
    for (const entry of llmRows.values())
      entry.previous = of(referrals, 'p').filter((item) => referrerOf(String(item.host))?.id === entry.id).reduce((total, item) => total + NUMBER(item.visits), 0);
  const landingPaths = new Map<string, { path: string; visits: number; llms: Set<string> }>();
  const pagesByLlm = new Map<string, Set<string>>();
  for (const item of landingRows) {
    const llm = referrerOf(String(item.host));
    if (!llm) continue;
    const path = String(item.path);
    const entry = landingPaths.get(path) ?? { path, visits: 0, llms: new Set<string>() };
    entry.visits += NUMBER(item.visits);
    entry.llms.add(llm.id);
    landingPaths.set(path, entry);
    pagesByLlm.set(llm.id, (pagesByLlm.get(llm.id) ?? new Set<string>()).add(path));
  }
  for (const entry of llmRows.values()) entry.pages = pagesByLlm.get(entry.id)?.size ?? 0;
  // The trend: a day the collection read is a number (0 when no bot came); a day it did not read stays empty, never 0.
  const read = new Set(coveredDays.map((item) => String(item.day)));
  const trendRows = new Map<string, TrendRow>();
  for (let day = current.from; day < current.to; day = addDays(day, 1))
    if (read.has(day)) trendRows.set(day, { date: day, training: 0, search: 0, user: 0 });
  for (const item of trend) {
    const entry = trendRows.get(String(item.day));
    if (entry) entry[botById(String(item.bot)).purpose] += NUMBER(item.visits);
  }
  // The visits from AI answers per day: a day whose referrals were read is a number for every LLM of the period.
  const llmTrendRows = new Map<string, LlmTrendRow>();
  const landingsFrom = sitePages[0]?.landings_from ? String(sitePages[0].landings_from) : null;
  if (readsReferrals)
    for (const item of coveredDays)
      // One page's visits are kept only from the first day with landing pages: an earlier day was not read for it.
      if (item.referrals !== null && item.referrals !== undefined && (!filter.page || (landingsFrom && String(item.day) >= landingsFrom)))
        llmTrendRows.set(String(item.day), Object.fromEntries([['date', String(item.day)], ...[...llmRows.keys()].map((id) => [id, 0])]) as LlmTrendRow);
  for (const item of referralRows) {
    const entry = llmTrendRows.get(String(item.day));
    const llm = referrerOf(String(item.host));
    if (entry && llm && llm.id in entry) entry[llm.id] = NUMBER(entry[llm.id]) + NUMBER(item.visits);
  }
  const statusTotals = new Map<StatusClass, number>();
  for (const item of statuses) {
    const key = statusClass(NUMBER(item.status));
    statusTotals.set(key, (statusTotals.get(key) ?? 0) + NUMBER(item.visits));
  }
  return {
    connection,
    period: {
      from: current.from,
      to: addDays(current.to, -1),
      compareFrom: previous ? previous.from : null,
      compareTo: previous ? addDays(previous.to, -1) : null,
      days: daysBetween(current.from, current.to),
      covered,
      previousCovered,
      compared,
    },
    totals: {
      visits,
      previousVisits: compared ? previousVisits : null,
      requests: NUMBER(of(days, 'c')[0]?.requests),
      pages: NUMBER(of(pages, 'c')[0]?.pages),
      previousPages: compared ? NUMBER(of(pages, 'p')[0]?.pages) : null,
      sitePages: connection.capabilities.pages ? NUMBER(sitePages[0]?.pages) || null : null,
      bots: botRows.length,
      previousBots: compared ? previousBots.length : null,
      operators: new Set(botRows.map((bot) => bot.operator)).size,
      errors,
      previousErrorRate: compared && previousVisits ? previousErrors / previousVisits : null,
      referrals: readsReferrals ? sum(referralRows, 'visits') : null,
      previousReferrals: readsReferrals && compared && NUMBER(of(days, 'p')[0]?.referral_days) ? sum(of(referrals, 'p'), 'visits') : null,
      landingPages: readsReferrals ? landingPaths.size : null,
    },
    trend: [...trendRows.values()],
    bots: botRows,
    operators: [...operatorVisits.values()].sort((a, b) => b.visits - a.visits),
    pages: top.map((item) => ({ path: String(item.path), visits: NUMBER(item.visits), bots: NUMBER(item.bots), cited: cited.has(pathKey(String(item.path))) })),
    statuses: STATUS_CLASSES.map((status) => ({ status, visits: statusTotals.get(status) ?? 0 })).filter((item) => item.visits > 0),
    llms: readsReferrals ? [...llmRows.values()].sort((a, b) => b.visits - a.visits) : [],
    llmTrend: [...llmTrendRows.values()].sort((a, b) => a.date.localeCompare(b.date)),
    landings: [...landingPaths.values()]
      .sort((a, b) => b.visits - a.visits || a.path.localeCompare(b.path))
      .slice(0, 25)
      .map((item) => ({ path: item.path, visits: item.visits, llms: item.llms.size, cited: cited.has(pathKey(item.path)) })),
    landingsFrom,
  };
}
