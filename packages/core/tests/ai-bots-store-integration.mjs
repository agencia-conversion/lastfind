// AI bots in the project store: days written by `bots-put` (a day read again replaces itself), the report's reads over them
// and its shape, and `bots-clear`. Private, ephemeral Miniflare namespace; no network, no Cloudflare API.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { storeIdentity } from '../lib/project-store-contract.ts';
import { exampleBotDays } from '../lib/ai-bots-fixture.ts';
import { addDays, pathKey, reportStatements, shapeReport, weekly } from '../lib/ai-bots.ts';

const directory = await mkdtemp(join(tmpdir(), 'lastfind-ai-bots-store-'));
const bundled = await build({
  stdin: {
    contents: "export { ProjectStore } from './worker/project-store.ts'; export default { fetch() { return new Response(null, {status:404}); } };",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  external: ['cloudflare:workers'],
  write: false,
});
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    name: 'lastfind-ai-bots-store-test',
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-22',
    durableObjects: { PROJECT_STORES: { className: 'ProjectStore', useSQLite: true } },
    r2Buckets: ['RAW_RESPONSES'],
    resourcePersistencePath: directory,
    unsafeDevRegistryPath: join(directory, 'registry'),
    telemetry: { enabled: false },
    logRequests: false,
  }),
);
const scope = { ownerId: 'owner-b', projectId: 'project-b', generation: 'first' };
const rpc = async (message) => {
  const namespace = await runtime.getDurableObjectNamespace('PROJECT_STORES');
  const response = await namespace.get(namespace.idFromName(storeIdentity(scope))).fetch('https://project-store/rpc', { method: 'POST', body: JSON.stringify(message) });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
};
const connection = { state: 'active', zone: 'example.test', plan: 'Pro Website', paid: true, capabilities: { pages: true, referrals: true }, tokenHint: null, connectedAt: null, lastSyncAt: null, backfilling: false, problem: null, preview: true, canManage: true };

try {
  await rpc({ scope, action: 'initialize' });
  const today = '2026-11-10';
  const days = exampleBotDays({ today, referrals: true, paths: ['/blog/cited/'] });
  for (let index = 0; index < days.length; index += 20) await rpc({ scope, action: 'bots-put', days: days.slice(index, index + 20), syncedAt: `${today}T06:00:00.000Z` });
  // A day read again (now whole) replaces what was kept for it, never adds to it.
  await rpc({ scope, action: 'bots-put', days: [days.at(-2)], syncedAt: `${today}T07:00:00.000Z` });
  const current = { from: addDays(today, -27), to: addDays(today, 1) };
  const previous = { from: addDays(current.from, -28), to: current.from };
  const read = async (before, filter) => (await rpc({ scope, action: 'query', statements: reportStatements(current, before, filter) })).map((result) => result.results);
  const report = shapeReport({ connection, results: await read(previous), current, previous, cited: new Set([pathKey('/Pricing/')]) });

  const inPeriod = days.filter((day) => day.day >= current.from && day.day < current.to);
  const expected = inPeriod.reduce((sum, day) => sum + day.hits.reduce((total, row) => total + row[3], 0), 0);
  assert.equal(report.totals.visits, expected, 'visits are the sum of the period’s days, the re-read day counted once');
  assert.equal(report.period.covered, 28);
  // 61 example days: the 28 days before the period are all there, so the periods are compared.
  assert.equal(report.period.previousCovered, 28);
  assert.equal(report.period.compared, true);
  assert.equal(report.totals.requests, inPeriod.reduce((sum, day) => sum + day.requests, 0));
  assert.ok(report.totals.referrals > 0 && report.totals.previousReferrals > 0);
  assert.equal(report.trend.length, 28);
  assert.equal(report.trend.reduce((sum, row) => sum + row.training + row.search + row.user, 0), expected);
  assert.ok(report.bots.length >= 10 && report.bots[0].visits >= report.bots.at(-1).visits);
  assert.ok(report.bots.every((bot) => bot.previous !== null && bot.lastDay <= today));
  assert.ok(report.totals.errors > 0 && report.statuses.some((row) => row.status === 'not_found'));
  assert.equal(report.statuses.reduce((sum, row) => sum + row.visits, 0), expected);
  assert.equal(report.pages.length, 11);
  assert.deepEqual(report.pages.filter((page) => page.cited).map((page) => page.path), ['/pricing'], 'a cited page matches whatever its case and trailing slash');
  assert.ok(report.totals.sitePages >= report.totals.pages);
  assert.ok(report.operators.find((row) => row.operator === 'OpenAI').referrals > 0);
  // AI Traffic: the LLMs, their days and the pages their visits landed on.
  assert.equal(report.llms[0].id, 'chatgpt');
  assert.equal(report.llms.reduce((sum, row) => sum + row.visits, 0), report.totals.referrals);
  assert.ok(report.llms.every((row) => row.previous !== null && row.pages > 0 && row.lastDay <= today));
  assert.equal(report.llmTrend.length, 28);
  assert.equal(report.llmTrend.reduce((sum, row) => sum + report.llms.reduce((total, llm) => total + row[llm.id], 0), 0), report.totals.referrals);
  assert.equal(weekly(report.llmTrend).reduce((sum, row) => sum + row.chatgpt, 0), report.llms[0].visits);
  assert.equal(report.landings.reduce((sum, row) => sum + row.visits, 0), report.totals.referrals);
  assert.equal(report.totals.landingPages, report.landings.length);
  assert.equal(report.landingsFrom, days[0].day);
  // Drill downs: one bot, one LLM, one page.
  const filtered = async (filter) => shapeReport({ connection, results: await read(previous, filter), current, previous, cited: new Set(), filter });
  const gptbot = await filtered({ bot: 'gptbot' });
  assert.deepEqual(gptbot.bots.map((row) => row.id), ['gptbot']);
  assert.equal(gptbot.totals.visits, report.bots.find((row) => row.id === 'gptbot').visits);
  assert.equal(gptbot.totals.referrals, report.totals.referrals, 'a bot does not narrow the visits sent');
  const claude = await filtered({ llm: 'claude' });
  assert.deepEqual(claude.llms.map((row) => row.id), ['claude']);
  assert.equal(claude.totals.referrals, report.llms.find((row) => row.id === 'claude').visits);
  assert.equal(claude.totals.visits, report.totals.visits, 'an LLM does not narrow the bots');
  const home = await filtered({ page: '/' });
  assert.deepEqual(home.pages.map((row) => row.path), ['/']);
  assert.deepEqual(home.landings.map((row) => row.path), ['/']);
  assert.equal(home.totals.referrals, report.landings.find((row) => row.path === '/').visits);

  // Too few earlier days: no comparison (lib/period-coverage.ts), never a change from a thin base.
  const early = { from: addDays(today, -50), to: addDays(today, -40) };
  const thin = shapeReport({ connection, results: await read(early), current, previous: early, cited: new Set() });
  assert.equal(thin.period.compared, false);
  assert.equal(thin.totals.previousVisits, null);
  assert.ok(thin.bots.every((bot) => bot.previous === null));
  // Comparison off.
  assert.equal(shapeReport({ connection, results: await read(null), current, previous: null, cited: new Set() }).period.compareFrom, null);

  // A Free zone: the referrals are unknown, never zero.
  const free = { ...connection, capabilities: { pages: true, referrals: false } };
  await rpc({ scope, action: 'bots-clear' });
  await rpc({ scope, action: 'bots-put', days: exampleBotDays({ today, days: 10, referrals: false }), syncedAt: `${today}T06:00:00.000Z` });
  const freeReport = shapeReport({ connection: free, results: await read(previous), current, previous, cited: new Set() });
  assert.equal(freeReport.totals.referrals, null);
  assert.equal(freeReport.period.covered, 11);
  assert.equal(freeReport.period.compared, false);

  await rpc({ scope, action: 'bots-clear' });
  const cleared = shapeReport({ connection, results: await read(previous), current, previous, cited: new Set() });
  assert.equal(cleared.period.covered, 0);
  assert.equal(cleared.totals.visits, 0);
  await assert.rejects(rpc({ scope, action: 'bots-put', days: [{ day: 'not a day', hits: [], paths: [] }], syncedAt: today }), /Invalid AI bots days/);
  console.log('AI bots store integration passed');
} finally {
  await runtime.dispose();
  await rm(directory, { recursive: true, force: true });
}
