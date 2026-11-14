// The MCP endpoint of the independent installation (packages/core/tests/mcp-contract.mjs), as its one owner (owner key).
import assert from 'node:assert/strict';
import { localDatabase, runMcpChecks } from '../../../packages/core/tests/mcp-contract.mjs';

const base = process.env.LASTFIND_TEST_URL;
const key = process.env.LASTFIND_TEST_OWNER_KEY;
assert.ok(process.env.LASTFIND_TESTING === 'true' && base && key, 'Run through npm run test:integration (isolated installation only)');
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
assert.equal(login.status, 200);
const headers = { Origin: base, Cookie: login.headers.get('set-cookie').split(';')[0] };
const database = localDatabase();
try {
  const checks = await runMcpChecks({ base, headers, database, owner: 'owner:local' });
  console.log(`MCP integration checks passed for the independent installation (${checks} requests).`);
} finally {
  database.close();
}
