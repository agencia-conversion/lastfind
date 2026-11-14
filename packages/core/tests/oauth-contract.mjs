// AI apps (MCP) OAuth 2.1 and Settings tokens over real HTTP, the same checks for both editions: discovery documents,
// Dynamic Client Registration, consent with a signed-in session, code exchange with PKCE, refresh rotation, reuse
// revocation, RFC 7009 revocation, and the personal access token API. `headers` sign in (Cloud fixture session or the
// personal owner session) and carry this origin. Everything created is revoked at the end. No provider call.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

export async function runOAuthChecks({ base, headers }) {
  const mcp = `${base}/mcp`;
  let checks = 0;
  const call = async (path, { method = 'GET', json, form, session = true, origin, extra = {} } = {}) => {
    const sent = { ...(session ? headers : {}), ...extra };
    if (origin !== undefined) sent.Origin = origin;
    if (json) sent['Content-Type'] = 'application/json';
    if (form) sent['Content-Type'] = 'application/x-www-form-urlencoded';
    const response = await fetch(base + path, {
      method,
      headers: sent,
      redirect: 'manual',
      ...(json ? { body: JSON.stringify(json) } : form ? { body: new URLSearchParams(form) } : {}),
    });
    checks++;
    const text = await response.text();
    return { response, status: response.status, data: text && (response.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text };
  };

  // Discovery: open to any origin, pointing at this server.
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const { status, data, response } = await call(path, { session: false });
    assert.equal(status, 200, path);
    assert.equal(data.resource, mcp);
    assert.deepEqual(data.authorization_servers, [base]);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  }
  const server = (await call('/.well-known/oauth-authorization-server', { session: false })).data;
  assert.equal(server.issuer, base);
  assert.equal(server.token_endpoint, `${base}/oauth/token`);
  assert.equal(server.authorization_endpoint, `${base}/app/connect`);
  assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
  assert.equal(server.client_id_metadata_document_supported, true);
  // A browser client (MCP Inspector's origin; the development server refuses other foreign origins before the Worker).
  const preflight = await call('/oauth/token', { method: 'OPTIONS', session: false, origin: 'http://localhost:6274' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.response.headers.get('access-control-allow-origin'), '*');
  // The consent screen is never framed.
  const consentPage = await call('/app/connect', { session: false });
  assert.equal(consentPage.response.headers.get('x-frame-options'), 'DENY');
  assert.match(consentPage.response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);

  // Registration (legacy clients such as Cursor).
  const registered = await call('/oauth/register', { method: 'POST', session: false, json: { client_name: 'Integration app', redirect_uris: ['http://127.0.0.1/callback'] } });
  assert.equal(registered.status, 201);
  assert.equal(registered.response.headers.get('cache-control'), 'no-store');
  const clientId = registered.data.client_id;
  assert.equal((await call('/oauth/register', { method: 'POST', session: false, json: { redirect_uris: ['http://evil.test/cb'] } })).data.error, 'invalid_redirect_uri');

  const verifier = randomBytes(32).toString('base64url');
  const params = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: 'http://127.0.0.1:47011/callback',
    state: 'integration-state',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    scope: 'lastfind:read',
    resource: mcp,
  };
  // Consent needs the session and this origin; an invalid request is refused, never redirected.
  assert.equal((await call('/oauth/authorize', { method: 'POST', session: false, origin: base, json: { ...params, decision: 'approve', workspace_id: null } })).status, 401);
  assert.equal((await call('/oauth/authorize', { method: 'POST', origin: 'https://attacker.test', json: { ...params, decision: 'approve', workspace_id: null } })).status, 403);
  assert.equal((await call('/oauth/authorize', { method: 'POST', json: { ...params, redirect_uri: 'https://evil.test/cb', decision: 'approve', workspace_id: null } })).status, 400);
  const code = async () => {
    const { status, data } = await call('/oauth/authorize', { method: 'POST', json: { ...params, decision: 'approve', workspace_id: null } });
    assert.equal(status, 200);
    const back = new URL(data.redirect);
    assert.equal(back.searchParams.get('state'), 'integration-state');
    assert.equal(back.searchParams.get('iss'), base);
    return back.searchParams.get('code');
  };
  const denied = await call('/oauth/authorize', { method: 'POST', json: { ...params, decision: 'deny', workspace_id: null } });
  assert.equal(new URL(denied.data.redirect).searchParams.get('error'), 'access_denied');

  const exchange = (values) => call('/oauth/token', { method: 'POST', session: false, form: { grant_type: 'authorization_code', client_id: clientId, redirect_uri: params.redirect_uri, code_verifier: verifier, resource: mcp, ...values } });
  assert.equal((await exchange({ code: await code(), code_verifier: randomBytes(32).toString('base64url') })).data.error, 'invalid_grant', 'wrong verifier');
  assert.equal((await exchange({ code: await code(), resource: 'https://other.test/mcp' })).data.error, 'invalid_target', 'wrong resource');
  assert.equal((await exchange({ code: await code(), redirect_uri: 'http://127.0.0.1:47011/other' })).data.error, 'invalid_grant', 'redirect mismatch');
  const used = await code();
  const issued = await exchange({ code: used });
  assert.equal(issued.status, 200);
  assert.equal(issued.response.headers.get('cache-control'), 'no-store');
  assert.match(issued.data.access_token, /^lf_at_[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.data.scope, 'lastfind:read');
  assert.equal((await exchange({ code: used })).data.error, 'invalid_grant', 'reused code');
  // A token is not a session: account routes stay closed to it.
  assert.equal((await call('/api/tokens', { session: false, extra: { Authorization: `Bearer ${issued.data.access_token}` } })).status, 401);

  const refresh = (token) => call('/oauth/token', { method: 'POST', session: false, form: { grant_type: 'refresh_token', refresh_token: token, client_id: clientId } });
  const rotated = await refresh(issued.data.refresh_token);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.data.refresh_token, issued.data.refresh_token);
  let listed = (await call('/api/tokens')).data;
  assert.ok(listed.credentials.some((row) => row.kind === 'oauth' && row.client?.name === 'Integration app' && row.scope === 'lastfind:read'));
  // Replaying the rotated refresh token revokes the connection: the newest refresh token is dead too.
  assert.equal((await refresh(issued.data.refresh_token)).data.error, 'invalid_grant');
  assert.equal((await refresh(rotated.data.refresh_token)).data.error, 'invalid_grant');
  listed = (await call('/api/tokens')).data;
  assert.ok(!listed.credentials.some((row) => row.client?.name === 'Integration app'));
  // RFC 7009 revocation: always 200, at once.
  const again = await exchange({ code: await code() });
  assert.equal((await call('/oauth/revoke', { method: 'POST', session: false, form: { token: again.data.refresh_token } })).status, 200);
  assert.equal((await call('/oauth/revoke', { method: 'POST', session: false, form: { token: 'unknown' } })).status, 200);
  assert.equal((await refresh(again.data.refresh_token)).data.error, 'invalid_grant');

  // Personal access tokens: same origin, shown once, revoked at once.
  assert.equal((await call('/api/tokens', { method: 'POST', origin: 'https://attacker.test', json: { name: 'x', workspace_id: null, scope: 'lastfind:read', days: 30 } })).status, 403);
  assert.equal((await call('/api/tokens', { method: 'POST', json: { name: 'x', workspace_id: null, scope: 'lastfind:read', days: 7 } })).status, 400);
  const created = await call('/api/tokens', { method: 'POST', json: { name: 'Integration token', workspace_id: null, scope: 'lastfind:read lastfind:write', days: 30 } });
  assert.equal(created.status, 201);
  assert.match(created.data.token, /^lf_pat_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.data.credential.hint, created.data.token.slice(-4));
  listed = (await call('/api/tokens')).data;
  assert.equal(listed.limit, 20);
  assert.ok(Array.isArray(listed.audit));
  const token = listed.credentials.find((row) => row.id === created.data.credential.id);
  assert.equal(token.kind, 'pat');
  assert.ok(!JSON.stringify(listed).includes(created.data.token), 'a token is never shown again');
  // Clean up everything this run created (and earlier runs left).
  for (const row of listed.credentials)
    if (['Integration token', 'Integration app'].includes(row.name)) assert.equal((await call('/api/tokens', { method: 'DELETE', json: { id: row.id } })).status, 200);
  assert.equal((await call('/api/tokens', { method: 'DELETE', json: { id: created.data.credential.id } })).status, 404);
  return checks;
}
