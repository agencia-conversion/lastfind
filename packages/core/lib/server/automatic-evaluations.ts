import { db, now } from '@/lib/server/env';
import { dollarBlock, projectBudgetColumnSql } from '@/lib/server/spend-guards';
import {
  AUTO_CLASSIFICATION_KEY,
  AUTO_LEDGER,
  EVALUATIONS_AUTHORIZATION_KEY,
  LEGACY_SENTIMENT_PREFIX,
  SENTIMENT_JOB_PREFIX,
} from '@/lib/server/brand-research';
import type { ResearchProvider } from '@/lib/brand-research';
import { readOperation, writer } from './operation-state';
import { automaticByDefault } from './brand-research';

export { AUTO_LEDGER, EVALUATIONS_AUTHORIZATION_KEY, SENTIMENT_JOB_PREFIX };

/**
 * The projects whose configuration row says `enabled=1, automatic=1`. Their sentiment (./project-evaluations.ts) and
 * source types (./source-classification.ts) are evaluated by the scheduler, under the ceilings below. Where the installation
 * researches every project (automaticByDefault) that is every project by default (adoptProjects), within the project's budget;
 * the owner's switch (Settings, "Enable evaluation") and Admin's still turn it off.
 */
/** The sentiment provider `evaluations-enable` sets (Liquid, d1-ultra); the estimate prices that one. */
export const ENABLED_SENTIMENT_PROVIDER = 'liquid' satisfies ResearchProvider;
/** 1,300 answers cost US$ 0.48 on the pilot; used until this ledger has observed enough of its own. */
export const SENTIMENT_USD_PER_ANSWER = 0.0004;
export const sentimentStateKey = (projectId: string) => `project_sentiment:${projectId}`;
export const monthStart = () => `${now().slice(0, 7)}-01T00:00:00.000Z`;

export type AutomaticTarget = {
  projectId: string;
  workspaceId: string;
  domain: string;
  /** The project's monthly budget (Settings > Monitoring > Budget), which replaced the evaluations' own ceiling. */
  ceilingUsd: number;
  sentimentProvider: ResearchProvider;
  /** The project's source-type provider (`provider` column): the model that types its sources. */
  sourceProvider: ResearchProvider;
};

const AUTOMATIC_FROM_SQL = `brand_research_configurations c JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id`;
const AUTOMATIC_WHERE_SQL = 'c.enabled=1 AND c.automatic=1 AND p.archived=0';
/** Active projects with automatic evaluations on. Archived projects, or ones the owner switched off, drop out by themselves. */
export async function automaticTargets() {
  const { results } = await db()
    .prepare(
      `SELECT p.id projectId,p.workspace_id workspaceId,p.domain,${projectBudgetColumnSql('p.id')} ceilingUsd,COALESCE(c.sentiment_provider,c.provider) sentimentProvider,c.provider sourceProvider
      FROM ${AUTOMATIC_FROM_SQL} WHERE ${AUTOMATIC_WHERE_SQL} ORDER BY p.created_at,p.id`,
    )
    .all<AutomaticTarget>();
  return results;
}
/**
 * A project without a configuration row (new, imported or restored) gets automatic evaluations on (8/11/2026): one statement a
 * tick, before the runners are chosen. A row the owner or Admin wrote (on or off) is never touched.
 */
export async function adoptProjects() {
  if (!automaticByDefault()) return;
  await db()
    .prepare(`INSERT INTO brand_research_configurations(project_id,workspace_id,provider,sentiment_provider,enabled,automatic,revision,updated_at)
      SELECT p.id,p.workspace_id,'jev',?,1,1,1,? FROM projects p WHERE p.archived=0 AND NOT EXISTS(SELECT 1 FROM brand_research_configurations c WHERE c.project_id=p.id)
      ON CONFLICT(project_id) DO NOTHING`)
    .bind(ENABLED_SENTIMENT_PROVIDER, now())
    .run();
}
const SENTIMENT_STARTED_PREFIX = 'sentiment-runner-started:';
/**
 * The automatic projects one operations tick hands to their sentiment runners: at most `limit`, those handed over longest
 * ago first (a round robin, as roles and domains), so evaluations on for many projects never start them all at once on D1.
 */
export async function sentimentRunnerProjects(limit: number) {
  await adoptProjects();
  const { results } = await db()
    .prepare(
      `SELECT p.id FROM ${AUTOMATIC_FROM_SQL} LEFT JOIN system_state s ON s.key=?||p.id
      WHERE ${AUTOMATIC_WHERE_SQL} ORDER BY COALESCE(s.value,''),p.created_at,p.id LIMIT ?`,
    )
    .bind(SENTIMENT_STARTED_PREFIX, limit)
    .all<{ id: string }>();
  const ids = results.map((row) => row.id);
  if (ids.length)
    await db()
      .prepare('INSERT INTO system_state(key,value) SELECT ?||value,? FROM json_each(?) WHERE true ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(SENTIMENT_STARTED_PREFIX, now(), JSON.stringify(ids))
      .run();
  return ids;
}

const sentimentLedger = 'id LIKE ? OR id LIKE ?';
async function spent(ledger: string, ...bind: unknown[]) {
  const row = await db()
    .prepare(
      `SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) spent FROM brand_research_jobs WHERE project_id=? AND requested_at>=? AND (${ledger})`,
    )
    .bind(...bind)
    .first<{ spent: number }>();
  return Number(row?.spent || 0);
}

/** Dollars spent or still held by the project's sentiment ledger since `since`. */
export const sentimentSpent = (projectId: string, since: string) =>
  spent(sentimentLedger, projectId, since, `${SENTIMENT_JOB_PREFIX}%`, `${LEGACY_SENTIMENT_PREFIX}%`);

/** Same, over everything automatic for the project: sentiment and source types (Admin shows it; the project's budget limits all of its spend). */
export const evaluationSpent = (projectId: string, since: string) =>
  spent(`${sentimentLedger} OR context_key=?`, projectId, since, `${SENTIMENT_JOB_PREFIX}%`, `${LEGACY_SENTIMENT_PREFIX}%`, AUTO_LEDGER);

/**
 * The publication revisions of these projects' stores, as one string: they move when new answers reach a store, so an idle
 * evaluation looks again at once instead of waiting its hourly recheck.
 */
export async function storeRevisions(projectIds: string[]) {
  const { results } = await db()
    .prepare('SELECT project_id,applied_revision FROM project_stores WHERE project_id IN (SELECT value FROM json_each(?)) ORDER BY project_id,workspace_id')
    .bind(JSON.stringify(projectIds))
    .all<{ project_id: string; applied_revision: number | null }>();
  return results.map((row) => `${row.project_id}:${row.applied_revision ?? ''}`).join(',');
}

/** Set by the first evaluation of the tick that hit a rejected key, credit or rate limit, or an outcome it cannot know; the rest of the tick spends nothing. */
export const tickState = { stopped: false };
export type Why = 'inactive' | 'month' | 'round' | 'cycle' | 'budget';
const held = 'COALESCE(SUM(MAX(cost_usd,reserved_usd)),0)';
const sentimentIds = "(id LIKE ? OR id LIKE ?)";

/**
 * The conditions of a reservation, written into the same INSERT that holds the money (one statement, so two ticks can never
 * both pass them): the project is still active and on, (sentiment only) its round has room, and,
 * while the first cycle lasts (EVALUATIONS_AUTHORIZATION_KEY, until it is completed or its window passes), its total has room.
 * A passed window ends the cycle: it used to stop every automatic evaluation for good, and from 27/10 new answers got no sentiment.
 */
export function reservationGuard(target: AutomaticTarget, reserve: number, round?: { since: string; ceiling: number }) {
  const sentiment = [`${SENTIMENT_JOB_PREFIX}%`, `${LEGACY_SENTIMENT_PREFIX}%`];
  const sql = `EXISTS(SELECT 1 FROM brand_research_configurations c JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id WHERE c.project_id=? AND c.workspace_id=? AND c.enabled=1 AND c.automatic=1 AND p.archived=0)
    ${round ? `AND (SELECT ${held} FROM brand_research_jobs WHERE project_id=? AND requested_at>=? AND ${sentimentIds})+?<=?` : ''}
    AND (NOT EXISTS(SELECT 1 FROM system_state WHERE key=?)
      OR (SELECT json_extract(value,'$.completedAt') FROM system_state WHERE key=?) IS NOT NULL
      OR (SELECT json_extract(value,'$.windowEndsAt') FROM system_state WHERE key=?)<?
      OR (SELECT ${held} FROM brand_research_jobs WHERE requested_at>=(SELECT json_extract(value,'$.enabledAt') FROM system_state WHERE key=?) AND (${sentimentIds} OR context_key=?))+?<=(SELECT json_extract(value,'$.ceilingUsd') FROM system_state WHERE key=?))`;
  const params = [
    target.projectId, target.workspaceId,
    ...(round ? [target.projectId, round.since, ...sentiment, reserve, round.ceiling] : []),
    EVALUATIONS_AUTHORIZATION_KEY, EVALUATIONS_AUTHORIZATION_KEY,
    EVALUATIONS_AUTHORIZATION_KEY, now(),
    EVALUATIONS_AUTHORIZATION_KEY, ...sentiment, AUTO_LEDGER, reserve, EVALUATIONS_AUTHORIZATION_KEY,
  ];
  return { sql, params };
}

/** The first cycle while it lasts: what it may spend and what it has spent. Null without an authorization, once completed or once its window passed. */
export async function firstCycle() {
  const row = await db().prepare('SELECT value FROM system_state WHERE key=?').bind(EVALUATIONS_AUTHORIZATION_KEY).first<{ value: string }>();
  if (!row) return null;
  let authorization: { enabledAt?: string; windowEndsAt?: string; ceilingUsd?: number; completedAt?: string } = {};
  try {
    authorization = JSON.parse(row.value || '{}');
  } catch {
    // An unreadable authorization spends nothing: the guard refuses it too.
  }
  const { enabledAt, windowEndsAt, ceilingUsd, completedAt } = authorization;
  if (completedAt || (windowEndsAt && windowEndsAt < now())) return null;
  const total = await db()
    .prepare(`SELECT ${held} spent FROM brand_research_jobs WHERE requested_at>=? AND (${sentimentIds} OR context_key=?)`)
    .bind(enabledAt ?? '', `${SENTIMENT_JOB_PREFIX}%`, `${LEGACY_SENTIMENT_PREFIX}%`, AUTO_LEDGER)
    .first<{ spent: number }>();
  return {
    ceilingUsd: typeof ceilingUsd === 'number' ? ceilingUsd : 0,
    spentUsd: Number(total?.spent || 0),
  };
}

/**
 * The first cycle ends when the initial reprocessing does: every automatic project's sentiment and the sources' typing
 * caught up since the enable (a project skipped by a ceiling or unreadable keeps it open), and a count over the current
 * data (`pending`, from ./conversion-source-classification) finds no source without a type and no answer without a valid sentiment (the stored states are only preconditions:
 * a source can arrive after the sweep, an answer can fail and never be resent). Only then does the first-cycle total stop applying and the monthly ceilings alone govern.
 */
export async function closeFirstCycle(pending: (targets: AutomaticTarget[]) => Promise<number>) {
  const found = await readOperation(EVALUATIONS_AUTHORIZATION_KEY);
  const authorization = found?.operation;
  if (!found || !authorization?.enabledAt || authorization.completedAt) return;
  const since = String(authorization.enabledAt);
  const targets = await automaticTargets();
  if (!targets.length) return;
  const classification = (await readOperation(AUTO_CLASSIFICATION_KEY))?.operation;
  if (classification?.status !== 'applied' || String(classification.appliedAt ?? '') < since || Number(classification.unreadableProjects || 0) || Number(classification.cappedProjects || 0)) return;
  for (const target of targets) {
    const sentiment = (await readOperation(sentimentStateKey(target.projectId)))?.operation;
    if (sentiment?.status !== 'idle' || String(sentiment.checkedAt ?? '') < since) return;
  }
  if (await pending(targets)) return;
  await writer(EVALUATIONS_AUTHORIZATION_KEY, authorization, found.raw)({ ...authorization, completedAt: now() });
}

/** After a reservation was refused: why, so the state says "paused by the ceiling" and not "waiting". */
export async function whyRefused(target: AutomaticTarget, reserve: number, round?: { since: string; ceiling: number }): Promise<Why> {
  const active = await db()
    .prepare('SELECT 1 AS found FROM brand_research_configurations c JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id WHERE c.project_id=? AND c.workspace_id=? AND c.enabled=1 AND c.automatic=1 AND p.archived=0')
    .bind(target.projectId, target.workspaceId)
    .first();
  if (!active) return 'inactive';
  // `month`: the project's budget; `budget`: the platform's brake.
  const block = await dollarBlock(target.projectId, reserve);
  if (block === 'project_budget') return 'month';
  if (round && (await sentimentSpent(target.projectId, round.since)) + reserve > round.ceiling) return 'round';
  const cycle = await firstCycle();
  if (cycle && cycle.spentUsd + reserve > cycle.ceilingUsd) return 'cycle';
  return 'budget';
}
