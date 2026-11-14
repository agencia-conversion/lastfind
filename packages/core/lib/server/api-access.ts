// AI apps (MCP): personal access tokens, OAuth 2.1 for AI apps, bearer verification and the audit of their changes.
// Both editions, on the control D1 (migration `*_mcp_access.sql`). Tokens are opaque (`lf_pat_`, `lf_at_`, `lf_rt_` + 43
// base64url characters); only their SHA-256 is stored. A credential is one grant of one account (a personal access token
// or one app connection), bound to one workspace or to all of the account's; every call re-checks the membership.
import { requireUser, resolveActor, roleAtLeast, workspaceChoices, type Actor, type User } from './auth';
import { appOrigin, db } from './env';
import { ApiError, body, fail, json, sameOrigin, textField } from './http';
import { digest } from './project-store-read';
import { secureEqual } from './secure-equal';
import { addressBucket } from '../address-bucket';
import { publicAddress } from '../cited-sources';

export const READ_SCOPE = 'lastfind:read';
export const WRITE_SCOPE = 'lastfind:write';
export type Scope = typeof READ_SCOPE | typeof WRITE_SCOPE;
/** A credential's scope as stored and shown: read, or read and write. */
export type ScopeValue = 'lastfind:read' | 'lastfind:read lastfind:write';
export const SCOPES: readonly Scope[] = [READ_SCOPE, WRITE_SCOPE];
export const RATE_LIMIT_PER_MINUTE = 60;
/** Active personal access tokens per account, and connected apps per account. */
export const CREDENTIAL_LIMIT = 20;
const MINUTE = 60_000,
  DAY = 86_400_000;
const ACCESS_SECONDS = 3600,
  REFRESH_DAYS = 30,
  CODE_MS = 5 * MINUTE,
  AUDIT_DAYS = 180,
  REGISTRATIONS_PER_HOUR = 100,
  /** From one client address (an IPv6 client by its /64), next to the installation-wide limit above. */
  REGISTRATIONS_PER_ADDRESS_HOUR = 10,
  /** A registered app nobody has used (no live connection, none used) for this long is removed. */
  CLIENT_UNUSED_DAYS = 30;
const iso = (ms: number) => new Date(ms).toISOString();

/** The MCP endpoint's canonical URL, the only audience tokens are issued for. */
export const mcpResource = () => `${appOrigin()}/mcp`;

// ---------------------------------------------------------------- tokens, hashes, PKCE

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomPart = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export const TOKEN_PATTERN = /^lf_(pat|at|rt)_[A-Za-z0-9_-]{43}$/;
export const newToken = (prefix: 'lf_pat_' | 'lf_at_' | 'lf_rt_') => prefix + randomPart();
/** What is stored for a token, refresh token, code or client secret: SHA-256 (hex). */
export const tokenHash = (value: string) => digest(value);
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;
/** RFC 7636 S256: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

// ---------------------------------------------------------------- bearer verification (MCP endpoint)

export type Credential = { id: string; kind: 'pat' | 'oauth'; scopes: Scope[]; workspaceId: string | null; clientId: string | null };
/** A verified token: the account it acts for and its credential. */
export type TokenAccess = { user: User; credential: Credential };
export type BearerFailure = {
  ok: false;
  status: 401 | 429;
  /** The `WWW-Authenticate` value (points at the protected resource metadata). */
  wwwAuthenticate: string;
  /** Seconds, for a 429's `Retry-After`. */
  retryAfter?: number;
};
export type BearerResult = { ok: true; access: TokenAccess } | BearerFailure;

/** `WWW-Authenticate: Bearer resource_metadata=…, scope=…[, error=…]`. */
export function bearerChallenge(error?: 'invalid_token' | 'insufficient_scope', scope = `${READ_SCOPE} ${WRITE_SCOPE}`) {
  return `Bearer resource_metadata="${appOrigin()}/.well-known/oauth-protected-resource/mcp", scope="${scope}"${error ? `, error="${error}"` : ''}`;
}
// Records the use and counts the minute's calls in the same statement that checks the token.
const VERIFY_SQL = `UPDATE api_credentials SET last_used_at=?1,
  rate_count=CASE WHEN rate_window=?2 THEN rate_count+1 ELSE 1 END, rate_window=?2
  FROM api_tokens t
  WHERE t.token_hash=?3 AND t.credential_id=api_credentials.id AND t.expires_at>?1
    AND api_credentials.expires_at>?1 AND api_credentials.revoked_at IS NULL
  RETURNING id, account_id, workspace_id, kind, scope, resource, client_id, rate_count`;
const TOKEN_ACCOUNT_SQL = `SELECT a.id, a.email, a.name FROM api_tokens t JOIN api_credentials c ON c.id=t.credential_id
  JOIN accounts a ON a.id=c.account_id WHERE t.token_hash=?`;
type VerifiedRow = { id: string; account_id: string; workspace_id: string | null; kind: 'pat' | 'oauth'; scope: string; resource: string; client_id: string | null; rate_count: number };

/**
 * `Authorization: Bearer lf_at_…|lf_pat_…`: one D1 round trip checks the token and its credential (not revoked, not
 * expired, audience `${appOrigin()}/mcp`), records the use and counts the 60 calls a minute. A token bound to a
 * workspace the account no longer belongs to is revoked and refused.
 */
export async function verifyBearer(request: Request): Promise<BearerResult> {
  const refused = (error?: 'invalid_token'): BearerFailure => ({ ok: false, status: 401, wwwAuthenticate: bearerChallenge(error) });
  const token = /^Bearer\s+(\S+)$/i.exec((request.headers.get('authorization') ?? '').trim())?.[1];
  if (!token) return refused();
  if (!TOKEN_PATTERN.test(token) || token.startsWith('lf_rt_')) return refused('invalid_token');
  const hash = await tokenHash(token),
    stamp = Date.now();
  const [used, account] = await db().batch([
    db().prepare(VERIFY_SQL).bind(iso(stamp), Math.floor(stamp / MINUTE), hash),
    db().prepare(TOKEN_ACCOUNT_SQL).bind(hash),
  ]);
  const row = used.results[0] as VerifiedRow | undefined,
    user = account.results[0] as User | undefined;
  if (!row || !user || row.resource !== mcpResource()) return refused('invalid_token');
  if (row.rate_count > RATE_LIMIT_PER_MINUTE)
    return { ok: false, status: 429, wwwAuthenticate: bearerChallenge(), retryAfter: 60 - (Math.floor(stamp / 1000) % 60) };
  const access: TokenAccess = {
    user: { id: user.id, email: user.email, name: user.name },
    credential: { id: row.id, kind: row.kind, scopes: scopesOf(row.scope), workspaceId: row.workspace_id, clientId: row.client_id },
  };
  // Removing a member cuts the tokens bound to that workspace.
  if (row.workspace_id && row.workspace_id !== user.id && !(await workspaceActor(access, row.workspace_id))) {
    await db().prepare('UPDATE api_credentials SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(iso(stamp), row.id).run();
    return refused('invalid_token');
  }
  return { ok: true, access };
}
const scopesOf = (scope: string): Scope[] => (scope.split(' ').includes(WRITE_SCOPE) ? [READ_SCOPE, WRITE_SCOPE] : [READ_SCOPE]);

/**
 * The actor a token acts as in one workspace (`workspaceId`): the edition's membership check on every call, the token's
 * workspace binding, and the role capped by the scopes (min(scope, role): a read token acts as a viewer). Null: out of
 * reach (not_found).
 */
export async function workspaceActor({ user, credential }: TokenAccess, workspaceId: string): Promise<Actor | null> {
  if (credential.workspaceId && credential.workspaceId !== workspaceId) return null;
  const actor = await resolveActor(user, workspaceId);
  if (actor.workspaceId !== workspaceId) return null;
  return credential.scopes.includes(WRITE_SCOPE) ? actor : { ...actor, role: 'viewer' };
}
/** Every workspace the token reaches, as actors (its bound one, or all of the account's). */
export async function accessActors(access: TokenAccess): Promise<Actor[]> {
  const { user, credential } = access;
  const own: Actor = { ...user, workspaceId: user.id, role: 'owner' };
  // The independent edition has no choices: its owner only.
  const choices = (credential.workspaceId ? undefined : await workspaceChoices(own)) as { id: string }[] | undefined;
  const ids = credential.workspaceId ? [credential.workspaceId] : (choices?.map((choice) => choice.id) ?? [user.id]);
  const actors = await Promise.all(ids.map((id) => workspaceActor(access, id)));
  return actors.filter((actor): actor is Actor => actor !== null);
}
/** The actor for a project's workspace; null when the project is missing, archived or out of the token's reach. */
export async function projectActor(access: TokenAccess, projectId: string): Promise<Actor | null> {
  if (typeof projectId !== 'string' || !projectId || projectId.length > 200) return null;
  const row = await db().prepare('SELECT workspace_id FROM projects WHERE id=? AND archived=0').bind(projectId).first<{ workspace_id: string }>();
  return row ? workspaceActor(access, row.workspace_id) : null;
}

export type AuditOutcome = 'ok' | 'error' | 'denied';
/** One audited change (a write tool): ids only, never free text. Rows older than 180 days are removed. */
export type AuditEntry = { credentialId: string; workspaceId: string; tool: string; target: string[]; outcome: AuditOutcome };
export async function audit({ credentialId, workspaceId, tool, target, outcome }: AuditEntry) {
  const ids = target
    .filter((id) => typeof id === 'string')
    .map((id) => id.replace(/[^\w:.@-]/g, '').slice(0, 128))
    .filter(Boolean)
    .join(',')
    .slice(0, 1000);
  const stamp = Date.now();
  await db().batch([
    db()
      .prepare('INSERT INTO api_audit_log(at,credential_id,workspace_id,tool,target,outcome) VALUES(?,?,?,?,?,?)')
      .bind(iso(stamp), credentialId, workspaceId, tool.replace(/[^\w-]/g, '').slice(0, 64), ids || null, outcome),
    db()
      .prepare('DELETE FROM api_audit_log WHERE id IN (SELECT id FROM api_audit_log WHERE at<? LIMIT 100)')
      .bind(iso(stamp - AUDIT_DAYS * DAY)),
  ]);
}

// ---------------------------------------------------------------- Settings › AI apps (`/api/tokens`)

export type CredentialView = {
  id: string;
  kind: 'pat' | 'oauth';
  name: string;
  /** Last 4 characters of a personal access token (`lf_pat_…abcd`); null for an app. */
  hint: string | null;
  workspace: { id: string; name: string } | null;
  scope: ScopeValue;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  client: { name: string; uri: string | null; verifiedHost: string | null } | null;
};
export type AuditRow = {
  id: number;
  at: string;
  credential_id: string;
  credential_name: string | null;
  tool: string;
  target: string | null;
  outcome: AuditOutcome;
};
export type AccessOverview = { credentials: CredentialView[]; audit: AuditRow[]; limit: number };
const CREDENTIALS_SQL = `SELECT c.id,c.kind,c.name,c.hint,c.workspace_id,w.name AS workspace_name,o.email AS workspace_email,c.scope,
    c.created_at,c.last_used_at,c.expires_at,c.client_id,oc.kind AS client_kind,oc.name AS client_name,oc.client_uri
  FROM api_credentials c LEFT JOIN workspaces w ON w.id=c.workspace_id LEFT JOIN accounts o ON o.id=w.owner_id LEFT JOIN oauth_clients oc ON oc.id=c.client_id
  WHERE c.account_id=?1 AND c.revoked_at IS NULL AND c.expires_at>?2 AND (?3 IS NULL OR c.id=?3)
  ORDER BY c.created_at DESC LIMIT 100`;
type CredentialRow = Omit<CredentialView, 'workspace' | 'client'> & {
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_email: string | null;
  client_id: string | null;
  client_kind: 'registered' | 'metadata' | null;
  client_name: string | null;
  client_uri: string | null;
};
const credentialView = (row: CredentialRow): CredentialView => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  hint: row.kind === 'pat' ? row.hint : null,
  workspace: row.workspace_id ? { id: row.workspace_id, name: row.workspace_name || row.workspace_email || row.workspace_id } : null,
  scope: row.scope,
  created_at: row.created_at,
  last_used_at: row.last_used_at,
  expires_at: row.expires_at,
  client: row.client_id
    ? { name: row.client_name || row.name, uri: row.client_uri, verifiedHost: row.client_kind === 'metadata' ? new URL(row.client_id).host : null }
    : null,
});
const credentials = async (user: User, id: string | null = null) =>
  (await db().prepare(CREDENTIALS_SQL).bind(user.id, iso(Date.now()), id).all<CredentialRow>()).results.map(credentialView);

/** Active credentials of the account (tokens and apps) and its last 20 audited changes. */
export async function accessOverview(user: User): Promise<AccessOverview> {
  const [list, log] = await Promise.all([
    credentials(user),
    db()
      .prepare(
        `SELECT l.id,l.at,l.credential_id,c.name AS credential_name,l.tool,l.target,l.outcome FROM api_audit_log l
          JOIN api_credentials c ON c.id=l.credential_id WHERE c.account_id=? ORDER BY l.id DESC LIMIT 20`,
      )
      .bind(user.id)
      .all<AuditRow>(),
  ]);
  return { credentials: list, audit: log.results, limit: CREDENTIAL_LIMIT };
}

const cleanText = (value: string) => value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
function scopeValue(value: unknown): ScopeValue {
  if (value !== READ_SCOPE && value !== `${READ_SCOPE} ${WRITE_SCOPE}`) throw new ApiError(400, 'Invalid value.');
  return value;
}
/** The workspace a grant is bound to (null: all of the account's); a change needs member or above there. */
async function grantWorkspace(user: User, value: unknown, scope: ScopeValue) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 200) throw new ApiError(400, 'Invalid value.');
  const actor = await resolveActor(user, value);
  if (actor.workspaceId !== value) throw new ApiError(404, 'Workspace not found.');
  if (scope.includes(WRITE_SCOPE) && !roleAtLeast(actor.role, 'member'))
    throw new ApiError(403, 'Your role in this workspace does not allow this action.');
  return value;
}

/** `{ name, workspace_id: string | null, scope, days: 30 | 90 | 365 }` → the token, shown once. */
export async function createToken(user: User, input: Record<string, unknown>): Promise<{ token: string; credential: CredentialView }> {
  const name = textField(typeof input.name === 'string' ? cleanText(input.name) : input.name, 'Nome', 1, 100);
  const scope = scopeValue(input.scope);
  const days = Number(input.days);
  if (![30, 90, 365].includes(days)) throw new ApiError(400, 'Invalid value.');
  const workspaceId = await grantWorkspace(user, input.workspace_id, scope);
  const token = newToken('lf_pat_'),
    id = crypto.randomUUID(),
    stamp = Date.now(),
    expires = iso(stamp + days * DAY);
  const [created] = await db().batch([
    db()
      .prepare(
        `INSERT INTO api_credentials(id,account_id,workspace_id,kind,name,scope,resource,hint,expires_at,created_at)
          SELECT ?1,?2,?3,'pat',?4,?5,?6,?7,?8,?9
          WHERE (SELECT COUNT(*) FROM api_credentials WHERE account_id=?2 AND kind='pat' AND revoked_at IS NULL AND expires_at>?9) < ${CREDENTIAL_LIMIT}`,
      )
      .bind(id, user.id, workspaceId, name, scope, mcpResource(), token.slice(-4), expires, iso(stamp)),
    db().prepare('INSERT INTO api_tokens(token_hash,credential_id,expires_at) SELECT ?,id,expires_at FROM api_credentials WHERE id=?').bind(await tokenHash(token), id),
    ...cleanup(stamp),
  ]);
  if (!created.meta.changes) throw new ApiError(409, 'You have reached the limit of 20 personal access tokens. Revoke one first.');
  const [credential] = await credentials(user, id);
  return { token, credential };
}
/** Revokes one of the account's credentials (token or app): immediate. */
export async function revokeCredential(user: User, id: unknown) {
  if (typeof id !== 'string' || !id || id.length > 100) throw new ApiError(400, 'Invalid value.');
  const result = await db()
    .prepare('UPDATE api_credentials SET revoked_at=? WHERE id=? AND account_id=? AND revoked_at IS NULL')
    .bind(iso(Date.now()), id, user.id)
    .run();
  if (!result.meta.changes) throw new ApiError(404, 'Access not found.');
}

/** Expired codes and tokens, and credentials and app registrations nobody uses: 100 rows of each per call. */
function cleanup(stamp: number) {
  return [
    db().prepare('DELETE FROM oauth_codes WHERE code_hash IN (SELECT code_hash FROM oauth_codes WHERE expires_at<=? LIMIT 100)').bind(iso(stamp)),
    db()
      .prepare(
        `DELETE FROM api_tokens WHERE token_hash IN (SELECT t.token_hash FROM api_tokens t JOIN api_credentials c ON c.id=t.credential_id
          WHERE t.expires_at<=?1 OR c.expires_at<=?1 OR c.revoked_at IS NOT NULL LIMIT 100)`,
      )
      .bind(iso(stamp)),
    db()
      .prepare('DELETE FROM api_credentials WHERE id IN (SELECT id FROM api_credentials WHERE coalesce(revoked_at,expires_at)<? LIMIT 100)')
      .bind(iso(stamp - AUDIT_DAYS * DAY)),
    // A registration nobody connected goes after 7 days; one whose connections are all gone (revoked or expired) and
    // were not used for CLIENT_UNUSED_DAYS goes too. A live connection keeps its app.
    db()
      .prepare(
        `DELETE FROM oauth_clients WHERE id IN (SELECT id FROM oauth_clients o WHERE kind='registered' AND created_at<?1
          AND NOT EXISTS (SELECT 1 FROM api_credentials c WHERE c.client_id=o.id
            AND ((c.revoked_at IS NULL AND c.expires_at>?3) OR coalesce(c.last_used_at,c.created_at)>?2))
          AND NOT EXISTS (SELECT 1 FROM oauth_codes k WHERE k.client_id=o.id) LIMIT 100)`,
      )
      .bind(iso(stamp - 7 * DAY), iso(stamp - CLIENT_UNUSED_DAYS * DAY), iso(stamp)),
  ];
}

// ---------------------------------------------------------------- OAuth clients: registration and metadata documents

export type OAuthClient = { id: string; kind: 'registered' | 'metadata'; name: string; uri: string | null; redirectUris: string[]; secretHash: string | null };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
// Never a return address: schemes that run code or reach files and other protocols.
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'filesystem:', 'view-source:', 'ftp:', 'ws:', 'wss:', 'mailto:', 'tel:', 'sms:', 'intent:', 'chrome:']);
const parse = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};
/**
 * A return address an app may register: https, http on loopback only (RFC 8252 §7.3), or a native app's private-use
 * scheme (RFC 8252 §7.1, e.g. `cursor://`). No fragment, no credentials.
 */
export function redirectUriAllowed(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000 || value.includes('#')) return false;
  const url = parse(value);
  if (!url || url.username || url.password) return false;
  if (url.protocol === 'https:') return !!url.hostname;
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !BLOCKED_SCHEMES.has(url.protocol);
}
/** Exact match; a loopback http address matches on any port (RFC 8252 §7.3). Never a prefix match. */
export function redirectMatches(registered: readonly string[], requested: string) {
  if (!redirectUriAllowed(requested)) return false;
  if (registered.includes(requested)) return true;
  const asked = parse(requested)!;
  if (asked.protocol !== 'http:' || !LOOPBACK.has(asked.hostname)) return false;
  return registered.some((value) => {
    const url = parse(value);
    return !!url && url.protocol === 'http:' && url.hostname === asked.hostname && url.pathname === asked.pathname && url.search === asked.search;
  });
}
const clientName = (value: unknown, fallback: string) => (typeof value === 'string' ? cleanText(value).slice(0, 100) : '') || fallback;
const httpsUri = (value: unknown) => (typeof value === 'string' && value.length <= 500 && parse(value)?.protocol === 'https:' ? value : null);
const hostOf = (value: string) => parse(value)?.host || parse(value)?.protocol.slice(0, -1) || 'app';

/**
 * A Client ID Metadata Document address we may fetch: https with a path, canonical, no IP literal, no local or internal
 * name, no port, not this application.
 */
export function metadataUrlAllowed(value: string) {
  const url = parse(value);
  // The product's one rule for a host it may read (publicAddress), plus https, a path and the canonical spelling.
  if (!url || url.href !== value || url.protocol !== 'https:' || url.hash || url.pathname === '/' || !publicAddress(value)) return false;
  let own = '';
  try {
    own = new URL(appOrigin()).hostname;
  } catch {
    /* No configured origin: nothing of ours to exclude. */
  }
  return url.hostname.toLowerCase() !== own;
}
async function boundedText(response: Response, limit: number) {
  if (Number(response.headers.get('content-length')) > limit) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0,
    text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text + decoder.decode();
    if ((size += value.byteLength) > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}
/** Fetches and checks a Client ID Metadata Document (5 s, 10 KB, no redirect, `client_id` equal to its address). */
export async function fetchClientMetadata(clientId: string, fetcher: typeof fetch = fetch): Promise<OAuthClient | null> {
  if (!metadataUrlAllowed(clientId)) return null;
  try {
    const response = await fetcher(clientId, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (response.status !== 200) return null;
    const text = await boundedText(response, 10_000);
    const doc = text ? JSON.parse(text) : null;
    if (!doc || typeof doc !== 'object' || doc.client_id !== clientId) return null;
    const uris = doc.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(redirectUriAllowed)) return null;
    if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== 'none') return null;
    return { id: clientId, kind: 'metadata', name: clientName(doc.client_name, new URL(clientId).host), uri: httpsUri(doc.client_uri), redirectUris: uris, secretHash: null };
  } catch {
    return null;
  }
}
type ClientRow = { id: string; kind: 'registered' | 'metadata'; name: string; client_uri: string | null; redirect_uris_json: string; secret_hash: string | null; fetched_at: string | null };
const clientFromRow = (row: ClientRow): OAuthClient => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  uri: row.client_uri,
  redirectUris: JSON.parse(row.redirect_uris_json),
  secretHash: row.secret_hash,
});
/** A registered app, or an app known by its metadata document (fetched again after 24 hours). */
export async function findClient(clientId: string, fetcher: typeof fetch = fetch): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 500) return null;
  const row = await db().prepare('SELECT * FROM oauth_clients WHERE id=?').bind(clientId).first<ClientRow>();
  if (!clientId.startsWith('https://')) return row?.kind === 'registered' ? clientFromRow(row) : null;
  if (row?.kind === 'metadata' && Date.parse(row.fetched_at ?? '') > Date.now() - DAY) return clientFromRow(row);
  const client = await fetchClientMetadata(clientId, fetcher);
  if (!client) return null;
  const stamp = iso(Date.now());
  await db()
    .prepare(
      `INSERT INTO oauth_clients(id,kind,name,client_uri,redirect_uris_json,fetched_at,created_at) VALUES(?1,'metadata',?2,?3,?4,?5,?5)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,client_uri=excluded.client_uri,redirect_uris_json=excluded.redirect_uris_json,fetched_at=excluded.fetched_at
        WHERE oauth_clients.kind='metadata'`,
    )
    .bind(client.id, client.name, client.uri, JSON.stringify(client.redirectUris), stamp)
    .run();
  return client;
}

// ---------------------------------------------------------------- OAuth 2.1 authorization

/** The resource an app asks for, normalised; missing means this server's MCP endpoint. Null: another resource. */
export function canonicalResource(value: string | null | undefined) {
  const canonical = mcpResource();
  if (!value) return canonical;
  const url = parse(value);
  if (!url || url.search || url.hash || url.username || url.password) return null;
  return url.origin + url.pathname.replace(/\/+$/, '') === canonical ? canonical : null;
}
/** Requested scopes, normalised; `offline_access` is implied (refresh tokens are always issued). Null: unknown scope. */
export function requestedScope(value: string | null | undefined): ScopeValue | null {
  const parts = (value ?? '').split(' ').filter((part) => part && part !== 'offline_access');
  if (parts.some((part) => !(SCOPES as readonly string[]).includes(part))) return null;
  return parts.includes(WRITE_SCOPE) ? `${READ_SCOPE} ${WRITE_SCOPE}` : READ_SCOPE;
}
/** The highest scope a role allows (min(scope, role)): changes need member or above. */
export const scopeForRole = (scope: ScopeValue, role: Actor['role']): ScopeValue => (roleAtLeast(role, 'member') ? scope : READ_SCOPE);

export type AuthorizationView =
  | { ok: false; error: string; message: string }
  | {
      ok: true;
      client: { id: string; name: string; uri: string | null; verifiedHost: string | null };
      redirectUri: string;
      scope: ScopeValue;
      /** Normalised echo: response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, resource. */
      params: Record<string, string>;
    };
const AUTHORIZATION_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'] as const;
/**
 * Validates an authorization request exactly as `POST /oauth/authorize` does, with no side effect (a client metadata
 * document may be fetched and cached). Invalid: show `message` (English, localised by `localizeApiError`), never redirect.
 */
export async function describeAuthorization(params: URLSearchParams, fetcher: typeof fetch = fetch): Promise<AuthorizationView> {
  const refuse = (error: string, message: string): AuthorizationView => ({ ok: false, error, message });
  const get = (key: string) => params.get(key) ?? '';
  if (AUTHORIZATION_PARAMS.some((key) => params.getAll(key).length > 1 || get(key).length > 2000))
    return refuse('invalid_request', 'This connection request is invalid.');
  if (get('response_type') !== 'code') return refuse('unsupported_response_type', 'This connection request is invalid.');
  const client = await findClient(get('client_id'), fetcher);
  if (!client) return refuse('invalid_client', 'This app is unknown, or its details could not be read.');
  const redirectUri = get('redirect_uri');
  if (!redirectMatches(client.redirectUris, redirectUri)) return refuse('invalid_request', 'The return address of this app does not match its registration.');
  if (get('code_challenge_method') !== 'S256' || !PKCE.test(get('code_challenge')))
    return refuse('invalid_request', 'This app must protect the connection with PKCE (S256).');
  const resource = canonicalResource(params.get('resource'));
  if (!resource) return refuse('invalid_target', 'This app asked for access to another server.');
  const scope = requestedScope(params.get('scope'));
  if (!scope) return refuse('invalid_scope', 'This app asked for permissions Lastfind does not offer.');
  const echo: Record<string, string> = {
    response_type: 'code',
    client_id: client.id,
    redirect_uri: redirectUri,
    code_challenge: get('code_challenge'),
    code_challenge_method: 'S256',
    scope,
    resource,
  };
  if (params.has('state')) echo.state = get('state');
  return {
    ok: true,
    client: { id: client.id, name: client.name, uri: client.uri, verifiedHost: client.kind === 'metadata' ? new URL(client.id).host : null },
    redirectUri,
    scope,
    params: echo,
  };
}

/** `POST /oauth/authorize` (JSON, same origin, signed in): `{ ...params, decision, scope, workspace_id }` → `{ redirect }`. */
export async function authorizeEndpoint(request: Request): Promise<Response> {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const data = await body(request);
    const params = new URLSearchParams();
    for (const key of AUTHORIZATION_PARAMS) {
      const value = data[key];
      if (typeof value === 'string') params.set(key, value);
    }
    const view = await describeAuthorization(params);
    if (!view.ok) throw new ApiError(400, view.message);
    const redirect = new URL(view.redirectUri);
    const answer = (values: Record<string, string>) => {
      for (const [key, value] of Object.entries({ ...values, ...(view.params.state !== undefined ? { state: view.params.state } : {}), iss: appOrigin() }))
        redirect.searchParams.set(key, value);
      return json({ redirect: redirect.href });
    };
    if (data.decision === 'deny') return answer({ error: 'access_denied' });
    if (data.decision !== 'approve') throw new ApiError(400, 'Invalid value.');
    // `scope` is what the person allowed on the consent screen (write stays off unless they tick it).
    const workspaceId = await grantWorkspace(user, data.workspace_id, view.scope);
    const stamp = Date.now();
    const active = await db()
      .prepare(
        `SELECT COUNT(*) AS n FROM api_credentials WHERE account_id=? AND kind='oauth' AND revoked_at IS NULL AND expires_at>?
          AND NOT (client_id=? AND workspace_id IS ?)`,
      )
      .bind(user.id, iso(stamp), view.client.id, workspaceId)
      .first<{ n: number }>();
    if ((active?.n ?? 0) >= CREDENTIAL_LIMIT) throw new ApiError(409, 'You have reached the limit of 20 connected apps. Disconnect one first.');
    const code = randomPart();
    await db().batch([
      db()
        .prepare(
          'INSERT INTO oauth_codes(code_hash,client_id,account_id,workspace_id,scope,resource,redirect_uri,code_challenge,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(await tokenHash(code), view.client.id, user.id, workspaceId, view.scope, view.params.resource, view.redirectUri, view.params.code_challenge, iso(stamp + CODE_MS)),
      ...cleanup(stamp),
    ]);
    return answer({ code });
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------- OAuth 2.1 token, registration, revocation endpoints

const oauthError = (error: string, status = 400, description?: string) =>
  Response.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: { 'Cache-Control': 'no-store', ...(status === 401 ? { 'WWW-Authenticate': 'Basic realm="lastfind"' } : {}) } },
  );
const tokenResponse = (value: Record<string, unknown>, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
/** An `application/x-www-form-urlencoded` body of at most 10 KB, every parameter at most once; null otherwise. */
async function formBody(request: Request) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) return null;
  if (Number(request.headers.get('content-length')) > 10_000) return null;
  const text = await request.text();
  if (text.length > 10_000) return null;
  const form = new URLSearchParams(text);
  for (const key of new Set(form.keys())) if (form.getAll(key).length > 1) return null;
  return form;
}
/** The app calling the token endpoint: public (client_id), or with its secret (post or basic). */
async function authenticatedClient(request: Request, form: URLSearchParams) {
  let clientId = form.get('client_id'),
    secret = form.get('client_secret');
  const basic = /^Basic\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (basic) {
    let pair: string[];
    try {
      pair = atob(basic).split(':').map(decodeURIComponent);
    } catch {
      return null;
    }
    if (pair.length !== 2 || (clientId && clientId !== pair[0])) return null;
    [clientId, secret] = pair;
  }
  const client = clientId ? await findClient(clientId) : null;
  if (!client) return null;
  if (client.secretHash && !(secret && secureEqual(await tokenHash(secret), client.secretHash))) return null;
  return client;
}

/** `POST /oauth/token` (form): authorization_code (PKCE S256, single-use code) and refresh_token (rotated on every use). */
export async function tokenEndpoint(request: Request): Promise<Response> {
  try {
    const form = await formBody(request);
    if (!form) return oauthError('invalid_request');
    const client = await authenticatedClient(request, form);
    if (!client) return oauthError('invalid_client', 401);
    if (form.has('resource') && !canonicalResource(form.get('resource'))) return oauthError('invalid_target');
    const stamp = Date.now(),
      access = newToken('lf_at_'),
      refresh = newToken('lf_rt_');
    const [accessHash, refreshHash] = await Promise.all([tokenHash(access), tokenHash(refresh)]);
    const accessExpiry = iso(stamp + ACCESS_SECONDS * 1000),
      refreshExpiry = iso(stamp + REFRESH_DAYS * DAY);
    const granted = (scope: ScopeValue) =>
      tokenResponse({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope });
    const grant = form.get('grant_type');
    if (grant === 'authorization_code') {
      const code = form.get('code') ?? '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return oauthError('invalid_grant');
      // Single use: the code is gone whatever happens next.
      const row = await db()
        .prepare('DELETE FROM oauth_codes WHERE code_hash=? RETURNING client_id,account_id,workspace_id,scope,resource,redirect_uri,code_challenge,expires_at')
        .bind(await tokenHash(code))
        .first<{ client_id: string; account_id: string; workspace_id: string | null; scope: ScopeValue; resource: string; redirect_uri: string; code_challenge: string; expires_at: string }>();
      const verifier = form.get('code_verifier') ?? '';
      if (
        !row ||
        row.expires_at <= iso(stamp) ||
        row.client_id !== client.id ||
        (form.has('redirect_uri') && row.redirect_uri !== form.get('redirect_uri')) ||
        !PKCE.test(verifier) ||
        (await pkceChallenge(verifier)) !== row.code_challenge
      )
        return oauthError('invalid_grant');
      if (form.has('resource') && canonicalResource(form.get('resource')) !== row.resource) return oauthError('invalid_target');
      const id = crypto.randomUUID();
      const [, created] = await db().batch([
        // Connecting the same app to the same workspace again replaces the earlier connection.
        db()
          .prepare("UPDATE api_credentials SET revoked_at=? WHERE account_id=? AND kind='oauth' AND client_id=? AND workspace_id IS ? AND revoked_at IS NULL")
          .bind(iso(stamp), row.account_id, client.id, row.workspace_id),
        db()
          .prepare(
            `INSERT INTO api_credentials(id,account_id,workspace_id,kind,name,client_id,scope,resource,refresh_hash,expires_at,created_at,last_used_at)
              SELECT ?1,?2,?3,'oauth',?4,?5,?6,?7,?8,?9,?10,?10
              WHERE (SELECT COUNT(*) FROM api_credentials WHERE account_id=?2 AND kind='oauth' AND revoked_at IS NULL AND expires_at>?10) < ${CREDENTIAL_LIMIT}`,
          )
          .bind(id, row.account_id, row.workspace_id, client.name, client.id, row.scope, row.resource, refreshHash, refreshExpiry, iso(stamp)),
        db().prepare('INSERT INTO api_tokens(token_hash,credential_id,expires_at) SELECT ?,id,? FROM api_credentials WHERE id=?').bind(accessHash, accessExpiry, id),
        ...cleanup(stamp),
      ]);
      if (!created.meta.changes) return oauthError('invalid_grant', 400, 'Connected apps limit reached.');
      return granted(row.scope);
    }
    if (grant === 'refresh_token') {
      const presented = form.get('refresh_token') ?? '';
      if (!/^lf_rt_[A-Za-z0-9_-]{43}$/.test(presented)) return oauthError('invalid_grant');
      // A narrower scope is not kept separately: the grant's own scope is returned (never a wider one).
      if (form.has('scope') && !requestedScope(form.get('scope'))) return oauthError('invalid_scope');
      const presentedHash = await tokenHash(presented);
      const [rotated] = await db().batch([
        db()
          .prepare(
            `UPDATE api_credentials SET previous_refresh_hash=refresh_hash, refresh_hash=?1, expires_at=?2, last_used_at=?3
              WHERE refresh_hash=?4 AND client_id=?5 AND revoked_at IS NULL AND expires_at>?3 RETURNING id, scope`,
          )
          .bind(refreshHash, refreshExpiry, iso(stamp), presentedHash, client.id),
        db().prepare('INSERT INTO api_tokens(token_hash,credential_id,expires_at) SELECT ?,id,? FROM api_credentials WHERE refresh_hash=?').bind(accessHash, accessExpiry, refreshHash),
      ]);
      const credential = rotated.results[0] as { id: string; scope: ScopeValue } | undefined;
      if (!credential) {
        // A refresh token that was already rotated is being replayed: the whole connection is revoked.
        await db().prepare('UPDATE api_credentials SET revoked_at=? WHERE previous_refresh_hash=? AND revoked_at IS NULL').bind(iso(stamp), presentedHash).run();
        return oauthError('invalid_grant');
      }
      return granted(credential.scope);
    }
    return oauthError('unsupported_grant_type');
  } catch (error) {
    console.error('OAuth token request failed:', error instanceof Error ? error.name : 'Unknown error');
    return oauthError('server_error', 500);
  }
}

/** The client's bucket only when Cloudflare supplied the request metadata (it sets `cf-connecting-ip` there); else one shared bucket. */
export function clientAddress(request: Request) {
  try {
    return (request as Request & { cf?: unknown }).cf ? addressBucket(request.headers.get('cf-connecting-ip')) : null;
  } catch {
    return null;
  }
}

/**
 * `POST /oauth/register` (Dynamic Client Registration, for apps without a metadata document): at most 100 an hour in
 * all and 10 an hour from one client address (Cloudflare's `cf-connecting-ip`, kept only as a hash of its bucket).
 */
export async function registerEndpoint(request: Request): Promise<Response> {
  let data: Record<string, unknown>;
  try {
    data = await body(request);
  } catch {
    return oauthError('invalid_client_metadata');
  }
  try {
    const uris = data.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(redirectUriAllowed)) return oauthError('invalid_redirect_uri');
    const method = data.token_endpoint_auth_method ?? 'none';
    const grants = (data.grant_types as unknown) ?? ['authorization_code', 'refresh_token'];
    const responses = (data.response_types as unknown) ?? ['code'];
    if (
      typeof method !== 'string' ||
      !['none', 'client_secret_post', 'client_secret_basic'].includes(method) ||
      !Array.isArray(grants) ||
      !grants.every((grant) => grant === 'authorization_code' || grant === 'refresh_token') ||
      !Array.isArray(responses) ||
      !responses.every((type) => type === 'code')
    )
      return oauthError('invalid_client_metadata');
    const id = crypto.randomUUID(),
      stamp = Date.now(),
      secret = method === 'none' ? null : `lf_cs_${randomPart()}`;
    const name = clientName(data.client_name, hostOf(uris[0])),
      uri = httpsUri(data.client_uri),
      from = await tokenHash(`registration:${clientAddress(request) ?? 'unknown'}`);
    const [created] = await db().batch([
      db()
        .prepare(
          `INSERT INTO oauth_clients(id,kind,name,client_uri,redirect_uris_json,secret_hash,created_at,registered_from) SELECT ?1,'registered',?2,?3,?4,?5,?6,?8
            WHERE (SELECT COUNT(*) FROM oauth_clients WHERE kind='registered' AND created_at>?7) < ${REGISTRATIONS_PER_HOUR}
              AND (SELECT COUNT(*) FROM oauth_clients WHERE registered_from=?8 AND created_at>?7) < ${REGISTRATIONS_PER_ADDRESS_HOUR}`,
        )
        .bind(id, name, uri, JSON.stringify(uris), secret ? await tokenHash(secret) : null, iso(stamp), iso(stamp - 60 * MINUTE), from),
      ...cleanup(stamp),
    ]);
    if (!created.meta.changes) return oauthError('invalid_client_metadata', 429, 'Too many registrations. Try again later.');
    return tokenResponse(
      {
        client_id: id,
        client_id_issued_at: Math.floor(stamp / 1000),
        client_name: name,
        ...(uri ? { client_uri: uri } : {}),
        redirect_uris: uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: method,
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      },
      201,
    );
  } catch (error) {
    console.error('OAuth registration failed:', error instanceof Error ? error.name : 'Unknown error');
    return oauthError('server_error', 500);
  }
}

/** `POST /oauth/revoke` (RFC 7009): an access or refresh token revokes its whole connection. Always 200. */
export async function revokeEndpoint(request: Request): Promise<Response> {
  const form = await formBody(request).catch(() => null);
  const token = form?.get('token') ?? '';
  if (TOKEN_PATTERN.test(token)) {
    const hash = await tokenHash(token);
    await db()
      .prepare('UPDATE api_credentials SET revoked_at=?1 WHERE revoked_at IS NULL AND (refresh_hash=?2 OR id=(SELECT credential_id FROM api_tokens WHERE token_hash=?2))')
      .bind(iso(Date.now()), hash)
      .run();
  }
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

// ---------------------------------------------------------------- discovery documents (served by the Worker)

export type WellKnown = 'oauth-protected-resource' | 'oauth-authorization-server';
export function wellKnown(kind: WellKnown): Record<string, unknown> {
  const origin = appOrigin();
  if (kind === 'oauth-protected-resource')
    return {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'Lastfind',
    };
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/app/connect`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}
