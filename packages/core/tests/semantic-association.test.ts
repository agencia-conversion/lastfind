import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSemanticConfiguration,
  readSemanticConfigurationSession,
  semanticConfigurationSessionKey,
  writeSemanticConfigurationSession,
  semanticAttributeFingerprint,
  validateSemanticConfiguration,
  type SemanticConfiguration,
} from '../components/analytics/semantic-configuration.ts';
import {
  semanticAssociationReport,
  semanticAssessmentFixture,
  semanticAssociationRows,
  type SemanticAssessment,
} from '../components/analytics/semantic-association-data.ts';
import { measuredAssociationReport } from '../components/analytics/semantic-measured-data.ts';
import {
  createSemanticSnapshot,
  initialBrandEntities,
  mergeBrandEntities,
  semanticSnapshotRows,
} from '../components/analytics/semantic-data.ts';
import {
  defaultFilters,
  demoPrompts,
  selectResponses,
  type DemoResponse,
} from '../components/analytics/demo-data.ts';

const config: SemanticConfiguration = {
  enabled: true,
  attributes: [
    { id: 'a', name: 'Innovation', description: '' },
    { id: 'b', name: 'Trust', description: '' },
  ],
};
const entities = initialBrandEntities().slice(0, 2);
const assessment = (
  brandId: string,
  attributeId: string,
  score: number | null,
  options: Partial<SemanticAssessment> = {},
): SemanticAssessment => ({
  id: `${brandId}-${attributeId}`,
  brandId,
  attributeId,
  attributeFingerprint: semanticAttributeFingerprint(
    config.attributes.find((item) => item.id === attributeId)!,
  ),
  model: 'ChatGPT',
  date: '2026-09-09T07:00:00Z',
  cohortId: 'cohort',
  contextPromptId: 'p1',
  score,
  status: score === null ? 'insufficient' : 'scored',
  prompt: { en: 'Evaluate the association', pt: 'Avalie a associação' },
  explanation: { en: 'Authored example.', pt: 'Exemplo editorial.' },
  sourceUrls: [],
  ...options,
});
const full = [
  assessment('conversion', 'a', 80),
  assessment('conversion', 'b', 60),
  assessment('mestre', 'a', 60),
  assessment('mestre', 'b', 40),
];

test('semantic setup accepts one attribute and optional intent but validates stable IDs and duplicate names', () => {
  assert.equal(
    validateSemanticConfiguration({
      enabled: true,
      attributes: [config.attributes[0]],
    }),
    null,
  );
  assert.equal(
    validateSemanticConfiguration({ enabled: true, attributes: [] }),
    'count',
  );
  assert.equal(
    validateSemanticConfiguration({ enabled: false, attributes: [] }),
    null,
  );
  assert.equal(
    validateSemanticConfiguration({
      enabled: true,
      attributes: [
        config.attributes[0],
        { ...config.attributes[1], name: ' innovation ' },
      ],
    }),
    'duplicate',
  );
  assert.equal(
    validateSemanticConfiguration({
      enabled: true,
      attributes: [config.attributes[0], { ...config.attributes[1], id: 'a' }],
    }),
    'id',
  );
  assert.equal(
    validateSemanticConfiguration({
      enabled: true,
      attributes: [{ ...config.attributes[0], description: 'a'.repeat(241) }],
    }),
    'description',
  );
});

test('score is the simple mean of equally weighted configured attributes, and leader compares against second place', () => {
  const report = semanticAssociationReport(config, entities, full);
  assert.equal(report.own?.score, 70);
  assert.equal(report.leader?.entity.id, 'conversion');
  assert.equal(report.reference?.entity.id, 'mestre');
  assert.equal(report.gap, 20);
  assert.equal(report.strongest?.attribute.id, 'a');
  assert.equal(report.priority?.attribute.id, 'b');
  assert.equal(report.brands[0].attributes[0].denominator, 1);
});

test('missing, inconclusive, ambiguous and invalid observations never become zero or a negative judgment', () => {
  const rows = [
    ...full.filter((item) => item.brandId !== 'conversion'),
    assessment('conversion', 'a', 0),
    assessment('conversion', 'b', null, { status: 'ambiguous' }),
  ];
  const report = semanticAssociationReport(config, entities, rows);
  assert.equal(report.own?.attributes[0].value, 0);
  assert.equal(report.own?.attributes[1].value, null);
  assert.equal(report.own?.score, null);
  assert.equal(report.own?.attributes[1].inconclusive[0].status, 'ambiguous');
  assert.equal(report.ranking.length, 1);
  assert.equal(report.gap, null);
  const invalid = semanticAssociationReport(config, entities, [
    assessment('conversion', 'a', Infinity),
    assessment('conversion', 'b', -3),
  ]);
  assert.equal(invalid.own?.assessedAttributes, 0);
  assert.equal(invalid.own?.score, null);
  const rowsCsv = semanticAssociationRows(report);
  assert.ok(
    rowsCsv.some(
      (row) =>
        row[0] === 'Semantic assessment' &&
        row[3] === '' &&
        String(row[5]).includes('Status ambiguous'),
    ),
  );
  assert.ok(
    rowsCsv.some((row) => row[0] === 'Semantic attribute' && row[3] === 0),
  );
});

test('ranking uses a shared cohort and never compares disjoint model samples or lets hidden series change means', () => {
  const rows = [
    ...full,
    assessment('conversion', 'a', 100, {
      id: 'extra',
      cohortId: 'unshared',
      model: 'Claude',
    }),
  ];
  const report = semanticAssociationReport(config, entities, rows);
  assert.equal(report.own?.score, 70);
  assert.equal(report.own?.attributes[0].denominator, 1);
  const disjoint = semanticAssociationReport(
    config,
    entities,
    full.map((item) =>
      item.brandId === 'mestre' ? { ...item, model: 'Claude' } : item,
    ),
  );
  assert.equal(disjoint.ranking.length, 0);
  assert.equal(disjoint.own?.score, null);
  assert.equal(disjoint.own?.attributes[0].observedValue, 80);
  assert.equal(disjoint.own?.attributes[0].observedDenominator, 1);
  assert.equal(disjoint.strongest?.attribute.id, 'a');
});

test('changed attribute names or intent invalidate prior grades even with the same stable ID', () => {
  for (const changed of [
    { ...config.attributes[0], name: 'A different attribute' },
    { ...config.attributes[0], description: 'New meaning' },
  ]) {
    const report = semanticAssociationReport(
      { ...config, attributes: [changed, config.attributes[1]] },
      entities,
      full,
    );
    assert.equal(report.own?.attributes[0].value, null);
    assert.equal(report.own?.score, null);
  }
});

test('merging semantic identities preserves original observations without creating a new synthesized brand score', () => {
  const merged = semanticAssociationReport(
    config,
    mergeBrandEntities(entities, 'conversion', 'mestre'),
    full,
  );
  assert.equal(merged.own?.score, null);
  assert.equal(merged.assessments.length, 4);
  assert.deepEqual(
    full.map((item) => item.score),
    [80, 60, 60, 40],
  );
});

test('fixture is scoped to selected model/context, uses latest context once and never creates scores for new projects', () => {
  const setup = defaultSemanticConfiguration();
  const responses = selectResponses(demoPrompts, {
    ...defaultFilters,
    models: ['ChatGPT'],
  });
  const fixture = semanticAssessmentFixture('conversion-web', setup, responses);
  assert.ok(fixture.length > 0);
  assert.ok(fixture.every((row) => row.model === 'ChatGPT'));
  assert.equal(
    new Set(
      fixture.map(
        (row) =>
          `${row.brandId}/${row.attributeId}/${row.contextPromptId}/${row.model}`,
      ),
    ).size,
    fixture.length,
  );
  assert.deepEqual(
    semanticAssessmentFixture('new-project', setup, responses),
    [],
  );
  assert.deepEqual(semanticAssessmentFixture('conversion-web', setup, []), []);
  const changed = responses.map((row) => ({
    ...row,
    brandIds: [],
    sentiment: 0,
    sourceIds: [],
  }));
  assert.deepEqual(
    semanticAssessmentFixture('conversion-web', setup, changed).map(
      (row) => row.score,
    ),
    fixture.map((row) => row.score),
  );
  const edited = {
    ...setup,
    attributes: [{ ...setup.attributes[0], name: 'Unrelated attribute' }],
  };
  assert.deepEqual(
    semanticAssessmentFixture('conversion-web', edited, responses),
    [],
  );
});

test('snapshots freeze configured intent, separate grades, denominators and evidence, and export them all', () => {
  const setup = defaultSemanticConfiguration();
  const responses = selectResponses(demoPrompts, {
    ...defaultFilters,
    models: ['ChatGPT'],
  });
  const snapshot = createSemanticSnapshot({
    id: 'report',
    date: '2026-09-09T12:00:00Z',
    title: 'Report',
    project: {
      id: 'conversion-web',
      name: 'Conversion',
      domain: 'conversion.com.br',
    },
    from: '2026-08-13',
    to: '2026-09-09',
    filters: { ...defaultFilters, models: ['ChatGPT'] },
    entities: initialBrandEntities(),
    prompts: demoPrompts,
    responses,
    semanticConfiguration: setup,
  });
  const expected = structuredClone(snapshot.association);
  setup.attributes[0].name = 'Edited later';
  responses[0].model = 'Claude';
  assert.deepEqual(snapshot.association, expected);
  assert.ok(
    snapshot.association.assessments.every((item) => item.model === 'ChatGPT'),
  );
  const csv = semanticSnapshotRows(snapshot);
  for (const section of [
    'Semantic configuration',
    'Semantic score',
    'Semantic attribute',
    'Semantic assessment',
    'Semantic evaluation prompt',
    'Semantic explanation',
    'Semantic contextual source',
  ])
    assert.ok(
      csv.some((row) => row[0] === section),
      section,
    );
  assert.ok(csv.every((row) => row.length === 6));
  const fresh = createSemanticSnapshot({
    id: 'new',
    date: snapshot.date,
    title: 'New',
    project: { id: 'fresh', name: 'Fresh', domain: 'fresh.example' },
    from: snapshot.from,
    to: snapshot.to,
    filters: defaultFilters,
    entities: initialBrandEntities('Fresh', 'fresh.example', []),
    prompts: [],
    responses: [] as DemoResponse[],
    semanticConfiguration: defaultSemanticConfiguration(),
  });
  assert.equal(fresh.association.own?.score, null);
  assert.equal(fresh.association.assessments.length, 0);
});

test('interface translations of authored defaults preserve their canonical concept; edits do not', () => {
  const en = defaultSemanticConfiguration('en'),
    pt = defaultSemanticConfiguration('pt-BR');
  assert.deepEqual(
    en.attributes.map(semanticAttributeFingerprint),
    pt.attributes.map(semanticAttributeFingerprint),
  );
  assert.notEqual(
    semanticAttributeFingerprint({
      ...pt.attributes[0],
      description: 'Changed intent',
    }),
    semanticAttributeFingerprint(en.attributes[0]),
  );
  const responses = selectResponses(demoPrompts, defaultFilters);
  const enReport = semanticAssociationReport(
    en,
    initialBrandEntities(),
    semanticAssessmentFixture('conversion-web', en, responses),
  );
  const ptReport = semanticAssociationReport(
    pt,
    initialBrandEntities(),
    enReport.assessments,
  );
  assert.equal(ptReport.own?.score, enReport.own?.score);
});

test('renaming the fixture project to another identity cannot transfer its association history', () => {
  assert.deepEqual(
    semanticAssessmentFixture(
      'conversion-web',
      defaultSemanticConfiguration(),
      selectResponses(demoPrompts, defaultFilters),
      { name: 'Other brand', domain: 'other.example' },
    ),
    [],
  );
});

test('attribute rankings retain a shared cohort even for brands missing another attribute', () => {
  const rows = [
    ...full.filter(
      (row) => !(row.brandId === 'mestre' && row.attributeId === 'b'),
    ),
    assessment('conversion', 'a', 100, {
      id: 'extra',
      cohortId: 'other',
      model: 'Claude',
    }),
  ];
  const report = semanticAssociationReport(config, entities, rows);
  assert.equal(report.own?.attributes[0].value, 80);
  assert.equal(report.own?.score, 70);
  assert.equal(report.brands[1].attributes[0].value, 60);
  assert.equal(report.brands[1].score, null);
});

test('browser tab attribute settings restore validated configuration, language and disabled state without retaining mutable input', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const key = semanticConfigurationSessionKey({
    accountId: 'account-a',
    userId: 'user-a',
    workspaceId: 'workspace-a',
    projectId: 'project-a',
  });
  const settings = {
    configuration: defaultSemanticConfiguration('pt-BR'),
    language: 'pt-BR' as const,
  };
  settings.configuration.attributes[0].description = 'Contexto específico';
  assert.equal(writeSemanticConfigurationSession(key, settings, storage), true);
  assert.deepEqual(readSemanticConfigurationSession(key, storage), settings);
  const restored = readSemanticConfigurationSession(key, storage)!;
  restored.configuration.attributes[0].name = 'Mutated local draft';
  assert.equal(
    readSemanticConfigurationSession(key, storage)!.configuration.attributes[0]
      .name,
    'SEO técnico',
  );
  settings.configuration.enabled = false;
  assert.equal(writeSemanticConfigurationSession(key, settings, storage), true);
  assert.deepEqual(readSemanticConfigurationSession(key, storage), settings);
  assert.equal(
    readSemanticConfigurationSession(key, storage)!.configuration.attributes
      .length,
    6,
  );
  assert.equal(
    writeSemanticConfigurationSession(
      key,
      { configuration: { enabled: false, attributes: [] }, language: 'en-US' },
      storage,
    ),
    true,
  );
  assert.deepEqual(readSemanticConfigurationSession(key, storage), {
    configuration: { enabled: false, attributes: [] },
    language: 'en-US',
  });
});

test('browser tab attribute storage is isolated by account, user, workspace and project without ambiguous separators', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const scope = {
    accountId: 'account-a',
    userId: 'user-a',
    workspaceId: 'workspace-a',
    projectId: 'project-a',
  };
  const key = semanticConfigurationSessionKey(scope);
  assert.equal(
    writeSemanticConfigurationSession(
      key,
      { configuration: config, language: 'en-US' },
      storage,
    ),
    true,
  );
  for (const field of [
    'accountId',
    'userId',
    'workspaceId',
    'projectId',
  ] as const) {
    assert.equal(
      readSemanticConfigurationSession(
        semanticConfigurationSessionKey({ ...scope, [field]: 'another' }),
        storage,
      ),
      null,
    );
  }
  assert.notEqual(
    semanticConfigurationSessionKey({
      ...scope,
      workspaceId: 'one/two',
      projectId: 'three',
    }),
    semanticConfigurationSessionKey({
      ...scope,
      workspaceId: 'one',
      projectId: 'two/three',
    }),
  );
});

test('corrupt, oversized and unsupported tab settings are ignored and storage failures do not throw', () => {
  const good = { version: 1, configuration: config, language: 'en-US' };
  const bad = [
    '{bad-json',
    'x'.repeat(20_001),
    JSON.stringify(null),
    JSON.stringify({ ...good, version: 2 }),
    JSON.stringify({ ...good, language: ['en-US'] }),
    JSON.stringify({
      ...good,
      configuration: { enabled: true, attributes: [] },
    }),
    JSON.stringify({
      ...good,
      configuration: { enabled: true, attributes: [{ id: 'a', name: 'Name' }] },
    }),
    JSON.stringify({
      ...good,
      configuration: {
        ...config,
        attributes: [config.attributes[0], config.attributes[0]],
      },
    }),
    JSON.stringify({
      ...good,
      configuration: {
        ...config,
        attributes: [{ ...config.attributes[0], description: 'x'.repeat(241) }],
      },
    }),
    JSON.stringify({
      ...good,
      configuration: {
        enabled: false,
        attributes: [{ id: {}, name: 'Name', description: '' }],
      },
    }),
  ];
  for (const raw of bad)
    assert.equal(
      readSemanticConfigurationSession('key', { getItem: () => raw }),
      null,
    );
  assert.equal(
    readSemanticConfigurationSession('key', {
      getItem: () => {
        throw new Error('Access denied');
      },
    }),
    null,
  );
  assert.equal(
    writeSemanticConfigurationSession(
      'key',
      { configuration: config, language: 'en-US' },
      {
        setItem: () => {
          throw new Error('Quota exceeded');
        },
      },
    ),
    false,
  );
  let stored = '{bad-json';
  const recovered = {
    getItem: () => stored,
    setItem: (_: string, value: string) => {
      stored = value;
    },
  };
  assert.equal(
    writeSemanticConfigurationSession(
      'key',
      { configuration: config, language: 'en-US' },
      recovered,
    ),
    true,
  );
  assert.deepEqual(readSemanticConfigurationSession('key', recovered), {
    configuration: config,
    language: 'en-US',
  });
});

test('measured display keeps observed zero and missing distinct without ranking disjoint cohorts', () => {
  const report = measuredAssociationReport(config, {
    ownBrand: 'Example',
    brands: [
      { name: 'Example', domain: 'example.test' },
      { name: 'Rival', domain: 'rival.test' },
    ],
    cells: [
      {
        brand: 'Example',
        attribute: 'a',
        score: null,
        samples: 0,
        observedScore: 0,
        observedSamples: 25,
        observations: 25,
        insufficient: 0,
        ambiguous: 0,
      },
      {
        brand: 'Example',
        attribute: 'b',
        score: null,
        samples: 0,
        observedScore: null,
        observedSamples: 0,
        observations: 1,
        insufficient: 1,
        ambiguous: 0,
      },
      {
        brand: 'Rival',
        attribute: 'a',
        score: null,
        samples: 0,
        observedScore: 75,
        observedSamples: 2,
        observations: 2,
        insufficient: 0,
        ambiguous: 0,
      },
    ],
    prompts: 2,
    engines: ['chat_gpt'],
    date: '2026-10-14T07:00:00Z',
  });
  assert.equal(report.own?.attributes[0].observedValue, 0);
  assert.equal(report.own?.attributes[0].observedDenominator, 25);
  assert.equal(report.own?.attributes[1].observedValue, null);
  assert.equal(report.own?.score, null);
  assert.equal(report.gap, null);
  assert.equal(report.ranking.length, 0);
  assert.equal(report.comparableAttributes, 0);
  assert.equal(report.strongest?.observedValue, 0);
});
