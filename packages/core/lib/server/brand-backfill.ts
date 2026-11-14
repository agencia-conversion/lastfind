import { db } from './env';

/**
 * The brand backfill (per-question roles in brand-role-jobs.ts, domains in brand-domain-discovery.ts) runs only
 * once an operator authorized it (workflow mode `brand-roles-enable`): this row holds the ceiling of everything the
 * per-question ledger may reserve since `enabledAt`. Without it nothing of the backfill runs.
 */
export const QUESTION_ROLES_KEY = 'brand_question_roles';

export async function questionRolesAuthorization() {
  const row = await db().prepare('SELECT value FROM system_state WHERE key=?').bind(QUESTION_ROLES_KEY).first<{ value: string }>();
  try {
    const value = JSON.parse(row?.value ?? 'null') as { status?: unknown; ceilingUsd?: unknown; enabledAt?: unknown } | null;
    const ceilingUsd = Number(value?.ceilingUsd);
    return value?.status === 'enabled' && ceilingUsd > 0 && typeof value.enabledAt === 'string' ? { ceilingUsd, enabledAt: value.enabledAt } : null;
  } catch {
    return null;
  }
}
