// The scheduler's and the pages' hottest D1 reads stay index reads. D1 runs one statement at a time per database: a read that
// fetches every job row of a project (about 7 KB each) held it for half a second, and a tick's burst of them made D1 refuse with
// "overloaded". Each statement is read from its source file (a changed statement fails here and is planned again) and planned on
// an empty database built from the edition's migrations; the planner picks the same index with or without rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const READS = [
  ['packages/core/lib/server/source-types.ts', "SELECT COUNT(*) n FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND context_key LIKE ? AND status IN ('pending','submitting')", 'COVERING INDEX idx_brand_research_open'],
  ['packages/core/lib/server/brand-role-jobs.ts', "SELECT input_json FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND context_key LIKE ? AND status IN ('pending','submitting','unknown')", 'INDEX idx_brand_research_open'],
  ['packages/core/lib/server/source-types.ts', 'SELECT COUNT(*) n,MAX(classified_at) latest FROM source_catalog WHERE rubric=?', 'COVERING INDEX idx_source_catalog_revision'],
  ['packages/core/lib/server/brand-roles.ts', 'SELECT brand_key,role,model FROM brand_role_decisions WHERE project_id=? AND model IN (?,?,?,?)', 'COVERING INDEX idx_brand_role_decisions_model'],
  ['packages/core/lib/server/brand-roles.ts', 'SELECT brand_key,role,COUNT(*) n,model IN (?,?) current FROM brand_question_roles WHERE project_id=? AND model IN (?,?,?,?) GROUP BY brand_key,role,current', 'COVERING INDEX idx_brand_question_roles_names'],
];

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(`${root}apps/${name}/drizzle`))) {
  test(`${edition}: the scheduler's hot reads are index reads`, () => {
    const sqlite = new DatabaseSync(':memory:');
    for (const name of readdirSync(`${root}apps/${edition}/drizzle`).filter((file) => file.endsWith('.sql')).sort())
      sqlite.exec(readFileSync(`${root}apps/${edition}/drizzle/${name}`, 'utf8'));
    for (const [file, sql, plan] of READS) {
      assert.ok(readFileSync(root + file, 'utf8').includes(sql), `${file} still sends: ${sql}`);
      const params = Array((sql.match(/\?/g) ?? []).length).fill('x');
      const detail = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail).join('\n');
      assert.match(detail, new RegExp(`SEARCH \\w+ USING ${plan} `), `${sql}\n${detail}`);
    }
  });
}
