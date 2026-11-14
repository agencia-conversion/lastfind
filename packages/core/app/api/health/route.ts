import { isAdmin } from '@edition/lib/admin-access';
import { currentUser } from '@/lib/server/auth';
import { db, setting } from '@/lib/server/env';
import { json } from '@/lib/server/http';
import { secureEqual } from '@/lib/server/secure-equal';
import { monitoringStorageStatus } from '@/lib/server/monitoring-storage';
import { BLOCKED_FRESH_MS, BLOCKED_PREFIX } from '@/lib/platform-spend';
import { RECONCILE_WINDOW_MS } from '@/lib/reservations';

// The scheduler runs every 5 minutes; three missed ticks mean it stopped. The operations invocation runs every 5 minutes too.
const STALE_HEARTBEAT_MINUTES = 15;
// Payment-required answers from a provider in the last hour: a burst means its credit ran out (the 23/10 OpenRouter outage).
const CREDIT_REJECTIONS_LIMIT = 5;
/** One read of the counters per isolate in this window, whoever asks (a monitor, a deploy check, a crawler). */
const CACHE_MS = 30_000;

const minutesSince = (iso: unknown, at: number) =>
  typeof iso === 'string' && !Number.isNaN(Date.parse(iso)) ? Math.max(0, Math.floor((at - Date.parse(iso)) / 60000)) : null;
const list = (value: unknown) => {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.filter((step) => typeof step === 'string') : [];
  } catch {
    return [];
  }
};

type Report = { ok: boolean; body: Record<string, unknown>; scheduler: Record<string, unknown> | null };
let cached: { at: number; report: Report } | null = null;

async function report(): Promise<Report> {
  const storage = monitoringStorageStatus();
  const preview = setting('PREVIEW_MODE') === 'true';
  let database = false;
  try {
    await db().prepare('SELECT 1 AS ok').first();
    database = true;
  } catch {
    // Health describes capabilities without exposing database errors or secrets.
  }
  const problems: string[] = [];
  let scheduler: Record<string, unknown> | null = null;
  if (database)
    try {
      const at = Date.now();
      const hourAgo = new Date(at - 3600000).toISOString();
      const row = await db()
        .prepare(
          `WITH rejected AS (
            SELECT error FROM (
              SELECT error FROM brand_research_jobs WHERE status IN ('failed','unknown') AND completed_at>=?
              UNION ALL SELECT error FROM runs WHERE status IN ('failed','unknown') AND completed_at>=?)
            WHERE error LIKE '%HTTP 401%' OR error LIKE '%HTTP 402%' OR error LIKE '%HTTP 403%' OR error LIKE '%HTTP 429%')
          SELECT
            (SELECT value FROM system_state WHERE key='scheduler_heartbeat') AS heartbeat,
            (SELECT value FROM system_state WHERE key='scheduler_failed_steps') AS failed_steps,
            (SELECT value FROM system_state WHERE key='operations_heartbeat') AS operations_heartbeat,
            (SELECT value FROM system_state WHERE key='operations_failed_steps') AS operations_failed,
            (SELECT MIN(created_at) FROM runs WHERE status IN ('queued','submitting','pending')) AS oldest_open,
            (SELECT COUNT(*) FROM runs WHERE status='unknown') AS unknown_runs,
            (SELECT COUNT(*) FROM runs WHERE status='unknown' AND COALESCE(claimed_at,created_at)<?) AS unrecoverable_runs,
            (SELECT COUNT(*) FROM brand_research_jobs WHERE status='unknown') AS unknown_jobs,
            (SELECT COUNT(*) FROM brand_research_jobs WHERE status='unsettled') AS unsettled_jobs,
            (SELECT COUNT(*) FROM system_state WHERE key LIKE '${BLOCKED_PREFIX}%' AND json_extract(value,'$.at')>=?) AS budget_blocked,
            (SELECT COUNT(*) FROM project_store_outbox) AS publication_queue,
            (SELECT COUNT(*) FROM project_stores WHERE last_error IS NOT NULL) AS publication_errors,
            (SELECT COUNT(*) FROM project_store_dead_letters) AS dead_letters,
            (SELECT COUNT(*) FROM rejected) AS provider_rejections,
            (SELECT COUNT(*) FROM rejected WHERE error LIKE '%HTTP 402%') AS credit_rejections`,
        )
        .bind(hourAgo, hourAgo, new Date(at - RECONCILE_WINDOW_MS).toISOString(), new Date(at - BLOCKED_FRESH_MS).toISOString())
        .first<Record<string, unknown>>();
      scheduler = {
        heartbeatAgeMinutes: minutesSince(row?.heartbeat, at),
        failedSteps: list(row?.failed_steps),
        operationsHeartbeatAgeMinutes: minutesSince(row?.operations_heartbeat, at),
        operationsFailedSteps: list(row?.operations_failed),
        oldestOpenRunMinutes: minutesSince(row?.oldest_open, at),
        unknownRuns: Number(row?.unknown_runs ?? 0),
        unrecoverableRuns: Number(row?.unrecoverable_runs ?? 0),
        unknownJobs: Number(row?.unknown_jobs ?? 0),
        unsettledJobs: Number(row?.unsettled_jobs ?? 0),
        budgetBlocked: Number(row?.budget_blocked ?? 0),
        publicationQueue: Number(row?.publication_queue ?? 0),
        publicationErrors: Number(row?.publication_errors ?? 0),
        deadLetters: Number(row?.dead_letters ?? 0),
        providerRejectionsLastHour: Number(row?.provider_rejections ?? 0),
        creditRejectionsLastHour: Number(row?.credit_rejections ?? 0),
      };
      // A preview has no cron, and an installation whose scheduler never ran yet has no heartbeat: neither is stale.
      const monitored = !!setting('DATAFORSEO_LOGIN') && !!setting('DATAFORSEO_PASSWORD') && !preview;
      const age = scheduler.heartbeatAgeMinutes as number | null;
      if (monitored && age !== null && age > STALE_HEARTBEAT_MINUTES) problems.push('scheduler_stale');
      // The operations invocation (its own cron): stale once it ran before and stopped.
      const operationsAge = scheduler.operationsHeartbeatAgeMinutes as number | null;
      if (!preview && operationsAge !== null && operationsAge > STALE_HEARTBEAT_MINUTES) problems.push('operations_stale');
      if ((scheduler.creditRejectionsLastHour as number) >= CREDIT_REJECTIONS_LIMIT) problems.push('provider_credit');
    } catch {
      // The counters are best effort: a database that answers is still reported, without them.
    }
  const ok = database && storage.ready && !problems.length;
  return {
    ok,
    scheduler,
    body: {
      ok,
      service: 'lastfind',
      database,
      rawArchive: storage.rawArchive,
      projectStorage: storage.projectStorage,
      problems,
      ...(preview ? { previewSha: setting('PREVIEW_SHA') || null } : {}),
    },
  };
}

/** The counters are for an operator: `Authorization: Bearer <HEALTH_TOKEN>`, or a signed-in Lastfind admin (Admin > Overview). */
async function operator(request?: Request) {
  const token = setting('HEALTH_TOKEN');
  if (token && secureEqual(request?.headers.get('authorization') ?? '', `Bearer ${token}`)) return true;
  if (!request?.headers.get('cookie')) return false;
  return isAdmin(await currentUser().catch(() => null));
}

// Public, it answers ok, the service, the storage flags, the problems and (a preview) its revision, the fields the deploy
// checks and the uptime monitor read, from a copy at most CACHE_MS old. An operator gets the counters (counts and ages only,
// never a project, account or error text), read fresh.
export async function GET(request?: Request) {
  const detailed = await operator(request);
  const at = Date.now();
  let current: Report;
  if (detailed) current = await report();
  else {
    if (!cached || at - cached.at > CACHE_MS) cached = { at, report: await report() };
    current = cached.report;
  }
  const response = json(detailed ? { ...current.body, scheduler: current.scheduler } : current.body, current.ok ? 200 : 503);
  response.headers.set('cache-control', detailed ? 'private, no-store' : `public, max-age=${CACHE_MS / 1000}`);
  return response;
}
