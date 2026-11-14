import { requireActor } from '@/lib/server/auth';
import { getMentionBudget, setMentionBudget } from '@/lib/server/brand-mention-budget';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

type Context = { params: Promise<{ id: string }> };

// What the common-word brand checks may spend in this project each month (Settings › Competitors):
// GET                                             → { cap, custom, spent, dailyUsd, daysLeft, exhausted, alarm, pending, defaultUsd, adminMaxUsd, canSet, canUnlimited, platformCap }
// PUT { monthly_usd: number | null | "default" }  → the same (workspace admins; null is unlimited, a platform admin's)
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await requireActor();
    return json(await getMentionBudget(actor, (await params).id));
  } catch (error) {
    return fail(error);
  }
}
export async function PUT(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true });
    const data = await body(request);
    return json(await setMentionBudget(actor, (await params).id, data.monthly_usd));
  } catch (error) {
    return fail(error);
  }
}
