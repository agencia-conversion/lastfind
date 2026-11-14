import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runPositionsFor } from './run-positions-fixture.mjs';
import { runPositionEntries } from '../lib/run-positions.ts';

// One set of answers read by every screen's report: the same figure must come out the same everywhere.
const core = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
  stdin: {
    contents:
      "export {reportContext,summaryReport,analysisReport,historyReport,competitorsReport,promptReport,sourcesReport} from './lib/server/reports.ts';export {weightedMentionPosition} from './lib/prompt-summary-metrics.ts';export {setFixture} from 'fixture';",
    resolveDir: core,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'isolated-consistency-fixture',
      setup(builder) {
        const stubs: Record<string, string> = {
          fixture: 'let fixture;export const setFixture=value=>fixture=value;export const current=()=>fixture;',
          './workspace': "import {current} from 'fixture';export const ownedProject=async()=>current().project;",
          './project-store-read': "import {current} from 'fixture';export const projectReadDatabase=async()=>current().database;",
          './project-reads':
            "import {current} from 'fixture';export const ownedProjectStatement=(id,owner)=>({token:'project',id,owner});export const projectStoreStatement=()=>({token:'registry'});export const foundProject=(row)=>{if(!row)throw Error('Access denied');return row;};",
          './env':
            "import {current} from 'fixture';export const now=()=>new Date().toISOString();export const db=()=>{const d=current().database;return new Proxy(d,{get:(t,p)=>{if(p==='batch')return (statements)=>Promise.all(statements.map((s)=>s.token?{results:s.token==='project'?[current().project]:[]}:s.all()));const v=Reflect.get(t,p);return typeof v==='function'?v.bind(t):v;}});};",
          './http': 'export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}',
        };
        builder.onResolve({ filter: /.*/ }, (args) => (Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined));
        builder.onResolve({ filter: /^@\// }, (args) => ({ path: `${core}/${args.path.slice(2)}.ts` }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path]!, loader: 'js' }));
      },
    },
  ],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`);

const ENGINES = ['chat_gpt', 'gemini', 'google_ai_mode'];
const close = (actual: number | null | undefined, expected: number | null | undefined, label: string) => {
  if (expected == null) return assert.equal(actual ?? null, null, label);
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
};

await test('every screen reports the same figures from the same answers, for every filter', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE store_meta(key TEXT,value TEXT);CREATE TABLE prompts(id TEXT,unit_id TEXT,project_id TEXT,text TEXT,engine TEXT,tag TEXT,tags_json TEXT);
    CREATE TABLE runs(id TEXT,prompt_id TEXT,project_id TEXT,workspace_id TEXT,prompt_text TEXT,engine TEXT,targets_json TEXT,mentions_json TEXT,sources_json TEXT,consulted_sources_json TEXT,analysis_revision TEXT,analysis_targets_json TEXT,analysis_mentions_json TEXT,analysis_brands_json TEXT,status TEXT,response_available INTEGER,answer TEXT,created_at TEXT,completed_at TEXT,cost REAL,error TEXT,search_queries_json TEXT DEFAULT '[]',model TEXT);`);
  const database = {
    ensurePositions: runPositionsFor(sql),
    prepare(query: string) {
      let params: unknown[] = [];
      return {
        sql: query,
        bind(...values: unknown[]) { params = values; return this; },
        async all() { return { results: sql.prepare(query).all(...(params as never[])) }; },
        async first() { return sql.prepare(query).get(...(params as never[])) ?? null; },
      };
    },
    async batch(statements: Array<{ all: () => Promise<unknown> }>) { return Promise.all(statements.map((statement) => statement.all())); },
  };
  const project = {
    id: 'project', workspace_id: 'owner', name: 'Our Brand', domain: 'own.example',
    competitors_json: JSON.stringify([{ name: 'Rival', domain: 'rival.example' }, { name: 'Orbit', domain: 'orbit.example' }]),
  };
  api.setFixture({ project, database });
  const targets = JSON.stringify([{ name: 'Our Brand', domain: 'own.example' }, { name: 'Rival', domain: 'rival.example' }, { name: 'Orbit', domain: 'orbit.example' }]);
  for (const [unit, tag] of [['q1', 'T1'], ['q2', 'T2']])
    for (const engine of ENGINES)
      sql.prepare('INSERT INTO prompts VALUES(?,?,?,?,?,?,?)').run(`${unit}-${engine}`, unit, 'project', `Question ${unit}?`, engine, tag, JSON.stringify([tag.toLowerCase()]));
  const put = sql.prepare('INSERT INTO runs(id,prompt_id,project_id,workspace_id,prompt_text,engine,targets_json,mentions_json,sources_json,status,response_available,answer,created_at,cost) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)');
  let i = 0;
  // 28 days (two periods of 14), two questions, three models: mentions, order and citations vary with the answer.
  for (let day = 1; day <= 28; day++)
    for (const unit of ['q1', 'q2'])
      for (const engine of ENGINES) {
        i++;
        const own = i % 3 !== 0, rival = i % 2 === 0, orbit = i % 5 === 0;
        const order = [own && 'Our Brand', rival && 'Rival', orbit && 'Orbit'].filter(Boolean) as string[];
        if (i % 4 === 0) order.reverse();
        const sources = [{ url: 'https://other.example/a', domain: 'other.example' }];
        if (i % 4 === 0) sources.push({ url: 'https://own.example/p', domain: 'own.example' });
        if (i % 3 === 0) sources.push({ url: 'https://rival.example/p', domain: 'rival.example' });
        put.run(`run-${i}`, `${unit}-${engine}`, 'project', 'owner', `Question ${unit}?`, engine, targets,
          JSON.stringify({ 'Our Brand': own, Rival: rival, Orbit: orbit }), JSON.stringify(sources), 'complete', 1,
          order.length ? `${order.join(', then ')}.` : 'No brand here.', `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`);
      }
  // A brand monitored when some answers were collected and removed since; the active brand analysis re-read some answers.
  sql.prepare("UPDATE runs SET targets_json=?,mentions_json=json_set(mentions_json,'$.Gone',json('true')) WHERE created_at BETWEEN '2026-09-15' AND '2026-09-18'")
    .run(JSON.stringify([...JSON.parse(targets), { name: 'Gone', domain: 'gone.example' }]));
  sql.exec("INSERT INTO store_meta VALUES('analysis_revision','rev1')");
  sql.exec(`UPDATE runs SET analysis_revision='rev1',analysis_targets_json=targets_json,analysis_mentions_json=json_set(mentions_json,'$."Our Brand"',json('true')),answer='Our Brand, then '||answer WHERE CAST(substr(id,5) AS INTEGER)%7=0`);
  sql.exec(`UPDATE runs SET analysis_revision='old' WHERE CAST(substr(id,5) AS INTEGER)%11=0 AND analysis_revision IS NULL`);
  // A mention the analysis found without a place in the text (an alias, a paraphrase): it counts, but has no position.
  sql.exec(`UPDATE runs SET mentions_json=json_set(mentions_json,'$."Our Brand"',json('true')),answer='A paraphrase only.' WHERE CAST(substr(id,5) AS INTEGER)%13=0 AND analysis_revision IS NULL`);
  // Brands the active analysis discovered count in share of voice and position: only the counted ones, once per
  // group ("nova labs" was merged into "nova"); an answer an older analysis read keeps only its monitored brands. In half
  // of the active answers "Nova" opens the text, before every monitored brand.
  sql.exec(`UPDATE runs SET answer='Nova, '||answer,analysis_brands_json='{"nova":0,"nova labs":2,"rejeitada":0}' WHERE analysis_revision='rev1' AND CAST(substr(id,5) AS INTEGER)%2=0`);
  sql.exec(`UPDATE runs SET analysis_brands_json='{"nova":999,"rejeitada":3}' WHERE analysis_revision IS NOT NULL AND analysis_brands_json IS NULL`);
  sql.exec(`INSERT INTO store_meta VALUES('brand_counted','["nova","nova labs"]'),('brand_merged','{"nova labs":"nova"}')`);
  // Answers that never count: failed, without text, still pending.
  put.run('failed', 'q1-chat_gpt', 'project', 'owner', 'Question q1?', 'chat_gpt', targets, '{}', '[]', 'failed', 0, '', '2026-09-20T12:00:00.000Z');
  put.run('empty', 'q1-gemini', 'project', 'owner', 'Question q1?', 'gemini', targets, '{}', '[]', 'complete', 0, '', '2026-09-21T12:00:00.000Z');
  put.run('pending', 'q2-gemini', 'project', 'owner', 'Question q2?', 'gemini', targets, '{}', '[]', 'pending', 0, '', '2026-09-22T12:00:00.000Z');

  const base = { project: 'project', start: '2026-09-15', end: '2026-09-28' };
  const read = async (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...base, ...extra });
    const ctx = await api.reportContext('owner', q);
    return {
      q,
      summary: await api.summaryReport(ctx),
      analysis: await api.analysisReport(ctx, q),
      competitors: await api.competitorsReport(ctx, q),
      prompts: await api.promptReport(ctx, true),
      sources: await api.sourcesReport(ctx, new URLSearchParams({ ...base, ...extra, owner: 'own' })),
    };
  };
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  const check = async (extra: Record<string, string>, label: string) => {
    const { summary, analysis, competitors, prompts, sources } = await read(extra);
    const m = summary.metrics;
    assert.ok(m.responses > 0, label);
    // Overview cards = AI models screen = Prompts table = Brands table.
    assert.equal(sum(analysis.channels.map((row: { responses: number }) => row.responses)), m.responses, `${label} models responses`);
    assert.equal(sum(analysis.channels.map((row: { mentions: number }) => row.mentions)), m.mentions, `${label} models mentions`);
    const promptRows = Object.values(prompts) as { responses: number; mentions: number; totalMentions: number; position: number | null }[];
    assert.equal(sum(promptRows.map((row) => row.responses)), m.responses, `${label} prompts responses`);
    assert.equal(sum(promptRows.map((row) => row.mentions)), m.mentions, `${label} prompts mentions`);
    assert.equal(sum(promptRows.map((row) => row.totalMentions)), m.totalMentions, `${label} prompts brand mentions`);
    // The Prompts table's Summary row.
    close(api.weightedMentionPosition(promptRows) ?? 0, m.mentionPosition, `${label} prompts summary position`);
    const own = competitors.platforms.find((row: { name: string }) => row.name === 'Our Brand');
    close(own.visibility, m.visibility, `${label} brands visibility`);
    close(own.shareOfVoice, m.shareOfVoice, `${label} brands share of voice`);
    for (const row of summary.leaderboard) {
      const brand = competitors.platforms.find((item: { name: string }) => item.name === row.name);
      assert.equal(brand.mentions, row.count, `${label} ranking ${row.name}`);
      close(brand.visibility, row.visibility, `${label} ranking visibility ${row.name}`);
    }
    // The trend chart adds up to the period's cards.
    const daily = summary.daily as Record<string, number>[];
    close(sum(daily.map((day) => day.mentions)) / sum(daily.map((day) => day.responses)) * 100, m.visibility, `${label} trend visibility`);
    close(sum(daily.map((day) => day.voiceMentions)) / sum(daily.map((day) => day.totalMentions)) * 100, m.shareOfVoice, `${label} trend share of voice`);
    const samples = sum(daily.map((day) => day.positionSamples));
    close(samples ? sum(daily.map((day) => day.positionSum)) / samples : 0, m.mentionPosition, `${label} trend position`);
    assert.equal(samples, summary.availability.mentionPosition.current ?? 0, `${label} position samples`);
    // The card's channel rows are the same figures as reading one model alone.
    for (const channel of summary.channels ?? []) {
      const alone = (await read({ ...extra, engine: channel.engine })).summary.metrics;
      close(channel.visibility, alone.visibility, `${label} ${channel.engine} visibility`);
      close(channel.shareOfVoice, alone.shareOfVoice, `${label} ${channel.engine} share of voice`);
      close(channel.citationPresence, alone.citationPresence, `${label} ${channel.engine} citation presence`);
      close(channel.mentionPosition, alone.mentionPosition || null, `${label} ${channel.engine} position`);
      close(analysis.channels.find((row: { key: string }) => row.key === channel.engine).visibility, alone.visibility, `${label} ${channel.engine} models visibility`);
    }
    // Topic coverage: each topic's row is the same figure as reading that topic alone, and the topics add up to the cards.
    assert.equal(sum((summary.topics ?? []).map((row: { responses: number }) => row.responses)), m.responses, `${label} topics responses`);
    for (const row of summary.topics ?? []) {
      const alone = (await read({ ...extra, topic: row.topic })).summary.metrics;
      close(row.visibility, alone.visibility, `${label} ${row.topic} topic visibility`);
      close(row.shareOfVoice, alone.totalMentions ? alone.shareOfVoice : null, `${label} ${row.topic} topic share of voice`);
      // Its position and top rival are the Brands table of that topic alone (the monitored brands, by answers naming each).
      const brands = (await read({ ...extra, topic: row.topic })).competitors.platforms as { name: string; mentions: number; visibility: number }[];
      const rivals = brands.filter((item) => ['Rival', 'Orbit'].includes(item.name) && item.mentions > 0).sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
      assert.equal(row.rival?.name ?? null, rivals[0]?.name ?? null, `${label} ${row.topic} topic rival`);
      if (rivals[0]) close(row.rival!.visibility, rivals[0].visibility, `${label} ${row.topic} topic rival visibility`);
      assert.equal(row.position, alone.mentions ? 1 + rivals.filter((item) => item.mentions > alone.mentions).length : null, `${label} ${row.topic} topic position`);
    }
    // Citation presence on the card = the share of answers citing the brand's own domain on Sources.
    const ownSource = sources.rows.find((row: { key: string }) => row.key === 'own.example');
    close(ownSource ? ownSource.responses / m.responses * 100 : 0, m.citationPresence, `${label} sources own citations`);
    return summary;
  };

  const all = await check({}, 'all');
  const rows = sql.prepare(`SELECT analysis_revision rev,analysis_targets_json analysisTargets,targets_json targets,analysis_mentions_json analysis,mentions_json mentions,
    analysis_brands_json brands,answer FROM runs WHERE status='complete' AND response_available=1 AND created_at>='2026-09-15'`).all() as Record<string, string | null>[];
  let discoveries = 0, monitored = 0, rankSum = 0, ranked = 0, named = 0;
  // Share of voice and position count only the answers the active analysis read (run-rows voiceSql): the others' discoveries
  // are unknown, not none.
  for (const row of rows) {
    const active = row.rev === 'rev1';
    if (!active) continue;
    const mentions = row.analysis!;
    monitored += Object.values(JSON.parse(mentions)).filter((value) => value === true).length;
    const nova = active ? (JSON.parse(row.brands!) as Record<string, number>).nova : undefined;
    if (nova !== undefined) discoveries++;
    const own = (JSON.parse(runPositionEntries(row.answer, (active ? row.analysisTargets : row.targets)!, mentions)) as [string, number, number, number][]).find((entry) => entry[1] === 1);
    if (own) { const earlier = nova !== undefined && nova < own[3] ? 1 : 0; rankSum += own[2] + earlier; named += earlier; ranked++; }
  }
  assert.ok(discoveries > 0 && named > 0, 'the fixture has counted discoveries, some named before the brand');
  assert.equal(all.metrics.totalMentions, monitored + discoveries, 'share of voice divides by every identified brand, a merged one once');
  close(all.metrics.mentionPosition, rankSum / ranked, 'position ranks among every identified brand');
  for (const engine of ENGINES) await check({ engine }, engine);
  await check({ topic: 'T1' }, 'topic');
  await check({ tags: 't2' }, 'tag');
  // Topics combine (`topic` repeated): both topics are every answer; more than 20 is refused.
  const topics = (names: string[]) => { const q = new URLSearchParams(base); for (const name of names) q.append('topic', name); return q; };
  assert.deepEqual((await api.summaryReport(await api.reportContext('owner', topics(['T1', 'T2'])))).metrics, all.metrics, 'two topics are their union');
  await assert.rejects(api.reportContext('owner', topics(Array.from({ length: 21 }, (_, i) => `T${i}`))), /topic/);
  // The comparison is the previous period read on its own, and the change is the difference.
  const previous = (await read({ start: '2026-09-01', end: '2026-09-14' })).summary.metrics;
  for (const key of ['visibility', 'shareOfVoice', 'citationPresence', 'mentionPosition'] as const) {
    close(all.comparison.previous[key], previous[key], `previous ${key}`);
    close(all.comparison.delta[key], all.metrics[key] - previous[key], `delta ${key}`);
  }
  // Every list carries the comparison: each prompt and each brand's previous figures are their own reading of that period.
  const before = await read({ start: '2026-09-01', end: '2026-09-14' });
  const now = await read();
  for (const [id, row] of Object.entries(now.prompts) as [string, { previous: { responses: number; visibility: number; shareOfVoice: number | null; position?: number | null } }][]) {
    const alone = (before.prompts as Record<string, { responses: number; visibility: number; shareOfVoice: number | null; position: number | null }>)[id];
    assert.equal(row.previous.responses, alone.responses, `prompt ${id} previous responses`);
    close(row.previous.visibility, alone.visibility, `prompt ${id} previous visibility`);
    close(row.previous.shareOfVoice, alone.shareOfVoice, `prompt ${id} previous share of voice`);
    close(row.previous.position, alone.position, `prompt ${id} previous position`);
  }
  for (const row of now.competitors.platforms as { name: string; previous?: { visibility: number; shareOfVoice: number | null; mentions: number } }[]) {
    const alone = before.competitors.platforms.find((item: { name: string }) => item.name === row.name);
    close(row.previous?.visibility, alone?.visibility, `brand ${row.name} previous visibility`);
    close(row.previous?.shareOfVoice, alone?.shareOfVoice, `brand ${row.name} previous share of voice`);
  }
  // A chosen comparison period (with days between it and the period) is that period read on its own; the days between count in neither.
  const chosen = await read({ compareStart: '2026-09-03', compareEnd: '2026-09-09' });
  const week = await read({ start: '2026-09-03', end: '2026-09-09' });
  assert.equal(chosen.summary.metrics.responses, all.metrics.responses, 'chosen comparison leaves the period alone');
  assert.equal(chosen.summary.comparison.previous.responses, week.summary.metrics.responses, 'chosen comparison responses');
  assert.equal(chosen.summary.comparison.previousStart, '2026-09-03T00:00:00.000Z');
  assert.equal(chosen.summary.comparison.previousEnd, '2026-09-10T00:00:00.000Z');
  for (const key of ['visibility', 'shareOfVoice', 'citationPresence', 'mentionPosition'] as const)
    close(chosen.summary.comparison.previous[key], week.summary.metrics[key], `chosen comparison ${key}`);
  for (const [id, row] of Object.entries(chosen.prompts) as [string, { previous: { responses: number; visibility: number } }][]) {
    const alone = (week.prompts as Record<string, { responses: number; visibility: number }>)[id];
    assert.equal(row.previous.responses, alone?.responses ?? 0, `chosen prompt ${id}`);
  }
  for (const row of chosen.competitors.platforms as { name: string; previous?: { visibility: number } }[])
    close(row.previous?.visibility, week.competitors.platforms.find((item: { name: string }) => item.name === row.name)?.visibility, `chosen brand ${row.name}`);
  // A comparison must start before the period, last 1 to 90 days and come with both dates.
  for (const bad of [{ compareStart: '2026-09-15', compareEnd: '2026-09-20' }, { compareStart: '2026-09-03' }, { compareStart: '2026-01-01', compareEnd: '2026-09-09' }] as Record<string, string>[])
    await assert.rejects(api.reportContext('owner', new URLSearchParams({ ...base, ...bad })), /comparison/, JSON.stringify(bad));
  // Answers that failed, have no text or are pending never count.
  assert.equal(all.metrics.responses, 14 * 2 * 3);
  // A discovered brand (drill-down from Brands): its answers are the ones its stored discoveries name, a merged name with it.
  const novaAnswers = (sql.prepare(`SELECT COUNT(*) n FROM runs WHERE analysis_revision='rev1' AND status='complete' AND response_available=1
    AND created_at>='2026-09-15' AND (analysis_brands_json LIKE '%"nova"%' OR analysis_brands_json LIKE '%"nova labs"%')`).get() as { n: number }).n;
  assert.ok(novaAnswers > 0);
  assert.equal((await read({ brand: 'Nova' })).summary.metrics.mentions, novaAnswers, 'a discovered brand by its stored discoveries');
  assert.equal((await read({ brand: 'Nova', mention: 'mentioned' })).summary.metrics.responses, novaAnswers, 'its answers as a Responses filter');

  // Topic weights: T1 weighs 3, T2 1. Each rate is the topics' rates weighted by them; counts stay real; the
  // card, the chart, the models, the Prompts Summary row and the Brands table still agree.
  // The brand is named in fewer T2 answers, so the topics' rates differ and the weights show.
  sql.exec(`UPDATE runs SET mentions_json=json_set(mentions_json,'$."Our Brand"',json('false')),analysis_mentions_json=CASE WHEN analysis_mentions_json IS NULL THEN NULL ELSE json_set(analysis_mentions_json,'$."Our Brand"',json('false')) END
    WHERE prompt_id LIKE 'q2-%' AND CAST(substr(id,5) AS INTEGER)%2=0`);
  const alone = { T1: (await read({ topic: 'T1' })).summary, T2: (await read({ topic: 'T2' })).summary };
  (project as Record<string, unknown>).topic_weights_json = JSON.stringify({ T1: 3, T2: 1 });
  const weighted = await read();
  const w = weighted.summary.metrics;
  for (const key of ['visibility', 'citationPresence'] as const)
    close(w[key], (3 * alone.T1.metrics[key] + alone.T2.metrics[key]) / 4, `weighted ${key}`);
  assert.equal(w.responses, alone.T1.metrics.responses + alone.T2.metrics.responses, 'counts stay real');
  assert.equal(w.mentions, alone.T1.metrics.mentions + alone.T2.metrics.mentions);
  const pooled = (w.mentions / w.responses) * 100;
  assert.ok(Math.abs(w.visibility - pooled) > 1, `the weights change the rate (${w.visibility} vs ${pooled})`);
  for (const channel of weighted.summary.channels ?? []) {
    const byTopic = await Promise.all(['T1', 'T2'].map(async (topic) => (await read({ topic, engine: channel.engine })).summary.metrics.visibility));
    close(channel.visibility, (3 * byTopic[0]! + byTopic[1]!) / 4, `weighted ${channel.engine} visibility`);
    close(weighted.analysis.channels.find((row: { key: string }) => row.key === channel.engine).visibility, channel.visibility, `weighted models ${channel.engine}`);
  }
  const own = weighted.competitors.platforms.find((row: { name: string }) => row.name === 'Our Brand');
  close(own.visibility, w.visibility, 'weighted brands visibility');
  close(own.shareOfVoice, w.shareOfVoice, 'weighted brands share of voice');
  const days = weighted.summary.daily as Record<string, number>[];
  close(sum(days.map((day) => day.mentions)) / sum(days.map((day) => day.responses)) * 100, w.visibility, 'weighted trend visibility');
  close(sum(days.map((day) => day.voiceMentions)) / sum(days.map((day) => day.totalMentions)) * 100, w.shareOfVoice, 'weighted trend share of voice');
  close(sum(days.map((day) => day.positionSum)) / sum(days.map((day) => day.positionSamples)), w.mentionPosition, 'weighted trend position');
  // The Prompts Summary row, as the client weighs it (live-app): each question with its topic's factor.
  const promptRows = Object.values(weighted.prompts) as { responses: number; mentions: number; totalMentions: number; weight?: number; position: number | null; positionSamples?: number }[];
  close(sum(promptRows.map((row) => (row.weight ?? 1) * row.mentions)) / sum(promptRows.map((row) => (row.weight ?? 1) * row.responses)) * 100, w.visibility, 'weighted prompts visibility');
  close(api.weightedMentionPosition(promptRows.map((row) => ({ ...row, positionSamples: (row.weight ?? 1) * (row.positionSamples ?? 0) }))) ?? 0, w.mentionPosition, 'weighted prompts position');
  // Sources: each question × model weighs its topic's share, so a source's presence is the topics' presences weighted.
  const sourcesAlone = { T1: (await read({ topic: 'T1' })).sources, T2: (await read({ topic: 'T2' })).sources };
  const presenceOf = (page: { rows: { key: string; presence?: { presence: number } }[] }, key: string) => page.rows.find((row) => row.key === key)?.presence?.presence ?? 0;
  assert.ok(weighted.sources.rows.length > 0);
  for (const row of weighted.sources.rows as { key: string; presence?: { presence: number } }[])
    close(row.presence?.presence, (3 * presenceOf(sourcesAlone.T1, row.key) + presenceOf(sourcesAlone.T2, row.key)) / 4, `weighted presence ${row.key}`);
  // A topic without a weight takes the smallest one set: T2 missing is the same as T2 at 3.
  (project as Record<string, unknown>).topic_weights_json = JSON.stringify({ T1: 3 });
  close((await read()).summary.metrics.visibility, (alone.T1.metrics.visibility + alone.T2.metrics.visibility) / 2, 'missing weight is the smallest');
  delete (project as Record<string, unknown>).topic_weights_json;
});

// A project at the competitor limit, read with the same production reports: the comparison and the Sources sort.
await test('a project with the brand and ten competitors compares periods, and Sources rejects inherited sort names', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE store_meta(key TEXT,value TEXT);CREATE TABLE prompts(id TEXT,unit_id TEXT,project_id TEXT,text TEXT,engine TEXT,tag TEXT,tags_json TEXT);
    CREATE TABLE runs(id TEXT,prompt_id TEXT,project_id TEXT,workspace_id TEXT,prompt_text TEXT,engine TEXT,targets_json TEXT,mentions_json TEXT,sources_json TEXT,consulted_sources_json TEXT,analysis_revision TEXT,analysis_targets_json TEXT,analysis_mentions_json TEXT,analysis_brands_json TEXT,status TEXT,response_available INTEGER,answer TEXT,created_at TEXT,completed_at TEXT,cost REAL,error TEXT,search_queries_json TEXT DEFAULT '[]',model TEXT);`);
  const database = {
    ensurePositions: runPositionsFor(sql),
    prepare(query: string) {
      let params: unknown[] = [];
      return {
        sql: query,
        bind(...values: unknown[]) { params = values; return this; },
        async all() { return { results: sql.prepare(query).all(...(params as never[])) }; },
        async first() { return sql.prepare(query).get(...(params as never[])) ?? null; },
      };
    },
    async batch(statements: Array<{ all: () => Promise<unknown> }>) { return Promise.all(statements.map((statement) => statement.all())); },
  };
  const read = async (count: number, extra: Record<string, string> = {}) => {
    sql.exec('DELETE FROM runs;DELETE FROM prompts;');
    const competitors = Array.from({ length: count }, (_, index) => ({ name: `Rival ${index}`, domain: `rival${index}.example` }));
    api.setFixture({ project: { id: 'project', workspace_id: 'owner', name: 'Our Brand', domain: 'own.example', competitors_json: JSON.stringify(competitors) }, database });
    const targets = JSON.stringify([{ name: 'Our Brand', domain: 'own.example' }, ...competitors]);
    sql.prepare('INSERT INTO prompts VALUES(?,?,?,?,?,?,?)').run('q1', 'q1', 'project', 'Question?', 'chat_gpt', 'T', '[]');
    const put = sql.prepare("INSERT INTO runs(id,prompt_id,project_id,workspace_id,prompt_text,engine,targets_json,mentions_json,sources_json,status,response_available,answer,created_at,cost) VALUES(?,'q1','project','owner','Question?','chat_gpt',?,?,?,'complete',1,?,?,0)");
    for (let day = 1; day <= 28; day++)
      put.run(`run-${day}`, targets, JSON.stringify({ 'Our Brand': day % 2 === 0, 'Rival 0': true }), JSON.stringify([{ url: 'https://other.example/a', domain: 'other.example' }]),
        day % 2 === 0 ? 'Our Brand, then Rival 0.' : 'Rival 0.', `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`);
    const q = new URLSearchParams({ project: 'project', start: '2026-09-15', end: '2026-09-28', ...extra });
    return { ctx: await api.reportContext('owner', q), q };
  };
  for (const count of [1, 5, 6, 10]) {
    const { ctx } = await read(count);
    const summary = await api.summaryReport(ctx);
    assert.equal(summary.comparison.comparable, true, `${count + 1} targets`);
    assert.equal(summary.comparison.hasPreviousData, true, `${count + 1} targets`);
    assert.equal(summary.availability.visibility.previous, 14, `${count + 1} targets`);
  }
  // `sort` is read from an object: names every object inherits are not columns (400, not a broken query).
  for (const sort of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nope']) {
    const { ctx, q } = await read(1, { sort });
    await assert.rejects(api.sourcesReport(ctx, q), (error: { status?: number; message?: string }) => error.status === 400 && /Invalid source sort/.test(error.message ?? ''), sort);
  }
  const { ctx, q } = await read(1, { sort: 'presence', dir: 'asc' });
  assert.equal((await api.sourcesReport(ctx, q)).rows[0]?.key, 'other.example');
});

// A join of each answer's discoveries with the counted-brands table took 30 s per position read in the store's
// SQLite (Conversion, a thousand competitors) and the reads failed; the IN list SQLite builds once per statement takes 80 ms.
await test('counted discoveries are an IN list built once, never a join with the counted brands', async () => {
  const { countedDiscoveriesSql } = await import('../lib/server/run-rows.ts');
  const sql = countedDiscoveriesSql('found.value<1');
  assert.match(sql, /found\.key IN \(SELECT value FROM json_each\(/);
  assert.doesNotMatch(sql, /\bJOIN\b/i);
});
