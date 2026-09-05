import { requireUser } from '@/lib/server/auth';
import { db, now } from '@/lib/server/env';
import { body, sameOrigin, json, fail, ApiError } from '@/lib/server/http';
import { projectInput } from '@/lib/server/validation';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      data = projectInput(await body(request)),
      id = crypto.randomUUID();
    const result = await db()
      .prepare(
        'INSERT INTO projects (id,owner_id,name,domain,competitors_json,location_code,language_code,category,audience,daily_enabled,created_at) SELECT ?,?,?,?,?,?,?,?,?,1,?',
      )
      .bind(
        id,
        u.id,
        data.name,
        data.domain,
        JSON.stringify(data.competitors),
        data.location,
        data.language,
        data.category,
        data.audience,
        now(),
      )
      .run();
    if (!result.meta.changes)
      throw new ApiError(409, 'Não foi possível criar o projeto.');
    return json({ id }, 201);
  } catch (e) {
    return fail(e);
  }
}
