import { requireUser } from '@/lib/server/auth';
import {
  body,
  sameOrigin,
  json,
  fail,
  ApiError,
  textField,
} from '@/lib/server/http';
import { projectInput } from '@/lib/server/validation';
import { promptInput } from '@/lib/server/prompts';
import { db, now } from '@/lib/server/env';
import { startMonitoring } from '@/lib/server/monitor';
import { INTERVALS, nextRunTime } from '@/lib/scheduling';
import { capacityGuards } from '@/lib/server/capabilities';
import { syncTopics } from '@/lib/server/topics';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      data = await body(request);
    const id = textField(data.request_id, 'Identificador', 36, 36);
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new ApiError(400, 'Identificador inválido.');
    const p = projectInput(data),
      interval = Number(data.interval_hours ?? 24);
    if (!INTERVALS.includes(interval as 24))
      throw new ApiError(400, 'Frequência inválida.');
    if (
      !Array.isArray(data.prompts) ||
      !data.prompts.length ||
      data.prompts.length > 100
    )
      throw new ApiError(400, 'Selecione de 1 a 100 prompts.');
    const inputs = data.prompts.map((x) => {
      if (!x || typeof x !== 'object')
        throw new ApiError(400, 'Prompt inválido.');
      return promptInput(x, p.language);
    });
    const unique = [
      ...new Map(
        inputs.map((x) => [`${x.engine}:${x.text.toLowerCase()}`, x]),
      ).values(),
    ];
    const existing = await db()
      .prepare(
        'SELECT id FROM projects WHERE id=? AND owner_id=? AND archived=0',
      )
      .bind(id, u.id)
      .first();
    if (!existing) {
      await db().batch([
        db()
          .prepare(
            'INSERT OR IGNORE INTO projects(id,owner_id,name,domain,competitors_json,location_code,language_code,category,audience,daily_enabled,interval_hours,created_at) SELECT ?,?,?,?,?,?,?,?,?,1,?,?',
          )
          .bind(
            id,
            u.id,
            p.name,
            p.domain,
            JSON.stringify(p.competitors),
            p.location,
            p.language,
            p.category,
            p.audience,
            interval,
            now(),
          ),
        ...unique.map((x, i) =>
          db()
            .prepare(
              'INSERT OR IGNORE INTO prompts(id,project_id,text,engine,tag,tags_json,next_run_at,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=?)',
            )
            .bind(
              `${id}:${i}`,
              id,
              x.text,
              x.engine,
              x.tag,
              JSON.stringify(x.tags),
              nextRunTime(now()),
              now(),
              id,
              u.id,
            ),
        ),
        syncTopics(id, u.id),
        ...capacityGuards(u.id),
      ]);
      if (
        !(await db()
          .prepare('SELECT id FROM projects WHERE id=? AND owner_id=?')
          .bind(id, u.id)
          .first())
      )
        throw new ApiError(409, 'Não foi possível criar o projeto.');
    }
    const monitoring = await startMonitoring(u.id, id);
    return json({ id, monitoring }, 201);
  } catch (e) {
    return fail(e);
  }
}
