import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(join(root, `apps/${name}/drizzle`)))) {
  void test(`table_column_preferences migration applies (${edition})`, () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys=ON');
    const dir = join(root, `apps/${edition}/drizzle`);
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(join(dir, name), 'utf8'));
    }
    sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('u1','a@b.c','A',?)").run(new Date().toISOString());
    sqlite
      .prepare(
        "INSERT INTO table_column_preferences(user_id,table_key,hidden_json,updated_at) VALUES('u1','brands','[\"sov\"]',?)",
      )
      .run(new Date().toISOString());
    sqlite
      .prepare(
        "INSERT INTO table_column_preferences(user_id,table_key,hidden_json,updated_at) VALUES('u1','brands','[\"visibility\"]',?) ON CONFLICT(user_id,table_key) DO UPDATE SET hidden_json=excluded.hidden_json",
      )
      .run(new Date().toISOString());
    const row = sqlite
      .prepare('SELECT hidden_json FROM table_column_preferences WHERE user_id=? AND table_key=?')
      .get('u1', 'brands');
    assert.equal(row.hidden_json, '["visibility"]');
  });
}

void test('visibleColumns keeps required keys even when hidden', () => {
  // Mirrors hooks/use-table-columns.ts — keep in sync.
  const visibleColumns = (columns, hidden, required = []) => {
    const locked = new Set(required);
    return columns.filter((column) => locked.has(column.key) || !hidden.includes(column.key));
  };
  const columns = [{ key: 'brand' }, { key: 'sov' }, { key: 'actions' }];
  assert.deepEqual(
    visibleColumns(columns, ['brand', 'sov'], ['brand', 'actions']).map((column) => column.key),
    ['brand', 'actions'],
  );
});

void test('brand table column sortValues cover every optional metric', () => {
  const source = readFileSync(join(root, 'packages/core/components/analytics/brands-screen.tsx'), 'utf8');
  for (const key of ['brand', 'sentiment', 'visibility', 'sov', 'mentions']) {
    assert.match(source, new RegExp(`key: '${key}'[\\s\\S]*?sortValue:`), `${key} must be sortable`);
  }
  // The menu column has an accessible name; Monitor is a small action in the brand column.
  assert.match(source, /key: 'actions',[\s\S]*?header: <span className="sr-only">\{t\('Actions'/);
  assert.match(source, /Monitor brand/);
  assert.match(source, /ConfirmDialog/);
  assert.match(source, /You can undo right after/);
  assert.doesNotMatch(source, /Undo2/);
  assert.doesNotMatch(source, /from the toast|no toast/);
});

void test('prompts/models/sources/responses use account column prefs', () => {
  const live = readFileSync(join(root, 'packages/core/components/analytics/live-app.tsx'), 'utf8');
  for (const key of ["'prompts'", "'models'", "'responses'"]) {
    assert.match(live, new RegExp(`useTableColumns\\(${key}`), `${key} needs useTableColumns`);
  }
  assert.match(live, /sources-url/);
  assert.match(live, /sources-domain/);
  assert.match(live, /useTableColumns\(/);
  assert.match(live, /ColumnPicker/);
  assert.doesNotMatch(live, /visiblePromptColumns/);
  assert.doesNotMatch(live, /CollectionToolbar/);
});

void test('one read of the saved tables per page, not one per table', () => {
  const hook = readFileSync(join(root, 'packages/core/hooks/use-table-columns.ts'), 'utf8');
  assert.match(hook, /saved \?\?= requestJson<\{ tables: Record<string, string\[\]> \}>\('\/api\/preferences\/table-columns'\)/);
  assert.doesNotMatch(hook, /table-columns\?table=/, 'no read per table');
  const route = readFileSync(join(root, 'packages/core/app/api/preferences/table-columns/route.ts'), 'utf8');
  assert.match(route, /if \(table === null\) return json\(await readAllHiddenColumns\(user\.id\)\);/);
  const server = readFileSync(join(root, 'packages/core/lib/server/table-column-preferences.ts'), 'utf8');
  assert.match(server, /SELECT table_key,hidden_json FROM table_column_preferences WHERE user_id=\?/);
});
