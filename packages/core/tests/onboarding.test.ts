import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnboardingProject } from '../components/analytics/onboarding-project.ts';
import {
  createDemoSession,
  switchDemoContext,
} from '../components/analytics/workspace-data.ts';
import { demoModels } from '../components/analytics/demo-data.ts';
import {
  completeOnboarding,
  createOnboardingDraft,
  initializeOnboardingPositioning,
  onboardingAttributeSuggestions,
  normalizeOnboardingDomain,
  onboardingSuggestions,
  promptIsDuplicate,
  refreshOnboardingSuggestions,
  validateOnboarding,
  type OnboardingDraft,
} from '../components/analytics/onboarding-data.ts';

function readyDraft(locale = 'en-US'): OnboardingDraft {
  const draft = initializeOnboardingPositioning({
    ...createOnboardingDraft(locale),
    segment: 'SEO agencies',
    brandName: 'Conversion',
    domain: 'conversion.com.br',
  });
  return { ...draft, prompts: onboardingSuggestions(draft, locale) };
}

await test('onboarding accepts complete websites and normalizes public domain identity', () => {
  assert.equal(
    normalizeOnboardingDomain(' https://www.Conversion.com.br/about?ref=demo '),
    'conversion.com.br',
  );
  assert.equal(normalizeOnboardingDomain('example.com'), 'example.com');
  assert.equal(
    normalizeOnboardingDomain('http://www.example.com/'),
    'example.com',
  );
  for (const value of [
    'localhost',
    '127.0.0.1',
    'https://user:secret@example.com',
    'https://example.com:8080',
    'bad-.example.com',
    'https://exa mple.com',
    'javascript:alert(1)',
    '',
    'x'.repeat(501),
  ]) {
    assert.equal(normalizeOnboardingDomain(value), null, value);
  }
});

await test('the starter set includes ten selected prompts with branded perception separated from discovery', () => {
  for (const locale of ['en-US', 'pt-BR']) {
    const draft = readyDraft(locale);
    assert.deepEqual(draft.models, demoModels);
    assert.equal(draft.prompts.length, 10);
    const selected = draft.prompts.filter((prompt) => prompt.selected);
    assert.equal(selected.length, 10);
    assert.equal(
      selected.filter((prompt) => prompt.intent === 'branded').length,
      3,
    );
    assert.equal(
      selected.filter((prompt) => prompt.tags.includes('Non-branded')).length,
      7,
    );
    assert.ok(
      selected
        .filter((prompt) => prompt.intent !== 'branded')
        .every((prompt) => !prompt.text.toLowerCase().includes('conversion')),
    );
    assert.ok(
      selected
        .filter((prompt) => prompt.intent === 'branded')
        .every((prompt) => prompt.text.includes('Conversion')),
    );
    assert.equal(new Set(draft.prompts.map((prompt) => prompt.id)).size, 10);
    assert.equal(validateOnboarding(draft, 2), null);
    assert.ok(
      draft.prompts.every((prompt) => prompt.country === draft.country),
    );
  }
  const english = readyDraft();
  assert.match(english.prompts[0].text, /Which.*United States/);
  const portuguese = readyDraft('pt-BR');
  assert.match(portuguese.prompts[0].text, /Quais.*no Brasil/);
  const usInPortuguese = onboardingSuggestions(
    { ...portuguese, country: 'United States' },
    'pt-BR',
  );
  assert.match(usInPortuguese[0].text, /nos Estados Unidos/);
});

await test('backtracking refreshes untouched examples while preserving selections, edits and custom prompts', () => {
  const draft = readyDraft();
  draft.prompts[0] = {
    ...draft.prompts[0],
    text: 'Which agency supports international e-commerce teams?',
    topic: 'International teams',
    edited: true,
    selected: false,
  };
  draft.prompts.push({
    ...draft.prompts[1],
    id: 'custom-one',
    text: 'Which agency can help with a complex website migration?',
    topic: 'Migrations',
    origin: 'custom',
    edited: true,
  });
  const snapshot = structuredClone(draft);
  const changed = {
    ...draft,
    brandName: 'Aurora',
    country: 'Brazil',
    language: 'pt-BR' as const,
    competitors: [{ name: 'Agência Mestre', domain: 'agenciamestre.com' }],
  };
  const refreshed = refreshOnboardingSuggestions(changed, 'pt-BR');
  assert.equal(refreshed.length, 11);
  assert.equal(refreshed[0].text, draft.prompts[0].text);
  assert.equal(refreshed[0].topic, 'International teams');
  assert.equal(refreshed[0].selected, false);
  assert.ok(refreshed.every((prompt) => prompt.country === 'Brazil'));
  assert.equal(
    refreshed.find((prompt) => prompt.id === 'custom-one')?.text,
    draft.prompts.at(-1)?.text,
  );
  assert.ok(
    refreshed
      .filter((prompt) => prompt.intent === 'branded')
      .every((prompt) => prompt.text.includes('Aurora')),
  );
  assert.ok(
    refreshed
      .filter((prompt) => prompt.intent === 'branded')
      .every((prompt) => prompt.text.includes('conversion.com.br')),
  );
  assert.deepEqual(
    draft,
    snapshot,
    'Refreshing does not mutate the earlier draft',
  );
});

await test('normalization catches duplicate questions across case, accents, whitespace and punctuation', () => {
  const prompts = [{ text: 'Quais são as melhores agências de SEO?' }];
  assert.equal(
    promptIsDuplicate(' QUAIS SAO AS MELHORES AGENCIAS DE SEO!!! ', prompts),
    true,
  );
  assert.equal(
    promptIsDuplicate('Quais agências atendem lojas internacionais?', prompts),
    false,
  );
  const draft = readyDraft();
  draft.prompts[1] = {
    ...draft.prompts[1],
    text: draft.prompts[0].text.toUpperCase(),
  };
  assert.equal(validateOnboarding(draft, 2), 'prompt-duplicate');
  draft.prompts[1].selected = false;
  assert.equal(
    validateOnboarding(draft, 2),
    null,
    'An unselected duplicate does not enter the project',
  );
});

await test('step validation allows skipping competitors and blocks incomplete, own-brand and duplicate entries', () => {
  const draft = readyDraft();
  assert.equal(validateOnboarding(draft, 1), null);
  assert.equal(
    validateOnboarding(
      { ...draft, competitors: [{ name: '', domain: '' }] },
      1,
    ),
    null,
  );
  assert.equal(
    validateOnboarding(
      { ...draft, competitors: [{ name: '', domain: 'mestre.com' }] },
      1,
    ),
    'competitor-name',
  );
  assert.equal(
    validateOnboarding(
      { ...draft, competitors: [{ name: 'Mestre', domain: '' }] },
      1,
    ),
    'competitor-domain',
  );
  assert.equal(
    validateOnboarding(
      {
        ...draft,
        competitors: [
          { name: 'Another label', domain: 'https://www.conversion.com.br/' },
        ],
      },
      1,
    ),
    'competitor-duplicate',
  );
  assert.equal(
    validateOnboarding(
      {
        ...draft,
        competitors: [{ name: 'Conversion', domain: 'another.example' }],
      },
      1,
    ),
    'competitor-duplicate',
  );
  assert.equal(
    validateOnboarding(
      {
        ...draft,
        competitors: [
          { name: 'Mestre', domain: 'mestre.com' },
          { name: 'MESTRE', domain: 'mestre.example' },
        ],
      },
      1,
    ),
    'competitor-duplicate',
  );
});

await test('onboarding cannot complete without valid brand, prompts and at least one model', () => {
  const draft = readyDraft();
  assert.equal(validateOnboarding(createOnboardingDraft(), 0), 'brand');
  assert.equal(
    validateOnboarding({ ...draft, domain: 'invalid' }, 0),
    'domain',
  );
  assert.equal(validateOnboarding({ ...draft, segment: '' }, 0), 'segment');
  assert.equal(
    validateOnboarding({ ...draft, country: 'unknown' }, 0),
    'country',
  );
  assert.equal(
    validateOnboarding({ ...draft, prompts: [] }, 2),
    'prompts-empty',
  );
  assert.equal(validateOnboarding({ ...draft, models: [] }, 3), 'models-empty');
  assert.throws(
    () => completeOnboarding({ ...draft, prompts: [] }),
    /prompts-empty/,
  );
  assert.throws(
    () => completeOnboarding({ ...draft, models: [] }),
    /models-empty/,
  );
  assert.equal(
    validateOnboarding(
      { ...draft, prompts: [{ ...draft.prompts[0], text: 'short' }] },
      2,
    ),
    'prompt-invalid',
  );
  assert.equal(
    validateOnboarding(
      {
        ...draft,
        prompts: Array.from({ length: 31 }, (_, index) => ({
          ...draft.prompts[0],
          id: `${index}`,
          text: `Which SEO agency supports this business case number ${index}?`,
        })),
      },
      2,
    ),
    'prompts-limit',
  );
});

await test('completion returns only selected prompts, independent tags and the current model catalog', () => {
  const draft = readyDraft();
  draft.brandName = ' Conversion ';
  draft.domain = 'https://www.conversion.com.br/about';
  draft.competitors = [
    { name: ' Agência Mestre ', domain: 'https://www.agenciamestre.com/' },
    { name: '', domain: '' },
  ];
  draft.models = [demoModels.at(-1)!, demoModels[0], demoModels[0]];
  let identifier = 0;
  const result = completeOnboarding(draft, () => `onboarding-${++identifier}`);
  assert.equal(result.brandName, 'Conversion');
  assert.equal(result.domain, 'conversion.com.br');
  assert.deepEqual(result.competitors, [
    { name: 'Agência Mestre', domain: 'agenciamestre.com' },
  ]);
  assert.deepEqual(result.models, [demoModels[0], demoModels.at(-1)!]);
  assert.equal(result.prompts.length, 10);
  assert.equal(new Set(result.prompts.map((prompt) => prompt.id)).size, 10);
  assert.ok(
    result.prompts.every(
      (prompt) =>
        prompt.status === 'active' && prompt.country === draft.country,
    ),
  );
  assert.ok(
    result.prompts.every(
      (prompt) => !('selected' in prompt) && !('origin' in prompt),
    ),
  );
  const originalTagCount = draft.prompts[0].tags.length;
  result.prompts[0].tags.push('Session-only edit');
  assert.equal(draft.prompts[0].tags.length, originalTagCount);
  assert.equal(result.prompts[0].id, 'p-onboarding-1');
});

await test('attributes are contextual starting points and keep their identifiers and edits after backtracking', () => {
  const draft = readyDraft('pt-BR');
  assert.equal(draft.semantic.enabled, true);
  assert.equal(draft.semantic.attributes.length, 3);
  draft.semantic.attributes[0].name = 'Migrações sem surpresas';
  draft.semantic.attributes[0].description =
    'Preservar a clareza durante mudanças de plataforma.';
  const revised = initializeOnboardingPositioning({
    ...draft,
    segment: 'Streaming services',
    language: 'en-US',
  });
  assert.deepEqual(revised.semantic.attributes, draft.semantic.attributes);
  assert.deepEqual(
    onboardingAttributeSuggestions('Unknown category', 'pt-BR').map(
      (attribute) => attribute.name,
    ),
    ['Qualidade', 'Confiança', 'Cuidado com o cliente'],
  );
  assert.equal(
    createOnboardingDraft().segment,
    '',
    'A new brand is never assumed to be an SEO agency',
  );
});

await test('research language controls untouched questions independently of interface locale and desired names', () => {
  const draft = readyDraft('pt-BR');
  const english = refreshOnboardingSuggestions(
    { ...draft, language: 'en-US' },
    'pt-BR',
  );
  assert.match(english[0].text, /^Which/);
  assert.ok(
    english
      .filter((prompt) => prompt.intent === 'branded')
      .every((prompt) =>
        prompt.text.includes(
          'Conversion (conversion.com.br), in the category seo agencies',
        ),
      ),
  );
  assert.ok(
    english
      .filter((prompt) => prompt.intent !== 'branded')
      .every(
        (prompt) =>
          !prompt.text.includes('Conversion') &&
          !prompt.text.includes('conversion.com.br'),
      ),
  );
  assert.ok(
    english.some((prompt) =>
      prompt.text.includes(draft.semantic.attributes[0].name),
    ),
  );
  const result = completeOnboarding({
    ...draft,
    language: 'en-US',
    prompts: english,
  });
  assert.equal(result.language, 'en-US');
  assert.deepEqual(result.semantic, draft.semantic);
});

await test('semantic attributes validate blanks, duplicates, count and optional descriptions', () => {
  const draft = readyDraft();
  const withAttributes = (
    attributes: OnboardingDraft['semantic']['attributes'],
  ) => ({ ...draft, semantic: { enabled: true, attributes } });
  assert.equal(validateOnboarding(withAttributes([]), 1), 'semantic-count');
  assert.equal(
    validateOnboarding(
      withAttributes([{ id: 'a', name: ' ', description: '' }]),
      1,
    ),
    'semantic-name',
  );
  assert.equal(
    validateOnboarding(
      withAttributes([
        { id: 'a', name: 'Trust', description: '' },
        { id: 'b', name: ' TRUST ', description: '' },
      ]),
      1,
    ),
    'semantic-duplicate',
  );
  assert.equal(
    validateOnboarding(
      withAttributes([
        { id: 'a', name: 'Trust', description: 'x'.repeat(241) },
      ]),
      1,
    ),
    'semantic-description',
  );
  assert.equal(
    validateOnboarding(
      { ...draft, semantic: { enabled: false, attributes: [] } },
      1,
    ),
    null,
  );
  assert.equal(
    validateOnboarding({ ...draft, language: 'unsupported' as 'en-US' }, 0),
    'language',
  );
});

await test('extra attributes offer choices without exceeding ten initial selections', () => {
  const draft = readyDraft();
  draft.semantic.attributes = Array.from({ length: 10 }, (_, index) => ({
    id: `a-${index}`,
    name: `Attribute ${index}`,
    description: '',
  }));
  draft.prompts = onboardingSuggestions(draft);
  assert.equal(draft.prompts.length, 24);
  assert.equal(draft.prompts.filter((prompt) => prompt.selected).length, 10);
  assert.equal(validateOnboarding(draft, 2), null);
  draft.prompts[10].selected = true;
  assert.equal(validateOnboarding(draft, 2), 'prompts-limit');
});

await test('disabling semantic branding removes its questions while keeping an editable history for re-enabling', () => {
  const draft = readyDraft();
  const prompt = draft.prompts.find((item) => item.semanticAttributeId)!;
  prompt.text =
    'Which brands have proven expertise in difficult technical migrations?';
  prompt.edited = true;
  prompt.selected = false;
  const disabled = {
    ...draft,
    semantic: { ...draft.semantic, enabled: false },
    promptHistory: draft.prompts,
  };
  disabled.prompts = refreshOnboardingSuggestions(disabled);
  assert.equal(disabled.prompts.length, 4);
  const restored = refreshOnboardingSuggestions({
    ...disabled,
    semantic: { ...draft.semantic, enabled: true },
  });
  assert.equal(
    restored.find((item) => item.id === prompt.id)?.text,
    prompt.text,
  );
  assert.equal(restored.find((item) => item.id === prompt.id)?.selected, false);
});

await test('created project owns its semantic configuration, language, prompt ids and workspace without borrowed answers', () => {
  const original = switchDemoContext(createDemoSession(), {
    workspaceId: 'lab',
  });
  const result = completeOnboarding(readyDraft('pt-BR'));
  const created = createOnboardingProject(original, result, 'new-streaming');
  const project = created.workspaces[1].projects.find(
    (item) => item.id === 'new-streaming',
  )!;
  assert.equal(created.workspaceId, 'lab');
  assert.equal(created.projectId, 'new-streaming');
  assert.equal(project.setup?.language, 'pt-BR');
  assert.deepEqual(project.setup?.semantic, result.semantic);
  assert.ok(
    project.prompts.every((prompt) =>
      prompt.id.startsWith('new-streaming-prompt-'),
    ),
  );
  assert.deepEqual(created.workspaces[0], original.workspaces[0]);
  assert.ok(!('responses' in project));
  result.semantic!.attributes[0].name = 'Changed only in returned setup';
  assert.notEqual(
    project.setup?.semantic?.attributes[0].name,
    result.semantic!.attributes[0].name,
  );
  const viewer = switchDemoContext(createDemoSession(), { userId: 'lucas' });
  assert.strictEqual(createOnboardingProject(viewer, result), viewer);
  const repeated = createOnboardingProject(
    created,
    completeOnboarding(readyDraft()),
    'second-brand',
  );
  assert.equal(repeated.workspaces[1].projects.at(-1)?.slug, 'conversion-2');
});
