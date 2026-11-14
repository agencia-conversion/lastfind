import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criteriaScore, researchInput, sentimentBand } from '../lib/brand-research.ts';
import { decisionRequest, parseDecisionResponse, RESEARCH_ADAPTER_VERSION, researchEvidence, SENTIMENT_QUESTIONS_VERSION, windowMaterial } from '../lib/brand-research-provider.ts';

// Real answers the project owner reviewed on 11/11/2026: both read Conversion as a detractor, though neither advises against it nor
// states a concrete problem of it ("Uma das maiores do país, mas possui formatos escaláveis..."; a comparison table row of
// big consultancies, "ex: Conversion").
const fixture = JSON.parse(readFileSync(new URL('./fixtures/easy-start-answers.json', import.meta.url), 'utf8')) as {
  question: string;
  answers: Record<'aiMode' | 'aiOverviews', { answer: string }>;
};
const targets = [
  { name: 'Conversion', domain: 'conversion.com.br' },
  { name: 'Agência Mestre', domain: 'agenciamestre.com' },
];
const inputOf = (excerpt: string, question = fixture.question) => researchInput(excerpt, targets, [], 'SEO agency', [], question);
const negatives = ['reservation', 'criticized', 'against'] as const;

test('the negative criteria ask for something concrete said of the brand itself (questions q2)', () => {
  // A new question version keys the saved window readings (never reused across versions) but not a reading's context: the
  // readings already made keep counting until a sentiment reprocess reads their answers again.
  assert.equal(SENTIMENT_QUESTIONS_VERSION, 'q2');
  assert.equal(RESEARCH_ADAPTER_VERSION, 'openrouter-alpha-decisions-v2');
  assert.ok(windowMaterial({ id: 'b0', name: 'Conversion', domain: null, kind: 'tracked' }, ['x']).includes('"q2"'));
  for (const key of ['aiMode', 'aiOverviews'] as const) {
    const input = inputOf(fixture.answers[key].answer);
    const conversion = input.options.find((option) => option.name === 'Conversion')!;
    // The evidence the model reads holds the real sentence.
    const windows = researchEvidence(input)[conversion.id]!;
    assert.ok(windows.some((window) => (key === 'aiMode' ? /Uma das maiores do país, mas possui/u : /Grandes Consultorias \(ex: \[?Conversion/u).test(window)));
    const request = decisionRequest(input, 'jev');
    for (const criterion of negatives) {
      const instructions = request.questions[`${conversion.id}_${criterion}`]!.instructions;
      // Hedge or contrast with no concrete negative, fit and a group trait are none of them; said with the brand's name.
      assert.match(instructions, /contrast or hedge that states no concrete negative about Conversion/u);
      assert.match(instructions, /who Conversion is built for/u);
      assert.match(instructions, /a whole group or category that Conversion is only an example of/u);
      assert.doesNotMatch(instructions, /NAME/u);
    }
    assert.match(request.questions[`${conversion.id}_reservation`]!.instructions, /A "but" alone is not a limitation/u);
    assert.doesNotMatch(request.questions[`${conversion.id}_reservation`]!.instructions, /or a "but"\?/u);
  }
});

/** The model's reply for one answer: `met` criteria are yes in window 0, every other question no (or brand). */
function reply(input: ReturnType<typeof inputOf>, met: Record<string, string[]>) {
  const request = decisionRequest(input, 'jev');
  const answers = Object.fromEntries(
    Object.entries(request.questions).map(([id, question]) => {
      const labels = Object.keys(question.criteria);
      const [option, criterion] = id.split('_') as [string, string | undefined];
      const choice = !criterion ? (labels.includes('brand') ? 'brand' : 'insufficient') : met[option]?.includes(criterion) ? 'yes:0' : 'no';
      return [id, { type: 'choice', choice, probabilities: Object.fromEntries(labels.map((label) => [label, label === choice ? 1 : 0])) }];
    }),
  );
  return parseDecisionResponse({ model: request.model, answers }, input, 'jev').readings;
}

test('the real hedged answers score neutral or better when no negative criterion is met; a concrete one stays a detractor', () => {
  const aiMode = inputOf(fixture.answers.aiMode.answer);
  const conversion = aiMode.options.find((option) => option.name === 'Conversion')!.id;
  // Read under the new rubric: the "mas" sentence states nothing negative. A plain mention (50) is neutral.
  const hedged = reply(aiMode, {}).find((reading) => reading.id === conversion)!;
  assert.equal(hedged.score, 50);
  assert.equal(hedged.sentiment, 'neutral');
  // Before (v2) the "but" alone was a reservation, and the table row a criticism and advice against: 35 and 0, detractors.
  assert.equal(sentimentBand(criteriaScore(['reservation'])), 'negative');
  assert.equal(criteriaScore(['reservation', 'criticized', 'against']), 0);
  // Counter-examples that must stay detractors (the scale is unchanged): a concrete limitation, a criticism, advice against.
  const counter = inputOf(
    'Conversion is expensive and has no plan for small sites. Clients complain that Conversion missed deadlines. Avoid Conversion if you are starting out.',
    'Which SEO agency is easiest to start with?',
  );
  const id = counter.options.find((option) => option.name === 'Conversion')!.id;
  for (const criteria of [['reservation'], ['criticized'], ['against'], ['reservation', 'criticized', 'against']]) {
    const reading = reply(counter, { [id]: criteria }).find((item) => item.id === id)!;
    assert.equal(reading.sentiment, 'negative', criteria.join('+'));
    assert.ok(reading.score! < 40);
  }
});
