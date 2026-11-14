import { requireActor } from '@/lib/server/auth';
import { db, now } from '@/lib/server/env';
import { body, sameOrigin, json, fail } from '@/lib/server/http';
import { projectInput } from '@/lib/server/validation';
import { storeProjectSlugs } from '@/lib/server/project-slugs';
import { PROJECT_LIMIT, projectCreationCondition } from '@/lib/server/capabilities';
import { DEFAULT_COLLECTION_DAY, DEFAULT_COLLECTION_HOUR, validTimeZone } from '@/lib/scheduling';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireActor({ role: 'admin' }),
      raw = await body(request),
      data = projectInput(raw),
      id = crypto.randomUUID();
    // The plan's projects (Cloud), in the same statement: two creations side by side cannot both pass it.
    const plan = projectCreationCondition(u.workspaceId);
    const [result] = await db().batch([
      db()
      .prepare(
        `INSERT INTO projects (id,workspace_id,name,domain,aliases_json,additional_domains_json,competitors_json,location_code,language_code,category,audience,daily_enabled,collection_hour,collection_day,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,1,?,?,? WHERE ${plan.sql}`,
      )
      .bind(
        id,
        u.workspaceId,
        data.name,
        data.domain,
        JSON.stringify(data.aliases),
        JSON.stringify(data.additionalDomains),
        JSON.stringify(data.competitors),
        data.location,
        data.language,
        data.category,
        data.audience,
        DEFAULT_COLLECTION_HOUR,
        DEFAULT_COLLECTION_DAY,
        now(),
        ...plan.params,
      ),
      // A workspace without a time zone (a new one) takes the browser's of the admin who creates its first project.
      ...(validTimeZone(raw.time_zone) ? [db().prepare('UPDATE workspaces SET time_zone=? WHERE id=? AND time_zone IS NULL').bind(raw.time_zone, u.workspaceId)] : []),
    ]);
    if (!result.meta.changes)
      throw new Error(PROJECT_LIMIT);
    await storeProjectSlugs(u.workspaceId, [{ id, name: data.name }]);
    return json({ id }, 201);
  } catch (e) {
    return fail(e);
  }
}
