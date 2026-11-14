// A brand decision's pass reads again only the answers the change can alter (ProjectStore extendPage); the rest is carried
// from the active analysis. Here it must end exactly where a full pass over the same window ends: overlays, discoveries per
// answer and their offsets, questions, ranks and suggestions. Private, ephemeral Miniflare namespaces; no network.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { storeIdentity } from '../lib/project-store-contract.ts';
import { POSITIONS_BASIS_SUFFIX } from '../lib/run-positions.ts';

const directory = await mkdtemp(join(tmpdir(), 'lastfind-analysis-extend-'));
const bundled = await build({
  stdin: {
    contents: "export { ProjectStore } from './worker/project-store.ts'; export default { fetch() { return new Response(null, {status:404}); } };",
    resolveDir: import.meta.dirname + '/..',
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
    name: 'lastfind-analysis-extend-test',
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-22',
    durableObjects: { PROJECT_STORES: { className: 'ProjectStore', useSQLite: true } },
    resourcePersistencePath: directory,
    unsafeDevRegistryPath: join(directory, 'registry'),
    telemetry: { enabled: false },
    logRequests: false,
  }),
);

// A deterministic window: lists of streaming services, prose mentions, nested names ("Viki" in "Rakuten Viki"), a joined
// pair ("Kanopy & Hoopla"), a sub-brand ("Crunchyroll Premium"), domains and the own brand as a common word ("max").
function answers(count, from = 0) {
  let seed = 11 + from;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (list) => list[Math.floor(next() * list.length)];
  const brands = ['Netflix', 'Prime Video', 'Disney+', 'Hulu', 'Peacock', 'Crunchyroll', 'Crunchyroll Premium', 'Mubi', 'Kanopy', 'Hoopla', 'Tubi', 'Pluto TV', 'Rakuten Viki', 'Viki', 'Globoplay', 'Paramount+', 'Shudder', 'BritBox', 'Curiosity Stream', 'Apple TV+', 'Looke', 'Max'];
  const words = 'catálogo amplo de filmes séries originais documentários com qualidade 4K e planos baratos para a família'.split(' ');
  const sentence = (n) => Array.from({ length: n }, () => pick(words)).join(' ');
  return Array.from({ length: count }, (_, k) => {
    const index = from + k;
    const chosen = new Set();
    const size = 3 + Math.floor(next() * 6);
    while (chosen.size < size) chosen.add(pick(brands));
    const lines = [`${sentence(10)}.`, ''];
    let item = 1;
    for (const brand of chosen) lines.push(`${item++}. **${brand}**: ${sentence(8)}. Veja ${brand.toLowerCase().replace(/[^a-z0-9]/g, '')}.com.`);
    if (index % 7 === 0) lines.push('', `Para anime e dramas, **Kanopy & Hoopla** e a Rakuten Viki aparecem juntos; a Crunchyroll também.`);
    if (index % 5 === 0) lines.push('', `No máximo, aproveite o max de conteúdo, ${sentence(5)}.`);
    if (index % 9 === 0) lines.push('', `A Mubi e a Max dividem espaço com a Peacock.`);
    // A part of a longer name, alone: covered by the monitored "Pluto TV" once it is one of its spellings.
    if (index % 6 === 0) lines.push('', '- **Pluto**: canais grátis ao vivo.');
    // Brand words written in lowercase (the window counts them: an ordinary word heads no family).
    if (index % 4 === 0) lines.push('', `Um tubi de ensaio, um mubi qualquer e a hoopla da semana.`);
    // Its sub-brand: a family of "Pluto" until "Pluto" is the monitored brand's.
    if (index % 10 === 0) lines.push('', '- **Pluto Kids**: desenhos para crianças.');
    const created = new Date(Date.parse('2026-10-01T00:00:00.000Z') + index * 3_600_000).toISOString();
    return {
      id: `run-${String(index).padStart(4, '0')}`,
      prompt_text: pick(['Melhor streaming?', 'Streaming com anime', 'Alternativas à Netflix']),
      created_at: created,
      completed_at: created,
      answer: lines.join('\n'),
      sources_json: JSON.stringify([...chosen].slice(0, 2).map((brand) => ({ url: `https://${brand.toLowerCase().replace(/[^a-z0-9]/g, '')}.com/`, domain: `${brand.toLowerCase().replace(/[^a-z0-9]/g, '')}.com` }))),
    };
  });
}

const namespace = await runtime.getDurableObjectNamespace('PROJECT_STORES');
let checks = 0;
function store(name) {
  const scope = { ownerId: 'owner-a', projectId: `project-${name}`, generation: 'first' };
  const stub = namespace.get(namespace.idFromName(storeIdentity(scope)));
  const rpc = async (message) => {
    const response = await stub.fetch('https://project-store/rpc', { method: 'POST', body: JSON.stringify({ scope, ...message }) });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    checks++;
    return data;
  };
  const query = async (sql, params = []) => (await rpc({ action: 'query', statements: [{ sql, params }] }))[0].results;
  return { scope, rpc, query };
}
const cutoff = '2026-09-01T00:00:00.000Z';
const own = { name: 'Max', domain: 'max.com' };
const monitored = [own, { name: 'Netflix', domain: 'netflix.com' }, { name: 'Prime Video', domain: 'primevideo.com' }, { name: 'Disney+', domain: 'disneyplus.com' }];
const withCrunchyroll = [...monitored, { name: 'Crunchyroll', domain: 'crunchyroll.com', aliases: ['Crunchyroll Premium'] }];
const withPluto = withCrunchyroll.map((target) => (target.name === 'Disney+' ? { ...target, aliases: ['Pluto TV'] } : target));

async function publish(target, runs, bump = 0) {
  await target.rpc({ action: 'initialize' });
  for (let at = 0; at < runs.length; at += 100)
    await target.rpc({
      action: 'apply',
      changes: runs.slice(at, at + 100).map((run, index) => ({
        entity: 'runs',
        id: run.id,
        revision: Date.parse(run.created_at) / 1000 + index + bump,
        data: { ...run, owner_id: target.scope.ownerId, project_id: target.scope.projectId, prompt_id: 'prompt-a', engine: 'chat_gpt', status: 'complete', targets_json: '[]', mentions_json: '{}', search_queries_json: '[]', response_available: 1, cost: 0.001, consulted_sources_json: null },
      })),
    });
}
/** Runs a pass to its end the way the alarm does, then the ranks and the discoveries' offsets. */
async function settle(target, start) {
  let status = start ? await target.rpc({ action: 'analysis-start', cutoff, maxRuns: 10000, mentionModel: true, ...start }) : await target.rpc({ action: 'analysis-status' });
  for (let page = 0; (status.status !== 'complete' || status.revision !== (start?.revision ?? status.revision)) && page < 2000; page++)
    status = await target.rpc({ action: 'analysis-process' });
  assert.equal(status.status, 'complete');
  for (let at = 0; at < 200; at++) {
    const [offsets] = await target.query("SELECT COUNT(*) n FROM store_meta WHERE key='brand_offsets_cursor'");
    if (!offsets.n) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (let cursor = '', at = 0; at < 100; at++) {
    const fill = await target.rpc({ action: 'positions-fill', cursor });
    if (fill.done) break;
    cursor = fill.cursor;
  }
  return status;
}
async function snapshot(target) {
  const active = "(SELECT value FROM store_meta WHERE key='analysis_revision')";
  return {
    revision: (await target.query(`SELECT ${active} revision`))[0].revision,
    rows: await target.query(
      `SELECT id,analysis_revision,analysis_targets_json,analysis_mentions_json,analysis_brands_json,analysis_pending_revision FROM runs ORDER BY id`,
    ),
    suggestions: await target.query(`SELECT name,identity,domain,domain_state,score,answer_count,evidence_json,detection_json FROM competitor_suggestions ORDER BY name`),
    asks: await target.query('SELECT run_id,brand,slot,request_json,counted,decided_config FROM mention_asks ORDER BY run_id,brand,slot'),
    positions: await target.query(
      `SELECT p.run_id,p.basis,p.entries_json FROM run_positions p JOIN runs r ON r.id=p.run_id
       WHERE p.basis=r.analysis_revision||':'||COALESCE(r.analysis_mentions_json,'')||? ORDER BY p.run_id`,
      [POSITIONS_BASIS_SUFFIX],
    ),
    status: (({ suggestions, revision, total, processed }) => ({ suggestions, revision, total, processed }))(await target.rpc({ action: 'analysis-status', exclude: [] })),
    // The window's lowercase counts the pass ended with (an extension adds and takes off answers instead of reading them all).
    lowercase: JSON.parse((await target.query("SELECT value FROM analysis_lowercase WHERE key='counts'"))[0]?.value ?? 'null'),
  };
}
const phase = async (target) => (await target.query('SELECT phase FROM competitor_analysis_jobs WHERE id=1'))[0]?.phase;
/** The pass that just ended carried answers instead of reading them (it did not fall back to a full pass). */
const lastPass = async (target) => JSON.parse((await target.query("SELECT value FROM store_meta WHERE key='analysis_last_pass'"))[0]?.value ?? '{}');
const carried = async (target) => (await lastPass(target)).carried ?? 0;
function same(left, right, label) {
  for (const key of Object.keys(left)) assert.deepEqual(left[key], right[key], `${label}: ${key} differs from a full pass`);
}

try {
  const window = answers(160);
  const later = answers(30, 160);
  const extended = store('extended');
  await publish(extended, window);
  await settle(extended, { revision: 'targets-1', configVersion: 1, targets: monitored });
  const base = await snapshot(extended);
  assert.ok(base.suggestions.some((row) => row.name === 'Crunchyroll'), 'Crunchyroll is a discovery before it is monitored');
  assert.ok(base.positions.length > 100, 'the base has ranks to carry');

  // Monitor a discovery: an extending pass that reads only the answers naming Crunchyroll (or its alias).
  await extended.rpc({ action: 'analysis-start', revision: 'targets-2', configVersion: 2, targets: withCrunchyroll, cutoff, maxRuns: 10000, mentionModel: true });
  assert.equal(await phase(extended), 'extend');
  let status = await extended.rpc({ action: 'analysis-process' });
  for (let page = 0; status.status !== 'complete' && page < 50; page++) status = await extended.rpc({ action: 'analysis-process' });
  const monitorRead = window.filter((run) => /crunchyroll/i.test(run.answer)).length;
  await settle(extended);
  const full = store('full');
  await publish(full, window);
  await settle(full, { revision: 'targets-2', configVersion: 2, targets: withCrunchyroll });
  assert.ok(await carried(extended), 'Monitor extends');
  same(await snapshot(full), await snapshot(extended), 'Monitor');
  assert.ok(!(await snapshot(extended)).suggestions.some((row) => row.name === 'Crunchyroll'), 'a monitored brand is no discovery');
  assert.ok(
    (await extended.query("SELECT COUNT(*) n FROM runs WHERE json_extract(analysis_mentions_json,'$.Crunchyroll')=1"))[0].n > 0,
    'the monitored brand is counted in its answers',
  );
  assert.ok(monitorRead < window.length / 2, 'the fixture leaves most answers without the brand');

  // Merge a discovery into a monitored brand (an alias added), with new answers collected meanwhile: "Pluto" alone is now
  // the monitored brand's, also in the answers the pass carries.
  // The newest answer of the first window is collected again without any brand: the names it was the newest excerpt of
  // show an older answer's, which an extension carried without its excerpt (read again from that answer).
  const rewritten = { ...window.at(-1), answer: 'Sem recomendações hoje.' };
  await publish(extended, [rewritten], 1000);
  await publish(full, [rewritten], 1000);
  await settle(extended, null);
  assert.ok(await carried(extended), 'a collected answer extends');
  await settle(full, { revision: 'targets-2', configVersion: 2, targets: withCrunchyroll, restart: true });
  same(await snapshot(full), await snapshot(extended), 'An answer collected again');
  await publish(extended, later);
  await publish(full, later);
  const steps = [
    ['Merge with new answers', withPluto],
    // Undo the merge (a spelling removed): "Pluto" alone comes back, so the answers that write it are read again.
    ['Undo the merge', withCrunchyroll],
    // Undo the Monitor (a target removed): the names it covered come back as discoveries.
    ['Undo the Monitor', monitored],
  ];
  for (const [index, [label, targets]] of steps.entries()) {
    const revision = `targets-${index + 3}`;
    // The merge also reads a smaller window: the oldest answers leave it (the counts take them off).
    const maxRuns = index === 0 ? 170 : 10000;
    await extended.rpc({ action: 'analysis-start', revision, configVersion: index + 3, targets, cutoff, maxRuns, mentionModel: true });
    assert.equal(await phase(extended), 'extend', label);
    await settle(extended, null);
    await settle(full, { revision, configVersion: index + 3, targets, restart: true, maxRuns });
    assert.ok(await carried(extended), `${label} extends`);
    same(await snapshot(full), await snapshot(extended), label);
  }
  assert.ok((await snapshot(extended)).suggestions.some((row) => row.name === 'Crunchyroll'), 'an undone Monitor brings the discovery back');

  // What the decision cost: the answers it read again (the others were carried).
  const fresh = store('measure');
  await publish(fresh, window);
  await settle(fresh, { revision: 'targets-1', configVersion: 1, targets: monitored });
  await settle(fresh, { revision: 'targets-2', configVersion: 2, targets: withCrunchyroll });
  const { read: again, carried: kept } = await lastPass(fresh);
  const read = { again, carried: kept };
  // Only those: an answer with a question about a common-word mention (the own brand "Max") is carried with its question.
  const named = window.filter((run) => /crunchyroll/i.test(run.answer)).length;
  assert.ok(base.asks.some((row) => row.slot === 'active' && !/crunchyroll/i.test(window.find((run) => run.id === row.run_id).answer)), 'the fixture has questions in answers that do not name the brand');
  assert.ok(read.again > 0 && read.again <= named && read.again < window.length * 0.6, `an extension reads only the answers that name the brand (${read.again} of ${named})`);
  assert.equal(read.again + read.carried, window.length);

  // An alarm does a bounded share of the pass and lets reads through (a Durable Object's clock stands still while it
  // computes, so only a count of pages can end its turn): four pages of at most 200 answers.
  const sliced = store('sliced');
  const large = answers(2000);
  await publish(sliced, large);
  await settle(sliced, { revision: 'targets-1', configVersion: 1, targets: monitored });
  await sliced.rpc({ action: 'analysis-start', revision: 'targets-2', configVersion: 2, targets: withCrunchyroll, cutoff, maxRuns: 10000, mentionModel: true });
  // The first turn may only read the window's common words (a turn of its own).
  let turn = await sliced.rpc({ action: 'analysis-process' });
  if (!turn.processed) turn = await sliced.rpc({ action: 'analysis-process' });
  // (The alarm set by the start may have taken a turn of its own before this one.)
  assert.ok(turn.status === 'running' && turn.processed > 0 && turn.processed <= 1600, `one alarm's share: ${turn.processed} of ${large.length}`);

  // An explicit restart (Admin's reprocess) reads every answer.
  await fresh.rpc({ action: 'analysis-start', revision: 'targets-2', configVersion: 2, targets: withCrunchyroll, cutoff, maxRuns: 10000, mentionModel: true, restart: true });
  assert.equal(await phase(fresh), 'seeds');
  console.log(`Analysis extension integration passed: ${checks} native RPC checks; Monitor, merge with new answers and undo match a full pass.`);
} finally {
  await runtime.dispose();
  await rm(directory, { recursive: true, force: true });
}
