// A project store in Cloudflare's current runtime (package.json `miniflare-production`) that counts the SQL rows it reads and
// writes, the units Durable Objects SQLite is billed by. Shared by the cost tests (store-costs.test.mjs) and the cost model
// (`node packages/core/tests/store-meter.mjs`, which prints the per-unit numbers docs/costs.md is built from).
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare-production';
import { storeIdentity } from '../lib/project-store-contract.ts';

const root = resolve(import.meta.dirname, '../../..');
const shims = {
  './semantic-source-rows': "export const semanticSourceStatement=()=>({token:'semantic'});export const semanticSourceRowsFrom=()=>[];export const semanticSourcePeriods=(current)=>({current,previous:[]});",
  './env': "export const now=()=>new Date().toISOString();export const appOrigin=()=>{throw new Error('none')};export const db=()=>({batch:async(statements)=>statements.map((s)=>({results:s.token==='project'?[globalThis.metered.project]:s.token==='registry'?[globalThis.metered.registry()]:[]}))});",
  './project-reads': "export const ownedProjectStatement=()=>({token:'project'});export const projectStoreStatement=()=>({token:'registry'});export const foundProject=(row)=>row;",
  './offers-config': 'export const offersEnabled=()=>false;',
  './workspace': 'export async function ownedProject() { return globalThis.metered.project; }',
  './http': 'export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }',
  './project-store': 'export async function ensureProjectStore(){return globalThis.metered.registry()} export async function syncProjectStore(){}',
  './project-store-transport': 'export const projectStoreRpc=(m)=>globalThis.metered.rpc(m);',
  'cloudflare:workers': 'export const env={};export const waitUntil=(promise)=>globalThis.metered.kept.push(promise);',
};
const reportsBundle = await build({
  entryPoints: [resolve(root, 'packages/core/lib/server/reports.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: { '@': resolve(root, 'packages/core') },
  plugins: [
    {
      name: 'metered-shims',
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
export const reports = await import(`data:text/javascript;base64,${Buffer.from(reportsBundle.outputFiles[0].text).toString('base64')}`);

// `MeteredStore` wraps the object's `sql.exec`: every cursor is kept with what was running (a request's action, or `alarm`),
// and `meter` sums their rowsRead/rowsWritten (final once a cursor is read through) and starts again.
const storeBundle = await build({
  stdin: {
    contents: `import { ProjectStore } from './packages/core/worker/${process.env.STORE_ENTRY || 'project-store.ts'}';
      export class MeteredStore extends ProjectStore {
        constructor(ctx, env) {
          const sql = ctx.storage.sql;
          const exec = sql.exec.bind(sql);
          const meter = { phase: 'constructor', cursors: [] };
          sql.exec = (query, ...params) => {
            const cursor = exec(query, ...params);
            meter.cursors.push([meter.phase, query, cursor]);
            return cursor;
          };
          super(ctx, env);
          this.meter = meter;
        }
        async alarm() {
          this.meter.phase = 'alarm';
          try { return await super.alarm(); } finally { this.meter.phase = 'idle'; }
        }
        async fetch(request) {
          const message = await request.clone().json();
          if (message.action === 'size') return Response.json({ bytes: this.ctx.storage.sql.databaseSize });
          if (message.action === 'meter') {
            const phases = {}, statements = {};
            for (const [phase, query, cursor] of this.meter.cursors) {
              const at = (phases[phase] ??= { read: 0, written: 0, statements: 0 });
              at.read += cursor.rowsRead; at.written += cursor.rowsWritten; at.statements++;
              const key = phase + ' ' + query.replace(/\\s+/g, ' ').slice(0, 160);
              const each = (statements[key] ??= { read: 0, written: 0, n: 0 });
              each.read += cursor.rowsRead; each.written += cursor.rowsWritten; each.n++;
            }
            this.meter.cursors = [];
            return Response.json({ phases, statements });
          }
          this.meter.phase = message.action;
          try { return await super.fetch(request); } finally { this.meter.phase = 'idle'; }
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

export const DAY = 86400000;
export const ENGINES = ['chat_gpt', 'gemini', 'google_ai_mode', 'google_ai_overview', 'claude', 'perplexity'];
const BRANDS = ['Acme', 'Rival', 'Orbit', 'Nimbus', 'Vertex', 'Quanta', 'Helix', 'Lumen'];
export const targets = BRANDS.slice(0, 6).map((name, index) => ({ name, domain: `${name.toLowerCase()}.test`, ...(index ? {} : { domains: ['acme.test', 'shop.acme.test'] }) }));
export const project = { id: 'fixture', name: 'Acme', domain: 'acme.test', competitors_json: JSON.stringify(targets.slice(1)) };

/** One answer shaped like production's: a few KB of text naming brands (monitored and not), about eight citations. */
export function runRow(serial, prompt, created) {
  const sites = ['acme.test', 'shop.acme.test', 'rival.test', 'orbit.test', 'news.example', 'blog.example', 'wiki.example', 'review.example', 'forum.example', 'video.example'];
  const cited = Array.from({ length: 4 + (serial % 8) }, (_, index) => {
    const domain = sites[(serial + index * 3) % sites.length];
    return { url: `https://${domain}/page-${(serial + index) % 40}`, title: `Page ${index}`, domain };
  });
  const named = BRANDS.filter((_, index) => (serial + index) % (index + 2) === 0);
  const mentions = Object.fromEntries(targets.map((target) => [target.name, named.includes(target.name)]));
  const list = [...named, `Other ${serial % 50}`, `Brand ${serial % 13}`].map((name, index) => `${index + 1}. **${name}**: ${'a fair option for most people, with good reviews and plans. '.repeat(3)}`).join('\n');
  return {
    id: `r-${String(serial).padStart(7, '0')}`,
    owner_id: 'owner',
    project_id: 'fixture',
    prompt_id: prompt.id,
    prompt_text: prompt.text,
    engine: prompt.engine,
    status: serial % 29 === 0 ? 'failed' : 'complete',
    targets_json: JSON.stringify(targets),
    answer: `Here are the options.\n${list}\n${'More detail about the market. '.repeat(30 + (serial % 40))}`,
    model: 'model',
    mentions_json: JSON.stringify(mentions),
    sources_json: JSON.stringify(cited),
    consulted_sources_json: JSON.stringify(cited.slice(0, 3)),
    search_queries_json: JSON.stringify(prompt.engine === 'chat_gpt' ? [`query ${serial % 5}`, `other ${serial % 2}`] : []),
    response_available: serial % 29 === 0 ? 0 : 1,
    cost: 0.002,
    error: null,
    created_at: created,
    completed_at: created,
    raw_response_status: 'captured',
  };
}

/** `units` questions asked of `engines` AIs once a day for `days` days, at the same hour (a daily slot), with a few misses. */
export function fixture(now, { units = 30, engines = ENGINES.slice(0, 4), days = 90 } = {}) {
  const prompts = [];
  for (let unit = 0; unit < units; unit++)
    for (const engine of engines)
      prompts.push({ id: `p${unit}-${engine}`, project_id: 'fixture', text: `Question ${unit}`, engine, tag: `Topic ${unit % 5}`, tags_json: JSON.stringify(unit % 2 ? ['paid'] : []), active: 1, archived: 0, created_at: new Date(now - 200 * DAY).toISOString(), unit_id: `p${unit}-${engines[0]}`, subscribed: 1 });
  const runs = [];
  let serial = 0;
  for (let day = 0; day < days; day++)
    for (const prompt of prompts) {
      serial++;
      if (serial % 23 === 0) continue;
      runs.push(runRow(serial, prompt, new Date(now - day * DAY - (3600 + (serial % 600) * 7) * 1000).toISOString()));
    }
  return { prompts, runs };
}

export async function storeRuntime(directory) {
  return new Miniflare(
    convertV4MiniflareOptions({
      name: 'lastfind-store-meter',
      modules: true,
      script: storeBundle.outputFiles[0].text,
      compatibilityDate: '2026-05-22',
      durableObjects: { PROJECT_STORES: { className: 'MeteredStore', useSQLite: true } },
      resourcePersistencePath: directory,
      unsafeDevRegistryPath: resolve(directory, 'registry'),
      telemetry: { enabled: false },
      logRequests: false,
    }),
  );
}

export async function connect(runtime, scope) {
  const namespace = await runtime.getDurableObjectNamespace('PROJECT_STORES');
  const stub = namespace.get(namespace.idFromName(storeIdentity(scope)));
  return async (message) => {
    const response = await stub.fetch('https://project-store/rpc', { method: 'POST', body: JSON.stringify({ scope, ...message }) });
    const result = await response.json();
    if (response.status !== 200) throw new Error(JSON.stringify(result));
    return result;
  };
}

export async function publish(rpc, records, from = 1, size = 100) {
  for (let offset = 0; offset < records.length; offset += size)
    await rpc({
      action: 'apply',
      changes: records.slice(offset, offset + size).map(({ entity, data, id }, index) => ({ entity, id: id ?? data.id, revision: from + offset + index, data })),
    });
}

/** Rows read and written since the last meter, in all and by phase. */
export async function meter(rpc) {
  const { phases, statements } = await rpc({ action: 'meter' });
  const total = { read: 0, written: 0 };
  for (const phase of Object.values(phases)) {
    total.read += phase.read;
    total.written += phase.written;
  }
  return { ...total, phases, statements };
}

/** A temporary store with the fixture published, ranks filled and the meter at zero. */
export async function meteredStore(options = {}, generation = 'meter') {
  const directory = await mkdtemp(resolve(tmpdir(), 'lastfind-meter-'));
  const runtime = await storeRuntime(directory);
  const scope = { ownerId: 'owner', projectId: 'fixture', generation };
  const rpc = await connect(runtime, scope);
  await rpc({ action: 'initialize' });
  const now = Date.now();
  const data = fixture(now, options);
  await publish(rpc, [...data.prompts.map((row) => ({ entity: 'prompts', data: row })), ...data.runs.map((row) => ({ entity: 'runs', data: row }))]);
  for (let cursor = '', done = false; !done; ) ({ cursor, done } = await rpc({ action: 'positions-fill', cursor }));
  let revision = 0;
  globalThis.metered = {
    project,
    registry: () => ({ project_id: 'fixture', workspace_id: 'owner', generation, initialized: 1, source_revision: ++revision, applied_revision: revision }),
    rpc,
    kept: [],
  };
  return {
    rpc,
    now,
    ...data,
    scope,
    async close() {
      await runtime.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** The reads of the default screens (Overview, Prompts, Sources, Brands, Responses) for one period, as the Worker sends them. */
export const SCREEN_VIEWS = (q) => ({
  summary: (ctx) => reports.summaryReport(ctx),
  analysis: (ctx) => reports.analysisReport(ctx, q),
  history: (ctx) => reports.historyReport(ctx, q),
  prompts: (ctx) => reports.promptReport(ctx, true),
  competitors: (ctx) => reports.competitorsReport(ctx, q),
  fanout: (ctx) => reports.fanoutReport(ctx, q),
  'sources-domain': (ctx) => reports.sourcesReport(ctx, new URLSearchParams(`${q}&kind=cited&group=domain&order=presence`)),
});

export async function screenReads(query) {
  const q = new URLSearchParams(`project=fixture&${query}`);
  const out = {};
  for (const [name, view] of Object.entries(SCREEN_VIEWS(q))) out[name] = await view(await reports.reportContext('owner', q));
  return out;
}

const waitAlarms = (ms) => new Promise((done) => setTimeout(done, ms));

// The cost model's per-unit numbers for one project size.
async function measure(label, options) {
  const started = Date.now();
  const store = await meteredStore(options, label);
  const { rpc } = store;
  const answers = store.runs.length;
  const out = { label, answers, perDay: Math.round(answers / (options.days ?? 90)) };
  // The brand analysis: a whole pass over the window (at most 10,000 answers), as after a target or detector change.
  await meter(rpc);
  let status = await rpc({ action: 'analysis-start', revision: 'targets-1', configVersion: 1, targets: targets.map(({ name, domain }) => ({ name, domain })), cutoff: new Date(store.now - 90 * DAY).toISOString(), maxRuns: 10000, mentionModel: false });
  for (let page = 0; status.status !== 'complete' && page < 5000; page++) status = await rpc({ action: 'analysis-process' });
  for (let cursor = '', done = false; !done; ) ({ cursor, done } = await rpc({ action: 'positions-fill', cursor }));
  const pass = await meter(rpc);
  out.analysisPass = { answers: status.processed, read: pass.read, written: pass.written, perAnswer: Math.round(pass.read / Math.max(1, status.processed)) };
  // Publishing (and ranking) is measured on a fresh day's worth of answers on top of the 90 days; the analysis then extends
  // to them on its own (the alarm).
  const day = store.prompts.map((prompt, index) => runRow(9_000_000 + index, prompt, new Date(store.now - 600_000).toISOString()));
  await publish(rpc, day.map((data) => ({ entity: 'runs', data })), 10_000_000);
  const applied = await meter(rpc);
  for (let cursor = '', done = false; !done; ) ({ cursor, done } = await rpc({ action: 'positions-fill', cursor }));
  const ranked = await meter(rpc);
  out.publishPerAnswer = { read: applied.read / day.length, written: applied.written / day.length };
  out.rankPerAnswer = { read: ranked.read / day.length, written: ranked.written / day.length };
  for (let wait = 0; wait < 600; wait++) {
    status = await rpc({ action: 'analysis-status' });
    if (status.status === 'complete' && !status.previous) break;
    await waitAlarms(200);
  }
  for (let cursor = '', done = false; !done; ) ({ cursor, done } = await rpc({ action: 'positions-fill', cursor }));
  const extended = await meter(rpc);
  out.analysisExtendPerAnswer = { read: Math.round(extended.read / day.length), written: Math.round(extended.written / day.length), status: status.status };
  if (process.env.METER_DETAIL) {
    const top = (m, key) => Object.entries(m.statements).sort((a, b) => b[1][key] - a[1][key]).slice(0, 8).map(([k, v]) => `${v.read}r ${v.written}w ${v.n}x ${k.slice(0, 140)}`);
    out.detail = { extendRead: top(extended, 'read'), extendWritten: top(extended, 'written'), publishRead: top(applied, 'read'), passRead: top(pass, 'read'), passWritten: top(pass, 'written') };
  }
  // Screens: the first (computed) read and a repeated (kept) read, for the default 28 days, 7 and 90.
  for (const days of [28, 7, 90]) {
    await meter(rpc);
    await screenReads(`days=${days}`);
    const cold = await meter(rpc);
    await screenReads(`days=${days}`);
    const warm = await meter(rpc);
    out[`screens${days}`] = { cold: cold.read, kept: warm.read, written: cold.written };
    if (days === 28) out.coldStatements = Object.entries(cold.statements).sort((a, b) => b[1].read - a[1].read).slice(0, 12);
  }
  // The remembered first-screen reads recomputed after one change (one new answer).
  const templates = (await rpc({ action: 'query', statements: [{ sql: 'SELECT COUNT(*) n FROM report_templates', params: [] }] }))[0].results[0].n;
  await publish(rpc, [{ entity: 'runs', data: runRow(9_500_000, store.prompts[0], new Date().toISOString()) }], 20_000_000);
  await meter(rpc);
  let warmed = 0;
  for (let pending = true; pending; ) {
    const result = await rpc({ action: 'warm' });
    warmed += result.warmed;
    pending = result.pending;
  }
  const rewarm = await meter(rpc);
  out.rewarm = { templates, warmed, read: rewarm.read, written: rewarm.written };
  out.seconds = Math.round((Date.now() - started) / 1000);
  await store.close();
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = process.argv.slice(2).length ? process.argv.slice(2) : ['small'];
  const SIZES = {
    tiny: { units: 4, engines: ENGINES.slice(0, 3), days: 30 },
    small: { units: 30, engines: ENGINES.slice(0, 4), days: 90 },
    netflix: { units: 65, engines: ENGINES.slice(0, 6), days: 90 },
  };
  for (const size of sizes) console.log(JSON.stringify(await measure(size, SIZES[size]), null, 1));
}
