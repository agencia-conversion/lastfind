import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from './env';

/** The scheduler's lease: `runTick` (./monitor) renews it (`renewLease`) before each step and before each engine's paid submission, and stops once it is lost. */
export const MONITOR_LEASE = { key: 'monitor', ms: 270000 } as const;
/** The cron expression (wrangler.cloud.json) whose invocation runs `operations` instead of `tick`; offset from the monitoring cron. */
export const OPERATIONS_CRON = '2,7,12,17,22,27,32,37,42,47,52,57 * * * *';
/** The project operations' own lease: they run in their own invocation, never inside the monitoring tick. */
export const OPERATIONS_LEASE = { key: 'operations', ms: 270000 } as const;
/**
 * D1 refused a statement because the database's queue is full (a burst of reads at the start of a tick): the statement did not run,
 * so the same work may wait a little and go again. The scheduler's steps and the project runners back off on it instead of failing.
 */
export const d1Overloaded = (error: unknown) => error instanceof Error && /D1 DB is overloaded/i.test(error.message);
/** How long a step that met an overloaded D1 waits before each new try; each wait gets up to half again at random, so the callers that met it together do not return together. */
export const OVERLOAD_WAITS_MS = [2_000, 6_000] as const;
export async function overloadBackOff<T>(work: () => Promise<T>, waits: readonly number[] = OVERLOAD_WAITS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= waits.length || !d1Overloaded(error)) throw error;
      await new Promise((done) => setTimeout(done, waits[attempt] * (1 + Math.random() / 2)));
    }
  }
}
/**
 * Releases the lease, asked again on any D1 error (three tries). It never throws: a release that still fails leaves the lease to
 * expire on its own, and must not replace the error of the work it guarded (12/11/2026: a failed release turned every preview
 * publication into a 500 that held the lock, so each later call answered 409 "already running").
 */
// An overloaded D1 refuses for a 10 s window: the waits outlast it (12/11/2026, a preview's lock release met it).
async function release(key: string, owner: string, waits: readonly number[] = [2_000, 6_000, 11_000]) {
  for (let attempt = 0; ; attempt++)
    try {
      await db().prepare('DELETE FROM job_leases WHERE key=? AND owner=?').bind(key, owner).run();
      return;
    } catch (error) {
      if (attempt >= waits.length) {
        console.error('Lease not released; it expires on its own.', key, error instanceof Error ? error.message : String(error));
        return;
      }
      await new Promise((done) => setTimeout(done, waits[attempt]));
    }
}
// The owner token travels with the execution that took the lease, so a later tick never renews or deletes another's.
const held = new AsyncLocalStorage<Record<string, string>>();

export async function withLease<T>(
  key: string,
  durationMs: number,
  work: () => Promise<T>,
): Promise<T | null> {
  const owner = crypto.randomUUID();
  // The claim is one guarded INSERT: refused by an overloaded D1 it did not run, so it is asked again after a wait.
  const claim = await overloadBackOff(() =>
    db()
      .prepare(`INSERT INTO job_leases(key,owner,expires_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
    WHERE job_leases.expires_at<=?`)
      .bind(key, owner, Date.now() + durationMs, Date.now())
      .run(),
  );
  if (!claim.meta.changes) return null;
  try {
    return await held.run({ ...held.getStore(), [key]: owner }, work);
  } finally {
    await release(key, owner);
  }
}

/**
 * Extends the lease this run holds and says whether it is still ours. Work that spends money asks before each request and
 * stops when it is not: a lease that expired may already belong to another tick. Outside a lease (a direct call) there is nothing to lose.
 */
export async function renewLease(key: string, durationMs: number) {
  const mine = held.getStore();
  if (!mine) return true;
  const owner = mine[key];
  if (!owner) return false;
  const renewed = await db()
    .prepare('UPDATE job_leases SET expires_at=? WHERE key=? AND owner=? AND expires_at>?')
    .bind(Date.now() + durationMs, key, owner, Date.now())
    .run();
  return renewed.meta.changes > 0;
}
