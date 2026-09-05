import { db } from '@/lib/server/env';
import { collectRun } from '@/lib/server/monitor';
import { json, fail, ApiError } from '@/lib/server/http';
import { secureEqual } from '@/lib/server/secure-equal';
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const row = await db()
      .prepare('SELECT * FROM runs WHERE id=? AND provider_task_id=?')
      .bind(q.get('run') ?? '', q.get('id') ?? '')
      .first<Parameters<typeof collectRun>[0]>();
    if (!row || !secureEqual(row.callback_token, q.get('token') ?? ''))
      throw new ApiError(404, 'Coleta não encontrada.');
    if (row.status === 'pending') await collectRun(row, true);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
