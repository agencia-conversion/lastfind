import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultFilters,
  demoModels,
  demoPrompts,
  type DemoFilters,
  type DemoResponse,
} from '../components/analytics/demo-data.ts';
import {
  createSemanticSnapshot,
  parseSemanticQuestions,
  semanticSnapshotRows,
  attributeEvidence,
  canonicalBrandIds,
  initialBrandEntities,
  mergeBrandEntities,
  reconcileSemanticProject,
  scoreComponents,
  semanticAttributes,
  semanticSentiment,
  semanticSummary,
  splitBrandEntity,
} from '../components/analytics/semantic-data.ts';

await test('snapshot export preserves multi-selection, empty dimensions and the frozen tag matching mode', () => {
  const filters: DemoFilters = {
    ...defaultFilters,
    models: ['ChatGPT'],
    country: ['Brazil', 'United States'],
    topic: [],
    tag: ['Discovery', 'Comparison'],
    tagMode: 'all',
  };
  const snapshot = createSemanticSnapshot({
    id: 'multi-filter',
    date: '2026-09-11T00:00:00Z',
    title: 'Multi-filter report',
    project: { id: 'project', name: 'Project', domain: 'example.com' },
    from: '2026-09-01',
    to: '2026-09-11',
    filters,
    entities: initialBrandEntities(),
    prompts: [],
    responses: [],
  });
  assert.ok(Array.isArray(filters.country));
  assert.ok(Array.isArray(filters.tag));
  filters.country[0] = 'Changed';
  filters.tag.push('Changed');
  filters.tagMode = 'any';
  assert.deepEqual(snapshot.filters.country, ['Brazil', 'United States']);
  assert.deepEqual(snapshot.filters.topic, []);
  assert.deepEqual(snapshot.filters.tag, ['Discovery', 'Comparison']);
  assert.equal(snapshot.filters.tagMode, 'all');
  const rows = semanticSnapshotRows(snapshot);
  const selection = (key: string) =>
    rows.find((row) => row[0] === 'Filters' && row[1] === key)?.[3];
  assert.equal(selection('country'), 'Brazil | United States');
  assert.equal(selection('topic'), '');
  assert.equal(selection('tag'), 'Discovery | Comparison');
  assert.equal(selection('tagMode'), 'all');
  const defaultMode = semanticSnapshotRows({
    ...snapshot,
    filters: { ...snapshot.filters, tagMode: undefined },
  });
  assert.equal(
    defaultMode.find(
      (row) => row[0] === 'Filters' && row[1] === 'tagMode',
    )?.[3],
    'any',
  );
});

const response = (
  id: string,
  brands: string[],
  overrides: Partial<DemoResponse> = {},
): DemoResponse => ({
  id,
  promptId: 'p1',
  date: '2026-09-09T07:00:00Z',
  model: 'ChatGPT',
  brandIds: brands,
  sentiment: 90,
  sourceIds: [],
  consultedSourceIds: null,
  ...overrides,
});

await test('canonical merging deduplicates mentions and preserves original order without mutating evidence', () => {
  const entities = initialBrandEntities();
  const original = structuredClone(entities);
  const sample = response('sample', ['mestre', 'conversion', 'np']);
  const merged = mergeBrandEntities(entities, 'conversion', 'mestre');
  assert.deepEqual(canonicalBrandIds(sample, merged), ['conversion', 'np']);
  assert.deepEqual(sample.brandIds, ['mestre', 'conversion', 'np']);
  assert.deepEqual(entities, original);
  assert.equal(merged.length, entities.length - 1);
  assert.deepEqual(
    merged
      .find((entity) => entity.id === 'conversion')!
      .members.map((member) => member.id),
    ['conversion', 'mestre'],
  );
  assert.equal(
    mergeBrandEntities(entities, 'conversion', 'conversion'),
    entities,
  );
  assert.equal(mergeBrandEntities(entities, 'missing', 'mestre'), entities);
});

await test('splitting a merged identity restores every member and recalculates the prior denominator', () => {
  const entities = initialBrandEntities();
  const samples = [
    response('one', ['conversion', 'mestre']),
    response('two', ['mestre']),
    response('three', ['np']),
  ];
  const merged = mergeBrandEntities(entities, 'conversion', 'mestre');
  const split = splitBrandEntity(merged, 'conversion');
  assert.deepEqual(
    split.map((entity) => entity.id).sort(),
    entities.map((entity) => entity.id).sort(),
  );
  assert.deepEqual(
    split
      .flatMap((entity) => entity.members)
      .sort((a, b) => a.id.localeCompare(b.id)),
    entities
      .flatMap((entity) => entity.members)
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
  const before = semanticSummary(samples, entities);
  const after = semanticSummary(samples, merged);
  assert.equal(before.shareOfVoice, 25);
  assert.ok(Math.abs(after.shareOfVoice - 200 / 3) < 1e-10);
  assert.equal(after.mentions.length, 2);
  assert.equal(
    semanticSummary(samples, split).shareOfVoice,
    before.shareOfVoice,
  );
});

await test('coverage, linked domains and consulted evidence have separate observable denominators', () => {
  const samples = [
    response('one', ['conversion', 'mestre'], {
      sourceIds: ['s2'],
      consultedSourceIds: null,
    }),
    response('two', ['mestre'], {
      sourceIds: ['s1'],
      consultedSourceIds: ['s2'],
    }),
    response('three', ['conversion'], {
      sourceIds: ['s3'],
      consultedSourceIds: [],
    }),
  ];
  const summary = semanticSummary(samples, initialBrandEntities());
  assert.ok(Math.abs(summary.coverage - 200 / 3) < 1e-10);
  assert.equal(summary.linked, 1);
  assert.equal(summary.consultedAvailable, 2);
  assert.equal(summary.consulted, 1);
  assert.equal(summary.shareOfVoice, 50);
  assert.equal(
    summary.engines.find((engine) => engine.model === 'ChatGPT')?.total,
    3,
  );
  assert.ok(
    summary.engines
      .filter((engine) => engine.model !== 'ChatGPT')
      .every((engine) => engine.total === 0),
  );
  assert.equal(
    summary.sources.find((source) => source.id === 's2')?.associated,
    1,
  );
  assert.equal(
    summary.sources.find((source) => source.id === 's2')?.consulted,
    1,
  );
  assert.equal(
    summary.sources.find((source) => source.id === 's1')?.association,
    0,
  );
});

await test('the explicit Lastfind score is bounded and uses its disclosed weights', () => {
  const model = scoreComponents({
    coverage: 80,
    associations: 60,
    sentiment: 90,
    sourceDiversity: 40,
  });
  assert.equal(model.score, 70);
  assert.ok(
    Math.abs(model.parts.reduce((sum, part) => sum + part.weight, 0) - 1) <
      1e-10,
  );
  assert.equal(
    scoreComponents({
      coverage: 1000,
      associations: 1000,
      sentiment: 1000,
      sourceDiversity: 1000,
    }).score,
    100,
  );
  assert.equal(
    scoreComponents({
      coverage: -2,
      associations: NaN,
      sentiment: -Infinity,
      sourceDiversity: -30,
    }).score,
    0,
  );
  assert.equal(
    semanticSentiment(response('positive', [], { sentiment: 85 })),
    'positive',
  );
  assert.equal(
    semanticSentiment(response('neutral', [], { sentiment: 75 })),
    'neutral',
  );
  assert.equal(
    semanticSentiment(response('alert', [], { sentiment: 74 })),
    'alert',
  );
});

await test('attribute drilldowns only include eligible, mentioned responses and remain deterministic', () => {
  const entity = initialBrandEntities()[0];
  const attribute = semanticAttributes.find((item) => item.id === 'technical')!;
  const samples = Array.from({ length: 20 }, (_, index) =>
    response(`sample-${index}`, ['conversion']),
  );
  samples.push(response('wrong-topic', ['conversion'], { promptId: 'p8' }));
  samples.push(response('wrong-brand', ['mestre']));
  const evidence = attributeEvidence(samples, attribute, entity);
  assert.ok(evidence.length > 0);
  assert.ok(
    evidence.every(
      (item) => item.promptId === 'p1' && item.brandIds.includes('conversion'),
    ),
  );
  assert.deepEqual(attributeEvidence(samples, attribute, entity), evidence);
  assert.ok(
    semanticAttributes.every((item) =>
      item.promptIds.every((id) =>
        demoPrompts.some((prompt) => prompt.id === id),
      ),
    ),
  );
});

await test('empty projects and newly added identities do not acquire fabricated history', () => {
  const entities = initialBrandEntities('Other project', 'example.com');
  const empty = semanticSummary([], entities);
  assert.equal(empty.score.score, 0);
  assert.equal(empty.mentions.length, 0);
  assert.equal(empty.consultedAvailable, 0);
  assert.equal(empty.engines.length, demoModels.length);
  assert.ok(
    empty.associations.every(
      (attribute) =>
        attribute.eligible === 0 &&
        attribute.evidence.length === 0 &&
        attribute.confidence === 0,
    ),
  );
  const added = {
    id: 'new-brand',
    name: 'New brand',
    domain: 'example.org',
    members: [
      {
        id: 'new-brand',
        name: 'New brand',
        domain: 'example.org',
        aliases: ['New brand'],
      },
    ],
  };
  const result = semanticSummary(
    [response('one', ['conversion'])],
    [...entities, added],
    'new-brand',
  );
  assert.equal(result.coverage, 0);
  assert.equal(result.shareOfVoice, 0);
  assert.equal(result.linked, 0);
});

await test('merging is the deduplicated union of original annotations and split restores every evidence ID', () => {
  const entities = initialBrandEntities();
  const attribute = semanticAttributes[0];
  const samples = Array.from({ length: 60 }, (_, index) =>
    response(`merge-${index}`, ['conversion', 'mestre']),
  );
  const before = entities
    .slice(0, 2)
    .flatMap((entity) =>
      attributeEvidence(samples, attribute, entity).map((row) => row.id),
    );
  const merged = mergeBrandEntities(entities, 'conversion', 'mestre');
  assert.deepEqual(
    attributeEvidence(samples, attribute, merged[0])
      .map((row) => row.id)
      .sort(),
    [...new Set(before)].sort(),
  );
  for (const entity of splitBrandEntity(merged, 'conversion')) {
    const original = entities.find((item) => item.id === entity.id)!;
    assert.deepEqual(
      attributeEvidence(samples, attribute, entity),
      attributeEvidence(samples, attribute, original),
    );
  }
});

await test('report questions reject silent truncation and deduplicate whitespace, case and existing questions', () => {
  const many = Array.from(
    { length: 21 },
    (_, index) => `Question number ${index}?`,
  ).join('\n');
  assert.equal(parseSemanticQuestions(many, []).error, 'limit');
  assert.equal(parseSemanticQuestions(many, []).questions.length, 21);
  assert.equal(parseSemanticQuestions('tiny', []).error, 'length');
  assert.deepEqual(
    parseSemanticQuestions(
      '  My Question?\nmy   question?\nExisting question?',
      [{ text: 'existing question?' }],
    ),
    { questions: ['My Question?'], error: null },
  );
});

await test('report snapshots freeze complete inputs, count existing unanswered questions and track missing engine pairs', () => {
  const entities = initialBrandEntities();
  const samples = [
    response('selected', ['conversion'], { sourceIds: ['s2'] }),
    response('other-prompt', ['mestre'], { promptId: 'p2' }),
    response('outside-period', ['conversion'], {
      date: '2026-09-01T07:00:00Z',
    }),
  ];
  const filters = {
    ...defaultFilters,
    models: ['ChatGPT', 'Claude'] as typeof defaultFilters.models,
    country: 'Brazil',
    topic: 'SEO agencies',
    tag: 'Discovery',
  };
  const prompts = [
    { id: 'p1', text: 'Original question?' },
    { id: 'new', text: 'Existing question without data?' },
  ];
  const snapshot = createSemanticSnapshot({
    id: 'snapshot',
    date: '2026-09-10T12:00:00Z',
    title: 'Report',
    project: {
      id: 'conversion-web',
      name: 'Conversion',
      domain: 'conversion.com.br',
    },
    from: '2026-09-09',
    to: '2026-09-09',
    filters,
    entities,
    prompts,
    customQuestions: ['New question?'],
    responses: samples,
  });
  assert.deepEqual(
    snapshot.evidence.map((row) => row.id),
    ['selected'],
  );
  assert.equal(snapshot.responses, 1);
  assert.equal(snapshot.pending, 2);
  assert.equal(snapshot.missingPairs, 5);
  assert.equal(snapshot.questions.length, 3);
  assert.equal(snapshot.summary.coverage, 100);
  prompts[0].text = 'Changed question?';
  samples[0].brandIds.length = 0;
  entities[0].name = 'Changed brand';
  filters.models.length = 0;
  assert.equal(snapshot.questions[0].text, 'Original question?');
  assert.deepEqual(snapshot.evidence[0].brandIds, ['conversion']);
  assert.equal(snapshot.entities[0].name, 'Conversion');
  assert.deepEqual(snapshot.models, ['ChatGPT', 'Claude']);
  assert.equal(snapshot.filters.topic, 'SEO agencies');
  const rows = semanticSnapshotRows(snapshot);
  assert.ok(rows.every((row) => row.length === 6));
  assert.ok(
    rows.some(
      (row) =>
        row[0] === 'Cited evidence' &&
        row[1] === 'selected' &&
        String(row[3]).includes('conversion.com.br'),
    ),
  );
  assert.ok(
    rows.some(
      (row) =>
        row[0] === 'Consulted evidence' &&
        row[1] === 'selected' &&
        row[3] === 'unavailable',
    ),
  );
  for (const section of [
    'Filters',
    'Summary',
    'Coverage',
    'Method',
    'Associations',
    'Engines',
    'Sources',
    'Identities',
    'Questions',
    'Responses',
  ])
    assert.ok(
      rows.some((row) => row[0] === section),
      section,
    );
});

await test('unavailable report metrics export blank while a measured zero remains numeric', () => {
  const create = (responses: DemoResponse[]) =>
    createSemanticSnapshot({
      id: 'empty',
      date: '2026-09-10T12:00:00Z',
      title: 'Empty',
      project: { id: 'sample', name: 'Sample', domain: 'sample.com' },
      from: '2026-09-09',
      to: '2026-09-09',
      filters: defaultFilters,
      entities: initialBrandEntities(),
      prompts: [{ id: 'p1', text: 'Question?' }],
      responses,
    });
  assert.equal(
    semanticSnapshotRows(create([])).find(
      (row) => row[1] === 'Lastfind score',
    )?.[3],
    '',
  );
  const noMentions = create([response('none', [])]);
  assert.equal(
    semanticSnapshotRows(noMentions).find(
      (row) => row[1] === 'Share of voice',
    )?.[3],
    '',
  );
  assert.equal(
    semanticSnapshotRows(noMentions).find(
      (row) => row[1] === 'Visibility',
    )?.[3],
    0,
  );
});

await test('editing project identity reconciles current merged members while historical snapshots remain immutable', () => {
  const project = {
    id: 'conversion-web',
    name: 'Conversion',
    domain: 'conversion.com.br',
  };
  const responses = [
    response('branded-source', ['conversion', 'mestre'], { sourceIds: ['s2'] }),
  ];
  const entities = mergeBrandEntities(
    initialBrandEntities(),
    'conversion',
    'mestre',
  );
  const snapshot = createSemanticSnapshot({
    id: 'old',
    date: '2026-09-10T12:00:00Z',
    title: 'Old report',
    project,
    from: '2026-09-09',
    to: '2026-09-09',
    filters: defaultFilters,
    entities,
    prompts: [{ id: 'p1', text: 'Original question?' }],
    responses,
  });
  const serializedOld = JSON.stringify(snapshot);
  const state = { entities, snapshots: [snapshot], completed: ['technical'] };
  const renamed = {
    ...project,
    name: 'New identity',
    domain: 'new-identity.example',
  };
  const reconciled = reconcileSemanticProject(state, renamed);
  assert.notEqual(reconciled, state);
  assert.equal(reconciled.snapshots, state.snapshots);
  assert.equal(reconciled.completed, state.completed);
  const canonical = reconciled.entities.find(
    (entity) => entity.id === 'conversion',
  )!;
  assert.equal(canonical.name, renamed.name);
  assert.equal(canonical.domain, renamed.domain);
  assert.deepEqual(
    canonical.members.map((member) => member.id),
    ['conversion', 'mestre'],
  );
  assert.deepEqual(
    canonical.members.find((member) => member.id === 'conversion')?.aliases,
    [renamed.name, renamed.domain],
  );
  assert.equal(
    canonical.members.find((member) => member.id === 'mestre'),
    entities[0].members[1],
  );
  const fresh = createSemanticSnapshot({
    id: 'new',
    date: '2026-09-10T12:00:00Z',
    title: 'New report',
    project: renamed,
    from: '2026-09-09',
    to: '2026-09-09',
    filters: defaultFilters,
    entities: reconciled.entities,
    prompts: [{ id: 'p1', text: 'Original question?' }],
    responses,
  });
  assert.equal(snapshot.summary.linked, 1);
  assert.equal(fresh.summary.linked, 0);
  assert.equal(fresh.summary.own?.name, renamed.name);
  assert.ok(
    semanticSnapshotRows(fresh).some(
      (row) =>
        row[0] === 'Identities' &&
        row[1] === renamed.name &&
        String(row[5]).includes(renamed.domain),
    ),
  );
  assert.equal(JSON.stringify(snapshot), serializedOld);
  assert.equal(
    reconcileSemanticProject(reconciled, renamed),
    reconciled,
    'Unchanged configuration preserves state identity and memoization',
  );
  const mergedIntoCompetitor = {
    ...state,
    entities: mergeBrandEntities(
      initialBrandEntities(),
      'mestre',
      'conversion',
    ),
  };
  const other = reconcileSemanticProject(
    mergedIntoCompetitor,
    renamed,
  ).entities.find((entity) => entity.id === 'mestre')!;
  assert.equal(other.name, 'Agência Mestre');
  assert.equal(
    other.members.find((member) => member.id === 'conversion')?.domain,
    renamed.domain,
  );
});
