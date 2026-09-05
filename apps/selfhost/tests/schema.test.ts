import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const baseline = readFileSync(new URL('../drizzle/0014_independent_baseline.sql', import.meta.url), 'utf8');
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
