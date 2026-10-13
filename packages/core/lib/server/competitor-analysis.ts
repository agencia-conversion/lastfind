import { buildTargetSnapshot } from '@/lib/target-snapshot.mjs';
import type { BrandTarget } from '@/lib/types';
import {
  ensureProjectStore,
  getProjectStore,
  syncProjectStore,
} from './project-store';
import { projectStoreRpc } from './project-store-transport';
import { ownedProject } from './workspace';
import { ApiError } from './http';

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
  publicationPending?: boolean;
  needsEnsure?: boolean;
  suggestions: Array<{
    name: string;
    domain: string | null;
    /** Portable model rank in [0,1], not a calibrated probability. */
    score: number;
    answerCount: number;
    evidence: Array<{ runId: string; excerpt: string; createdAt: string }>;
  }>;
};

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
  ownerId: string,
  restart = false,
) {
  let project = await ownedProject(projectId, ownerId);
  let registry = await ensureProjectStore(projectId, ownerId);
  if (registry.source_revision !== registry.applied_revision) {
    try {
      const synced = await syncProjectStore(projectId, ownerId, 100);
      registry = synced.registry;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      registry = await ensureProjectStore(projectId, ownerId);
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
      ownerId,
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
  });
  // A slower request for configuration A may reach the object after a newer
  // project edit B. Re-read D1 and make the latest target list win before the
  // caller returns; a later B request is also idempotent.
  project = await ownedProject(projectId, ownerId);
  targets = projectTargets(project);
  const latestRevision = await targetRevision(targets);
  const latestConfigVersion = Number(project.competitor_targets_revision || 0);
  if (latestRevision !== revision || latestConfigVersion !== configVersion) {
    revision = latestRevision;
    configVersion = latestConfigVersion;
    result = await projectStoreRpc<CompetitorAnalysisStatus>({
      scope: { ownerId, projectId, generation: registry.generation },
      action: 'analysis-start',
      revision,
      configVersion,
      targets,
      cutoff,
      maxRuns: COMPETITOR_ANALYSIS_MAX_RUNS,
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
  ownerId: string,
) {
  const project = await ownedProject(projectId, ownerId);
  const registry = await getProjectStore(projectId, ownerId);
  const revision = await targetRevision(projectTargets(project));
  const configVersion = Number(project.competitor_targets_revision || 0);
  const publicationPending =
    !!registry && registry.source_revision !== registry.applied_revision;
  // Status must not initialize storage, publish answers, or start/repair jobs.
  // Browser navigation can issue an authenticated GET without an Origin header.
  const result: CompetitorAnalysisStatus = registry?.initialized
    ? await projectStoreRpc<CompetitorAnalysisStatus>({
        scope: { ownerId, projectId, generation: registry.generation },
        action: 'analysis-status',
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
      result.configVersion !== configVersion ||
      result.status === 'idle',
    ...(publicationPending ? { status: 'pending' as const } : {}),
  };
}
