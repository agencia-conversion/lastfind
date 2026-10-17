import {
  defaultFilters,
  filterValues,
  demoModels,
  type DemoFilters,
  type DemoPrompt,
} from './demo-data.ts';
import { isValidDateRange } from './date-range.ts';
import type {
  DemoProject,
  DemoWorkspace,
  SettingsSection,
} from './workspace-data.ts';

export type AnalyticsRoute = {
  base: '/app';
  workspaceSlug?: string;
  projectSlug?: string;
  tab: string;
  settingsSection?: SettingsSection;
  promptKey?: string;
  brandId?: string;
  chatId?: string;
  sourceDomain?: string;
};

const sections = [
  'overview',
  'prompts',
  'brands',
  'sources',
  'models',
  'chats',
  'semantic-branding',
];
const settings = ['workspace', 'members', 'projects'];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const idPattern = /^[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*$/;
const validSlug = (value: string | undefined): value is string =>
  !!value && value.length <= 72 && slugPattern.test(value);
const validId = (value: string | undefined): value is string =>
  !!value && value.length <= 180 && idPattern.test(value);
const validDomain = (value: string | undefined): value is string =>
  !!value &&
  value.length <= 253 &&
  /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i.test(value);

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72)
      .replace(/-+$/g, '') || 'untitled'
  );
}

export function uniqueSlug(name: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const ending = `-${suffix++}`;
    candidate = `${base.slice(0, 72 - ending.length).replace(/-+$/g, '')}${ending}`;
  }
  return candidate;
}

export function promptKey(prompt: Pick<DemoPrompt, 'id' | 'text'>): string {
  if (!validId(prompt.id)) throw new Error('Invalid prompt ID');
  return `${prompt.id}-${slugify(prompt.text)}`;
}

export function resolvePromptKey(
  key: string,
  prompts: DemoPrompt[],
): DemoPrompt | undefined {
  if (!key || key.length > 253 || !idPattern.test(key)) return undefined;
  return (
    prompts.find((prompt) => prompt.id === key) ??
    [...prompts]
      .sort((a, b) => b.id.length - a.id.length)
      .find((prompt) => key.startsWith(`${prompt.id}-`))
  );
}

export function parseAnalyticsRoute(pathname: string): AnalyticsRoute | null {
  if (
    pathname.length > 700 ||
    !pathname.startsWith('/') ||
    /[?#]/.test(pathname)
  )
    return null;
  let parts: string[];
  try {
    parts = pathname.slice(1).split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.shift() !== 'app') return null;
  const base = '/app';
  if (parts.length === 1 && parts[0] === 'onboarding')
    return { base, tab: 'onboarding' };
  if (parts.length === 2 && parts[0] === 'account' && parts[1] === 'profile') {
    return { base, tab: 'settings', settingsSection: 'profile' };
  }
  if (parts[0] !== 'workspaces' || !validSlug(parts[1])) return null;
  const workspaceSlug = parts[1];
  if (
    parts.length === 4 &&
    parts[2] === 'settings' &&
    settings.includes(parts[3])
  ) {
    return {
      base,
      workspaceSlug,
      tab: 'settings',
      settingsSection: parts[3] as SettingsSection,
    };
  }
  if (parts[2] !== 'projects' || !validSlug(parts[3])) return null;
  const projectSlug = parts[3];
  const section = parts[4];
  if (!sections.includes(section)) return null;
  const route = {
    base,
    workspaceSlug,
    projectSlug,
    tab: section === 'brands' ? 'competitors' : section,
  } satisfies AnalyticsRoute;
  if (parts.length === 5) return route;
  if (parts.length !== 6) return null;
  const detail = parts[5];
  if (section === 'sources' && validDomain(detail)) {
    return { ...route, sourceDomain: detail.toLowerCase() };
  }
  if (
    section === 'prompts' &&
    detail.length <= 253 &&
    detail.includes('-') &&
    idPattern.test(detail)
  ) {
    return { ...route, tab: 'overview', promptKey: detail };
  }
  if (!validId(detail)) return null;
  if (section === 'brands') return { ...route, brandId: detail };
  if (section === 'chats') return { ...route, chatId: detail };
  return null;
}

export function buildAnalyticsPath(route: AnalyticsRoute): string {
  if (route.base !== '/app')
    throw new Error('Invalid analytics base');
  if (route.tab === 'onboarding') return `${route.base}/onboarding`;
  if (route.tab === 'settings' && route.settingsSection === 'profile') {
    return `${route.base}/account/profile`;
  }
  if (!validSlug(route.workspaceSlug))
    throw new Error('Invalid workspace slug');
  const workspace = `${route.base}/workspaces/${encodeURIComponent(route.workspaceSlug)}`;
  if (route.tab === 'settings') {
    const section = route.settingsSection ?? 'workspace';
    if (!settings.includes(section))
      throw new Error('Invalid settings section');
    return `${workspace}/settings/${section}`;
  }
  if (!validSlug(route.projectSlug)) throw new Error('Invalid project slug');
  const project = `${workspace}/projects/${encodeURIComponent(route.projectSlug)}`;
  if (route.promptKey) {
    if (
      route.promptKey.length > 253 ||
      !route.promptKey.includes('-') ||
      !idPattern.test(route.promptKey)
    )
      throw new Error('Invalid prompt key');
    return `${project}/prompts/${encodeURIComponent(route.promptKey)}`;
  }
  if (route.brandId) {
    if (!validId(route.brandId)) throw new Error('Invalid brand ID');
    return `${project}/brands/${encodeURIComponent(route.brandId)}`;
  }
  if (route.chatId) {
    if (!validId(route.chatId)) throw new Error('Invalid chat ID');
    return `${project}/chats/${encodeURIComponent(route.chatId)}`;
  }
  if (route.sourceDomain) {
    if (!validDomain(route.sourceDomain))
      throw new Error('Invalid source domain');
    return `${project}/sources/${encodeURIComponent(route.sourceDomain.toLowerCase())}`;
  }
  const section = route.tab === 'competitors' ? 'brands' : route.tab;
  if (!sections.includes(section)) throw new Error('Invalid analytics section');
  return `${project}/${section}`;
}

export function routeForProject(
  base: AnalyticsRoute['base'],
  workspace: Pick<DemoWorkspace, 'slug'>,
  project: Pick<DemoProject, 'slug'>,
  tab: string,
): AnalyticsRoute {
  return {
    base,
    workspaceSlug: workspace.slug,
    projectSlug: project.slug,
    tab,
  };
}

function filterText(value: string | null): string {
  const clean = value?.normalize('NFC').trim().replace(/\s+/g, ' ') ?? '';
  return clean && clean.length <= 120 && !/[\p{Cc}\p{Cf}]/u.test(clean)
    ? clean
    : 'all';
}

export function parseFilters(search: URLSearchParams): DemoFilters {
  const legacyModel = search.get('model')?.trim().toLowerCase() ?? '';
  const models = search.has('models')
    ? search.getAll('models').join(',').trim().toLowerCase()
    : demoModels.some((model) => model.toLowerCase() === legacyModel)
      ? legacyModel
      : '';
  const names = models.split(',').map((value) => value.trim());
  const knownNames = demoModels.map((model) => model.toLowerCase());
  const selection = (key: 'country' | 'topic' | 'tag') => {
    const raw = search.getAll(key);
    if (search.get(`${key}Empty`) === '1') return [];
    if (!raw.length || raw.includes('all')) return 'all';
    const values = [...new Set(raw.map(filterText))];
    if (values.includes('all') || values.length > 50) return 'all';
    return values.length === 1 ? values[0] : values;
  };
  const days = search.get('days') ?? '';
  const from = search.get('from');
  const to = search.get('to');
  const custom = isValidDateRange(from, to);
  return {
    days: custom
      ? 'custom'
      : ['1', '7', '14', '28', '30'].includes(days)
        ? days
        : defaultFilters.days,
    ...(custom ? { from: from!, to: to! } : {}),
    models:
      models === 'none'
        ? []
        : models &&
            models.length <= 200 &&
            names.every((name) => knownNames.includes(name))
          ? demoModels.filter((model) => names.includes(model.toLowerCase()))
          : [...demoModels],
    country: selection('country'),
    topic: selection('topic'),
    tag: selection('tag'),
    ...(search.get('tagMode') === 'all' ? { tagMode: 'all' as const } : {}),
  };
}

export function serializeFilters(filters: DemoFilters): URLSearchParams {
  const search = new URLSearchParams();
  if (isValidDateRange(filters.from, filters.to)) {
    search.set('from', filters.from!);
    search.set('to', filters.to!);
  } else if (['1', '7', '14', '30'].includes(filters.days)) {
    search.set('days', filters.days);
  }
  const selected = demoModels.filter((model) => filters.models.includes(model));
  if (selected.length !== demoModels.length)
    search.set(
      'models',
      selected.map((model) => model.toLowerCase()).join(',') || 'none',
    );
  for (const key of ['country', 'topic', 'tag'] as const) {
    if (filters[key] === 'all') continue;
    const values = [...new Set(filterValues(filters[key]).map(filterText))];
    if (values.includes('all') || values.length > 50) continue;
    if (!values.length) search.set(`${key}Empty`, '1');
    else values.forEach((value) => search.append(key, value));
  }
  if (filters.tagMode === 'all') search.set('tagMode', 'all');
  return search;
}

export const semanticSections = [
  'attributes',
  'associations',
  'engines',
  'sources',
  'entities',
  'opportunities',
  'reports',
];
export function parseSemanticSection(value: string | null | undefined) {
  return value && semanticSections.includes(value) ? value : 'associations';
}
export function serializeAnalyticsSearch(
  filters: DemoFilters,
  tab: string,
  semanticSection?: string | null,
) {
  const search = serializeFilters(filters);
  const view = parseSemanticSection(semanticSection);
  if (tab === 'semantic-branding' && view !== 'associations')
    search.set('view', view);
  return search;
}
