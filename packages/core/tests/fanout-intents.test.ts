import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpportunities, contentBrief, intentRequest, parseIntentResponse, readEntities, type OpportunityAnswer } from '../lib/fanout-intents.ts';
import { buildFanout } from '../lib/fanout.ts';
import type { FanoutIntent } from '../lib/report-types.ts';

// Search intents and Opportunities, pure parts: what the model is asked, how its answer is read, how the opportunities
// are computed. No provider is called: the answers are written here.
const reply = (value: unknown, cost: number | null = 0.003) => ({ choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }], ...(cost === null ? {} : { usage: { cost } }) });
const existing = [{ id: 'intent-a', name: 'Streaming prices', description: 'Plans compared by price.' }];
const queries = [
  { key: 'netflix price brazil', text: 'Netflix price Brazil' },
  { key: 'best anime streaming', text: 'best anime streaming' },
  { key: 'site:reddit.com netflix', text: 'site:reddit.com netflix' },
  { key: 'hbo max plans', text: 'HBO Max plans' },
];

void test('the request carries the current intents and the searches, never a separator character, and asks for a JSON schema', () => {
  const request = intentRequest('vendor/chat', { brand: 'Netflix', category: 'streaming', language: 'pt' }, existing, queries, 5);
  assert.equal(request.model, 'vendor/chat');
  assert.equal(request.response_format.type, 'json_schema');
  const user = JSON.parse(request.messages[1].content);
  assert.deepEqual(user.intents, [{ id: 'i1', name: 'Streaming prices', description: 'Plans compared by price.' }]);
  assert.deepEqual(user.searches.map((item: { id: string }) => item.id), ['q1', 'q2', 'q3', 'q4']);
  assert.match(request.messages[0].content, /Brazilian Portuguese/);
  assert.match(request.messages[0].content, /at most 5 new intents/);
  assert.doesNotMatch(request.messages[0].content, /[\u00b7\u2022|]| — /);
  assert.match(intentRequest('m', { brand: 'X', category: '', language: 'en' }, existing, queries, 0).messages[0].content, /Create no new intent/);
});

void test('an answer: existing ids, new refs, null and unknown targets, left-out searches and the room for new intents', () => {
  const parsed = parseIntentResponse(
    reply({
      new_intents: [
        { ref: 'n1', name: '  Anime   streaming ', description: 'Where to watch anime.', entities: [{ type: 'service', value: 'anime streaming' }, { type: 'nonsense', value: 'x' }] },
        { ref: 'n2', name: 'Unused', description: '', entities: [] },
        { ref: 'n3', name: 'Over the room', description: '', entities: [] },
      ],
      assignments: [
        { search: 'q1', intent: 'i1' },
        { search: 'q2', intent: 'n1' },
        { search: 'q3', intent: null },
        { search: 'q2', intent: 'i1' },
        { search: 'q9', intent: 'i1' },
      ],
    }),
    existing,
    queries,
    2,
  );
  assert.equal(parsed.cost, 0.003);
  // n2 is created but nothing points at it; n3 is past the room of two.
  assert.deepEqual(parsed.created, [{ ref: 'n1', name: 'Anime streaming', description: 'Where to watch anime.', entities: [{ type: 'service', value: 'anime streaming' }] }]);
  assert.deepEqual(Object.fromEntries(parsed.assignments), {
    'netflix price brazil': 'intent-a',
    'best anime streaming': 'n1',
    'site:reddit.com netflix': '',
    // Left out of the answer: it fits none, and is never asked again.
    'hbo max plans': '',
  });
  assert.throws(() => parseIntentResponse(reply('not json'), existing, queries, 2), /Invalid intent response/);
  assert.throws(() => parseIntentResponse(reply({ new_intents: [] }), existing, queries, 2), /Invalid intent response/);
  assert.throws(() => parseIntentResponse({ ...reply({ new_intents: [], assignments: [] }), usage: { cost: -1 } }, existing, queries, 2), /cost/);
  // A fenced answer is read; no reported cost is null, never zero.
  const fenced = parseIntentResponse(reply('```json\n{"new_intents":[],"assignments":[{"search":"q1","intent":"i1"}]}\n```', null), existing, queries, 2);
  assert.equal(fenced.cost, null);
  assert.equal(fenced.assignments.get('netflix price brazil'), 'intent-a');
  assert.deepEqual(readEntities('[{"type":"location","value":"São Paulo"},{"type":"brand","value":""}]'), [{ type: 'location', value: 'São Paulo' }]);
  assert.deepEqual(readEntities('nope'), []);
});

const intents = new Map<string, FanoutIntent>([
  ['prices', { id: 'prices', name: 'Streaming prices', description: 'Plans compared by price.', entities: [{ type: 'modifier', value: 'price' }] }],
  ['anime', { id: 'anime', name: 'Anime streaming', description: '', entities: [] }],
]);
const assignments = new Map([
  ['netflix price', 'prices'],
  ['cheapest streaming plan', 'prices'],
  ['anime streaming', 'anime'],
  ['weather', ''],
]);
let sequence = 0;
const answer = (prompt: string, engine: OpportunityAnswer['engine'], queries: string[], mentioned: boolean, competitors: string[] = [], topic = 'Plans'): OpportunityAnswer => ({
  id: `r${++sequence}`,
  prompt,
  engine,
  topic,
  queries,
  mentioned,
  competitors,
});

void test('an opportunity: two or more AIs never name the brand in the answers to the intent prompts while competitors appear', () => {
  const answers = [
    // Prices: ChatGPT returns the searches; Claude and Gemini answer the same prompt without them, and also without the brand.
    answer('p1', 'chat_gpt', ['Netflix price', 'cheapest streaming plan'], false, ['Hulu']),
    answer('p1', 'claude', [], false, ['Hulu', 'Max']),
    answer('p1', 'gemini', [], false, []),
    answer('p2', 'chat_gpt', ['netflix  PRICE'], false, ['Max']),
    // Anime: ChatGPT misses it, Claude names the brand: one AI only, no opportunity.
    answer('p3', 'chat_gpt', ['anime streaming'], false, ['Crunchyroll'], 'Anime'),
    answer('p3', 'claude', [], true, ['Crunchyroll'], 'Anime'),
    // Not classified yet, and fits none.
    answer('p4', 'chat_gpt', ['new show', 'weather'], true),
  ];
  const report = buildOpportunities(answers, intents, assignments, null, new Map([['p1', 'Cheapest streaming?'], ['p2', 'Netflix cost']]));
  assert.equal(report.responses, 7);
  assert.equal(report.withFanout, 4);
  assert.equal(report.queries, 5);
  assert.equal(report.classified, 4);
  assert.equal(report.intents, 2);
  assert.equal(report.opportunities.length, 1);
  const [row] = report.opportunities;
  assert.equal(row.intent.id, 'prices');
  assert.deepEqual(row.missing, ['chat_gpt', 'claude']);
  assert.equal(row.answers, 4);
  assert.equal(row.gapAnswers, 3);
  assert.equal(row.impact, 3);
  assert.deepEqual(row.engines.map((item) => [item.engine, item.answers, item.mentioned, item.gap]), [['chat_gpt', 2, 0, 2], ['gemini', 1, 0, 0], ['claude', 1, 0, 1]]);
  assert.deepEqual(row.prompts, [{ id: 'p1', text: 'Cheapest streaming?', gap: 2 }, { id: 'p2', text: 'Netflix cost', gap: 1 }]);
  assert.deepEqual(row.queries.map((query) => [query.key, query.occurrences]), [['netflix price', 2], ['cheapest streaming plan', 1]]);
  assert.deepEqual(row.competitors, [{ name: 'Hulu', answers: 2 }, { name: 'Max', answers: 2 }]);
  assert.equal(row.newest.length, 3);
  // The brief is plain text, one fact a line, with no separator character.
  const brief = contentBrief(row, (en) => en, (engine) => ({ chat_gpt: 'ChatGPT', claude: 'Claude' })[engine as 'chat_gpt'] ?? engine);
  assert.equal(
    brief,
    'Intent: Streaming prices\nPlans compared by price.\nEntities: Modifier: price\nTop searches: "Netflix price", "cheapest streaming plan"\nAIs that do not mention the brand: ChatGPT, Claude\nCompetitors in the answers: Hulu, Max',
  );
  assert.doesNotMatch(brief, /[\u00b7\u2022|]| — /);
});

void test('impact follows the topic weights, so a heavier topic ranks first', () => {
  const answers = [
    answer('a', 'chat_gpt', ['netflix price'], false, ['Hulu'], 'Plans'),
    answer('a', 'claude', [], false, ['Hulu'], 'Plans'),
    answer('b', 'chat_gpt', ['anime streaming'], false, ['Crunchyroll'], 'Anime'),
    answer('b', 'claude', [], false, ['Crunchyroll'], 'Anime'),
  ];
  const plain = buildOpportunities(answers, intents, assignments, null, new Map());
  assert.deepEqual(plain.opportunities.map((row) => [row.intent.id, row.impact]), [['anime', 2], ['prices', 2]], 'a tie keeps the name order');
  const weighted = buildOpportunities(answers, intents, assignments, new Map([['Plans', 1], ['Anime', 3]]), new Map());
  assert.equal(weighted.opportunities[0].intent.id, 'anime');
  assert.ok(weighted.opportunities[0].impact > weighted.opportunities[1].impact);
});

void test('Query Fan Out groups its searches by intent and lists every search of one intent on request', () => {
  const run = (id: string, queries: string[], mentioned = false) => ({ id, engine: 'chat_gpt' as const, prompt_id: `p-${id}`, prompt_text: 'streaming', topic: 'Plans', created_at: '2026-10-20T10:00:00Z', queries, mentioned, cited: false });
  const runs = [run('1', ['Netflix price', 'anime streaming'], true), run('2', ['netflix price', 'weather']), run('3', ['new show'])];
  const grouping = { intents: [...intents.values()], assignments };
  const report = buildFanout(runs, [{ engine: 'chat_gpt', responses: 3 }], [], '', [], grouping);
  assert.deepEqual(report.intents.map((row) => [row.id, row.queries, row.occurrences, row.prompts, row.mentionedRate]), [['prices', 1, 2, 2, 50], ['anime', 1, 1, 1, 100]]);
  assert.deepEqual(report.unassigned, { other: 1, pending: 1 });
  assert.deepEqual(Object.fromEntries(report.queries.map((row) => [row.key, row.intent])), { 'netflix price': 'prices', 'anime streaming': 'anime', weather: '', 'new show': null });
  const one = buildFanout(runs, [{ engine: 'chat_gpt', responses: 3 }], [], '', [], { ...grouping, intent: 'prices' });
  assert.deepEqual(one.queries.map((row) => row.key), ['netflix price']);
  assert.equal(one.hasMoreQueries, false);
  // Without intents every search waits, and none is grouped.
  const none = buildFanout(runs, [{ engine: 'chat_gpt', responses: 3 }], []);
  assert.deepEqual(none.intents, []);
  assert.deepEqual(none.unassigned, { other: 0, pending: 4 });
});
