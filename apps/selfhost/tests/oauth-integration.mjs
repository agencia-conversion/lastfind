// AI apps (MCP) OAuth and tokens over HTTP with the owner session of the isolated test installation
// (see packages/core/tests/oauth-contract.mjs).
import assert from 'node:assert/strict';
import { runOAuthChecks } from '../../../packages/core/tests/oauth-contract.mjs';

const base = process.env.LASTFIND_TEST_URL;
const key = process.env.LASTFIND_TEST_OWNER_KEY;
assert.ok(base && /^http:\/\/localhost:\d+$/.test(base) && key, 'Run through the selfhost integration runner');
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
assert.equal(login.status, 200);
const headers = { Origin: base, Cookie: login.headers.get('set-cookie').split(';')[0] };
console.log(`Selfhost OAuth checks passed: ${await runOAuthChecks({ base, headers })}`);
