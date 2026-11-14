// Deleting a project for good (the danger zone of the project settings, 10/11/2026). Two parts:
// - `deleteProject`, in the request: one D1 batch tombstones the project (archived, monitoring off, `deleted_at`), cancels
//   what was not sent to a provider yet and writes the audit line. From then on the project is gone from every screen,
//   list and scheduler step (they read `archived=0`), and it cannot be unarchived.
// - `eraseDeletedProjects`, a scheduler step (both editions): erases what it held, resumably and in bounded pages. It waits
//   while a paid task is still with a provider (its result would write the archive and the store again), then deletes the
//   original responses, backups and restore uploads in R2, wipes every project store generation and every agent
//   conversation object, deletes the project's rows in control D1, and stamps `erased_at`.
// Kept on purpose: the `projects` row as a tombstone (a plan's monthly project count must not reset by deleting), the
// spending rows (runs and jobs, with their cost and credits, the text they carried blanked) and the append-only
// `brand_decision_events` ledger (its triggers refuse deletes).
import { env } from 'cloudflare:workers';
import { db, now } from './env';
import { ApiError } from './http';
import { rawResponsesBucket } from './raw-responses';
import { projectStoreRpc } from './project-store-transport';
import { RECONCILE_WINDOW_MS, SETTLE_FAILED_SQL } from '@/lib/reservations';

/** Rows deleted (or blanked) per table and statement: a tick erases a page of each and the next one goes on. */
export const ERASE_PAGE = 500;
/** R2 pages (up to 1,000 keys each) and objects (stores, conversations) a tick handles. */
const R2_PAGES = 10;
const OBJECTS_PER_TICK = 25;
/** A job still `submitting` this recently may yet write its result; an older one has been given up by its worker. */
const IN_FLIGHT_MS = 60 * 60_000;

/** Tables whose rows of the project are its content, children first (an artifact's versions point at it). */
const CHILD_TABLES: [table: string, sql: string][] = [
  ['agent_artifact_versions', 'artifact_id IN (SELECT id FROM agent_artifacts WHERE project_id=?)'],
];
const CONTENT_TABLES = [
  'topics', 'agent_artifacts', 'agent_project_settings', 'agent_curation_settings', 'agent_skill_uses',
  'brand_mention_decisions', 'brand_mention_homonyms', 'brand_mention_readings', 'brand_mention_settings', 'brand_mention_status',
  'brand_mention_verdicts', 'brand_question_roles', 'brand_role_decisions', 'brand_research_configurations',
  'semantic_configurations', 'semantic_evaluations', 'semantic_panel_readings', 'semantic_panel_settings', 'sentiment_window_readings',
  'fanout_query_intents', 'fanout_intents', 'notification_preferences', 'notification_signals', 'notification_deliveries',
  'project_backups', 'project_restores', 'project_budgets', 'source_page_uses', 'ai_bot_connections', 'comparison_configurations',
];
/**
 * Spending rows kept for the plan's counts and the operator's costs, and the rows they point at (a run's prompt, a comparison
 * query's comparison and round): what they carried of the project is blanked. Prompts no run points at are deleted after.
 */
const SCRUBBED: [table: string, set: string, dirty: string][] = [
  ['prompts', "archived=1,active=0,text='',tag='',tags_json='[]',engines_override_json=NULL", "text<>''"],
  ['product_comparisons', "product='',rivals_json='[]',sector='',dimensions_json='[]'", "(product<>'' OR rivals_json<>'[]')"],
  ['comparison_rounds', "snapshot_json='{}'", "snapshot_json<>'{}'"],
  // Touching runs fires the publication triggers; the outbox rows they add are deleted with the registry at the end.
  ['runs', "prompt_text='',targets_json='[]',error=NULL,raw_response_key=NULL", "(prompt_text<>'' OR targets_json<>'[]' OR raw_response_key IS NOT NULL)"],
  ['brand_research_jobs', "input_json='{}',result_json=NULL,error=NULL", "(input_json<>'{}' OR result_json IS NOT NULL)"],
  ['semantic_jobs', "input_json='{}',error=NULL", "input_json<>'{}'"],
  ['semantic_panel_queries', "question='',input_json='{}',response=NULL,sources_json='[]',brand_order_json='[]',error=NULL", "(question<>'' OR response IS NOT NULL OR input_json<>'{}')"],
  ['semantic_panel_rounds', "roster_json='[]'", "roster_json<>'[]'"],
  ['comparison_queries', "question='',order_json='[]',input_json='{}',response=NULL,sources_json='[]',reading_json=NULL,raw_response_key=NULL,error=NULL", "(question<>'' OR response IS NOT NULL OR input_json<>'{}')"],
  ['comparison_runs', "question='',roster_json='{}',input_json='{}',response=NULL,sources_json='[]',reading_json=NULL,error=NULL", "(question<>'' OR roster_json<>'{}' OR response IS NOT NULL)"],
];

/** The project's tombstone, cancellations and audit line, in one batch. Owner only (the route checks the role). */
export async function deleteProject(projectId: string, workspaceId: string, actor: string, typedName: unknown) {
  const project = await db()
    .prepare('SELECT name FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL')
    .bind(projectId, workspaceId)
    .first<{ name: string }>();
  if (!project) throw new ApiError(404, 'Project not found.');
  if (typeof typedName !== 'string' || typedName.trim() !== project.name)
    throw new ApiError(400, 'Type the project name exactly as shown to delete it.');
  const stamp = now();
  const database = db();
  const [deleted] = await database.batch([
    database
      .prepare('UPDATE projects SET archived=1,daily_enabled=0,deleted_at=? WHERE id=? AND workspace_id=? AND deleted_at IS NULL')
      .bind(stamp, projectId, workspaceId),
    // Not sent yet: nothing more is spent. What a provider already has finishes and is settled at its cost.
    database
      .prepare(`UPDATE runs SET status='failed',error='Project deleted before submission.',completed_at=?,${SETTLE_FAILED_SQL} WHERE project_id=? AND status='queued'`)
      .bind(stamp, projectId),
    database
      .prepare("UPDATE brand_research_jobs SET status='cancelled',reserved_usd=0,completed_at=?,error='Project deleted.' WHERE project_id=? AND status='pending'")
      .bind(stamp, projectId),
    database
      .prepare("UPDATE semantic_panel_queries SET status='cancelled',reserved_usd=0,completed_at=?,error='Project deleted.' WHERE project_id=? AND status='pending'")
      .bind(stamp, projectId),
    database
      .prepare("UPDATE comparison_runs SET status='cancelled',reserved_usd=0,completed_at=?,error='Project deleted.' WHERE project_id=? AND status='pending'")
      .bind(stamp, projectId),
    database.prepare('INSERT INTO admin_audit_log(at,actor,action,key) VALUES(?,?,?,?)').bind(stamp, actor, 'delete', `project:${projectId}`),
  ]);
  if (!deleted?.meta.changes) throw new ApiError(404, 'Project not found.');
}

/** A paid task of the project that may still write its result (an answer, a reading). */
const IN_FLIGHT_SQL = `EXISTS(SELECT 1 FROM runs WHERE project_id=?1 AND (status IN ('queued','submitting','pending') OR (status='unknown' AND COALESCE(claimed_at,created_at)>=?2)))
  OR EXISTS(SELECT 1 FROM brand_research_jobs WHERE project_id=?1 AND status IN ('pending','submitting') AND COALESCE(started_at,requested_at)>=?3)
  OR EXISTS(SELECT 1 FROM semantic_panel_queries WHERE project_id=?1 AND status IN ('pending','submitting') AND COALESCE(started_at,requested_at)>=?3)`;

type Deleted = { id: string; workspace_id: string };

/** Scheduler step: erases what deleted projects held, a bounded page per tick. Returns how many projects it finished. */
export async function eraseDeletedProjects(limit = 3) {
  const { results } = await db()
    .prepare('SELECT id,workspace_id FROM projects WHERE deleted_at IS NOT NULL AND erased_at IS NULL ORDER BY deleted_at LIMIT ?')
    .bind(limit)
    .all<Deleted>();
  if (!results.length) return 0;
  const tables = new Set(
    (await db().prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>()).results.map((row) => row.name),
  );
  let finished = 0;
  for (const project of results) if (await eraseProject(project, tables)) finished++;
  return finished;
}

async function eraseProject(project: Deleted, tables: Set<string>) {
  const stamp = Date.now();
  const busy = await db()
    .prepare(`SELECT (${IN_FLIGHT_SQL}) busy`)
    .bind(project.id, new Date(stamp - RECONCILE_WINDOW_MS).toISOString(), new Date(stamp - IN_FLIGHT_MS).toISOString())
    .first<{ busy: number }>();
  if (busy?.busy) return false;
  if (!(await eraseObjects(project))) return false;
  if (!(await eraseStores(project, tables))) return false;
  if (!(await eraseConversations(project))) return false;
  return eraseRows(project, tables);
}

/** R2: the original responses, the backups and the restore uploads of the project (its exact ownership prefixes). */
async function eraseObjects(project: Deleted) {
  const bucket = rawResponsesBucket();
  if (!bucket) return true;
  const scope = `${encodeURIComponent(project.workspace_id)}/${encodeURIComponent(project.id)}/`;
  let pages = 0;
  for (const prefix of [`raw/v1/${scope}`, `backups/v1/${scope}`, `restores/v1/${scope}`]) {
    for (;;) {
      // Always the first page: what was listed is deleted, so the next list starts where this one left.
      const page = await bucket.list({ prefix, limit: 1000 });
      if (!page.objects.length) break;
      await bucket.delete(page.objects.map((object) => object.key));
      if (++pages >= R2_PAGES) return false;
      if (!page.truncated) break;
    }
  }
  return true;
}

/** Every store generation the project had (current, candidate, restored into, backed up): each object's storage is wiped. */
async function eraseStores(project: Deleted, tables: Set<string>) {
  if (!env.PROJECT_STORES) return true;
  const sources = [
    'SELECT generation FROM project_stores WHERE project_id=?1',
    'SELECT candidate_generation FROM project_stores WHERE project_id=?1 AND candidate_generation IS NOT NULL',
    ...(tables.has('project_restores') ? ['SELECT generation FROM project_restores WHERE project_id=?1 AND generation IS NOT NULL'] : []),
    ...(tables.has('project_backups') ? ['SELECT generation FROM project_backups WHERE project_id=?1'] : []),
  ];
  const generations = (await db().prepare(sources.join(' UNION ')).bind(project.id).all<{ generation: string }>()).results.map((row) => row.generation);
  const done = `erase:${project.id}`;
  const wiped = new Set<string>(
    JSON.parse((await db().prepare('SELECT value FROM system_state WHERE key=?').bind(done).first<{ value: string }>())?.value ?? '[]'),
  );
  const left = generations.filter((generation) => !wiped.has(generation));
  for (const generation of left.slice(0, OBJECTS_PER_TICK)) {
    await projectStoreRpc({ scope: { ownerId: project.workspace_id, projectId: project.id, generation }, action: 'erase' });
    wiped.add(generation);
    await db()
      .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(done, JSON.stringify([...wiped]))
      .run();
  }
  return left.length <= OBJECTS_PER_TICK;
}

/** Destroys a conversation's agent object; set by the Worker (worker/index.ts), so this module never imports the agent SDK. */
let destroyConversation: ((id: string) => Promise<void>) | undefined;
export const setConversationEraser = (destroy: (id: string) => Promise<void>) => {
  destroyConversation = destroy;
};

/** Each agent conversation of the project is an object of its own (its messages): destroyed, then its row deleted. */
async function eraseConversations(project: Deleted) {
  if (!destroyConversation) return false;
  const { results } = await db()
    .prepare(`SELECT id FROM agent_conversations WHERE project_id=? LIMIT ${OBJECTS_PER_TICK + 1}`)
    .bind(project.id)
    .all<{ id: string }>();
  for (const { id } of results.slice(0, OBJECTS_PER_TICK)) {
    // ponytail: destroy() may end the agent's isolate before it answers, so its error is not a failure; an object left half
    // wiped by an outage is not retried once its row is gone. Track destroyed ids if that ever shows up.
    await destroyConversation(id).catch(() => undefined);
    await db().batch([
      db().prepare('DELETE FROM agent_feedback WHERE conversation_id=?').bind(id),
      db().prepare('DELETE FROM agent_conversations WHERE id=?').bind(id),
    ]);
  }
  return results.length <= OBJECTS_PER_TICK;
}

/** Control D1: the content rows deleted, the spending rows blanked, a page per table; then the registry and `erased_at`. */
async function eraseRows(project: Deleted, tables: Set<string>) {
  const database = db();
  const page = (table: string, where: string) =>
    database.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ${ERASE_PAGE})`).bind(project.id);
  const statements = [
    ...CHILD_TABLES.filter(([table]) => tables.has(table)).map(([table, where]) => page(table, where)),
    ...CONTENT_TABLES.filter((table) => tables.has(table)).map((table) => page(table, 'project_id=?')),
    ...SCRUBBED.filter(([table]) => tables.has(table)).map(([table, set, dirty]) =>
      database.prepare(`UPDATE ${table} SET ${set} WHERE rowid IN (SELECT rowid FROM ${table} WHERE project_id=? AND ${dirty} LIMIT ${ERASE_PAGE})`).bind(project.id),
    ),
    page('prompts', 'project_id=? AND NOT EXISTS(SELECT 1 FROM runs WHERE runs.prompt_id=prompts.id)'),
  ];
  const results = await database.batch(statements);
  if (results.some((result) => (result.meta?.changes ?? 0) >= ERASE_PAGE)) return false;
  // Last, in one batch: what the triggers wrote while rows went (outbox, a registry row put back), the step's own mark, the
  // project's settings, and the stamp.
  const stamp = now();
  const [, , , , erased] = await database.batch([
    database.prepare('DELETE FROM project_store_outbox WHERE project_id=?').bind(project.id),
    database.prepare('DELETE FROM project_store_dead_letters WHERE project_id=?').bind(project.id),
    database.prepare('DELETE FROM project_stores WHERE project_id=?').bind(project.id),
    database.prepare('DELETE FROM system_state WHERE key=?').bind(`erase:${project.id}`),
    database
      .prepare(`UPDATE projects SET erased_at=?,competitors_json='[]',aliases_json='[]',additional_domains_json='[]',category='',audience='',offers_json='[]',topic_weights_json=NULL
        WHERE id=? AND erased_at IS NULL`)
      .bind(stamp, project.id),
  ]);
  return !!erased?.meta.changes;
}
