import { requireActor } from '@/lib/server/auth';
import { db, now } from '@/lib/server/env';
import { retentionCutoff } from '@/lib/retention';
import { projectReadDatabase } from '@/lib/server/project-store-read';
import { runFromRow } from '@/lib/server/workspace';
import {
  ANSWER_DISCOVERED_SQL,
  EFFECTIVE_MENTIONS_SQL,
  EFFECTIVE_TARGETS_SQL,
} from '@/lib/server/run-rows';
import { brandKey } from '@/lib/brand-decisions';
import { competitorIdentity } from '@/lib/competitor-identity';
import type { AnswerBrand } from '@/lib/types';
import { json, fail, ApiError } from '@/lib/server/http';
import { ANSWER_ROLE_ORDER, answerBrands, type DiscoverySeed } from '@/lib/competitor-discovery';
import { answerRoles } from '@/lib/server/brand-roles';
import { commonNamesOf } from '@/lib/brand-mention-check';
import { providerSettings } from '@/lib/server/capabilities';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const u = await requireActor(),
      { id } = await params;
    const project = await db()
      .prepare(
        'SELECT r.project_id,p.raw_retention_days FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.workspace_id=? AND p.workspace_id=? AND p.archived=0',
      )
      .bind(id, u.workspaceId, u.workspaceId)
      .first<{ project_id: string; raw_retention_days: number | null }>();
    if (!project) throw new ApiError(404, 'Response not found.');
    const database = await projectReadDatabase(project.project_id, u.workspaceId);
    const row = await database
      .prepare(
        `SELECT r.*,${EFFECTIVE_TARGETS_SQL} AS effective_targets_json,
         ${EFFECTIVE_MENTIONS_SQL} AS effective_mentions_json,
         ${ANSWER_DISCOVERED_SQL} AS discovered_json
         FROM runs r WHERE id=? AND project_id=? AND workspace_id=?`,
      )
      .bind(id, project.project_id, u.workspaceId)
      .first<Record<string, unknown>>();
    if (!row) throw new ApiError(404, 'Response not found.');
    const run = runFromRow(row);
    // What the decision model already said about each name in the answers to this question, else for the project
    // (a read; nothing is asked here). A failed read lists
    // only the monitored brands rather than failing the response.
    const roles = await answerRoles(project.project_id, run.prompt_text).catch(() => new Map<string, string>());
    // The monitored spellings that are common words claim only themselves (structure-v13): "AIM Conversion Experts" is listed.
    const common = await commonNamesOf(database);
    const targets = JSON.parse(String(row.effective_targets_json ?? row.targets_json)) as DiscoverySeed[];
    const tracked = Object.entries(run.mentions).filter(([, mentioned]) => mentioned).map(([name]) => name);
    // Cloud customers see neither the provider cost nor the internal error text; the independent owner pays the provider and keeps both.
    const { cost: _cost, error: _error, ...visible } = run;
    const brands = run.answer ? answerBrands(run.answer, tracked, targets, roles, common) : [];
    // The discoveries share of voice counts in this answer (the brand analysis, which finds the project's known brands by
    // their spellings, structure-v15) are always among its brands, with their aliases, so the answer view marks each one.
    const discovered = JSON.parse(String(row.discovered_json ?? '[]')) as string[];
    if (run.answer && discovered.length) {
      const suggestions = await database
        .prepare(
          `SELECT name,detection_json FROM competitor_suggestions WHERE revision=(SELECT value FROM store_meta WHERE key='analysis_revision')
           AND identity IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify(discovered.map(competitorIdentity)))
        .all<{ name: string; detection_json: string | null }>()
        .catch(() => ({ results: [] as { name: string; detection_json: string | null }[] }));
      const keys = new Set(discovered);
      for (const suggestion of suggestions.results) {
        const key = brandKey(suggestion.name);
        if (!keys.has(key)) continue;
        const aliases = (JSON.parse(suggestion.detection_json ?? '{}') as { aliases?: string[] }).aliases ?? [];
        const listed = brands.find((brand) => brandKey(brand.name) === key);
        if (listed) {
          if (listed.role === 'pending') listed.role = 'competitor';
          if (aliases.length) listed.aliases = aliases;
        } else brands.push({ name: suggestion.name, role: 'competitor', ...(aliases.length ? { aliases } : {}) } satisfies AnswerBrand);
      }
      brands.sort((left, right) => ANSWER_ROLE_ORDER.indexOf(left.role) - ANSWER_ROLE_ORDER.indexOf(right.role));
    }
    // A complete answer older than the project's data retention (lib/retention.ts) keeps its numbers, not its text: the screen says so.
    const textRemoved = !run.answer && run.status === 'complete' && project.raw_retention_days !== null && run.created_at < retentionCutoff(Number(project.raw_retention_days), Date.parse(now()));
    const response = json({ ...(providerSettings ? run : visible), brands, ...(textRemoved ? { textRemoved } : {}) });
    response.headers.set('X-Lastfind-Storage', database.mode);
    return response;
  } catch (e) {
    return fail(e);
  }
}
