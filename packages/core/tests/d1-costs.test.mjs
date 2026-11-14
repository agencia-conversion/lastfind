// D1 bills the rows a statement reads. The scheduler's reads that read a project's whole history on every tick (11/11/2026,
// docs/costs.md) are counted here on each edition's real schema (its migrations, in the SQLite of Cloudflare's current runtime,
// whose `rowsRead` is the meter D1 bills), on a project with a few months of rows: the statement the code sends reads a small
// part of what it read before, and returns the same rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare-production';

const root = fileURLToPath(new URL('../../../', import.meta.url));

// A Durable Object that runs SQL on its own SQLite and says how many rows each statement read.
const PROBE = `import { DurableObject } from 'cloudflare:workers';
export class Probe extends DurableObject {
  async fetch(request) {
    const { script, statements } = await request.json();
    const sql = this.ctx.storage.sql;
    if (script) for (const text of script) sql.exec(text);
    return Response.json((statements ?? []).map(([text, ...params]) => {
      const cursor = sql.exec(text, ...params);
      const rows = cursor.toArray();
      return { rows, read: cursor.rowsRead };
    }));
  }
}
export default { fetch() { return new Response(null, { status: 404 }); } };`;

async function database(edition) {
  const directory = await mkdtemp(resolve(tmpdir(), 'lastfind-d1-costs-'));
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: 'lastfind-d1-costs',
      modules: true,
      script: PROBE,
      compatibilityDate: '2026-05-22',
      durableObjects: { PROBE: { className: 'Probe', useSQLite: true } },
      resourcePersistencePath: directory,
      unsafeDevRegistryPath: resolve(directory, 'registry'),
      telemetry: { enabled: false },
      logRequests: false,
    }),
  );
  const namespace = await runtime.getDurableObjectNamespace('PROBE');
  const stub = namespace.get(namespace.idFromName(edition));
  const send = async (body) => {
    const response = await stub.fetch('https://probe/', { method: 'POST', body: JSON.stringify(body) });
    if (response.status !== 200) throw new Error(await response.text());
    return response.json();
  };
  // The edition's schema, a migration at a time, without the PRAGMAs of the earliest ones: the probe enforces no foreign key,
  // so the fixture needs no accounts or projects.
  const folder = `${root}apps/${edition}/drizzle/`;
  const script = readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(folder + name, 'utf8').replace(/^PRAGMA[^\n]*$/gim, ''));
  const close = async () => {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await send({ script: ['PRAGMA foreign_keys=OFF', ...script] });
  } catch (error) {
    await close();
    throw error;
  }
  return {
    run: async (statements) => send({ statements }),
    exec: async (...script) => send({ script }),
    close,
  };
}

/** `text` is what the source file sends (a changed statement fails here and is measured again). */
const sent = (file, text) => assert.ok(readFileSync(root + file, 'utf8').replace(/\s+/g, ' ').includes(text.replace(/\s+/g, ' ')), `${file} still sends: ${text}`);

// Rows `n` of a recursive count, for the seeds below.
const numbers = (n) => `WITH RECURSIVE k(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM k WHERE i<${n - 1})`;

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(`${root}apps/${name}/drizzle`))) {
  test(`${edition}: the reads a tick repeats for every project read the rows they need, not the project's history`, async () => {
    const db = await database(edition);
    try {
      // Six months of a daily project: 120 runs a day with their slot key, Semantic Branding rounds of 12 queries, and
      // 3,000 role jobs of which a handful are open; another project beside it.
      await db.exec(
        `${numbers(21600)} INSERT INTO runs(id,workspace_id,project_id,prompt_id,prompt_text,engine,targets_json,location_code,language_code,callback_token,status,request_key,created_at,cost,budget_credits)
          SELECT 'run-'||i,'owner',CASE WHEN i%9=0 THEN 'other' ELSE 'project' END,'prompt-'||(i%120),'Question','chat_gpt','[]',2840,'en','token-'||i,'complete',
          'slot:'||date('2026-05-01','+'||(i/120)||' days'),strftime('%Y-%m-%dT%H:%M:%fZ','2026-05-01','+'||(i/120)||' days'),0.0012,1 FROM k`,
        `${numbers(180)} INSERT INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at)
          SELECT 'round-'||i,'owner','project',date('2026-05-01','+'||i||' days'),'daily',date('2026-05-01','+'||i||' days'),1,'en',2840,'[]','done','2026-05-01' FROM k`,
        `${numbers(2160)} INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,requested_at,sources_json)
          SELECT 'query-'||i,'round-'||(i/12),'owner','project','engine-'||(i%6),CASE WHEN i%12<6 THEN 'scrape' ELSE 'llm' END,'model','Q',
          CASE WHEN i%10=0 THEN 'failed' ELSE 'completed' END,0.02,date('2026-05-01','+'||(i/12)||' days'),'[{"url":"https://example.test/'||i||'"}]' FROM k`,
        `${numbers(3000)} INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,cost_usd,input_json,requested_at)
          SELECT 'job-'||i,'owner','project','input-'||i,'brand-roles:v1','sha','openrouter','model',
          CASE WHEN i%500=0 THEN 'pending' WHEN i%400=0 THEN 'unknown' WHEN i%7=0 THEN 'failed' ELSE 'completed' END,0.02,
          CASE WHEN i%14=0 THEN 0.01 ELSE 0 END,'{"n":'||i||'}',date('2026-05-01','+'||(i/20)||' days') FROM k`,
      );
      const compare = async (name, before, after, setup = {}) => {
        if (setup.drop) await db.exec(setup.drop);
        const [old] = await db.run([before]);
        if (setup.create) await db.exec(setup.create);
        const [now] = await db.run([after]);
        assert.deepEqual(now.rows, old.rows, `${name}: the same rows`);
        assert.ok(now.rows.length > 0, `${name}: the fixture has rows to find`);
        assert.ok(now.read * (setup.factor ?? 10) < old.read, `${name}: ${now.read} rows read, ${old.read} before`);
        if (process.env.METER_DETAIL) console.log(`${edition} ${name}: ${old.read} -> ${now.read} rows read`);
        return [old.read, now.read];
      };

      // A reservation's runs of its slot (monitor.ts): every run the project had, then the slot's.
      const slot = `SELECT id FROM runs WHERE workspace_id=? AND project_id=? AND request_key=?`;
      sent('packages/core/lib/server/monitor.ts', 'FROM runs WHERE workspace_id=? AND project_id=? AND request_key=?');
      await compare('runs of a slot', [`${slot} ORDER BY id`, 'owner', 'project', 'slot:2026-09-01'], [`${slot} ORDER BY id`, 'owner', 'project', 'slot:2026-09-01'], {
        drop: 'DROP INDEX idx_runs_project_request',
        create: 'CREATE INDEX IF NOT EXISTS idx_runs_project_request ON runs(project_id,request_key)',
      });

      // The Semantic Branding sources of the first screens (semantic-source-rows.ts), 28 days of rounds.
      const semantic = `SELECT q.id,r.day,q.engine,q.sources_json,r.roster_json,
      (SELECT AVG(score) FROM semantic_panel_readings n WHERE n.query_id=q.id) score
    FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id
    WHERE q.project_id=? AND q.workspace_id=? AND r.project_id=q.project_id AND r.workspace_id=q.workspace_id
      AND r.day>=? AND r.day<=? AND q.status='completed' AND q.method='scrape'`;
      sent('packages/core/lib/server/semantic-source-rows.ts', semantic);
      const period = ['project', 'owner', '2026-09-01', '2026-09-28'];
      await compare('Semantic Branding sources', [`${semantic} ORDER BY r.day,q.id`, ...period], [`${semantic} ORDER BY r.day,q.id`, ...period], {
        drop: 'DROP INDEX idx_semantic_panel_queries_round',
        create: 'CREATE INDEX IF NOT EXISTS idx_semantic_panel_queries_round ON semantic_panel_queries(round_id,status,method)',
      });

      // The open and possibly billed jobs of a kind (roles, mention checks, search intents): an OR the index could not serve.
      const open = "SELECT input_json FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND context_key=? AND status IN ('pending','submitting','unknown','failed') AND (status<>'failed' OR cost_usd>0)";
      sent('packages/core/lib/server/brand-role-jobs.ts', open);
      sent('packages/core/lib/server/fanout-intents.ts', open);
      sent('packages/core/lib/server/brand-mention-checks.ts', "status IN ('pending','submitting','unknown','failed') AND (status<>'failed' OR cost_usd>0)");
      const before = "SELECT input_json FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND context_key=? AND (status IN ('pending','submitting','unknown') OR (status='failed' AND cost_usd>0))";
      // The open and failed jobs instead of every job of the kind (a seventh of the fixture's jobs failed, more than usual).
      await compare('open jobs of a kind', [`${before} ORDER BY input_json`, 'project', 'owner', 'brand-roles:v1'], [`${open} ORDER BY input_json`, 'project', 'owner', 'brand-roles:v1'], { factor: 4 });
    } finally {
      await db.close();
    }
  });
}
