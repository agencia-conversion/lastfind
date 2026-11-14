import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../../', import.meta.url));
function d1(sqlite) {
  const prepare = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => prepare(sql, values),
    all: async () => {
      const results = sqlite
        .prepare(sql)
        .all(...params)
        .map((row) => ({ ...row }));
      assert.ok(
        Buffer.byteLength(JSON.stringify(results)) <= 4 * 1024 * 1024,
        'Analytical RPC exceeded its transport limit',
      );
      return { results };
    },
    first: async () => sqlite.prepare(sql).get(...params) || null,
    run: async () => ({
      meta: { changes: sqlite.prepare(sql).run(...params).changes },
    }),
  });
  return {
    prepare,
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params }) =>
          /^\s*(SELECT|WITH)\b/i.test(sql)
            ? { results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }
            : { meta: { changes: sqlite.prepare(sql).run(...params).changes } },
        );
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
const fixtureImports = {
  './env': `export const db=()=>globalThis.researchFixture.db;export const now=()=>new Date().toISOString();export const setting=(key)=>globalThis.researchFixture.settings[key]||'';`,
  './http': `export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}`,
  './workspace': `export async function ownedProject(id,owner){const p=await globalThis.researchFixture.db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(id,owner).first();if(!p)throw new Error('Project not found.');return p;}`,
  './project-store-read':
    'export const projectReadDatabase=async()=>globalThis.researchFixture.db;export const storedCopy=async(scope,inputs,options)=>globalThis.researchFixture?.copy?.(scope,inputs,options)??({value:null,storedAt:0,last:null,keep(){},refresh(){}});',
  './competitor-analysis': `export const competitorAnalysisStatus=async()=>({status:globalThis.researchFixture.analysisStatus??'complete',needsEnsure:globalThis.researchFixture.needsEnsure??false,previous:globalThis.researchFixture.analysisPrevious,suggestions:globalThis.researchFixture.discoverySuggestions??[{name:'Orbit',domain:null}]});`,
  './capabilities': 'export const researchAllProjects=true;export const platformLimitDefaults={monthUsd:2000,dayUsd:64};',
  './brand-decision-events':
    'export const loadDecisionEvents=async()=>[];export const decisionEventsStatement=()=>globalThis.researchFixture.db.prepare("SELECT 1 x WHERE 0");export const decisionEventsFrom=()=>[];export const withoutDecided=async(_,items)=>items.filter((item)=>!(globalThis.researchFixture.rejected||[]).includes(item.name));',
  './reports': `export const parseReportFilter=(q)=>({engine:q.get('engine')||'all',cutoff:q.get('start')||'2020-01-01T00:00:00.000Z',end:'2099-01-01T00:00:00.000Z'});`,
};
async function compile(allProjects) {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: [root + 'packages/core/lib/server/brand-research.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'research-fixtures',
        setup(plugin) {
          plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'workers-shim' }));
          plugin.onLoad({ filter: /.*/, namespace: 'workers-shim' }, () => ({ contents: 'export const waitUntil=()=>{};export const env={};', loader: 'js' }));
          plugin.onResolve(
            {
              filter:
                /^\.\/(env|http|workspace|project-store-read|competitor-analysis|reports|capabilities|brand-decision-events)$/,
            },
            (args) => ({ path: args.path, namespace: 'fixture' }),
          );
          plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents:
              args.path === './capabilities'
                ? `export const researchAllProjects=${allProjects};export const platformLimitDefaults={monthUsd:2000,dayUsd:64};`
                : fixtureImports[args.path],
            loader: 'js',
          }));
          plugin.onResolve({ filter: /^@\// }, (args) => ({
            path:
              root +
              'packages/core/' +
              args.path.slice(2) +
              (args.path.endsWith('.mjs') ? '' : '.ts'),
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
  );
}
// Independent edition (wildcard honored) and Cloud (wildcard ignored) builds.
const worker = await compile(true);
const cloudWorker = await compile(false);
function database(edition = 'selfhost', before = '9999') {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(root + `apps/${edition}/drizzle`)
    .filter((name) => name.endsWith('.sql') && name < before)
    .sort())
    sqlite.exec(readFileSync(root + `apps/${edition}/drizzle/` + name, 'utf8'));
  // Before 0111 (Cloud) or 0101 (selfhost) the workspace was the owner: its column is owner_id.
  const ws = sqlite.prepare("SELECT 1 FROM pragma_table_info('projects') WHERE name='workspace_id'").get() ? 'workspace_id' : 'owner_id';
  // This isolated analytical stand-in retains payload fields removed from control D1.
  sqlite.exec(
    'ALTER TABLE runs ADD COLUMN answer TEXT; ALTER TABLE runs ADD COLUMN response_available INTEGER DEFAULT 1; ALTER TABLE runs ADD COLUMN analysis_revision TEXT; ALTER TABLE runs ADD COLUMN analysis_brands_json TEXT; ALTER TABLE runs ADD COLUMN mentions_json TEXT; ALTER TABLE runs ADD COLUMN analysis_targets_json TEXT; ALTER TABLE runs ADD COLUMN analysis_mentions_json TEXT; CREATE TABLE store_meta(key TEXT PRIMARY KEY,value TEXT);',
  );
  const stamp = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO accounts(id,email,name,created_at) VALUES('owner','test@example.invalid','Test',?)",
    )
    .run(stamp);
  sqlite
    .prepare(
      `INSERT INTO projects(id,${ws},name,domain,category,daily_enabled,created_at) VALUES('project','owner','Acme','acme.example','software',0,?)`,
    )
    .run(stamp);
  sqlite
    .prepare(
      "INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES('prompt','question','project','Which software works best?','chat_gpt',?,?)",
    )
    .run(stamp, stamp);
  // The brand analysis read every answer: its discoveries are the capitalized names it writes, by brand key.
  sqlite.exec("INSERT INTO store_meta VALUES('analysis_revision','analysis')");
  const discoveries = (answer) => JSON.stringify(Object.fromEntries([...answer.matchAll(/[A-Z][\w+]*(?: [A-Z][\w+]*)*/g)].map((match) => [match[0].toLowerCase(), match.index])));
  const run = (
    id,
    answer,
    date = stamp,
    prompt = 'prompt',
    engine = 'chat_gpt',
  ) =>
    sqlite
      .prepare(`INSERT INTO runs(id,${ws},project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,cost,created_at,budget_credits,answer,response_available,analysis_revision,analysis_brands_json)
    VALUES(?,'owner','project',?,?,'Which software works best?',?,'[{"name":"Acme","domain":"acme.example"}]',2840,'en','complete','fixture',0,?,0,?,1,'analysis',?)`)
      .run(id, prompt, id, engine, date, answer, discoveries(answer));
  sqlite
    .prepare(
      `INSERT INTO brand_research_configurations(project_id,${ws},provider,enabled,revision,updated_at) VALUES('project','owner','jev',1,1,?)`,
    )
    .run(stamp);
  run('run', 'Acme is excellent. Orbit is an affordable alternative.');
  return { sqlite, run };
}
// A typed decision model's answer with its distribution (all on the choice): decided in one call (steadySentiment).
const oneHot = (question, choice) => Object.fromEntries(Object.keys(question.criteria).map((label) => [label, label === choice ? 1 : 0]));
/** What the model answers in these fixtures: the name is the brand, and the criteria of `met` hold in window 0 (none: a plain mention, 50). */
const criteriaChoice = (id, question, met = []) => {
  const labels = Object.keys(question.criteria);
  if (labels.includes('brand')) return 'brand';
  if (!labels.includes('no')) return 'insufficient';
  return met.some((criterion) => id.endsWith(`_${criterion}`)) ? 'yes:0' : 'no';
};
/** Recommended and presented as the leader: 85, a promoter. */
const PROMOTER = ['recommended', 'leader'];
test('authenticated scope, read-only GET, concurrent dedupe, claim and no resend on uncertain outcome', async () => {
  const { sqlite, run } = database(),
    originalFetch = globalThis.fetch;
  const settings = {
    OPENROUTER_API_KEY: 'isolated-not-a-key',
    BRAND_RESEARCH_ENABLED: 'true',
    BRAND_RESEARCH_PROJECTS: 'project',
  };
  globalThis.researchFixture = { db: d1(sqlite), settings };
  let outbound = 0;
  globalThis.fetch = async () => {
    outbound++;
    throw new Error('Isolated transport timeout.');
  };
  try {
    let report = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.equal(Object.hasOwn(report, 'observations'), false);
    assert.equal(outbound, 0);
    assert.equal(report.brands[0].prompts, 1);
    assert.equal(report.unassessed, 1);
    assert.equal(
      report.suggestions.length,
      0,
      'Unprepared local suggestions are not presented as prepared research.',
    );
    await assert.rejects(
      worker.enqueueBrandResearch(
        'project',
        'wrong-owner',
        new URLSearchParams(),
        'jev',
      ),
      /not found/,
    );
    settings.BRAND_RESEARCH_PROJECTS = 'other';
    await assert.rejects(
      worker.enqueueBrandResearch(
        'project',
        'owner',
        new URLSearchParams(),
        'jev',
      ),
      /not authorized/,
    );
    settings.BRAND_RESEARCH_PROJECTS = 'project';
    const first = await worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      'jev',
    );
    assert.equal(first.enqueued, 1);
    const prepared = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.ok(
      prepared.suggestions.some(
        (candidate) =>
          candidate.name === 'Orbit' &&
          candidate.answerCount === 1 &&
          candidate.verifiedPrompts === 0,
      ),
    );

    const again = await worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      'jev',
    );
    assert.equal(again.enqueued, 0);
    run(
      'run-repeat',
      'Acme is excellent. Orbit is an affordable alternative.',
      new Date(Date.now() + 1000).toISOString(),
    );
    report = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.equal(report.selectedChannels, 1);
    assert.equal(report.unassessed, 0);
    assert.equal(await worker.processBrandResearchJobs(), 1);
    assert.equal(outbound, 1);
    assert.equal(
      sqlite
        .prepare('SELECT status,reserved_usd FROM brand_research_jobs')
        .get().status,
      'unknown',
    );
    assert.equal(
      sqlite.prepare('SELECT reserved_usd FROM brand_research_jobs').get()
        .reserved_usd,
      0.02,
    );
    assert.equal(await worker.processBrandResearchJobs(), 0);
    assert.equal(outbound, 1);
    report = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.equal(report.brands[0].assessed, 0);
    assert.equal(report.brands[0].failed, 1);
    // The Overview card's channel rows: the same aggregate per channel.
    assert.deepEqual(report.brands[0].channels.map((channel) => [channel.engine, channel.assessed]), [['chat_gpt', 0]]);
    // A different saved typed model is an explicit context, with no silent fallback.
    await worker.saveBrandResearchConfiguration('project', 'owner', {
      provider: 'decisions',
      enabled: true,
      expectedRevision: 1,
    });
    assert.equal(
      (
        await worker.enqueueBrandResearch(
          'project',
          'owner',
          new URLSearchParams(),
          'decisions',
        )
      ).enqueued,
      1,
    );
    settings.BRAND_RESEARCH_PROJECTS = 'other';
    assert.equal(await worker.processBrandResearchJobs(), 0);
    assert.equal(outbound, 1);
    // A personal installation authorizes every project with `*`, but only while enabled.
    settings.BRAND_RESEARCH_PROJECTS = '*';
    assert.equal(worker.researchAllowed('project'), true);
    assert.equal(worker.researchAllowed('created-later'), true);
    settings.BRAND_RESEARCH_ENABLED = 'false';
    assert.equal(worker.researchAllowed('project'), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
test('jobs obey shared budget and fresh collections do not inherit an earlier assessment', async () => {
  const { sqlite, run } = database(),
    originalFetch = globalThis.fetch;
  globalThis.researchFixture = {
    db: d1(sqlite),
    settings: {
      OPENROUTER_API_KEY: 'isolated-not-a-key',
      BRAND_RESEARCH_ENABLED: 'true',
      BRAND_RESEARCH_PROJECTS: 'project',
    },
  };
  let calls = 0;
  let lastRequest;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    lastRequest = request;
    assert.equal(request.model, 'typesafe/jev-1.14');
    assert.ok(request.questions.b0_recommended.criteria['yes:0']);
    // Re-entering the scheduler during the paid request cannot claim the job again.
    assert.equal(await worker.processBrandResearchJobs(), 0);
    const answers = Object.fromEntries(
      Object.entries(request.questions).map(([id, q]) => {
        const labels = Object.keys(q.criteria),
          choice = id.endsWith('_role')
            ? 'competitor'
            : criteriaChoice(id, q, PROMOTER);
        return [
          id,
          {
            type: 'choice',
            choice,
            probabilities: Object.fromEntries(
              labels.map((label) => [label, label === choice ? 1 : 0]),
            ),
          },
        ];
      }),
    );
    return Response.json({
      model: request.model,
      answers,
      usage: { cost: 0.0001 },
    });
  };
  try {
    sqlite.prepare("UPDATE runs SET cost=64 WHERE id='run'").run();
    await assert.rejects(
      worker.enqueueBrandResearch(
        'project',
        'owner',
        new URLSearchParams(),
        'jev',
      ),
      /budget/,
    );
    assert.equal(calls, 0);
    sqlite.prepare("UPDATE runs SET cost=0 WHERE id='run'").run();
    await worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      'jev',
    );
    await worker.processBrandResearchJobs();
    // Whether Orbit competes is the roles classifier's, per question (8/11/2026): the sentiment reading does not ask it again.
    assert.ok(!Object.keys(lastRequest.questions).some((id) => id.endsWith('_role')));
    sqlite.prepare("INSERT INTO brand_question_roles(project_id,question_key,brand_key,model,role,question,cost_usd,decided_at) VALUES('project','q1','orbit','liquid/d1-ultra@v4','competitor','Which software works best?',0,?)").run(new Date().toISOString());
    let report = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.equal(report.brands[0].assessed, 1);
    assert.equal(report.suggestions[0].verifiedPrompts, 1);
    assert.equal(calls, 1);
    run(
      'fresh',
      'Acme has very limited reporting.',
      new Date(Date.now() + 1000).toISOString(),
    );
    report = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.equal(report.brands[0].assessed, 0);
    assert.equal(report.brands[0].pending, 1);
    assert.equal(report.unassessed, 1);
    // Historical provider result remains intact.
    assert.equal(
      sqlite
        .prepare(
          "SELECT count(*) n FROM brand_research_jobs WHERE status='completed'",
        )
        .get().n,
      1,
    );
    run(
      'absent',
      'Nova is an excellent choice.',
      new Date(Date.now() + 2000).toISOString(),
    );
    await worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      'jev',
    );
    await worker.processBrandResearchJobs();
    report = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.equal(report.brands[0].absent, 1);
    // Counted as absent, never listed: an answer without the brand has no evidence to show.
    assert.equal(report.details.some((detail) => detail.runId === 'absent'), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
test('large scopes page answer payloads within the transport limit and disclose truncation', async () => {
  const { sqlite, run } = database();
  globalThis.researchFixture = { db: d1(sqlite), settings: {} };
  try {
    const stamp = new Date().toISOString(),
      text = 'Acme is excellent. ' + 'x'.repeat(30000);
    for (let i = 0; i < 160; i++) {
      const id = `large-${i}`;
      sqlite
        .prepare(
          "INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES(?,?,'project',?,'chat_gpt',?,?)",
        )
        .run(id, id, `Which tool ${i}?`, stamp, stamp);
      run(id, text, stamp, id);
    }
    const report = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.equal(report.truncated, true);
    assert.ok(report.selectedChannels > 120 && report.selectedChannels < 160);
    assert.equal(report.brands[0].prompts, report.selectedChannels);
  } finally {
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
test('manual preview processing refuses production and other owners and scopes every mutation to its project and provider', async () => {
  const { sqlite } = database(),
    originalFetch = globalThis.fetch;
  const settings = {
    OPENROUTER_API_KEY: 'isolated-not-a-key',
    BRAND_RESEARCH_ENABLED: 'true',
    BRAND_RESEARCH_PROJECTS: 'project,foreign',
  };
  globalThis.researchFixture = { db: d1(sqlite), settings };
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'typesafe/jev-1.14');
    return Response.json({
      model: request.model,
      usage: { cost: 0.0001 },
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => [
          id,
          {
            type: 'choice',
            choice: id.endsWith('_role')
              ? 'competitor'
              : criteriaChoice(id, question, PROMOTER),
          },
        ]).map(([id, answer]) => [id, { ...answer, probabilities: oneHot(request.questions[id], answer.choice) }]),
      ),
    });
  };
  try {
    await worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      'jev',
    );
    sqlite.exec(
      "INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at) SELECT 'other-provider',workspace_id,project_id,'other-provider',context_key,answer_sha256,'decisions','openai/gpt-6-luna-decisions','pending',reserved_usd,input_json,requested_at FROM brand_research_jobs LIMIT 1",
    );
    sqlite.exec(
      "INSERT INTO accounts(id,email,name,created_at) VALUES('other','other@example.invalid','Other','2026-10-15T00:00:00Z'); INSERT INTO projects(id,workspace_id,name,domain,archived,created_at) VALUES('foreign','other','Foreign','foreign.example',1,'2026-10-15T00:00:00Z');",
    );
    for (const [id, status] of [
      ['foreign-stale', 'submitting'],
      ['foreign-pending', 'pending'],
    ])
      sqlite
        .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at,started_at)
      SELECT ?,'other','foreign',?,context_key,answer_sha256,provider,model,?,reserved_usd,input_json,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z' FROM brand_research_jobs WHERE provider='jev' LIMIT 1`)
        .run(id, id, status);
    const foreign = sqlite
      .prepare(
        "SELECT * FROM brand_research_jobs WHERE project_id='foreign' ORDER BY id",
      )
      .all();
    await assert.rejects(
      worker.processPreviewBrandResearch('project', 'wrong-owner', 'jev'),
      /not found/,
    );
    await assert.rejects(
      worker.processPreviewBrandResearch('project', 'owner', 'jev'),
      /previews only/,
    );
    assert.equal(calls, 0);
    settings.PREVIEW_MODE = 'true';
    const result = await worker.processPreviewBrandResearch(
      'project',
      'owner',
      'jev',
    );
    assert.deepEqual(result, { processed: 1, pending: 0, failed: 0 });
    assert.equal(calls, 1);
    assert.deepEqual(
      sqlite
        .prepare(
          "SELECT * FROM brand_research_jobs WHERE project_id='foreign' ORDER BY id",
        )
        .all(),
      foreign,
    );
    assert.equal(
      sqlite
        .prepare(
          "SELECT status FROM brand_research_jobs WHERE project_id='project' AND provider='decisions'",
        )
        .get().status,
      'pending',
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
test('manual preview stops its batch after an uncertain result and never resends that job', async () => {
  const { sqlite, run } = database(),
    originalFetch = globalThis.fetch;
  globalThis.researchFixture = {
    db: d1(sqlite),
    settings: {
      PREVIEW_MODE: 'true',
      OPENROUTER_API_KEY: 'isolated-not-a-key',
      BRAND_RESEARCH_ENABLED: 'true',
      BRAND_RESEARCH_PROJECTS: 'project',
    },
  };
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('Isolated timeout');
  };
  try {
    await worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      'jev',
    );
    run(
      'new',
      'Acme is another excellent choice.',
      new Date(Date.now() + 1000).toISOString(),
    );
    await worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      'jev',
    );
    const result = await worker.processPreviewBrandResearch(
      'project',
      'owner',
      'jev',
    );
    assert.deepEqual(result, { processed: 1, pending: 1, failed: 1 });
    assert.equal(calls, 1);
    const unknown = sqlite
      .prepare(
        "SELECT id,reserved_usd FROM brand_research_jobs WHERE status='unknown'",
      )
      .get();
    assert.equal(unknown.reserved_usd, 0.02);
    await worker.processPreviewBrandResearch('project', 'owner', 'jev');
    assert.equal(calls, 2);
    assert.equal(
      sqlite
        .prepare('SELECT status FROM brand_research_jobs WHERE id=?')
        .get(unknown.id).status,
      'unknown',
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
// Every name of the Brands list is read where an answer names it (no loose shortlist): a prose-only competitor is
// verified across questions and a publisher on the list is never approved.
test('every listed brand an answer names is read: a prose competitor is verified across distinct questions and a publisher never approved', async () => {
  const { sqlite, run } = database(),
    originalFetch = globalThis.fetch;
  globalThis.researchFixture = {
    db: d1(sqlite),
    discoverySuggestions: [{ name: 'Orbit', domain: null }, { name: 'ReviewDaily', domain: null }],
    settings: {
      PREVIEW_MODE: 'true',
      OPENROUTER_API_KEY: 'isolated-not-a-key',
      BRAND_RESEARCH_ENABLED: 'true',
      BRAND_RESEARCH_PROJECTS: 'project',
    },
  };
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    return Response.json({
      model: request.model,
      usage: { cost: 0.0001 },
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => {
          const option = request.state.identities.find(
            (item) => id === item.id || id === item.id + '_role',
          );
          const choice = id.endsWith('_role')
            ? option.name === 'Orbit'
              ? 'competitor'
              : 'other'
            : criteriaChoice(id, question);
          return [id, { type: 'choice', choice, probabilities: oneHot(question, choice) }];
        }),
      ),
    });
  };
  try {
    run(
      'prose',
      'Acme is excellent for small teams. Acme is affordable and easy to use. Orbit is another affordable alternative, with useful collaboration features. ReviewDaily publishes reviews of Acme and Orbit.',
      new Date(Date.now() + 1000).toISOString(),
    );
    const stamp = new Date().toISOString();
    sqlite
      .prepare(
        "INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES('calendar','calendar','project','Which tools have a calendar?','chat_gpt',?,?)",
      )
      .run(stamp, stamp);
    run(
      'calendar-run',
      'Acme offers task lists and a calendar. Nova also has a calendar. Orbit is another project-management option with an integrated calendar.',
      stamp,
      'calendar',
    );
    const queued = await worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      'jev',
    );
    assert.equal(queued.enqueued, 2);
    const pending = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.equal(
      pending.suggestions.find((candidate) => candidate.name === 'Orbit')
        .answerCount,
      2,
    );
    assert.equal(
      pending.suggestions.find((candidate) => candidate.name === 'Orbit')
        .verifiedPrompts,
      0,
    );
    await worker.processPreviewBrandResearch('project', 'owner', 'jev');
    // The roles classifier settled Orbit a competitor in both questions and ReviewDaily a cited source in one: the counts are its.
    for (const [question, brand, role] of [['q-prose', 'orbit', 'competitor'], ['q-calendar', 'orbit', 'competitor'], ['q-prose', 'reviewdaily', 'mention']])
      sqlite.prepare("INSERT INTO brand_question_roles(project_id,question_key,brand_key,model,role,question,cost_usd,decided_at) VALUES('project',?,?,'liquid/d1-ultra@v4',?,'q',0,?)").run(question, brand, role, new Date().toISOString());
    const report = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    const orbit = report.suggestions.find(
      (candidate) => candidate.name === 'Orbit',
    );
    assert.equal(orbit.answerCount, 2);
    assert.equal(orbit.verifiedPrompts, 2);
    // Its evidence comes only to the read that shows it (the competitor discovery in Settings asks `suggestions=1`).
    assert.equal(orbit.evidence.length, 0);
    const shown = await worker.brandResearchReport('project', 'owner', new URLSearchParams('suggestions=1'));
    assert.ok(shown.suggestions.find((candidate) => candidate.name === 'Orbit').evidence.length > 0);
    const publisher = report.suggestions.find(
      (candidate) => candidate.name === 'ReviewDaily',
    );
    assert.ok(publisher);
    assert.equal(publisher.verifiedPrompts, 0);
    assert.ok(publisher.rejectedPrompts > 0);
    // Drill down: the answers of a sentiment band are the ones whose own reading of the brand is in it.
    const acme = report.details.filter((detail) => detail.brand === 'Acme' && detail.score != null);
    assert.equal(acme.length, 2);
    assert.deepEqual(
      [...(await worker.sentimentBandRuns('project', 'owner', new URLSearchParams(), null, 'neutral'))].sort(),
      acme.filter((detail) => detail.score >= 40 && detail.score < 60).map((detail) => detail.runId).sort(),
    );
    assert.deepEqual(await worker.sentimentBandRuns('project', 'owner', new URLSearchParams(), 'Acme', 'positive'), []);
    assert.deepEqual(await worker.sentimentBandRuns('project', 'owner', new URLSearchParams(), 'Nobody', 'neutral'), []);
    assert.throws(() => worker.sentimentBandRuns('project', 'owner', new URLSearchParams(), null, 'great'), /Invalid sentiment/);
    assert.equal(
      (
        await worker.enqueueBrandResearch(
          'project',
          'owner',
          new URLSearchParams(),
          'jev',
        )
      ).enqueued,
      0,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});

test('automatic evaluations are read from the row: only while enabled, with the row\'s ceiling, and the app\'s save never changes them', async () => {
  const { sqlite } = database();
  globalThis.researchFixture = { db: d1(sqlite), settings: {} };
  try {
    sqlite.exec('DELETE FROM brand_research_configurations');
    sqlite.exec("INSERT INTO brand_research_configurations(project_id,workspace_id,provider,sentiment_provider,enabled,automatic,monthly_ceiling_usd,revision,updated_at) VALUES('project','owner','jev','liquid',1,1,25,1,'2026-10-19')");
    const read = () => worker.brandResearchConfiguration('project', 'owner');
    assert.deepEqual(
      { automatic: (await read()).automatic, ceiling: (await read()).monthlyCeilingUsd },
      { automatic: true, ceiling: 25 },
    );
    await worker.saveBrandResearchConfiguration('project', 'owner', { provider: 'jev', enabled: true, expectedRevision: 1 });
    assert.deepEqual({ ...sqlite.prepare('SELECT automatic,monthly_ceiling_usd FROM brand_research_configurations').get() }, { automatic: 1, monthly_ceiling_usd: 25 });
    sqlite.exec('UPDATE brand_research_configurations SET enabled=0, monthly_ceiling_usd=NULL');
    const off = await read();
    assert.equal(off.automatic, false, 'switched off wins over automatic');
    assert.equal(off.monthlyCeilingUsd, 10, 'no value means the US$ 10 default');
  } finally {
    delete globalThis.researchFixture;
    sqlite.close();
  }
});

test('project settings persist with optimistic revisions; saving never evaluates and stale providers cannot spend', async () => {
  const { sqlite } = database(),
    originalFetch = globalThis.fetch;
  globalThis.researchFixture = {
    db: d1(sqlite),
    settings: {
      OPENROUTER_API_KEY: 'isolated-not-a-key',
      BRAND_RESEARCH_ENABLED: 'true',
      BRAND_RESEARCH_PROJECTS: 'project',
      PREVIEW_MODE: 'true',
    },
  };
  let outbound = 0;
  globalThis.fetch = async () => {
    outbound++;
    throw Error('No calls authorized by this test.');
  };
  try {
    sqlite.exec('DELETE FROM brand_research_configurations');
    assert.deepEqual(
      await worker.brandResearchConfiguration('project', 'owner'),
      {
        provider: 'jev',
        sentimentProvider: 'liquid',
        enabled: false,
        automatic: false,
        monthlyCeilingUsd: 10,
        revision: 0,
        updatedAt: null,
      },
    );
    await assert.rejects(
      worker.enqueueBrandResearch(
        'project',
        'owner',
        new URLSearchParams(),
        'jev',
      ),
      /Enable brand research/,
    );
    await assert.rejects(
      worker.saveBrandResearchConfiguration('project', 'wrong-owner', {
        provider: 'jev',
        enabled: true,
        expectedRevision: 0,
      }),
      /not found/,
    );
    await assert.rejects(
      worker.saveBrandResearchConfiguration('project', 'owner', {
        provider: 'arbitrary',
        enabled: true,
        expectedRevision: 0,
      }),
      /Choose a valid evaluator/,
    );
    await assert.rejects(
      worker.saveBrandResearchConfiguration('project', 'owner', {
        provider: 'jev',
        enabled: 'true',
        expectedRevision: 0,
      }),
      /Invalid brand research/,
    );
    await worker.saveBrandResearchConfiguration('project', 'owner', {
      provider: 'decisions',
      enabled: true,
      expectedRevision: 0,
    });
    const saved = await worker.brandResearchConfiguration('project', 'owner');
    assert.equal(saved.provider, 'jev');
    assert.equal(saved.sentimentProvider, 'decisions');
    assert.equal(saved.enabled, true);
    assert.equal(saved.revision, 1);
    const report = await worker.brandResearchReport(
      'project',
      'owner',
      new URLSearchParams(),
    );
    assert.equal(report.provider, 'decisions');
    assert.equal(report.configuration.revision, 1);
    await assert.rejects(
      worker.saveBrandResearchConfiguration('project', 'owner', {
        provider: 'jev',
        enabled: false,
        expectedRevision: 0,
      }),
      /settings changed/,
    );
    await assert.rejects(
      worker.enqueueBrandResearch(
        'project',
        'owner',
        new URLSearchParams(),
        'jev',
      ),
      /settings changed/,
    );
    await assert.rejects(
      worker.processPreviewBrandResearch('project', 'owner', 'jev'),
      /settings changed/,
    );
    assert.equal(outbound, 0);
    assert.equal(
      sqlite.prepare('SELECT COUNT(*) n FROM brand_research_jobs').get().n,
      0,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});

test('disabling or switching cancels only pending work; explicit reenabling safely requeues only never-submitted cancellations', async () => {
  const { sqlite } = database();
  globalThis.researchFixture = {
    db: d1(sqlite),
    settings: {
      OPENROUTER_API_KEY: 'isolated-not-a-key',
      BRAND_RESEARCH_ENABLED: 'true',
      BRAND_RESEARCH_PROJECTS: 'project',
    },
  };
  const save = (provider, enabled, revision) =>
    worker.saveBrandResearchConfiguration('project', 'owner', {
      provider,
      enabled,
      expectedRevision: revision,
    });
  const enqueue = (provider) =>
    worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      provider,
    );
  try {
    assert.equal((await enqueue('jev')).enqueued, 1);
    const original = sqlite
      .prepare('SELECT id FROM brand_research_jobs')
      .get().id;
    // In-flight/uncertain/settled jobs belong to old independent inputs and must retain their holds.
    for (const status of ['submitting', 'unknown', 'unsettled', 'completed'])
      sqlite
        .prepare(
          `INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at,started_at,cost_usd) SELECT ?,workspace_id,project_id,?,context_key,answer_sha256,provider,model,?,0.02,input_json,requested_at,requested_at,0 FROM brand_research_jobs WHERE id=?`,
        )
        .run(status, status, status, original);
    await save('jev', false, 1);
    assert.equal(
      sqlite
        .prepare('SELECT status FROM brand_research_jobs WHERE id=?')
        .get(original).status,
      'cancelled',
    );
    assert.equal(await worker.processBrandResearchJobs(), 0);
    await assert.rejects(enqueue('jev'), /Enable brand research/);
    await save('jev', true, 2);
    assert.equal(
      sqlite
        .prepare('SELECT status FROM brand_research_jobs WHERE id=?')
        .get(original).status,
      'cancelled',
    );
    assert.equal(
      (
        await worker.brandResearchReport(
          'project',
          'owner',
          new URLSearchParams(),
        )
      ).unassessed,
      1,
    );
    assert.equal((await enqueue('jev')).enqueued, 1);
    assert.equal(
      sqlite
        .prepare('SELECT status FROM brand_research_jobs WHERE id=?')
        .get(original).status,
      'pending',
    );
    await save('decisions', true, 3);
    assert.equal((await enqueue('decisions')).enqueued, 1);
    await save('jev', true, 4);
    assert.equal((await enqueue('jev')).enqueued, 1);
    for (const status of ['submitting', 'unknown', 'unsettled', 'completed'])
      assert.deepEqual(
        {
          ...sqlite
            .prepare(
              'SELECT status,reserved_usd FROM brand_research_jobs WHERE id=?',
            )
            .get(status),
        },
        { status, reserved_usd: 0.02 },
      );
    // A cancelled entry with any submission history is not reusable even if recorded cost is zero.
    sqlite
      .prepare(
        "UPDATE brand_research_jobs SET status='cancelled',started_at=requested_at WHERE id=?",
      )
      .run(original);
    assert.equal((await enqueue('jev')).enqueued, 0);
    assert.equal(
      (
        await worker.brandResearchReport(
          'project',
          'owner',
          new URLSearchParams(),
        )
      ).unassessed,
      0,
    );
  } finally {
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
// The index and its drill down read the brand's mention as Responses filters it (the effective
// mention, not the text), and band each question by the mean of its models, so a band's answers are the ones the card counts.
let sentimentFixtures = 1000;
const sentimentFixture = (met) => {
  const { sqlite, run } = database();
  globalThis.researchFixture = {
    db: d1(sqlite),
    discoverySuggestions: [],
    settings: { PREVIEW_MODE: 'true', OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const criteria = met(JSON.stringify(request));
    return Response.json({
      model: request.model,
      usage: { cost: 0.0001 },
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => {
          const choice = id.endsWith('_role') ? 'other' : criteriaChoice(id, question, criteria);
          return [id, { type: 'choice', choice, probabilities: oneHot(question, choice) }];
        }),
      ),
    });
  };
  const close = () => {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  };
  const evaluate = async () => {
    await worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
    await worker.processPreviewBrandResearch('project', 'owner', 'jev');
    return worker.brandResearchReport('project', 'owner', new URLSearchParams());
  };
  // A period of its own: the band drill keeps its answers a minute per isolate, and the other tests read the same project.
  const days = String(++sentimentFixtures);
  const band = (name) => worker.sentimentBandRuns('project', 'owner', new URLSearchParams({ days }), null, name).then((ids) => [...ids].sort());
  return { sqlite, run, close, evaluate, band };
};
test('a name that only matches the text is no mention: the index counts it absent and its drill down leaves it out', async () => {
  const { sqlite, run, close, evaluate, band } = sentimentFixture(() => ['recommended', 'leader']);
  try {
    const stamp = new Date().toISOString();
    sqlite.prepare("INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES('cro','cro','project','What is conversion rate optimization?','chat_gpt',?,?)").run(stamp, stamp);
    run('cro-run', 'Acme rate optimization is the practice of improving the share of visitors who convert.', stamp, 'cro');
    // The brand analysis settled that this answer does not name the company (structure-v10): its effective mention is 0.
    sqlite.prepare(`UPDATE runs SET analysis_mentions_json='{"Acme":0}' WHERE id='cro-run'`).run();
    sqlite.prepare(`UPDATE runs SET analysis_mentions_json='{"Acme":1}' WHERE id='run'`).run();
    const report = await evaluate();
    const acme = report.brands.find((row) => row.brand === 'Acme');
    assert.equal(acme.prompts, 2);
    assert.equal(acme.absent, 1);
    assert.equal(acme.assessed, 1);
    assert.equal(report.details.some((detail) => detail.runId === 'cro-run' && detail.brand === 'Acme'), false);
    assert.deepEqual(await band('positive'), ['run']);
  } finally {
    close();
  }
});
test('a monitored brand whose effective mention is off is not read; when the flag turns on, the missing brand is read', async () => {
  const sent = [];
  const { sqlite, run, close, evaluate } = sentimentFixture((request) => (sent.push(JSON.parse(request)), ['recommended']));
  globalThis.researchFixture.discoverySuggestions = [{ name: 'Orbit', domain: null }];
  try {
    const stamp = new Date().toISOString();
    sqlite.prepare("INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES('cro','cro','project','What is conversion rate optimization?','chat_gpt',?,?)").run(stamp, stamp);
    run('cro-run', 'Acme rate optimization improves the share of visitors who convert. Orbit is a tool for it.', stamp, 'cro');
    sqlite.prepare(`UPDATE runs SET analysis_mentions_json='{"Acme":0}' WHERE id='cro-run'`).run();
    sqlite.prepare(`UPDATE runs SET analysis_mentions_json='{"Acme":1}' WHERE id='run'`).run();
    const readsAcme = (request) => request.state.answer.includes('rate optimization') && request.state.identities.some((item) => item.name === 'Acme');
    let report = await evaluate();
    // The text names Acme, but the report never counts it there: it is not scored (the discovery in the same answer still is).
    assert.ok(sent.some((request) => request.state.answer.includes('rate optimization')));
    assert.equal(sent.filter(readsAcme).length, 0);
    assert.equal(report.brands.find((row) => row.brand === 'Acme').absent, 1);
    // The brand analysis now settles that the answer does name the company: the reading's key changes and Acme, missing, is read.
    sqlite.prepare(`UPDATE runs SET analysis_mentions_json='{"Acme":1}' WHERE id='cro-run'`).run();
    report = await evaluate();
    assert.equal(sent.filter(readsAcme).length, 1);
    const acme = report.brands.find((row) => row.brand === 'Acme');
    assert.deepEqual([acme.absent, acme.assessed], [0, 2]);
    // Read once: a later evaluation asks nothing more.
    const before = sent.length;
    await evaluate();
    assert.equal(sent.length, before);
  } finally {
    close();
  }
});
test('the drill down bands each question by the mean of its models, as the index does', async () => {
  // ChatGPT recommends Acme as the leader (85); Gemini criticizes it with a reservation (15): the question's mean is 50, neutral.
  const { run, close, evaluate, band } = sentimentFixture((request) => (request.includes('terrible') ? ['criticized', 'reservation'] : ['recommended', 'leader']));
  try {
    run('gemini-run', 'Acme is terrible for large teams.', new Date().toISOString(), 'prompt', 'gemini');
    const report = await evaluate();
    assert.deepEqual(report.details.filter((detail) => detail.brand === 'Acme').map((detail) => detail.score).sort(), [15, 85]);
    assert.deepEqual(report.brands.find((row) => row.brand === 'Acme').distribution, { positive: 0, neutral: 1, negative: 0 });
    assert.deepEqual(await band('neutral'), ['gemini-run', 'run']);
    assert.deepEqual(await band('positive'), []);
    assert.deepEqual(await band('negative'), []);
  } finally {
    close();
  }
});
test('Cloud ignores the `*` wildcard when selecting pending research jobs', async () => {
  const { sqlite } = database(),
    originalFetch = globalThis.fetch;
  const stamp = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO projects(id,workspace_id,name,domain,category,daily_enabled,created_at) VALUES('foreign','owner','Other','other.example','software',0,?)",
    )
    .run(stamp);
  sqlite
    .prepare(
      "INSERT INTO brand_research_configurations(project_id,workspace_id,provider,enabled,revision,updated_at) VALUES('foreign','owner','jev',1,1,?)",
    )
    .run(stamp);
  const settings = {
    OPENROUTER_API_KEY: 'isolated-not-a-key',
    BRAND_RESEARCH_ENABLED: 'true',
    BRAND_RESEARCH_PROJECTS: 'project,*',
  };
  globalThis.researchFixture = { db: d1(sqlite), settings };
  let outbound = 0;
  globalThis.fetch = async () => {
    outbound++;
    throw new Error('Isolated transport timeout.');
  };
  try {
    // Unauthorized projects' jobs are older, so with a stray `*` they would fill
    // the LIMIT window and the authorized job would never run.
    const enqueue = (id, projectId, requested) =>
      sqlite
        .prepare(
          "INSERT INTO brand_research_jobs(id,project_id,workspace_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at) VALUES(?,?,'owner',?,?,'sha','jev','typesafe/jev-1.14','pending',0,'{}',?)",
        )
        .run(id, projectId, id, 'ctx-' + id, requested);
    enqueue('f1', 'foreign', '2020-01-01T00:00:00.000Z');
    enqueue('f2', 'foreign', '2020-01-02T00:00:00.000Z');
    enqueue('p1', 'project', '2020-01-03T00:00:00.000Z');
    const status = (id) =>
      sqlite
        .prepare('SELECT status FROM brand_research_jobs WHERE id=?')
        .get(id).status;
    await cloudWorker.processBrandResearchJobs();
    assert.equal(status('f1'), 'pending');
    assert.equal(status('f2'), 'pending');
    assert.notEqual(status('p1'), 'pending', 'The authorized job still runs');
    assert.equal(outbound, 0, 'No unauthorized project is sent');
    assert.equal(cloudWorker.researchAllowed('foreign'), false);
    assert.equal(worker.researchAllowed('foreign'), true);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
test('every monitored brand is read where the answer names it; a longer or changed list keeps the paid readings', async () => {
  const { sqlite } = database(),
    originalFetch = globalThis.fetch;
  globalThis.researchFixture = {
    db: d1(sqlite),
    settings: {
      OPENROUTER_API_KEY: 'isolated-not-a-key',
      BRAND_RESEARCH_ENABLED: 'true',
      BRAND_RESEARCH_PROJECTS: 'project',
    },
  };
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const answers = Object.fromEntries(
      Object.entries(request.questions).map(([id, q]) => {
        const labels = Object.keys(q.criteria),
          choice = id.endsWith('_role')
            ? 'competitor'
            : criteriaChoice(id, q, PROMOTER);
        return [
          id,
          {
            type: 'choice',
            choice,
            probabilities: Object.fromEntries(
              labels.map((label) => [label, label === choice ? 1 : 0]),
            ),
          },
        ];
      }),
    );
    return Response.json({
      model: request.model,
      answers,
      usage: { cost: 0.0001 },
    });
  };
  const setCompetitors = (names) =>
    sqlite
      .prepare('UPDATE projects SET competitors_json=?')
      .run(
        JSON.stringify(
          names.map((name) => ({
            name,
            domain: `${name.toLowerCase()}.example`,
          })),
        ),
      );
  const report = (query = '') =>
    worker.brandResearchReport('project', 'owner', new URLSearchParams(query));
  try {
    setCompetitors(['One', 'Two', 'Three', 'Four', 'Five']);
    await worker.enqueueBrandResearch(
      'project',
      'owner',
      new URLSearchParams(),
      'jev',
    );
    await worker.processBrandResearchJobs();
    let current = await report();
    assert.equal(current.brands[0].assessed, 1);
    assert.equal(current.unread, undefined, 'no monitored brand is left unread');
    assert.equal(current.outdated, 0);
    assert.equal(current.suggestions[0].name, 'Orbit');
    // Rejecting a brand that was only discovered keeps the paid readings and drops it from the suggestions.
    globalThis.researchFixture.rejected = ['Orbit'];
    current = await report();
    assert.equal(current.brands[0].assessed, 1);
    assert.equal(current.outdated, 0);
    assert.deepEqual(current.suggestions, []);
    // Competitors 6 and 7 are read like the others; the answer does not name them, so the paid reading stays valid
    // and nothing is read again.
    setCompetitors(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']);
    current = await report();
    assert.equal(current.brands[0].assessed, 1);
    assert.equal(current.unassessed, 0);
    assert.equal(current.brands.length, 8);
    assert.equal(current.outdated, 0);
    assert.equal((await worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev')).enqueued, 0);
    // A change inside the read list keeps the readings of every brand that stays; nothing is out of date and
    // nothing is read again, since the answer does not mention the new brand.
    setCompetitors(['Uno', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']);
    current = await report();
    assert.equal(current.brands[0].assessed, 1);
    assert.equal(current.outdated, 0);
    assert.equal(current.unassessed, 0);
    assert.equal((await worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev')).enqueued, 0);
    // Monitoring a brand the evaluator already read in this answer as a discovery (the owner clicking Monitor) keeps its sentiment.
    setCompetitors(['Orbit', 'Two', 'Three', 'Four', 'Five']);
    current = await report();
    assert.equal(current.brands.find((item) => item.brand === 'Orbit')?.assessed, 1);
    assert.equal(current.brands[0].assessed, 1);
    assert.equal(current.unassessed, 0);
    assert.equal(current.outdated, 0);
    assert.equal((await worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev')).enqueued, 0);
    // Every D1 call costs ~250 ms in production: the report reads in three trips (the project with its settings, store,
    // decisions and roles; then the saved readings without their evidence and the ones made under another context; then the
    // evidence of the few answers it shows), however many brands.
    // (The fixture serves the project store from the same database: its reads of the answers are not D1 trips.)
    let trips = 0;
    const base = globalThis.researchFixture.db;
    const trip = ({ sql }) => { if (!/\bruns\b/.test(sql)) trips++; };
    const counted = (bound) => ({ ...bound, bind: (...values) => counted(bound.bind(...values)), all: () => (trip(bound), bound.all()), first: () => (trip(bound), bound.first()) });
    globalThis.researchFixture.db = { ...base, prepare: (sql) => counted(base.prepare(sql)), batch: (statements) => (trip(statements[0]), base.batch(statements)) };
    const counting = await report();
    globalThis.researchFixture.db = base;
    assert.equal(trips, 3);
    assert.equal(counting.outdated, 0);
    // The warning only counts what the current period still shows.
    current = await report('start=2099-01-01T00:00:00.000Z');
    assert.equal(current.outdated, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});

test('a configured research model runs, and a failure falls back to the provider model that is recorded', async () => {
  const { sqlite } = database(),
    originalFetch = globalThis.fetch,
    originalWarn = console.warn,
    D1 = 'liquid/d1-ultra',
    JEV = 'typesafe/jev-1.14';
  const settings = {
    OPENROUTER_API_KEY: 'isolated-not-a-key',
    BRAND_RESEARCH_ENABLED: 'true',
    BRAND_RESEARCH_PROJECTS: 'project',
    LASTFIND_CLASSIFIER_MODELS: JSON.stringify({ brand_research_jev: D1 }),
  };
  globalThis.researchFixture = { db: d1(sqlite), settings };
  const models = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    models.push(request.model);
    if (request.model === D1) return new Response('unavailable', { status: 503 });
    const answers = Object.fromEntries(
      Object.entries(request.questions).map(([id, q]) => {
        const labels = Object.keys(q.criteria),
          choice = id.endsWith('_role') ? 'competitor' : criteriaChoice(id, q, PROMOTER);
        return [id, { type: 'choice', choice, probabilities: Object.fromEntries(labels.map((label) => [label, label === choice ? 1 : 0])) }];
      }),
    );
    return Response.json({ model: request.model, answers, usage: { cost: 0.0001 } });
  };
  console.warn = () => {};
  try {
    const report = () => worker.brandResearchReport('project', 'owner', new URLSearchParams());
    assert.equal((await report()).model, D1, 'the configured model is what the report announces');
    await worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
    assert.equal(sqlite.prepare('SELECT model FROM brand_research_jobs').get().model, D1);
    assert.equal(await worker.processBrandResearchJobs(), 1);
    assert.deepEqual(models, [D1, JEV], 'exactly one retry, on the provider model');
    // The 503 may have been billed without a reported cost, so the reservation stays.
    assert.deepEqual({ ...sqlite.prepare('SELECT status,model,reserved_usd FROM brand_research_jobs').get() }, { status: 'unsettled', model: JEV, reserved_usd: 0.02 });
    assert.equal((await report()).brands[0].assessed, 1, 'the reading from the previous engine is used');
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle`)))
  for (const savedProvider of ['jev', 'decisions']) {
    test(`${edition}: append-only sentiment column preserves ${savedProvider} choices, source jobs and ownership`, async () => {
      const { sqlite } = database(edition, '0025_sentiment_provider.sql');
      sqlite
        .prepare('UPDATE brand_research_configurations SET provider=?')
        .run(savedProvider);
      const original = {
        ...sqlite.prepare('SELECT * FROM brand_research_configurations').get(),
      };
      sqlite.exec(
        readFileSync(
          root + `apps/${edition}/drizzle/0025_sentiment_provider.sql`,
          'utf8',
        ),
      );
      const migrated = {
        ...sqlite.prepare('SELECT * FROM brand_research_configurations').get(),
      };
      assert.deepEqual(migrated, { ...original, sentiment_provider: null });
      // The next append-only column pair; existing rows stay manual (automatic 0) with the default ceiling (NULL).
      sqlite.exec(readFileSync(root + `apps/${edition}/drizzle/0027_automatic_evaluations.sql`, 'utf8'));
      assert.deepEqual(
        { ...sqlite.prepare('SELECT * FROM brand_research_configurations').get() },
        { ...migrated, automatic: 0, monthly_ceiling_usd: null },
      );
      // The code under test runs on the current schema: apply what came after this migration too.
      for (const name of readdirSync(root + `apps/${edition}/drizzle`)
        .filter((name) => name.endsWith('.sql') && name > '0025_sentiment_provider.sql' && name !== '0027_automatic_evaluations.sql')
        .sort())
        sqlite.exec(readFileSync(root + `apps/${edition}/drizzle/` + name, 'utf8'));
      globalThis.researchFixture = {
        db: d1(sqlite),
        settings: {
          OPENROUTER_API_KEY: 'fixture',
          BRAND_RESEARCH_ENABLED: 'true',
          BRAND_RESEARCH_PROJECTS: 'project',
        },
      };
      const runtime = edition === 'cloud' ? cloudWorker : worker;
      try {
        assert.equal(
          (await runtime.brandResearchConfiguration('project', 'owner'))
            .sentimentProvider,
          savedProvider,
        );
        assert.equal(
          (
            await runtime.brandResearchReport(
              'project',
              'owner',
              new URLSearchParams(),
            )
          ).provider,
          savedProvider,
        );
        // The ordinary queue and its claim guard must switch sentiment without cancelling Fontes.
        await runtime.enqueueBrandResearch(
          'project',
          'owner',
          new URLSearchParams(),
          savedProvider,
        );
        sqlite
          .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at)
        VALUES('source-job','owner','project','source-input','source-types:fixture','source-hash',?,'fixture','pending',0.02,'{}',?)`)
          .run(savedProvider, new Date().toISOString());
        await assert.rejects(
          runtime.saveBrandResearchConfiguration('project', 'other-owner', {
            provider: 'liquid',
            enabled: true,
            expectedRevision: 1,
          }),
          /not found/,
        );
        await runtime.saveBrandResearchConfiguration('project', 'owner', {
          provider: 'liquid',
          enabled: true,
          expectedRevision: 1,
        });
        const stored = sqlite
          .prepare('SELECT * FROM brand_research_configurations')
          .get();
        assert.equal(stored.provider, savedProvider);
        assert.equal(stored.sentiment_provider, 'liquid');
        assert.equal(stored.workspace_id, original.owner_id, 'the owner_id of 0025 is the workspace_id of 0111');
        assert.equal(
          sqlite
            .prepare(
              "SELECT status FROM brand_research_jobs WHERE id='source-job'",
            )
            .get().status,
          'pending',
        );
        assert.equal(
          sqlite
            .prepare(
              "SELECT status FROM brand_research_jobs WHERE context_key NOT LIKE 'source-types:%'",
            )
            .get().status,
          'cancelled',
        );
        const originalFetch = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = async (_, init) => {
          calls++;
          assert.equal(JSON.parse(init.body).model, 'liquid/d1-ultra');
          throw new Error('Fixture timeout; never contacts OpenRouter');
        };
        try {
          await runtime.enqueueBrandResearch(
            'project',
            'owner',
            new URLSearchParams(),
            'liquid',
          );
          assert.equal(await runtime.processBrandResearchJobs(), 1);
          assert.equal(calls, 1);
          assert.equal(
            sqlite
              .prepare(
                "SELECT status FROM brand_research_jobs WHERE id='source-job'",
              )
              .get().status,
            'pending',
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
        assert.throws(
          () =>
            sqlite.exec(
              "UPDATE brand_research_configurations SET sentiment_provider='unknown'",
            ),
          /CHECK/,
        );
        sqlite.exec('DELETE FROM brand_research_configurations');
        const fresh = await runtime.brandResearchConfiguration(
          'project',
          'owner',
        );
        assert.equal(fresh.provider, 'jev');
        assert.equal(fresh.sentimentProvider, 'liquid');
        await runtime.saveBrandResearchConfiguration('project', 'owner', {
          provider: 'liquid',
          enabled: false,
          expectedRevision: 0,
        });
        assert.equal(
          sqlite
            .prepare('SELECT provider FROM brand_research_configurations')
            .get().provider,
          'jev',
        );
      } finally {
        delete globalThis.researchFixture;
        sqlite.close();
      }
    });
  }

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle`)))
  test(`research accepts canonical prompt keys through 253 characters and rejects longer input (${edition})`, async () => {
    const { sqlite } = database(edition);
    globalThis.researchFixture = { db: d1(sqlite), settings: {} };
    try {
      const prompt = 'project:' + 'p'.repeat(245);
      sqlite.prepare('UPDATE prompts SET unit_id=?').run(prompt);
      const report = await worker.brandResearchReport('project', 'owner', new URLSearchParams({prompt}));
      assert.equal(report.selectedChannels, 1);
      await assert.rejects(worker.brandResearchReport('project', 'owner', new URLSearchParams({prompt:prompt+'x'})), /Invalid research filter/);
    } finally {
      sqlite.close();
      delete globalThis.researchFixture;
    }
  });

test('a discovered brand keeps its sentiment while a decision waits for the analysis and while the new pass runs', async () => {
  const { sqlite, run } = database();
  const settings = { OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' };
  const suggest = (...names) => names.map((name, index) => ({ name, domain: null, answerCount: 10 - index }));
  globalThis.researchFixture = { db: d1(sqlite), settings, discoverySuggestions: suggest('Orbit', 'Zeta') };
  const decide = (name, role) => sqlite.prepare("INSERT INTO brand_role_decisions(project_id,brand_key,model,role,decided_at) VALUES('project',?,'liquid/d1-ultra',?,?)").run(name.toLowerCase(), role, new Date().toISOString());
  const enqueue = () => worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
  const scored = async () => (await worker.brandResearchReport('project', 'owner', new URLSearchParams())).brands.filter((item) => item.discovered && item.assessed > 0).map((item) => item.brand).sort();
  try {
    run('gemini-run', 'Acme is fine. Orbit is good, and Zeta is another option.', new Date().toISOString(), 'prompt', 'gemini');
    decide('Orbit', 'competitor');
    decide('Zeta', 'competitor');
    assert.ok((await enqueue()).enqueued > 0);
    sqlite.prepare("UPDATE brand_research_jobs SET status='completed'").run();
    for (const row of sqlite.prepare('SELECT id,input_json FROM brand_research_jobs').all())
      sqlite.prepare('UPDATE brand_research_jobs SET result_json=? WHERE id=?').run(
        JSON.stringify(JSON.parse(row.input_json).options.map((option) => ({ id: option.id, state: 'assessed', sentiment: 'positive', score: 80, criteria: { recommended: 0, leader: 0 }, candidate: option.kind === 'candidate' ? 'competitor' : null, evidence: [`${option.name} is`] }))),
        row.id,
      );
    assert.deepEqual(await scored(), ['Orbit', 'Zeta']);
    // Monitor on Zeta: the store still holds the last complete list, the decision waits for the restart.
    globalThis.researchFixture.needsEnsure = true;
    assert.deepEqual(await scored(), ['Orbit', 'Zeta'], 'shown while the decision waits for the analysis');
    assert.equal((await enqueue()).enqueued, 0, 'nothing new is read meanwhile');
    // The pass over the new targets runs: its own list is not ready, the last complete one stays.
    Object.assign(globalThis.researchFixture, { needsEnsure: false, analysisStatus: 'running', discoverySuggestions: [], analysisPrevious: { suggestions: suggest('Orbit', 'Zeta'), analyzed: 1 } });
    assert.deepEqual(await scored(), ['Orbit', 'Zeta'], 'shown while the new pass runs');
    assert.equal((await enqueue()).enqueued, 0, 'nothing new is read while the pass runs');
    // The pass ends without Zeta among the discoveries (it is monitored now): Orbit keeps its reading.
    Object.assign(globalThis.researchFixture, { analysisStatus: 'complete', discoverySuggestions: suggest('Orbit'), analysisPrevious: undefined });
    assert.deepEqual(await scored(), ['Orbit'], 'shown after the pass');
  } finally {
    sqlite.close();
    delete globalThis.researchFixture;
  }
});

test('a change in the discovery list reads only the answers that mention the new brand, and a role not settled gets no reading', async () => {
  const { sqlite, run } = database();
  const settings = { OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' };
  const suggest = (...names) => names.map((name, index) => ({ name, domain: null, answerCount: 10 - index }));
  globalThis.researchFixture = { db: d1(sqlite), settings, discoverySuggestions: suggest('Orbit') };
  const decide = (name, role) => sqlite.prepare("INSERT INTO brand_role_decisions(project_id,brand_key,model,role,decided_at) VALUES('project',?,'liquid/d1-ultra',?,?)").run(name.toLowerCase(), role, new Date().toISOString());
  const enqueue = () => worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
  const jobs = () => sqlite.prepare('SELECT input_json FROM brand_research_jobs ORDER BY requested_at').all().map((row) => JSON.parse(row.input_json));
  try {
    run('gemini-run', 'Acme is fine. Zeta is another option, and so is Go.', new Date().toISOString(), 'prompt', 'gemini');
    run('claude-run', 'Acme is okay and nothing else.', new Date().toISOString(), 'prompt', 'claude');
    decide('Orbit', 'competitor');
    decide('Zeta', 'partner');
    decide('Go', 'ambiguous');
    assert.equal((await enqueue()).enqueued, 3);
    assert.equal((await enqueue()).enqueued, 0);
    // The loose names of that answer filled its places before the list had Zeta: its saved reading holds no note for it.
    for (const row of sqlite.prepare('SELECT id,input_json FROM brand_research_jobs').all()) {
      const input = JSON.parse(row.input_json);
      input.options = input.options.filter((option) => option.name !== 'Zeta');
      sqlite.prepare('UPDATE brand_research_jobs SET input_json=? WHERE id=?').run(JSON.stringify(input), row.id);
    }
    // A new discovery: only the answer that mentions it is read again; the others keep their saved reading.
    globalThis.researchFixture.discoverySuggestions = suggest('Orbit', 'Zeta', 'Go');
    assert.equal((await enqueue()).enqueued, 1);
    const names = (input) => input.options.filter((option) => option.kind === 'candidate').map((option) => option.name);
    assert.deepEqual(jobs().map(names).filter((list) => list.includes('Zeta')).map((list) => list[0]), ['Zeta']);
    // A discovery that leaves the list reads nothing again, and neither does one that returns.
    globalThis.researchFixture.discoverySuggestions = suggest('Orbit');
    assert.equal((await enqueue()).enqueued, 0);
    globalThis.researchFixture.discoverySuggestions = suggest('Zeta', 'Orbit');
    assert.equal((await enqueue()).enqueued, 0);
    // Saved readings of the discoveries reach the report, only for the answers that mention them.
    sqlite.prepare("UPDATE brand_research_jobs SET status='completed'").run();
    for (const row of sqlite.prepare('SELECT id,input_json FROM brand_research_jobs').all()) {
      const readings = JSON.parse(row.input_json).options.map((option) => ({
        id: option.id,
        state: 'assessed',
        sentiment: 'positive',
        score: 85,
        criteria: { recommended: 0, leader: 0 },
        candidate: option.kind === 'candidate' ? 'competitor' : null,
        evidence: [option.name === 'Acme' ? 'Acme is fine.' : `${option.name} is`],
      }));
      sqlite.prepare('UPDATE brand_research_jobs SET result_json=? WHERE id=?').run(JSON.stringify(readings), row.id);
    }
    const report = await worker.brandResearchReport('project', 'owner', new URLSearchParams());
    const brand = (name) => report.brands.find((item) => item.brand === name);
    assert.equal(brand('Zeta').assessed, 1);
    assert.equal(brand('Zeta').discovered, true);
    assert.equal(brand('Orbit').assessed, 1);
    // "Go" is not settled: whatever loose reading its answer got, it has no note of its own.
    assert.equal(brand('Go'), undefined);
    assert.equal(brand('Acme').discovered, undefined);
    // A discovered brand's answers and evidence come only to a read that names it (the default read reached 2.9 MB).
    assert.ok(!report.details.some((detail) => brand(detail.brand)?.discovered), 'no discovered evidence in the default read');
    const named = await worker.brandResearchReport('project', 'owner', new URLSearchParams('evidenceBrand=Zeta'));
    assert.ok(named.details.some((detail) => detail.brand === 'Zeta' && detail.sentiment === 'positive' && detail.evidence.length));
    assert.ok(!named.details.some((detail) => detail.brand === 'Orbit'));
    assert.deepEqual(named.brands, report.brands, 'the same numbers');
    // The saved jobs reach the report without their answer excerpt (up to 16,000 characters each), and the numbers do not change.
    const read = [];
    const base = globalThis.researchFixture.db;
    globalThis.researchFixture.db = {
      ...base,
      batch: async (statements) => {
        const results = await base.batch(statements);
        statements.forEach(({ sql }, index) => { if (/FROM brand_research_jobs WHERE project_id=\? AND workspace_id=\? AND answer_sha256 IN/.test(sql)) read.push(...results[index].results); });
        return results;
      },
    };
    const slim = await worker.brandResearchReport('project', 'owner', new URLSearchParams());
    globalThis.researchFixture.db = base;
    assert.ok(read.length);
    assert.ok(read.every((row) => !('excerpt' in JSON.parse(row.input_json)) && JSON.parse(row.input_json).options.length));
    assert.ok(sqlite.prepare('SELECT input_json FROM brand_research_jobs').all().every((row) => JSON.parse(row.input_json).excerpt), 'the saved jobs keep their excerpt');
    assert.deepEqual(slim.brands, report.brands);
    assert.deepEqual(slim.details, report.details);
    // Nor their readings' evidence (most of a job's bytes): the report fills in exactly the stored quotes of what it shows.
    assert.ok(read.every((row) => JSON.parse(row.result_json).every((reading) => reading.state && !('evidence' in reading))));
    const assessed = slim.details.filter((detail) => detail.state === 'assessed');
    assert.ok(assessed.length);
    for (const detail of slim.details)
      assert.deepEqual(detail.evidence, detail.state === 'assessed' ? [detail.brand === 'Acme' ? 'Acme is fine.' : `${detail.brand} is`] : []);
    const quoted = slim.suggestions.flatMap((item) => item.evidence.map((evidence) => [item.name, evidence.excerpt]));
    for (const [name, excerpt] of quoted) assert.equal(excerpt, `${name} is`);
  } finally {
    delete globalThis.researchFixture;
    sqlite.close();
  }
});

test('jobs saved before the discovery list left the context stay valid when the list changes, and only for the same project, targets and model', async () => {
  const { sqlite, run } = database();
  const settings = { OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' };
  const suggest = (...names) => names.map((name, index) => ({ name, domain: null, answerCount: 10 - index }));
  globalThis.researchFixture = { db: d1(sqlite), settings, discoverySuggestions: suggest('Orbit') };
  for (const name of ['orbit', 'nova']) sqlite.prepare("INSERT INTO brand_role_decisions(project_id,brand_key,model,role,decided_at) VALUES('project',?,'liquid/d1-ultra','competitor',?)").run(name, new Date().toISOString());
  const enqueue = () => worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
  try {
    run('gemini-run', 'Acme is fine. Zeta is another option.', new Date().toISOString(), 'prompt', 'gemini');
    const first = (await enqueue()).enqueued;
    assert.ok(first > 0);
    sqlite.prepare("UPDATE brand_research_jobs SET status='completed'").run();
    // Saved by the code of before: another context key (the whole list was in it) and the request time before the cut.
    sqlite.prepare("UPDATE brand_research_jobs SET input_key='old-'||id,context_key='key-of-the-old-list',requested_at='2026-10-01T00:00:00.000Z'").run();
    // A brand that no answer mentions joins the list: no answer is read again.
    globalThis.researchFixture.discoverySuggestions = suggest('Orbit', 'Nova');
    assert.equal((await enqueue()).enqueued, 0);
    // Another model is not the same reading.
    sqlite.prepare("UPDATE brand_research_jobs SET model='another-model'").run();
    assert.equal((await enqueue()).enqueued, first);
  } finally {
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
test('a reading that failed under another context does not hold its answer; under the current one it is never resent', async () => {
  const { sqlite, run } = database();
  const settings = { OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' };
  globalThis.researchFixture = { db: d1(sqlite), settings, discoverySuggestions: [] };
  const enqueue = () => worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
  try {
    run('gemini-run', 'Acme is fine. Zeta is another option.', new Date().toISOString(), 'prompt', 'gemini');
    const first = (await enqueue()).enqueued;
    assert.ok(first > 0);
    sqlite.prepare("UPDATE brand_research_jobs SET status='failed',result_json=NULL,error='Unexpected Decisions model.'").run();
    assert.equal((await enqueue()).enqueued, 0, 'the same request is never resent');
    // An older adapter's context: the failed job no longer holds the answer.
    sqlite.prepare("UPDATE brand_research_jobs SET input_key='old-'||id,context_key='older-adapter',requested_at='2026-10-01T00:00:00.000Z'").run();
    assert.equal((await enqueue()).enqueued, first);
  } finally {
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
test('the question goes with the answer, earlier-rule readings hold their answers uncounted until an admin reprocess', async () => {
  const { sqlite } = database(),
    originalFetch = globalThis.fetch;
  globalThis.researchFixture = {
    db: d1(sqlite),
    discoverySuggestions: [],
    settings: { OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' },
  };
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    sent.push(request);
    return Response.json({
      model: request.model,
      usage: { cost: 0.0001 },
      answers: Object.fromEntries(Object.keys(request.questions).map((id) => {
        const choice = id.endsWith('_role') ? 'competitor' : criteriaChoice(id, request.questions[id], ['recommended', 'reservation']);
        return [id, { type: 'choice', choice, probabilities: oneHot(request.questions[id], choice) }];
      })),
    });
  };
  try {
    await worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
    await worker.processBrandResearchJobs();
    assert.equal(sent.length, 1, 'One call for the answer and every brand in it.');
    assert.equal(sent[0].state.question, 'Which software works best?');
    let report = await worker.brandResearchReport('project', 'owner', new URLSearchParams());
    // Recommended with a reservation: 50 + 20 - 15 = 55, neutral; the report carries the why (each criterion's quote).
    assert.deepEqual([report.brands[0].assessed, report.brands[0].scoreTotal, report.brands[0].distribution.neutral], [1, 55, 1]);
    assert.deepEqual([report.details[0].score, report.details[0].criteria], [55, { recommended: 0, reservation: 0 }]);
    assert.ok(report.details[0].evidence[0].includes('Acme'));
    // The same answer read under the previous rule (a 0–10 score): it still holds the answer, but is never counted.
    sqlite
      .prepare(
        `UPDATE brand_research_jobs SET context_key='previous-rule',input_key='previous-key',requested_at='2026-10-01T00:00:00.000Z',input_json=json_set(input_json,'$.rubric','brand-nps-v1'),
         result_json=(SELECT json_group_array(json(json_remove(json_set(value,'$.score',8,'$.sentiment','neutral'),'$.criteria'))) FROM json_each(result_json))`,
      )
      .run();
    report = await worker.brandResearchReport('project', 'owner', new URLSearchParams());
    assert.deepEqual([report.brands[0].assessed, report.brands[0].partial, report.unassessed], [0, 1, 0]);
    // Never shown to the customer (10/11/2026: "Evaluated on the previous scale"): the answer leaves the evidence.
    assert.equal(report.details.length, 0);
    let pending = await worker.unevaluatedResearch('project', 'owner', 'jev', 0);
    assert.deepEqual([pending.count, pending.legacy], [0, 1], 'Nothing is read again by itself; a reprocess would read one answer.');
    // The admin's "reprocess everything": the earlier reading stops holding the answer, which is read again with the new rule.
    sqlite.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').run('sentiment-reprocess:project', JSON.stringify({ rubric: 'brand-criteria-v1', requestedAt: new Date().toISOString() }));
    pending = await worker.unevaluatedResearch('project', 'owner', 'jev', 0);
    assert.deepEqual([pending.count, pending.legacy], [1, 0]);
    // A request made for an older rule reprocesses nothing.
    sqlite.prepare("UPDATE system_state SET value=? WHERE key='sentiment-reprocess:project'").run(JSON.stringify({ rubric: 'brand-nps-v1' }));
    pending = await worker.unevaluatedResearch('project', 'owner', 'jev', 0);
    assert.deepEqual([pending.count, pending.legacy], [0, 1]);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
test('two requests for the same report while it is computed share one computation', async () => {
  const early = Promise.resolve([[{ workspace_id: 'owner' }], [{ workspace_id: 'owner', generation: 'g', source_revision: 1, applied_revision: 1 }], [], []]);
  let computed = 0;
  let finish;
  const compute = () => {
    computed++;
    return new Promise((done) => (finish = done));
  };
  const q = new URLSearchParams({ project: 'project', days: '28' });
  const first = worker.keptResearchReport('project', 'owner', q, { fresh: false, early }, compute);
  const second = worker.keptResearchReport('project', 'owner', new URLSearchParams({ days: '28', project: 'project' }), { fresh: true, early }, compute);
  await new Promise((done) => setTimeout(done, 0));
  finish({ brands: [] });
  assert.deepEqual(await Promise.all([first, second]), [{ brands: [] }, { brands: [] }]);
  assert.equal(computed, 1);
  await worker.keptResearchReport('project', 'owner', q, { fresh: false, early }, async () => (computed++, { brands: [] }));
  assert.equal(computed, 2, 'A finished computation is not reused: the next request computes (or finds the copy).');
});

test('the sentiment copy is stale-while-revalidate: current as it is, older at once while it is computed again, none computes first', async () => {
  const stored = { value: null, storedAt: 0, last: null };
  const kept = [];
  const refreshes = [];
  const probes = [];
  globalThis.researchFixture = {
    copy: async (_scope, inputs, options) => {
      probes.push({ inputs, options });
      return { ...stored, keep: (value) => kept.push(value), refresh: (work) => refreshes.push(work().then((value) => kept.push(value))) };
    },
  };
  try {
    const registry = { workspace_id: 'owner', generation: 'g', source_revision: 1, applied_revision: 1 };
    const early = (settled, store = registry) => Promise.resolve([[{ workspace_id: 'owner' }], [store], [], [], [{ settled }]]);
    let computed = 0;
    // A computation takes a while (seconds in production): the copies are painted before it ends.
    const compute = async () => {
      await new Promise((done) => setTimeout(done, 5));
      return { brands: [++computed] };
    };
    const q = new URLSearchParams({ project: 'project', days: '7' });
    const read = (settled, { fresh = false, store } = {}) => worker.keptResearchReport('project', 'owner', q, { fresh, early: early(settled, store) }, compute);
    const ten = '2026-10-29T10:00:00.000Z', eleven = '2026-10-29T11:00:00.000Z';
    // A read with no copy at all computes before answering, and keeps the copy with the reading it saw.
    assert.deepEqual(await read(ten), { brands: [1] });
    assert.equal(JSON.parse(kept.at(-1)).settledAt, ten);
    assert.equal(probes[0].options.last, true, 'the store is asked for the last copy too');
    assert.ok(!JSON.stringify(probes[0].inputs).includes(ten), 'a new reading does not hide the copy: it is compared, not part of the key');
    // The copy for the current data and readings: as it is, without `cachedAt`, so the screen does not read it again.
    Object.assign(stored, { value: kept.at(-1), storedAt: Date.now() });
    assert.deepEqual(await read(ten), { brands: [1] });
    assert.equal(computed, 1);
    assert.equal(refreshes.length, 0);
    // A reading landed since (a reprocess, the daily evaluations): the copy at once, marked `cachedAt`, computed again after.
    let report = await read(eleven);
    assert.deepEqual(report.brands, [1]);
    assert.ok(report.cachedAt);
    assert.equal(computed, 1, 'nothing computed before answering');
    await Promise.all(refreshes);
    assert.equal(computed, 2);
    assert.equal(JSON.parse(kept.at(-1)).settledAt, eleven, 'the next read finds a current copy');
    // New answers (no copy for the current data): the last copy of the same read, at once, and computed again.
    Object.assign(stored, { value: null, last: { value: kept.at(-1), storedAt: Date.now() } });
    report = await read(eleven);
    assert.deepEqual(report.brands, [2]);
    assert.ok(report.cachedAt);
    await Promise.all(refreshes);
    assert.equal(computed, 3);
    // Publication behind: no copy is current, the one there is painted.
    Object.assign(stored, { value: kept.at(-1), last: null });
    report = await read(eleven, { store: { ...registry, source_revision: 2 } });
    assert.deepEqual(report.brands, [3]);
    assert.ok(report.cachedAt);
    await Promise.all(refreshes);
    assert.equal(computed, 4);
    // `fresh` (the screen's second read) computes now; a copy older than a day is not painted.
    assert.deepEqual(await read(eleven, { fresh: true }), { brands: [5] });
    Object.assign(stored, { storedAt: Date.now() - 25 * 3600_000 });
    assert.deepEqual(await read(eleven), { brands: [6] });
  } finally {
    delete globalThis.researchFixture;
  }
});

test('every brand an answer names is read; a reading of the shorter list holds until a reprocess for every brand; nothing is read while the analysis runs', async () => {
  const { sqlite, run } = database(),
    originalFetch = globalThis.fetch;
  const monitored = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];
  sqlite.prepare('UPDATE projects SET competitors_json=?').run(JSON.stringify(monitored.map((name) => ({ name, domain: `${name.toLowerCase()}.example` }))));
  sqlite.exec('DELETE FROM runs');
  run('every', 'Acme leads. One, Two, Three, Four, Five, Six and Seven follow. Orbit is a client of Acme. Lume is new. Nil is a heading. Gone was rejected.');
  // The decision model settled Orbit as a client and Nil as no brand; Lume waits in review; the owner rejected Gone.
  const decided = sqlite.prepare("INSERT INTO brand_role_decisions(project_id,brand_key,model,role,cost_usd,decided_at) VALUES('project',?,'liquid/d1-ultra',?,0,'2026-10-30T00:00:00.000Z')");
  decided.run('orbit', 'client');
  decided.run('nil', 'not_brand');
  const settings = { OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' };
  globalThis.researchFixture = {
    db: d1(sqlite),
    settings,
    discoverySuggestions: ['Orbit', 'Lume', 'Nil', 'Gone'].map((name) => ({ name, domain: null, answerCount: 1 })),
    rejected: ['Gone'],
  };
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    return Response.json({
      model: request.model,
      usage: { cost: 0.0001 },
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => {
          const choice = id.endsWith('_role') ? 'competitor' : criteriaChoice(id, question);
          return [id, { type: 'choice', choice, probabilities: oneHot(question, choice) }];
        }),
      ),
    });
  };
  const enqueue = () => worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
  try {
    assert.equal((await enqueue()).enqueued, 1);
    await worker.processBrandResearchJobs();
    const job = sqlite.prepare('SELECT input_json,result_json FROM brand_research_jobs').get();
    const input = JSON.parse(job.input_json);
    // Every monitored brand it names (eight, not the first six) and every listed discovery it names, a client and a name in
    // review included; never a name that is no brand nor a rejected one.
    assert.deepEqual(input.options.map((option) => option.name), ['Acme', ...monitored, 'Orbit', 'Lume']);
    assert.equal(input.everyBrand, true);
    assert.equal((await enqueue()).enqueued, 0, 'held for every brand: nothing is read again');
    // The same answer as a reading of the shorter list left it: the own brand and the next five, no marker.
    const short = input.options.filter((option) => option.kind === 'tracked' && Number(option.id.slice(1)) < 6);
    const { everyBrand: _marker, ...earlier } = input;
    sqlite
      .prepare("UPDATE brand_research_jobs SET input_key='shorter',input_json=?,result_json=?")
      .run(JSON.stringify({ ...earlier, options: short }), JSON.stringify(JSON.parse(job.result_json).filter((reading) => short.some((option) => option.id === reading.id))));
    assert.equal((await enqueue()).enqueued, 0, 'a reading of the shorter list still holds its answer');
    const estimate = await worker.unevaluatedResearch('project', 'owner', 'jev', 0);
    assert.deepEqual([estimate.count, estimate.legacy, estimate.legacyBrands], [0, 1, 10], 'what a reprocess would read: one answer, ten brands');
    sqlite.prepare("INSERT INTO system_state(key,value) VALUES('sentiment-reprocess:project',?)").run(JSON.stringify({ rubric: 'brand-criteria-v1', brands: 'every', requestedAt: '2026-10-31T00:00:00.000Z' }));
    // While the analysis reads the answers again, their discoveries are not known: nothing is read, the answer waits.
    globalThis.researchFixture.analysisStatus = 'running';
    const waiting = await worker.unevaluatedResearch('project', 'owner', 'jev', 10);
    assert.deepEqual([waiting.count, waiting.runs.length, waiting.waiting], [0, 0, true]);
    globalThis.researchFixture.analysisStatus = 'complete';
    assert.equal((await enqueue()).enqueued, 1, 'a reprocess for every brand reads it again');
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
  }
});
test('a reprocess of recent days reads those days again under the current rule, once, and the newer reading shows', async () => {
  const { sqlite, run } = database(),
    originalFetch = globalThis.fetch;
  globalThis.researchFixture = {
    db: d1(sqlite),
    discoverySuggestions: [],
    settings: { OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' },
  };
  // A second question answered 20 days ago: outside the 7 days, inside 30.
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
  sqlite.prepare("INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES('prompt2','question2','project','Which tool is cheapest?','chat_gpt',?,?)").run(old, old);
  run('old-run', 'Acme is cheap. Orbit is an option.', old, 'prompt2');
  let met = ['recommended'];
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    sent.push(request);
    return Response.json({
      model: request.model,
      usage: { cost: 0.0001 },
      answers: Object.fromEntries(Object.keys(request.questions).map((id) => {
        const choice = id.endsWith('_role') ? 'competitor' : criteriaChoice(id, request.questions[id], met);
        return [id, { type: 'choice', choice, probabilities: oneHot(request.questions[id], choice) }];
      })),
    });
  };
  const evaluate = async () => {
    await worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
    await worker.processBrandResearchJobs();
  };
  const acme = async () => (await worker.brandResearchReport('project', 'owner', new URLSearchParams())).details.filter((detail) => detail.brand === 'Acme').map((detail) => [detail.runId, detail.score]).sort();
  try {
    await evaluate();
    assert.equal(sent.length, 2);
    assert.deepEqual(await acme(), [['old-run', 70], ['run', 70]]);
    let pending = await worker.unevaluatedResearch('project', 'owner', 'jev', 0);
    assert.deepEqual([pending.count, pending.legacy], [0, 0], 'readings of the current rule hold their answers');
    // The estimate of the last 7 days: the recent answer would be read again, the 20-day-old one would not; 30 days, both.
    pending = await worker.unevaluatedResearch('project', 'owner', 'jev', 0, { rereadDays: 7 });
    assert.deepEqual([pending.count, pending.legacy], [0, 1]);
    pending = await worker.unevaluatedResearch('project', 'owner', 'jev', 0, { rereadDays: 30 });
    assert.deepEqual([pending.count, pending.legacy], [0, 2]);
    // A user's query never widens what is read again: `reread` in the report's or the evaluation's query changes nothing.
    const calls = sent.length;
    assert.equal((await worker.enqueueBrandResearch('project', 'owner', new URLSearchParams({ reread: '90' }), 'jev')).enqueued, 0);
    await worker.processBrandResearchJobs();
    assert.equal(sent.length, calls, 'nothing is read again from a query');
    assert.deepEqual(await acme(), [['old-run', 70], ['run', 70]]);
    const queried = await worker.brandResearchReport('project', 'owner', new URLSearchParams({ reread: '90' }));
    assert.equal(queried.details.filter((detail) => detail.brand === 'Acme' && detail.score === 70).length, 2);
    // The admin's request for 7 days: only the recent answer is read again, once, and its newer reading shows.
    sqlite.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').run('sentiment-reprocess:project', JSON.stringify({ rubric: 'brand-criteria-v1', brands: 'every', requestedAt: new Date().toISOString(), days: 7 }));
    pending = await worker.unevaluatedResearch('project', 'owner', 'jev', 0);
    assert.deepEqual([pending.count, pending.legacy], [1, 1]);
    met = ['recommended', 'leader'];
    await evaluate();
    assert.equal(sent.length, 3, 'one more call: the recent answer');
    assert.deepEqual(await acme(), [['old-run', 70], ['run', 85]]);
    pending = await worker.unevaluatedResearch('project', 'owner', 'jev', 0);
    assert.deepEqual([pending.count, pending.legacy], [0, 0], 'read once: the new reading holds it');
    await evaluate();
    assert.equal(sent.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});

test('decision roots: a known name skips its identity question, a list-only brand and windows read before cost no call', async () => {
  const { sqlite, run } = database(),
    originalFetch = globalThis.fetch;
  globalThis.researchFixture = {
    db: d1(sqlite),
    discoverySuggestions: [],
    settings: { OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' },
  };
  // The store measured the project's common words: Acme is none of them.
  sqlite.exec(`INSERT INTO store_meta VALUES('mention_common','{"pass":{"names":[]}}')`);
  const stamp = new Date().toISOString();
  for (const id of ['p2', 'p3', 'p4'])
    sqlite.prepare("INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES(?,?,'project','Which software works best?','chat_gpt',?,?)").run(id, `u-${id}`, stamp, stamp);
  const filler = 'Teams compare plans, onboarding and support before they choose. '.repeat(12);
  run('listed', 'Tools people use:\n\n- Acme\n- Zeta Works', stamp, 'p2');
  run('long-1', `Acme is the best choice for small teams.\n\n${filler}\n\nFirst ending.`, stamp, 'p3');
  run('long-2', `Acme is the best choice for small teams.\n\n${filler}\n\nSecond ending.`, stamp, 'p4');
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    sent.push(request);
    return Response.json({
      model: request.model,
      usage: { cost: 0.0001 },
      answers: Object.fromEntries(Object.keys(request.questions).map((id) => {
        const choice = criteriaChoice(id, request.questions[id], PROMOTER);
        return [id, { type: 'choice', choice, probabilities: oneHot(request.questions[id], choice) }];
      })),
    });
  };
  try {
    await worker.enqueueBrandResearch('project', 'owner', new URLSearchParams(), 'jev');
    for (let round = 0; round < 3; round++) await worker.processBrandResearchJobs();
    const jobs = sqlite.prepare("SELECT status,calls FROM brand_research_jobs WHERE context_key NOT LIKE 'brand-roles:%' ORDER BY requested_at").all();
    assert.equal(jobs.length, 4);
    assert.ok(jobs.every((job) => job.status === 'completed'));
    // The first answer and one of the two long ones are read; the list and the long answer with the same windows are not.
    assert.equal(sent.length, 2);
    for (const request of sent) {
      assert.ok(!Object.hasOwn(request.questions, 'b0'), 'Acme is no common word: no identity question');
      assert.ok(Object.hasOwn(request.questions, 'b0_recommended'));
      assert.equal(request.state.identities.some((identity) => 'known' in identity || 'settled' in identity), false, 'the state is what the model read before');
    }
    assert.equal(jobs.filter((job) => job.calls === 0).length, 2);
    const report = await worker.brandResearchReport('project', 'owner', new URLSearchParams());
    const scores = Object.fromEntries(report.details.filter((detail) => detail.brand === 'Acme').map((detail) => [detail.runId, detail.score]));
    assert.deepEqual(scores, { run: 85, listed: 50, 'long-1': 85, 'long-2': 85 });
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM sentiment_window_readings').get().n, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.researchFixture;
    sqlite.close();
  }
});
