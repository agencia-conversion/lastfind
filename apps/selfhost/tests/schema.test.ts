import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
const baseline = readFileSync(new URL('../drizzle/0014_independent_baseline.sql', import.meta.url), 'utf8');
const variants = readFileSync(new URL('../drizzle/0015_dashboard_brand_variants.sql', import.meta.url), 'utf8');
const semantic = readFileSync(new URL('../drizzle/0017_semantic_evaluations.sql', import.meta.url), 'utf8');
void test('a new personal database contains only product control storage and publication triggers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(baseline);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name), ['accounts','job_leases','project_store_outbox','project_stores','projects','prompts','runs','system_state','topics']);
    assert.deepEqual(db.prepare('PRAGMA table_info(accounts)').all().map(row=>row.name), ['id','email','name','created_at']);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get()?.n,7);
  } finally {db.close();}
});
void test('the closed selfhost migration sequence includes brand variants without rewriting projects', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(baseline);
    db.exec("INSERT INTO accounts VALUES('owner','owner@test','Owner','2026-09-01'); INSERT INTO projects(id,owner_id,name,domain,created_at) VALUES('p','owner','Brand','brand.test','2026-09-01')");
    db.exec(variants);
    const project = db.prepare('SELECT aliases_json,additional_domains_json FROM projects WHERE id=?').get('p');
    assert.equal(project?.aliases_json, '[]');
    assert.equal(project?.additional_domains_json, '[]');
  } finally { db.close(); }
});
void test('semantic ledger migration is append-only and publishes assessments for backup', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(baseline);
    db.exec(semantic);
    db.exec("INSERT INTO accounts VALUES('owner','owner@test','Owner','2026-09-01'); INSERT INTO projects(id,owner_id,name,domain,created_at) VALUES('p','owner','Brand','brand.test','2026-09-01'); INSERT INTO prompts(id,project_id,text,engine,created_at) VALUES('q','p','Which brand?','chat_gpt','2026-09-01')");
    db.exec("INSERT INTO runs(id,owner_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,callback_token,created_at) VALUES('r','owner','p','q','daily','Which brand?','chat_gpt','[]',2840,'en','fixture','2026-09-01')");
    db.prepare(`INSERT INTO semantic_evaluations(id,owner_id,project_id,run_id,config_revision,assessment_json,answer_sha256,rubric,model,coverage,cost_usd,created_at)
      VALUES('e','owner','p','r',1,'{}',?,'association-v1','fixture','full',0.002,'2026-09-01')`).run('a'.repeat(64));
    assert.equal(db.prepare("SELECT entity FROM project_store_outbox WHERE entity='semantic_evaluations'").get()?.entity,'semantic_evaluations');
    assert.throws(() => db.exec("INSERT INTO semantic_evaluations(id,owner_id,project_id,run_id,config_revision,assessment_json,answer_sha256,rubric,model,coverage,cost_usd,created_at) VALUES('other','owner','p','r',1,'{}','hash','association-v1','fixture','full',0,'2026-09-01')"));
  } finally { db.close(); }
});
void test('reapplying the current schema preserves identities, data, storage generation and private extensions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    db.exec(baseline);
    db.exec(`INSERT INTO accounts VALUES('owner:local','owner@example.test','Owner','2026-09-05');
      INSERT INTO projects(id,owner_id,name,domain,created_at) VALUES('p','owner:local','Preserved','example.test','2026-09-05');
      INSERT INTO prompts(id,project_id,text,engine,created_at) VALUES('q','p','Preserved prompt','chat_gpt','2026-09-05');
      CREATE TABLE operator_notes(id TEXT PRIMARY KEY,note TEXT); INSERT INTO operator_notes VALUES('n','Preserved private extension');`);
    const project = db.prepare('SELECT * FROM projects').all();
    const store = db.prepare('SELECT * FROM project_stores').all();
    db.exec(baseline);
    assert.deepEqual(db.prepare('SELECT * FROM projects').all(),project);
    assert.deepEqual(db.prepare('SELECT * FROM project_stores').all(),store);
    assert.equal(db.prepare('SELECT text FROM prompts').get()?.text,'Preserved prompt');
    assert.equal(db.prepare('SELECT note FROM operator_notes').get()?.note,'Preserved private extension');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});
void test('the AI apps migration is the same SQL as Cloud, applies to the whole sequence and keeps its rows when reapplied', () => {
  const dir = new URL('../drizzle/', import.meta.url);
  const access = readFileSync(new URL('0046_mcp_access.sql', dir), 'utf8');
  const cloud = new URL('../../cloud/drizzle/0048_mcp_access.sql', import.meta.url);
  // The public snapshot has no Cloud edition to compare with.
  if (existsSync(cloud)) assert.equal(access, readFileSync(cloud, 'utf8'));
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(name, dir), 'utf8'));
    db.exec(`INSERT INTO accounts(id,email,name,created_at) VALUES('owner:local','owner@example.test','Owner','2026-10-29');
      INSERT INTO api_credentials(id,account_id,kind,name,scope,resource,hint,expires_at,created_at) VALUES('c','owner:local','pat','CI','lastfind:read','http://localhost/mcp','abcd','2027-01-01','2026-10-29');
      INSERT INTO api_tokens VALUES('hash','c','2027-01-01');`);
    assert.throws(() => db.exec("INSERT INTO api_credentials(id,account_id,kind,name,scope,resource,expires_at,created_at) VALUES('o','owner:local','oauth','App','lastfind:read','r','2027-01-01','2026-10-29')"), /CHECK/);
    assert.throws(() => db.exec("INSERT INTO api_credentials(id,account_id,kind,name,scope,resource,expires_at,created_at) VALUES('w','owner:local','pat','x','lastfind:write','r','2027-01-01','2026-10-29')"), /CHECK/);
    db.exec(access);
    assert.equal(db.prepare('SELECT name FROM api_credentials').get()?.name, 'CI');
    db.exec("DELETE FROM api_credentials WHERE id='c'");
    assert.equal(db.prepare('SELECT COUNT(*) n FROM api_tokens').get()?.n, 0, 'tokens go with their credential');
  } finally { db.close(); }
});
