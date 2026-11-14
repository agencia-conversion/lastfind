import test from 'node:test';
import assert from 'node:assert/strict';
import { isNameFragment, parseRoleResponse, roleRequest, ROLE_ADAPTER_VERSION, ROLE_MAX_CANDIDATES, verdictModel } from '../lib/brand-roles.ts';

const candidates = [
  { key: 'adobe', name: 'Adobe', domain: 'adobe.com', excerpts: ['Clients like Adobe trust the agency.', 'x'.repeat(900), 'third'] },
  { key: 'hotjar', name: 'Hotjar', domain: null, excerpts: [] },
];
const context = { brands: ['Conversion'], category: 'digital marketing agency' };

test('role request: one choice question per candidate, project context, bounded evidence', () => {
  const request = roleRequest('liquid/d1-ultra', context, candidates);
  assert.equal(request.model, 'liquid/d1-ultra');
  assert.deepEqual(Object.keys(request.questions), ['c0', 'c1']);
  assert.deepEqual(Object.keys(request.questions.c0.criteria), ['competitor', 'client', 'supplier', 'partner', 'mention', 'not_brand', 'ambiguous']);
  // The verdict that a name is no brand at all (a title, a person, a heading) is offered in both prompts.
  assert.match(request.questions.c0.instructions, /not_brand/u);
  assert.match(roleRequest('liquid/d1-ultra', { ...context, question: 'Which agency?' }, candidates).questions.c0.instructions, /not_brand/u);
  assert.deepEqual(request.state.tracked, ['Conversion']);
  assert.equal(request.state.identities[0].excerpts.length, 2);
  assert.equal(request.state.identities[0].excerpts[1].length, 500);
  assert.ok(ROLE_MAX_CANDIDATES >= 10);
});

test('role response: roles by candidate key, cost, and strict validation', () => {
  const ok = { model: 'liquid/d1-ultra-20261019', usage: { cost: 0.001 }, answers: { c0: { type: 'choice', choice: 'client' }, c1: { type: 'choice', choice: 'not_brand' } } };
  const parsed = parseRoleResponse(ok, 'liquid/d1-ultra', candidates);
  assert.deepEqual([...parsed.roles], [['adobe', 'client'], ['hotjar', 'not_brand']]);
  assert.equal(parsed.cost, 0.001);
  assert.equal(parseRoleResponse({ answers: ok.answers }, 'liquid/d1-ultra', candidates).cost, null);
  assert.throws(() => parseRoleResponse({ ...ok, model: 'other/model' }, 'liquid/d1-ultra', candidates), /Unexpected/);
  assert.throws(() => parseRoleResponse({ ...ok, answers: { c0: ok.answers.c0 } }, 'liquid/d1-ultra', candidates), /Unknown/);
  assert.throws(() => parseRoleResponse({ ...ok, answers: { ...ok.answers, c1: { type: 'choice', choice: 'boss' } } }, 'liquid/d1-ultra', candidates), /Unknown/);
  assert.throws(() => parseRoleResponse({ ...ok, usage: { cost: -1 } }, 'liquid/d1-ultra', candidates), /cost/);
});

test('v4 criteria: the prompt names the project and what it sells; platforms are suppliers, a tracked brand product is that brand', () => {
  // An SEO agency: a tech company its market uses is never a competitor.
  const agency = { brands: ['Conversion', 'Agência Mestre', 'NP Digital'], category: 'agência de SEO', question: 'Quais as melhores agências de SEO?' };
  const microsoft = [{ key: 'microsoft', name: 'Microsoft', domain: 'microsoft.com', excerpts: ['Microsoft Clarity e Bing Webmaster Tools ajudam no SEO.'] }];
  for (const request of [roleRequest('m/x', agency, microsoft), roleRequest('m/x', { ...agency, question: undefined }, microsoft)]) {
    const { instructions, criteria } = request.questions.c0;
    assert.match(instructions, /project's own brand is "Conversion", a business in "agência de SEO"; it monitors \["Agência Mestre","NP Digital"\]/u);
    assert.match(instructions, /platform or technology company the market uses is a supplier/u);
    assert.match(criteria.supplier, /Microsoft/u);
    assert.match(criteria.competitor, /same kind as the project's own brand/u);
  }
  // A product line of a monitored brand (ThinkPad for Lenovo) is a mention of that brand; a product category is no brand.
  const devices = roleRequest('m/x', { brands: ['Apple', 'Samsung', 'Lenovo'], category: 'consumer electronics' }, [{ key: 'thinkpad', name: 'ThinkPad', domain: null, excerpts: [] }]);
  assert.match(devices.questions.c0.instructions, /"Lenovo"/u);
  assert.match(devices.questions.c0.criteria.mention, /product line, model or sub-brand of one of the tracked brands/u);
  assert.match(devices.questions.c0.criteria.not_brand, /Chromebook/u);
  assert.equal(verdictModel('liquid/d1-ultra'), `liquid/d1-ultra@${ROLE_ADAPTER_VERSION}`);
});

test('cut names are no brands; acronyms, short names with a domain and real names are', () => {
  for (const name of ['Wh', 'EarFun&', 'JLab&', 'Fo'])
    assert.equal(isNameFragment(name), true, name);
  for (const [name, domain] of [['LG', null], ['HP', null], ['3M', null], ['Wh', 'wh.com'], ['Tubi', null], ['Disney+', null], ['AT&T', null]] as const)
    assert.equal(isNameFragment(name, domain), false, name);
});
