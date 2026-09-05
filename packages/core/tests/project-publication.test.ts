import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

await test('native migrations create publication triggers once; polling and no-op updates do not publish', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys=ON');
    const directory = new URL(
      '../../../apps/selfhost/drizzle/',
      import.meta.url,
    );
    for (const file of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort())
      database.exec(readFileSync(new URL(file, directory), 'utf8'));
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND (name LIKE 'project_publication_%' OR name='project_storage_project_insert')",
        )
        .get()?.n,
      7,
    );
    database.exec(`
      INSERT INTO accounts(id,email,name,created_at) VALUES('a','a@example.test','A','2026-09-05'),('b','b@example.test','B','2026-09-05');
      INSERT INTO projects(id,owner_id,name,domain,created_at) VALUES('p','a','A','a.test','2026-09-05'),('other','b','B','b.test','2026-09-05');
      INSERT INTO prompts(id,project_id,text,engine,created_at) VALUES('prompt','p','Question','chat_gpt','2026-09-05');
      INSERT INTO runs(id,owner_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,callback_token,status,created_at)
      VALUES('run','a','p','prompt','daily','Question','chat_gpt','[]',2840,'en','fixture','pending','2026-09-05');
    `);
    const revision = () =>
      database
        .prepare(
          "SELECT source_revision n FROM project_stores WHERE project_id='p'",
        )
        .get()?.n;
    const publication = () =>
      database
        .prepare(
          "SELECT revision,operation,data_json FROM project_store_outbox WHERE project_id='p' AND entity='runs' AND entity_id='run'",
        )
        .get()!;
    assert.equal(revision(), 2);
    assert.equal(
      database
        .prepare(
          "SELECT source_revision FROM project_stores WHERE project_id='other'",
        )
        .get()?.source_revision,
      0,
    );
    database.exec(
      "UPDATE runs SET polled_at='2026-09-05T08:00:00Z',poll_attempts=1,next_poll_at='2026-09-05T08:05:00Z' WHERE id='run'; UPDATE runs SET cost=cost,status=status WHERE id='run'",
    );
    assert.equal(
      revision(),
      2,
      'Polling metadata and unchanged report fields must not create analytical writes',
    );

    // The collection transaction stages normalized evidence before its terminal
    // control update. The trigger must merge into that payload, preserving null.
    database.exec('BEGIN IMMEDIATE');
    database
      .prepare(
        "UPDATE project_store_outbox SET data_json=json_set(data_json,'$.answer',?,'$.consulted_sources_json',NULL,'$.mentions_json',?) WHERE project_id='p' AND entity='runs' AND entity_id='run'",
      )
      .run('Olá — 東京', '{"A":true}');
    database.exec(
      "UPDATE runs SET status='complete',cost=0.0012,error=NULL,completed_at='2026-09-05T08:01:00Z' WHERE id='run'; COMMIT",
    );
    const payload = JSON.parse(String(publication().data_json));
    assert.equal(payload.answer, 'Olá — 東京');
    assert.equal(payload.consulted_sources_json, null);
    assert.equal(payload.status, 'complete');
    assert.equal(payload.cost, 0.0012);
    assert.equal(revision(), 3);
    assert.ok(
      !database
        .prepare('PRAGMA table_info(runs)')
        .all()
        .some((row) => row.name === 'answer'),
    );

    const publishedRevision = publication().revision;
    database.exec(
      "UPDATE runs SET raw_response_status='failed',raw_response_error='write_failed' WHERE id='run'",
    );
    database
      .prepare(
        "DELETE FROM project_store_outbox WHERE project_id='p' AND entity='runs' AND entity_id='run' AND revision=?",
      )
      .run(publishedRevision);
    assert.equal(
      JSON.parse(String(publication().data_json)).answer,
      'Olá — 東京',
      'An acknowledgement cannot discard a newer unacknowledged publication',
    );
    database.exec("DELETE FROM runs WHERE id='run'");
    assert.equal(publication().operation, 'delete');
    assert.equal(publication().data_json, null);
    assert.equal(revision(), 5);
  } finally {
    database.close();
  }
});
