import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { sourceKey } from '../lib/server/source-sql.ts';

test('a cited source without a domain takes the host of its URL, never NULL', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE runs(id TEXT, sources_json TEXT)');
  const sources = [
    { url: 'https://www.Example.com/a', domain: 'example.com' },
    { url: 'https://WWW.Missing.test:8443/path?q=1#top', title: 'no domain' },
    { url: 'https://other.test?x=1', domain: '' },
    { url: 'not a web address', domain: null },
    { title: 'no url, no domain' },
  ];
  db.prepare('INSERT INTO runs VALUES(?,?)').run('r1', JSON.stringify(sources));
  const rows = db
    .prepare(`SELECT ${sourceKey('s', 'domain')} key FROM runs r,json_each(r.sources_json) s`)
    .all()
    .map((row) => row.key);
  assert.deepEqual(rows, ['example.com', 'missing.test', 'other.test', '', '']);
  // The project store only runs read queries that avoid these keywords (worker/project-store.ts).
  assert.doesNotMatch(sourceKey('s', 'domain'), /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|REPLACE|TRIGGER)\b/i);
  // Page grouping stays on the URL itself.
  assert.match(sourceKey('s', 'url'), /\$\.url/);
});
