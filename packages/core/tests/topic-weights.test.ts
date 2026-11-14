import assert from 'node:assert/strict';
import test from 'node:test';
import { readTopicWeights, topicFactors, topicShares, topicWeight } from '../lib/topic-weights.ts';

test('topic weights: read from the project, a missing topic takes the smallest weight, shares add up to 100', () => {
  assert.equal(readTopicWeights(null), null);
  assert.equal(readTopicWeights('not json'), null);
  assert.equal(readTopicWeights('{}'), null, 'no weight set counts every answer the same');
  const weights = readTopicWeights(JSON.stringify({ SEO: 50, GEO: 30, PR: 10, CRO: 5, Bad: -1, Text: '9' }))!;
  assert.deepEqual([...weights.keys()], ['SEO', 'GEO', 'PR', 'CRO'], 'only numbers from 0 up count');
  assert.equal(topicWeight(weights, 'Sites'), 5, 'a new topic starts at the smallest weight');
  const shares = topicShares(['SEO', 'GEO', 'PR', 'CRO', 'Sites', 'Links'], weights);
  assert.ok(Math.abs([...shares.values()].reduce((sum, share) => sum + share, 0) - 100) < 1e-9);
  assert.ok(Math.abs(shares.get('SEO')! - (50 / 105) * 100) < 1e-9, 'Conversion: 50/30/10/5/5/5 is SEO 47.6%');
});

test('topic factors weigh each topic by its share and keep the cohort size; without weights every answer counts 1', () => {
  const answers = new Map([['SEO', 80], ['GEO', 20], ['Empty', 0]]);
  assert.deepEqual([...topicFactors(answers, null)], [['SEO', 1], ['GEO', 1]]);
  const factors = topicFactors(answers, new Map([['SEO', 1], ['GEO', 3]]));
  // GEO weighs 3/4 of the rate with 20 of 100 answers; the weighted answers still add up to 100.
  assert.ok(Math.abs(factors.get('GEO')! * 20 - 75) < 1e-9);
  assert.ok(Math.abs(factors.get('SEO')! * 80 - 25) < 1e-9);
  assert.equal(factors.has('Empty'), false, 'a topic without answers in the cohort weighs nothing');
  // A rate over the cohort is the topics' rates weighted: SEO 50%, GEO 10% → (1×50 + 3×10)/4 = 20%.
  const rate = (factors.get('SEO')! * 40 + factors.get('GEO')! * 2) / (factors.get('SEO')! * 80 + factors.get('GEO')! * 20);
  assert.ok(Math.abs(rate - 0.2) < 1e-9);
});

test('the sentiment index weighs each assessed question by its topic, and the question count stays real', async () => {
  const { summarizeSentiment, sentimentScore } = await import('../lib/brand-research.ts');
  const reading = (score: number) => ({ id: 'b', state: 'assessed' as const, sentiment: null, score, candidate: null, evidence: [] });
  const observation = (unitId: string, score: number) => ({ runId: unitId, unitId, engine: 'chat_gpt', createdAt: '2026-10-30', brand: 'Acme', mentioned: true, status: 'completed', reading: reading(score), fullCoverage: true });
  // SEO: two questions at 100; GEO: one at 35. Equal answers: (100 + 100 + 35) / 3 = 78.3 → 78.
  const observations = [observation('q1', 100), observation('q2', 100), observation('q3', 35)];
  const topicOf = new Map([['q1', 'SEO'], ['q2', 'SEO'], ['q3', 'GEO']]);
  assert.equal(sentimentScore(summarizeSentiment(observations).brands[0]!), 78);
  // GEO weighs 3, SEO 1: (1×100 + 3×35) / 4 = 51.25 → 51, still 3 questions, bands in the same weighted shares.
  const weighted = summarizeSentiment(observations, { topicOf, weights: new Map([['SEO', 1], ['GEO', 3]]) }).brands[0]!;
  assert.equal(weighted.assessed, 3);
  assert.equal(sentimentScore(weighted), 51);
  assert.ok(Math.abs(weighted.distribution.negative / weighted.assessed - 0.75) < 1e-9);
});
