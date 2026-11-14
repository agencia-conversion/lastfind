import { SCRAPED_ENGINES } from '@/lib/engines';
import type { Capabilities } from '@/lib/types';
import { positiveLimit } from '@/lib/scheduling';
import { setting } from '@/lib/server/env';
export const providerSettings = true;
// A personal installation collects a new prompt right away instead of waiting for the project's next collection slot.
export const collectNewPromptsImmediately = true;
// One owner owns every project and the installer cannot know project ids, so `BRAND_RESEARCH_PROJECTS=*` is honored.
export const researchAllProjects = true;
// The installation's owner restores their own backups (`npm run storage -- restore`).
export const ownerRestore = true;
export const googleSignIn: { productionOrigin: string } | null = null;
/** One cron trigger: the project operations (below) run right after the monitoring tick, in the same invocation. */
export const operationsWithTick = true;
// The owner pays the providers: no plan quantities (each project's budget and the optional platform brake are core's).
export function semanticBudgetCondition(_owner: string, _month: string, _opening: boolean) { return { sql: '1=1', params: [] as (string | number)[] }; }
/** No platform brake by default; an admin may set one in Admin > Usage and costs. */
export const platformLimitDefaults: { monthUsd: number | null; dayUsd: number | null } = { monthUsd: null, dayUsd: null };
/** What a project may spend each month when its Settings set no budget of its own (the owner changes it there). */
export const SELF_HOST_PROJECT_BUDGET_USD = 50;
export const projectBudgetDefaultSql = (_project: string) => String(SELF_HOST_PROJECT_BUDGET_USD);
export const projectBudgetMaxSql = (_project: string) => 'NULL';
export function projectCreationCondition(_owner: string) { return { sql: '1=1', params: [] as (string | number)[] }; }
export function planCountCondition(_owner: string, _module: string, _used: { sql: string; params: (string | number)[] }) { return { sql: '1=1', params: [] as (string | number)[] }; }
export async function planAllowances(_owner: string) { return null; }
export async function accountCapabilities(_owner: string): Promise<Capabilities> { return {engines: [...SCRAPED_ENGINES], promptLimit: null, topicLimit: null, agent: true}; }
export function capacityGuards(_owner: string): D1PreparedStatement[] { return []; }
export async function allowedPromptIds(_owner: string): Promise<Set<string> | null> { return null; }
export async function syncAccess(): Promise<void> {}
export function monthlyRunLimit() { return positiveLimit(setting('SELF_HOST_MONTHLY_LIMIT'), 1500); }
export function budgetCondition(_owner: string, _month: string, _credits: number | string) { return {sql: '1=1', params: [] as (string | number)[]}; }
export async function usageWindow(_owner: string) { return {periodStart: new Date().toISOString().slice(0,7)+'-01T00:00:00.000Z', creditsLimit: null, limit: monthlyRunLimit()}; }
export function policyError(_message: string): string | null { return null; }
export function agentBudgetCondition(_owner: string, _month: string, _addUsd: number) { return {sql: '1=1', params: [] as (string | number)[]}; }

export function promptEngineGuards(_owner: string, _unitId: string, _engines: string[], _restoring: boolean): D1PreparedStatement[] { return []; }

/**
 * The project operations of this edition: the automatic sentiment and source types of every project on automatic evaluations
 * (lib/server/operations.ts, the same steps as the hosted edition), each inside the project's budget. Nothing while brand
 * research is off on the Worker (`BRAND_RESEARCH_ENABLED`), as the scheduler's requested readings.
 */
export async function processProjectOperations() {
  if (setting('BRAND_RESEARCH_ENABLED') !== 'true') return { total: 0, failed: [] as string[] };
  const { evaluationOperations, runOperations } = await import('@/lib/server/operations');
  return runOperations(evaluationOperations());
}
/** The project runners' steps, when the installation binds them: one project's sentiment, or the source types of all of them. */
export async function projectStep(pipeline: string, projectId: string): Promise<{ done: number; busy: boolean } | null> {
  if (setting('BRAND_RESEARCH_ENABLED') !== 'true') return null;
  if (pipeline === 'sentiment') return (await import('@/lib/server/project-evaluations')).projectSentimentStep(projectId);
  if (pipeline !== 'sources') return null;
  const done = await (await import('@/lib/server/source-classification')).autoClassificationStep();
  return { done: done ?? 0, busy: done === null };
}
