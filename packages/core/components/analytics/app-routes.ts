/**
 * The app's addresses: the workspace's slug (Cloud; the independent edition has one workspace and leaves it out), the
 * project's slug, one segment per screen and detail, and only the filters that differ from the default, with short names.
 * The app keeps its state in its long form (`tab`, `project`, `days`, `engine`...): `expandAppPath` reads an address into
 * it and `compactAppPath` writes it back. Before 0.1 (13/11/2026) no older shape is read and none redirects.
 *
 *   /app/conversion/acme                          Overview (Cloud: workspace `conversion`, project `acme`; selfhost: /app/acme)
 *   /app/conversion/acme/brands/hedgehog-digital  a brand (its key, spaces as hyphens)
 *   /app/conversion/acme/prompts/<prompt key>     a prompt
 *   /app/conversion/acme/sources/hubspot.com      a domain (a page: /sources?url=<url>)
 *   /app/conversion/acme/shopping/brands          Shopping > Brands (shopping/list: Shopping > Products)
 *   /app/conversion/acme/shopping/<slug>          a product (shopping/brands/<slug>: a brand in the product cards)
 *   /app/conversion/acme/comparison/attributes    Comparison > Attributes (also products, personas; /comparison: its overview)
 *   /app/conversion/acme/comparison/products/<id> a product's page in Comparison
 *   /app/conversion/acme/traffic/ai?llm=chatgpt   Traffic > AI Traffic, one LLM (also traffic/bots, ?bot=<id>, ?page=<path>)
 *   /app/conversion/acme/responses/<run id>       an answer
 *   /app/conversion/acme/settings/brand           a project's Settings section
 *   /app/conversion/settings/members              a workspace's Settings section (projects, members, connections, profile)
 *   /app/conversion/onboarding                    the New project wizard
 *   /app/conversion                               the workspace: its first project opens
 *   /app/admin/usage                              an Admin page (no workspace: Admin is the platform's)
 *   ?period=7d&model=chatgpt,gemini&topic=GEO&tag=paid&q=text
 *   ?brands=monitored,-rock content               the header's Brands filter (lib/brand-filter.ts), as written
 */

/** Screen in the path ↔ the app's `tab`. */
const SECTIONS: Record<string, string> = {
  prompts: 'prompts',
  topics: 'topics',
  brands: 'competitors',
  sources: 'sources',
  shopping: 'products',
  traffic: 'ai-bots',
  comparison: 'comparison',
  responses: 'responses',
  models: 'models',
  fanout: 'fanout',
  'semantic-branding': 'semantic-branding',
  agent: 'agent',
  contents: 'contents',
  artifacts: 'artifacts',
  brain: 'brain',
  skills: 'skills',
  opportunities: 'opportunities',
  settings: 'settings',
};
const TABS = Object.fromEntries(Object.entries(SECTIONS).map(([section, tab]) => [tab, section]));
/** Settings sections whose id reads oddly in an address. */
const SETTINGS_PATH: Record<string, string> = { workspace: 'brand', 'ai-bots': 'traffic' };
const SETTINGS_ID = Object.fromEntries(Object.entries(SETTINGS_PATH).map(([id, path]) => [path, id]));
/** Settings sections of the workspace (and My profile): their address names no project. */
export const WORKSPACE_SETTINGS = ['projects', 'members', 'connections', 'profile'];
/** Comparison's pages after its overview (`comparisonView`). */
const COMPARISON_PAGES = ['products', 'attributes', 'personas'];
/** Traffic's pages after its overview, and the drill downs they take from the query (`aiBotsView`: `ai?llm=chatgpt`). */
const AI_BOTS_PAGES = ['bots', 'ai'];
const AI_BOTS_FILTERS = ['bot', 'llm', 'page'];
/** AI model ids ↔ their short names in an address. */
const MODEL_NAME: Record<string, string> = { chat_gpt: 'chatgpt', google_ai_mode: 'ai-mode', google_ai_overviews: 'ai-overviews' };
const MODEL_ID = Object.fromEntries(Object.entries(MODEL_NAME).map(([id, name]) => [name, id]));

/**
 * Words never taken as a workspace's or a project's slug: the pages under /app (and under /app/<workspace>) and words a
 * reader would take for one. The migrations that gave every workspace and project its slug hold the same list.
 */
export const RESERVED_SLUGS = new Set([
  'app', 'admin', 'api', 'settings', 'new', 'login', 'logout', 'signin', 'sign-in', 'signup', 'sign-up', 'register',
  'onboarding', 'connect', 'complete-profile', 'preview', 'setup', 'account', 'accounts', 'workspace', 'workspaces',
  'project', 'projects', 'demo', 'docs', 'help', 'support', 'billing', 'oauth', 'mcp', 'shared', 'artifact', 'static',
  'assets', 'public', 'www', 'lastfind',
]);
/** A slug drawn from a name is cut to this; one typed in Settings may be a little longer. */
export const SLUG_BASE_MAX = 40;
export const SLUG_MAX = 48;
export const DEFAULT_DAYS = '28';
/** Where a "Start for free" goes: the sign-in page opened on its Create account tab (the site's and the demo's CTAs). */
export const SIGNUP_PATH = '/app?signup';

/**
 * A name as a slug: ASCII, lowercase, words joined by single hyphens, cut to SLUG_BASE_MAX; `fallback` when nothing is left.
 * The migrations that gave every workspace and project its slug do the same in SQL (accents folded, the rest a hyphen).
 */
export function slugBase(name: string, fallback: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/, '');
  return slug || fallback;
}
/** The slug a name gets among `taken`: the name's own, or with the next free number ("conversion-2"), never a random string. */
export function freeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base) && !RESERVED_SLUGS.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}
/** Why a slug typed in Settings cannot be used (uniqueness is the database's), or null. */
export function slugProblem(slug: string): 'format' | 'reserved' | null {
  if (slug.length > SLUG_MAX || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return 'format';
  return RESERVED_SLUGS.has(slug) ? 'reserved' : null;
}
/** The project an address's slug names in a list, or none. */
export const projectBySlug = <T extends { slug?: string | null }>(projects: readonly T[], slug: string | null | undefined) =>
  slug ? projects.find((project) => project.slug === slug) : undefined;

/** A brand key ("hedgehog digital") in an address and back: keys never hold a hyphen (brandKey turns it into a space). */
export const brandSlug = (key: string) => key.replace(/ /g, '-');
const brandKeyOf = (slug: string) => slug.replace(/-/g, ' ');
/** What only the path says: never read from the query. */
const PATH_KEYS = ['tab', 'project', 'workspace', 'section'];

/**
 * An address (the segments after `/app`, and its query) in the app's long form; null when it names no screen. `workspaced`:
 * the first segment is the workspace's slug (Cloud), kept as `workspace`; the project's slug is kept as `project`.
 */
export function expandAppPath(segments: string[], search: string | URLSearchParams, workspaced = false): URLSearchParams | null {
  const query = new URLSearchParams(search);
  let parts: string[];
  try {
    parts = segments.filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.length > 7 || parts.some((part) => part.length > 400)) return null;
  const long = new URLSearchParams();
  if (parts[0] === 'admin') {
    if (parts.length > 2) return null;
    long.set('tab', 'admin');
    if (parts[1]) long.set('section', parts[1]);
  } else {
    if (workspaced && parts.length) long.set('workspace', parts.shift()!);
    if (parts[0] === 'settings') {
      if (parts.length > 2) return null;
      long.set('tab', 'settings');
      long.set('section', SETTINGS_ID[parts[1] ?? ''] ?? parts[1] ?? 'projects');
    } else if (parts.length) {
      const [project, section, detail, ...rest] = parts;
      const tab = section === undefined ? 'overview' : SECTIONS[section];
      if (!tab) return null;
      // The details of two segments: a brand in Shopping (/shopping/brands/<slug>), and a product's, an attribute's or a persona's
      // page in Comparison (/comparison/products/<id>, /comparison/attributes/<id>, /comparison/personas/<id>).
      const productBrand = tab === 'products' && detail === 'brands' && rest.length === 1;
      const comparisonDetail = tab === 'comparison' && COMPARISON_PAGES.includes(detail ?? '') && rest.length === 1;
      if (rest.length && !productBrand && !comparisonDetail) return null;
      long.set('project', project!);
      long.set('tab', tab);
      if (detail !== undefined) {
        if (tab === 'prompts') long.set('prompt', detail);
        else if (tab === 'competitors') long.set('brandPage', brandKeyOf(detail));
        else if (tab === 'sources') {
          long.set('entity', 'domain');
          long.set('key', detail.toLowerCase());
        } else if (tab === 'responses') long.set('run', detail);
        else if (tab === 'products') long.set('productDetail', productBrand ? `brands/${rest[0]}` : detail);
        else if (tab === 'comparison' && COMPARISON_PAGES.includes(detail)) long.set('comparisonView', comparisonDetail ? `${detail}/${rest[0]}` : detail);
        else if (tab === 'ai-bots' && AI_BOTS_PAGES.includes(detail)) long.set('aiBotsView', detail);
        else if (tab === 'settings') long.set('section', SETTINGS_ID[detail] ?? detail);
        else return null;
      }
    }
  }
  for (const [key, value] of query) {
    if (PATH_KEYS.includes(key)) continue;
    if (key === 'period') {
      const days = /^(\d{1,3})d$/.exec(value)?.[1];
      if (days) long.set('days', days);
    } else if (key === 'model') long.set('engine', value.split(',').map((name) => MODEL_ID[name] ?? name).join(','));
    else if (key === 'q') long.set('query', value);
    else if (key === 'tag') long.set('tags', value);
    else if (key === 'url' && long.get('tab') === 'sources') {
      long.set('entity', 'url');
      long.set('key', value);
    } else long.append(key, value);
  }
  // Traffic's drill down travels with its page: `aiBotsView` holds both (`ai?llm=chatgpt`).
  const aiBotsView = long.get('aiBotsView');
  if (aiBotsView && !aiBotsView.includes('?')) {
    const filter = new URLSearchParams();
    for (const key of AI_BOTS_FILTERS) {
      const value = long.get(key);
      if (value) filter.set(key, value);
      long.delete(key);
    }
    if (filter.size) long.set('aiBotsView', `${aiBotsView}?${filter}`);
  }
  return long;
}

/**
 * The app's long form as an address: `project` and `workspace` are their slugs (no workspace: the independent edition).
 * Defaults are left out; what the path already says is not repeated in the query. Without a project, a project's screen
 * has no address of its own: the workspace's (its first project opens).
 */
export function compactAppPath(state: URLSearchParams, project: string | null, workspace: string | null = null): string {
  const query = new URLSearchParams(state);
  const take = (key: string) => {
    const value = query.get(key);
    query.delete(key);
    return value;
  };
  const tab = take('tab') ?? 'overview';
  const section = take('section');
  const prompt = take('prompt'),
    brandPage = take('brandPage'),
    run = take('run'),
    productDetail = take('productDetail'),
    comparisonView = take('comparisonView'),
    aiBotsView = take('aiBotsView'),
    entity = take('entity'),
    key = take('key');
  take('project');
  take('workspace');
  let path = workspace ? `/app/${encodeURIComponent(workspace)}` : '/app';
  const settings = encodeURIComponent(SETTINGS_PATH[section ?? 'workspace'] ?? section ?? 'brand');
  if (tab === 'admin') path = `/app/admin${section && section !== 'overview' ? `/${encodeURIComponent(section)}` : ''}`;
  else if (tab === 'settings' && (!project || WORKSPACE_SETTINGS.includes(section ?? ''))) path += `/settings/${settings}`;
  else if (project) {
    path += `/${encodeURIComponent(project)}`;
    const name = TABS[tab];
    if (name) path += `/${name}`;
    if (tab === 'prompts' && prompt) path += `/${encodeURIComponent(prompt)}`;
    else if (tab === 'competitors' && brandPage) path += `/${encodeURIComponent(brandSlug(brandPage))}`;
    else if (tab === 'responses' && run) path += `/${encodeURIComponent(run)}`;
    else if (tab === 'products' && productDetail) path += `/${productDetail.split('/').map(encodeURIComponent).join('/')}`;
    else if (tab === 'comparison' && comparisonView && (COMPARISON_PAGES.includes(comparisonView) || /^(products|attributes|personas)\/[^/]+$/.test(comparisonView))) path += `/${comparisonView.split('/').map(encodeURIComponent).join('/')}`;
    else if (tab === 'ai-bots' && aiBotsView) {
      const [page = '', ...filter] = aiBotsView.split('?');
      if (AI_BOTS_PAGES.includes(page)) {
        path += `/${page}`;
        for (const [name, value] of new URLSearchParams(filter.join('?'))) if (AI_BOTS_FILTERS.includes(name)) query.set(name, value);
      }
    }
    else if (tab === 'sources' && entity === 'domain' && key) path += `/${encodeURIComponent(key)}`;
    else if (tab === 'settings') path += `/${settings}`;
    if (tab === 'sources' && entity === 'url' && key) query.set('url', key);
  }
  const compact = new URLSearchParams();
  for (const [name, value] of query) {
    if (name === 'days') {
      if (value && value !== DEFAULT_DAYS) compact.set('period', `${value}d`);
    } else if (name === 'engine') compact.set('model', value.split(',').map((id) => MODEL_NAME[id] ?? id).join(','));
    else if (name === 'query') compact.set('q', value);
    else if (name === 'tags') compact.set('tag', value);
    else if (name === 'group' && value === 'domain') continue;
    else if ((name === 'listPage' && value === '1') || (name === 'listScroll' && value === '0')) continue;
    else compact.append(name, value);
  }
  const search = compact.toString();
  return search ? `${path}?${search}` : path;
}

/** A project's address (its Overview, or the screen `tab`): the builder for links made outside the app's own state. */
export const projectPath = (workspace: string | null, project: string, tab = 'overview') =>
  compactAppPath(new URLSearchParams({ tab }), project, workspace);
