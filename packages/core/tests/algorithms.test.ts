import test from 'node:test';
import assert from 'node:assert/strict';
import { ALGORITHM_VERSION, ALGORITHMS } from '../lib/algorithms.ts';
import { DETECTOR_VERSION } from '../lib/competitor-discovery.ts';
import { POSITIONS_BASIS_SUFFIX, POSITIONS_VERSION } from '../lib/run-positions.ts';
import { SOURCE_TYPE_RUBRIC } from '../lib/source-types.ts';
import { BRAND_RESEARCH_RUBRIC } from '../lib/brand-research.ts';
import { RESEARCH_ADAPTER_VERSION } from '../lib/brand-research-provider.ts';
import { QUESTION_ROLE_CONTEXT, ROLE_ADAPTER_VERSION } from '../lib/brand-roles.ts';

test('every module shows version 0.1', () => {
  assert.equal(ALGORITHM_VERSION, '0.1');
  for (const algorithm of ALGORITHMS) assert.equal(algorithm.version, '0.1', algorithm.id);
});

// The label is not the key. Stored results are identified by these constants (the detector an analysis recorded, the
// basis of a brand rank, the rubric of a catalog row, the context of a sentiment or role reading). Changing one of these
// on purpose is an algorithm change and needs its own migration story: the detector went to structure-v5 and
// then v6 (titles and families), so every analysis made by an older one reads as stale until Admin › Algorithms
// reprocesses it (free; the registry recommends it). The role adapter went to v3 (the not_brand verdict): its pass asks
// again only the names the migration left unsettled, so no paid reprocess is recommended. Then the source-type
// question changed and rules were added (the basis names both, the rubric stays, the paid reclassification is recommended),
// sentiment moved to the 0–10 score (brand-nps-v1) and then to the 0–100 score by criteria (brand-criteria-v1): earlier readings
// stay and are not counted until Admin › Algorithms reprocesses them (paid, recommended).
// The detector also moved to structure-v7 (the same answers give the same brands however they are paged): free reprocess.
// And the role criteria to v4 (a competitor sells what the project sells; platforms are suppliers; a tracked brand's
// product is that brand): verdicts carry their criteria, so the scheduler decides every name again by itself (paid, cents).
// Then the detector moved to structure-v8 (the pass recounts the project's names with the folding matcher): free reprocess.
// Then to structure-v9 (names that are common words count by their evidence; the model settles the rest, US$ 30 in all), and
// positions to version 3 (a brand the answer does not mention ranks no one down): free, the checks within their total.
// Then structure-v10 (a spelling inside longer capitalized terms, "Conversion Rate Optimization", is a common word too): free.
// Then structure-v11 (another company's longer name, "AIM Conversion Experts", is no mention): free. Then structure-v12
// (rules without word lists, the model asked by the exact question and counted by probability, brand-mentions:v2/m2): free,
// the questions within each project's budget. Then structure-v13 (a common-word spelling claims only itself in discovery), then
// structure-v14 (a longer name holding a monitored competitor's name is one name question per pair), then structure-v15 (the
// project's known brands found by their spellings first, a name spelled like a linked site). Sentiment questions q2 (11/11/2026):
// the negative criteria ask for something concrete said of the brand.
test('internal basis keys identify stored data; the detector, source types and sentiment changed and their reprocess is recommended', () => {
  assert.equal(DETECTOR_VERSION, 'structure-v15');
  assert.equal(ALGORITHMS.find((algorithm) => algorithm.id === 'detector')?.reprocessRecommended, true);
  assert.equal(ALGORITHMS.find((algorithm) => algorithm.id === 'sentiment')?.reprocessRecommended, true);
  assert.equal(POSITIONS_VERSION, 3);
  // Version 2 saves where each brand is first named, so positions rank among every identified brand: every answer
  // is ranked again, free, on the next read.
  assert.equal(POSITIONS_BASIS_SUFFIX, '#3');
  assert.equal(SOURCE_TYPE_RUBRIC, 'source-types-v1', 'the source-type change keeps the rubric: a catalog row stays readable; the question and the rules carry the change');
  assert.equal(ALGORITHMS.find((algorithm) => algorithm.id === 'source-types')?.reprocessRecommended, true);
  assert.equal(BRAND_RESEARCH_RUBRIC, 'brand-criteria-v1');
  assert.equal(RESEARCH_ADAPTER_VERSION, 'openrouter-alpha-decisions-v2');
  assert.equal(QUESTION_ROLE_CONTEXT, 'brand-roles:q1');
  assert.equal(ROLE_ADAPTER_VERSION, 'v4');
  assert.deepEqual(
    Object.fromEntries(ALGORITHMS.map((algorithm) => [algorithm.id, algorithm.basis])),
    { detector: 'structure-v15', positions: 'v3', sentiment: 'brand-criteria-v1/openrouter-alpha-decisions-v2/q2', 'mention-checks': 'brand-mentions:v2/m5/m6', 'question-roles': 'brand-roles:q1/v4', 'source-types': 'source-types-v1/domain-prompt-v2/rules-v2' },
  );
  // The project store's rule (`staleDetector`): an analysis is stale only when its recorded detector differs from the code's.
  const stale = (recorded: string | null) => !!recorded && recorded !== DETECTOR_VERSION;
  assert.equal(stale('structure-v15'), false, 'an analysis made by the current detector is current');
  assert.equal(stale('structure-v13'), true, 'structure-v14 (name questions) reads every answer again');
  assert.equal(stale('structure-v12'), true, 'an analysis made by the structure-v12 detector waits for the reprocess');
  assert.equal(stale('structure-v11'), true, 'an analysis made by the structure-v11 detector waits for the reprocess');
  assert.equal(stale('structure-v10'), true, 'an analysis made by the structure-v10 detector waits for the reprocess');
  assert.equal(stale('structure-v9'), true, 'an analysis made by the first structure-v9 detector waits for the reprocess');
  assert.equal(stale('structure-v8'), true, 'an analysis made by the structure-v8 detector waits for the reprocess');
  assert.equal(stale('structure-v7'), true, 'an analysis made by the structure-v7 detector waits for the reprocess');
  assert.equal(stale('structure-v6'), true, 'an analysis made by the structure-v6 detector waits for the reprocess');
  assert.equal(stale('structure-v5'), true, 'an analysis made by the structure-v5 detector waits for the reprocess');
  assert.equal(stale('structure-v4'), true, 'an analysis made by the structure-v4 detector waits for the reprocess');
  assert.equal(stale(null), false);
});
