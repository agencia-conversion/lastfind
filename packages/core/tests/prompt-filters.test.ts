import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_PROMPT_FILTERS, activeConditions, inHeaderFilters, matchesPromptFilters, readPromptFilters, writePromptFilters, type PromptFilters } from '../lib/prompt-filters.ts';

const metric = (values: Partial<{ responses: number; mentions: number; visibility: number; shareOfVoice: number | null; position: number | null; cited: number }>) =>
  ({ responses: 4, mentions: 2, visibility: 50, shareOfVoice: 30, position: 2, cited: 1, ...values });
const loaded = { metrics: true, sentiment: true };
const match = (filters: Partial<PromptFilters>, measure: Parameters<typeof matchesPromptFilters>[1], measured = loaded) =>
  matchesPromptFilters({ ...EMPTY_PROMPT_FILTERS, ...filters }, measure, measured);

test('the URL keeps only what differs from the defaults and reads it back', () => {
  const filters: PromptFilters = { ...EMPTY_PROMPT_FILTERS, status: 'archived', gap: true, visibility: [20, null], position: [null, 3.5], mention: 'no', citation: 'yes', created: ['2026-01-01', ''] };
  const params = new URLSearchParams('tab=prompts&vis=1..2&status=inactive');
  writePromptFilters(params, filters);
  assert.equal(params.toString(), 'tab=prompts&vis=20..&status=archived&gap=competitor-only&pos=..3.5&mentioned=no&cited=yes&created=2026-01-01..');
  assert.deepEqual(readPromptFilters(params), filters);
  writePromptFilters(params, null);
  assert.equal(params.toString(), 'tab=prompts');
  // A hand-edited URL never breaks the list: unknown values fall back to no filter.
  assert.deepEqual(readPromptFilters(new URLSearchParams('status=x&vis=a..&mentioned=maybe&created=yesterday..')), EMPTY_PROMPT_FILTERS);
  assert.deepEqual(activeConditions({ ...filters }), ['visibility', 'position', 'mention', 'citation', 'created']);
});

test('conditions intersect and a prompt without answers never matches a metric condition', () => {
  const measure = { createdAt: '2026-10-01T10:00:00Z', metric: metric({}), sentiment: 70 };
  assert.equal(match({ visibility: [40, 60], shareOfVoice: [null, 30], position: [1, 2], sentiment: [60, null], mention: 'yes', citation: 'yes', created: ['2026-10-01', '2026-10-01'] }, measure), true);
  assert.equal(match({ visibility: [51, null] }, measure), false);
  assert.equal(match({ created: ['', '2026-09-30'] }, measure), false);
  const silent = { createdAt: '2026-10-01', metric: metric({ responses: 0, mentions: 0, visibility: 0, cited: 0 }), sentiment: null };
  for (const filters of [{ visibility: [0, null] }, { mention: 'no' }, { citation: 'no' }, { sentiment: [0, 100] }] as Partial<PromptFilters>[])
    assert.equal(match(filters, silent), false, JSON.stringify(filters));
  assert.equal(match({ mention: 'no', citation: 'no' }, { ...measure, metric: metric({ mentions: 0, cited: 0 }) }), true);
});

test('metric conditions wait for their report instead of hiding every prompt', () => {
  const measure = { createdAt: '2026-10-01', metric: null, sentiment: null };
  assert.equal(match({ visibility: [10, null], sentiment: [10, null] }, measure, { metrics: false, sentiment: false }), true);
  assert.equal(match({ created: ['2026-11-01', ''] }, measure, { metrics: false, sentiment: false }), false);
});

// Found in review: the status counts honored the header's topic only; a tag or a model left them counting every prompt.
test('the header scope of a prompt is its topic, any of the chosen tags and any of the chosen models', () => {
  const prompt = { tag: 'Pricing', tags: ['paid', 'budget'], engine: 'chat_gpt', engines: ['chat_gpt', 'gemini'] };
  const all = { topic: '', tags: '', engine: 'all' };
  assert.equal(inHeaderFilters(prompt, all), true);
  assert.equal(inHeaderFilters(prompt, { ...all, tags: 'paid' }), true);
  assert.equal(inHeaderFilters(prompt, { ...all, tags: 'free,budget' }), true);
  assert.equal(inHeaderFilters(prompt, { ...all, tags: 'free' }), false);
  assert.equal(inHeaderFilters(prompt, { ...all, topic: 'Comparison' }), false);
  assert.equal(inHeaderFilters(prompt, { ...all, topic: `Comparison\n${prompt.tag}` }), true, 'any of the chosen topics');
  assert.equal(inHeaderFilters(prompt, { ...all, engine: 'perplexity,gemini' }), true);
  assert.equal(inHeaderFilters(prompt, { ...all, engine: 'perplexity' }), false);
  assert.equal(inHeaderFilters({ ...prompt, engines: undefined }, { ...all, engine: 'gemini' }), false, 'without its list, the prompt\'s own model');
});
