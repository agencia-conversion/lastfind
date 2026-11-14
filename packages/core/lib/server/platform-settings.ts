import { db, now, setting } from './env';
import {
  forgetStoredSettings,
  replaceStoredSettings,
  storedSettingsFresh,
} from './stored-settings';

/**
 * Settings an admin saves in the app (Admin > Providers, Admin > Classifiers), kept in control D1 `platform_settings`.
 *
 * Precedence. A credential saved here wins over the Worker's own secret or variable of the same name (`wrangler secret
 * put`, `npm run setup`, a `vars` entry), so an admin can replace a credential from the app; removing the saved one
 * goes back to the Worker's. A stored classifier model wins over `LASTFIND_CLASSIFIER_MODELS`, which wins over the
 * code default (`classifier-models.ts`).
 *
 * At rest. A credential is sealed with AES-GCM (256-bit) under a key derived by HKDF-SHA-256 from `CREDENTIALS_KEY`
 * (a Worker secret of its own, so `SESSION_SECRET` can rotate without touching credentials), or from `SESSION_SECRET`
 * on an installation that has no `CREDENTIALS_KEY` yet. A value is opened with `CREDENTIALS_KEY` first, then with
 * `SESSION_SECRET`, so rows sealed before the key existed stay readable; saving one again seals it with the new key.
 * The database alone does not reveal a credential; a key that opens none of them makes Admin ask for them again. A credential never leaves the server: the API says only whether it is set, where it comes
 * from and a short hint. Every change is written to `admin_audit_log` (who, what key, when; never a value).
 */
export const PROVIDER_SECRETS = [
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
  'OPENROUTER_API_KEY',
  // Model providers called directly, in the order Admin saves (`LLM_PROVIDER_ORDER`, lib/model-providers.ts).
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  // Admin > Usage and costs, Cloudflare. The account ID is not secret; it is saved here only where the Worker has none.
  'CLOUDFLARE_ANALYTICS_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
] as const;
export type ProviderSecret = (typeof PROVIDER_SECRETS)[number];
/** Plain settings Admin saves (not sealed): the model providers' order and the agent's learning switch. */
export const PLAIN_SETTINGS = ['LLM_PROVIDER_ORDER', 'AGENT_LEARNING_DISABLED'] as const;
const plain = (key: string) => (PLAIN_SETTINGS as readonly string[]).includes(key);
/**
 * The independent edition's first run (apps/selfhost/server/setup.ts) writes these rows: the first admin's email and key hash, the
 * hash of the one-time setup token it generated, and when the setup wizard finished. Read like the Worker's own values (a Worker value of the same name loses to them), never
 * saved through Admin.
 */
export const INSTANCE_SETTINGS = ['OWNER_ACCESS_KEY_HASH', 'OWNER_EMAIL', 'SETUP_COMPLETED_AT', 'SETUP_TOKEN_HASH'] as const;
const instance = (key: string) => (INSTANCE_SETTINGS as readonly string[]).includes(key);
export const CLASSIFIER_SETTING_PREFIX = 'classifier:';
const SETTING_KEY = /^(?:[A-Z][A-Z0-9_]{2,63}|classifier:[a-z][a-z0-9_]{1,39})$/;
const MAX_VALUE = 512;

const encode = (text: string) => new TextEncoder().encode(text);
const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));

async function cipherKey(secret: string) {
  if (encode(secret).length < 32) throw new Error('The credentials key is too short to seal settings.');
  const base = await crypto.subtle.importKey('raw', encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encode('lastfind-platform-settings'), info: encode('aes-gcm-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
/** `v1.<iv>.<ciphertext>` (base64url): the form a credential takes in the database. */
export async function sealSecret(value: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cipherKey(secret), encode(value));
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(bytes))}`;
}
/** The credential a sealed value holds, or null when the secret is not the one that sealed it. */
export async function openSecret(sealed: string, secret: string) {
  const match = /^v1\.([\w-]{16})\.([\w-]+)$/.exec(sealed);
  if (!match) return null;
  try {
    const bytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(match[1]) },
      await cipherKey(secret),
      fromBase64Url(match[2]),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** The keys a credential may be sealed under, the one new values use first. A short value is never a key. */
export function credentialKeys() {
  // Never a stored row: Admin saves only provider keys and classifier models (PROVIDER_SECRETS, `classifier:*`).
  return [setting('CREDENTIALS_KEY'), setting('SESSION_SECRET')].filter((key) => encode(key).length >= 32);
}
async function openWithAny(sealed: string, keys: string[]) {
  for (const key of keys) {
    const value = await openSecret(sealed, key);
    if (value !== null) return value;
  }
  return null;
}

type Row = { key: string; value: string; secret: number };
/**
 * Fill the in-memory copy from the database (once a minute per isolate, or now with `force`). A database that cannot
 * answer, or an installation whose migration has not run yet, simply keeps the Worker's own variables.
 */
export async function loadPlatformSettings(force = false) {
  if (!force && storedSettingsFresh()) return;
  let rows: Row[];
  try {
    rows = (await db().prepare('SELECT key,value,secret FROM platform_settings').all<Row>()).results;
  } catch {
    return;
  }
  const entries: [string, string][] = [];
  const failed: string[] = [];
  // Never a stored row (only what Admin can save is read below): the Worker's own secrets.
  const keys = credentialKeys();
  for (const row of rows) {
    // Only what Admin (or the first-run setup) can save is read: no other row can stand in for a Worker setting.
    if (!(PROVIDER_SECRETS as readonly string[]).includes(row.key) && !plain(row.key) && !instance(row.key) && !row.key.startsWith(CLASSIFIER_SETTING_PREFIX)) continue;
    if (!row.secret) {
      entries.push([row.key, row.value]);
      continue;
    }
    const value = await openWithAny(row.value, keys);
    if (value === null) failed.push(row.key);
    else entries.push([row.key, value]);
  }
  replaceStoredSettings(entries, failed);
}

export class PlatformSettingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
/**
 * Save or clear (empty value) one setting and record who did it. Credentials are sealed before the write; the
 * in-memory copy is refreshed at once so the next request already uses the new value.
 */
export async function savePlatformSetting(key: string, value: string, actor: string) {
  if (!SETTING_KEY.test(key)) throw new PlatformSettingError(400, 'Unknown setting.');
  const secret = (PROVIDER_SECRETS as readonly string[]).includes(key);
  if (!secret && !plain(key) && !key.startsWith(CLASSIFIER_SETTING_PREFIX)) throw new PlatformSettingError(400, 'Unknown setting.');
  const trimmed = value.trim();
  if (trimmed.length > MAX_VALUE || /[\r\n]/.test(trimmed)) throw new PlatformSettingError(400, 'Invalid value.');
  const stamp = now();
  const stored = !trimmed ? null : secret ? await sealSecret(trimmed, credentialKeys()[0] ?? '') : trimmed;
  const database = db();
  await database.batch([
    stored === null
      ? database.prepare('DELETE FROM platform_settings WHERE key=?').bind(key)
      : database
          .prepare(
            `INSERT INTO platform_settings(key,value,secret,updated_at,updated_by) VALUES(?,?,?,?,?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value,secret=excluded.secret,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
          )
          .bind(key, stored, secret ? 1 : 0, stamp, actor),
    database
      .prepare('INSERT INTO admin_audit_log(at,actor,action,key) VALUES(?,?,?,?)')
      .bind(stamp, actor, stored === null ? 'clear' : 'set', key),
  ]);
  forgetStoredSettings();
  await loadPlatformSettings(true);
}

/** The latest changes, newest first: who, what key, when. Values are never recorded. */
export async function recentAdminAudit(limit = 20) {
  const { results } = await db()
    .prepare('SELECT at,actor,action,key FROM admin_audit_log ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<{ at: string; actor: string; action: string; key: string }>();
  return results;
}

/** The value in effect for a provider credential, read as the rest of the server reads it. */
export const providerSecret = (key: ProviderSecret) => setting(key);
