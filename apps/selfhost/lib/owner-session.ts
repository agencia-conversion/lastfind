import { SignJWT, jwtVerify } from 'jose';
export const OWNER_SESSION_COOKIE = '__Host-lastfind-session';
/** The owner's session cookie (seven days), set by the sign-in and by the setup wizard when it creates the admin. */
export const ownerSessionCookie = (token: string) => `${OWNER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
export async function accessKeyHash(key: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/**
 * The owner key's SHA-256: `npm run setup` stores only the hash (`OWNER_ACCESS_KEY_HASH`); a one-click deploy, where the
 * owner types the key itself as a Worker secret, has `OWNER_ACCESS_KEY` (at least 32 characters) instead.
 */
export async function ownerKeyHash(read: (name: string) => string) {
  const hash = read('OWNER_ACCESS_KEY_HASH');
  if (hash) return hash;
  const key = read('OWNER_ACCESS_KEY');
  return key.length >= 32 ? accessKeyHash(key) : '';
}
/** Owner key tries one client address may make a minute (an IPv6 client by its /64; one shared bucket without Cloudflare's address). */
export const LOGIN_ATTEMPTS_PER_MINUTE = 10;
const LOGIN_WINDOW_MS = 60_000;
type Statements = { prepare(sql: string): { bind(...values: (string | number)[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } } };
/**
 * Counts one owner key try for `address` (kept only as a hash) in `system_state`, the minute's window in the row, and says
 * whether it still fits: an online guess of the typed key (a one-click deploy's `OWNER_ACCESS_KEY` can be a passphrase) is
 * bounded without a migration or an edge rule. Stale windows are dropped on the way.
 */
export async function reserveLoginAttempt(database: Statements, address: string, at = Date.now()) {
  const window = Math.floor(at / LOGIN_WINDOW_MS);
  const key = `login_attempts:${await accessKeyHash(address)}`;
  const row = await database
    .prepare(
      `INSERT INTO system_state(key,value) VALUES(?1,json_object('window',?2,'count',1))
       ON CONFLICT(key) DO UPDATE SET value=CASE WHEN json_extract(value,'$.window')=?2
         THEN json_set(value,'$.count',json_extract(value,'$.count')+1) ELSE json_object('window',?2,'count',1) END
       RETURNING json_extract(value,'$.count') AS count`,
    )
    .bind(key, window)
    .first<{ count: number }>();
  await database.prepare(`DELETE FROM system_state WHERE key LIKE 'login_attempts:%' AND json_extract(value,'$.window')<?`).bind(window).run();
  return (row?.count ?? 0) <= LOGIN_ATTEMPTS_PER_MINUTE;
}
export async function createOwnerSession(
  secret: string,
  credentialHash: string,
  origin: string,
) {
  if (secret.length < 32) throw new Error('Session secret is not configured');
  return new SignJWT({ credential: credentialHash })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('owner:local')
    .setIssuer(origin)
    .setAudience('lastfind-owner')
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}
export async function verifyOwnerSession(
  token: string,
  secret: string,
  credentialHash: string,
  origin: string,
) {
  if (secret.length < 32 || !/^[a-f0-9]{64}$/.test(credentialHash))
    return false;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { algorithms: ['HS256'], issuer: origin, audience: 'lastfind-owner' },
    );
    return (
      payload.sub === 'owner:local' && payload.credential === credentialHash
    );
  } catch {
    return false;
  }
}
