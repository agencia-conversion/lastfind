import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesBrand,
  firstMentionPosition,
  sliceUnicode,
} from '../lib/metrics.ts';
import {
  researchInput,
  parseResearchReadings,
  summarizeSentiment,
  type ResearchObservation,
} from '../lib/brand-research.ts';
import {
  decisionRequest,
  parseDecisionResponse,
  RESEARCH_MODELS,
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
);
function response(provider: 'jev' | 'decisions') {
  const request = decisionRequest(input, provider);
  const answers = Object.fromEntries(
    Object.entries(request.questions).map(([id, question]) => {
      const choices = Object.keys(question.criteria),
        choice =
          choices.find((label) =>
            label.startsWith(id === 'b0' ? 'mixed:' : 'negative:'),
          ) || 'insufficient';
      return [
        id,
        {
          type: 'choice',
          choice,
          confidence: 0.8,
          probabilities: Object.fromEntries(
            choices.map((label) => [label, label === choice ? 1 : 0]),
          ),
        },
      ];
    }),
  );
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
for (const provider of ['jev', 'decisions'] as const)
  test(`${provider} typed contract validates closed identities, distributions and verbatim evidence`, () => {
    const payload = decisionRequest(input, provider);
    assert.equal(payload.model, RESEARCH_MODELS[provider]);
    const parsed = parseDecisionResponse(response(provider), input, provider);
    assert.equal(parsed.readings[0].sentiment, 'mixed');
    assert.equal(parsed.readings[1].sentiment, 'negative');
    assert.ok(input.excerpt.includes(parsed.readings[0].evidence[0]));
    const unknown = response(provider);
    unknown.answers.b0.choice = 'invented';
    assert.throws(
      () => parseDecisionResponse(unknown, input, provider),
      /Unknown/,
    );
    const missing = response(provider);
    delete (missing.answers as Record<string, unknown>).b0;
    assert.throws(
      () => parseDecisionResponse(missing, input, provider),
      /Incomplete/,
    );
    const probability = response(provider);
    probability.answers.b0.probabilities.insufficient = -0.2;
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
  readings[0] = {
    ...readings[0],
    state: 'insufficient',
    sentiment: null,
    evidence: [],
  };
  assert.equal(parseResearchReadings({ readings }, input)[0].sentiment, null);
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
    candidate: null,
    evidence: ['Acme is excellent.'],
  },
};
test('questions count once despite repeats, collections and engines; opposing views compose mixed', () => {
  const observations = [
    base,
    base,
    {
      ...base,
      engine: 'gemini',
      runId: 'run2',
      reading: { ...base.reading!, sentiment: 'negative' as const },
    },
    { ...base, runId: 'older', createdAt: '2026-10-14T12:00:00Z' },
  ];
  const summary = summarizeSentiment(observations).brands[0];
  assert.equal(summary.prompts, 1);
  assert.equal(summary.assessed, 1);
  assert.equal(summary.distribution.mixed, 1);
  assert.equal(summary.distribution.positive, 0);
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
test('distant repeated mentions retain both supporting windows for mixed sentiment', () => {
  const distant = researchInput(
    'Acme is excellent. ' +
      'Context without identities. '.repeat(65) +
      ' Acme has very poor support.',
    targets.slice(0, 1),
    [],
    'software',
  );
  const payload = decisionRequest(distant, 'jev');
  assert.ok(payload.questions.b0.criteria['mixed:0,1']);
  const choices = Object.keys(payload.questions.b0.criteria);
  const parsed = parseDecisionResponse(
    {
      model: RESEARCH_MODELS.jev,
      answers: {
        b0: {
          type: 'choice',
          choice: 'mixed:0,1',
          probabilities: Object.fromEntries(
            choices.map((choice) => [choice, choice === 'mixed:0,1' ? 1 : 0]),
          ),
        },
      },
      usage: { cost: 0.0001 },
    },
    distant,
    'jev',
  );
  assert.equal(parsed.readings[0].evidence.length, 2);
  assert.match(parsed.readings[0].evidence[0], /excellent/);
  assert.match(parsed.readings[0].evidence[1], /poor support/);
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
    const choices = Object.keys(payload.questions.b0.criteria);
    const parsed = parseDecisionResponse(
      {
        model: RESEARCH_MODELS.jev,
        answers: {
          b0: {
            type: 'choice',
            choice: 'positive:0',
            probabilities: Object.fromEntries(
              choices.map((choice) => [
                choice,
                choice === 'positive:0' ? 1 : 0,
              ]),
            ),
          },
        },
        usage: { cost: 0 },
      },
      source,
      'jev',
    );
    assert.equal(parsed.readings[0].sentiment, 'positive');
    assert.ok(
      parsed.readings[0].evidence.every((window) => answer.includes(window)),
    );
  }
});
