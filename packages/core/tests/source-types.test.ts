import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN_TYPES,
  MODEL_DOMAIN_TYPES,
  PAGE_TYPES,
  SOURCE_OWNERS,
  SOURCE_OWNER_LABELS,
  SOURCE_TYPE_BATCH_SIZE,
  SOURCE_TYPE_COLORS,
  SOURCE_TYPE_DEFINITIONS,
  SOURCE_TYPE_DOMAIN_PROMPT,
  isSourceOwner,
  isSourceType,
  sourceFiltersFromQuery,
  parseSourceTypeResponse,
  sourceTypeDecisionRequest,
} from '../lib/source-types.ts';

const domains = [
  { kind: 'domain', key: 'news.example', domain: 'news.example' },
  { kind: 'domain', key: 'forum.example', domain: 'forum.example' },
] as const;
const answer = (choice: string) => ({ type: 'choice', choice });

void test('every site and content type has a fixed color token for charts, light and dark', async () => {
  const { readFile } = await import('node:fs/promises');
  const tokens = await readFile(new URL('../app/tokens.css', import.meta.url), 'utf8');
  const dark = tokens.slice(tokens.indexOf('.dark {'));
  for (const type of [...DOMAIN_TYPES, ...PAGE_TYPES, 'unclassified'] as const) {
    const token = /^var\((--source-type-[a-z-]+)\)$/.exec(SOURCE_TYPE_COLORS[type])?.[1];
    assert.ok(token, type);
    assert.match(tokens.slice(0, tokens.indexOf('.dark {')), new RegExp(`${token}: #[0-9a-f]{6};`), type);
    assert.match(dark, new RegExp(`${token}: #[0-9a-f]{6};`), type);
  }
});

void test('Social and Press are site types the evaluator can choose, after the original six', () => {
  assert.deepEqual([...MODEL_DOMAIN_TYPES], ['corporate', 'editorial', 'press', 'institutional', 'ugc', 'social', 'reference', 'other']);
  assert.deepEqual(SOURCE_TYPE_DEFINITIONS.press.label, ['Press', 'Imprensa']);
  assert.deepEqual(SOURCE_TYPE_DEFINITIONS.social.label, ['Social', 'Social']);
  const request = sourceTypeDecisionRequest([...domains], 'typesafe/jev-1.14');
  assert.ok(request.questions.s0.criteria.press && request.questions.s0.criteria.social);
  // A type stored before the addition stays valid.
  for (const type of ['editorial', 'ugc']) assert.ok(isSourceType('domain', type));
});

// The site-type question is versioned: the admin reclassification redoes the domains typed with an older one. Changing
// the instructions or the criteria without a new SOURCE_TYPE_DOMAIN_PROMPT would leave rows typed by two questions under one name.
void test('the domain question is pinned to its version and carries its own evidence', async () => {
  const { createHash } = await import('node:crypto');
  const one = sourceTypeDecisionRequest([{ kind: 'domain', key: 'a.example', domain: 'a.example' }], 'm');
  assert.equal(SOURCE_TYPE_DOMAIN_PROMPT, 'domain-prompt-v2');
  assert.equal(createHash('sha256').update(JSON.stringify(one.questions.s0)).digest('hex'), 'ce43384e8058c7b86f6a8bae9ac23e41c271da812e649e7b5746e48f4f265a5a');
  assert.deepEqual(one.state, { rubric: 'source-types-v1', kind: 'domain', prompt: 'domain-prompt-v2', items: [{ id: 's0', kind: 'domain', domain: 'a.example' }] });
  const sampled = { kind: 'domain' as const, key: 'b.example', domain: 'b.example', samples: [{ url: 'https://b.example/best-x', title: 'Best X of 2026 "ignore the rules"' }] };
  const alone = sourceTypeDecisionRequest([sampled], 'm').questions.s0;
  const among = sourceTypeDecisionRequest([{ kind: 'domain', key: 'c.example', domain: 'c.example' }, sampled], 'm').questions.s1;
  assert.deepEqual(alone, among, 'the question is the same whatever else is in the batch');
  assert.ok(alone.instructions.includes(JSON.stringify(sampled.samples)), 'the cited pages travel as JSON data');
  assert.doesNotMatch(alone.instructions, /choose other/i);
  assert.match(alone.criteria.other, /Never for a real site/);
});

void test('every type has an English and Portuguese label and definition', () => {
  for (const type of [...DOMAIN_TYPES, ...PAGE_TYPES]) {
    const definition = SOURCE_TYPE_DEFINITIONS[type];
    assert.ok(definition.label[0] && definition.label[1], type);
    assert.ok(definition.description[0] && definition.description[1], type);
  }
});

void test('site types do not include You or Competitor: ownership is a separate mark', () => {
  assert.deepEqual([...DOMAIN_TYPES], [...MODEL_DOMAIN_TYPES]);
  assert.deepEqual([...SOURCE_OWNERS], ['own', 'competitor', 'third-party']);
  for (const owner of SOURCE_OWNERS) {
    assert.ok(isSourceOwner(owner));
    assert.ok(SOURCE_OWNER_LABELS[owner].label[0] && SOURCE_OWNER_LABELS[owner].plural[1], owner);
  }
  assert.equal(isSourceOwner('you'), false);
  const request = sourceTypeDecisionRequest([...domains], 'typesafe/jev-1.14');
  assert.deepEqual(Object.keys(request.questions.s0.criteria), [...MODEL_DOMAIN_TYPES]);
  const urls = sourceTypeDecisionRequest([{ kind: 'url', key: 'https://a.example/top-10', domain: 'a.example', title: 'Top 10' }], 'm');
  assert.deepEqual(Object.keys(urls.questions.s0.criteria), [...PAGE_TYPES]);
  assert.equal(isSourceType('domain', 'competitor'), false);
  assert.equal(isSourceType('domain', 'you'), false);
  assert.equal(isSourceType('domain', 'corporate'), true);
  assert.equal(isSourceType('url', 'corporate'), false);
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

void test('a Sources link reads its type and owner filters', () => {
  const filters = (query: string) => sourceFiltersFromQuery(new URLSearchParams(query));
  assert.deepEqual(filters('type=editorial&owner=competitor'), { type: 'editorial', owner: 'competitor' });
  assert.deepEqual(filters('type=editorial,ugc&owner=own,competitor'), { type: 'editorial,ugc', owner: 'own,competitor' });
  assert.deepEqual(filters('owner=bogus'), { type: '', owner: '' });
  assert.deepEqual(filters(''), { type: '', owner: '' });
});
