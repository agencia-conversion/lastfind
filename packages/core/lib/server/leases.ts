import { db } from './env';

export async function withLease<T>(
  key: string,
  durationMs: number,
  work: () => Promise<T>,
): Promise<T | null> {
  const owner = crypto.randomUUID();
  const claim = await db()
    .prepare(`INSERT INTO job_leases(key,owner,expires_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
    WHERE job_leases.expires_at<=?`)
    .bind(key, owner, Date.now() + durationMs, Date.now())
    .run();
  if (!claim.meta.changes) return null;
  try {
    return await work();
  } finally {
    await db()
      .prepare('DELETE FROM job_leases WHERE key=? AND owner=?')
      .bind(key, owner)
      .run();
  }
}
