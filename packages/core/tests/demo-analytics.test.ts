import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandMetrics,
  defaultFilters,
  demoBrands,
  demoEnd,
  demoModels,
  demoPrompts,
  demoResponses,
  demoSources,
  getDemoReport,
  selectResponses,
  promptMatchesFilters,
} from '../components/analytics/demo-data.ts';
import type {
  DemoFilters,
  DemoResponse,
} from '../components/analytics/demo-data.ts';

await test('demo periods contain complete, adjacent samples for every offered date range', () => {
  assert.equal(
    new Set(demoResponses.map((response) => response.id)).size,
    demoResponses.length,
  );
  for (const days of ['7', '14', '28']) {
    const filters = { ...defaultFilters, days };
    const current = selectResponses(demoPrompts, filters);
    const previous = selectResponses(demoPrompts, filters, true);
    assert.equal(current.length, Number(days) * 10 * demoModels.length);
    assert.equal(
      previous.length,
      current.length,
      'Period comparisons need equal coverage',
    );
    const currentIds = new Set(current.map((response) => response.id));
    assert.ok(previous.every((response) => !currentIds.has(response.id)));
    const boundary = demoEnd - Number(days) * 86_400_000;
    assert.ok(
      current.every(
        (response) =>
          Date.parse(response.date) >= boundary &&
          Date.parse(response.date) < demoEnd,
      ),
    );
    assert.ok(
      previous.every((response) => Date.parse(response.date) < boundary),
    );
    assert.deepEqual(
      selectResponses(demoPrompts, filters),
      current,
      'Repeated reports are deterministic',
    );
  }
});

await test('model, location, topic and tag filters intersect and retain current prompt state', () => {
  const filters: DemoFilters = {
    days: '7',
    models: ['Claude'],
    country: 'Brazil',
    topic: 'AI search',
    tag: 'Discovery',
  };
  const responses = selectResponses(demoPrompts, filters);
  assert.equal(responses.length, 14);
  assert.deepEqual(
    [...new Set(responses.map((response) => response.promptId))].sort(),
    ['p3', 'p8'],
  );
  assert.ok(responses.every((response) => response.model === 'Claude'));

  const paused = demoPrompts.map((prompt) =>
    prompt.id === 'p3' ? { ...prompt, status: 'inactive' as const } : prompt,
  );
  assert.equal(selectResponses(paused, filters).length, 7);
  assert.equal(
    demoPrompts.find((prompt) => prompt.id === 'p3')?.status,
    'active',
    'Local edits must not mutate the shared fixture',
  );
  assert.equal(
    selectResponses(demoPrompts, { ...filters, tag: 'Branded' }).length,
    0,
  );
});

await test('model selection supports two, none and all models consistently across periods', () => {
  const filters: DemoFilters = {
    ...defaultFilters,
    days: '7',
    models: ['ChatGPT', 'Claude'],
  };
  for (const previous of [false, true]) {
    const selected = selectResponses(demoPrompts, filters, previous);
    assert.equal(selected.length, 140);
    assert.deepEqual(
      [...new Set(selected.map((response) => response.model))].sort(),
      ['ChatGPT', 'Claude'],
    );
    assert.equal(
      new Set(selected.map((response) => response.id)).size,
      selected.length,
    );
    for (const model of filters.models) {
      assert.deepEqual(
        selected.filter((response) => response.model === model),
        selectResponses(demoPrompts, { ...filters, models: [model] }, previous),
        'Selecting another model must preserve each model’s evidence',
      );
    }
    assert.deepEqual(
      selectResponses(demoPrompts, { ...filters, models: [] }, previous),
      [],
      'An empty selection means no models, not all models',
    );
    const all = selectResponses(
      demoPrompts,
      { ...filters, models: [...demoModels] },
      previous,
    );
    assert.equal(all.length, 7 * 10 * demoModels.length);
    assert.deepEqual(
      all,
      selectResponses(demoPrompts, { ...defaultFilters, days: '7' }, previous),
      'The default selection includes every model',
    );
  }
  const report = getDemoReport(demoPrompts, filters);
  for (const brand of report.brands) {
    assert.equal(
      brand.visibility,
      brandMetrics(report.responses, brand.id).visibility,
      'Report metrics must use only responses from selected models',
    );
  }
  const empty = getDemoReport(demoPrompts, { ...filters, models: [] });
  assert.equal(empty.responses.length, 0);
  assert.equal(empty.previous.length, 0);
  assert.equal(empty.trend.length, 7);
  assert.ok(
    empty.brands.every((brand) => brand.visibility === 0 && brand.change === 0),
  );
});

await test('empty filter results keep every metric finite and every chart day present', () => {
  const report = getDemoReport(demoPrompts, {
    ...defaultFilters,
    country: 'United States',
    tag: 'Branded',
  });
  assert.equal(report.responses.length, 0);
  assert.equal(report.previous.length, 0);
  assert.equal(report.trend.length, 28);
  assert.equal(report.brands.length, demoBrands.length);
  for (const brand of report.brands) {
    assert.deepEqual(
      [
        brand.mentions,
        brand.visibility,
        brand.sentiment,
        brand.position,
        brand.change,
      ],
      [0, 0, 0, 0, 0],
    );
  }
  for (const point of report.trend) {
    for (const brand of demoBrands)
      assert.equal(Reflect.get(point, brand.id), 0);
  }
});

await test('brand visibility uses all responses while sentiment and position use only mentions', () => {
  const base = {
    promptId: 'fixture',
    date: '2026-09-09T07:00:00.000Z',
    model: 'ChatGPT' as const,
    sourceIds: [],
    consultedSourceIds: null,
  };
  const responses: DemoResponse[] = [
    { ...base, id: 'one', brandIds: ['conversion', 'mestre'], sentiment: 80 },
    { ...base, id: 'two', brandIds: ['mestre', 'conversion'], sentiment: 90 },
    { ...base, id: 'three', brandIds: ['mestre'], sentiment: 10 },
  ];
  const conversion = brandMetrics(responses, 'conversion');
  assert.equal(conversion.mentions, 2);
  assert.ok(Math.abs(conversion.visibility - 200 / 3) < 1e-10);
  assert.equal(conversion.sentiment, 85);
  assert.equal(conversion.position, 1.5);
  assert.equal(brandMetrics(responses, 'mestre').visibility, 100);
  assert.deepEqual(brandMetrics(responses, 'absent'), {
    mentions: 0,
    visibility: 0,
    sentiment: 0,
    position: 0,
  });
  assert.deepEqual(brandMetrics([], 'conversion'), {
    mentions: 0,
    visibility: 0,
    sentiment: 0,
    position: 0,
  });
});

await test('filtered reports preserve cited evidence and explicitly unavailable consulted evidence', () => {
  const sourceIds = new Set(demoSources.map((source) => source.id));
  const responses = selectResponses(demoPrompts, {
    ...defaultFilters,
    days: '7',
    models: ['Perplexity'],
  });
  assert.equal(responses.length, 70);
  assert.ok(
    responses.every((response) => response.consultedSourceIds === null),
  );
  assert.ok(responses.every((response) => response.sourceIds.length > 0));
  for (const response of demoResponses) {
    assert.equal(
      new Set(response.sourceIds).size,
      response.sourceIds.length,
      'Citation ratios must count each source at most once per response',
    );
    assert.ok(response.sourceIds.every((id) => sourceIds.has(id)));
    assert.ok(
      response.consultedSourceIds === null ||
        response.consultedSourceIds.every((id) => sourceIds.has(id)),
    );
  }
  const chatgpt = selectResponses(demoPrompts, {
    ...defaultFilters,
    days: '7',
    models: ['ChatGPT'],
  });
  assert.ok(chatgpt.every((response) => response.consultedSourceIds !== null));
  assert.ok(
    chatgpt.some((response) =>
      response.consultedSourceIds?.some(
        (id) => !response.sourceIds.includes(id),
      ),
    ),
    'Consulted evidence remains distinct from citations',
  );
});

await test('multiple selections union within dimensions and intersect between dimensions with optional all-tags matching', () => {
  const prompts = [
    {
      id: 'p1',
      text: 'Question one?',
      topic: 'A',
      country: 'Brazil',
      tags: ['X', 'Y'],
      status: 'active' as const,
    },
    {
      id: 'p2',
      text: 'Question two?',
      topic: 'B',
      country: 'United States',
      tags: ['Y'],
      status: 'active' as const,
    },
    {
      id: 'p3',
      text: 'Question three?',
      topic: 'C',
      country: 'Brazil',
      tags: ['X'],
      status: 'active' as const,
    },
  ];
  const filters = {
    ...defaultFilters,
    country: ['Brazil', 'United States'],
    topic: ['A', 'B'],
    tag: ['X', 'Y'],
  };
  assert.deepEqual(
    prompts
      .filter((prompt) => promptMatchesFilters(prompt, filters))
      .map((prompt) => prompt.id),
    ['p1', 'p2'],
  );
  assert.deepEqual(
    prompts
      .filter((prompt) =>
        promptMatchesFilters(prompt, { ...filters, tagMode: 'all' }),
      )
      .map((prompt) => prompt.id),
    ['p1'],
  );
  assert.equal(
    prompts.filter((prompt) =>
      promptMatchesFilters(prompt, { ...filters, country: [] }),
    ).length,
    0,
  );
  const selected = {
    ...defaultFilters,
    models: ['ChatGPT', 'Claude'] as const,
    country: ['Brazil', 'United States'],
    topic: [...new Set(demoPrompts.slice(0, 3).map((prompt) => prompt.topic))],
    tag: ['Discovery', 'Comparison'],
  };
  const report = selectResponses(demoPrompts, {
    ...selected,
    models: [...selected.models],
  });
  assert.ok(report.length > 0);
  assert.ok(
    report.every(
      (response) =>
        selected.models.includes(response.model as 'ChatGPT' | 'Claude') &&
        promptMatchesFilters(
          demoPrompts.find((prompt) => prompt.id === response.promptId)!,
          { ...selected, models: [...selected.models] },
        ),
    ),
  );
});
