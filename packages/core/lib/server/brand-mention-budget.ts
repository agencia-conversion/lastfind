import { isAdmin } from '@edition/lib/admin-access';
import { MENTION_CHECK_ADMIN_MAX_USD, MENTION_CHECK_MONTHLY_USD } from '@/lib/brand-mention-check';
import { db, now } from './env';
import { ApiError } from './http';
import { roleAtLeast, type Actor } from './auth';
import { ownedProject } from './workspace';
import { mentionBudgets } from './brand-mention-checks';
import { decisionKeyConfigured } from './model-routes';

/** A Lastfind admin (`isAdmin`), as a plain boolean. */
const platformAdmin = (actor: Actor): boolean => isAdmin({ email: actor.email });
/** A limit only a platform admin sets: unlimited, or above what a workspace admin may set. */
const aboveWorkspace = (row: { monthly_usd: number | null } | null) => !!row && (row.monthly_usd === null || row.monthly_usd > MENTION_CHECK_ADMIN_MAX_USD);
const stored = (projectId: string) => db().prepare('SELECT monthly_usd FROM brand_mention_settings WHERE project_id=?').bind(projectId).first<{ monthly_usd: number | null }>();

/**
 * Settings › Competitors (the agent curation's pattern): what the common-word brand checks may spend in this project
 * each month, what they spent, whether the limit is reached (the mentions waiting stay uncounted) and who may change it.
 */
export async function getMentionBudget(actor: Actor, projectId: unknown) {
  const id = String((await ownedProject(String(projectId ?? ''), actor.workspaceId)).id);
  const [row, budgets] = await Promise.all([stored(id), mentionBudgets([id])]);
  const platformCap = aboveWorkspace(row);
  return {
    ...budgets.get(id)!,
    defaultUsd: MENTION_CHECK_MONTHLY_USD,
    adminMaxUsd: MENTION_CHECK_ADMIN_MAX_USD,
    canSet: platformAdmin(actor) || (roleAtLeast(actor.role, 'admin') && !platformCap),
    canUnlimited: platformAdmin(actor),
    platformCap,
    // Without the key the questions are never asked: the rules decide and what they leave open counts (Settings says so).
    modelAvailable: !!decisionKeyConfigured(),
  };
}

/**
 * Sets the project's limit (workspace admins, and a platform admin in any workspace): US$ a month (0 stops the checks),
 * `null` for unlimited, or `"default"`. Unlimited and anything above MENTION_CHECK_ADMIN_MAX_USD need a platform admin, and
 * a limit a platform admin set that high only a platform admin changes.
 */
export async function setMentionBudget(actor: Actor, projectId: unknown, value: unknown) {
  const platform = platformAdmin(actor);
  if (!platform && !roleAtLeast(actor.role, 'admin')) throw new ApiError(403, 'Your role in this workspace does not allow this action.');
  const id = String((await ownedProject(String(projectId ?? ''), actor.workspaceId)).id);
  if (!platform && aboveWorkspace(await stored(id))) throw new ApiError(403, 'A Lastfind admin set this limit: only a Lastfind admin changes it.');
  if (value === 'default') await db().prepare('DELETE FROM brand_mention_settings WHERE project_id=?').bind(id).run();
  else {
    const cap = value === null ? null : Number(value);
    if (cap !== null && !(Number.isFinite(cap) && cap >= 0 && cap <= 100_000)) throw new ApiError(400, 'Enter an amount in US$, or 0 to stop the checks.');
    if ((cap === null || cap > MENTION_CHECK_ADMIN_MAX_USD) && !platform) throw new ApiError(403, 'Above US$ 10 a month, or unlimited, a Lastfind admin sets it.');
    await db()
      .prepare(
        `INSERT INTO brand_mention_settings(project_id,workspace_id,monthly_usd,updated_at,updated_by) VALUES(?,?,?,?,?)
         ON CONFLICT(project_id) DO UPDATE SET monthly_usd=excluded.monthly_usd,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
      )
      .bind(id, actor.workspaceId, cap === null ? null : Math.round(cap * 100) / 100, now(), actor.id)
      .run();
  }
  return getMentionBudget(actor, id);
}
