import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import model from '../lib/competitor-discovery-model.json' with { type: 'json' };
import roleModel from '../lib/competitor-entity-role-model.json' with { type: 'json' };
import trainingCorpus from '../scripts/competitor-discovery-training-corpus.json' with { type: 'json' };
import historicalR8Evaluation from '../scripts/competitor-discovery-test-evaluation-r8.json' with { type: 'json' };
import trainingVectors from '../scripts/competitor-discovery-training-vectors.json' with { type: 'json' };
import { competitorIdentity } from '../lib/competitor-identity.ts';
import {
  compareUnicodeCodePoints,
  enumerateCompetitorSpans,
  parseCompetitorDiscoveryAnswer,
} from '../lib/competitor-discovery-primitives.ts';
import {
  decodeCompetitorEntitySpans,
  COMPETITOR_ENTITY_ROLE_TRANSFORM,
  COMPETITOR_FEATURE_ORDER,
  competitorMwisPrimaryFraction,
  discoverCompetitors,
  extractCompetitorFeatureRows,
  extractCompetitorFeatureRowsWithEntityScores,
  scoreCompetitorEntityRoleFeatures,
  scoreCompetitorFeatureVector,
  transformCompetitorEntityRoleLogit,
  validateCompetitorModelArtifact,
  type CompetitorDiscoveryAudit,
  type CompetitorDiscoveryWorkAudit,
  type DiscoveryAnswer,
  type DiscoverySeed,
} from '../lib/competitor-discovery.ts';

void test('derives the primary-origin fraction from the complete explicit feed', () => {
  assert.equal(
    competitorMwisPrimaryFraction([
      { selectionOrigin: 'zone-recovery' },
      { selectionOrigin: 'zone-recovery' },
    ]),
    0,
  );
  assert.equal(
    competitorMwisPrimaryFraction([
      { selectionOrigin: 'mwis-primary' },
      { selectionOrigin: 'zone-recovery' },
    ]),
    0.5,
  );
  assert.equal(
    competitorMwisPrimaryFraction([
      { selectionOrigin: 'mwis-primary' },
      { selectionOrigin: 'mwis-primary' },
    ]),
    1,
  );
  assert.throws(
    () => competitorMwisPrimaryFraction([]),
    /at least one span/,
  );
  assert.throws(
    () => competitorMwisPrimaryFraction([{}]),
    /selection origin/,
  );
});

void test('derives primary-context interaction from the same bounded feed', () => {
  const rows = forcedFeatureRows(
    'Acme Beacon and Solar Sync support shops with inventory.',
    ['Solar Sync'],
    5,
  );
  const row = rows.find((item) => item.name === 'Solar Sync');
  assert.ok(row);
  assert.equal(
    row.features.primary_context_similarity,
    row.features.mwis_primary_fraction * row.features.context_similarity,
  );
});

function forcedFeatureRows(
  text: string,
  selectedNames: string[],
  selectedLogit: number,
) {
  const fixture = answer('forced-context', text);
  const primitives = enumerateCompetitorSpans(fixture, [seed]).spans;
  const selected = new Set(selectedNames);
  for (const name of selected)
    assert.ok(primitives.some((span) => span.name === name), name);
  const scores = new Map(
    primitives.map((span) => {
      const logit = selected.has(span.name) ? selectedLogit : -20;
      return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }];
    }),
  );
  return extractCompetitorFeatureRowsWithEntityScores(
    [fixture],
    [seed],
    scores,
  );
}

void test('masks primary peer identities and a recovered candidate by UTF-16 range', () => {
  const primaryA = forcedFeatureRows(
    'Acme Beacon supports shops with inventory. Solar Sync supports shops with inventory alongside Cedar Metrics.',
    ['Solar Sync', 'Cedar Metrics'],
    5,
  );
  const primaryB = forcedFeatureRows(
    'Acme Beacon supports shops with inventory. Solar Sync supports shops with inventory alongside Zinc Orbit.',
    ['Solar Sync', 'Zinc Orbit'],
    5,
  );
  assert.equal(
    primaryA.find((row) => row.name === 'Solar Sync')?.features
      .context_similarity,
    primaryB.find((row) => row.name === 'Solar Sync')?.features
      .context_similarity,
  );

  const recoveredA = forcedFeatureRows(
    'Acme Beacon and Solar Sync support shops with inventory.',
    ['Solar Sync'],
    -1,
  );
  const recoveredB = forcedFeatureRows(
    'Acme Beacon and Lunar Grid support shops with inventory.',
    ['Lunar Grid'],
    -1,
  );
  const rowA = recoveredA.find((row) => row.name === 'Solar Sync');
  const rowB = recoveredB.find((row) => row.name === 'Lunar Grid');
  assert.equal(rowA?.spans[0]?.selectionOrigin, 'zone-recovery');
  assert.equal(rowB?.spans[0]?.selectionOrigin, 'zone-recovery');
  assert.equal(
    rowA?.features.context_similarity,
    rowB?.features.context_similarity,
  );
});

const seed: DiscoverySeed = {
  name: 'Acme Beacon',
  domain: 'acme.test',
};

void test('training feature DAG does not import the final ranker artifact', () => {
  const featureSource = readFileSync(
    new URL('../lib/competitor-discovery-features.ts', import.meta.url),
    'utf8',
  );
  const generatorSource = readFileSync(
    new URL(
      '../scripts/generate-competitor-discovery-r6-training.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.ok(!featureSource.includes('competitor-discovery-model.json'));
  assert.ok(
    generatorSource.includes("from '../lib/competitor-discovery-features.ts'"),
  );
  assert.ok(!generatorSource.includes("from '../lib/competitor-discovery.ts'"));
});

void test('uses locale-neutral casing throughout portable discovery ML', () => {
  const sources = [
    '../lib/competitor-discovery-features.ts',
    '../lib/competitor-discovery-primitives.ts',
    '../scripts/generate-competitor-entity-role-primitives.ts',
    '../scripts/generate-competitor-discovery-r6-training.ts',
  ];
  for (const source of sources)
    assert.ok(
      !readFileSync(new URL(source, import.meta.url), 'utf8').includes(
        'toLocaleLowerCase',
      ),
      source,
    );
});

void test('validates vocabularies in Python Unicode code-point order', () => {
  const vocabulary = [
    'candidate=a',
    'candidate_prefix2=ab',
    'shape=Aa',
    'shape=aa',
    'supplementary=\u{10000}',
    'supplementary=\u{e000}',
  ];
  assert.deepEqual([...vocabulary].sort(compareUnicodeCodePoints), [
    'candidate=a',
    'candidate_prefix2=ab',
    'shape=Aa',
    'shape=aa',
    'supplementary=\u{e000}',
    'supplementary=\u{10000}',
  ]);
  assert.ok(roleModel.featureVocabulary.length > 0);
  assert.ok(roleModel.featureVocabulary.length <= 12_000);
});

function answer(
  id: string,
  text: string,
  sources: DiscoveryAnswer['sources'] = [],
): DiscoveryAnswer {
  return {
    id,
    answer: text,
    sources,
    createdAt: `2026-09-0${id.length}T12:00:00.000Z`,
  };
}

function emptyDiscoveryAudit(): CompetitorDiscoveryAudit {
  return {
    inputAnswers: 0,
    processedAnswers: 0,
    answersDroppedByCap: 0,
    answersSkippedEmpty: 0,
    answersSkippedNoSeedContext: 0,
    decoder: {
      scoredSpans: 0,
      zones: 0,
      mwisPrimaryBeforeCutoff: 0,
      primaryDroppedByCutoff: 0,
      primaryDroppedByCap: 0,
      selectedPrimary: 0,
      zonesWithoutPrimary: 0,
      recoveryZoneCandidates: 0,
      recoveryDroppedByCutoff: 0,
      recoveryBlockedByOverlap: 0,
      recoveryDroppedByCap: 0,
      selectedRecovery: 0,
    },
  };
}

function emptyDiscoveryWorkAudit(): CompetitorDiscoveryWorkAudit {
  return {
    seedAnswerScans: 0,
    normalizedAnswerComputations: 0,
    normalizedCharacters: 0,
  };
}

/**
 * Smallest CPU time a run costs, in milliseconds. CPU time instead of wall
 * clock so a loaded machine does not inflate the reading, and the minimum of
 * several runs because interference only ever adds time.
 */
function minimumCpuMilliseconds(run: () => unknown, repeats: number): number {
  let best = Infinity;
  for (let index = 0; index < repeats; index++) {
    const started = process.cpuUsage();
    run();
    const spent = process.cpuUsage(started);
    best = Math.min(best, (spent.user + spent.system) / 1_000);
  }
  return best;
}

void test('exported sklearn coefficients reproduce the recorded Python vectors', () => {
  assert.equal(model.schemaVersion, 6);
  assert.equal(trainingVectors.schemaVersion, 6);
  assert.deepEqual(
    model.provenance.entityRoleTransform,
    COMPETITOR_ENTITY_ROLE_TRANSFORM,
  );
  assert.throws(
    () =>
      validateCompetitorModelArtifact(
        {
          ...model,
          provenance: {
            ...model.provenance,
            entityRoleTransform: {
              ...model.provenance.entityRoleTransform,
              zHi: model.provenance.entityRoleTransform.zHi + 1,
            },
          },
        } as unknown as Parameters<typeof validateCompetitorModelArtifact>[0],
      ),
    /entity-role transform is incompatible/,
  );
  assert.deepEqual(
    trainingVectors.entityRoleTransform,
    COMPETITOR_ENTITY_ROLE_TRANSFORM,
  );
  assert.deepEqual(
    roleModel.rankerEntityRoleTransform,
    COMPETITOR_ENTITY_ROLE_TRANSFORM,
  );
  assert.equal(
    transformCompetitorEntityRoleLogit(COMPETITOR_ENTITY_ROLE_TRANSFORM.zLo),
    0,
  );
  assert.equal(
    transformCompetitorEntityRoleLogit(COMPETITOR_ENTITY_ROLE_TRANSFORM.zHi),
    1,
  );
  assert.ok(
    Math.abs(
      transformCompetitorEntityRoleLogit(
        (COMPETITOR_ENTITY_ROLE_TRANSFORM.zLo +
          COMPETITOR_ENTITY_ROLE_TRANSFORM.zHi) /
          2,
      ) - 0.5,
    ) < 1e-12,
  );
  assert.equal(model.modelType, 'sklearn.linear_model.LogisticRegression');
  assert.equal(model.provenance.customerDataUsed, false);
  assert.ok(model.metrics.limitation.includes('not human annotation'));
  assert.ok(model.metrics.maxSourceOnlyScore < model.decisionThreshold);
  for (const vector of model.parityVectors) {
    const decision = model.featureOrder.reduce(
      (sum, feature, index) =>
        sum +
        model.coefficients[index] *
          vector.features[feature as keyof typeof vector.features],
      model.intercept,
    );
    const score = 1 / (1 + Math.exp(-decision));
    assert.ok(Math.abs(score - vector.score) < 1e-10, vector.id);
  }
  for (const vector of model.schemaContractParityVectors) {
    assert.equal(vector.features.source_only, 0);
    assert.equal(vector.features.publisher_citation, 0.5);
    assert.ok(
      Math.abs(scoreCompetitorFeatureVector(vector.features) - vector.score) <
        1e-10,
      vector.id,
    );
  }
  for (const vector of roleModel.parityVectors) {
    const runtime = scoreCompetitorEntityRoleFeatures(
      vector.features as unknown as Record<string, number>,
    );
    assert.ok(Math.abs(runtime.logit - vector.logit) < 1e-10, vector.id);
    assert.ok(Math.abs(runtime.score - vector.score) < 1e-10, vector.id);
  }
  assert.throws(
    () =>
      scoreCompetitorFeatureVector({
        ...model.parityVectors[0].features,
        entity_role: undefined as unknown as number,
      }),
    /Invalid competitor feature/,
  );
  assert.throws(
    () => scoreCompetitorEntityRoleFeatures({ 'shape=Aa': 1.01 }),
    /Invalid competitor entity-role feature/,
  );
  assert.throws(
    () => scoreCompetitorEntityRoleFeatures({ 'unknown=oov': -0.01 }),
    /Invalid competitor entity-role feature/,
  );
  assert.doesNotThrow(() =>
    scoreCompetitorEntityRoleFeatures({ 'unknown=oov': 1 }),
  );
  const mixed = {
    ...model.parityVectors[0].features,
    source_only: 0,
    publisher_citation: 0.75,
  };
  const reversed = Object.fromEntries(Object.entries(mixed).reverse());
  assert.equal(
    scoreCompetitorFeatureVector(reversed),
    scoreCompetitorFeatureVector(mixed),
  );
  assert.throws(
    () => scoreCompetitorFeatureVector({ ...mixed, unexpected: 0 }),
    /does not match model schema/,
  );
  const { entity_role: _removed, ...missing } = mixed;
  assert.throws(
    () => scoreCompetitorFeatureVector(missing),
    /does not match model schema/,
  );
  assert.throws(
    () => scoreCompetitorFeatureVector({ ...mixed, source_only: Infinity }),
    /Invalid competitor feature/,
  );
});

void test('checked-in vectors are deterministic runtime features with exact spans', () => {
  assert.deepEqual(model.featureOrder, [...COMPETITOR_FEATURE_ORDER]);
  assert.deepEqual(trainingVectors.featureOrder, [...COMPETITOR_FEATURE_ORDER]);
  const evaluationSource = readFileSync(
    new URL(
      '../scripts/competitor-discovery-test-evaluation-r8.json',
      import.meta.url,
    ),
  );
  assert.equal(
    createHash('sha256').update(evaluationSource).digest('hex'),
    '07a41a65fa579f21eecd363df7071c867d496f99f5c7a09502ce51eae386fbbd',
  );
  assert.equal(historicalR8Evaluation.testEvaluationCount, 1);
  assert.equal(model.provenance.testEvaluationCount, 0);
  assert.ok(!('evaluationTrackerSha256' in model.provenance));
  const featureSource = readFileSync(
    new URL('../lib/competitor-discovery-features.ts', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(featureSource).digest('hex'),
    model.provenance.featureSourceSha256,
  );
  const primitiveSource = readFileSync(
    new URL('../lib/competitor-discovery-primitives.ts', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(primitiveSource).digest('hex'),
    model.provenance.primitiveImplementationSha256,
  );

  const corpus = trainingCorpus as unknown as {
    bundles: {
      id: string;
      seeds: DiscoverySeed[];
      answers: DiscoveryAnswer[];
      referenceAnswers?: DiscoveryAnswer[];
    }[];
  };
  for (const parity of model.parityVectors) {
    const separator = parity.id.indexOf(':');
    const document = corpus.bundles.find(
      (item) => item.id === parity.id.slice(0, separator),
    );
    assert.ok(document, parity.id);
    const rows = extractCompetitorFeatureRows(
      document.answers,
      document.seeds,
      { referenceAnswers: document.referenceAnswers },
    );
    const row = rows.find(
      (item) =>
        `${document.id}:${item.name
          .normalize('NFKD')
          .replace(/\p{M}/gu, '')
          .toLowerCase()}` === parity.id,
    );
    assert.ok(row, parity.id);
    assert.deepEqual(
      row.spans.map(
        ({ roleLogit: _logit, roleScore: _score, ...span }) => span,
      ),
      parity.candidateFeed.map(
        ({ roleLogit: _logit, roleScore: _score, ...span }) => span,
      ),
    );
    for (const [index, span] of row.spans.entries()) {
      const expected = parity.candidateFeed[index]!;
      assert.ok(Math.abs(span.roleLogit - expected.roleLogit) < 1e-10);
      assert.ok(Math.abs(span.roleScore - expected.roleScore) < 1e-10);
    }
    assert.deepEqual(Object.keys(row.features), Object.keys(parity.features));
    for (const feature of COMPETITOR_FEATURE_ORDER)
      assert.ok(
        Math.abs(row.features[feature] - parity.features[feature]) < 1e-10,
        `${parity.id}:${feature}`,
      );
    assert.ok(
      Math.abs(scoreCompetitorFeatureVector(row.features) - parity.score) <
        1e-10,
      parity.id,
    );
    const answersById = new Map(
      document.answers.map((item) => [item.id, item.answer]),
    );
    for (const span of row.spans)
      assert.equal(
        answersById.get(span.runId)?.slice(span.start, span.end),
        span.surface,
      );
  }
});

void test('keeps UTF-16 surfaces exact and suppresses normalized seed variants', () => {
  const astral = answer(
    'astral',
    '𐐀 Conversion atende operações nacionais. Cedro atende operações nacionais.',
  );
  const astralRows = extractCompetitorFeatureRows(
    [astral],
    [{ name: 'Conversion', domain: 'conversion.test' }],
  );
  assert.ok(!astralRows.some((row) => row.name.includes('Conversion')));
  assert.ok(astralRows.some((row) => row.name === 'Cedro'));
  for (const row of astralRows)
    for (const span of row.spans)
      assert.equal(astral.answer.slice(span.start, span.end), span.surface);

  const decomposed = answer(
    'decomposed',
    `Ipe\u0301 atende clínicas regionais. Lótus atende clínicas regionais.`,
  );
  const decomposedRows = extractCompetitorFeatureRows(
    [decomposed],
    [{ name: 'Ipê', domain: 'ipe.test' }],
  );
  assert.ok(!decomposedRows.some((row) => row.name.startsWith('Ipe')));
  assert.ok(decomposedRows.some((row) => row.name === 'Lótus'));
});

void test('uses Unicode-safe company predicates and keeps official company citations eligible', () => {
  const officialAnswer = answer(
    'unicode-role',
    'Ponte Solar atua com logística. [Lótus Norte](https://lotus.example/news) é uma empresa que atua com logística.',
    [
      {
        url: 'https://lotus.example/news',
        domain: 'lotus.example',
        title: 'Lótus Norte',
      },
    ],
  );
  const rows = extractCompetitorFeatureRows(
    [officialAnswer],
    [{ name: 'Ponte Solar', domain: 'ponte.test' }],
  );
  const company = rows.find((row) => row.name === 'Lótus Norte');
  assert.ok(company);
  assert.equal(company.domain, 'lotus.example');
  assert.ok(
    company.spans.some((span) => span.roleScore >= roleModel.decisionThreshold),
  );
  assert.equal(company.features.publisher_citation, 0);
  assert.deepEqual(
    discoverCompetitors(
      [officialAnswer],
      [{ name: 'Ponte Solar', domain: 'ponte.test' }],
    ).map((candidate) => candidate.name),
    ['Lótus Norte'],
  );
});

void test('requires seed evidence and distributes capped reference contexts across seeds', () => {
  assert.deepEqual(
    discoverCompetitors(
      [answer('no-seed', 'Cedar Axis provides inventory controls.')],
      [{ name: 'Absent Seed', domain: 'absent.test' }],
    ),
    [],
  );

  const references = Array.from({ length: 20 }, (_, index) =>
    answer(
      `reference-${index}`,
      `Seed One handles common workflows. Seed Two supports ordinary workflows.${
        index === 19
          ? ' Seed Three coordinates multilingual treasury reconciliation.'
          : ''
      }`,
    ),
  );
  const rows = extractCompetitorFeatureRows(
    [
      answer(
        'quota-candidate',
        'Quartz Basin coordinates multilingual treasury reconciliation.',
      ),
    ],
    [
      { name: 'Seed One', domain: 'one.test' },
      { name: 'Seed Two', domain: 'two.test' },
      { name: 'Seed Three', domain: 'three.test' },
    ],
    { referenceAnswers: references },
  );
  const candidate = rows.find((row) => row.name === 'Quartz Basin');
  assert.ok(candidate);
  assert.ok(candidate.features.context_similarity > 0.8);
});

void test('keeps grounded candidates under deterministic candidate-cap pressure', () => {
  const headings = Array.from(
    { length: 300 },
    (_, index) => `## Placeholder${String(index).padStart(3, '0')}`,
  ).join('\n');
  const text = `${headings}\nBaseline Seed handles rare reconciliation flows. Grounded Rival handles rare reconciliation flows.`;
  const rows = extractCompetitorFeatureRows(
    [answer('candidate-cap', text)],
    [{ name: 'Baseline Seed', domain: 'baseline.test' }],
  );
  assert.ok(rows.length <= 256);
  assert.ok(rows.some((row) => row.name === 'Grounded Rival'));
});

void test('keeps structural role on the same occurrence as contextual signals', () => {
  const rows = extractCompetitorFeatureRows(
    [
      answer(
        'atomic-occurrence',
        `Acme Beacon coordinates release evidence for distributed teams.
- **Cedar Ridge**.
Cedar Ridge coordinates release evidence for distributed teams.`,
      ),
    ],
    [seed],
  );
  const candidate = rows.find((row) => row.name === 'Cedar Ridge');
  assert.ok(candidate);
  assert.ok(
    candidate.spans.some(
      (span) => span.roleScore >= roleModel.decisionThreshold,
    ),
  );
  assert.equal(candidate.features.list_table_role, 0);
});

void test('finds unknown competitors in the same table/list roles as the own-brand seed', () => {
  const results = discoverCompetitors(
    [
      answer(
        'table',
        `Agency | Focus | Best for
--- | --- | ---
**Acme Beacon** | technical search visibility | distributed teams
**Northstar Labs** | technical search visibility | enterprise teams
**brightwave** | technical search visibility | local businesses

Other competitors include **Solar Sync** and **Cedar Metrics** for search visibility.`,
      ),
    ],
    [seed],
  );
  const names = results.map((candidate) => candidate.name);
  assert.ok(names.includes('Northstar Labs'));
  assert.ok(names.includes('brightwave'));
  assert.ok(names.includes('Solar Sync'));
  assert.ok(!names.includes('Acme Beacon'));
  assert.deepEqual(
    new Set(names),
    new Set(['Northstar Labs', 'brightwave', 'Solar Sync', 'Cedar Metrics']),
  );
  assert.ok(
    results.every((candidate) => candidate.score >= 0 && candidate.score <= 1),
  );
});

void test('supports pt-BR accents and leaves an unlinked candidate domain unset', () => {
  const results = discoverCompetitors(
    [
      answer(
        'portugues',
        `Agência | Especialidade | Perfil
--- | --- | ---
**Agência Farol** | conteúdo e SEO técnico | empresas B2B
**Vértice Digital** | conteúdo e SEO técnico | empresas SaaS
**sabiá labs** | conteúdo e SEO técnico | negócios locais`,
      ),
    ],
    [{ name: 'Agência Farol', domain: 'farol.example' }],
  );
  assert.equal(
    results.find((candidate) => candidate.name === 'Vértice Digital')?.domain,
    null,
  );
  assert.ok(results.some((candidate) => candidate.name === 'sabiá labs'));
  assert.deepEqual(
    new Set(results.map((candidate) => candidate.name)),
    new Set(['Vértice Digital', 'sabiá labs']),
  );
});

void test('finds single-token company subjects in ordinary EN and pt-BR prose', () => {
  const english = discoverCompetitors(
    [
      answer(
        'english-prose',
        `Acme Beacon helps retailers coordinate inventory and fulfillment. Zephyr helps retailers coordinate inventory and fulfillment across several stores. Consider Zephyr when comparing operational fit.`,
      ),
    ],
    [seed],
  );
  assert.deepEqual(
    english.map((candidate) => candidate.name),
    ['Zephyr'],
  );

  const portuguese = discoverCompetitors(
    [
      answer(
        'portuguese-prose',
        `Farol Clínico atende consultórios com agenda e prontuário. Orvalho atende consultórios com agenda e prontuário em uma só plataforma. Considere Orvalho ao comparar aderência operacional.`,
      ),
    ],
    [{ name: 'Farol Clínico', domain: 'farol-clinico.example' }],
  );
  assert.deepEqual(
    portuguese.map((candidate) => candidate.name),
    ['Orvalho'],
  );
});

void test('does not turn imperatives, generic categories, or editorial publishers into companies', () => {
  const results = discoverCompetitors(
    [
      answer(
        'prose-negatives',
        `Acme Beacon provides search visibility monitoring for distributed teams. Consider Zephyr, which provides search visibility monitoring for distributed teams. A Service for search monitoring offers generic optimization services. Agência de Busca é uma categoria ampla. According to Search Ledger, adoption is growing. Industry Review reports on the market every quarter.`,
        [
          {
            url: 'https://search-ledger.example/reports/adoption',
            domain: 'search-ledger.example',
            title: 'Search Ledger',
          },
        ],
      ),
    ],
    [seed],
  );
  assert.deepEqual(
    results.map((candidate) => candidate.name),
    ['Zephyr'],
  );
  assert.ok(
    !results.some((candidate) => candidate.name.startsWith('Consider')),
  );
});

void test('keeps contextual company names that contain a generic suffix', () => {
  const results = discoverCompetitors(
    [
      answer(
        'generic-suffix-brand',
        `Acme Beacon coordinates release evidence for distributed teams. Cedar Software coordinates release evidence for distributed teams.`,
      ),
    ],
    [seed],
  );
  assert.deepEqual(
    results.map((candidate) => candidate.name),
    ['Cedar Software'],
  );
});

void test('extracts a linked single-token name from a Markdown numbered heading', () => {
  const results = discoverCompetitors(
    [
      answer(
        'linked-heading',
        `## 1. [Acme Beacon](https://acme.test/platform)
Inventory coordination for distributed retailers.

## 2. [Orbit](https://orbit.example/platform)
Inventory coordination for distributed retailers.`,
      ),
    ],
    [seed],
  );
  assert.deepEqual(
    results.map((candidate) => candidate.name),
    ['Orbit'],
  );
  assert.equal(results[0]?.domain, 'orbit.example');
  assert.ok(!results[0]?.name.includes(']('));
});

void test('pairs only a direct official domain and rejects publisher-directory citations', () => {
  const results = discoverCompetitors(
    [
      answer(
        'links',
        `Compare **Acme Beacon** with [Northstar Labs](https://northstar.example/pricing) for visibility monitoring.

According to [Market Agency Partners](https://directory.example/agencies/market-agency-partners), the category is growing.

## Sources
- [Market Agency Partners](https://directory.example/agencies/market-agency-partners)`,
        [
          {
            url: 'https://directory.example/agencies/market-agency-partners',
            domain: 'directory.example',
            title: 'Market Agency Partners',
          },
        ],
      ),
    ],
    [seed],
  );
  assert.equal(
    results.find((candidate) => candidate.name === 'Northstar Labs')?.domain,
    'northstar.example',
  );
  assert.ok(
    !results.some((candidate) => candidate.name === 'Market Agency Partners'),
  );
  assert.deepEqual(
    results.map((candidate) => candidate.name),
    ['Northstar Labs'],
  );
});

void test('reference answers contribute seed context but never candidates or evidence', () => {
  const reference = answer(
    'reference',
    `Tool | Role | Audience
--- | --- | ---
**Acme Beacon** | incident response automation | infrastructure teams
**Reference Rival** | incident response automation | infrastructure teams`,
  );
  const current = answer(
    'current',
    `Tool | Role | Audience
--- | --- | ---
**Cobalt Ops** | incident response automation | infrastructure teams`,
  );
  const results = discoverCompetitors([current], [seed], {
    referenceAnswers: [reference],
  });
  const candidate = results.find((item) => item.name === 'Cobalt Ops');
  assert.ok(candidate);
  assert.equal(candidate.answerCount, 1);
  assert.deepEqual(
    candidate.evidence.map((item) => item.runId),
    ['current'],
  );
  assert.ok(!results.some((item) => item.name === 'Reference Rival'));
  assert.deepEqual(
    results.map((item) => item.name),
    ['Cobalt Ops'],
  );
});

void test('deduplicates answer support and enforces output/evidence limits', () => {
  const results = discoverCompetitors(
    [
      answer(
        'one',
        '**Acme Beacon** and **Nova Signal** are competing analytics platforms. Nova Signal is often compared with Acme Beacon.',
      ),
      answer(
        'two',
        'Teams compare **Acme Beacon** with **Nova Signal** for analytics monitoring.',
      ),
    ],
    [seed],
    { maxCandidates: 1, maxEvidencePerCandidate: 1 },
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Nova Signal');
  assert.equal(results[0].answerCount, 2);
  assert.equal(results[0].evidence.length, 1);
});

void test('keeps source-only and publisher-citation signals distinct', () => {
  const rows = extractCompetitorFeatureRows(
    [
      answer(
        'mixed-citation',
        'Acme Beacon and Nova Signal compete for analytics teams.\n\nSources\n- Nova Signal — vendor profile',
      ),
    ],
    [seed],
  );
  const candidate = rows.find((row) => row.name === 'Nova Signal');
  assert.ok(candidate);
  assert.equal(candidate.features.source_only, 0);
  assert.equal(candidate.features.publisher_citation, 0.5);
  assert.ok(Number.isFinite(scoreCompetitorFeatureVector(candidate.features)));
});

void test('aggregates accent, punctuation, and case variants by shared identity', () => {
  const answers = [
    answer(
      'identity-one',
      '**Acme Beacon** and **Vértice Digital** are competing analytics platforms.',
    ),
    answer(
      'identity-two',
      '**Acme Beacon** and **VERTICE-DIGITAL** are competing analytics platforms.',
    ),
  ];
  const selectedIdentity = competitorIdentity('Vértice Digital');
  const primitives = answers.flatMap((item) =>
    enumerateCompetitorSpans(item, [seed]).spans,
  );
  const scores = new Map(
    primitives.map((span) => {
      const logit = competitorIdentity(span.name) === selectedIdentity ? 5 : -20;
      return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }];
    }),
  );
  const rows = extractCompetitorFeatureRowsWithEntityScores(
    answers,
    [seed],
    scores,
  ).filter((row) => competitorIdentity(row.name) === selectedIdentity);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.answerCount, 2);
  assert.equal(rows[0]?.spans.length, 2);
  assert.ok(rows[0]?.name.normalize('NFC') === rows[0]?.name);
});

void test(
  'bounds a 20-answer page containing a maximum-sized answer',
  { timeout: 30_000 },
  () => {
    const repeated = Array.from(
      { length: 4_000 },
      () =>
        '**Acme Beacon** and **Nova Signal** are competitors in incident response automation.',
    ).join(' ');
    const audit = emptyDiscoveryAudit();
    const workAudit = emptyDiscoveryWorkAudit();
    const results = discoverCompetitors(
      [
        answer('long-answer', repeated),
        ...Array.from({ length: 19 }, (_, index) =>
          answer(
            `page-answer-${index}`,
            'Acme Beacon coordinates incident response for distributed teams.',
          ),
        ),
      ],
      [seed],
      { audit, workAudit },
    );
    // Bound the work the decoder performs instead of elapsed wall-clock time:
    // the counters below fail when a bound regresses, while a wall-clock
    // deadline only reflects how loaded the machine happened to be.
    assert.equal(audit.inputAnswers, 20);
    assert.equal(audit.processedAnswers, 20);
    assert.equal(audit.answersDroppedByCap, 0);
    assert.ok(audit.decoder.zones <= 800);
    assert.ok(audit.decoder.scoredSpans <= 1_280);
    assert.ok(
      audit.decoder.selectedPrimary + audit.decoder.selectedRecovery <= 320,
    );
    // The decoder counters above never move on the answer x seed axis, so they
    // stay identical when a redundant scan comes back. These three do move.
    // Extraction scans each of the 20 answers against the single seed exactly
    // three times -- the unmasked preflight, the masked current pass and the
    // per-answer local pass -- so 60 is the whole budget and any extra full
    // pass costs another 20. Answer normalization is memoized per answer, so
    // one computation per answer covers all three scans plus the mask.
    assert.ok(
      workAudit.seedAnswerScans <= 62,
      `seedAnswerScans=${workAudit.seedAnswerScans}`,
    );
    assert.ok(
      workAudit.normalizedAnswerComputations <= 21,
      `normalizedAnswerComputations=${workAudit.normalizedAnswerComputations}`,
    );
    assert.ok(
      workAudit.normalizedCharacters <= 170_000,
      `normalizedCharacters=${workAudit.normalizedCharacters}`,
    );
    assert.equal(
      results.find((candidate) => candidate.name === 'Nova Signal')?.answerCount,
      1,
    );
  },
);

void test('keeps seed-context work on the answer x seed axis with several seeds', () => {
  const body =
    'Acme Beacon, Nova Signal, Solar Sync and Vertex Relay coordinate incident response for retail teams. **Northwind Search** and **Blue Harbor Labs** compete with all four on the same accounts.';
  const seeds: DiscoverySeed[] = [
    { name: 'Acme Beacon', domain: 'acme.test' },
    { name: 'Nova Signal', domain: 'nova.test' },
    { name: 'Solar Sync', domain: 'solar.test' },
  ];
  const answerCount = 4;
  // collectSeedContexts walks answers first and hands one normalization to
  // every seed. Measured against the seed-major form it replaced, that
  // restructuring is redundant on its own: with the WeakMap in
  // normalizedAnswerOffsets both forms report the identical 12/24/36 scans,
  // 4 normalizations and 712 characters at 1, 2 and 3 seeds, so no counter
  // tells them apart and this test does not pretend to. The memoization is
  // what removes the work, and that is what these asserts gate -- drop the
  // WeakMap and normalizedAnswerComputations goes to 16 answer-major, or to
  // 4/28/52 seed-major, failing here either way.
  const measurements = [1, 2, 3].map((seedCount) => {
    const workAudit = emptyDiscoveryWorkAudit();
    const results = discoverCompetitors(
      Array.from({ length: answerCount }, (_, index) =>
        answer(`multi-seed-${index}`, body),
      ),
      seeds.slice(0, seedCount),
      { workAudit },
    );
    return { seedCount, workAudit, results };
  });
  for (const { seedCount, workAudit, results } of measurements) {
    // Three passes per answer per seed -- unmasked preflight, masked current
    // pass, per-answer local pass. Growth is answers x seeds, never worse.
    assert.equal(
      workAudit.seedAnswerScans,
      3 * answerCount * seedCount,
      `seedCount=${seedCount} seedAnswerScans=${workAudit.seedAnswerScans}`,
    );
    // One normalization per answer, independent of how many seeds scan it.
    assert.equal(
      workAudit.normalizedAnswerComputations,
      answerCount,
      `seedCount=${seedCount} normalizedAnswerComputations=${workAudit.normalizedAnswerComputations}`,
    );
    assert.equal(
      workAudit.normalizedCharacters,
      measurements[0]!.workAudit.normalizedCharacters,
      `seedCount=${seedCount} normalizedCharacters=${workAudit.normalizedCharacters}`,
    );
    // Non-vacuous: every seed count still discovers the same candidate.
    assert.deepEqual(
      results.map((candidate) => candidate.name),
      ['Vertex Relay'],
      `seedCount=${seedCount}`,
    );
  }
});

void test('bounds markup-prefix parsing in an isolated process', () => {
  const moduleUrl = new URL('../lib/competitor-discovery.ts', import.meta.url)
    .href;
  const markup = '*'.repeat(80);
  const script = `
    const { discoverCompetitors } = await import(${JSON.stringify(moduleUrl)});
    const answer = {
      id: 'markup-prefix',
      answer: ${JSON.stringify(`**Acme Beacon** ${markup}! **Nova Signal** ${markup}! According to **Industry Review** ${markup}!`)},
      sources: [],
      createdAt: '2026-09-07T12:00:00.000Z',
    };
    discoverCompetitors([answer], [{ name: 'Acme Beacon', domain: 'acme.test' }]);
  `;
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 2_000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
});

void test('bounds unmatched Markdown brackets at the maximum answer size', () => {
  const moduleUrl = new URL('../lib/competitor-discovery.ts', import.meta.url)
    .href;
  const prefix =
    'Northwind Search provides technical search measurement for enterprise retailers. ';
  const patterns = [
    '['.repeat(131_072),
    '—é_*['.repeat(Math.ceil(180_000 / 5)).slice(0, 180_000),
  ];
  for (const [index, suffix] of patterns.entries()) {
    const text = `${prefix}${suffix}`.slice(0, 180_000);
    const script = `
      const { discoverCompetitors } = await import(${JSON.stringify(moduleUrl)});
      const answer = {
        id: 'unmatched-${index}',
        answer: ${JSON.stringify(text)},
        sources: [],
        createdAt: '2026-09-08T12:00:00.000Z',
      };
      const result = discoverCompetitors(
        [answer],
        [{ name: 'Northwind Search', domain: 'northwind.test' }],
      );
      if (result.length !== 0) throw new Error('punctuation became a candidate');
    `;
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module'],
      { encoding: 'utf8', timeout: 2_000, input: script },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, result.stderr);
  }
});

void test('enumerates exact company subspans without a predicate gate', () => {
  const source = answer(
    'primitive-boundary',
    'A Busca Boreal mede conteúdo. Recomendamos Marea Digital quando a equipe precisa do mesmo serviço.',
  );
  const { spans } = enumerateCompetitorSpans(source, [
    { name: 'Busca Boreal', domain: 'boreal.test' },
  ]);
  const marea = spans.find((span) => span.name === 'Marea Digital');
  assert.ok(marea);
  assert.equal(source.answer.slice(marea.start, marea.end), 'Marea Digital');
  assert.ok(spans.some((span) => span.name === 'Recomendamos Marea Digital'));
  assert.ok(!spans.some((span) => span.name.includes('Busca Boreal')));
});

void test('scanner keeps exact link offsets and bounded monotonic work', () => {
  const prefix =
    '𐐀 **Blue Harbor Labs** [Blue Harbor Labs](https://blueharbor.example/platform) ';
  const text = `${prefix}${'—é_*['.repeat(36_000)}`.slice(0, 180_000);
  const parsed = parseCompetitorDiscoveryAnswer(text);
  assert.equal(parsed.links.length, 1);
  assert.equal(
    text.slice(parsed.links[0]!.labelStart, parsed.links[0]!.labelEnd),
    'Blue Harbor Labs',
  );
  assert.ok(parsed.workUnits <= text.length * 3);
  assert.equal(parsed.visibleText.length, text.length);
});

void test('attaches a link host only to its complete equivalent label', () => {
  const { spans } = enumerateCompetitorSpans(
    answer(
      'link-equivalence',
      '[Blue Harbor Labs](https://blueharbor.example/platform) coordinates review.',
    ),
    [],
  );
  assert.equal(
    spans.find((span) => span.name === 'Blue Harbor Labs')?.linkedDomain,
    'blueharbor.example',
  );
  assert.equal(
    spans.find((span) => span.name === 'Blue Harbor')?.linkedDomain,
    null,
  );
});

void test('decodes coherent entity boundaries before applying a role cutoff', () => {
  const source = answer(
    'mwis-boundary',
    'A Busca Boreal mede conteúdo. Recomendamos Marea Digital para operações equivalentes.',
  );
  const { spans } = enumerateCompetitorSpans(source, [
    { name: 'Busca Boreal', domain: 'boreal.test' },
  ]);
  const scores = new Map(
    spans.map((span) => {
      const logit =
        span.name === 'Marea Digital'
          ? 4
          : span.name === 'Recomendamos Marea Digital'
            ? 1
            : -2;
      return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }];
    }),
  );
  const decoded = decodeCompetitorEntitySpans(spans, scores, {
    applyCutoff: false,
  });
  assert.ok(decoded.some((span) => span.name === 'Marea Digital'));
  assert.ok(
    !decoded.some((span) => span.name === 'Recomendamos Marea Digital'),
  );
  for (let left = 0; left < decoded.length; left++)
    for (let right = left + 1; right < decoded.length; right++)
      assert.ok(
        decoded[left]!.end <= decoded[right]!.start ||
          decoded[right]!.end <= decoded[left]!.start,
      );
});

void test('zone recovery cannot displace a late MWIS-primary span at the cap', () => {
  const source = answer(
    'mwis-cap',
    Array.from(
      { length: 300 },
      (_, index) => `Probe${String(index).padStart(3, '0')} Labs.`,
    ).join(' '),
  );
  const { spans } = enumerateCompetitorSpans(source, []);
  const zones = [
    ...new Set(spans.map((span) => `${span.zoneStart}:${span.zoneEnd}`)),
  ];
  assert.ok(zones.length >= 300);
  const finalZone = zones.at(-1)!;
  const finalSpan = spans.find(
    (span) =>
      `${span.zoneStart}:${span.zoneEnd}` === finalZone &&
      span.name === 'Probe299 Labs',
  );
  assert.ok(finalSpan);
  const scores = new Map(
    spans.map((span) => {
      const logit = span.id === finalSpan.id ? 50 : -50;
      return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }];
    }),
  );
  const decoderAudit = {
    scoredSpans: 0,
    zones: 0,
    mwisPrimaryBeforeCutoff: 0,
    primaryDroppedByCutoff: 0,
    primaryDroppedByCap: 0,
    selectedPrimary: 0,
    zonesWithoutPrimary: 0,
    recoveryZoneCandidates: 0,
    recoveryDroppedByCutoff: 0,
    recoveryBlockedByOverlap: 0,
    recoveryDroppedByCap: 0,
    selectedRecovery: 0,
  };
  const decoded = decodeCompetitorEntitySpans(spans, scores, {
    applyCutoff: false,
    retainBestPerZone: true,
    audit: decoderAudit,
  });
  assert.equal(decoded.length, 256);
  assert.ok(decoded.some((span) => span.id === finalSpan.id));
  assert.equal(
    decoded.find((span) => span.id === finalSpan.id)?.selectionOrigin,
    'mwis-primary',
  );
  assert.ok(decoded.some((span) => span.name === 'Probe000 Labs'));
  assert.ok(!decoded.some((span) => span.name === 'Probe298 Labs'));
  assert.equal(decoderAudit.selectedPrimary, 1);
  assert.equal(decoderAudit.selectedRecovery, 255);
  assert.ok(decoderAudit.recoveryDroppedByCap > 0);
});

void test('caps discovery at twenty answers before feature extraction', () => {
  const seeds = [{ name: 'Northwind Search', domain: 'northwind.test' }];
  const sources = Array.from({ length: 21 }, (_, index) =>
    answer(
      `answer-cap-${index}`,
      `Northwind Search handles audits. Candidate${String(index).padStart(2, '0')} Labs handles comparable audits.`,
    ),
  );
  const scores = new Map(
    sources.slice(0, 20).flatMap((source, answerIndex) =>
      enumerateCompetitorSpans(source, seeds, answerIndex).spans.map((span) => {
        const logit = span.name.startsWith('Candidate') ? 4 : -4;
        return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }] as const;
      }),
    ),
  );
  const audit = emptyDiscoveryAudit();
  const rows = extractCompetitorFeatureRowsWithEntityScores(
    sources,
    seeds,
    scores,
    { audit },
  );
  assert.equal(audit.inputAnswers, 21);
  assert.equal(audit.processedAnswers, 20);
  assert.equal(audit.answersDroppedByCap, 1);
  assert.ok(rows.some((row) => row.name === 'Candidate19 Labs'));
  assert.ok(!rows.some((row) => row.name === 'Candidate20 Labs'));
  assert.ok(audit.decoder.selectedPrimary > 0);
  assert.equal(
    audit.decoder.selectedPrimary + audit.decoder.selectedRecovery,
    rows.reduce((count, row) => count + row.spans.length, 0),
  );
});

void test('bounds enumerated spans and retains a late prose zone after heading padding', () => {
  const headings = Array.from(
    { length: 3_000 },
    (_, index) => `## Placeholder${String(index).padStart(4, '0')}`,
  ).join('\n');
  const source = answer(
    'late-primitive',
    `${headings}\nBaseline Seed handles rare reconciliation flows. Grounded Rival handles rare reconciliation flows.`,
  );
  const { spans } = enumerateCompetitorSpans(source, [
    { name: 'Baseline Seed', domain: 'baseline.test' },
  ]);
  assert.ok(spans.length <= 2_048);
  assert.ok(spans.some((span) => span.name === 'Grounded Rival'));
});

void test(
  'budgets many short zones before feature materialization',
  { timeout: 30_000 },
  () => {
    const text = Array.from({ length: 3_000 }, (_, index) => {
      const suffix = String(index).padStart(5, '0');
      return [
        `Signal${suffix} Works`,
        `- List${suffix} Labs: comparison note`,
        `| Table${suffix} Systems | comparison note |`,
        `**Emphasis${suffix} Studio** handles the case.`,
        `[Linked${suffix} Group](https://linked${suffix}.example/path)`,
        `## Heading${suffix} Network`,
      ].join('\n');
    })
      .join('\n')
      .slice(0, 180_000);
    const source = answer('short-zone-flood', text);
    const { spans } = enumerateCompetitorSpans(source, []);
    // The fixture opens 5,048 candidate zones over 16,824 tokens. Feature
    // materialization has to stay on the span cap, not on the zone count.
    assert.ok(spans.length <= 2_048, `spans=${spans.length}`);
    assert.ok(spans.every((span) => Object.keys(span.features).length > 0));

    // What the removed 2 s deadline actually protected: work inside
    // enumerateCompetitorSpans that changes no output. No counter can see it
    // -- the parser's workUnits stops at the link and URL scan, and every
    // decoder and work counter below is derived from the spans that come out,
    // so injecting O(zones x tokens) into the zone loop leaves all of them
    // byte-identical. Only time moves, so time is what this asserts, as a
    // ratio against the parser on the same text: machine speed cancels out,
    // which is why the absolute deadline was flaky and this is not.
    // Measured clean: ratio 10.2-16.0 running inside this file, including
    // against eight competing CPU-bound processes, and 15.1-19.0 with the
    // module loaded on its own. With an O(zones x tokens) no-op loop injected
    // into the zone walk -- output byte-identical, every counter below
    // unchanged -- the same readings are 60.7 and 73-89. The ceiling of 40
    // sits 2.1x above the worst clean reading and 1.5x below the cheapest
    // injected one, so it trips once enumeration costs roughly 2.4x what it
    // costs today. The 2 s deadline it replaces only tripped at 2.9x, and
    // measured the machine rather than the code.
    const parseMilliseconds = minimumCpuMilliseconds(
      () => parseCompetitorDiscoveryAnswer(text),
      5,
    );
    const enumerateMilliseconds = minimumCpuMilliseconds(
      () => enumerateCompetitorSpans(source, []),
      3,
    );
    assert.ok(
      enumerateMilliseconds <= parseMilliseconds * 40,
      `enumerate=${enumerateMilliseconds.toFixed(1)}ms parse=${parseMilliseconds.toFixed(2)}ms ratio=${(enumerateMilliseconds / parseMilliseconds).toFixed(1)}`,
    );

    // Same text through the extraction a caller actually runs, so the bounds
    // below cover the decoder and the answer x seed axis too. parsed.workUnits
    // is deliberately not asserted here: 'scanner keeps exact link offsets and
    // bounded monotonic work' already bounds that same parser counter.
    const audit = emptyDiscoveryAudit();
    const workAudit = emptyDiscoveryWorkAudit();
    const rows = extractCompetitorFeatureRows(
      [source],
      [{ name: 'Signal00000 Works', domain: 'signal00000.example' }],
      { audit, workAudit },
    );
    // Non-vacuous: the flood has to reach the end of the pipeline.
    assert.ok(rows.length > 0, `rows=${rows.length}`);
    assert.equal(audit.processedAnswers, 1);
    // Measured 2,048 scored spans, 1,239 zones and 256 selected. The zone
    // ceiling is what fails if zone collapse stops running before features
    // are built; the selection ceiling is the per-answer cap.
    assert.ok(
      audit.decoder.scoredSpans <= 2_048,
      `scoredSpans=${audit.decoder.scoredSpans}`,
    );
    assert.ok(audit.decoder.zones <= 1_280, `zones=${audit.decoder.zones}`);
    assert.ok(
      audit.decoder.selectedPrimary + audit.decoder.selectedRecovery <= 256,
      `selected=${audit.decoder.selectedPrimary + audit.decoder.selectedRecovery}`,
    );
    // One answer against one seed, scanned by the three passes extraction
    // makes, and normalized once. A per-zone or per-span rescan leaking onto
    // the answer x seed axis moves these; 5,048 zones must not.
    assert.equal(
      workAudit.seedAnswerScans,
      3,
      `seedAnswerScans=${workAudit.seedAnswerScans}`,
    );
    assert.equal(
      workAudit.normalizedAnswerComputations,
      1,
      `normalizedAnswerComputations=${workAudit.normalizedAnswerComputations}`,
    );
    assert.ok(
      workAudit.normalizedCharacters <= 170_000,
      `normalizedCharacters=${workAudit.normalizedCharacters}`,
    );
  },
);

void test('separates punctuation zones and enumerates at most five total tokens', () => {
  const { spans } = enumerateCompetitorSpans(
    answer(
      'span-token-cap',
      'Alpha North. Beta South. One Two Three Four Five Six provides monitoring.',
    ),
    [],
  );
  assert.ok(spans.some((span) => span.name === 'Alpha North'));
  assert.ok(spans.some((span) => span.name === 'Beta South'));
  assert.ok(!spans.some((span) => span.name.includes('North. Beta')));
  assert.ok(
    spans.every(
      (span) =>
        (span.name.match(/[\p{L}\p{M}\p{N}&+’'/-]+/gu) ?? []).length <= 5,
    ),
  );
});

void test('attaches domains only from entity-identifying evidence and nulls conflicts', () => {
  const source = answer(
    'domain-evidence',
    'Northwind Search serves retailers. Blue Harbor Labs serves the same retailers.',
    [
      {
        url: 'https://blueharbor.example/platform',
        domain: 'blueharbor.example',
        title: 'Blue Harbor Labs — Official platform',
      },
    ],
  );
  const seeds = [{ name: 'Northwind Search', domain: 'northwind.test' }];
  const { spans } = enumerateCompetitorSpans(source, seeds);
  const scores = new Map(
    spans.map((span) => {
      const logit = span.name === 'Blue Harbor Labs' ? 4 : -4;
      return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }];
    }),
  );
  const rows = extractCompetitorFeatureRowsWithEntityScores(
    [source],
    seeds,
    scores,
  );
  assert.equal(
    rows.find((row) => row.name === 'Blue Harbor Labs')?.domain,
    'blueharbor.example',
  );

  const conflict = {
    ...source,
    sources: [
      ...source.sources,
      {
        url: 'https://other-harbor.example/about',
        domain: 'other-harbor.example',
        title: 'Blue Harbor Labs | Company',
      },
    ],
  };
  const conflictSpans = enumerateCompetitorSpans(conflict, seeds).spans;
  const conflictScores = new Map(
    conflictSpans.map((span) => {
      const logit = span.name === 'Blue Harbor Labs' ? 4 : -4;
      return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }];
    }),
  );
  assert.equal(
    extractCompetitorFeatureRowsWithEntityScores(
      [conflict],
      seeds,
      conflictScores,
    ).find((row) => row.name === 'Blue Harbor Labs')?.domain,
    null,
  );

  const repeated = [
    source,
    { ...source, id: 'domain-evidence-repeat' },
    {
      ...source,
      id: 'domain-evidence-conflict',
      sources: [
        {
          url: 'https://other-harbor.example/about',
          domain: 'other-harbor.example',
          title: 'Blue Harbor Labs | Company',
        },
      ],
    },
  ];
  const repeatedScores = new Map(
    repeated.flatMap((item, answerIndex) =>
      enumerateCompetitorSpans(item, seeds, answerIndex).spans.map((span) => {
        const logit = span.name === 'Blue Harbor Labs' ? 4 : -4;
        return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }] as const;
      }),
    ),
  );
  assert.equal(
    extractCompetitorFeatureRowsWithEntityScores(
      repeated,
      seeds,
      repeatedScores,
    ).find((row) => row.name === 'Blue Harbor Labs')?.domain,
    null,
  );

  const localConflictThenUnique = [
    conflict,
    { ...source, id: 'domain-evidence-after-local-conflict' },
  ];
  const localConflictScores = new Map(
    localConflictThenUnique.flatMap((item, answerIndex) =>
      enumerateCompetitorSpans(item, seeds, answerIndex).spans.map((span) => {
        const logit = span.name === 'Blue Harbor Labs' ? 4 : -4;
        return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }] as const;
      }),
    ),
  );
  assert.equal(
    extractCompetitorFeatureRowsWithEntityScores(
      localConflictThenUnique,
      seeds,
      localConflictScores,
    ).find((row) => row.name === 'Blue Harbor Labs')?.domain,
    null,
  );
});

void test('calculates contextual similarity for every decoded prose occurrence', () => {
  const source = answer(
    'always-context',
    'Northwind Search builds organic programs for regional banks. Harbor Metric builds comparable organic programs for regional banks.',
  );
  const seeds = [{ name: 'Northwind Search', domain: 'northwind.test' }];
  const { spans } = enumerateCompetitorSpans(source, seeds);
  const scores = new Map(
    spans.map((span) => {
      const logit = span.name === 'Harbor Metric' ? 0.4 : -4;
      return [span.id, { logit, score: 1 / (1 + Math.exp(-logit)) }];
    }),
  );
  const harbor = extractCompetitorFeatureRowsWithEntityScores(
    [source],
    seeds,
    scores,
  ).find((row) => row.name === 'Harbor Metric');
  assert.ok(harbor);
  assert.ok(harbor.features.context_similarity > 0.5);
});
