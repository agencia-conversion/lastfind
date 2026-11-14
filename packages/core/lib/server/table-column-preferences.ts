import { db, now } from './env';
import { ApiError, textField } from './http';

const KEY = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_HIDDEN = 40;

function parseHidden(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 64).slice(0, MAX_HIDDEN);
  } catch {
    return [];
  }
}

export function tableKey(value: unknown): string {
  const key = textField(value, 'table', 1, 64);
  if (!KEY.test(key)) throw new ApiError(400, 'Invalid table key.');
  return key;
}

export async function readHiddenColumns(
  userId: string,
  key: string,
): Promise<{ hidden: string[]; saved: boolean }> {
  const row = await db()
    .prepare('SELECT hidden_json FROM table_column_preferences WHERE user_id=? AND table_key=?')
    .bind(userId, key)
    .first<{ hidden_json: string }>();
  if (!row) return { hidden: [], saved: false };
  return { hidden: parseHidden(row.hidden_json), saved: true };
}

/** Every table the account saved, in one read: the app asks once per page instead of once per table. */
export async function readAllHiddenColumns(userId: string): Promise<{ tables: Record<string, string[]> }> {
  const { results } = await db()
    .prepare('SELECT table_key,hidden_json FROM table_column_preferences WHERE user_id=?')
    .bind(userId)
    .all<{ table_key: string; hidden_json: string }>();
  return { tables: Object.fromEntries(results.filter((row) => KEY.test(row.table_key)).map((row) => [row.table_key, parseHidden(row.hidden_json)])) };
}

export async function writeHiddenColumns(
  userId: string,
  key: string,
  hidden: unknown,
): Promise<{ hidden: string[]; saved: boolean }> {
  if (!Array.isArray(hidden)) throw new ApiError(400, 'hidden must be an array of column keys.');
  const next = hidden
    .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 64)
    .slice(0, MAX_HIDDEN);
  await db()
    .prepare(
      'INSERT INTO table_column_preferences(user_id,table_key,hidden_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,table_key) DO UPDATE SET hidden_json=excluded.hidden_json, updated_at=excluded.updated_at',
    )
    .bind(userId, key, JSON.stringify(next), now())
    .run();
  return { hidden: next, saved: true };
}
