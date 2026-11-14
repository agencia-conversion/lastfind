// Compact read adapter over the preserved Semantic Branding collection. No provider work or copied answers.
import { db } from './env';
import { ApiError } from './http';
import type { parseReportFilter } from './report-filter';
export type SemanticSourceRow = { id: string; date: string; unit: string; engine: string; sources: unknown[]; targets: unknown[]; score: number | null };
export type SemanticRow = {
  id: string; day: string; engine: string; sources_json: string; roster_json: string; score: number | null;
};
/** The last day (UTC) before an exclusive end. */
const lastDay = (end: string) => new Date(Date.parse(end) - 1).toISOString().slice(0, 10);
/** The SQL and bindings of {@link semanticSourceStatement}, or null when this report borrows no semantic observation. */
function semanticSourceQuery(projectId: string, workspaceId: string, filter: ReturnType<typeof parseReportFilter>, q: URLSearchParams) {
  const origin = q.get('origin') || 'all';
  if (!['all', 'prompts', 'semantic-branding'].includes(origin)) throw new ApiError(400, 'Invalid source origin.');
  if (origin === 'prompts') return null;
  // Topic/tag/prompt filters have no matching semantic question. Never borrow unrelated observations.
  // Only the interfaces' answers (6/11/2026): a pure model's, asked until then, cites nothing here as it counts in no score.
  if (['topic','tags','prompt','query'].some((key) => q.get(key))) return null;
  const engines = filter.engine === 'all' ? [] : filter.engine.split(',');
  return {
    sql: `SELECT q.id,r.day,q.engine,q.sources_json,r.roster_json,
      (SELECT AVG(score) FROM semantic_panel_readings n WHERE n.query_id=q.id) score
    FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id
    WHERE q.project_id=? AND q.workspace_id=? AND r.project_id=q.project_id AND r.workspace_id=q.workspace_id
      AND r.day>=? AND r.day<=? AND q.status='completed' AND q.method='scrape'
      ${engines.length ? 'AND q.engine IN (SELECT value FROM json_each(?))' : ''}
    ORDER BY r.day,q.id`,
    // From the comparison's first day: the Sources list compares each row with it (semanticSourcePeriods splits the two).
    params: [projectId,workspaceId,filter.previousCutoff.slice(0,10),lastDay(filter.end),
      ...(engines.length ? [JSON.stringify(engines)] : [])],
  };
}
/** The read of {@link semanticSourceRows}, or null when this report borrows no semantic observation; for a caller that batches its reads. */
export function semanticSourceStatement(projectId: string, workspaceId: string, filter: ReturnType<typeof parseReportFilter>, q: URLSearchParams) {
  const query = semanticSourceQuery(projectId, workspaceId, filter, q);
  return query && db().prepare(query.sql).bind(...query.params);
}
/**
 * What changes when {@link semanticSourceStatement}'s rows do (count, first and last day, newest query, total sources), for a
 * caller that checks for changes without reading them (first-screen-warm.ts); null like the statement.
 */
export function semanticSourceVersionStatement(projectId: string, workspaceId: string, filter: ReturnType<typeof parseReportFilter>, q: URLSearchParams) {
  const query = semanticSourceQuery(projectId, workspaceId, filter, q);
  return query && db().prepare(`SELECT COUNT(*) n,MIN(day) first,MAX(day) last,MAX(id) newest,SUM(length(sources_json)) bytes,SUM(score) score FROM (${query.sql})`).bind(...query.params);
}

export async function semanticSourceRows(projectId: string, workspaceId: string, filter: ReturnType<typeof parseReportFilter>, q: URLSearchParams): Promise<SemanticSourceRow[]> {
  const statement = semanticSourceStatement(projectId, workspaceId, filter, q);
  return statement ? semanticSourcePeriods(semanticSourceRowsFrom((await statement.all<SemanticRow>()).results), filter).current : [];
}

/**
 * The rows of the period and of its comparison, by day: a period holds the day it starts on, so the comparison's last day
 * stops before the period's first one, and days between a chosen comparison and the period belong to neither.
 */
export function semanticSourcePeriods(rows: SemanticSourceRow[], filter: Pick<ReturnType<typeof parseReportFilter>, 'cutoff' | 'previousCutoff' | 'previousEnd'>) {
  const first = filter.cutoff.slice(0, 10), previousFirst = filter.previousCutoff.slice(0, 10), previousLast = lastDay(filter.previousEnd);
  const day = (row: SemanticSourceRow) => row.date.slice(0, 10);
  return {
    current: rows.filter((row) => day(row) >= first),
    previous: rows.filter((row) => day(row) >= previousFirst && day(row) <= previousLast && day(row) < first),
  };
}

export function semanticSourceRowsFrom(rows: SemanticRow[]): SemanticSourceRow[] {
  return rows.map((row) => ({ id: row.id,date: row.day+'T00:00:00.000Z',unit: 'semantic-branding:'+row.roster_json,engine: row.engine,sources: JSON.parse(row.sources_json),
    targets: JSON.parse(row.roster_json).brands,score: row.score }));
}
