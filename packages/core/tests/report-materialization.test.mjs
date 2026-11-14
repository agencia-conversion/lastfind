import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
// The store runs in Cloudflare's current runtime (package.json `miniflare-production`, beside the local tools' own): its
// SQLite compiles report statements with the limits that runtime enforces.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare-production';
import { storeIdentity } from '../lib/project-store-contract.ts';
import { pageTypeRuleSql, siteTypeRuleSql } from '../lib/source-type-rules.ts';

// The project store keeps report results for its current data (report_cache) and recomputes the default first screens
// after each change (report_templates). A kept or recomputed result must be exactly the live one, for every filter and
// window, before and after the data changes; and a store saved before the answer split moves its text without changing
// what it holds.
const root = resolve(import.meta.dirname, '../../..');
const shims = {
  './semantic-source-rows': "export const semanticSourceStatement=()=>({token:'semantic'});export const semanticSourceRowsFrom=()=>[];export const semanticSourcePeriods=(current)=>({current,previous:[]});",
  './env': "export const now=()=>new Date().toISOString();export const appOrigin=()=>{throw new Error('none')};export const db=()=>({batch:async(statements)=>statements.map((s)=>({results:s.token==='project'?[globalThis.materialized.project]:s.token==='registry'?[globalThis.materialized.registry()]:[]}))});",
  './project-reads': "export const ownedProjectStatement=()=>({token:'project'});export const projectStoreStatement=()=>({token:'registry'});export const foundProject=(row)=>row;",
  './offers-config': 'export const offersEnabled=()=>false;',
  './workspace': 'export async function ownedProject() { return globalThis.materialized.project; }',
  './http': 'export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }',
  './project-store': 'export async function ensureProjectStore(){return globalThis.materialized.registry()} export async function syncProjectStore(){}',
  './project-store-transport': 'export const projectStoreRpc=(m)=>globalThis.materialized.rpc(m);',
  // A kept response is written after the response leaves: the test waits for those writes (`kept`).
  'cloudflare:workers': 'export const env={};export const waitUntil=(promise)=>globalThis.materialized.kept.push(promise);',
};
// The real reports and the real project-store-read (what the Worker sends the store), with D1 and transport replaced.
const reportsBundle = await build({
  entryPoints: [resolve(root, 'packages/core/lib/server/reports.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: { '@': resolve(root, 'packages/core') },
  plugins: [
    {
      name: 'materialized-shims',
      setup(builder) {
        builder.onResolve(
          { filter: /^(\.\/(workspace|http|semantic-source-rows|env|project-reads|offers-config|project-store|project-store-transport)|cloudflare:workers)$/ },
          (args) => ({ path: args.path, namespace: 'shim' }),
        );
        builder.onLoad({ filter: /.*/, namespace: 'shim' }, (args) => ({ contents: shims[args.path], loader: 'js' }));
      },
    },
  ],
});
const reports = await import(`data:text/javascript;base64,${Buffer.from(reportsBundle.outputFiles[0].text).toString('base64')}`);

/** The store, plus `LegacyStore`: on `legacy` it puts its runs back in one table with the text inline, as stores were before the split. */
const storeBundle = await build({
  stdin: {
    contents: `import { ProjectStore } from './packages/core/worker/project-store.ts';
      export { ProjectStore };
      export class LegacyStore extends ProjectStore {
        async fetch(request) {
          const message = await request.clone().json();
          if (message.action !== 'legacy') return super.fetch(request);
          const sql = this.ctx.storage.sql;
          this.ctx.storage.transactionSync(() => {
            for (const { name } of sql.exec("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'report_epoch_%'").toArray())
              sql.exec('DROP TRIGGER ' + name);
            sql.exec('DROP TRIGGER run_positions_update');
            sql.exec('UPDATE run_rows SET answer=(SELECT answer FROM run_answers WHERE run_id=run_rows.id)');
            sql.exec('DROP VIEW runs');
            sql.exec('DROP TABLE run_answers');
            sql.exec('DROP TABLE report_cache');
            sql.exec('DROP TABLE report_templates');
            sql.exec('ALTER TABLE run_rows RENAME TO runs');
            sql.exec("CREATE TRIGGER run_positions_update AFTER UPDATE OF answer,status,response_available,targets_json,mentions_json ON runs BEGIN DELETE FROM run_positions WHERE run_id=NEW.id; UPDATE store_meta SET value='1' WHERE key='positions_pending'; END");
            sql.exec("DELETE FROM store_meta WHERE key IN ('answers_split','answers_split_cursor','data_epoch','warm_after')");
          });
          return Response.json({ ok: true });
        }
      }
      export default { fetch() { return new Response(null, { status: 404 }); } };`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  external: ['cloudflare:workers'],
  write: false,
});

const DAY = 86400000;
const targets = [
  { name: 'Acme', domain: 'acme.test', domains: ['acme.test', 'shop.acme.test'] },
  { name: 'Rival', domain: 'rival.test' },
  { name: 'Orbit', domain: 'orbit.test' },
];
const project = { id: 'fixture', name: 'Acme', domain: 'acme.test', competitors_json: JSON.stringify(targets.slice(1)) };

function runRow(serial, prompt, created) {
  const domains = ['acme.test', 'shop.acme.test', 'rival.test', 'orbit.test', 'news.example', 'blog.example', 'wiki.example', ''];
  const cited = Array.from({ length: serial % 6 }, (_, index) => {
    const domain = domains[(serial + index * 3) % domains.length];
    return domain
      ? { url: `https://${domain}/page-${(serial + index) % 4}`, title: `Page ${index}`, domain }
      : { url: `https://www.unlisted-${serial % 3}.example/x?y=1`, title: 'No domain' };
  });
  const mentions = { Acme: serial % 2 === 0, Rival: serial % 3 === 0, Orbit: serial % 4 === 0 };
  return {
    id: `r-${String(serial).padStart(5, '0')}`,
    owner_id: 'owner',
    project_id: 'fixture',
    prompt_id: prompt.id,
    prompt_text: prompt.text,
    engine: prompt.engine,
    status: serial % 17 === 0 ? 'failed' : 'complete',
    targets_json: JSON.stringify(targets),
    answer: `Answer ${serial}. ${mentions.Acme ? 'Acme is first.' : ''} ${mentions.Rival ? 'Rival is next.' : ''} ${mentions.Orbit ? 'Orbit too.' : ''} ${'detail '.repeat(serial % 40)}`,
    model: 'model',
    mentions_json: JSON.stringify(mentions),
    sources_json: JSON.stringify(cited),
    consulted_sources_json: serial % 3 ? JSON.stringify(cited.slice(0, 2)) : null,
    search_queries_json: JSON.stringify(prompt.engine === 'chat_gpt' ? [`query ${serial % 5}`, `other ${serial % 2}`] : []),
    response_available: 1,
    cost: 0.001,
    error: null,
    created_at: created,
    completed_at: created,
    raw_response_status: 'captured',
  };
}
/** Answers over 100 days at uneven hours, so the 1–90 day boundaries fall between answers. */
function fixture(now) {
  const prompts = [];
  for (let unit = 0; unit < 4; unit++)
    for (const engine of ['chat_gpt', 'gemini', 'perplexity'])
      prompts.push({ id: `p${unit}-${engine}`, project_id: 'fixture', text: `Question ${unit}`, engine, tag: unit % 2 ? 'Pricing' : 'Comparison', tags_json: JSON.stringify(unit % 2 ? ['paid'] : []), active: 1, archived: 0, created_at: new Date(now - 200 * DAY).toISOString(), unit_id: `p${unit}-chat_gpt`, subscribed: 1 });
  const runs = [];
  let serial = 0;
  for (let day = 0; day < 100; day++)
    for (const prompt of prompts) {
      serial++;
      if (serial % 5 === 0) continue;
      runs.push(runRow(serial, prompt, new Date(now - day * DAY - (3600 + ((serial * 7919) % 80000)) * 1000).toISOString()));
    }
  return { prompts, runs };
}

async function storeRuntime(directory, className) {
  return new Miniflare(
    convertV4MiniflareOptions({
      name: 'lastfind-report-materialization',
      modules: true,
      script: storeBundle.outputFiles[0].text,
      compatibilityDate: '2026-05-22',
      durableObjects: { PROJECT_STORES: { className, useSQLite: true } },
      resourcePersistencePath: directory,
      unsafeDevRegistryPath: resolve(directory, 'registry'),
      telemetry: { enabled: false },
      logRequests: false,
    }),
  );
}
async function connect(runtime, scope) {
  const namespace = await runtime.getDurableObjectNamespace('PROJECT_STORES');
  const stub = namespace.get(namespace.idFromName(storeIdentity(scope)));
  return async (message) => {
    const response = await stub.fetch('https://project-store/rpc', { method: 'POST', body: JSON.stringify({ scope, ...message }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
}
async function publish(rpc, records, from = 1) {
  for (let offset = 0; offset < records.length; offset += 100)
    await rpc({
      action: 'apply',
      changes: records.slice(offset, offset + 100).map(({ entity, data, id }, index) => ({ entity, id: id ?? data.id, revision: from + offset + index, data })),
    });
}

const VIEWS = (q) => ({
  summary: (ctx) => reports.summaryReport(ctx),
  analysis: (ctx) => reports.analysisReport(ctx, q),
  history: (ctx) => reports.historyReport(ctx, q),
  prompts: (ctx) => reports.promptReport(ctx, true),
  'prompts-full': (ctx) => reports.promptReport(ctx, false),
  competitors: (ctx) => reports.competitorsReport(ctx, q),
  fanout: (ctx) => reports.fanoutReport(ctx, q),
  'sources-domain': (ctx) => reports.sourcesReport(ctx, new URLSearchParams(`${q}&kind=cited&group=domain&order=presence`)),
  'sources-url': (ctx) => reports.sourcesReport(ctx, new URLSearchParams(`${q}&kind=cited&group=url&order=presence`)),
  'sources-consulted': (ctx) => reports.sourcesReport(ctx, new URLSearchParams(`${q}&kind=consulted&group=domain`)),
});
// The rolling window ends at a new `now` on every read: compare what the period selects, not the echo of its bounds.
const strip = (value) => JSON.parse(JSON.stringify(value), (key, item) => (['currentStart', 'previousStart', 'previousEnd', 'end'].includes(key) ? undefined : item));

await test('kept and recomputed report reads are the live reads, for every filter and window, before and after changes', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'lastfind-materialized-'));
  const runtime = await storeRuntime(directory, 'ProjectStore');
  const scope = { ownerId: 'owner', projectId: 'fixture', generation: 'materialized' };
  try {
    const rpc = await connect(runtime, scope);
    await rpc({ action: 'initialize' });
    const now = Date.now();
    const { prompts, runs } = fixture(now);
    await publish(rpc, [...prompts.map((data) => ({ entity: 'prompts', data })), ...runs.map((data) => ({ entity: 'runs', data }))]);
    let revision = 0;
    // `live`: the report flag is withheld, so the store executes every statement. Otherwise the replies say what was kept.
    const read = async (query, live) => {
      const replies = [];
      globalThis.materialized = {
        project,
        // A new revision every read: the Worker's own in-memory cache never answers, only the store.
        registry: () => ({ project_id: 'fixture', workspace_id: 'owner', generation: scope.generation, initialized: 1, source_revision: ++revision, applied_revision: revision }),
        rpc: async (message) => {
          const reply = await rpc(live && message.action === 'query' ? { ...message, report: undefined } : message);
          if (message.action === 'query' && message.report) replies.push(...reply);
          return reply;
        },
        kept: [],
      };
      const q = new URLSearchParams(`project=fixture&${query}`);
      const views = {};
      for (const [name, view] of Object.entries(VIEWS(q))) views[name] = strip(await view(await reports.reportContext('owner', q)));
      return { views, kept: replies.length > 0 && replies.every((reply) => reply.meta?.cached === true), replies: replies.length };
    };
    const custom = `start=${new Date(now - 50 * DAY).toISOString().slice(0, 10)}&end=${new Date(now - 20 * DAY).toISOString().slice(0, 10)}`;
    const queries = [
      'days=1', 'days=7', 'days=14', 'days=28', 'days=30', 'days=90',
      'days=28&engine=chat_gpt', 'days=7&engine=gemini,perplexity', 'days=28&brand=Rival', 'days=28&brand=Unlisted',
      'days=28&citation=missing-own', 'days=28&topic=Pricing', 'days=90&tags=paid', 'days=28&mention=mentioned',
      'days=28&gap=competitor-only', 'days=28&status=failed', 'days=28&q=Acme', custom,
    ];
    let compared = 0;
    for (const query of queries) {
      const live = await read(query, true);
      const first = await read(query, false);
      const second = await read(query, false);
      assert.ok(second.kept, `${query}: the second read is served from what the store kept (${second.replies} replies)`);
      for (const view of Object.keys(live.views)) {
        assert.deepEqual(first.views[view], live.views[view], `${query} ${view} (first read)`);
        assert.deepEqual(second.views[view], live.views[view], `${query} ${view} (kept)`);
        compared++;
      }
    }
    assert.ok(compared >= queries.length * 10);

    // New data: a new answer, an answer rewritten (other mentions and text), one removed, a prompt renamed.
    const changedRun = runs.find((run) => Date.parse(run.created_at) > now - 5 * DAY && run.status === 'complete');
    await publish(
      rpc,
      [
        { entity: 'runs', data: runRow(90001, prompts[1], new Date(now - 2 * 3600000).toISOString()) },
        { entity: 'runs', data: { ...changedRun, answer: 'Only Orbit and Rival here.', mentions_json: JSON.stringify({ Acme: false, Rival: true, Orbit: true }) } },
        { entity: 'runs', id: runs[3].id, data: null },
        { entity: 'prompts', data: { ...prompts[2], text: 'Question renamed', tag: 'Pricing' } },
      ],
      100000,
    );
    // The first screens (no filter) are recomputed by the store before anyone asks again.
    for (let pending = true; pending; ) pending = (await rpc({ action: 'warm' })).pending;
    const [remembered] = await rpc({ action: 'query', statements: [{ sql: 'SELECT COUNT(*) n FROM report_templates', params: [] }] });
    assert.ok(remembered.results[0].n > 10 && remembered.results[0].n <= 48, 'the most recently used first-screen reads, and no more');
    // The last windows read are the ones still remembered (the oldest left the list).
    for (const query of ['days=90', 'days=30']) {
      const kept = await read(query, false);
      assert.ok(kept.kept, `${query}: recomputed after the change, before it was asked`);
      const live = await read(query, true);
      for (const view of Object.keys(live.views)) assert.deepEqual(kept.views[view], live.views[view], `${query} ${view} recomputed`);
    }
    for (const query of queries) {
      const kept = await read(query, false);
      const live = await read(query, true);
      for (const view of Object.keys(live.views)) assert.deepEqual(kept.views[view], live.views[view], `${query} ${view} after the change`);
    }
    // A changed active analysis is a change too: nothing kept under the previous one is served.
    await rpc({ action: 'analysis-set-current', revision: 'another-reading' });
    const after = await read('days=28', false);
    assert.equal(after.kept, false, 'a new active analysis is not served from results kept before it');
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

await test('a kept response is the report computed now, and is not found once the data, the request or its D1 reads change', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'lastfind-copies-'));
  const runtime = await storeRuntime(directory, 'ProjectStore');
  const scope = { ownerId: 'owner', projectId: 'fixture', generation: 'copies' };
  try {
    const rpc = await connect(runtime, scope);
    await rpc({ action: 'initialize' });
    const now = Date.now();
    const { prompts, runs } = fixture(now);
    await publish(rpc, [...prompts.map((data) => ({ entity: 'prompts', data })), ...runs.map((data) => ({ entity: 'runs', data }))]);
    let revision = 0;
    const puts = [];
    globalThis.materialized = {
      project,
      registry: () => ({ project_id: 'fixture', workspace_id: 'owner', generation: scope.generation, initialized: 1, source_revision: ++revision, applied_revision: revision }),
      rpc: (message) => {
        if (message.action === 'copy-put') puts.push(message.key);
        return rpc(message);
      },
      kept: [],
    };
    // The context of one request (the route names it by its canonical query, view included), as the reports route opens it.
    const open = (query, view) => {
      const q = new URLSearchParams(`project=fixture&${query}&view=${view}`);
      q.sort();
      return reports.reportContext('owner', q, [], undefined, undefined, ['reports', String(q)]);
    };
    const settle = async () => {
      await Promise.all(globalThis.materialized.kept);
      globalThis.materialized.kept = [];
    };
    const queries = ['days=7', 'days=28', 'days=90', 'days=28&engine=chat_gpt', 'days=28&brand=Rival', 'days=90&tags=paid', 'days=28&gap=competitor-only'];
    let compared = 0;
    for (const query of queries)
      for (const [name, view] of Object.entries(VIEWS(new URLSearchParams(`project=fixture&${query}`)))) {
        const first = await open(query, name);
        assert.equal(first.database.keptResponse('extras'), null, `${query} ${name}: nothing kept yet`);
        first.database.keepResponse('extras', JSON.stringify(await view(first)));
        await settle();
        const second = await open(query, name);
        const body = second.database.keptResponse('extras');
        assert.ok(body, `${query} ${name}: kept`);
        assert.deepEqual(strip(JSON.parse(body)), strip(await view(second)), `${query} ${name}: the kept response is the live one`);
        assert.equal(second.database.keptResponse('other D1 reads'), null, `${query} ${name}: made with other D1 reads`);
        compared++;
      }
    assert.equal(compared, queries.length * Object.keys(VIEWS(new URLSearchParams())).length);
    // Another request (period, filter or view) never finds it.
    assert.equal((await open('days=14', 'summary')).database.keptResponse('extras'), null);
    // A read that touched tables written outside the data epoch is not kept.
    const unversioned = await open('days=30', 'summary');
    await unversioned.database.prepare('SELECT COUNT(*) n FROM competitor_suggestions').all();
    const before = puts.length;
    unversioned.database.keepResponse('extras', '{}');
    await settle();
    assert.equal(puts.length, before, 'not kept');
    // New data: no kept response is found, and the next one kept is the new live one.
    await publish(rpc, [{ entity: 'runs', data: runRow(90001, prompts[1], new Date(now - 2 * 3600000).toISOString()) }], 100000);
    for (const [name, view] of Object.entries(VIEWS(new URLSearchParams('project=fixture&days=28')))) {
      const changed = await open('days=28', name);
      assert.equal(changed.database.keptResponse('extras'), null, `${name}: nothing kept for the new data`);
      changed.database.keepResponse('extras', JSON.stringify(await view(changed)));
      await settle();
      const again = await open('days=28', name);
      assert.deepEqual(strip(JSON.parse(again.database.keptResponse('extras'))), strip(await view(again)), `${name}: kept again for the new data`);
    }
    // A new active analysis is a change too.
    await rpc({ action: 'analysis-set-current', revision: 'another-reading' });
    assert.equal((await open('days=28', 'summary')).database.keptResponse('extras'), null);

    // Bounded: the store keeps a few megabytes of copies at most, none above 1 MiB of text, only for its current data, and it
    // reads their sizes without their text (the text is the last column).
    const head = async () =>
      (await rpc({ action: 'query', statements: [{ sql: 'SELECT COUNT(*) n,COALESCE(SUM(bytes),0) bytes,COUNT(DISTINCT epoch) epochs FROM kept_responses', params: [] }] }))[0].results[0];
    const columns = (await rpc({ action: 'query', statements: [{ sql: "SELECT name FROM pragma_table_info('kept_responses')", params: [] }] }))[0].results.map((row) => row.name);
    assert.equal(columns.at(-1), 'value');
    const probe = (index) => rpc({ action: 'copy-get', copy: { base: String(index % 10).repeat(64) }, bounds: [new Date(now - 28 * DAY).toISOString()] });
    const first = await probe(0);
    assert.equal((await rpc({ action: 'copy-put', key: first.key, epoch: first.epoch, value: 'x'.repeat(1024 * 1024 + 1) })).kept, false, 'too large');
    for (let index = 0; index < 20; index++) {
      const copy = await rpc({ action: 'copy-get', copy: { base: (index + 10).toString(16).padStart(64, '0') } });
      assert.equal((await rpc({ action: 'copy-put', key: copy.key, epoch: copy.epoch, value: 'y'.repeat(900 * 1024) })).kept, true);
    }
    let kept = await head();
    assert.ok(kept.bytes <= 8 * 1024 * 1024 && kept.n <= 120, `within the caps (${kept.n} copies, ${kept.bytes} characters)`);
    assert.equal(kept.epochs, 1);
    // New data: the copies of the old data go with the next one kept.
    await publish(rpc, [{ entity: 'runs', data: runRow(90002, prompts[2], new Date(now - 3600000).toISOString()) }], 200000);
    await rpc({ action: 'status', fill: true });
    const fresh = await probe(1);
    await rpc({ action: 'copy-put', key: fresh.key, epoch: fresh.epoch, value: '{}' });
    kept = await head();
    assert.deepEqual([kept.n, kept.epochs], [1, 1]);

    // The last copy of a read survives new data (stale-while-revalidate), only when asked for, within its own caps.
    const base = 'a'.repeat(64);
    const older = await rpc({ action: 'copy-get', copy: { base, last: true } });
    await rpc({ action: 'copy-put', key: older.key, epoch: older.epoch, value: '{"old":1}', last: true });
    await publish(rpc, [{ entity: 'runs', data: runRow(90003, prompts[3], new Date(now - 1800000).toISOString()) }], 300000);
    await rpc({ action: 'status', fill: true });
    const newer = await rpc({ action: 'copy-get', copy: { base, last: true } });
    assert.equal(newer.value, undefined, 'nothing kept for the new data');
    assert.equal(newer.last.value, '{"old":1}', 'the last copy is painted while the read is computed again');
    assert.equal((await rpc({ action: 'copy-get', copy: { base } })).last, undefined, 'only when asked for');
    for (let index = 0; index < 45; index++) {
      const copy = await rpc({ action: 'copy-get', copy: { base: index.toString(16).padStart(64, 'b'), last: true } });
      await rpc({ action: 'copy-put', key: copy.key, epoch: copy.epoch, value: '{}', last: true });
    }
    const lasts = (await rpc({ action: 'query', statements: [{ sql: 'SELECT COUNT(*) n FROM last_responses', params: [] }] }))[0].results[0].n;
    assert.equal(lasts, 40, 'the newest 40 reads');
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

await test('a store saved before the answer split moves its text in place, keeping its rows, digests and ranks', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'lastfind-answer-split-'));
  const scope = { ownerId: 'owner', projectId: 'fixture', generation: 'split' };
  const now = Date.now();
  const { prompts, runs } = fixture(now);
  const snapshot = async (rpc) => {
    const rows = [];
    for (let cursor = ''; cursor !== null; ) {
      const page = await rpc({ action: 'scan', entity: 'runs', cursor, limit: 100 });
      rows.push(...page.rows);
      cursor = page.nextCursor;
    }
    const [positions] = await rpc({ action: 'query', statements: [{ sql: 'SELECT COUNT(*) n FROM run_positions', params: [] }] });
    return { rows, positions: positions.results[0].n };
  };
  let before;
  let runtime = await storeRuntime(directory, 'LegacyStore');
  try {
    const rpc = await connect(runtime, scope);
    await rpc({ action: 'initialize' });
    await publish(rpc, [...prompts.map((data) => ({ entity: 'prompts', data })), ...runs.map((data) => ({ entity: 'runs', data }))]);
    for (let cursor = '', done = false; !done; ) ({ cursor, done } = await rpc({ action: 'positions-fill', cursor }));
    before = await snapshot(rpc);
    await rpc({ action: 'legacy' });
  } finally {
    await runtime.dispose();
  }
  runtime = await storeRuntime(directory, 'LegacyStore');
  try {
    const rpc = await connect(runtime, scope);
    const meta = async (key) => (await rpc({ action: 'query', statements: [{ sql: 'SELECT value FROM store_meta WHERE key=?', params: [key] }] }))[0].results[0]?.value;
    // Readable while the alarm moves the text, and the same afterwards.
    assert.deepEqual((await snapshot(rpc)).rows, before.rows);
    for (let wait = 0; (await meta('answers_split')) === 'pending'; wait++) {
      assert.ok(wait < 600, 'the alarm moves every answer');
      await new Promise((done) => setTimeout(done, 100));
    }
    const after = await snapshot(rpc);
    assert.deepEqual(after.rows, before.rows);
    assert.equal(after.positions, before.positions);
    assert.equal(await meta('positions_pending'), '0', 'moving the text does not rank the answers again');
    const [inline, moved, view] = await rpc({
      action: 'query',
      statements: [
        { sql: 'SELECT COUNT(*) n FROM run_rows WHERE answer IS NOT NULL', params: [] },
        { sql: 'SELECT COUNT(*) n FROM run_answers', params: [] },
        { sql: "SELECT type FROM sqlite_master WHERE name='runs'", params: [] },
      ],
    });
    assert.equal(inline.results[0].n, 0);
    assert.equal(moved.results[0].n, runs.length);
    assert.equal(view.results[0].type, 'view');
    // A publication after the split writes the text apart and ranks the answer again; a removal takes the text with it.
    await publish(rpc, [{ entity: 'runs', data: { ...runs[0], answer: 'Rival only.' } }, { entity: 'runs', id: runs[1].id, data: null }], 100000);
    const [text, gone, ranked] = await rpc({
      action: 'query',
      statements: [
        { sql: 'SELECT answer FROM runs WHERE id=?', params: [runs[0].id] },
        { sql: 'SELECT COUNT(*) n FROM run_answers WHERE run_id=?', params: [runs[1].id] },
        { sql: 'SELECT COUNT(*) n FROM run_positions WHERE run_id=?', params: [runs[0].id] },
      ],
    });
    assert.equal(text.results[0].answer, 'Rival only.');
    assert.equal(gone.results[0].n, 0);
    assert.equal(ranked.results[0].n, 0, 'new text, ranks pending');
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

await test('every Sources read runs in the store as the production runtime compiles it: pages, leaders and change agree', async () => {
  // The Durable Object SQLite refuses a statement whose CTEs and subqueries, copied wherever they are read, add up to about
  // 100 ("VIEWs and/or subqueries nested too deep", Cloudflare's runtime from 10/11/2026, which these tests run).
  // The Sources list read its answers through CTEs that read each other again and failed for every project and period.
  const directory = await mkdtemp(resolve(tmpdir(), 'lastfind-sources-'));
  const runtime = await storeRuntime(directory, 'ProjectStore');
  const scope = { ownerId: 'owner', projectId: 'fixture', generation: 'sources' };
  try {
    const rpc = await connect(runtime, scope);
    await rpc({ action: 'initialize' });
    const now = Date.now();
    const { prompts, runs } = fixture(now);
    await publish(rpc, [...prompts.map((data) => ({ entity: 'prompts', data })), ...runs.map((data) => ({ entity: 'runs', data }))]);
    let revision = 0;
    globalThis.materialized = {
      project: { ...project, topic_weights_json: '{"Pricing":3,"Comparison":1}' },
      registry: () => ({ project_id: 'fixture', workspace_id: 'owner', generation: scope.generation, initialized: 1, source_revision: ++revision, applied_revision: revision }),
      rpc,
      kept: [],
    };
    const read = async (query, size, change = false) => {
      const q = new URLSearchParams(`project=fixture&days=90&${query}`);
      return reports.sourcesReport(await reports.reportContext('owner', q), q, size, undefined, change);
    };
    const queries = [
      'kind=cited&group=domain',
      'kind=cited&group=url',
      'kind=consulted&group=domain',
      'kind=all&evidence=1&group=url',
      'kind=uncited&group=domain',
      'kind=cited&group=domain&owner=own,competitor&sort=questions&dir=asc&query=e',
    ];
    for (const query of queries) {
      const whole = await read(`${query}&page=1`, 500);
      const first = await read(`${query}&page=1`, 3);
      const second = await read(`${query}&page=2`, 3);
      assert.deepEqual([...first.rows, ...second.rows].map((row) => row.key), whole.rows.slice(0, 6).map((row) => row.key), `${query}: pages continue each other`);
      assert.equal(first.hasMore, whole.rows.length > 3, query);
      if (!whole.rows.length) continue;
      const byPresence = [...whole.rows].sort((a, b) => b.presence.presence - a.presence.presence || (a.key < b.key ? -1 : 1));
      assert.deepEqual(first.leaders.ranking.map((row) => row.key), byPresence.slice(0, 10).map((row) => row.key), `${query}: leaders`);
      assert.equal(first.leaders.widest.presence.questions, Math.max(...whole.rows.map((row) => row.presence.questions)), `${query}: widest`);
      assert.ok(whole.totals.slots > 0 && whole.complete >= whole.available && whole.rows.every((row) => row.responses > 0 && row.engines.length > 0), query);
    }
    // A site or content type filter: the deterministic type rules decide a key before the catalog keys (source-types.ts).
    const typed = async (query, selection) => {
      const q = new URLSearchParams(`project=fixture&${query}`);
      return reports.sourcesReport(await reports.reportContext('owner', q), q, 50, selection, true);
    };
    for (const days of ['1', '28', '90']) {
      await typed(`days=${days}&kind=all&evidence=1&group=domain&page=1`, { keys: ['news.example'], rules: siteTypeRuleSql('lower(key)', ['editorial']) });
      await typed(`days=${days}&kind=cited&group=domain&page=1`, { keys: ['news.example'], exclude: true, rules: siteTypeRuleSql('lower(key)', ['editorial', 'corporate']) });
      await typed(`days=${days}&kind=all&evidence=1&group=url&page=1`, { keys: ['https://acme.test/page-0'], rules: pageTypeRuleSql('key', ['homepage']) });
    }
    const list = await read('kind=all&evidence=1&group=domain&page=1', 50, true);
    // The comparison's statement runs; a period with under half the current answers is no comparison (null, lib/period-coverage).
    const comparable = (rows) => rows.every((row) => typeof row.previousPresence === 'number') || rows.every((row) => row.previousPresence === null);
    assert.ok(list.rows.length && comparable(list.rows), 'each row has its presence in the comparison period, or none has');
    // A period filtered by a competitor's mentions names that brand (report_brand) in the comparison's statement too.
    const rival = await read('kind=all&evidence=1&group=domain&page=1&brand=Rival&mention=mentioned', 50, true);
    assert.ok(comparable(rival.rows), 'the comparison of a brand-filtered list');
    const domain = await reports.sourceEntityReport('owner', new URLSearchParams('project=fixture&days=90&key=acme.test&change=1'), 'domain');
    assert.ok(domain.presence.slots > 0, 'the domain page reads its presence');
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

await test('a prompt is read by its own answers: its report reads a small part of what the period holds', async () => {
  // The prompt filter was an EXISTS tested on every answer of the period, and the store (no statistics) read the whole
  // period to find one question's answers: seconds on a cold store. It is now an IN list read by its own index.
  const directory = await mkdtemp(resolve(tmpdir(), 'lastfind-prompt-'));
  const runtime = await storeRuntime(directory, 'ProjectStore');
  const scope = { ownerId: 'owner', projectId: 'fixture', generation: 'prompt' };
  try {
    const rpc = await connect(runtime, scope);
    await rpc({ action: 'initialize' });
    const { prompts, runs } = fixture(Date.now());
    await publish(rpc, [...prompts.map((data) => ({ entity: 'prompts', data })), ...runs.map((data) => ({ entity: 'runs', data }))]);
    let revision = 0;
    let rowsRead = 0;
    globalThis.materialized = {
      project,
      registry: () => ({ project_id: 'fixture', workspace_id: 'owner', generation: scope.generation, initialized: 1, source_revision: ++revision, applied_revision: revision }),
      rpc: async (message) => {
        const reply = await rpc(message.action === 'query' ? { ...message, report: undefined } : message);
        if (message.action === 'query') rowsRead += reply.reduce((sum, result) => sum + (result.meta?.rows_read ?? 0), 0);
        return reply;
      },
      kept: [],
    };
    const read = async (query) => {
      rowsRead = 0;
      const q = new URLSearchParams(`project=fixture&days=90&${query}`);
      const result = await reports.promptDetail(await reports.reportContext('owner', q), q);
      return { result, rowsRead };
    };
    const one = await read(`prompt=${prompts[0].id}`);
    assert.ok(one.result.metrics.responses > 0, 'the prompt has answers');
    // A unit is one question asked of three AIs: a quarter of the fixture's answers. Read through the period, the report read
    // 45,321 rows for this fixture's 864 answers; by the prompt's own answers, 5,478.
    const period = runs.filter((run) => Date.parse(run.created_at) >= Date.now() - 90 * DAY).length;
    assert.ok(one.rowsRead < period * 8, `${one.rowsRead} rows read for a prompt, in a period of ${period} answers`);
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

await test('a decision landing on the answers (the discoveries share of voice counts) is read at once, not from a copy made before it', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'lastfind-verdicts-'));
  const runtime = await storeRuntime(directory, 'ProjectStore');
  const scope = { ownerId: 'owner', projectId: 'fixture', generation: 'verdicts' };
  try {
    const rpc = await connect(runtime, scope);
    await rpc({ action: 'initialize' });
    const now = Date.now();
    const prompt = { id: 'p0-chat_gpt', project_id: 'fixture', text: 'Question 0', engine: 'chat_gpt', tag: 'Comparison', tags_json: '[]', active: 1, archived: 0, created_at: new Date(now - 200 * DAY).toISOString(), unit_id: 'p0-chat_gpt', subscribed: 1 };
    // Every answer lists Acme and a brand nobody monitors, Zenith Works, the way answers list brands.
    const runs = Array.from({ length: 12 }, (_, index) => ({
      ...runRow(index * 2 + 2, prompt, new Date(now - (index + 1) * 3600000).toISOString()),
      status: 'complete',
      answer: `1. **Acme**: release evidence for distributed teams.\n2. **Zenith Works**: coordinates release evidence for distributed teams.\n3. **Rival**: a third option.`,
      mentions_json: JSON.stringify({ Acme: true, Rival: true, Orbit: false }),
    }));
    await publish(rpc, [{ entity: 'prompts', data: prompt }, ...runs.map((data) => ({ entity: 'runs', data }))]);
    // The brand analysis reads them (no decision model: nothing is asked) and finds Zenith Works in each.
    let status = await rpc({ action: 'analysis-start', revision: 'targets-1', configVersion: 1, targets: targets.map(({ name, domain }) => ({ name, domain })), cutoff: new Date(now - 90 * DAY).toISOString(), maxRuns: 100, mentionModel: false });
    for (let page = 0; status.status !== 'complete' && page < 200; page++) status = await rpc({ action: 'analysis-process' });
    assert.equal(status.status, 'complete');
    const [found] = await rpc({ action: 'query', statements: [{ sql: "SELECT COUNT(*) n FROM run_rows WHERE analysis_brands_json LIKE '%zenith works%'", params: [] }] });
    assert.equal(found.results[0].n, runs.length, 'the analysis found the discovery in every answer');
    // Nothing new is published between the reads: the registry revision stays, as between two collections.
    globalThis.materialized = {
      project,
      registry: () => ({ project_id: 'fixture', workspace_id: 'owner', generation: scope.generation, initialized: 1, source_revision: 7, applied_revision: 7 }),
      rpc: (message) => rpc(message),
      kept: [],
    };
    const read = async () => reports.summaryReport(await reports.reportContext('owner', new URLSearchParams('project=fixture&days=7')));
    const before = await read();
    assert.equal(before.metrics.shareOfVoice, 50, 'Acme and Rival in every answer; the discovery is not settled yet');
    // The roles decision lands (syncCountedBrands): Zenith Works is a competitor, so share of voice counts it.
    await rpc({ action: 'brand-counted', groups: { 'zenith works': 'zenith works' } });
    const after = await read();
    assert.equal(after.metrics.totalMentions, before.metrics.totalMentions + runs.length, 'the counted discovery is read at once');
    assert.ok(Math.abs(after.metrics.shareOfVoice - 100 / 3) < 1e-9, 'Acme, Rival and Zenith Works in every answer');
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
