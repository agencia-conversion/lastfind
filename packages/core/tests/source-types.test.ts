import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN_TYPES,
  MODEL_DOMAIN_TYPES,
  PAGE_TYPES,
  SOURCE_TYPE_BATCH_SIZE,
  SOURCE_TYPE_DEFINITIONS,
  isSourceType,
  parseSourceTypeResponse,
  sourceTypeDecisionRequest,
} from '../lib/source-types.ts';

const domains = [
  { kind: 'domain', key: 'news.example', domain: 'news.example' },
  { kind: 'domain', key: 'forum.example', domain: 'forum.example' },
] as const;
const answer = (choice: string) => ({ type: 'choice', choice });

void test('every type has an English and Portuguese label and definition', () => {
  for (const type of [...DOMAIN_TYPES, ...PAGE_TYPES]) {
    const definition = SOURCE_TYPE_DEFINITIONS[type];
    assert.ok(definition.label[0] && definition.label[1], type);
    assert.ok(definition.description[0] && definition.description[1], type);
  }
});

void test('the evaluator can choose neither You nor Competitor', () => {
  const request = sourceTypeDecisionRequest([...domains], 'typesafe/jev-1.14');
  assert.deepEqual(Object.keys(request.questions.s0.criteria), [...MODEL_DOMAIN_TYPES]);
  const urls = sourceTypeDecisionRequest([{ kind: 'url', key: 'https://a.example/top-10', domain: 'a.example', title: 'Top 10' }], 'm');
  assert.deepEqual(Object.keys(urls.questions.s0.criteria), [...PAGE_TYPES]);
  assert.equal(isSourceType('domain', 'competitor'), true);
  assert.equal(isSourceType('url', 'competitor'), false);
});

void test('batches are bounded and item text is clipped as untrusted evidence', () => {
  assert.throws(() => sourceTypeDecisionRequest([], 'm'));
  const many = Array.from({ length: SOURCE_TYPE_BATCH_SIZE + 1 }, (_, index) => ({ kind: 'domain' as const, key: `d${index}.example`, domain: `d${index}.example` }));
  assert.throws(() => sourceTypeDecisionRequest(many, 'm'));
  const request = sourceTypeDecisionRequest([{ kind: 'url', key: 'https://a.example/x', domain: 'a.example', title: 'x'.repeat(1000) }], 'm');
  assert.equal(request.state.items[0].title?.length, 200);
});

void test('responses must answer every item with an allowed choice and a valid cost', () => {
  const ok = parseSourceTypeResponse({ model: 'typesafe/jev-1.14-20261001', answers: { s0: answer('editorial'), s1: answer('ugc') }, usage: { cost: 0.002 } }, [...domains], 'typesafe/jev-1.14');
  assert.deepEqual(ok.types.map((item) => item.type), ['editorial', 'ugc']);
  assert.equal(ok.cost, 0.002);
  assert.equal(parseSourceTypeResponse({ answers: { s0: answer('other'), s1: answer('other') } }, [...domains], 'm').cost, null);
  for (const bad of [
    { answers: { s0: answer('editorial') } },
    { answers: { s0: answer('competitor'), s1: answer('ugc') } },
    { answers: { s0: answer('editorial'), s1: answer('ugc') }, usage: { cost: -1 } },
    { model: 'other/model', answers: { s0: answer('editorial'), s1: answer('ugc') } },
    [],
  ])
    assert.throws(() => parseSourceTypeResponse(bad, [...domains], 'typesafe/jev-1.14'));
});
