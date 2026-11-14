import test from 'node:test';
import assert from 'node:assert/strict';
import { safeAppPath, workspaceCookie, workspaceLinkTarget } from '../lib/workspace-link.ts';

void test('a ?workspace= app link goes through the select route and comes back without the parameter', () => {
  assert.equal(workspaceLinkTarget('/app', { project: 'p1', tab: 'overview' }), null);
  assert.equal(workspaceLinkTarget('/app', { workspace: '' }), null);
  const target = new URL(workspaceLinkTarget('/app', { workspace: 'owner-1', project: 'p1', tab: 'overview', days: '7' })!, 'https://x.test');
  assert.equal(target.pathname, '/api/workspace/select');
  assert.equal(target.searchParams.get('workspace'), 'owner-1');
  assert.equal(target.searchParams.get('next'), '/app?project=p1&tab=overview&days=7');
  assert.equal(new URL(workspaceLinkTarget('/app/acme/settings/members', { workspace: 'o' })!, 'https://x.test').searchParams.get('next'), '/app/acme/settings/members');
});

void test('the select route only returns inside the app and stores only plain ids', () => {
  for (const unsafe of [null, '', '//evil.example/app', 'https://evil.example/app', '/application', '/api/members', '/app\\evil', '/app x'])
    assert.equal(safeAppPath(unsafe), '/app', String(unsafe));
  assert.equal(safeAppPath('/app?project=p&tab=overview'), '/app?project=p&tab=overview');
  assert.equal(safeAppPath('/app/acme/conversion/prompts'), '/app/acme/conversion/prompts');
  assert.equal(workspaceCookie('0b7c-uuid', true), 'lastfind_workspace=0b7c-uuid; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
  assert.equal(workspaceCookie('a;b=c', false), null);
});
