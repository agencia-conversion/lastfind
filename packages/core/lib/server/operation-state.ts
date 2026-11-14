import { db, now } from '@/lib/server/env';

/** A fixed, requested operation kept in `system_state`; the workflow writes the request and the Worker tick answers it. */
export type Operation = { status?: string; requestedAt?: string; [field: string]: unknown };

export async function readOperation(key: string) {
  const record = await db().prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{ value: string }>();
  if (!record) return null;
  let operation: Operation | null;
  try {
    operation = JSON.parse(record.value) as Operation | null;
  } catch {
    operation = null;
  }
  const valid = operation && typeof operation === 'object' ? operation : null;
  if (!valid) {
    // An unreadable request is invalid: replace it once with a valid failed state so a new request can
    // follow, instead of throwing on every tick and starving the other operations.
    await db()
      .prepare('UPDATE system_state SET value=? WHERE key=? AND value=?')
      .bind(JSON.stringify({ status: 'failed', failedAt: now(), error: 'The stored request is invalid.' }), key, record.value)
      .run();
    return null;
  }
  return { operation: valid, raw: record.value };
}

export function writer(key: string, operation: Operation, raw: string) {
  let current = raw;
  return async (next: Operation) => {
    const value = JSON.stringify({ requestedAt: operation.requestedAt, ...next });
    await db().prepare('UPDATE system_state SET value=? WHERE key=? AND value=?').bind(value, key, current).run();
    current = value;
  };
}
