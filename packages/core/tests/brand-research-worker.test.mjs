import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
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
        const results = statements.map(({ sql, params }) => ({
          meta: { changes: sqlite.prepare(sql).run(...params).changes },
        }));
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
  './workspace': `export async function ownedProject(id,owner){const p=await globalThis.researchFixture.db.prepare('SELECT * FROM projects WHERE id=? AND owner_id=? AND archived=0').bind(id,owner).first();if(!p)throw new Error('Project not found.');return p;}`,
  './project-store-read':
    'export const projectReadDatabase=async()=>globalThis.researchFixture.db;',
  './competitor-analysis': `export const competitorAnalysisStatus=async()=>({status:'complete',needsEnsure:false,suggestions:globalThis.researchFixture.discoverySuggestions??[{name:'Orbit',domain:null}]});`,
  './capabilities': 'export const researchAllProjects=true;',
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
          plugin.onResolve(
            {
              filter:
                /^\.\/(env|http|workspace|project-store-read|competitor-analysis|reports|capabilities)$/,
            },
            (args) => ({ path: args.path, namespace: 'fixture' }),
          );
          plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents:
              args.path === './capabilities'
                ? `export const researchAllProjects=${allProjects};`
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
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(root + 'apps/selfhost/drizzle')
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(root + 'apps/selfhost/drizzle/' + name, 'utf8'));
  // This isolated analytical stand-in retains payload fields removed from control D1.
  sqlite.exec(
    'ALTER TABLE runs ADD COLUMN answer TEXT; ALTER TABLE runs ADD COLUMN response_available INTEGER DEFAULT 1;',
  );
  const stamp = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO accounts(id,email,name,created_at) VALUES('owner','test@example.invalid','Test',?)",
    )
    .run(stamp);
  sqlite
    .prepare(
      "INSERT INTO projects(id,owner_id,name,domain,category,daily_enabled,created_at) VALUES('project','owner','Acme','acme.example','software',0,?)",
    )
    .run(stamp);
  sqlite
    .prepare(
      "INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES('prompt','question','project','Which software works best?','chat_gpt',?,?)",
    )
    .run(stamp, stamp);
  const run = (
    id,
    answer,
    date = stamp,
    prompt = 'prompt',
    engine = 'chat_gpt',
  ) =>
    sqlite
      .prepare(`INSERT INTO runs(id,owner_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,cost,created_at,budget_credits,answer,response_available)
    VALUES(?,'owner','project',?,?,'Which software works best?',?,'[{"name":"Acme","domain":"acme.example"}]',2840,'en','complete','fixture',0,?,0,?,1)`)
      .run(id, prompt, id, engine, date, answer);
  sqlite
    .prepare(
      "INSERT INTO brand_research_configurations(project_id,owner_id,provider,enabled,revision,updated_at) VALUES('project','owner','jev',1,1,?)",
    )
    .run(stamp);
  run('run', 'Acme is excellent. Orbit is an affordable alternative.');
  return { sqlite, run };
}
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
  globalThis.fetch = async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'typesafe/jev-1.14');
    assert.ok(request.questions.b0.criteria['positive:0']);
    // Re-entering the scheduler during the paid request cannot claim the job again.
    assert.equal(await worker.processBrandResearchJobs(), 0);
    const answers = Object.fromEntries(
      Object.entries(request.questions).map(([id, q]) => {
        const labels = Object.keys(q.criteria),
          choice = id.endsWith('_role')
            ? 'competitor'
            : labels.find((label) => label.startsWith('positive:')) ||
              'insufficient';
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
    assert.equal(report.details[0].state, 'absent');
    assert.equal(report.details[0].sentiment, null);
    assert.deepEqual(report.details[0].evidence, []);
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
              : Object.keys(question.criteria).find((choice) =>
                  choice.startsWith('positive:'),
                ) || 'insufficient',
          },
        ]),
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
      "INSERT INTO brand_research_jobs(id,owner_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at) SELECT 'other-provider',owner_id,project_id,'other-provider',context_key,answer_sha256,'decisions','openai/gpt-6-luna-decisions','pending',reserved_usd,input_json,requested_at FROM brand_research_jobs LIMIT 1",
    );
    sqlite.exec(
      "INSERT INTO accounts(id,email,name,created_at) VALUES('other','other@example.invalid','Other','2026-10-15T00:00:00Z'); INSERT INTO projects(id,owner_id,name,domain,archived,created_at) VALUES('foreign','other','Foreign','foreign.example',1,'2026-10-15T00:00:00Z');",
    );
    for (const [id, status] of [
      ['foreign-stale', 'submitting'],
      ['foreign-pending', 'pending'],
    ])
      sqlite
        .prepare(`INSERT INTO brand_research_jobs(id,owner_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at,started_at)
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
test('hybrid evaluation verifies a below-cutoff prose candidate across distinct questions and never approves a publisher', async () => {
  const { sqlite, run } = database(),
    originalFetch = globalThis.fetch;
  globalThis.researchFixture = {
    db: d1(sqlite),
    discoverySuggestions: [],
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
            : Object.keys(question.criteria).find((choice) =>
                choice.startsWith('neutral:'),
              ) || 'insufficient';
          return [id, { type: 'choice', choice }];
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
    assert.ok(orbit.evidence.length > 0);
    const publisher = report.suggestions.find(
      (candidate) => candidate.name === 'ReviewDaily',
    );
    assert.ok(publisher);
    assert.equal(publisher.verifiedPrompts, 0);
    assert.ok(publisher.rejectedPrompts > 0);
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
      { provider: 'jev', enabled: false, revision: 0, updatedAt: null },
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
      /Choose Jev/,
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
    assert.equal(saved.provider, 'decisions');
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
          `INSERT INTO brand_research_jobs(id,owner_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at,started_at,cost_usd) SELECT ?,owner_id,project_id,?,context_key,answer_sha256,provider,model,?,0.02,input_json,requested_at,requested_at,0 FROM brand_research_jobs WHERE id=?`,
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
test('Cloud ignores the `*` wildcard when selecting pending research jobs', async () => {
  const { sqlite } = database(),
    originalFetch = globalThis.fetch;
  const stamp = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO projects(id,owner_id,name,domain,category,daily_enabled,created_at) VALUES('foreign','owner','Other','other.example','software',0,?)",
    )
    .run(stamp);
  sqlite
    .prepare(
      "INSERT INTO brand_research_configurations(project_id,owner_id,provider,enabled,revision,updated_at) VALUES('foreign','owner','jev',1,1,?)",
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
          "INSERT INTO brand_research_jobs(id,project_id,owner_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at) VALUES(?,?,'owner',?,?,'sha','jev','typesafe/jev-1.14','pending',0,'{}',?)",
        )
        .run(id, projectId, id, 'ctx-' + id, requested);
    enqueue('f1', 'foreign', '2020-01-01T00:00:00.000Z');
    enqueue('f2', 'foreign', '2020-01-02T00:00:00.000Z');
    enqueue('p1', 'project', '2020-01-03T00:00:00.000Z');
    const status = (id) =>
      sqlite.prepare('SELECT status FROM brand_research_jobs WHERE id=?').get(id)
        .status;
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
