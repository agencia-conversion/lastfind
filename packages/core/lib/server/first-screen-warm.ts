import { db } from './env';
import { projectStoreRpc } from './project-store-transport';
import { copyVersion, digest, keptAll } from './project-store-read';
import { parseReportFilter } from './report-filter';
import { reportResponse } from './report-response';
import { brandsOverview } from './brand-decisions';
import { decisionEventsStatement } from './brand-decision-events';
import { brandResearchReport, keptResearchReport, researchCopyReads, settledReadingStatement } from './brand-research';
import { publicResearchReport } from './internal-models';
import { pendingBatchesStatement, sourceTypeRevisionStatement } from './source-types';
import { semanticSourceVersionStatement } from './semantic-source-rows';
import { firstScreenReads } from '@/components/analytics/screen-reads';
import { inPool, OUTBOUND_CONNECTIONS } from '@/lib/pool';
import { brandFavicon, faviconHost } from './favicon';
import { rawResponsesBucket } from './raw-responses';

// The first screens of every monitored project are computed before anyone opens them: each scheduler tick checks a few projects
// for a change of anything their kept copies depend on (the store's data and analysis, the period as the store moves it, the
// project, its sentiment settings and brand decisions, readings that settled, the source catalog, Semantic Branding) and, for
// the ones that changed, reads the default screens (the last 28 days, every model and topic) the way the screens do, which keeps
// their copies (report-response.ts, brand-research.ts, brand-decisions.ts). A screen opened afterwards finds its copy.

const SCREENS = ['overview', 'prompts', 'sources', 'models', 'competitors'];
const CURSOR_KEY = 'first-screen-warm-cursor';
const checkKey = (projectId: string) => `first-screen-warm:${projectId}`;

/** The reads the first screens make with no filter but the default period, once each. */
const defaultReads = (projectId: string) => [
  ...new Set(SCREENS.flatMap((tab) => firstScreenReads(tab, projectId, new URLSearchParams()))),
];

/**
 * What the default screens' copies depend on, as one digest; null when the store cannot keep copies yet (publication behind,
 * mention ranks pending) or its data changed in the last minutes (`settling`): the project is looked at again on the next tick.
 */
export async function firstScreenInputs(project: { id: string; workspace_id: string; generation: string }) {
  const q = new URLSearchParams({ project: project.id, days: '28' });
  const filter = parseReportFilter(q);
  const semantic = semanticSourceVersionStatement(project.id, project.workspace_id, filter, q);
  const database = db();
  const [reads, status] = await Promise.all([
    database.batch([
      database.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(project.id, project.workspace_id),
      database.prepare('SELECT * FROM project_stores WHERE project_id=? AND workspace_id=?').bind(project.id, project.workspace_id),
      database.prepare('SELECT * FROM brand_research_configurations WHERE project_id=? AND workspace_id=?').bind(project.id, project.workspace_id),
      decisionEventsStatement(project.id),
      // The last reading that settled (sentiment, brand roles, source types).
      settledReadingStatement(project.id),
      sourceTypeRevisionStatement(),
      pendingBatchesStatement(project.id, project.workspace_id),
      ...(semantic ? [semantic] : []),
    ]),
    projectStoreRpc<{ epoch?: number; positionsPending: boolean; sourcesCanonical?: boolean; settling?: boolean }>({
      scope: { ownerId: project.workspace_id, projectId: project.id, generation: project.generation },
      action: 'status',
      fill: true,
      bounds: [filter.previousCutoff, filter.cutoff, filter.end],
      job: true,
    }),
  ]);
  const registry = reads[1].results[0] as { source_revision?: number; applied_revision?: number } | undefined;
  if (!reads[0].results.length || !registry || registry.source_revision !== registry.applied_revision) return null;
  // Data still arriving (a collection publishes on every tick): warmed once it settles, not after every batch.
  const { settling, ...state } = status;
  if (settling || state.positionsPending || state.sourcesCanonical === false) return null;
  return digest([copyVersion(), reads.map((read, index) => (index === 1 ? null : read.results)), state]);
}

/**
 * The icons of the sites the first screens show (the Overview ranking, cited domains and pages, the Brands and Sources lists),
 * in screen order, kept in the bucket before anyone opens them, so `SiteFavicon` paints them at once: at most FAVICON_WARM_HOSTS
 * sites, FAVICON_WARM_CONCURRENCY at a time (the invocation's six outbound connections), for at most FAVICON_WARM_MS. A site
 * already kept costs one bucket read; one with no icon is remembered as such (favicon.ts). Both editions.
 */
export const FAVICON_WARM_HOSTS = 120;
export const FAVICON_WARM_CONCURRENCY = OUTBOUND_CONNECTIONS;
export const FAVICON_WARM_MS = 10_000;
/** Every `domain` a screen read returned, in order. */
function domainsOf(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) for (const item of value) domainsOf(item, into);
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      const host = key === 'domain' && typeof item === 'string' ? faviconHost(item) : null;
      if (host) into.add(host);
      else domainsOf(item, into);
    }
}
export async function warmFavicons(hosts: Iterable<string>, deadline = Date.now() + FAVICON_WARM_MS) {
  const store = rawResponsesBucket();
  if (!store) return 0;
  let kept = 0;
  await inPool([...hosts].slice(0, FAVICON_WARM_HOSTS), FAVICON_WARM_CONCURRENCY, async (host) => {
    if (Date.now() > deadline) return false;
    if (await brandFavicon(host, fetch, Date.now(), { store }).catch(() => null)) kept++;
  });
  return kept;
}

/** Reads the default first screens of a project the way the screens do: each read keeps its copy for the current data. */
export async function warmProject(projectId: string, workspaceId: string) {
  let computed = 0,
    failed = 0;
  const hosts = new Set<string>();
  const read = async (work: () => Promise<{ computed: boolean; value: unknown }>) => {
    try {
      const result = await work();
      if (result.computed) computed++;
      domainsOf(result.value, hosts);
    } catch (error) {
      failed++;
      console.error('First screen warm-up read failed.', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    }
    // The copy reaches the store before the next read leaves: the store never holds more than one in flight from here.
    await keptAll();
  };
  // One after the other: the project store answers one read at a time, and this never competes with a visitor for long.
  for (const path of defaultReads(projectId)) {
    const url = new URL(path, 'https://first-screen.invalid');
    const q = url.searchParams;
    // The discoveries (`/brands?top=`) are a digest of the Brands list, kept once below.
    if (url.pathname.endsWith('/brands')) continue;
    if (url.pathname.endsWith('/brand-research'))
      // Computed now (`fresh`): readings that settled since the last copy are in it.
      await read(async () => ({
        computed: true,
        value: await keptResearchReport(projectId, workspaceId, q, { fresh: true, early: researchCopyReads(projectId) }, async () =>
          publicResearchReport(await brandResearchReport(projectId, workspaceId, q)),
        ),
      }));
    else
      await read(async () => {
        const response = await reportResponse(workspaceId, q);
        return { computed: !response.kept, value: typeof response.body === 'string' ? JSON.parse(response.body) : response.body };
      });
  }
  await read(async () => ({ computed: true, value: await brandsOverview(projectId, workspaceId, { fresh: true }) }));
  const favicons = await warmFavicons(hosts);
  return { computed, failed, favicons };
}

/**
 * One scheduler tick's warm-up: the monitored projects with a caught-up store are looked at in id order from where the last
 * tick stopped, five at a time, and each whose inputs changed is warmed, up to `warm` of them and within `budgetMs`. The first
 * changed project left over stops the tick there, so the next one starts with it.
 */
export async function warmFirstScreens({ projects = 40, warm = 3, budgetMs = 45_000, clock = Date.now } = {}) {
  const deadline = clock() + budgetMs;
  const database = db();
  const cursor = (await database.prepare('SELECT value FROM system_state WHERE key=?').bind(CURSOR_KEY).first<{ value: string }>())?.value ?? '';
  const candidates = (after: string, limit: number) =>
    database
      .prepare(
        `SELECT p.id,p.workspace_id,s.generation FROM projects p JOIN project_stores s ON s.project_id=p.id AND s.workspace_id=p.workspace_id
         WHERE p.archived=0 AND p.daily_enabled=1 AND s.initialized=1 AND s.source_revision=s.applied_revision AND p.id>?
         ORDER BY p.id LIMIT ?`,
      )
      .bind(after, limit)
      .all<{ id: string; workspace_id: string; generation: string }>()
      .then((read) => read.results);
  let list = await candidates(cursor, projects);
  // Past the last project: on from the first one.
  if (list.length < projects && cursor) list = [...list, ...(await candidates('', projects - list.length)).filter((item) => item.id <= cursor)];
  const stored = new Map(
    list.length
      ? (
          await database
            .prepare('SELECT key,value FROM system_state WHERE key IN (SELECT value FROM json_each(?))')
            .bind(JSON.stringify(list.map((item) => checkKey(item.id))))
            .all<{ key: string; value: string }>()
        ).results.map((row) => [row.key, row.value])
      : [],
  );
  const save = (key: string, value: string) =>
    database.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value).run();
  let checked = 0,
    warmed = 0,
    failed = 0,
    reached = cursor;
  window: for (let index = 0; index < list.length && clock() < deadline; index += 5) {
    const batch = list.slice(index, index + 5);
    const inputs = await Promise.all(batch.map((project) => firstScreenInputs(project).catch(() => null)));
    for (const [position, project] of batch.entries()) {
      const current = inputs[position];
      if (current && stored.get(checkKey(project.id)) !== current) {
        if (warmed >= warm || clock() >= deadline) break window;
        // Past this project before warming it: if the tick dies in it (out of time or CPU), the next tick goes on with the
        // next one, and this one is looked at again on the next round.
        await save(CURSOR_KEY, project.id);
        reached = project.id;
        const result = await warmProject(project.id, project.workspace_id);
        warmed++;
        failed += result.failed;
        // A read that failed is tried again on the next look (the project still looks changed).
        if (!result.failed) await save(checkKey(project.id), current);
      }
      checked++;
      reached = project.id;
    }
  }
  await save(CURSOR_KEY, reached);
  return { checked, warmed, failed };
}
