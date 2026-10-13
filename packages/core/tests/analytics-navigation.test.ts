import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsLocation,
  changeNavigationSession,
  closedDetails,
  currentContext,
  openPromptNavigation,
  resolveAnalyticsLocation,
} from '../components/analytics/navigation-state.ts';
import {
  createDemoSession,
  switchDemoContext,
  type DemoSession,
} from '../components/analytics/workspace-data.ts';
import {
  defaultFilters,
  demoResponses,
  selectResponses,
  type DemoFilters,
} from '../components/analytics/demo-data.ts';
import { promptKey } from '../components/analytics/routes.ts';

const conversionPath = '/app/preview/workspaces/conversion/projects/conversion';
const labPath = '/app/preview/workspaces/seo-lab/projects/seo-lab';

function resolveLink(session: DemoSession, link: string) {
  const url = new URL(link, 'https://lastfind.example');
  return resolveAnalyticsLocation(session, url.pathname, url.search);
}

await test('a shared report restores project, section and intersecting model filters', () => {
  const session = createDemoSession();
  const filters: DemoFilters = {
    days: '14',
    models: ['ChatGPT', 'Claude'],
    country: 'Brazil',
    topic: 'Agências & SEO',
    tag: 'Alta intenção',
  };
  const original = {
    ...resolveAnalyticsLocation(session, `${conversionPath}/models`),
    filters,
  };
  const link = analyticsLocation(original);
  const restored = resolveLink(
    switchDemoContext(createDemoSession(), { workspaceId: 'lab' }),
    link,
  );

  assert.equal(restored.error, null);
  assert.equal(restored.session.workspaceId, 'conversion');
  assert.equal(restored.session.projectId, 'conversion-web');
  assert.equal(restored.tab, 'models');
  assert.deepEqual(restored.filters, filters);
  assert.equal(analyticsLocation(restored), link);
  assert.equal(session.workspaceId, 'conversion');

  const none = resolveLink(
    session,
    analyticsLocation({ ...original, filters: { ...filters, models: [] } }),
  );
  assert.deepEqual(
    none.filters.models,
    [],
    'An empty model selection survives sharing',
  );
  const defaults = resolveAnalyticsLocation(
    session,
    `${conversionPath}/overview`,
  );
  assert.deepEqual(defaults.filters, defaultFilters);
  assert.equal(analyticsLocation(defaults), `${conversionPath}/overview`);
});

await test('direct prompt, brand, chat and source links restore only their own detail', () => {
  const session = createDemoSession();
  const prompt = currentContext(session).project.prompts[0];
  const response = demoResponses.find((row) => row.promptId === prompt.id)!;
  const cases = [
    {
      path: `${conversionPath}/prompts/${promptKey(prompt)}`,
      tab: 'overview',
      detail: { promptId: prompt.id },
    },
    {
      path: `${conversionPath}/brands/mestre`,
      tab: 'competitors',
      detail: { brandId: 'mestre' },
    },
    {
      path: `${conversionPath}/chats/${response.id}`,
      tab: 'chats',
      detail: { chatId: response.id },
    },
    {
      path: `${conversionPath}/sources/conversion.com.br`,
      tab: 'sources',
      detail: { sourceDomain: 'conversion.com.br' },
    },
  ];
  for (const entry of cases) {
    const restored = resolveAnalyticsLocation(session, entry.path);
    assert.equal(restored.error, null, entry.path);
    assert.equal(restored.tab, entry.tab);
    for (const [key, value] of Object.entries({
      ...closedDetails,
      ...entry.detail,
    })) {
      assert.equal(Reflect.get(restored, key), value, entry.path);
    }
    assert.equal(analyticsLocation(restored), entry.path);
  }
});

await test('workspace and account settings links resolve without inventing a project URL', () => {
  const session = createDemoSession();
  for (const section of ['workspace', 'members', 'projects'] as const) {
    const path = `/app/preview/workspaces/seo-lab/settings/${section}`;
    const restored = resolveAnalyticsLocation(session, path);
    assert.equal(restored.error, null);
    assert.equal(restored.tab, 'settings');
    assert.equal(restored.settingsSection, section);
    assert.equal(restored.session.workspaceId, 'lab');
    assert.equal(restored.session.projectId, 'lab-web');
    assert.equal(analyticsLocation(restored), path);
  }
  const profile = resolveAnalyticsLocation(
    session,
    '/app/preview/account/profile',
  );
  assert.equal(profile.settingsSection, 'profile');
  assert.equal(analyticsLocation(profile), '/app/preview/account/profile');
});

await test('workspace URLs require active membership and resolve project slugs within that workspace', () => {
  const session = createDemoSession();
  const marina = switchDemoContext(session, { userId: 'marina' });
  const denied = resolveAnalyticsLocation(marina, `${labPath}/overview`);
  assert.equal(denied.error, 'no-access');
  assert.equal(denied.session.workspaceId, 'conversion');
  assert.equal(denied.promptId, null);

  const invited = {
    ...session,
    workspaces: session.workspaces.map((workspace) => ({
      ...workspace,
      members: workspace.members.map((member) =>
        member.userId === 'diego'
          ? { ...member, status: 'invited' as const }
          : member,
      ),
    })),
  };
  assert.equal(
    resolveAnalyticsLocation(invited, `${conversionPath}/overview`).error,
    'no-access',
  );
  assert.equal(
    resolveAnalyticsLocation(
      session,
      '/app/preview/workspaces/seo-lab/projects/conversion/overview',
    ).error,
    'unavailable',
    'A project in another workspace must not be found by a global slug search',
  );
});

await test('details from the sample project cannot expose its fixtures through another project', () => {
  const session = createDemoSession();
  const prompt = currentContext(session).project.prompts[0];
  const response = demoResponses[0];
  for (const suffix of [
    `prompts/${promptKey(prompt)}`,
    'brands/conversion',
    `chats/${response.id}`,
    'sources/conversion.com.br',
  ]) {
    const restored = resolveAnalyticsLocation(session, `${labPath}/${suffix}`);
    assert.equal(restored.error, 'unavailable', suffix);
    assert.equal(restored.session.projectId, 'lab-web');
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(closedDetails).map((key) => [
          key,
          Reflect.get(restored, key),
        ]),
      ),
      closedDetails,
    );
  }

  const withoutPrompt = createDemoSession();
  withoutPrompt.workspaces[0].projects[0].prompts =
    withoutPrompt.workspaces[0].projects[0].prompts.filter(
      (item) => item.id !== response.promptId,
    );
  assert.equal(
    resolveAnalyticsLocation(
      withoutPrompt,
      `${conversionPath}/chats/${response.id}`,
    ).error,
    'unavailable',
    'A chat must still belong to a prompt in the current project',
  );
});

await test('back navigation uses the current edited session and preserves stable links after renaming', () => {
  const session = createDemoSession();
  const originalPrompt = currentContext(session).project.prompts[0];
  const originalLink = `${conversionPath}/prompts/${promptKey(originalPrompt)}`;
  const edited = createDemoSession();
  edited.workspaces[0].name = 'Conversion Intelligence';
  edited.workspaces[0].projects[0].name = 'New project display name';
  edited.workspaces[0].projects[0].prompts[0] = {
    ...originalPrompt,
    text: 'Como aparecer nas respostas de IA?',
    status: 'inactive',
  };
  const afterSwitch = switchDemoContext(edited, { workspaceId: 'lab' });
  const restored = resolveLink(afterSwitch, originalLink);

  assert.equal(restored.error, null);
  assert.equal(restored.promptId, originalPrompt.id);
  assert.equal(
    currentContext(restored.session).workspace.name,
    'Conversion Intelligence',
  );
  assert.equal(
    currentContext(restored.session).project.name,
    'New project display name',
  );
  assert.equal(
    currentContext(restored.session).project.prompts[0].status,
    'inactive',
  );
  assert.equal(
    currentContext(restored.session).project.prompts[0].text,
    'Como aparecer nas respostas de IA?',
  );
  assert.equal(
    restored.session.workspaces,
    afterSwitch.workspaces,
    'History must retain current edits, not recreate initial fixtures',
  );
  const canonical = analyticsLocation(restored);
  assert.ok(
    canonical.startsWith(`${conversionPath}/prompts/${originalPrompt.id}-`),
  );
  assert.equal(resolveLink(afterSwitch, canonical).promptId, originalPrompt.id);
});

await test('context changes clear details and filters while same-context edits retain the report', () => {
  const session = createDemoSession();
  const selected = resolveAnalyticsLocation(
    session,
    `${conversionPath}/brands/mestre`,
    '?days=7&models=claude',
  );
  const edited = {
    ...session,
    users: session.users.map((user) => ({
      ...user,
      name: `${user.name} edited`,
    })),
  };
  const sameContext = changeNavigationSession(selected, edited);
  assert.equal(sameContext.brandId, 'mestre');
  assert.deepEqual(sameContext.filters, selected.filters);

  for (const next of [
    switchDemoContext(session, { workspaceId: 'lab' }),
    switchDemoContext(session, { userId: 'marina' }),
  ]) {
    const changed = changeNavigationSession(selected, next);
    assert.deepEqual(changed.filters, defaultFilters);
    assert.notEqual(changed.filters.models, defaultFilters.models);
    assert.equal(changed.error, null);
    for (const key of Object.keys(closedDetails))
      assert.equal(Reflect.get(changed, key), null);
  }
});

await test('expired demo links show unavailable and unknown structures show not-found', () => {
  const session = createDemoSession();
  const temporary = createDemoSession();
  const workspace = temporary.workspaces[0];
  workspace.projects.push({
    id: 'temporary-project-id',
    slug: 'temporary-project',
    name: 'Temporary project',
    domain: 'example.org',
    prompts: [],
  });
  const temp = switchDemoContext(temporary, {
    projectId: 'temporary-project-id',
  });
  const temporaryLink = analyticsLocation(
    resolveAnalyticsLocation(
      temp,
      '/app/preview/workspaces/conversion/projects/temporary-project/overview',
    ),
  );
  assert.equal(resolveLink(temp, temporaryLink).error, null);
  assert.equal(resolveLink(session, temporaryLink).error, 'unavailable');

  const prompt = {
    ...currentContext(temporary).project.prompts[0],
    id: 'p-temporary',
    text: 'A prompt created in this browser session',
  };
  currentContext(temporary).project.prompts.push(prompt);
  const promptLink = `${conversionPath}/prompts/${promptKey(prompt)}`;
  assert.equal(resolveLink(temporary, promptLink).promptId, prompt.id);
  assert.equal(resolveLink(session, promptLink).error, 'unavailable');
  assert.equal(
    resolveAnalyticsLocation(
      session,
      '/app/preview/workspaces/temporary-workspace/settings/members',
    ).error,
    'unavailable',
  );
  assert.equal(
    resolveAnalyticsLocation(session, `${conversionPath}/brands/no-such-brand`)
      .error,
    'unavailable',
  );
  assert.equal(
    resolveAnalyticsLocation(
      session,
      `${conversionPath}/sources/missing.example`,
    ).error,
    'unavailable',
  );
  assert.equal(
    resolveAnalyticsLocation(session, `${conversionPath}/unrecognized-section`)
      .error,
    'not-found',
  );
});

await test('authenticated paths stay authenticated when serialized and do not fall into preview', () => {
  const path = '/app/workspaces/conversion/projects/conversion/chats';
  const state = resolveAnalyticsLocation(createDemoSession(), path);
  assert.equal(state.error, null);
  assert.equal(state.base, '/app');
  assert.equal(analyticsLocation(state), path);
});

await test('semantic report sections and attribute settings round-trip through browser history and copied URLs', () => {
  for (const view of [
    'associations',
    'attributes',
    'engines',
    'sources',
    'entities',
    'opportunities',
    'reports',
  ]) {
    const state = resolveAnalyticsLocation(
      createDemoSession(),
      '/app/preview/workspaces/conversion/projects/conversion/semantic-branding',
      `?view=${view}&models=claude`,
    );
    assert.equal(state.semanticSection, view);
    const url = new URL(analyticsLocation(state), 'https://example.test');
    const restored = resolveAnalyticsLocation(
      state.session,
      url.pathname,
      url.search,
    );
    assert.equal(restored.semanticSection, view);
    assert.deepEqual(restored.filters.models, ['Claude']);
  }
  assert.equal(
    resolveAnalyticsLocation(
      createDemoSession(),
      '/app/preview/workspaces/conversion/projects/conversion/semantic-branding',
      '?view=unknown',
    ).semanticSection,
    'associations',
  );
});

await test('opening a prompt retains every filter through its URL, report and back navigation', () => {
  const session = createDemoSession();
  const prompts = currentContext(session).project.prompts;
  const prompt = prompts[0];
  const filters: DemoFilters = {
    ...defaultFilters,
    days: '7',
    models: ['ChatGPT', 'Claude'],
    country: ['Brazil', 'United States'],
    topic: [prompt.topic, 'Other topic'],
    tag: [...prompt.tags, 'Comparison'],
    tagMode: 'any',
  };
  const list = {
    ...resolveAnalyticsLocation(session, `${conversionPath}/prompts`),
    filters,
  };
  const opened = openPromptNavigation(list, prompt.id);
  assert.deepEqual(opened.filters, filters);
  assert.equal(opened.promptId, prompt.id);
  const restored = resolveLink(session, analyticsLocation(opened));
  const { tagMode: _tagMode, ...canonicalFilters } = filters;
  assert.deepEqual(restored.filters, canonicalFilters);
  const expected = selectResponses(prompts, filters).filter(
    (response) => response.promptId === prompt.id,
  );
  assert.ok(expected.length > 0);
  assert.deepEqual(selectResponses([prompt], restored.filters), expected);
  assert.deepEqual(
    resolveLink(session, analyticsLocation(list)).filters,
    restored.filters,
  );
  const emptyScope = openPromptNavigation(
    { ...list, filters: { ...filters, country: [], tagMode: 'all' } },
    prompt.id,
  );
  const restoredEmpty = resolveLink(session, analyticsLocation(emptyScope));
  assert.deepEqual(restoredEmpty.filters.country, []);
  assert.equal(restoredEmpty.filters.tagMode, 'all');
  assert.deepEqual(selectResponses([prompt], restoredEmpty.filters), []);
});
