import test from 'node:test';
import assert from 'node:assert/strict';
import { agreement, discoverPaged, extractionConsistency, repeatSentiment, sentimentByBrand, sentimentConsistency, shuffled } from '../lib/classifier-consistency.ts';
import { decisionRequest } from '../lib/brand-research-provider.ts';
import { lowercaseCounter, lowercaseUse, type DiscoveryAnswer } from '../lib/competitor-discovery.ts';

const brands = [
  { name: 'Acme', domain: 'acme.com' },
  { name: 'Nova', domain: 'nova.com' },
];

test('agreement: the share of runs that gave each item its most frequent answer', () => {
  const stable = new Map([['a', 'x'], ['b', 'y']]);
  const result = agreement([stable, stable, new Map([['a', 'x'], ['b', 'z']]), stable]);
  assert.equal(result.items, 2);
  assert.equal(result.identical, 1);
  assert.equal(result.mean, (1 + 0.75) / 2);
  assert.deepEqual(result.unstable.map((row) => [row.id, row.answers]), [['b', 'y 3, z 1']]);
});

test('sentiment: the same criteria, score and band, and the widest spread over the runs', () => {
  // Acme: two sets of criteria with one score (leader or praised, 65); Nova: plain once, then not read.
  const runs = [
    new Map([['r1 | Acme', '65 leader'], ['r1 | Nova', '50'], ['r1 | Zed', '70 recommended']]),
    new Map([['r1 | Acme', '65 praised'], ['r1 | Nova', '50'], ['r1 | Zed', '85 leader+recommended']]),
    new Map([['r1 | Acme', '65 leader'], ['r1 | Nova', 'insufficient'], ['r1 | Zed', '70 recommended']]),
  ];
  const result = sentimentConsistency(runs);
  assert.deepEqual([result.readings, result.sameCriteria, result.sameScore, result.sameBand, result.maxSpread], [3, 0, 1, 2, 15]);
  assert.deepEqual(
    sentimentByBrand(runs).map((row) => [row.brand, row.readings, row.sameCriteria, row.sameScore, row.sameBand, row.maxSpread]),
    [['Acme', 1, 0, 1, 1, 0], ['Nova', 1, 0, 0, 0, 0], ['Zed', 1, 0, 0, 1, 15]],
  );
});

test('sentiment is asked N times with the caller\'s send and stops before the spending cap; nothing leaves the test', async () => {
  let calls = 0;
  let cost = 0.001;
  const send = async (payload: unknown) => {
    calls++;
    const request = payload as ReturnType<typeof decisionRequest>;
    // A model that hesitates on Nova's reservation every other call; its distribution sits on its choice, so one call decides.
    return Response.json({
      model: request.model,
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => {
          const labels = Object.keys(question.criteria);
          const choice = id === 'b0_leader' ? 'yes:0' : id === 'b1_reservation' && calls % 2 ? 'yes:0' : labels.includes('brand') ? 'brand' : 'no';
          return [id, { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(question.criteria).map((label) => [label, label === choice ? 1 : 0])) }];
        }),
      ),
      usage: { cost },
    });
  };
  const inputs = [{ id: 'r1', question: 'Best tool?', answer: 'Acme is the best. Nova also exists.', brands }];
  const budget = { cap: 1, spent: 0, calls: 0, stopped: false };
  const result = await repeatSentiment(inputs, { runs: 10, budget, send });
  assert.equal(calls, 10);
  assert.equal(result.runs.length, 10);
  assert.deepEqual([result.readings, result.sameCriteria, result.sameScore, result.sameBand, result.maxSpread], [2, 1, 1, 1, 15]);
  assert.deepEqual(result.unstable.map((row) => [row.id, row.answers]), [['r1 | Nova', '35 reservation 5, 50 5']]);
  assert.ok(Math.abs(budget.spent - 0.01) < 1e-9);
  // Calls that cost their worst case (the reserve, US$ 0.02) under a cap of US$ 0.045: two are sent, then it stops.
  const tight = { cap: 0.045, spent: 0, calls: 0, stopped: false };
  calls = 0;
  cost = 0.02;
  const capped = await repeatSentiment(inputs, { runs: 10, budget: tight, send });
  assert.deepEqual([calls, tight.calls, capped.runs.length, tight.stopped], [2, 2, 2, true]);
  assert.ok(tight.spent <= tight.cap);
});

test('brand extraction gives the same brands in every run and every page order', () => {
  const texts = ['- **Tubi** — free\n- **Peacock** — NBC', '- **Peacock Premium** — no ads\n- **Kanopy** — libraries', '- **Tubi & Kanopy** — free tiers', '- **Kanopy** — films'];
  const answers = texts.map((answer, index): DiscoveryAnswer => ({ id: `a${index}`, answer, sources: [], createdAt: `2026-10-1${index}T00:00:00.000Z` }));
  const seeds = [{ name: 'Netflix', domain: 'netflix.com' }];
  assert.deepEqual(shuffled([1, 2, 3, 4, 5], 3), shuffled([1, 2, 3, 4, 5], 3), 'a seed gives one order');
  assert.deepEqual(
    discoverPaged(shuffled(answers, 5), seeds, 1).map((c) => `${c.name} ${c.answerCount}`).sort(),
    ['Kanopy 3', 'Peacock 2', 'Tubi 2'],
  );
  const result = extractionConsistency(answers, seeds, { runs: 10, pageSize: 2, minAnswers: 2 });
  assert.deepEqual([result.repeats.brands, result.repeats.identical, result.repeats.outputs], [3, 3, 1]);
  assert.deepEqual([result.orders.brands, result.orders.identical, result.orders.outputs], [3, 3, 1]);
});

test('lowercase use counted in parts, saved and resumed, is the count of one read', () => {
  const texts = ['the peacock app and Peacock Premium', 'Peacock is free; peacock feathers', 'Kanopy & Tubi, a tubi fan', 'no brand here', 'Peacock Premium plan, peacock premium tier'];
  const names = [{ key: 'peacock', name: 'Peacock' }, { key: 'peacock premium', name: 'Peacock Premium' }, { key: 'tubi', name: 'Tubi' }, { key: 'kanopy', name: 'Kanopy' }];
  const whole = lowercaseUse(texts, names);
  const first = lowercaseCounter(names);
  for (const text of texts.slice(0, 2)) first.add(text);
  const resumed = lowercaseCounter(names, JSON.parse(JSON.stringify(first.counts())));
  for (const text of texts.slice(2)) resumed.add(text);
  const parts = resumed.use();
  for (const { key, name } of names) assert.equal(parts.name(key, name), whole.name(key, name), name);
  for (const word of ['peacock', 'premium', 'tubi', 'kanopy']) assert.equal(parts.word(word), whole.word(word), word);
  assert.equal(whole.word('peacock'), 3);
});
