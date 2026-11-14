import test from 'node:test';
import assert from 'node:assert/strict';
// The app's addresses are tested in app-routes.test.ts; this covers the prompts' slugs.
import { slugify } from '../components/analytics/routes.ts';
import { createDemoSession } from '../components/analytics/workspace-data.ts';

await test('slugs normalize accents and punctuation and remain bounded', () => {
  assert.equal(slugify('  Agência São Paulo & Co.  '), 'agencia-sao-paulo-co');
  assert.equal(slugify('***'), 'untitled');
  assert.equal(slugify('a'.repeat(140)).length, 72);
  const session = createDemoSession();
  assert.equal(
    new Set(session.workspaces.map((workspace) => workspace.slug)).size,
    session.workspaces.length,
  );
  for (const workspace of session.workspaces) {
    assert.equal(
      new Set(workspace.projects.map((project) => project.slug)).size,
      workspace.projects.length,
    );
  }
});
