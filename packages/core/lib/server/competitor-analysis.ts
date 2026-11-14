import { buildTargetSnapshot } from '@/lib/target-snapshot.mjs';
import type { BrandRole } from '@/lib/brand-roles';
import type { BrandTarget } from '@/lib/types';
import {
  type StoreRegistry,
  ensureProjectStore,
  getProjectStore,
  syncProjectStore,
} from './project-store';
import { projectStoreRpc } from './project-store-transport';
import { ownedProject } from './workspace';

import { ApiError } from './http';
import { decidedRoles } from './brand-roles';
import { loadDecisionEvents } from './brand-decision-events';
import { brandKey, deriveState, resolveMerge } from '@/lib/brand-decisions';
import { decisionKeyConfigured } from './model-routes';

export const COMPETITOR_ANALYSIS_DAYS = 90;
export const COMPETITOR_ANALYSIS_MAX_RUNS = 10000;

export type CompetitorAnalysisStatus = {
  revision: string | null;
  configVersion: number;
  status: 'idle' | 'pending' | 'running' | 'complete' | 'failed';
  processed: number;
  scanned: number;
  phase: 'seeds' | 'analysis';
  total: number;
  truncated: boolean;
  cutoff: string | null;
  maxRuns: number;
  error: string | null;
  updatedAt: string | null;
  mutationRevision: number;
  /** The detector that produced the active suggestions (DETECTOR_VERSION), null before it was recorded. */
  detector?: string | null;
  /** Set while the active suggestions come from an older detector: they stay until an explicit restart. */
  staleDetector?: { current: string; available: string } | null;
  publicationPending?: boolean;
  needsEnsure?: boolean;
  /** While a pass over new targets runs: the last complete analysis's list and the answers it read (the store serves it until the new one is ready). */
  previous?: { suggestions: CompetitorAnalysisStatus['suggestions']; analyzed: number };
  suggestions: Array<{
    name: string;
    domain: string | null;
    /** Portable model rank in [0,1], not a calibrated probability. */
    score: number;
    answerCount: number;
    evidence: Array<{ runId: string; excerpt: string; createdAt: string }>;
    /** What the free detector concluded; absent in analyses saved before it existed. */
    ambiguous?: boolean;
    reasons?: string[];
    role?: BrandRole;
    /** UTC day → answers of that day that mention the name. */
    days?: Record<string, number>;
  }>;
};

/** Names the decision model settled: the non-competitors leave the list, the competitors always stay in it (up to the store's bound). */
async function settledRoles(projectId: string, known?: Map<string, string>) {
  const roles = [...(known ?? (await decidedRoles(projectId).catch(() => new Map<string, string>())))];
  return {
    exclude: roles.filter(([, role]) => role !== 'competitor' && role !== 'ambiguous').map(([key]) => key),
    include: roles.filter(([, role]) => role === 'competitor').map(([key]) => key),
  };
}

/**
 * Tells the project store which discoveries share of voice and position count (BRAND_COUNTED_SQL), as `{brand key: group
 * key}`: only competitors: names the decision model settled as competitor, not rejected, not a monitored
 * brand's; a name merged into another counts in that one's group, once per answer. A name the model has not settled yet
 * waits in review and does not count. The store writes only a change, so calling it often costs a few D1 reads and one
 * store call.
 */
export async function syncCountedBrands(projectId: string, workspaceId: string) {
  const [registry, project, roles, events] = await Promise.all([
    getProjectStore(projectId, workspaceId),
    ownedProject(projectId, workspaceId),
    decidedRoles(projectId),
    loadDecisionEvents(projectId),
  ]);
  if (!registry?.initialized) return;
  const state = deriveState(events);
  const monitored = new Set(projectTargets(project).flatMap((target) => [target.name, ...(target.aliases ?? [])]).map(brandKey));
  // A longer name the decision model settled as a monitored brand itself ("Amazon Prime Video" for Prime Video, a name question
  // of lib/brand-mention-check.ts) counts as that brand in its answers: never also as a discovery beside it, in share of voice
  // or in the lists (12/11/2026: it was dropped from share of voice only, so the Overview ranked it beside the brand). Only a
  // settled verdict: joining brands is the owner's decision, so an open question changes nothing.
  const rows = await projectStoreRpc<{ results: { span: string | null }[] }[]>({
    scope: { ownerId: workspaceId, projectId, generation: registry.generation },
    action: 'query',
    statements: [{ sql: ALIAS_SPANS_SQL, params: [] }],
  }).then((batches) => batches[0]?.results ?? [], () => []);
  const aliases = [...new Set(rows.flatMap((row) => (row.span ? [brandKey(row.span)] : [])))].filter((key) => !monitored.has(key)).sort();
  for (const key of aliases) monitored.add(key);
  const groups: Record<string, string> = {};
  for (const key of new Set([...roles.keys(), ...Object.keys(state.mergedInto)])) {
    const group = resolveMerge(state, key);
    const competitor = roles.get(key) === 'competitor' || roles.get(group) === 'competitor';
    if (competitor && !state.rejected[key] && !state.rejected[group] && !monitored.has(key) && !monitored.has(group)) groups[key] = group;
  }
  await projectStoreRpc({ scope: { ownerId: workspaceId, projectId, generation: registry.generation }, action: 'brand-counted', groups, aliases });
}
/** The longer names a name question settled as the monitored brand itself. */
const ALIAS_SPANS_SQL = "SELECT DISTINCT json_extract(request_json,'$.span') span FROM mention_asks WHERE slot='active' AND counted=1 AND json_extract(request_json,'$.pair') IS NOT NULL LIMIT 1000";

function projectTargets(project: Record<string, unknown>) {
  return buildTargetSnapshot(project) as BrandTarget[];
}

async function targetRevision(targets: BrandTarget[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(targets));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function ensureCompetitorAnalysis(
  projectId: string,
  workspaceId: string,
  restart = false,
) {
  let project = await ownedProject(projectId, workspaceId);
  let registry = await ensureProjectStore(projectId, workspaceId);
  if (registry.source_revision !== registry.applied_revision) {
    try {
      const synced = await syncProjectStore(projectId, workspaceId, 100);
      registry = synced.registry;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      registry = await ensureProjectStore(projectId, workspaceId);
    }
  }
  let targets = projectTargets(project);
  let revision = await targetRevision(targets);
  let configVersion = Number(project.competitor_targets_revision || 0);
  const cutoff = new Date(
    Date.now() - COMPETITOR_ANALYSIS_DAYS * 86400000,
  ).toISOString();
  let result = await projectStoreRpc<CompetitorAnalysisStatus>({
    scope: {
      ownerId: workspaceId,
      projectId,
      generation: registry.generation,
    },
    action: 'analysis-start',
    revision,
    configVersion,
    targets,
    cutoff,
    maxRuns: COMPETITOR_ANALYSIS_MAX_RUNS,
    restart,
    mentionModel: !!decisionKeyConfigured(),
  });
  // A slower request for configuration A may reach the object after a newer
  // project edit B. Re-read D1 and make the latest target list win before the
  // caller returns; a later B request is also idempotent.
  project = await ownedProject(projectId, workspaceId);
  targets = projectTargets(project);
  const latestRevision = await targetRevision(targets);
  const latestConfigVersion = Number(project.competitor_targets_revision || 0);
  if (latestRevision !== revision || latestConfigVersion !== configVersion) {
    revision = latestRevision;
    configVersion = latestConfigVersion;
    result = await projectStoreRpc<CompetitorAnalysisStatus>({
      scope: { ownerId: workspaceId, projectId, generation: registry.generation },
      action: 'analysis-start',
      revision,
      configVersion,
      targets,
      cutoff,
      maxRuns: COMPETITOR_ANALYSIS_MAX_RUNS,
      mentionModel: !!decisionKeyConfigured(),
    });
  } else if (result.configVersion > configVersion) {
    // The project's version only grows and was just read again: a store job ahead of it came from elsewhere (a preview copy
    // adopted production's). The store takes the project's own, or the analysis would read as "needs re-analysis" forever.
    result = await projectStoreRpc<CompetitorAnalysisStatus>({
      scope: { ownerId: workspaceId, projectId, generation: registry.generation },
      action: 'analysis-start',
      revision,
      configVersion,
      confirmed: true,
      targets,
      cutoff,
      maxRuns: COMPETITOR_ANALYSIS_MAX_RUNS,
      // Never a second restart: the first one already ran; with the same targets this only aligns the job's version.
      mentionModel: !!decisionKeyConfigured(),
    });
  }
  const publicationPending =
    registry.source_revision !== registry.applied_revision;
  return publicationPending
    ? { ...result, status: 'pending' as const, publicationPending: true }
    : { ...result, publicationPending: false };
}

export async function competitorAnalysisStatus(
  projectId: string,
  workspaceId: string,
  // The project and registry the caller read a moment ago in the same request.
  known?: { project: Record<string, unknown>; registry: StoreRegistry | null },
  // Brand keys left out of the suggestions. By default the names the decision model settled as anything but a
  // competitor: they never reach the Brands ranking, so the most mentioned of the rest fill the list. By default the
  // settled competitors are also kept beyond the 200 most mentioned (a competitor named in one answer is still listed).
  exclude?: string[],
  // The decided roles the caller read in the same request (saves reading them again for the default exclusion).
  roles?: Map<string, string>,
  // With an explicit `exclude`: brand keys always returned besides the most mentioned (the default keeps settled competitors).
  include?: string[],
) {
  // Two independent D1 reads: one round trip, not two.
  const [project, registry] = known
    ? [known.project, known.registry]
    : await Promise.all([ownedProject(projectId, workspaceId), getProjectStore(projectId, workspaceId)]);
  const revision = await targetRevision(projectTargets(project));
  const configVersion = Number(project.competitor_targets_revision || 0);
  const publicationPending =
    !!registry && registry.source_revision !== registry.applied_revision;
  // Status must not initialize storage, publish answers, or start/repair jobs.
  // Browser navigation can issue an authenticated GET without an Origin header.
  const result: CompetitorAnalysisStatus = registry?.initialized
    ? await projectStoreRpc<CompetitorAnalysisStatus>({
        scope: { ownerId: workspaceId, projectId, generation: registry.generation },
        action: 'analysis-status',
        ...(exclude ? { exclude, ...(include ? { include } : {}) } : await settledRoles(projectId, roles)),
      })
    : {
        revision: null,
        configVersion: 0,
        status: 'idle',
        processed: 0,
        scanned: 0,
        phase: 'seeds',
        total: 0,
        truncated: false,
        cutoff: null,
        maxRuns: COMPETITOR_ANALYSIS_MAX_RUNS,
        error: null,
        updatedAt: null,
        mutationRevision: 0,
        suggestions: [],
      };
  return {
    ...result,
    publicationPending,
    needsEnsure:
      !registry?.initialized ||
      publicationPending ||
      result.revision !== revision ||
      // Same targets under a newer config version (an analysis a preview copy adopted from production) is current: the store
      // ignores an older start, so `!==` asked for an ensure forever.
      result.configVersion < configVersion ||
      result.status === 'idle',
    ...(publicationPending ? { status: 'pending' as const } : {}),
  };
}
