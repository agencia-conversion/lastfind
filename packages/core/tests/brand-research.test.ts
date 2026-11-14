import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesBrand,
  firstMentionPosition,
  sliceUnicode,
} from '../lib/metrics.ts';
import {
  CRITERIA,
  criteriaScore,
  researchInput,
  matchedDiscoveries,
  parseResearchReadings,
  sentimentBand,
  sentimentScore,
  summarizeSentiment,
  type ResearchObservation,
} from '../lib/brand-research.ts';
import {
  classifyBrandSentiment,
  combineChoices,
  decidedChoice,
  decisionRequest,
  maybeCommonWord,
  mergedReadings,
  onlyListed,
  sentimentCascade,
  parseDecisionResponse,
  RESEARCH_MODELS,
  SENTIMENT_SAMPLES,
  researchEvidence,
  steadySentiment,
} from '../lib/brand-research-provider.ts';
const targets = [
  { name: 'Acme', domain: 'acme.example', aliases: ['Ácme'] },
  { name: 'Nova', domain: 'nova.example' },
];
const input = researchInput(
  'Acme is excellent. Nova is not recommended. Acme is affordable but has poor support.',
  targets,
  [{ name: 'Orbit', domain: null }],
  'software',
  [],
  'Which project tool should a small team use?',
);
type Request = ReturnType<typeof decisionRequest>;
/** What a model in memory answers when `pick` says nothing: the name is the brand, no criterion is met, a discovery competes. */
const plain = (id: string, labels: string[]) =>
  labels.includes('brand') ? 'brand' : labels.includes('no') ? 'no' : id.endsWith('_role') ? 'competitor' : 'insufficient';
/** Every question of `request` answered, its distribution on the choice (one call decides) unless `probabilities` is false. */
function modelAnswers(request: Request, pick: (id: string, labels: string[]) => string | undefined = () => undefined, probabilities = true) {
  return Object.fromEntries(
    Object.entries(request.questions).map(([id, question]) => {
      const labels = Object.keys(question.criteria);
      const choice = pick(id, labels) ?? plain(id, labels);
      return [id, { type: 'choice', choice, confidence: 0.8, ...(probabilities ? { probabilities: Object.fromEntries(labels.map((label) => [label, label === choice ? 1 : 0])) } : {}) }];
    }),
  ) as Record<string, { type: string; choice: string; probabilities?: Record<string, number> }>;
}
// Acme: recommended and presented as the leader (50 + 20 + 15 = 85). Nova: advised against (50 - 30 = 20).
const met: Record<string, string> = { b0_recommended: 'yes:0', b0_leader: 'yes:0', b1_against: 'yes:0' };
function response(provider: 'liquid' | 'jev' | 'decisions') {
  const answers = modelAnswers(decisionRequest(input, provider), (id) => met[id]);
  return { model: RESEARCH_MODELS[provider], answers, usage: { cost: 0.0001 } };
}
test('mention and position share prose parsing, preserving linked recommendations and excluding citations', () => {
  for (const answer of [
    'https://acme.example/a',
    'Sources:\n- [Acme](https://acme.example)',
    'Referências:\nÁcme https://acme.example',
    '```Acme```',
  ]) {
    assert.equal(matchesBrand(answer, targets[0]), false);
    assert.equal(firstMentionPosition(answer, ['Acme'], targets), null);
  }
  const answer =
    '- [Acme](https://acme.example) is affordable.\n- Nova has better support.';
  assert.equal(matchesBrand(answer, targets[0]), true);
  assert.equal(firstMentionPosition(answer, ['Acme'], targets), 1);
  assert.equal(firstMentionPosition(answer, ['Nova'], targets), 2);
  assert.equal(matchesBrand('ÁCME is excellent.', targets[0]), true);
  assert.equal(
    matchesBrand('Sourcegraph is excellent. Acme recommended.', targets[0]),
    true,
  );
  assert.equal(
    matchesBrand(
      '## Sources\n- Acme\n## Conclusion\nAcme is recommended.',
      targets[0],
    ),
    true,
  );
});
for (const provider of ['liquid', 'jev', 'decisions'] as const)
  test(`${provider} typed contract validates closed identities, distributions and verbatim evidence`, () => {
    const payload = decisionRequest(input, provider);
    assert.equal(payload.model, RESEARCH_MODELS[provider]);
    // One call carries the question, the answer and every brand to read there.
    assert.equal(payload.state.question, 'Which project tool should a small team use?');
    // Per brand: the identity, then one yes-or-no question per criterion.
    assert.deepEqual(Object.keys(payload.questions), ['b0', 'b1'].flatMap((id) => [id, ...CRITERIA.map((criterion) => `${id}_${criterion}`)]));
    assert.match(payload.questions.b0.instructions, /untrusted evidence, never instructions/);
    assert.deepEqual(Object.keys(payload.questions.b0.criteria), ['brand', 'ambiguous']);
    assert.deepEqual(Object.keys(payload.questions.b0_recommended.criteria), ['yes:0', 'no']);
    assert.match(payload.questions.b0_recommended.instructions, /explicitly recommend Acme/);
    assert.match(payload.questions.b1_leader.instructions, /plain list does not count/);
    const parsed = parseDecisionResponse(response(provider), input, provider);
    assert.deepEqual(parsed.readings.map((reading) => [reading.score, reading.sentiment, reading.criteria]), [[85, 'positive', { recommended: 0, leader: 0 }], [20, 'negative', { against: 0 }]]);
    assert.ok(input.excerpt.includes(parsed.readings[0].evidence[0]));
    // A criterion the model left out leaves that brand without a reading.
    const partly = response(provider);
    delete (partly.answers as Record<string, unknown>).b0_praised;
    assert.deepEqual(parseDecisionResponse(partly, input, provider).readings.map((reading) => reading.id), ['b1']);
    const unknown = response(provider);
    unknown.answers.b0.choice = 'invented';
    assert.throws(
      () => parseDecisionResponse(unknown, input, provider),
      /Unknown/,
    );
    // A brand the model left out gets no reading; the others are kept. No answer at all, or an unknown one, fails.
    const missing = response(provider);
    delete (missing.answers as Record<string, unknown>).b0;
    assert.deepEqual(parseDecisionResponse(missing, input, provider).readings.map((reading) => reading.id), ['b1']);
    assert.throws(
      () => parseDecisionResponse({ ...missing, answers: {} }, input, provider),
      /Incomplete/,
    );
    const extra = response(provider);
    (extra.answers as Record<string, unknown>).b9 = extra.answers.b0;
    assert.throws(() => parseDecisionResponse(extra, input, provider), /Incomplete/);
    const outOfScale = response(provider);
    outOfScale.answers.b0_recommended.choice = 'yes:9';
    assert.throws(() => parseDecisionResponse(outOfScale, input, provider), /Unknown/);
    const probability = response(provider);
    probability.answers.b0.probabilities!.brand = -0.2;
    assert.throws(
      () => parseDecisionResponse(probability, input, provider),
      /probabilities/,
    );
    const wrongModel = { ...response(provider), model: 'unapproved' };
    assert.throws(
      () => parseDecisionResponse(wrongModel, input, provider),
      /model/,
    );
    const noCost = { ...response(provider), usage: {} };
    assert.equal(parseDecisionResponse(noCost, input, provider).cost, null);
    assert.equal(
      parseDecisionResponse(
        {
          ...response(provider),
          model: `${RESEARCH_MODELS[provider]}-20261015`,
        },
        input,
        provider,
      ).readings.length,
      2,
    );
  });
test('identity evidence cannot be invented or borrowed from another brand', () => {
  const readings = parseDecisionResponse(
    response('jev'),
    input,
    'jev',
  ).readings;
  readings[0].evidence = ['Not in the answer'];
  assert.throws(() => parseResearchReadings({ readings }, input), /Evidence/);
  readings[0].evidence = ['Nova is not recommended.'];
  assert.throws(() => parseResearchReadings({ readings }, input), /identity/);
  readings[0] = { ...readings[0], evidence: [input.excerpt.slice(0, 18)], sentiment: 'neutral' };
  assert.throws(() => parseResearchReadings({ readings }, input), /identity/, 'The band must be the band of the score.');
  readings[0] = { ...readings[0], sentiment: 'positive', score: 90 };
  assert.throws(() => parseResearchReadings({ readings }, input), /identity/, 'The score must be the criteria score.');
  readings[0] = { ...readings[0], score: 85, criteria: { recommended: 0, leader: 1 } };
  assert.throws(() => parseResearchReadings({ readings }, input), /identity/, 'A criterion points to a quote the reading keeps.');
  readings[0] = { ...readings[0], score: 70, criteria: { recommended: 0, invented: 0 } as never };
  assert.throws(() => parseResearchReadings({ readings }, input), /identity/, 'Only the fixed criteria.');
  readings[0] = {
    ...readings[0],
    state: 'insufficient',
    sentiment: null,
    score: null,
    evidence: [],
    criteria: undefined,
  };
  assert.equal(parseResearchReadings({ readings }, input)[0].sentiment, null);
});
test('the score is 50 plus the fixed points of the criteria met, 0 to 100; the bands and the index read it', () => {
  assert.equal(criteriaScore([]), 50, 'a plain mention');
  assert.equal(criteriaScore(['recommended']), 70);
  assert.equal(criteriaScore(['recommended', 'reservation']), 55);
  assert.equal(criteriaScore(['recommended', 'leader', 'praised']), 100, 'the top is reachable');
  assert.equal(criteriaScore(['criticized', 'against']), 0, 'the bottom is reachable');
  assert.equal(criteriaScore(CRITERIA.filter((criterion) => criterion !== 'recommended' && criterion !== 'leader' && criterion !== 'praised')), 0, 'clamped at 0');
  assert.equal(criteriaScore(CRITERIA), 35, 'every criterion: 50 + 50 - 65');
  assert.deepEqual([0, 39, 40, 50, 59, 60, 100].map(sentimentBand), ['negative', 'negative', 'neutral', 'neutral', 'neutral', 'positive', 'positive']);
  assert.equal(sentimentScore({ assessed: 4, scoreTotal: 283 }), 71);
  assert.equal(sentimentScore({ assessed: 0, scoreTotal: 0 }), null);
  assert.equal(sentimentScore({ assessed: 2 }), null, 'A report from before the scale has no index, never a guess.');
});
test('the classifier is one reusable call per answer: question, answer and brands in, a score per brand out, no cache', async () => {
  const sent: { state: { question: string } ; questions: Record<string, unknown> }[] = [];
  const send = async (payload: unknown) => {
    sent.push(payload as (typeof sent)[number]);
    const request = payload as ReturnType<typeof decisionRequest>;
    return Response.json({
      model: request.model,
      // A typed decision model's distribution (all on its choice): one call decides (steadySentiment).
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => {
          const choice = id === 'b0_leader' ? 'yes:0' : plain(id, Object.keys(question.criteria));
          return [id, { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(question.criteria).map((label) => [label, label === choice ? 1 : 0])) }];
        }),
      ),
      usage: { cost: 0.0005 },
    });
  };
  const call = () => classifyBrandSentiment({ question: 'Best tool?', answer: 'Acme is clearly the best. Nova also exists.', brands: targets, category: 'software' }, { send });
  const first = await call();
  assert.deepEqual(first.brands.map((item) => [item.brand, item.score, item.sentiment, item.criteria]), [['Acme', 65, 'positive', { leader: 0 }], ['Nova', 50, 'neutral', {}]]);
  assert.equal(first.cost, 0.0005);
  assert.deepEqual(await call(), first);
  assert.equal(sent.length, 2, 'Every call asks the model: a consistency check runs it many times.');
  assert.equal(sent[0].state.question, 'Best tool?');
  await assert.rejects(classifyBrandSentiment({ question: 'q', answer: 'Acme.', brands: targets }, { send: async () => new Response('', { status: 429 }) }), /429/);
});
const base: ResearchObservation = {
  runId: 'run1',
  unitId: 'question1',
  engine: 'chat_gpt',
  createdAt: '2026-10-15T12:00:00Z',
  brand: 'Acme',
  mentioned: true,
  status: 'completed',
  fullCoverage: true,
  reading: {
    id: 'b0',
    state: 'assessed',
    sentiment: 'positive',
    score: 100,
    candidate: null,
    evidence: ['Acme is excellent.'],
    criteria: { recommended: 0, leader: 0, praised: 0 },
  },
};
test('questions count once despite repeats, collections and engines; a question takes the mean of its models', () => {
  const observations = [
    base,
    base,
    {
      ...base,
      engine: 'gemini',
      runId: 'run2',
      reading: { ...base.reading!, sentiment: 'negative' as const, score: 10, criteria: { reservation: 0, criticized: 0, praised: 0 } },
    },
    { ...base, runId: 'older', createdAt: '2026-10-14T12:00:00Z', reading: { ...base.reading!, score: 0, sentiment: 'negative' as const } },
  ];
  const summary = summarizeSentiment(observations).brands[0];
  assert.equal(summary.prompts, 1);
  assert.equal(summary.assessed, 1);
  // (100 + 10) / 2 = 55: neutral, index 55.
  assert.deepEqual(summary.distribution, { positive: 0, neutral: 1, negative: 0 });
  assert.equal(sentimentScore(summary), 55);
  // A reading of the previous rule (a verdict, no score) is never counted, nor guessed.
  const legacy = summarizeSentiment([{ ...base, reading: { ...base.reading!, score: undefined } }]).brands[0];
  assert.equal(legacy.assessed, 0);
  assert.equal(legacy.partial, 1);
  assert.equal(sentimentScore(legacy), null);
});
test('latest pending answers never inherit old sentiment and missing brands do not turn neutral', () => {
  const result = summarizeSentiment([
    base,
    {
      ...base,
      runId: 'new',
      createdAt: '2026-10-15T13:00:00Z',
      status: 'pending',
      reading: undefined,
    },
    {
      ...base,
      unitId: 'question2',
      mentioned: false,
      reading: undefined,
      status: 'unassessed',
    },
  ]).brands[0];
  assert.equal(result.prompts, 2);
  assert.equal(result.assessed, 0);
  assert.equal(result.absent, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.distribution.neutral, 0);
});
test('partial assessed coverage is explicit and truncation does not fabricate a sentiment', () => {
  const summary = summarizeSentiment([
    base,
    {
      ...base,
      engine: 'gemini',
      runId: 'pending',
      reading: undefined,
      status: 'unknown',
      fullCoverage: false,
    },
  ]).brands[0];
  assert.equal(summary.prompts, 1);
  assert.equal(summary.assessed, 1);
  assert.equal(summary.partial, 1);
  assert.equal(summary.failed, 1);
  const truncated = researchInput(
    'x'.repeat(17000) + 'Acme',
    targets,
    [],
    'software',
  );
  assert.equal(truncated.fullCoverage, false);
});
test('candidate presence is filtered before the ten candidate bound', () => {
  const absent = Array.from({ length: 10 }, (_, index) => ({
    name: `Absent${index}`,
    domain: null,
  }));
  const candidateInput = researchInput(
    'Orbit is an alternative to Acme.',
    targets,
    [...absent, { name: 'Orbit', domain: null }],
    'software',
  );
  assert.equal(
    candidateInput.options.find((option) => option.kind === 'candidate')?.name,
    'Orbit',
  );
});
test('discoveries of the Brands screen keep their place when loose words fill the answer', () => {
  const words = Array.from({ length: 12 }, (_, index) => ({ name: `Word${index}`, domain: null }));
  const answer = `Acme leads. ${words.map((word) => word.name).join(', ')}. Orbit and Zed are alternatives.`;
  const discoveries = [{ name: 'Orbit', domain: 'orbit.example' }, { name: 'Zed', domain: null }, { name: 'Absent', domain: null }];
  const read = researchInput(answer, targets, [...words, { name: 'Orbit', domain: null }], 'software', discoveries);
  const candidates = read.options.filter((option) => option.kind === 'candidate').map((option) => option.name);
  assert.deepEqual(candidates.slice(0, 2), ['Orbit', 'Zed']);
  assert.equal(candidates.includes('Absent'), false);
  assert.equal(candidates.filter((name) => name === 'Orbit').length, 1);
  assert.equal(candidates.length, 2 + 10);
  // Only the monitored brands the answer names are asked: every one of them, none of the others.
  assert.deepEqual(read.options.filter((option) => option.kind === 'tracked').map((option) => option.name), targets.filter((target) => answer.includes(target.name)).map((target) => target.name));
  assert.deepEqual(matchedDiscoveries(answer, discoveries).map((item) => item.name), ['Orbit', 'Zed']);
});
test('distant repeated mentions offer each criterion in every window, and the reading keeps the quotes that show them', () => {
  const distant = researchInput(
    'Acme is excellent, with 3,000 clients. ' +
      'Context without identities. '.repeat(65) +
      ' Acme has very poor support.',
    targets.slice(0, 1),
    [],
    'software',
  );
  const payload = decisionRequest(distant, 'jev');
  assert.equal(payload.state.evidence.b0.length, 2);
  assert.deepEqual(Object.keys(payload.questions.b0_criticized.criteria), ['yes:0', 'yes:1', 'no']);
  const read = (picks: Record<string, string>) =>
    parseDecisionResponse({ model: RESEARCH_MODELS.jev, answers: modelAnswers(payload, (id) => picks[id]), usage: { cost: 0.0001 } }, distant, 'jev').readings[0]!;
  const negative = read({ b0_reservation: 'yes:1', b0_criticized: 'yes:1' });
  assert.deepEqual([negative.score, negative.sentiment, negative.criteria], [15, 'negative', { reservation: 0, criticized: 0 }]);
  assert.equal(negative.evidence.length, 1);
  assert.match(negative.evidence[0]!, /poor support/);
  // Two windows cited: both quotes kept in answer order, each criterion pointing to its own.
  const mixed = read({ b0_criticized: 'yes:1', b0_praised: 'yes:0' });
  assert.deepEqual([mixed.score, mixed.sentiment, mixed.criteria], [45, 'neutral', { praised: 0, criticized: 1 }]);
  assert.match(mixed.evidence[0]!, /3,000 clients/);
  assert.match(mixed.evidence[1]!, /poor support/);
  // No criterion met: a plain mention keeps its first window.
  const plainMention = read({});
  assert.deepEqual([plainMention.score, plainMention.criteria, plainMention.evidence.length], [50, {}, 1]);
});

test('bounded provider text preserves Unicode and original verbatim evidence at every cut', () => {
  const original = 'x'.repeat(15999) + '👈 Acme is excellent.';
  assert.equal(sliceUnicode(original, 0, 16000), 'x'.repeat(15999));
  assert.doesNotThrow(() =>
    encodeURIComponent(sliceUnicode(original, 16000, original.length)),
  );
  assert.equal(sliceUnicode('👈', 1, 2), '');
  const clipped = researchInput(
    original,
    targets,
    [],
    'x'.repeat(299) + '👈 software',
  );
  assert.equal(clipped.excerpt, 'x'.repeat(15999));
  assert.equal(clipped.category, 'x'.repeat(299));
  assert.equal(clipped.fullCoverage, false);
  assert.equal(original, 'x'.repeat(15999) + '👈 Acme is excellent.');
  const answers = [
    'x'.repeat(10) +
      '👈' +
      'x'.repeat(348) +
      ' Acme is excellent. ' +
      'y'.repeat(1000),
    'Acme ' + 'x'.repeat(548) + '👈' + 'y'.repeat(1000),
  ];
  for (const answer of answers) {
    const source = researchInput(answer, targets.slice(0, 1), [], 'software');
    const payload = decisionRequest(source, 'jev');
    const walk = (value: unknown) => {
      if (typeof value === 'string')
        assert.doesNotThrow(
          () => encodeURIComponent(value),
          'Every provider string must contain complete Unicode code points.',
        );
      else if (value && typeof value === 'object')
        for (const nested of Object.values(value)) walk(nested);
    };
    walk(payload);
    for (const window of payload.state.evidence.b0) {
      assert.ok(answer.includes(window));
      assert.ok(window.length <= 1200);
    }
    const parsed = parseDecisionResponse(
      { model: RESEARCH_MODELS.jev, answers: modelAnswers(payload, (id) => (id === 'b0_recommended' ? 'yes:0' : undefined)), usage: { cost: 0 } },
      source,
      'jev',
    );
    assert.equal(parsed.readings[0].sentiment, 'positive');
    assert.ok(
      parsed.readings[0].evidence.every((window) => answer.includes(window)),
    );
  }
});

for (const provider of ['liquid', 'jev', 'decisions'] as const) {
  test(`${provider} accepts a distribution rounded to two decimals; a yes spread over windows is one yes`, () => {
    const detailed = researchInput(
      [
        'Acme is excellent.',
        'Acme is affordable.',
        'Acme has good support.',
      ].join(' Filler.'.repeat(200)),
      [targets[0]],
      [],
      'software',
    );
    const request = decisionRequest(detailed, provider);
    const labels = Object.keys(request.questions.b0_recommended.criteria);
    assert.deepEqual(labels, ['yes:0', 'yes:1', 'yes:2', 'no']);
    // Each window alone is far less likely than no, but yes in any window (0.51) outweighs it (0.48); the sum is 0.99.
    const rounded = { 'yes:0': 0.17, 'yes:1': 0.17, 'yes:2': 0.17, no: 0.48 };
    const raw = {
      model: RESEARCH_MODELS[provider],
      answers: { ...modelAnswers(request), b0_recommended: { type: 'choice', choice: 'no', probabilities: rounded as Record<string, number> } },
      usage: { cost: 0.00036 },
    };
    const reading = parseDecisionResponse(raw, detailed, provider).readings[0]!;
    assert.deepEqual([reading.score, reading.sentiment, reading.criteria], [70, 'positive', { recommended: 0 }]);
    assert.deepEqual(raw.answers.b0_recommended.probabilities, rounded, 'Probabilities are not rewritten');
    raw.answers.b0_recommended.probabilities = Object.fromEntries(labels.map((label) => [label, 0.07]));
    assert.throws(() => parseDecisionResponse(raw, detailed, provider), /probabilities/);
    raw.answers.b0_recommended.probabilities = Object.fromEntries(labels.map((label) => [label, 0]));
    assert.throws(() => parseDecisionResponse(raw, detailed, provider), /probabilities/);
  });
}

test('a brand the answer names is scored; one it only lists is a plain mention (50) with nothing to ask', () => {
  const brands = [targets[0], targets[1], { name: 'Zeta', domain: 'zeta.example' }];
  const read = researchInput('Acme is the best tool for small teams.\n\nOther options:\n- Nova\n- **Orbit**, Kappa and Lumen\n\n## Final', brands, [], 'software');
  const request = decisionRequest(read, 'liquid');
  const labels = (id: string) => Object.keys(request.questions[id]!.criteria);
  assert.deepEqual(labels('b0'), ['brand', 'ambiguous'], 'Acme is described: it gets a score');
  assert.ok(request.questions.b0_recommended);
  assert.deepEqual(labels('b1'), ['brand', 'ambiguous'], 'Nova is only a list item: still a brand');
  assert.equal(request.questions.b1_recommended, undefined, 'nothing to ask about a bare list item');
  assert.equal(request.questions.b2, undefined, 'Zeta is not in the answer: it is not asked');
  const readings = parseDecisionResponse({ model: RESEARCH_MODELS.liquid, answers: modelAnswers(request, (id) => (id === 'b0_leader' ? 'yes:0' : undefined)), usage: { cost: 0 } }, read, 'liquid').readings;
  assert.deepEqual(readings.map((reading) => [reading.id, reading.score, reading.criteria]), [['b0', 65, { leader: 0 }], ['b1', 50, {}]]);
  // A name that means another entity here, or one the excerpt does not name, has no score.
  const ambiguous = parseDecisionResponse({ model: RESEARCH_MODELS.liquid, answers: modelAnswers(request, (id) => (id === 'b1' ? 'ambiguous' : undefined)), usage: { cost: 0 } }, read, 'liquid').readings;
  assert.deepEqual(ambiguous.map((reading) => [reading.id, reading.state, reading.score]), [['b0', 'assessed', 50], ['b1', 'ambiguous', null]]);
  const option = (name: string) => ({ id: name, name, domain: null, kind: 'tracked' as const });
  const options = ['Acme', 'Nova', 'Orbit'].map(option);
  assert.equal(onlyListed('- Nova\n- **Orbit**', option('Orbit'), options), true);
  assert.equal(onlyListed('- Acme, Nova and Orbit\n\n## Next', option('Nova'), options), true);
  assert.equal(onlyListed('- Nova: cheap and fast', option('Nova'), options), false, 'a description follows the name');
  assert.equal(onlyListed('- **Nova**\n  - cheap and fast', option('Nova'), options), false, 'an indented line describes it');
  assert.equal(onlyListed('### Nova\nCheap and fast.', option('Nova'), options), false, 'a heading introduces a description');
  assert.equal(onlyListed('- Nova\nNova is cheap.', option('Nova'), options), false, 'named again in prose');
});

test('with probabilities the reading is the likeliest answer over every evidence window, not the sampled choice', () => {
  assert.equal(decidedChoice('no', { 'yes:0': 0.3, 'yes:1': 0.25, no: 0.45 }), 'yes:0', 'yes in two windows together outweighs no');
  assert.equal(decidedChoice('yes:1', { 'yes:0': 0.2, 'yes:1': 0.2, no: 0.6 }), 'no');
  assert.equal(decidedChoice('yes:1', { 'yes:0': 0.25, 'yes:1': 0.25, no: 0.5 }), 'yes:0', 'a tie keeps the sampled answer, in its first likeliest window');
  assert.equal(decidedChoice('brand', { brand: 0.4, ambiguous: 0.6 }), 'ambiguous');
  assert.equal(decidedChoice('other', { competitor: 0.7, other: 0.3 }), 'competitor');
  assert.equal(decidedChoice('no', null), 'no', 'without probabilities, the choice');
  assert.equal(decidedChoice('no', {}), 'no');
});

test('without probabilities sentiment is asked three times and takes the majority of each criterion; with them, once', async () => {
  // `samples`: what each call answers for Acme's "recommended"; everything else is plain.
  const answers = (samples: string[], probabilities = false) => {
    let call = 0;
    const sent: unknown[] = [];
    const send = async (payload: unknown) => {
      sent.push(payload);
      const sample = samples[call++ % samples.length]!;
      const request = payload as Request;
      return Response.json({ model: request.model, answers: modelAnswers(request, (id) => (id === 'b0_recommended' ? sample : undefined), probabilities), usage: { cost: 0.0004 } });
    };
    return { send, sent };
  };
  const brands = [targets[0], { name: 'Zeta', domain: 'zeta.example' }];
  const ask = (send: (payload: unknown) => Promise<Response>) => classifyBrandSentiment({ question: 'Best tool?', answer: 'Acme is fine for small teams.', brands }, { send });
  const sampled = answers(['yes:0', 'no', 'yes:0']);
  const result = await ask(sampled.send);
  assert.equal(sampled.sent.length, SENTIMENT_SAMPLES);
  assert.deepEqual(result.brands.map((item) => [item.brand, item.state, item.score, item.criteria]), [['Acme', 'assessed', 70, { recommended: 0 }]], 'Zeta is not named: not asked');
  assert.ok(Math.abs(result.cost! - 0.0012) < 1e-12, 'three calls, still far under the job reserve of US$ 0.02');
  const decided = answers(['no'], true);
  assert.equal((await ask(decided.send)).brands[0]!.score, 50);
  assert.equal(decided.sent.length, 1);
  // A later call that may have been billed leaves the cost unknown (the job keeps its reservation); a refusal of the first is returned as is.
  let calls = 0;
  const flaky = steadySentiment(async (payload) => (calls++ === 1 ? new Response('', { status: 502 }) : answers(['yes:0'])[`send`](payload)));
  const raw = (await (await flaky(decisionRequest(researchInput('Acme is fine.', brands, [], 'software'), 'liquid'))).json()) as { usage: Record<string, unknown>; answers: Record<string, { choice: string }> };
  assert.equal(raw.usage.cost, undefined);
  assert.equal(raw.answers.b0_recommended!.choice, 'yes:0');
  assert.equal((await steadySentiment(async () => new Response('', { status: 429 }))({})).status, 429);
  assert.equal(combineChoices(['no', 'yes:0', 'yes:2']), 'yes:0', 'two yes outvote one no, in the first window cited');
  assert.equal(combineChoices(['no', 'no', 'yes:0']), 'no');
  assert.equal(combineChoices(['yes:1', 'no']), 'yes:1', 'a tie keeps the first sample');
  assert.equal(combineChoices(['other', 'competitor', 'competitor']), 'competitor');
});

test('the same input classified 10 times gives the same criteria every time, with or without probabilities', async () => {
  // A hesitant model: one sample in three flips each criterion, and its probabilities lean only slightly to the right answer.
  let call = 0;
  const truth: Record<string, string> = { b0_recommended: 'yes:0', b0_praised: 'yes:0', b1_reservation: 'yes:0' };
  const send = (probabilities: boolean) => async (payload: unknown) => {
    const request = payload as Request;
    const flip = call++ % 3 === 2;
    const answers = modelAnswers(request, (id, labels) => {
      const right = truth[id] ?? plain(id, labels);
      return flip && labels.includes('no') ? (right === 'no' ? labels[0] : 'no') : right;
    }, false);
    if (probabilities)
      for (const [id, answer] of Object.entries(answers)) {
        const labels = Object.keys(request.questions[id]!.criteria);
        const right = truth[id] ?? plain(id, labels);
        answer.probabilities = Object.fromEntries(labels.map((label) => [label, labels.length === 2 ? (label === right ? 0.6 : 0.4) : label === right ? 0.55 : Number((0.45 / (labels.length - 1)).toFixed(4))]));
      }
    return Response.json({ model: request.model, answers, usage: { cost: 0.0004 } });
  };
  for (const probabilities of [false, true]) {
    const seen = new Set<string>();
    for (let run = 0; run < 10; run++) {
      const { brands } = await classifyBrandSentiment({ question: 'Best tool?', answer: 'Acme won 3 awards and is recommended. Nova is fine but costly.', brands: targets }, { send: send(probabilities) });
      seen.add(JSON.stringify(brands.map((brand) => [brand.brand, brand.score, brand.criteria])));
    }
    assert.deepEqual([...seen], [JSON.stringify([['Acme', 85, { recommended: 0, praised: 0 }], ['Nova', 35, { reservation: 0 }]])], `probabilities: ${probabilities}`);
  }
});

test('an answer naming 30 brands is read for all of them in one call, and the 30 readings parse', () => {
  const brands = Array.from({ length: 30 }, (_, index) => ({ name: `Brand${String(index).padStart(2, '0')}`, domain: null }));
  const answer = `Acme and Nova lead. ${brands.map((brand, index) => `${brand.name} is ${index % 2 ? 'a solid' : 'an affordable'} option.`).join(' ')}`;
  const read = researchInput(answer, targets, [], 'software', [...brands, { name: 'Absent', domain: null }], 'Which tool?');
  assert.equal(read.options.length, 2 + 30);
  assert.equal(read.everyBrand, true);
  const request = decisionRequest(read, 'liquid');
  // The identity and the criteria per brand; a discovery's role is the roles classifier's (8/11/2026), asked here only by an older input.
  assert.equal(Object.keys(request.questions).length, 32 * (1 + CRITERIA.length));
  assert.equal(Object.keys(decisionRequest({ ...read, withoutRoles: undefined }, 'liquid').questions).length, 32 * (1 + CRITERIA.length) + 30);
  const answers = modelAnswers(request, (id) => (id.endsWith('_praised') ? 'yes:0' : undefined));
  const { readings } = parseDecisionResponse({ model: RESEARCH_MODELS.liquid, answers, usage: { cost: 0.0004 } }, read, 'liquid');
  assert.equal(readings.length, 32);
  assert.ok(readings.every((reading) => reading.state === 'assessed' && reading.score === 65));
});

// Comparisons (03/11/2026): the brand held up as the better reference ("Y-esque", "like a Y", "quase tão bom quanto Y") is
// praised; the brand compared to it stays neutral from that comparison. Fixtures only: the model's answers are given.
test('a comparison praises the reference and leaves the compared brand neutral, in English and Portuguese', () => {
  const brands = [
    { name: 'Orbit', domain: 'orbit.example' },
    { name: 'Lumen', domain: 'lumen.example' },
  ];
  for (const answer of [
    'For beginners, the Lumen Band is a good pick: an Orbit-esque design, almost as good as the Orbit Watch, at half the price.',
    'Para iniciantes, a Lumen Band é uma boa escolha: design no estilo do Orbit Watch, quase tão boa quanto o Orbit, pela metade do preço.',
  ]) {
    const read = researchInput(answer, brands, [], 'wearables');
    const request = decisionRequest(read, 'liquid');
    // The rule is said in every criterion of both brands, so neither reads the comparison as anything else.
    for (const id of ['b0', 'b1'])
      for (const criterion of CRITERIA) assert.match(request.questions[`${id}_${criterion}`]!.instructions, /that comparison is not this for (Orbit|Lumen) \(it praises the other brand\)/u, `${id}_${criterion}`);
    assert.match(request.questions.b0_praised!.instructions, /counts as praise of Orbit/u);
    assert.match(request.questions.b0_leader!.instructions, /treats it as the benchmark/u);
    assert.ok(!request.questions.b0_praised!.instructions.includes('NAME'), 'every placeholder replaced');
    // The model reads it as the rule says: praise of the reference, nothing for the compared brand from it.
    const readings = parseDecisionResponse(
      { model: RESEARCH_MODELS.liquid, answers: modelAnswers(request, (id) => (id === 'b0_praised' ? 'yes:0' : undefined)), usage: { cost: 0 } },
      read,
      'liquid',
    ).readings;
    assert.deepEqual(readings.map((reading) => [reading.id, reading.score, reading.sentiment]), [['b0', 65, 'positive'], ['b1', 50, 'neutral']], answer);
  }
});

test('only the questions that came back without probabilities are asked again, and the calls are counted', async () => {
  const read = researchInput('Acme is fine for small teams. Nova is costly.', targets, [], 'software');
  const request = decisionRequest(read, 'liquid');
  const sent: Request[] = [];
  const send = async (payload: unknown) => {
    const asked = payload as Request;
    sent.push(asked);
    const answers = modelAnswers(asked, (id) => (id === 'b0_recommended' ? 'yes:0' : undefined));
    // The first reply leaves one question without probabilities; the samples answer without them.
    if (sent.length === 1) delete answers.b0_recommended!.probabilities;
    else for (const answer of Object.values(answers)) delete answer.probabilities;
    return Response.json({ model: asked.model, answers, usage: { cost: 0.0004 } });
  };
  const raw = (await (await steadySentiment(send)(request)).json()) as { usage: { cost: number; calls: number } };
  assert.equal(sent.length, SENTIMENT_SAMPLES);
  assert.deepEqual(sent.slice(1).map((asked) => Object.keys(asked.questions)), [['b0_recommended'], ['b0_recommended']]);
  assert.deepEqual(sent[1]!.state, request.state, 'the same state');
  assert.equal(raw.usage.calls, SENTIMENT_SAMPLES);
  assert.ok(Math.abs(raw.usage.cost - 0.0012) < 1e-12);
  const parsed = parseDecisionResponse(raw, read, 'liquid');
  assert.deepEqual([parsed.readings[0]!.score, parsed.calls], [70, SENTIMENT_SAMPLES]);
  // Every question with probabilities: one call.
  const once = steadySentiment(async (payload) => Response.json({ model: (payload as Request).model, answers: modelAnswers(payload as Request), usage: { cost: 0.0004 } }));
  assert.equal(((await (await once(request)).json()) as { usage: { calls: number } }).usage.calls, 1);
});

test('decision roots: common words keep the model, known names skip identity, list-only names and saved windows skip the call', () => {
  const unmeasured = { names: new Set<string>(), measured: false };
  const measured = { names: new Set(['conversion']), measured: true };
  const option = (name: string, kind: 'tracked' | 'candidate' = 'tracked') => ({ id: 'b0', name, domain: null, kind, aliases: [] });
  // Two words, a symbol or an inner capital: no common word, unless the answer writes it in lowercase.
  assert.equal(maybeCommonWord('Agência Mestre leads.', option('Agência Mestre'), unmeasured), false);
  assert.equal(maybeCommonWord('Disney+ and LiveSEO.', option('Disney+'), unmeasured), false);
  assert.equal(maybeCommonWord('the search lab tested it; Search Lab too', option('Search Lab'), unmeasured), true);
  // One plain word: a possible dictionary word until the store measured it, and always for a discovered name.
  assert.equal(maybeCommonWord('Netflix is great.', option('Netflix'), unmeasured), true);
  assert.equal(maybeCommonWord('Netflix is great.', option('Netflix'), measured), false);
  assert.equal(maybeCommonWord('Netflix is great.', option('Netflix', 'candidate'), measured), true);
  assert.equal(maybeCommonWord('Conversion is great.', option('Conversion'), measured), true);
  assert.equal(maybeCommonWord('an apple a day. Apple is great.', option('Apple'), { names: new Set(), measured: true }), true);

  const listed = researchInput('Options:\n\n- Orbit Labs\n- Nova Desk', [{ name: 'Orbit Labs', domain: '' }, { name: 'Nova Desk', domain: '' }], [], 'software');
  const all = sentimentCascade(listed);
  assert.equal(all.ask, null, 'nothing is left for the model');
  const merged = mergedReadings(listed, all.readings);
  assert.deepEqual(merged.map((reading) => [reading.id, reading.state, reading.score, reading.evidence.length]), [['b0', 'assessed', 50, 1], ['b1', 'assessed', 50, 1]]);

  const described = researchInput('Orbit Labs is the best tool. Nova Desk is slow.', [{ name: 'Orbit Labs', domain: '' }, { name: 'Nova Desk', domain: '' }], [], 'software');
  const saved = { id: 'x', state: 'assessed' as const, sentiment: 'positive' as const, score: 85, candidate: null, evidence: [researchEvidence(described).b0[0]], criteria: { recommended: 0, leader: 0 } };
  const partly = sentimentCascade(described, undefined, (item) => (item.id === 'b0' ? saved : undefined));
  assert.deepEqual(partly.readings.map((reading) => [reading.id, reading.score]), [['b0', 85]]);
  const request = decisionRequest(partly.ask!, 'jev');
  assert.deepEqual(Object.keys(request.questions).filter((key) => !key.includes('_')), [], 'no identity question for known names');
  assert.ok(Object.keys(request.questions).every((key) => key.startsWith('b1_')), 'the saved brand is not asked');
  assert.deepEqual(request.state.identities, described.options, 'the model reads the same state');
  // An input built before roles left the sentiment request is sent as it is.
  assert.equal(sentimentCascade({ ...described, withoutRoles: undefined }).ask?.options, described.options);
});
