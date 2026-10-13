import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalyticsPath,
  parseAnalyticsRoute,
  parseFilters,
  promptKey,
  resolvePromptKey,
  routeForProject,
  serializeFilters,
  serializeAnalyticsSearch,
  slugify,
  uniqueSlug,
  type AnalyticsRoute,
} from '../components/analytics/routes.ts';
import {
  defaultFilters,
  demoPrompts,
  demoResponses,
} from '../components/analytics/demo-data.ts';
import { createDemoSession } from '../components/analytics/workspace-data.ts';

await test('canonical analytics routes preserve workspace, project and detail identity on both bases', () => {
  const session = createDemoSession();
  const workspace = session.workspaces[0];
  const project = workspace.projects[0];
  for (const base of ['/app', '/app/preview'] as const) {
    for (const tab of [
      'overview',
      'prompts',
      'competitors',
      'sources',
      'models',
      'chats',
    ]) {
      const route = routeForProject(base, workspace, project, tab);
      assert.deepEqual(parseAnalyticsRoute(buildAnalyticsPath(route)), route);
      assert.equal(
        buildAnalyticsPath(route),
        `${base}/workspaces/conversion/projects/conversion/${tab === 'competitors' ? 'brands' : tab}`,
      );
    }
    const details: AnalyticsRoute[] = [
      {
        ...routeForProject(base, workspace, project, 'overview'),
        promptKey: promptKey(demoPrompts[0]),
      },
      {
        ...routeForProject(base, workspace, project, 'competitors'),
        brandId: 'np',
      },
      {
        ...routeForProject(base, workspace, project, 'chats'),
        chatId: demoResponses[0].id,
      },
      {
        ...routeForProject(base, workspace, project, 'sources'),
        sourceDomain: 'searchenginejournal.com',
      },
    ];
    for (const route of details) {
      assert.deepEqual(parseAnalyticsRoute(buildAnalyticsPath(route)), route);
    }
    for (const response of demoResponses) {
      const route = {
        ...routeForProject(base, workspace, project, 'chats'),
        chatId: response.id,
      };
      assert.equal(
        parseAnalyticsRoute(buildAnalyticsPath(route))?.chatId,
        response.id,
      );
    }
  }
});

await test('workspace settings and account profile have separate canonical scopes', () => {
  for (const base of ['/app', '/app/preview'] as const) {
    for (const settingsSection of [
      'workspace',
      'members',
      'projects',
    ] as const) {
      const route: AnalyticsRoute = {
        base,
        workspaceSlug: 'seo-lab',
        tab: 'settings',
        settingsSection,
      };
      const pathname = `${base}/workspaces/seo-lab/settings/${settingsSection}`;
      assert.equal(buildAnalyticsPath(route), pathname);
      assert.deepEqual(parseAnalyticsRoute(pathname), route);
    }
    const profile: AnalyticsRoute = {
      base,
      tab: 'settings',
      settingsSection: 'profile',
    };
    assert.equal(buildAnalyticsPath(profile), `${base}/account/profile`);
    assert.deepEqual(parseAnalyticsRoute(buildAnalyticsPath(profile)), profile);
  }
});

await test('route parsing rejects unknown and malformed paths without falling back to another workspace', () => {
  for (const pathname of [
    '/app',
    '/app/preview',
    '/app/preview?tab=prompts',
    '/app/workspaces/conversion/projects/conversion/unknown',
    '/app/workspaces/conversion/projects/conversion/overview/',
    '/app/workspaces/conversion/projects/conversion/overview/p1-detail',
    '/app/workspaces/conversion/projects/conversion/prompts/p1',
    '/app/workspaces/conversion/projects/conversion/chats/id/extra',
    '/app/workspaces/conversion/settings/profile',
    '/app/workspaces/conversion/settings/billing',
    '/app/workspaces/conversion/projects/../../overview',
    '/app/workspaces/conversion/projects/conversion/brands/%2Fescape',
    '/app/workspaces/conversion/projects/conversion/sources/bad-.example.com',
    '/app/workspaces/conversion/projects/conversion/sources/https%3A%2F%2Fexample.com',
    '/app/workspaces/%00/projects/conversion/overview',
    '/app/workspaces/%E0%A4%A/projects/conversion/overview',
    '/app/workspaces/UPPERCASE/projects/conversion/overview',
    '//app/workspaces/conversion/projects/conversion/overview',
    'https://example.com/app/account/profile',
  ])
    assert.equal(parseAnalyticsRoute(pathname), null, pathname);
  assert.throws(() =>
    buildAnalyticsPath({
      base: '/app',
      workspaceSlug: '../escape',
      projectSlug: 'site',
      tab: 'overview',
    }),
  );
  assert.throws(() =>
    buildAnalyticsPath({
      base: '/app',
      workspaceSlug: 'team',
      projectSlug: 'site',
      tab: 'billing',
    }),
  );
  assert.throws(() =>
    buildAnalyticsPath({
      base: '/app',
      workspaceSlug: 'team',
      projectSlug: 'site',
      tab: 'chats',
      chatId: 'id/escape',
    }),
  );
  const escaped = parseAnalyticsRoute(
    '/app/workspaces/%63onversion/projects/conversion/overview',
  );
  assert.ok(escaped);
  assert.equal(
    buildAnalyticsPath(escaped),
    '/app/workspaces/conversion/projects/conversion/overview',
  );
});

await test('slugs normalize accents and punctuation and remain bounded through repeated collisions', () => {
  assert.equal(slugify('  Agência São Paulo & Co.  '), 'agencia-sao-paulo-co');
  assert.equal(slugify('***'), 'untitled');
  assert.equal(uniqueSlug('Agência', ['agencia', 'agencia-2']), 'agencia-3');
  const long = 'a'.repeat(140);
  assert.equal(slugify(long).length, 72);
  const next = uniqueSlug(long, [slugify(long)]);
  assert.equal(next.length, 72);
  assert.ok(next.endsWith('-2'));
  const session = createDemoSession();
  assert.equal(
    new Set(session.workspaces.map((workspace) => workspace.slug)).size,
    session.workspaces.length,
  );
  for (const workspace of session.workspaces) {
    assert.equal(
      new Set(workspace.projects.map((project) => project.slug)).size,
      workspace.projects.length,
    );
  }
});

await test('prompt links keep their identity after edits and do not confuse shared ID prefixes', () => {
  const original = demoPrompts[0];
  const oldKey = promptKey(original);
  const renamed = {
    ...original,
    text: 'Quais são as melhores agências de SEO?',
  };
  assert.equal(resolvePromptKey(oldKey, [renamed]), renamed);
  assert.notEqual(promptKey(renamed), oldKey);
  assert.equal(resolvePromptKey(original.id, [renamed]), renamed);
  assert.equal(
    resolvePromptKey('p10-a-different-title', demoPrompts)?.id,
    'p10',
  );
  assert.equal(resolvePromptKey('p100-does-not-exist', demoPrompts), undefined);
  assert.equal(resolvePromptKey('p1-../../escape', demoPrompts), undefined);
  const uuidPrompt = {
    ...original,
    id: 'p-05207a35-fd82-4614-8bdf-dcbd54d6d5cc',
    text: 'a'.repeat(200),
  };
  assert.equal(promptKey(uuidPrompt).length, uuidPrompt.id.length + 1 + 72);
  assert.equal(
    resolvePromptKey(promptKey(uuidPrompt), [uuidPrompt]),
    uuidPrompt,
  );
});

await test('filter URLs round-trip multiple or empty model selections and localized topic text', () => {
  assert.equal(serializeFilters(defaultFilters).toString(), '');
  assert.deepEqual(parseFilters(new URLSearchParams()), defaultFilters);
  for (const models of [
    ['ChatGPT', 'Claude'],
    [],
    [...defaultFilters.models],
  ] as const) {
    const filters = {
      days: '14',
      models: [...models],
      country: 'Brazil',
      topic: 'Agências de SEO',
      tag: 'Comparação & compra',
    };
    const search = serializeFilters(filters);
    assert.deepEqual(parseFilters(search), filters);
    assert.equal(
      search.get('models'),
      models.length === defaultFilters.models.length
        ? null
        : models.length === 0
          ? 'none'
          : 'chatgpt,claude',
    );
  }
  assert.deepEqual(
    parseFilters(new URLSearchParams('models=claude&models=chatgpt,claude'))
      .models,
    ['ChatGPT', 'Claude'],
  );
  assert.deepEqual(parseFilters(new URLSearchParams('model=Claude')).models, [
    'Claude',
  ]);
  assert.deepEqual(
    parseFilters(new URLSearchParams('model=all')).models,
    defaultFilters.models,
  );
  assert.deepEqual(
    parseFilters(new URLSearchParams('model=Claude&models=chatgpt')).models,
    ['ChatGPT'],
  );
});

await test('filter parsing bounds arbitrary labels and drops invalid values or unrelated URL parameters', () => {
  const search = new URLSearchParams({
    days: '365',
    models: 'chatgpt,unknown',
    country: '\u0000bad',
    topic: 'a'.repeat(121),
    tag: '\u0000bad',
    token: 'do-not-copy',
    tab: 'prompts',
  });
  assert.deepEqual(parseFilters(search), defaultFilters);
  assert.equal(serializeFilters(parseFilters(search)).toString(), '');
  const normalized = parseFilters(
    new URLSearchParams({
      days: '7',
      country: 'United States',
      topic: '  SEO   agencies  ',
      tag: 'São Paulo',
    }),
  );
  assert.equal(normalized.topic, 'SEO agencies');
  assert.equal(normalized.tag, 'São Paulo');
  assert.equal(normalized.days, '7');
  assert.equal(normalized.country, 'United States');
  assert.equal(
    parseFilters(new URLSearchParams('models=none,claude')).models.length,
    defaultFilters.models.length,
  );
});

await test('server canonical query preserves only allowed semantic views on semantic routes', () => {
  for (const view of [
    'engines',
    'sources',
    'entities',
    'opportunities',
    'reports',
  ]) {
    const query = new URLSearchParams(`models=claude&view=${view}`);
    assert.equal(
      serializeAnalyticsSearch(
        parseFilters(query),
        'semantic-branding',
        query.get('view'),
      ).toString(),
      query.toString(),
    );
  }
  for (const view of ['associations', 'untrusted', '<script>', ''])
    assert.equal(
      serializeAnalyticsSearch(
        defaultFilters,
        'semantic-branding',
        view,
      ).toString(),
      '',
    );
  assert.equal(
    serializeAnalyticsSearch(defaultFilters, 'overview', 'reports').toString(),
    '',
  );
});

await test('all filter dimensions round-trip multiple choices, explicit empty selections and literal none labels', () => {
  const filters = {
    ...defaultFilters,
    country: ['Brazil', 'United States'],
    topic: ['SEO agencies', 'AI search'],
    tag: ['Discovery', 'High intent'],
    tagMode: 'all' as const,
  };
  assert.deepEqual(parseFilters(serializeFilters(filters)), filters);
  for (const key of ['country', 'topic', 'tag'] as const) {
    const empty = { ...defaultFilters, [key]: [] };
    assert.deepEqual(parseFilters(serializeFilters(empty)), empty);
    assert.equal(serializeFilters(empty).get(`${key}Empty`), '1');
    assert.equal(parseFilters(new URLSearchParams(`${key}=none`))[key], 'none');
  }
  assert.equal(
    parseFilters(new URLSearchParams('country=France')).country,
    'France',
  );
});
