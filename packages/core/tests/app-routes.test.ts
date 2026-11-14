import assert from 'node:assert/strict';
import test from 'node:test';
import { compactAppPath, expandAppPath, freeSlug, projectBySlug, projectPath, slugBase, slugProblem } from '../components/analytics/app-routes.ts';

const long = (entries: [string, string][]) => new URLSearchParams(entries);
const sorted = (params: URLSearchParams | null) => [...(params ?? [])].map(([key, value]) => `${key}=${value}`).sort();
const expand = (address: string, workspaced = true) => {
  const url = new URL(address, 'https://lastfind.test');
  return expandAppPath(url.pathname.split('/').slice(2), url.search, workspaced);
};
const isDefault = ([key, value]: [string, string]) =>
  (key === 'days' && value === '28') || (key === 'group' && value === 'domain') || (key === 'listPage' && value === '1') || (key === 'listScroll' && value === '0');

test('every screen has an address under its workspace and project, and reading it back gives the same state', () => {
  const cases: [[string, string][], string][] = [
    [[['project', 'p1'], ['tab', 'overview'], ['days', '28'], ['group', 'domain']], '/app/acme/conversion'],
    [[['project', 'p1'], ['tab', 'competitors'], ['brandPage', 'hedgehog digital'], ['days', '7'], ['topic', 'Agência de SEO'], ['topic', 'GEO']], '/app/acme/conversion/brands/hedgehog-digital?period=7d&topic=Ag%C3%AAncia+de+SEO&topic=GEO'],
    [[['project', 'p1'], ['tab', 'prompts'], ['prompt', 'abc-123-best-seo-agency'], ['listPage', '1'], ['listScroll', '0']], '/app/acme/conversion/prompts/abc-123-best-seo-agency'],
    [[['project', 'p1'], ['tab', 'sources'], ['entity', 'domain'], ['key', 'hubspot.com'], ['kind', 'cited']], '/app/acme/conversion/sources/hubspot.com?kind=cited'],
    [[['project', 'p1'], ['tab', 'sources'], ['entity', 'url'], ['key', 'https://hubspot.com/a?b=1']], '/app/acme/conversion/sources?url=https%3A%2F%2Fhubspot.com%2Fa%3Fb%3D1'],
    [[['project', 'p1'], ['tab', 'responses'], ['run', 'r-9'], ['engine', 'chat_gpt,google_ai_mode'], ['query', 'seo']], '/app/acme/conversion/responses/r-9?model=chatgpt%2Cai-mode&q=seo'],
    [[['project', 'p1'], ['tab', 'settings'], ['section', 'workspace']], '/app/acme/conversion/settings/brand'],
    [[['project', 'p1'], ['tab', 'settings'], ['section', 'monitoring']], '/app/acme/conversion/settings/monitoring'],
    [[['project', 'p1'], ['tab', 'models'], ['tags', 'paid,brand'], ['start', '2026-10-01'], ['end', '2026-10-20'], ['compare', 'none']], '/app/acme/conversion/models?tag=paid%2Cbrand&start=2026-10-01&end=2026-10-20&compare=none'],
    [[['project', 'p1'], ['tab', 'competitors'], ['brandPage', 'disney+']], '/app/acme/conversion/brands/disney%2B'],
    [[['project', 'p1'], ['tab', 'products'], ['productDetail', 'apple-ipad-air-11-inch-m3'], ['days', '7']], '/app/acme/conversion/shopping/apple-ipad-air-11-inch-m3?period=7d'],
    [[['project', 'p1'], ['tab', 'products'], ['productDetail', 'brands/disney+']], '/app/acme/conversion/shopping/brands/disney%2B'],
    // Shopping's Brands and Products pages (the overview is /shopping).
    [[['project', 'p1'], ['tab', 'products'], ['productDetail', 'brands']], '/app/acme/conversion/shopping/brands'],
    [[['project', 'p1'], ['tab', 'products'], ['productDetail', 'list'], ['days', '7']], '/app/acme/conversion/shopping/list?period=7d'],
    // Traffic's pages and their drill downs (the overview is /traffic), and its Settings section.
    [[['project', 'p1'], ['tab', 'ai-bots']], '/app/acme/conversion/traffic'],
    [[['project', 'p1'], ['tab', 'ai-bots'], ['aiBotsView', 'bots']], '/app/acme/conversion/traffic/bots'],
    [[['project', 'p1'], ['tab', 'ai-bots'], ['aiBotsView', 'ai?llm=chatgpt'], ['days', '7']], '/app/acme/conversion/traffic/ai?period=7d&llm=chatgpt'],
    [[['project', 'p1'], ['tab', 'ai-bots'], ['aiBotsView', 'bots?bot=gptbot&page=%2Fblog%2Fa']], '/app/acme/conversion/traffic/bots?bot=gptbot&page=%2Fblog%2Fa'],
    [[['project', 'p1'], ['tab', 'settings'], ['section', 'ai-bots']], '/app/acme/conversion/settings/traffic'],
    // Comparison's pages (the overview is /comparison).
    // Comparison's pages (the overview is /comparison) and a product's page.
    [[['project', 'p1'], ['tab', 'comparison'], ['days', '7']], '/app/acme/conversion/comparison?period=7d'],
    [[['project', 'p1'], ['tab', 'comparison'], ['comparisonView', 'attributes']], '/app/acme/conversion/comparison/attributes'],
    [[['project', 'p1'], ['tab', 'comparison'], ['comparisonView', 'personas']], '/app/acme/conversion/comparison/personas'],
    [[['project', 'p1'], ['tab', 'comparison'], ['comparisonView', 'products/seo-consulting']], '/app/acme/conversion/comparison/products/seo-consulting'],
    [[['project', 'p1'], ['tab', 'comparison'], ['comparisonView', 'attributes/price']], '/app/acme/conversion/comparison/attributes/price'],
    [[['project', 'p1'], ['tab', 'comparison'], ['comparisonView', 'personas/small-business-owner']], '/app/acme/conversion/comparison/personas/small-business-owner'],
    // The header's Brands filter travels as written.
    [[['project', 'p1'], ['tab', 'overview'], ['brands', 'monitored,-rock content']], '/app/acme/conversion?brands=monitored%2C-rock+content'],
  ];
  for (const [state, address] of cases) {
    const written = compactAppPath(long(state), 'conversion', 'acme');
    assert.equal(written, address, JSON.stringify(state));
    // The project comes back as its slug, with the workspace's; defaults come back absent (the readers default them).
    const expected = [...state.filter((entry) => !isDefault(entry)).map(([key, value]): [string, string] => [key, key === 'project' ? 'conversion' : value]), ['workspace', 'acme'] as [string, string]];
    assert.deepEqual(sorted(expand(written)), sorted(long(expected)), address);
  }
});

test('workspace pages name no project; Admin names no workspace; the independent edition names no workspace', () => {
  // A workspace's Settings section and My profile: under the workspace, whatever project is open.
  for (const section of ['projects', 'members', 'connections', 'profile']) {
    assert.equal(compactAppPath(long([['project', 'p1'], ['tab', 'settings'], ['section', section]]), 'conversion', 'acme'), `/app/acme/settings/${section}`);
    assert.deepEqual(sorted(expand(`/app/acme/settings/${section}`)), sorted(long([['workspace', 'acme'], ['tab', 'settings'], ['section', section]])));
  }
  // Without a project, a project's section is the workspace's Settings too; another screen is the workspace itself.
  assert.equal(compactAppPath(long([['tab', 'settings'], ['section', 'competitors']]), null, 'acme'), '/app/acme/settings/competitors');
  assert.equal(compactAppPath(long([['tab', 'prompts']]), null, 'acme'), '/app/acme');
  assert.deepEqual(sorted(expand('/app/acme')), ['workspace=acme']);
  assert.deepEqual(sorted(expand('/app/acme/settings')), sorted(long([['workspace', 'acme'], ['tab', 'settings'], ['section', 'projects']])));
  assert.equal(compactAppPath(long([['tab', 'admin'], ['section', 'usage']]), 'conversion', 'acme'), '/app/admin/usage');
  assert.equal(compactAppPath(long([['tab', 'admin'], ['section', 'overview']]), 'conversion', 'acme'), '/app/admin');
  assert.deepEqual(sorted(expand('/app/admin/usage')), sorted(long([['tab', 'admin'], ['section', 'usage']])));
  // The independent edition: the same shapes without the workspace.
  assert.equal(compactAppPath(long([['project', 'p1'], ['tab', 'prompts'], ['prompt', 'u-1']]), 'conversion'), '/app/conversion/prompts/u-1');
  assert.equal(compactAppPath(long([['tab', 'settings'], ['section', 'profile']]), 'conversion'), '/app/settings/profile');
  assert.deepEqual(sorted(expand('/app/conversion/prompts/u-1', false)), sorted(long([['project', 'conversion'], ['tab', 'prompts'], ['prompt', 'u-1']])));
  assert.deepEqual(sorted(expand('/app/settings/profile', false)), sorted(long([['tab', 'settings'], ['section', 'profile']])));
  assert.equal(projectPath('acme', 'conversion'), '/app/acme/conversion');
  assert.equal(projectPath(null, 'conversion', 'responses'), '/app/conversion/responses');
  assert.equal(projectPath('a b', 'c/d'), '/app/a%20b/c%2Fd');
});

test('no older shape opens anything (before 0.1): only the path names the screen', () => {
  assert.equal(expand('/app/acme/conversion/nowhere'), null);
  assert.equal(expand('/app/acme/conversion/brands/a/b'), null);
  assert.equal(expand('/app/acme/conversion/comparison/nowhere'), null);
  assert.equal(expand('/app/acme/conversion/comparison/attributes/price/x'), null);
  assert.equal(expand('/app/acme/conversion/traffic/nowhere'), null);
  assert.equal(expand('/app/acme/conversion/products'), null, 'Products is Shopping now');
  assert.equal(expand('/app/acme/conversion/ai-bots'), null, 'AI bots is Traffic now');
  assert.equal(expand('/app/acme/conversion/overview'), null, 'the Overview has no segment');
  assert.equal(expand('/app/acme/conversion/chats/r1'), null);
  assert.equal(expand('/app/acme/settings/brand/x'), null);
  assert.equal(expand('/app/admin/usage/x'), null);
  // The query never names the screen, the project nor the workspace.
  assert.deepEqual(sorted(expand('/app/acme?tab=prompts&project=p9&workspace=other&section=members')), sorted(long([['workspace', 'acme']])));
  assert.deepEqual(sorted(expand('/app/acme/conversion?tab=prompts&period=7d')), sorted(long([['workspace', 'acme'], ['project', 'conversion'], ['tab', 'overview'], ['days', '7']])));
});

test('slugs: from the name, numbered on a repeat, never random; typed ones checked', () => {
  assert.equal(slugBase('Agência São Paulo & Co.', 'untitled'), 'agencia-sao-paulo-co');
  assert.equal(slugBase('  Maria Silva  ', 'untitled'), 'maria-silva');
  assert.equal(slugBase('***', 'untitled'), 'untitled');
  assert.equal(slugBase('A very long project name that goes on and on and on forever', 'untitled'), 'a-very-long-project-name-that-goes-on-an');
  assert.equal(slugBase('abc '.repeat(20), 'untitled'), 'abc-'.repeat(10).slice(0, -1), 'cut to 40, no trailing hyphen');
  assert.equal(freeSlug('conversion', []), 'conversion');
  assert.equal(freeSlug('conversion', ['conversion']), 'conversion-2');
  assert.equal(freeSlug('conversion', ['conversion', 'conversion-2', 'conversion-3']), 'conversion-4');
  // A reserved word is never a slug: it takes the number a repeat would.
  for (const word of ['admin', 'settings', 'api', 'app', 'new', 'login', 'onboarding', 'connect', 'preview', 'setup']) assert.equal(freeSlug(word, []), `${word}-2`);
  assert.equal(slugProblem('conversion-2'), null);
  for (const bad of ['', 'Conversion', 'a b', '-a', 'a-', 'a--b', 'ação', 'a_b', 'x'.repeat(49)]) assert.equal(slugProblem(bad), 'format', bad);
  assert.equal(slugProblem('x'.repeat(48)), null);
  assert.equal(slugProblem('settings'), 'reserved');
  const projects = [{ id: 'p1', slug: 'conversion' }, { id: 'p2', slug: 'acme' }, { id: 'p3' }];
  assert.equal(projectBySlug(projects, 'acme')?.id, 'p2');
  assert.equal(projectBySlug(projects, 'p1'), undefined, 'an id is not an address');
  assert.equal(projectBySlug(projects, null), undefined);
});
