// The first run's state in the database (lib/setup-state.ts is the rule): the first admin's key hash and email, the hash of the
// one-time setup token, and when the setup wizard finished, as platform_settings rows the app already loads before every request
// (INSTANCE_SETTINGS).
import { db, now, setting, workerSetting } from '@/lib/server/env';
import { loadPlatformSettings } from '@/lib/server/platform-settings';
import { secureEqual } from '@/lib/server/secure-equal';
import { accessKeyHash, ownerKeyHash } from '@edition/lib/owner-session';
import { setupStage, type SetupStage } from '@edition/lib/setup-state';

const audit = (actor: string, key: string) =>
  db().prepare("INSERT INTO admin_audit_log(at,actor,action,key) VALUES(?,?,'set',?)").bind(now(), actor, key);

/** Records that setup is finished (once; a second call changes nothing) and makes it visible to this isolate at once. */
export async function markSetupComplete(actor: string) {
  const at = now();
  await db().batch([
    db().prepare("INSERT INTO platform_settings(key,value,secret,updated_at,updated_by) VALUES('SETUP_COMPLETED_AT',?,0,?,?) ON CONFLICT(key) DO NOTHING").bind(at, at, actor),
    audit(actor, 'SETUP_COMPLETED_AT'),
  ]);
  await loadPlatformSettings(true);
}

export async function currentSetupStage(): Promise<SetupStage> {
  // Finished: already in memory (loaded before every app request), so a finished installation reads nothing more.
  if (setting('SETUP_COMPLETED_AT')) return 'done';
  // Until then read the database again: another isolate may have just created the admin or finished.
  await loadPlatformSettings(true);
  if (setting('SETUP_COMPLETED_AT')) return 'done';
  const projects = !!(await db().prepare('SELECT 1 AS found FROM projects LIMIT 1').first());
  // An installation in use before the wizard existed is done: recorded once, so its next request reads nothing.
  if (projects) await markSetupComplete('setup');
  const stage = setupStage({ owner: !!(await ownerKeyHash(setting)), completed: false, projects });
  if (stage === 'admin') await ensureSetupToken();
  return stage;
}

/**
 * The admin step asks for a one-time setup token, so a stranger who opens a new installation first cannot take it: the
 * deployment's SETUP_TOKEN secret, or, without one, a token this installation generates once and prints once to its log
 * (`wrangler tail`). Only its hash is kept.
 */
export async function ensureSetupToken() {
  if (workerSetting('SETUP_TOKEN') || setting('SETUP_TOKEN_HASH')) return;
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const stored = await db()
    .prepare("INSERT INTO platform_settings(key,value,secret,updated_at,updated_by) VALUES('SETUP_TOKEN_HASH',?,0,?,'setup') ON CONFLICT(key) DO NOTHING")
    .bind(await accessKeyHash(token), now())
    .run();
  // Only the request that stored it prints it: the token is in the log once.
  if (stored.meta.changes) console.log(`Lastfind setup token, shown once (the setup wizard asks for it): ${token}`);
  await loadPlatformSettings(true);
}

/** Wrong setup tokens one address may send in a window before every attempt from it is refused. */
export const SETUP_TOKEN_ATTEMPTS = 5;
export const SETUP_TOKEN_WINDOW_MS = 15 * 60_000;
/**
 * Why the admin step refuses `token` from `address`: 403 (missing or wrong; counted), 429 (too many wrong ones from that address
 * in the window; not even compared), or null when it is right. Compared as SHA-256 hashes, in constant time.
 */
export async function setupTokenRefusal(token: unknown, address: string): Promise<403 | 429 | null> {
  // The address only as a hash (the login limiter does the same): no client address is kept in the database.
  const key = `setup_token_failures:${await accessKeyHash(address)}`;
  const at = Date.now();
  const row = await db().prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{ value: string }>();
  const last = row ? (JSON.parse(row.value) as { since: number; count: number }) : null;
  const failures = last && at - last.since < SETUP_TOKEN_WINDOW_MS ? last : null;
  if (failures && failures.count >= SETUP_TOKEN_ATTEMPTS) return 429;
  const own = workerSetting('SETUP_TOKEN');
  const expected = own ? await accessKeyHash(own) : setting('SETUP_TOKEN_HASH');
  if (typeof token === 'string' && token && token.length <= 256 && /^[a-f0-9]{64}$/.test(expected) && secureEqual(await accessKeyHash(token), expected)) return null;
  // ponytail: read-then-write, so concurrent wrong guesses can undercount by a few; a 256-bit token makes that harmless.
  await db().batch([
    db()
      .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(key, JSON.stringify({ since: failures?.since ?? at, count: (failures?.count ?? 0) + 1 })),
    // Windows that passed are dropped on the way, so the rows never outlive their use.
    db().prepare("DELETE FROM system_state WHERE key LIKE 'setup_token_failures:%' AND json_extract(value,'$.since')<?").bind(at - SETUP_TOKEN_WINDOW_MS),
  ]);
  return 403;
}

/**
 * Creates the first admin: its key's hash and email. One statement decides it, so of two people finishing the form at once
 * only one gets the installation; false when there was already an admin (or the installation was in use).
 */
export async function createFirstAdmin(email: string, keyHash: string) {
  const at = now();
  const database = db();
  const [created] = await database.batch([
    database
      .prepare(
        `INSERT INTO platform_settings(key,value,secret,updated_at,updated_by) SELECT 'OWNER_ACCESS_KEY_HASH',?,0,?,'setup'
         WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE key IN ('OWNER_ACCESS_KEY_HASH','SETUP_COMPLETED_AT')) AND NOT EXISTS (SELECT 1 FROM projects)`,
      )
      .bind(keyHash, at),
    database
      .prepare(
        `INSERT INTO platform_settings(key,value,secret,updated_at,updated_by) SELECT 'OWNER_EMAIL',?,0,?,'setup'
         WHERE (SELECT value FROM platform_settings WHERE key='OWNER_ACCESS_KEY_HASH')=? ON CONFLICT(key) DO NOTHING`,
      )
      .bind(email, at, keyHash),
  ]);
  if (!created?.meta.changes) return false;
  await audit(email, 'OWNER_ACCESS_KEY_HASH').run();
  await loadPlatformSettings(true);
  return true;
}
