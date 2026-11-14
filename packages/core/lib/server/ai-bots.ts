import { waitUntil } from 'cloudflare:workers';
import {
  addDays,
  dayOf,
  dayQuery,
  dayVariables,
  graphqlProblem,
  llmById,
  parseDay,
  partsFor,
  pathKey,
  periodDays,
  reportStatements,
  shapeReport,
  type AiBotsConnection,
  type BotDay,
  type QueryPart,
  type ReportFilter,
  type ZoneCapabilities,
} from '@/lib/ai-bots';
import { exampleBotDays } from '@/lib/ai-bots-fixture';
import type { StoreScope } from '@/lib/project-store-contract';
import { db, now, setting } from './env';
import { ApiError } from './http';
import { withLease } from './leases';
import { credentialKeys, openSecret, sealSecret } from './platform-settings';
import { ensureProjectStore } from './project-store';
import { projectStoreRpc } from './project-store-transport';
import { CLOUDFLARE_API } from './provider-check';
import { parseReportFilter } from './report-filter';
import { sourceKey } from './source-sql';

/**
 * AI bots (lib/ai-bots.ts): each project may connect its own Cloudflare zone with a read-only API token the customer creates
 * (Account Analytics Read, Zone Analytics Read, Zone Read). The token is sealed like the credentials saved in Admin
 * (`sealSecret`, CREDENTIALS_KEY) and never leaves the server. A daily collection (the scheduler's `ai-bots` step, and a
 * read of the screen when it is due) reads each whole UTC day once from the GraphQL Analytics API (the same API base as
 * Admin's Cloudflare check, provider-check.ts) and keeps it in the
 * project's store, so the history grows past the 31 days Cloudflare keeps. Cloudflare's API is free: no paid call here.
 */
const REQUEST_TIMEOUT_MS = 20_000;
/** Days read on connection: Cloudflare keeps at least 31 days of these analytics on every plan. */
export const BACKFILL_DAYS = 30;
/**
 * GraphQL requests the scheduler sends per tick, all projects together: Cloudflare allows 300 per 5 minutes per user, and a
 * tick runs every 5 minutes, so even every project on one person's token stays well under it.
 */
export const REQUESTS_PER_TICK = 60;
/** A screen read that finds the collection due reads at most this many days itself (a preview has no scheduler). */
const REQUESTS_PER_READ = 8;
const SYNC_LEASE_MS = 120_000;
/** The daily collection runs after this UTC hour, when the day before is whole in Cloudflare's analytics. */
const DAILY_HOUR = 1;

type ConnectionRow = {
  project_id: string;
  workspace_id: string;
  token_sealed: string | null;
  token_hint: string | null;
  zone_id: string | null;
  zone_name: string | null;
  plan: string | null;
  paid: number;
  capabilities_json: string;
  state: 'zone' | 'active' | 'invalid' | 'none';
  problem: string | null;
  preview: number;
  connected_at: string;
  connected_by: string | null;
  last_sync_at: string | null;
  synced_through: string | null;
  next_sync_at: string | null;
  updated_at: string;
};
export type Zone = { id: string; name: string; plan: string; paid: boolean };
/** Why a token cannot be used: `auth` (not active, or refused), `zones` (it sees no zone), `analytics` (no analytics access), `network`. */
export type TokenProblem = 'auth' | 'zones' | 'analytics' | 'network';

const capabilitiesOf = (row: ConnectionRow): ZoneCapabilities => {
  try {
    const value = JSON.parse(row.capabilities_json) as Partial<ZoneCapabilities>;
    return { pages: value.pages === true, referrals: value.referrals === true, ...(typeof value.utm === 'boolean' ? { utm: value.utm } : {}) };
  } catch {
    return { pages: false, referrals: false };
  }
};
const readConnection = (projectId: string, workspaceId: string) =>
  db().prepare('SELECT * FROM ai_bot_connections WHERE project_id=? AND workspace_id=?').bind(projectId, workspaceId).first<ConnectionRow>();

export function connectionView(row: ConnectionRow | null, canManage: boolean): AiBotsConnection {
  const state = !row || row.state === 'none' ? 'none' : row.state;
  return {
    state,
    zone: row?.zone_name ?? null,
    plan: row?.plan ?? null,
    paid: !!row?.paid,
    capabilities: row ? capabilitiesOf(row) : { pages: false, referrals: false },
    tokenHint: row?.token_hint ?? null,
    connectedAt: row?.connected_at ?? null,
    lastSyncAt: row?.last_sync_at ?? null,
    backfilling: state === 'active' && !row?.preview && (!row?.synced_through || row.synced_through < addDays(dayOf(now()), -1)),
    problem: state === 'invalid' ? (row?.problem === 'zone' ? 'zone' : 'auth') : null,
    preview: !!row?.preview,
    canManage,
  };
}

// --- Cloudflare's API ---------------------------------------------------------------------------------------------------

async function call(token: string, path: string, init: RequestInit = {}) {
  try {
    const response = await fetch(`${CLOUDFLARE_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: response.status, data };
  } catch {
    return { status: 0, data: null };
  }
}
const planOf = (zone: Record<string, unknown>) => {
  const plan = (zone.plan ?? {}) as { name?: unknown; legacy_id?: unknown; is_subscribed?: unknown; price?: unknown };
  const name = typeof plan.name === 'string' ? plan.name : 'Unknown plan';
  const id = typeof plan.legacy_id === 'string' ? plan.legacy_id : '';
  return { plan: name, paid: id ? id !== 'free' : !/free/i.test(name) };
};

/** The zones a token sees (a page of up to 50; more is rare for one person's token), or why it cannot be used. */
export async function tokenZones(token: string): Promise<{ zones: Zone[] } | { problem: TokenProblem }> {
  const verify = await call(token, '/user/tokens/verify');
  if (!verify.status) return { problem: 'network' };
  if (verify.status === 401 || verify.status === 403 || (verify.data?.result as { status?: string } | undefined)?.status !== 'active') return { problem: 'auth' };
  const listed = await call(token, '/zones?per_page=50&status=active');
  if (!listed.status) return { problem: 'network' };
  const result = Array.isArray(listed.data?.result) ? (listed.data.result as Record<string, unknown>[]) : [];
  const zones = result
    .filter((zone) => typeof zone.id === 'string' && typeof zone.name === 'string')
    .map((zone) => ({ id: String(zone.id), name: String(zone.name), ...planOf(zone) }));
  return zones.length ? { zones } : { problem: 'zones' };
}

async function graphql(token: string, parts: QueryPart[], zoneTag: string, day: string) {
  const answer = await call(token, '/graphql', { method: 'POST', body: JSON.stringify({ query: dayQuery(parts), variables: dayVariables(zoneTag, day) }) });
  if (!answer.status) return { problem: 'network' as const, data: null };
  if (answer.status === 401 || answer.status === 403) return { problem: 'auth' as const, data: null };
  if (answer.status === 429) return { problem: 'budget' as const, data: null };
  const problem = graphqlProblem(answer.data?.errors) ?? (answer.status >= 400 || !answer.data?.data ? 'other' : null);
  return { problem, data: answer.data?.data ?? null };
}

/**
 * What a token can read on a zone, part by part (feature detection instead of assuming the plan's fields): the bots' requests
 * are required; the site's pages and the AI referrals are kept only when the zone answers them (referrals: paid plans).
 */
export async function probeZone(token: string, zoneId: string): Promise<{ capabilities: ZoneCapabilities } | { problem: TokenProblem }> {
  const day = addDays(dayOf(now()), -1);
  const bots = await graphql(token, ['bots', 'total'], zoneId, day);
  if (bots.problem === 'network') return { problem: 'network' };
  if (bots.problem) return { problem: 'analytics' };
  const [pages, referrals, utm] = await Promise.all([graphql(token, ['pages'], zoneId, day), graphql(token, ['referrals'], zoneId, day), graphql(token, ['utm'], zoneId, day)]);
  return { capabilities: { pages: !pages.problem, referrals: !referrals.problem, utm: !utm.problem } };
}

// --- The connection ---------------------------------------------------------------------------------------------------

const MAX_TOKEN = 200;
function tokenField(value: unknown) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token || token.length > MAX_TOKEN || !/^[\w-]+$/.test(token)) throw new ApiError(400, 'Enter the key.');
  return token;
}
async function openToken(row: ConnectionRow) {
  if (!row.token_sealed) return null;
  for (const key of credentialKeys()) {
    const value = await openSecret(row.token_sealed, key);
    if (value !== null) return value;
  }
  return null;
}
const storeScope = async (projectId: string, workspaceId: string): Promise<StoreScope> => ({
  ownerId: workspaceId,
  projectId,
  generation: (await ensureProjectStore(projectId, workspaceId)).generation,
});

/**
 * Step 1: a token pasted in the connect dialog. Checked against Cloudflare before anything is saved; a valid one is sealed and
 * kept (`zone`, or the zone it already had when the token is a replacement), and its zones are returned to choose from.
 */
export async function saveToken(projectId: string, workspaceId: string, actorId: string, value: unknown) {
  const token = tokenField(value);
  const found = await tokenZones(token);
  if ('problem' in found) return { ok: false as const, problem: found.problem };
  const key = credentialKeys()[0];
  if (!key) throw new ApiError(503, 'Could not complete this operation. Please try again.');
  const sealed = await sealSecret(token, key);
  const stamp = now();
  const previous = await readConnection(projectId, workspaceId);
  // A replacement for the zone already connected keeps collecting it; anything else waits for the zone to be chosen.
  const keeps = previous?.zone_id && found.zones.some((zone) => zone.id === previous.zone_id) && previous.state !== 'none';
  await db()
    .prepare(
      `INSERT INTO ai_bot_connections(project_id,workspace_id,token_sealed,token_hint,state,problem,preview,connected_at,connected_by,updated_at)
       VALUES(?,?,?,?,?,NULL,0,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET workspace_id=excluded.workspace_id,token_sealed=excluded.token_sealed,token_hint=excluded.token_hint,
         state=CASE WHEN ? THEN 'active' ELSE 'zone' END,problem=NULL,preview=0,connected_by=excluded.connected_by,updated_at=excluded.updated_at,
         next_sync_at=CASE WHEN ? THEN ? ELSE ai_bot_connections.next_sync_at END`,
    )
    .bind(projectId, workspaceId, sealed, token.slice(-4), 'zone', stamp, actorId, stamp, keeps ? 1 : 0, keeps ? 1 : 0, stamp)
    .run();
  return { ok: true as const, zones: found.zones, current: keeps ? previous!.zone_id : null };
}

/** The zones the saved token sees, to choose from again (a connection waiting for its zone). */
export async function savedTokenZones(projectId: string, workspaceId: string) {
  const row = await readConnection(projectId, workspaceId);
  const token = row && (await openToken(row));
  if (!row || !token) return { ok: false as const, problem: 'auth' as const };
  const found = await tokenZones(token);
  return 'problem' in found ? { ok: false as const, problem: found.problem } : { ok: true as const, zones: found.zones, current: row.zone_id };
}

/** Step 2: the zone of the site. A zone other than the one collected before starts a new history (the old one is cleared). */
export async function chooseZone(projectId: string, workspaceId: string, zoneId: unknown) {
  if (typeof zoneId !== 'string' || !/^[a-f0-9]{32}$/.test(zoneId)) throw new ApiError(400, 'Invalid value.');
  const row = await readConnection(projectId, workspaceId);
  const token = row && (await openToken(row));
  if (!row || !token) throw new ApiError(409, 'Try again.');
  const found = await tokenZones(token);
  if ('problem' in found) return { ok: false as const, problem: found.problem };
  const zone = found.zones.find((item) => item.id === zoneId);
  if (!zone) return { ok: false as const, problem: 'zones' as const };
  const probed = await probeZone(token, zone.id);
  if ('problem' in probed) return { ok: false as const, problem: probed.problem };
  const changed = row.zone_id !== zone.id || !!row.preview;
  if (changed) await projectStoreRpc({ scope: await storeScope(projectId, workspaceId), action: 'bots-clear' });
  const stamp = now();
  await db()
    .prepare(
      `UPDATE ai_bot_connections SET zone_id=?,zone_name=?,plan=?,paid=?,capabilities_json=?,state='active',problem=NULL,preview=0,
         synced_through=CASE WHEN ? THEN NULL ELSE synced_through END,last_sync_at=CASE WHEN ? THEN NULL ELSE last_sync_at END,
         connected_at=CASE WHEN ? THEN ? ELSE connected_at END,next_sync_at=?,updated_at=? WHERE project_id=? AND workspace_id=?`,
    )
    .bind(zone.id, zone.name, zone.plan, zone.paid ? 1 : 0, JSON.stringify(probed.capabilities), changed ? 1 : 0, changed ? 1 : 0, changed ? 1 : 0, stamp, stamp, stamp, projectId, workspaceId)
    .run();
  // The first days are read right away, after the answer (the scheduler goes on with the rest).
  waitUntil(syncProject(projectId, workspaceId, REQUESTS_PER_READ).catch(() => {}));
  return { ok: true as const };
}

/** Disconnect: the token is forgotten at once; the days already collected stay for a reconnection of the same zone. */
export async function disconnect(projectId: string, workspaceId: string) {
  await db()
    .prepare("UPDATE ai_bot_connections SET token_sealed=NULL,token_hint=NULL,state='none',problem=NULL,next_sync_at=NULL,updated_at=? WHERE project_id=? AND workspace_id=?")
    .bind(now(), projectId, workspaceId)
    .run();
}

// --- Collection -------------------------------------------------------------------------------------------------------

const nextDaily = (stamp: string) => `${addDays(dayOf(stamp), 1)}T0${DAILY_HOUR}:00:00.000Z`;
type SyncOutcome = { requests: number; budget: boolean };

/**
 * Reads the days a project still lacks, the oldest first, up to `limit` requests: from the day after the last whole day kept
 * (on connection, 30 days back) to today, whose partial day is read again on every run. A refused token marks the
 * connection invalid; Cloudflare's rate limit stops the run (`budget`) for the next tick.
 */
export async function syncProject(projectId: string, workspaceId: string, limit: number): Promise<SyncOutcome> {
  const outcome = await withLease(`ai-bots:${projectId}`, SYNC_LEASE_MS, async (): Promise<SyncOutcome> => {
    const row = await readConnection(projectId, workspaceId);
    if (!row || row.state !== 'active' || row.preview || !row.zone_id) return { requests: 0, budget: false };
    const token = await openToken(row);
    if (!token) {
      await markInvalid(row, 'auth');
      return { requests: 0, budget: false };
    }
    const today = dayOf(now());
    const oldest = addDays(today, -BACKFILL_DAYS);
    let day = row.synced_through && row.synced_through >= oldest ? addDays(row.synced_through, 1) : oldest;
    const capabilities = capabilitiesOf(row);
    const scope = await storeScope(projectId, workspaceId);
    let requests = 0, stored = 0, failed = false, budget = false;
    let syncedThrough = row.synced_through;
    // A zone connected before the `utm_source` visits were read (13/11/2026) finds out once whether it answers them; when it
    // does, its window is read again so its earlier days count them too. A network or rate-limit answer leaves it to the next run.
    if (capabilities.referrals && capabilities.utm === undefined) {
      const probe = await graphql(token, ['utm'], row.zone_id, addDays(today, -1));
      requests++;
      if (!probe.problem || probe.problem === 'other') {
        capabilities.utm = !probe.problem;
        await db().prepare('UPDATE ai_bot_connections SET capabilities_json=? WHERE project_id=? AND workspace_id=?').bind(JSON.stringify(capabilities), projectId, workspaceId).run();
        if (capabilities.utm) day = oldest;
      }
    }
    while (day <= today && requests < limit) {
      const answer = await graphql(token, partsFor(capabilities), row.zone_id, day);
      requests++;
      if (answer.problem === 'auth') {
        await markInvalid(row, 'auth');
        return { requests, budget: false };
      }
      if (answer.problem) {
        budget = answer.problem === 'budget';
        failed = true;
        break;
      }
      const parsed: BotDay = parseDay(day, answer.data, { complete: day < today, referrals: capabilities.referrals });
      await projectStoreRpc({ scope, action: 'bots-put', days: [parsed], syncedAt: now() });
      stored++;
      if (day < today) syncedThrough = day;
      day = addDays(day, 1);
    }
    const stamp = now();
    // Done: tomorrow after DAILY_HOUR. Stopped by the limit: the next tick goes on. A failed answer: an hour later.
    const next = day > today ? nextDaily(stamp) : failed && !budget ? new Date(Date.now() + 3_600_000).toISOString() : stamp;
    await db()
      .prepare('UPDATE ai_bot_connections SET synced_through=?,last_sync_at=?,next_sync_at=?,updated_at=? WHERE project_id=? AND workspace_id=?')
      .bind(syncedThrough, stored ? stamp : row.last_sync_at, next, stamp, projectId, workspaceId)
      .run();
    return { requests, budget };
  });
  return outcome ?? { requests: 0, budget: false };
}
async function markInvalid(row: ConnectionRow, problem: 'auth' | 'zone') {
  await db()
    .prepare("UPDATE ai_bot_connections SET state='invalid',problem=?,next_sync_at=NULL,updated_at=? WHERE project_id=? AND workspace_id=?")
    .bind(problem, now(), row.project_id, row.workspace_id)
    .run();
}

/** The scheduler's step: the due projects, the longest waiting first, within REQUESTS_PER_TICK requests and 60 seconds. */
export async function syncAiBots() {
  const deadline = Date.now() + 60_000;
  const due = (
    await db()
      .prepare("SELECT project_id,workspace_id FROM ai_bot_connections WHERE state='active' AND preview=0 AND next_sync_at<=? ORDER BY next_sync_at LIMIT 20")
      .bind(now())
      .all<{ project_id: string; workspace_id: string }>()
  ).results;
  let requests = 0;
  for (const row of due) {
    if (requests >= REQUESTS_PER_TICK || Date.now() > deadline) break;
    try {
      const outcome = await syncProject(row.project_id, row.workspace_id, Math.min(BACKFILL_DAYS + 1, REQUESTS_PER_TICK - requests));
      requests += outcome.requests;
      if (outcome.budget) break;
    } catch (error) {
      console.error('AI bots collection failed for a project.', error instanceof Error ? error.message : String(error));
    }
  }
  return requests;
}

/**
 * Landing pages for the days collected before 13/11/2026 (an operations action, `ai-bots-reread`): each active connection whose
 * zone reports referrals and whose store holds no landing page for the window's first day reads its last 30 days again through
 * the daily collection (`synced_through` moved back; the scheduler's step, or a screen read, reads them, each day replacing
 * itself). Cloudflare's analytics API is free and the step is bounded per tick. Idempotent: a project already read is skipped,
 * and reading a day twice keeps one copy. `dryRun` (the default) only lists what would be read. `projectId` narrows it.
 */
export async function rereadLandings({ projectId = null, dryRun = true }: { projectId?: string | null; dryRun?: boolean }) {
  const rows = (
    await db()
      .prepare(`SELECT project_id,workspace_id,capabilities_json FROM ai_bot_connections WHERE state='active' AND preview=0${projectId ? ' AND project_id=?' : ''}`)
      .bind(...(projectId ? [projectId] : []))
      .all<{ project_id: string; workspace_id: string; capabilities_json: string }>()
  ).results;
  const oldest = addDays(dayOf(now()), -BACKFILL_DAYS);
  const projects: { projectId: string; result: 'queued' | 'done' | 'free' }[] = [];
  for (const row of rows) {
    let referrals = false;
    try {
      referrals = (JSON.parse(row.capabilities_json) as Partial<ZoneCapabilities>).referrals === true;
    } catch {
      // Unreadable capabilities: nothing to read again.
    }
    if (!referrals) {
      projects.push({ projectId: row.project_id, result: 'free' });
      continue;
    }
    const [first] = await projectStoreRpc<{ results: { day: string | null }[] }[]>({
      scope: await storeScope(row.project_id, row.workspace_id),
      action: 'query',
      statements: [{ sql: 'SELECT MIN(day) day FROM referral_pages', params: [] }],
    });
    const from = first?.results?.[0]?.day ?? null;
    if (from && from <= oldest) {
      projects.push({ projectId: row.project_id, result: 'done' });
      continue;
    }
    if (!dryRun)
      await db()
        .prepare("UPDATE ai_bot_connections SET synced_through=?,next_sync_at=?,updated_at=? WHERE project_id=? AND workspace_id=? AND state='active'")
        .bind(addDays(oldest, -1), now(), now(), row.project_id, row.workspace_id)
        .run();
    projects.push({ projectId: row.project_id, result: 'queued' });
  }
  return { dryRun, projects };
}

// --- Preview example data ---------------------------------------------------------------------------------------------

/** The preview's QA projects that show example data (the synthetic project and the QA copies of the imported ones). */
const PREVIEW_PROJECT = /^(?:preview-geo|prod-[a-z0-9]+)-qa$/;
/** On a preview, the QA project's first read writes example days (a paid zone; the Apple copy a Free one), marked as such. */
/** The example data's version (in `connected_by` of a preview row): a newer one, or a new day, writes the example again. */
const PREVIEW_EXAMPLE = 'preview-example-v3';
async function seedPreview(projectId: string, workspaceId: string, project: Record<string, unknown>) {
  if (setting('PREVIEW_MODE') !== 'true' || !PREVIEW_PROJECT.test(projectId)) return null;
  const free = projectId === 'prod-apple-qa';
  const domain = String(project.domain || 'example.test');
  const scope = await storeScope(projectId, workspaceId);
  const today = dayOf(now());
  const cited = await citedPaths(scope, [domain], `${addDays(today, -90)}T00:00:00.000Z`, now()).catch(() => new Set<string>());
  const days = exampleBotDays({ today, paths: [...cited].slice(0, 12), referrals: !free });
  await projectStoreRpc({ scope, action: 'bots-clear' });
  for (let index = 0; index < days.length; index += 20) await projectStoreRpc({ scope, action: 'bots-put', days: days.slice(index, index + 20), syncedAt: now() });
  const stamp = now();
  await db()
    .prepare(
      `INSERT INTO ai_bot_connections(project_id,workspace_id,zone_id,zone_name,plan,paid,capabilities_json,state,preview,connected_at,connected_by,last_sync_at,synced_through,updated_at)
       VALUES(?,?,NULL,?,?,?,?,'active',1,?,?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET connected_by=excluded.connected_by,last_sync_at=excluded.last_sync_at,synced_through=excluded.synced_through,updated_at=excluded.updated_at
       WHERE ai_bot_connections.preview=1`,
    )
    .bind(projectId, workspaceId, domain, free ? 'Free Website' : 'Pro Website', free ? 0 : 1, JSON.stringify({ pages: true, referrals: !free }), stamp, PREVIEW_EXAMPLE, stamp, addDays(today, -1), stamp)
    .run();
  return readConnection(projectId, workspaceId);
}

// --- The report -------------------------------------------------------------------------------------------------------

/** The paths of the project's own pages that monitored answers cited in `[start, end)`. */
async function citedPaths(scope: StoreScope, domains: string[], start: string, end: string) {
  const hosts = [...new Set(domains.map((domain) => domain.toLowerCase().replace(/^www\./, '')).filter(Boolean))].slice(0, 20);
  if (!hosts.length) return new Set<string>();
  const [result] = await projectStoreRpc<{ results: { url: string | null }[] }[]>({
    scope,
    action: 'query',
    statements: [
      {
        sql: `SELECT DISTINCT json_extract(s.value,'$.url') url FROM runs r,json_each(r.sources_json) s
          WHERE r.status='complete' AND r.response_available=1 AND r.created_at>=? AND r.created_at<? AND ${sourceKey('s', 'domain')} IN (${hosts.map(() => '?').join(',')}) LIMIT 5000`,
        params: [start, end, ...hosts],
      },
    ],
  });
  const paths = new Set<string>();
  for (const { url } of result?.results ?? []) {
    try {
      if (url) paths.add(pathKey(new URL(url).pathname));
    } catch {
      // Not an address: nothing to match.
    }
  }
  return paths;
}

/** The drill down an address asks for (`bot`, `llm`, `page`): a value that names nothing known is left out. */
export function reportFilter(query: URLSearchParams): ReportFilter {
  const bot = query.get('bot') ?? '';
  const llm = query.get('llm') ?? '';
  const page = query.get('page') ?? '';
  return {
    bot: /^[a-z0-9-]{1,64}$/.test(bot) ? bot : null,
    llm: llmById(llm) ? llm : null,
    page: page.startsWith('/') && page.length <= 512 ? page : null,
  };
}

/**
 * The screen's read: the connection, and once it collects, the period's report from the project's store (`connection=only`:
 * the connection alone, for Settings).
 */
export async function aiBotsReport(projectId: string, workspaceId: string, project: Record<string, unknown>, query: URLSearchParams, canManage: boolean) {
  let row = await readConnection(projectId, workspaceId);
  // A preview's example data follows the calendar and its version (a real connection is never touched).
  if (!row || (row.preview && (row.connected_by !== PREVIEW_EXAMPLE || row.synced_through !== addDays(dayOf(now()), -1))))
    row = (await seedPreview(projectId, workspaceId, project)) ?? row;
  const connection = connectionView(row, canManage);
  if (!row || (connection.state !== 'active' && connection.state !== 'invalid') || query.get('connection') === 'only') return { connection, report: null };
  // Due (a preview has no scheduler; production's tick usually came first): a few days are read after this answer.
  if (row.state === 'active' && !row.preview && row.next_sync_at && row.next_sync_at <= now())
    waitUntil(syncProject(projectId, workspaceId, REQUESTS_PER_READ).catch(() => {}));
  const filter = parseReportFilter(query);
  const current = periodDays(filter.cutoff, filter.end);
  const previous = periodDays(filter.previousCutoff, filter.previousEnd);
  const scope = await storeScope(projectId, workspaceId);
  const drill = reportFilter(query);
  const results = (await projectStoreRpc<{ results: Record<string, unknown>[] }[]>({ scope, action: 'query', statements: reportStatements(current, previous, drill) })).map(
    (result) => result.results,
  );
  const domains = [String(project.domain || ''), ...(JSON.parse(String(project.additional_domains_json || '[]')) as string[])];
  const cited = await citedPaths(scope, domains, filter.cutoff, filter.end);
  return { connection, report: shapeReport({ connection, results, current, previous, cited, filter: drill }) };
}
