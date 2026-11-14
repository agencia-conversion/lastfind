import { waitUntil } from 'cloudflare:workers';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { workspaceLinkTarget } from '@/lib/workspace-link';
import { LiveAnalyticsApp, type AdminPage } from '@/components/analytics/live-app';
import { initialWorkspacePath } from '@/components/analytics/routes';
import { expandAppPath } from '@/components/analytics/app-routes';
import { currentUser, requireActor, resolveActor, type Actor, type User } from '@/lib/server/auth';
import { workspaceInPath, workspaceIdBySlug, workspaceSlug } from '@edition/server/workspace-slugs';
import { workspaceFor } from '@/lib/server/workspace-read';
import { firstScreenReads } from '@/components/analytics/screen-reads';
import { GET as reportsRead } from '@/app/api/reports/route';
import { GET as researchRead } from '@/app/api/projects/[id]/brand-research/route';
import { GET as brandsRead } from '@/app/api/projects/[id]/brands/route';
import type { ReactNode } from 'react';

/** The Admin pages for this signed-in account, or none (decided on the server; the edition owns the rule). */
type AdminPanel = (user: User) => AdminPage[] | null;

export type AnalyticsSearchParams = Record<
  string,
  string | string[] | undefined
>;

export const analyticsMetadata = {
  title: 'Lastfind',
  robots: { index: false, follow: false },
};

/**
 * The app's first workspace read, started on the server with the page: the browser receives it with the page instead of
 * asking for it after its code loads. Same answer as `GET /api/workspace` for that address. Once it names the project, the
 * screen's first reports start too (`reads`, see screen-reads.ts): the same routes, read here with the page's request.
 */
function firstWorkspace(search: string, screen = true, actor: Promise<Actor> = requireActor()) {
  const read = initialWorkspacePath(search);
  const project = new URLSearchParams(search).get('project');
  const data = actor.then((acting) => workspaceFor(acting, project));
  const reads = data.then((workspace) =>
    screen && workspace.selectedProjectId
      ? firstScreenReads(initialTab(search), workspace.selectedProjectId, new URLSearchParams(search)).map((read) => {
          return { path: read, data: serverRead(read) };
        })
      : [],
  );
  reads.catch(() => {});
  return { path: read, data, reads };
}

/** The screen an address opens (its long form, app-routes.ts), as the app reads it (live-app.tsx). */
function initialTab(search: string) {
  return new URLSearchParams(search).get('tab') ?? 'overview';
}

/**
 * How long the page waits for a first read: a slower one (computed after new data) is left to the browser's own request,
 * which joins it (it goes on after the page, shareFlight). The document stays open while it waits and the app's code runs only
 * once the document has arrived, so every millisecond here delays the whole screen: with 2 s, the screens with first reads
 * started their own requests 1.5 to 3.5 s after the screens without (Cloudflare Browser Run). A kept copy answers well
 * inside this; a computation does not, and is better started by the browser at once.
 */
const FIRST_READ_MS = 800;
/**
 * A first read larger than this is not sent with the page: the document carries it as escaped text in the page's own stream,
 * parsed before the app runs (a big project's sentiment report alone made the Overview document 800 KB, 300 KB of it this
 * report). The browser asks for it instead, compressed, and the server answers it from what this read just kept.
 */
const FIRST_READ_MAX_CHARS = 100_000;
/**
 * A first read through its own route, as the browser would ask it (same session, same answer). Null when it failed or is
 * late: the browser then asks for it itself (analytics-cache.ts). A late read still finishes after the page (waitUntil): the
 * browser's request joins it or finds its result kept, instead of computing it again.
 */
async function serverRead(path: string): Promise<unknown> {
  const url = new URL(path, 'https://first-read.invalid');
  const project = /^\/api\/projects\/([^/]+)\/(brand-research|brands)$/.exec(url.pathname);
  const read = (async () => {
    const params = project && { params: Promise.resolve({ id: decodeURIComponent(project[1]) }) };
    const response = !params
      ? await reportsRead(new Request(url))
      : project![2] === 'brands'
        ? await brandsRead(new Request(url), params)
        : await researchRead(new Request(url), params);
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > FIRST_READ_MAX_CHARS ? null : (JSON.parse(text) as unknown);
  })().catch(() => null);
  waitUntil(read);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), FIRST_READ_MS);
  });
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The sidebar as the person left it (the cookies ui/sidebar.tsx writes): collapsed or not, and a width dragged on its edge. */
async function sidebarPreference() {
  const jar = await cookies();
  const width = Number(jar.get('sidebar_width')?.value);
  return { open: jar.get('sidebar_state')?.value !== 'false', width: Number.isFinite(width) && width > 0 ? width : undefined };
}

/** A path segment as written, or '' when it is not valid percent-encoding (the address then names no workspace). */
function safeDecode(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

function searchEntries(query: AnalyticsSearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) params.append(key, item);
    }
  }
  return params;
}

/**
 * `/app`: Cloud opens the workspace this browser has open (`/app/<workspace>`, its query kept: a billing return, a sign-up);
 * the independent edition, whose addresses name no workspace, opens the app here.
 */
export async function AppRootPage({
  searchParams,
  welcome,
  billingPanel,
  adminPanel,
  notificationsPanel,
  profilePanel,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
  welcome: ReactNode;
  billingPanel?: ReactNode;
  adminPanel?: AdminPanel;
  notificationsPanel?: ReactNode;
  profilePanel?: ReactNode;
}) {
  const user = await currentUser();
  if (!user) return welcome;
  const query = await searchParams;
  const link = workspaceLinkTarget('/app', query);
  if (link) redirect(link);
  const params = searchEntries(query);
  if (workspaceInPath) {
    const slug = await workspaceSlug((await requireActor()).workspaceId);
    redirect(`/app/${encodeURIComponent(slug!)}${params.size ? `?${params}` : ''}`);
  }
  const search = (expandAppPath([], params) ?? new URLSearchParams()).toString();
  return (
    <LiveAnalyticsApp
      initialSearch={search}
      sessionScope={user.id}
      initialWorkspace={firstWorkspace(search)}
      sidebar={await sidebarPreference()}
      billingPanel={billingPanel}
      admin={adminPanel?.(user) ?? undefined}
      notificationsPanel={notificationsPanel}
      profilePanel={profilePanel}
    />
  );
}

/**
 * `/app/...`: in Cloud the first segment is the workspace's slug (Admin, the platform's, has none). It opens for a member of
 * that workspace only (anyone else: not found, nothing told); when the browser has another workspace open, it opens this one
 * first (`/api/workspace/select`) and comes back, so the app's own reads ask the same workspace the address names.
 */
export async function AnalyticsRoutePage({
  params,
  searchParams,
  welcome,
  gate,
  billingPanel,
  adminPanel,
  notificationsPanel,
  profilePanel,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<AnalyticsSearchParams>;
  welcome: ReactNode;
  /** The edition's own check before any screen (Cloud: the profile step; it may redirect), read alongside the session. */
  gate?: Promise<unknown>;
  billingPanel?: ReactNode;
  adminPanel?: AdminPanel;
  notificationsPanel?: ReactNode;
  profilePanel?: ReactNode;
}) {
  const segments = (await params).path;
  // The workspace the address names is looked up with the session, not after it: each D1 round trip before the page's first
  // byte delays the whole screen (13/11/2026: the slug's lookup after the session added one to every screen's first byte).
  const named = workspaceInPath && segments[0] !== 'admin' && segments[0] !== 'settings' ? safeDecode(segments[0] ?? '') : undefined;
  const workspaceRead = named ? workspaceIdBySlug(named) : Promise.resolve(null);
  workspaceRead.catch(() => {});
  // This edition guard applies to every owner route, including direct links.
  const [user] = await Promise.all([currentUser(), gate]);
  if (!user) return welcome;
  const query = await searchParams;
  const here = `/app/${segments.map(encodeURIComponent).join('/')}`;
  const link = workspaceLinkTarget(here, query);
  if (link) redirect(link);
  let rest = segments;
  let slug: string | undefined;
  let acting: Promise<Actor> | undefined;
  if (workspaceInPath && segments[0] === 'admin') slug = (await workspaceSlug((await requireActor()).workspaceId)) ?? undefined;
  else if (workspaceInPath && segments[0] === 'settings') {
    // `/app/settings/<section>` (My profile from the site's header and the emails, which know no workspace): the Settings of
    // the workspace this browser has open. `settings` is never a workspace's slug (RESERVED_SLUGS).
    const search = searchEntries(query).toString();
    redirect(`/app/${encodeURIComponent((await workspaceSlug((await requireActor()).workspaceId))!)}${here.slice(4)}${search ? `?${search}` : ''}`);
  } else if (workspaceInPath) {
    slug = named;
    // The workspace this browser has open (requireActor) is the one the address names on almost every visit: then it is the
    // actor, and the page's first reads use it instead of resolving it again.
    const [workspaceId, current] = await Promise.all([workspaceRead, requireActor()]);
    if (!workspaceId) notFound();
    if (current.workspaceId !== workspaceId) {
      if ((await resolveActor(user, workspaceId)).workspaceId !== workspaceId) notFound();
      const search = searchEntries(query).toString();
      redirect(`/api/workspace/select?${new URLSearchParams({ slug: slug!, next: search ? `${here}?${search}` : here })}`);
    }
    acting = Promise.resolve(current);
    rest = segments.slice(1);
  }
  // The wizards: New project (`/app/<workspace>/onboarding`) and the workspace's (`/app/<workspace>/setup`, Cloud; the
  // independent edition's `/app/setup` is its own setup).
  const wizard = rest.length === 1 ? ({ onboarding: 'project', setup: 'workspace' } as const)[rest[0] as 'onboarding' | 'setup'] : undefined;
  const long = wizard ? new URLSearchParams() : expandAppPath(rest, searchEntries(query));
  if (!long) notFound();
  const search = long.toString();
  // A wizard shows no project screen: none of its reports is read with the page.
  const first = firstWorkspace(search, !wizard, acting);
  return (
    <LiveAnalyticsApp
      wizard={wizard}
      workspaceSlug={slug}
      initialSearch={search}
      sessionScope={user.id}
      initialWorkspace={first}
      sidebar={await sidebarPreference()}
      billingPanel={billingPanel}
      admin={adminPanel?.(user) ?? undefined}
      notificationsPanel={notificationsPanel}
      profilePanel={profilePanel}
    />
  );
}
