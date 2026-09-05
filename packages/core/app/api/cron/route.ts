import { setting } from '@/lib/server/env';
import { tick } from '@/lib/server/monitor';
import { json, fail, ApiError } from '@/lib/server/http';
import { secureEqual } from '@/lib/server/secure-equal';
export async function POST(request: Request) {
  try {
    const secret = setting('CRON_SECRET');
    if (
      secret.length < 32 ||
      !secureEqual(
        request.headers.get('authorization') ?? '',
        `Bearer ${secret}`,
      )
    )
      throw new ApiError(401, 'Acesso negado.');
    return json(await tick());
  } catch (e) {
    return fail(e);
  }
}
