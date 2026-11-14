import * as edition from '@edition/server/policy';
import type { Capabilities } from '@/lib/types';
export const accountCapabilities: (owner: string) => Promise<Capabilities> =
  edition.accountCapabilities;
export type CapacityChecks = { engines?: boolean; prompts?: boolean; topics?: boolean };
export const capacityGuards: (owner: string, checks?: CapacityChecks) => D1PreparedStatement[] =
  edition.capacityGuards;
export const allowedPromptIds: (owner: string) => Promise<Set<string> | null> =
  edition.allowedPromptIds;
export const syncAccess: () => Promise<void> = edition.syncAccess;
export const monthlyRunLimit: () => number = edition.monthlyRunLimit;
type Condition = { sql: string; params: (string | number)[] };
/**
 * The plan quantities a reservation also checks (Cloud; the independent edition has none). The dollars, the platform's brake
 * and each project's budget, are ./spend-guards for both editions.
 * Collection: `credits` more (a number, or SQL such as a running total) within the account's collection credits.
 */
export const budgetCondition: (owner: string, month: string, credits: number | string) => Condition = edition.budgetCondition;
/** The platform brake's defaults, before Admin sets its own. */
export const platformLimitDefaults: { monthUsd: number | null; dayUsd: number | null } = edition.platformLimitDefaults;
/** A project's default monthly budget and its plan's maximum, as SQL over the project (an SQL expression). */
export const projectBudgetDefaultSql: (project: string) => string = edition.projectBudgetDefaultSql;
export const projectBudgetMaxSql: (project: string) => string = edition.projectBudgetMaxSql;
/** Thrown when `projectCreationCondition` refused a new project; the edition's `policyError` says why in its own words. */
export const PROJECT_LIMIT = 'PLAN_PROJECT_LIMIT';
/** A new project within the plan's projects (active, and created this month). */
export const projectCreationCondition: (owner: string) => Condition = edition.projectCreationCondition;
/**
 * One more of a paid module (its spend module) within the workspace's monthly count in its plan (Cloud, 8/11/2026; independent:
 * none). `used` counts the workspace's uses this month, archived projects included.
 */
export const planCountCondition: (owner: string, module: string, used: Condition) => Condition = edition.planCountCondition;
export type PlanAllowances = {
  plan: string;
  periodStart: string;
  collectionCredits: { used: number; limit: number | null };
  agentCredits: { used: number; limit: number | null; usd: number };
  panelRounds: { used: number; limit: number | null };
  projects: { used: number; limit: number | null };
  budget: { defaultUsd: number | null; maxUsd: number | null };
};
/** What the plan allows and the account used (Cloud), or null without plans. */
export const planAllowances: (owner: string) => Promise<PlanAllowances | null> = edition.planAllowances;
export const usageWindow: (
  owner: string,
) => Promise<{
  periodStart: string;
  creditsLimit: number | null;
  limit: number | null;
}> = edition.usageWindow;
export const providerSettings: boolean = edition.providerSettings;
export const collectNewPromptsImmediately: boolean = edition.collectNewPromptsImmediately;
/** Research on every project: `always` (Cloud, 8/11/2026), or with `BRAND_RESEARCH_PROJECTS=*` (independent edition: true). */
export const researchAllProjects: boolean | 'always' = edition.researchAllProjects;
export const ownerRestore: boolean = edition.ownerRestore;
/** Google sign-in (Cloud): its production origin for the OAuth redirect URI, or null in an edition without it. */
export const googleSignIn: { productionOrigin: string } | null = edition.googleSignIn;
/**
 * The project operations run right after the monitoring tick, in the same scheduled invocation (the independent edition, with one
 * cron trigger); false where a second trigger (OPERATIONS_CRON) runs them on its own (Cloud).
 */
export const operationsWithTick: boolean = edition.operationsWithTick;
export const policyError: (message: string) => string | null =
  edition.policyError;
/** Semantic Branding: a new round (`opening`) within the plan's rounds this month. */
export const semanticBudgetCondition: (owner: string, month: string, opening: boolean) => Condition = edition.semanticBudgetCondition;

/** The agent: `addUsd` more within the account's own agent credits (Cloud, D4; independent: nothing). */
export const agentBudgetCondition: (owner: string, month: string, addUsd: number) => Condition = edition.agentBudgetCondition;

export const promptEngineGuards: (owner: string, unitId: string, engines: string[], restoring: boolean) => D1PreparedStatement[] = edition.promptEngineGuards;

/** The edition's project operations: what they did and the names of those that failed. */
export const processProjectOperations: () => Promise<{ total: number; failed: string[] }> = edition.processProjectOperations;
/**
 * One bounded step of an edition pipeline for one project (Cloud: `sentiment` of a project on automatic evaluations, `sources`
 * of all of them), run by the project runners (./project-runners); null in an edition without it.
 */
export const projectStep: (pipeline: string, projectId: string) => Promise<{ done: number; busy: boolean } | null> = edition.projectStep;
