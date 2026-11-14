// AI apps (MCP) credentials and OAuth 2.1 on both editions' migrations: token format and hashes, PKCE (RFC 7636
// Appendix B), redirect matching, resource and scope normalisation, client metadata documents with an injected fetch
// (and the addresses never fetched), min(scope, role), the full OAuth flow with refresh rotation and reuse revocation,
// personal access tokens, the rate limit and the token actor in auth.ts. No network, no provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ORIGIN = 'https://lastfind.test';
// The public snapshot has the independent edition only.
const EDITIONS = ['cloud', 'selfhost'].filter((edition) => existsSync(`${root}apps/${edition}/drizzle`));
function d1(sqlite) {
  const run = (sql, params) => {
    const statement = sqlite.prepare(sql);
    if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      const results = statement.all(...params).map((row) => ({ ...row }));
      return { results, meta: { changes: results.length } };
    }
    return { results: [], meta: { changes: statement.run(...params).changes } };
  };
  const prepare = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => prepare(sql, values),
    all: async () => run(sql, params),
    first: async () => run(sql, params).results[0] ?? null,
    run: async () => run(sql, params),
  });
  return {
    prepare,
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params }) => run(sql, params));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
const stubs = {
  './env': `export const db=()=>globalThis.fx.db;export const appOrigin=()=>${JSON.stringify(ORIGIN)};export const now=()=>new Date().toISOString();`,
  './http': `export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
export const json=(value,status=200)=>Response.json(value,{status});
export async function fail(error){return Response.json({error:error.message},{status:error.status??500});}
export async function body(request){return await request.json();}
export function sameOrigin(request){if(request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'Origem da solicitação inválida.');}
export function textField(value,label,min=1,max=100){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new ApiError(400,label+': use entre '+min+' e '+max+' caracteres.');return value.trim();}`,
  './project-store-read': `export async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map((b)=>b.toString(16).padStart(2,'0')).join('');}`,
  './auth': `const RANK={viewer:0,member:1,admin:2,owner:3};
export const roleAtLeast=(role,needed)=>RANK[role]>=RANK[needed];
export async function requireUser(){if(!globalThis.fx.user){const e=new Error('Entre na sua conta para continuar.');e.status=401;throw e;}return globalThis.fx.user;}
export async function resolveActor(user,requested){const role=globalThis.fx.members?.[requested+'|'+user.id];return role&&requested!==user.id?{...user,workspaceId:requested,role}:{...user,workspaceId:user.id,role:'owner'};}
export async function workspaceChoices(actor){return globalThis.fx.choices?.(actor);}`,
  // Outside a request (the agent's Durable Object) reading cookies throws, as next/headers does.
  '@edition/server/identity': `export const currentIdentity=async()=>{if(globalThis.fx.noRequest)throw new Error('cookies was called outside a request scope');return globalThis.fx.cookieUser??null;};export const ensureIdentity=async()=>{};
export const resolveActor=async(user)=>({...user,workspaceId:user.id,role:'owner'});export const workspaceChoices=async()=>[];`,
  'cloudflare:workers': 'export const waitUntil=()=>{};',
};
const fixtures = {
  name: 'fixtures',
  setup(plugin) {
    plugin.onResolve({ filter: /^(\.\/(env|http|project-store-read)|@edition\/server\/identity|cloudflare:workers)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
    // api-access.ts sees a stub of auth.ts; auth.ts itself is bundled for real (the token actor test).
    plugin.onResolve({ filter: /^\.\/auth$/ }, (args) => (args.importer.endsWith('api-access.ts') ? { path: './auth', namespace: 'fixture' } : undefined));
    plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
  },
};
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: "export * as access from './packages/core/lib/server/api-access.ts';export * as auth from './packages/core/lib/server/auth.ts';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [fixtures],
});
const { access, auth } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

function database(edition) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = `${root}apps/${edition}/drizzle/`;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(dir + name, 'utf8'));
  const stamp = new Date().toISOString();
  for (const id of ['owner', 'other', 'member']) sqlite.prepare('INSERT INTO accounts(id,email,name,created_at) VALUES(?,?,?,?)').run(id, `${id}@example.test`, id, stamp);
  sqlite.prepare('INSERT INTO projects(id,workspace_id,name,domain,created_at) VALUES(?,?,?,?,?)').run('p-owner', 'owner', 'Brand', 'brand.test', stamp);
  sqlite.prepare('INSERT INTO projects(id,workspace_id,name,domain,created_at) VALUES(?,?,?,?,?)').run('p-other', 'other', 'Other', 'other.test', stamp);
  return sqlite;
}
const user = (id) => ({ id, email: `${id}@example.test`, name: id });
const form = (values, headers = {}) =>
  new Request(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(values) });
const bearer = (token) => new Request(`${ORIGIN}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
const consent = (values) =>
  new Request(`${ORIGIN}/oauth/authorize`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

test('PKCE S256 matches RFC 7636 Appendix B', async () => {
  assert.equal(await access.pkceChallenge(VERIFIER), CHALLENGE);
});

test('tokens are a prefix and 43 base64url characters; only a SHA-256 is kept', async () => {
  for (const prefix of ['lf_pat_', 'lf_at_', 'lf_rt_']) {
    const token = access.newToken(prefix);
    assert.match(token, new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`));
    assert.ok(access.TOKEN_PATTERN.test(token));
    assert.equal(await access.tokenHash(token), createHash('sha256').update(JSON.stringify(token)).digest('hex'));
  }
  assert.notEqual(access.newToken('lf_at_'), access.newToken('lf_at_'));
  for (const bad of ['lf_at_short', `lf_xx_${'a'.repeat(43)}`, `lf_at_${'a'.repeat(42)}!`, `lf_at_${'a'.repeat(44)}`]) assert.equal(access.TOKEN_PATTERN.test(bad), false, bad);
});

test('redirect addresses: exact, any port on loopback, never a prefix', () => {
  const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1/callback', 'http://localhost:3334/oauth', 'cursor://anysphere.cursor-mcp/oauth/callback'];
  for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:51234/callback', 'http://127.0.0.1/callback', 'http://localhost:9999/oauth', 'cursor://anysphere.cursor-mcp/oauth/callback'])
    assert.equal(access.redirectMatches(registered, ok), true, ok);
  for (const bad of [
    'https://claude.ai/api/mcp/auth_callback/extra',
    'https://claude.ai/api/mcp/auth_callback?x=1',
    'https://claude.ai/api/mcp/auth_callback#frag',
    'https://claude.ai.evil.test/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/auth_callbac',
    'http://localhost:51234/callback',
    'http://127.0.0.1:51234/callback/other',
    'https://127.0.0.1/callback',
    'javascript:alert(1)',
  ])
    assert.equal(access.redirectMatches(registered, bad), false, bad);
  for (const ok of ['https://app.example/cb', 'http://localhost:8080/cb', 'http://[::1]/cb', 'cursor://anysphere.cursor-mcp/oauth/callback'])
    assert.equal(access.redirectUriAllowed(ok), true, ok);
  for (const bad of ['http://app.example/cb', 'https://app.example/cb#x', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'https://user:pass@app.example/cb', 'not a url', 42])
    assert.equal(access.redirectUriAllowed(bad), false, String(bad));
});

test('the resource is this MCP endpoint, normalised; scopes are ours only', () => {
  const canonical = `${ORIGIN}/mcp`;
  for (const value of [null, '', canonical, `${canonical}/`, 'https://LASTFIND.test/mcp', 'https://lastfind.test:443/mcp'])
    assert.equal(access.canonicalResource(value), canonical, String(value));
  for (const value of [`${ORIGIN}/`, `${ORIGIN}`, `${ORIGIN}/mcp?x=1`, `${ORIGIN}/mcp#a`, 'https://other.test/mcp', 'http://lastfind.test/mcp', `${ORIGIN}/mcp/extra`, 'nonsense'])
    assert.equal(access.canonicalResource(value), null, value);
  assert.equal(access.requestedScope(null), 'lastfind:read');
  assert.equal(access.requestedScope('lastfind:read'), 'lastfind:read');
  assert.equal(access.requestedScope('lastfind:write'), 'lastfind:read lastfind:write');
  assert.equal(access.requestedScope('offline_access lastfind:read lastfind:write'), 'lastfind:read lastfind:write');
  assert.equal(access.requestedScope('lastfind:read admin'), null);
  assert.equal(access.scopeForRole('lastfind:read lastfind:write', 'viewer'), 'lastfind:read');
  assert.equal(access.scopeForRole('lastfind:read lastfind:write', 'member'), 'lastfind:read lastfind:write');
  assert.equal(access.wellKnown('oauth-protected-resource').resource, canonical);
  const server = access.wellKnown('oauth-authorization-server');
  assert.equal(server.issuer, ORIGIN);
  assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
  assert.equal(server.authorization_endpoint, `${ORIGIN}/app/connect`);
});

test('client metadata documents: fetched once a day, checked, and never from local or internal addresses', async () => {
  globalThis.fx = { db: d1(database('selfhost')) };
  const id = 'https://claude.ai/oauth/claude-code-client-metadata';
  const calls = [];
  const documentFor = (overrides = {}) => async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ client_id: id, client_name: 'Claude\u0007 Code', redirect_uris: ['http://localhost/callback'], token_endpoint_auth_method: 'none', ...overrides });
  };
  const client = await access.findClient(id, documentFor());
  assert.equal(client.name, 'Claude Code');
  assert.deepEqual(client.redirectUris, ['http://localhost/callback']);
  assert.equal(calls[0].init.redirect, 'manual');
  await access.findClient(id, documentFor());
  assert.equal(calls.length, 1, 'kept for 24 hours');
  for (const overrides of [{ client_id: 'https://claude.ai/other' }, { redirect_uris: [] }, { redirect_uris: ['http://evil.test/cb'] }, { token_endpoint_auth_method: 'private_key_jwt' }])
    assert.equal(await access.fetchClientMetadata(id, documentFor(overrides)), null, JSON.stringify(overrides));
  assert.equal(await access.fetchClientMetadata(id, async () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } })), null);
  assert.equal(await access.fetchClientMetadata(id, async () => new Response('x'.repeat(10_001))), null);
  assert.equal(await access.fetchClientMetadata(id, async () => new Response('not json')), null);
  assert.equal(await access.fetchClientMetadata(id, async () => Promise.reject(new Error('timeout'))), null);
  const before = calls.length;
  for (const refused of [
    'http://claude.ai/meta',
    'https://127.0.0.1/meta',
    'https://2130706433/meta',
    'https://0x7f.1/meta',
    'https://[::1]/meta',
    'https://localhost/meta',
    'https://printer.local/meta',
    'https://metadata.google.internal/meta',
    'https://lastfind.test/meta',
    'https://claude.ai:8443/meta',
    'https://claude.ai/',
    'https://claude.ai/a/../meta',
    'https://user@claude.ai/meta',
    'https://intranet/meta',
  ]) {
    assert.equal(access.metadataUrlAllowed(refused), false, refused);
    assert.equal(await access.findClient(refused, documentFor()), null, refused);
  }
  assert.equal(calls.length, before, 'refused addresses are never fetched');
});

test('OAuth end to end on both editions: register, consent, code, refresh rotation, reuse revokes, revoke', async () => {
  for (const edition of EDITIONS) {
    const sqlite = database(edition);
    globalThis.fx = { db: d1(sqlite), user: user('owner') };
    const registration = await access.registerEndpoint(
      new Request(`${ORIGIN}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'Cursor', redirect_uris: ['http://127.0.0.1/callback', 'https://app.example/cb'] }),
      }),
    );
    assert.equal(registration.status, 201);
    const registered = await registration.json();
    assert.equal(registered.token_endpoint_auth_method, 'none');
    assert.equal(registered.client_secret, undefined);
    const params = {
      response_type: 'code',
      client_id: registered.client_id,
      redirect_uri: 'http://127.0.0.1:43123/callback',
      state: 'st-1',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope: 'lastfind:read',
    };
    const view = await access.describeAuthorization(new URLSearchParams(params));
    assert.equal(view.ok, true);
    assert.equal(view.client.name, 'Cursor');
    assert.equal(view.client.verifiedHost, null);
    assert.equal(view.params.resource, `${ORIGIN}/mcp`);
    for (const [change, error] of [
      [{ redirect_uri: 'https://app.example/cb/x' }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge: 'short' }, 'invalid_request'],
      [{ resource: 'https://other.test/mcp' }, 'invalid_target'],
      [{ scope: 'lastfind:admin' }, 'invalid_scope'],
      [{ client_id: 'unknown' }, 'invalid_client'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
    ])
      assert.equal((await access.describeAuthorization(new URLSearchParams({ ...params, ...change }))).error, error, JSON.stringify(change));
    // Invalid requests are refused on the consent POST too, never redirected.
    assert.equal((await access.authorizeEndpoint(consent({ ...params, redirect_uri: 'https://evil.test/cb', decision: 'approve' }))).status, 400);
    const denied = await (await access.authorizeEndpoint(consent({ ...params, decision: 'deny' }))).json();
    assert.equal(new URL(denied.redirect).searchParams.get('error'), 'access_denied');
    assert.equal(new URL(denied.redirect).searchParams.get('state'), 'st-1');
    // The person ticks write on the consent screen.
    const approved = await (await access.authorizeEndpoint(consent({ ...params, scope: 'lastfind:read lastfind:write', decision: 'approve', workspace_id: null }))).json();
    const back = new URL(approved.redirect);
    assert.equal(back.origin + back.pathname, 'http://127.0.0.1:43123/callback');
    assert.equal(back.searchParams.get('state'), 'st-1');
    assert.equal(back.searchParams.get('iss'), ORIGIN);
    const code = back.searchParams.get('code');
    const exchange = { grant_type: 'authorization_code', code, client_id: registered.client_id, redirect_uri: params.redirect_uri, code_verifier: VERIFIER, resource: `${ORIGIN}/mcp` };
    assert.equal((await (await access.tokenEndpoint(form({ ...exchange, code_verifier: VERIFIER.replace('d', 'e') }))).json()).error, 'invalid_grant', 'wrong verifier');
    assert.equal((await (await access.tokenEndpoint(form(exchange))).json()).error, 'invalid_grant', 'a failed exchange used the code up');
    // A fresh code: wrong resource, redirect mismatch, then the real exchange and a reused code.
    const again = async () => new URL((await (await access.authorizeEndpoint(consent({ ...params, decision: 'approve' }))).json()).redirect).searchParams.get('code');
    assert.equal((await (await access.tokenEndpoint(form({ ...exchange, code: await again(), resource: 'https://other.test/mcp' }))).json()).error, 'invalid_target');
    assert.equal((await (await access.tokenEndpoint(form({ ...exchange, code: await again(), redirect_uri: 'https://app.example/cb' }))).json()).error, 'invalid_grant');
    assert.equal((await access.tokenEndpoint(form({ ...exchange, code: await again(), client_id: 'someone-else' }))).status, 401);
    const fresh = await again();
    const response = await access.tokenEndpoint(form({ ...exchange, code: fresh }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const tokens = await response.json();
    assert.match(tokens.access_token, /^lf_at_[A-Za-z0-9_-]{43}$/);
    assert.match(tokens.refresh_token, /^lf_rt_[A-Za-z0-9_-]{43}$/);
    assert.equal(tokens.scope, 'lastfind:read');
    assert.equal(tokens.expires_in, 3600);
    assert.equal((await (await access.tokenEndpoint(form({ ...exchange, code: fresh }))).json()).error, 'invalid_grant', 'reused code');
    const stored = sqlite.prepare('SELECT * FROM api_tokens').all();
    assert.ok(stored.every((row) => !JSON.stringify(row).includes(tokens.access_token.slice(6))), 'only hashes are stored');
    const verified = await access.verifyBearer(bearer(tokens.access_token));
    assert.equal(verified.ok, true);
    assert.equal(verified.access.user.id, 'owner');
    assert.deepEqual(verified.access.credential.scopes, ['lastfind:read']);
    assert.equal((await access.verifyBearer(bearer(tokens.refresh_token))).status, 401, 'a refresh token is not a bearer token');
    // Rotation: a new pair each time; the old access token keeps working until it expires.
    const rotated = await (await access.tokenEndpoint(form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: registered.client_id }))).json();
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    assert.equal((await access.verifyBearer(bearer(rotated.access_token))).ok, true);
    // Replaying the rotated refresh token revokes the whole connection.
    assert.equal((await (await access.tokenEndpoint(form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: registered.client_id }))).json()).error, 'invalid_grant');
    assert.equal((await access.verifyBearer(bearer(rotated.access_token))).status, 401);
    assert.equal((await (await access.tokenEndpoint(form({ grant_type: 'refresh_token', refresh_token: rotated.refresh_token, client_id: registered.client_id }))).json()).error, 'invalid_grant');
    // Revocation (RFC 7009) of a new connection: always 200, effective at once.
    const next = await (await access.tokenEndpoint(form({ ...exchange, code: await again() }))).json();
    assert.equal((await access.verifyBearer(bearer(next.access_token))).ok, true);
    const revoke = (token) => access.revokeEndpoint(new Request(`${ORIGIN}/oauth/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }));
    assert.equal((await revoke(next.refresh_token)).status, 200);
    assert.equal((await revoke('garbage')).status, 200);
    assert.equal((await access.verifyBearer(bearer(next.access_token))).status, 401);
    // The connected app is listed while active, with its client; reconnecting replaced the earlier connection.
    const third = await (await access.tokenEndpoint(form({ ...exchange, code: await again() }))).json();
    const overview = await access.accessOverview(user('owner'));
    assert.equal(overview.credentials.length, 1);
    assert.equal(overview.credentials[0].kind, 'oauth');
    assert.equal(overview.credentials[0].client.name, 'Cursor');
    assert.equal(overview.credentials[0].hint, null);
    await access.revokeCredential(user('owner'), overview.credentials[0].id);
    assert.equal((await access.verifyBearer(bearer(third.access_token))).status, 401);
    // A confidential client must present its secret.
    const confidential = await (
      await access.registerEndpoint(
        new Request(`${ORIGIN}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://app.example/cb'], token_endpoint_auth_method: 'client_secret_basic' }) }),
      )
    ).json();
    assert.match(confidential.client_secret, /^lf_cs_/);
    assert.equal(confidential.client_name, 'app.example');
    const secretRefresh = { grant_type: 'refresh_token', refresh_token: access.newToken('lf_rt_') };
    assert.equal((await access.tokenEndpoint(form({ ...secretRefresh, client_id: confidential.client_id }))).status, 401);
    const basic = `Basic ${btoa(`${confidential.client_id}:${confidential.client_secret}`)}`;
    assert.equal((await (await access.tokenEndpoint(form(secretRefresh, { Authorization: basic }))).json()).error, 'invalid_grant', 'authenticated, unknown refresh token');
    for (const bad of [{ redirect_uris: ['http://evil.test/cb'] }, { redirect_uris: [] }, { redirect_uris: ['https://a.test/cb'], grant_types: ['client_credentials'] }])
      assert.equal(
        (await access.registerEndpoint(new Request(`${ORIGIN}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bad) }))).status,
        400,
      );
    sqlite.close();
  }
});

test('personal access tokens, min(scope, role), removed members and the rate limit', async () => {
  const sqlite = database(EDITIONS[0]);
  globalThis.fx = { db: d1(sqlite), user: user('member'), members: { 'owner|member': 'viewer' } };
  const created = await access.createToken(user('member'), { name: ' CI\u0000 token ', workspace_id: null, scope: 'lastfind:read lastfind:write', days: 90 });
  assert.match(created.token, /^lf_pat_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.credential.name, 'CI token');
  assert.equal(created.credential.hint, created.token.slice(-4));
  assert.equal(created.credential.scope, 'lastfind:read lastfind:write');
  assert.ok(Date.parse(created.credential.expires_at) - Date.now() > 89 * 86_400_000);
  // Write in a workspace where the account is a viewer is refused at creation...
  await assert.rejects(access.createToken(user('member'), { name: 'x', workspace_id: 'owner', scope: 'lastfind:read lastfind:write', days: 30 }), /role/);
  await assert.rejects(access.createToken(user('member'), { name: 'x', workspace_id: 'stranger', scope: 'lastfind:read', days: 30 }), /Workspace not found/);
  for (const bad of [{ days: 0 }, { days: 400 }, { scope: 'lastfind:write' }, { name: '' }])
    await assert.rejects(access.createToken(user('member'), { name: 'x', workspace_id: null, scope: 'lastfind:read', days: 30, ...bad }));
  // ...and an all-workspaces token acts there as a viewer (min(scope, role)), as the owner in its own.
  const verified = await access.verifyBearer(bearer(created.token));
  assert.equal(verified.ok, true);
  assert.equal((await access.workspaceActor(verified.access, 'owner')).role, 'viewer');
  assert.equal((await access.workspaceActor(verified.access, 'member')).role, 'owner');
  assert.equal(await access.workspaceActor(verified.access, 'other'), null);
  assert.equal((await access.projectActor(verified.access, 'p-owner')).workspaceId, 'owner');
  assert.equal(await access.projectActor(verified.access, 'p-other'), null);
  assert.equal(await access.projectActor(verified.access, 'missing'), null);
  globalThis.fx.choices = (actor) => [{ id: actor.id }, { id: 'owner' }, { id: 'other' }];
  assert.deepEqual((await access.accessActors(verified.access)).map((actor) => actor.workspaceId), ['member', 'owner']);
  // A read token caps the role even of the owner.
  globalThis.fx.members['owner|member'] = 'member';
  const bound = await access.createToken(user('member'), { name: 'bound', workspace_id: 'owner', scope: 'lastfind:read', days: 30 });
  const boundAccess = (await access.verifyBearer(bearer(bound.token))).access;
  assert.equal((await access.workspaceActor(boundAccess, 'owner')).role, 'viewer');
  assert.equal(await access.workspaceActor(boundAccess, 'member'), null, 'bound to one workspace');
  assert.deepEqual((await access.accessActors(boundAccess)).map((actor) => actor.workspaceId), ['owner']);
  // Removing the member cuts the bound token.
  delete globalThis.fx.members['owner|member'];
  assert.equal((await access.verifyBearer(bearer(bound.token))).status, 401);
  assert.ok(sqlite.prepare('SELECT revoked_at FROM api_credentials WHERE id=?').get(bound.credential.id).revoked_at);
  // Audience: a credential for another resource is refused.
  sqlite.prepare("UPDATE api_credentials SET resource='https://other.test/mcp' WHERE id=?").run(created.credential.id);
  assert.equal((await access.verifyBearer(bearer(created.token))).status, 401);
  sqlite.prepare('UPDATE api_credentials SET resource=? WHERE id=?').run(`${ORIGIN}/mcp`, created.credential.id);
  // 60 calls a minute per credential.
  sqlite.prepare('UPDATE api_credentials SET rate_count=0, rate_window=0 WHERE id=?').run(created.credential.id);
  let last;
  for (let call = 0; call < 61; call++) last = await access.verifyBearer(bearer(created.token));
  assert.equal(last.status, 429);
  assert.ok(last.retryAfter >= 1 && last.retryAfter <= 60);
  sqlite.prepare('UPDATE api_credentials SET rate_window=0 WHERE id=?').run(created.credential.id);
  assert.equal((await access.verifyBearer(bearer(created.token))).ok, true, 'a new minute');
  // Missing, malformed and unknown tokens.
  const missing = await access.verifyBearer(new Request(`${ORIGIN}/mcp`, { method: 'POST' }));
  assert.equal(missing.status, 401);
  assert.doesNotMatch(missing.wwwAuthenticate, /error=/);
  assert.match(missing.wwwAuthenticate, /resource_metadata="https:\/\/lastfind\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  assert.match((await access.verifyBearer(bearer('lf_pat_nope'))).wwwAuthenticate, /error="invalid_token"/);
  assert.equal((await access.verifyBearer(bearer(access.newToken('lf_pat_')))).status, 401);
  // Audit: ids only, listed for the account's own credentials.
  await access.audit({ credentialId: created.credential.id, workspaceId: 'owner', tool: 'create_prompts', target: ['prompt-1', 'p<script>'], outcome: 'ok' });
  const overview = await access.accessOverview(user('member'));
  assert.deepEqual(overview.audit.map((row) => [row.tool, row.target, row.outcome, row.credential_name]), [['create_prompts', 'prompt-1,pscript', 'ok', 'CI token']]);
  assert.equal((await access.accessOverview(user('owner'))).audit.length, 0);
  assert.deepEqual(overview.credentials.map((row) => row.id), [created.credential.id]);
  assert.equal(overview.limit, 20);
  // Revocation is immediate and only for the account's own credentials.
  await assert.rejects(access.revokeCredential(user('owner'), created.credential.id), /Access not found/);
  await access.revokeCredential(user('member'), created.credential.id);
  assert.equal((await access.verifyBearer(bearer(created.token))).status, 401);
  // At most 20 active tokens.
  for (let index = 0; index < 20; index++) await access.createToken(user('member'), { name: `t${index}`, workspace_id: null, scope: 'lastfind:read', days: 30 });
  await assert.rejects(access.createToken(user('member'), { name: 'one more', workspace_id: null, scope: 'lastfind:read', days: 30 }), /limit of 20/);
  sqlite.close();
});

test('under a token, routes see its actor: reads pass, writes need lastfind:write and member, account and role routes are refused', async () => {
  globalThis.fx = { cookieUser: { id: 'cookie', email: 'cookie@example.test', name: 'Cookie' } };
  const actor = { id: 'member', email: 'member@example.test', name: 'member', workspaceId: 'owner', role: 'member' };
  const as = (scopes, run, role = 'member') => auth.withTokenActor({ actor: { ...actor, role }, scopes, credentialId: 'c' }, run);
  assert.equal((await as(['lastfind:read'], () => auth.requireActor())).workspaceId, 'owner');
  await assert.rejects(as(['lastfind:read'], () => auth.requireActor({ write: true })), /does not allow changes/);
  assert.equal((await as(['lastfind:read', 'lastfind:write'], () => auth.requireActor({ write: true }))).workspaceId, 'owner');
  await assert.rejects(as(['lastfind:read', 'lastfind:write'], () => auth.requireActor({ write: true }), 'viewer'), /role/);
  await assert.rejects(as(['lastfind:read', 'lastfind:write'], () => auth.requireActor({ role: 'admin' }), 'owner'), /AI apps cannot/);
  await assert.rejects(as(['lastfind:read', 'lastfind:write'], () => auth.requireUser()), /AI apps cannot/);
  assert.equal(as(['lastfind:read'], () => auth.currentTokenActor()).credentialId, 'c');
  // Under a token (an AI app, or the in-app agent with no request at all) there is no browser session to read: a route that
  // asks for it (the Semantic Branding panel's admin check) gets null instead of failing.
  globalThis.fx.noRequest = true;
  assert.equal(await as(['lastfind:read'], () => auth.currentUser()), null);
  await assert.rejects(auth.currentUser(), /outside a request/);
  globalThis.fx.noRequest = false;
  // Outside a token: the cookie session, unchanged.
  assert.equal(auth.currentTokenActor(), undefined);
  assert.equal((await auth.requireUser()).id, 'cookie');
  assert.equal((await auth.requireActor({ role: 'owner' })).workspaceId, 'cookie');
});

test('app registration: 10 an hour from one address (an IPv6 client by its /64), and unused registrations are removed', async () => {
  for (const edition of EDITIONS) {
    const sqlite = database(edition);
    globalThis.fx = { db: d1(sqlite) };
    // `cf`: Cloudflare's request metadata; only with it is `cf-connecting-ip` trusted.
    const register = (ip, cf = true) =>
      access.registerEndpoint(
        Object.assign(new Request(`${ORIGIN}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}) }, body: JSON.stringify({ redirect_uris: ['https://app.example/cb'] }) }), cf ? { cf: {} } : {}),
      );
    for (let index = 0; index < 10; index++) assert.equal((await register(`2001:db8:1:2::${index + 1}`)).status, 201);
    assert.equal((await register('2001:db8:1:2:ffff::1')).status, 429, 'the same /64 is one address');
    assert.equal((await register('2001:db8:9:9::1')).status, 201, 'another address still registers');
    assert.equal((await register('203.0.113.7')).status, 201);
    // Without Cloudflare's metadata the header is not trusted: every such request shares one bucket.
    for (let index = 0; index < 10; index++) assert.equal((await register(`198.51.100.${index + 1}`, false)).status, 201);
    assert.equal((await register('198.51.100.200', false)).status, 429, 'a spoofed header does not open a new bucket');
    const stored = sqlite.prepare("SELECT DISTINCT registered_from FROM oauth_clients WHERE kind='registered'").all().map((row) => row.registered_from);
    assert.ok(stored.every((value) => /^[0-9a-f]{64}$/.test(value)), 'only a hash of the address is kept');
    // Cleanup on the next registration: never connected after 7 days, or every connection gone and unused for 30 days.
    const days = (count) => new Date(Date.now() - count * 86_400_000).toISOString();
    sqlite.exec("DELETE FROM oauth_clients");
    sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('acct','a@example.test','A',?)").run(days(90));
    const client = (id, created) => sqlite.prepare("INSERT INTO oauth_clients(id,kind,name,redirect_uris_json,created_at) VALUES(?,'registered','x','[]',?)").run(id, created);
    const credential = (id, clientId, { expires, used, revoked = null }) =>
      sqlite.prepare("INSERT INTO api_credentials(id,account_id,kind,name,client_id,scope,resource,expires_at,created_at,last_used_at,revoked_at) VALUES(?,'acct','oauth','x',?,'lastfind:read','r',?,?,?,?)").run(id, clientId, expires, days(80), used, revoked);
    client('never-used', days(8));
    client('fresh', days(1));
    client('gone-long-ago', days(80));
    credential('c1', 'gone-long-ago', { expires: days(40), used: days(45) });
    client('gone-recently', days(80));
    credential('c2', 'gone-recently', { expires: days(1), used: days(10) });
    client('live', days(80));
    credential('c3', 'live', { expires: new Date(Date.now() + 86_400_000).toISOString(), used: days(60) });
    client('revoked', days(80));
    credential('c4', 'revoked', { expires: new Date(Date.now() + 86_400_000).toISOString(), used: days(40), revoked: days(40) });
    assert.equal((await register('198.51.100.1')).status, 201);
    const left = sqlite.prepare("SELECT id FROM oauth_clients WHERE id NOT IN (SELECT id FROM oauth_clients WHERE registered_from IS NOT NULL) ORDER BY id").all().map((row) => row.id);
    assert.deepEqual(left, ['fresh', 'gone-recently', 'live']);
    sqlite.close();
  }
});
