// Data retention (lib/retention.ts): past a project's retention, the raw form of its answers goes, a bounded batch at a time,
// one project at a time and only that project's rows:
// - the provider's original response in the raw archive (runs.raw_purged_at marks it; the run's other columns stay);
// - the answer text in the project store (purgeAnswerText; its brands, positions, citations and searches stay);
// - the answer excerpts a sentiment, roles or mention job read (brand_research_jobs.input_json; the result and the cost stay);
// - a Semantic Branding question's raw answer (semantic_panel_queries.response; its scores, in readings, stay);
// - a Comparison question's answer (comparison_runs.response; its reading, the orders, stays).
// Nothing runs for a project whose retention is NULL (keep everything): every project that existed before 11/11/2026 until its
// owner or the operator chooses. `retentionStep` runs from the scheduler at most hourly; `applyRetention` is also the operator's
// `retention-apply` action, a dry run by default that lists what would go.
import { db, now } from './env';
import { getProjectStore } from './project-store';
import { projectStoreRpc } from './project-store-transport';
import { rawResponsesBucket } from './raw-responses';
import { retentionCutoff } from '@/lib/retention';

/** Rows (and raw objects) each part removes per batch: a few hundred, so a batch stays well inside one invocation. */
export const RETENTION_BATCH = 200;
const STEP_KEY = 'raw_retention_at';
const STEP_EVERY_MS = 3_600_000;
const STEP_BUDGET_MS = 20_000;
// Settled rows only: an open job or run still holds a reserve and may be read again.
const SETTLED_JOBS = "status IN ('completed','failed','cancelled','unsettled')";
const SETTLED_PANEL = "status IN ('completed','absent','failed','cancelled')";
const SETTLED_RUNS = "status IN ('complete','failed','cancelled')";

export type RetentionCounts = { projectId: string; days: number; before: string; rawResponses: number; answers: number; jobInputs: number; panelAnswers: number; comparisonAnswers: number; more: boolean };

type Project = { id: string; workspace_id: string; raw_retention_days: number };

/** One batch of one project (or, with `dryRun`, how much is left to remove). Only rows of `project` are read or written. */
export async function retainProject(project: Project, { dryRun, limit = RETENTION_BATCH, at = Date.parse(now()) }: { dryRun: boolean; limit?: number; at?: number }): Promise<RetentionCounts> {
  const database = db();
  const before = retentionCutoff(Number(project.raw_retention_days), at);
  const counts: RetentionCounts = { projectId: project.id, days: Number(project.raw_retention_days), before, rawResponses: 0, answers: 0, jobInputs: 0, panelAnswers: 0, comparisonAnswers: 0, more: false };
  const runs = `FROM runs WHERE project_id=? AND raw_purged_at IS NULL AND created_at<? AND ${SETTLED_RUNS}`;
  const jobs = `FROM brand_research_jobs WHERE project_id=? AND requested_at<? AND input_json<>'{}' AND ${SETTLED_JOBS}`;
  const panel = `FROM semantic_panel_queries WHERE project_id=? AND requested_at<? AND (response IS NOT NULL OR input_json<>'{}') AND ${SETTLED_PANEL}`;
  // A Comparison answer once read (or settled without one): its text goes, the reading stays.
  const comparison = `FROM comparison_runs WHERE project_id=? AND requested_at<? AND response IS NOT NULL AND ${SETTLED_PANEL} AND (reading_json IS NOT NULL OR status<>'completed' OR COALESCE(json_extract(input_json,'$.readAttempts'),0)>=3)`;
  const registry = await getProjectStore(project.id, project.workspace_id);
  const scope = registry?.initialized ? { ownerId: project.workspace_id, projectId: project.id, generation: registry.generation } : null;
  if (dryRun) {
    const [rawRows, jobRows, panelRows, comparisonRows] = await database.batch<{ n: number }>([
      database.prepare(`SELECT COUNT(*) n ${runs} AND raw_response_key IS NOT NULL`).bind(project.id, before),
      database.prepare(`SELECT COUNT(*) n ${jobs}`).bind(project.id, before),
      database.prepare(`SELECT COUNT(*) n ${panel}`).bind(project.id, before),
      database.prepare(`SELECT COUNT(*) n ${comparison}`).bind(project.id, before),
    ]);
    counts.comparisonAnswers = Number(comparisonRows?.results[0]?.n ?? 0);
    counts.rawResponses = Number(rawRows.results[0]?.n ?? 0);
    counts.jobInputs = Number(jobRows.results[0]?.n ?? 0);
    counts.panelAnswers = Number(panelRows.results[0]?.n ?? 0);
    if (scope) counts.answers = (await projectStoreRpc<{ answers: number }>({ scope, action: 'retention-purge', before, dryRun: true })).answers;
    return counts;
  }
  // The raw archive first: an object is removed before its run says so, so a run never claims an archive it no longer has.
  const archived = (
    await database.prepare(`SELECT id,raw_response_key key ${runs} ORDER BY created_at LIMIT ?`).bind(project.id, before, limit).all<{ id: string; key: string | null }>()
  ).results;
  if (archived.length) {
    const keys = archived.map((row) => row.key).filter((key): key is string => !!key && key.includes(`/${encodeURIComponent(project.id)}/`));
    const bucket = rawResponsesBucket();
    if (keys.length && !bucket) throw new Error('The raw archive is unavailable');
    if (keys.length) await bucket!.delete(keys);
    await database
      .prepare(`UPDATE runs SET raw_purged_at=? WHERE project_id=? AND id IN (SELECT value FROM json_each(?))`)
      .bind(new Date(at).toISOString(), project.id, JSON.stringify(archived.map((row) => row.id)))
      .run();
    counts.rawResponses = keys.length;
  }
  const [jobResult, panelResult, comparisonResult] = await database.batch([
    database.prepare(`UPDATE brand_research_jobs SET input_json='{}' WHERE project_id=? AND id IN (SELECT id ${jobs} LIMIT ?)`).bind(project.id, project.id, before, limit),
    database.prepare(`UPDATE semantic_panel_queries SET response=NULL,input_json='{}' WHERE project_id=? AND id IN (SELECT id ${panel} LIMIT ?)`).bind(project.id, project.id, before, limit),
    database.prepare(`UPDATE comparison_runs SET response=NULL WHERE project_id=? AND id IN (SELECT id ${comparison} LIMIT ?)`).bind(project.id, project.id, before, limit),
  ]);
  counts.jobInputs = Number(jobResult.meta?.changes ?? 0);
  counts.panelAnswers = Number(panelResult.meta?.changes ?? 0);
  counts.comparisonAnswers = Number(comparisonResult?.meta?.changes ?? 0);
  let storeMore = false;
  if (scope) {
    const store = await projectStoreRpc<{ answers: number; more: boolean }>({ scope, action: 'retention-purge', before, limit });
    counts.answers = store.answers;
    storeMore = store.more;
  }
  counts.more = archived.length === limit || counts.jobInputs === limit || counts.panelAnswers === limit || counts.comparisonAnswers === limit || storeMore;
  return counts;
}

/** The projects with a retention (NULL keeps everything), or the one asked for. */
async function retainedProjects(projectId: string | null) {
  const database = db();
  return (
    await (projectId
      ? database.prepare('SELECT id,workspace_id,raw_retention_days FROM projects WHERE id=? AND raw_retention_days IS NOT NULL').bind(projectId)
      : database.prepare('SELECT id,workspace_id,raw_retention_days FROM projects WHERE raw_retention_days IS NOT NULL ORDER BY id')
    ).all<Project>()
  ).results;
}

/** The operator's `retention-apply`: counts per project (dry run, the default), or one batch of each project now. */
export async function applyRetention({ projectId, dryRun, limit }: { projectId: string | null; dryRun: boolean; limit?: number }) {
  const projects = [];
  for (const project of await retainedProjects(projectId)) projects.push(await retainProject(project, { dryRun, limit }));
  return { dryRun, projects };
}

/**
 * The scheduler's retention step (both editions): at most once an hour, one batch of each project with a retention, within a
 * time budget. A project that fails is logged and the others go on; each batch that removed something leaves one log line.
 */
export async function retentionStep(at = Date.parse(now())) {
  const database = db();
  const last = await database.prepare('SELECT value FROM system_state WHERE key=?').bind(STEP_KEY).first<{ value: string }>();
  if (last && at - Date.parse(last.value) < STEP_EVERY_MS) return { skipped: true };
  await database
    .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(STEP_KEY, new Date(at).toISOString())
    .run();
  const deadline = Date.now() + STEP_BUDGET_MS;
  let projects = 0;
  for (const project of await retainedProjects(null)) {
    if (Date.now() > deadline) break;
    try {
      const counts = await retainProject(project, { dryRun: false, at });
      projects++;
      if (counts.rawResponses || counts.answers || counts.jobInputs || counts.panelAnswers) console.info(JSON.stringify({ retention: counts }));
    } catch (error) {
      console.error('Retention batch failed; it retries on the next run.', project.id, error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    }
  }
  return { projects };
}
