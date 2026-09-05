import { db, now } from './env';
import { ownedProject } from './workspace';
import { ApiError, textField } from './http';
import { isEngine, ENGINE_META, ENGINE_LABELS } from '@/lib/engines';
import { accountCapabilities, capacityGuards } from './capabilities';
import { syncTopics } from './topics';
import { nextRunTime } from '@/lib/scheduling';
import { startMonitoring } from './monitor';
export function promptInput(data: Record<string, unknown>, language: string) {
  const text = textField(data.text, 'Prompt', 5, 1000);
  const engine = typeof data.engine === 'string' ? data.engine : 'chat_gpt';
  if (!isEngine(engine))
    throw new ApiError(400, 'Escolha uma plataforma de IA disponível.');
  if (text.length > ENGINE_META[engine].maxLength)
    throw new ApiError(
      400,
      `${ENGINE_LABELS[engine]} aceita até ${ENGINE_META[engine].maxLength} caracteres por prompt.`,
    );
  if (engine === 'gemini' && language !== 'en')
    throw new ApiError(
      400,
      'Gemini está disponível em projetos com idioma inglês.',
    );
  const tag = textField(data.tag || 'Geral', 'Tema', 1, 40);
  const raw = data.tags ?? [];
  if (!Array.isArray(raw) || raw.length > 8)
    throw new ApiError(400, 'Use até 8 tags por prompt.');
  const tags = [...new Set(raw.map((t) => textField(t, 'Tag', 1, 30)))];
  return { text, engine, tag, tags };
}
export async function addPrompts(
  owner: string,
  projectId: string,
  inputs: Record<string, unknown>[],
) {
  const project = await ownedProject(projectId, owner);
  if (!inputs.length || inputs.length > 100)
    throw new ApiError(400, 'Adicione entre 1 e 100 prompts por vez.');
  const capabilities = await accountCapabilities(owner);
  const prompts = inputs.map((p) => ({
    ...promptInput(p, String(project.language_code)),
    id: crypto.randomUUID(),
  }));
  if (prompts.some((p) => !capabilities.engines.includes(p.engine)))
    throw new ApiError(
      403,
      'This AI channel is not available for this account.',
    );
  const results = await db().batch([
    ...prompts.map((p) =>
      db()
        .prepare(
          `INSERT INTO prompts(id,project_id,text,engine,tag,tags_json,next_run_at,created_at)
     SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM prompts WHERE project_id=? AND text=? COLLATE NOCASE AND engine=? AND archived=0)`,
        )
        .bind(
          p.id,
          projectId,
          p.text,
          p.engine,
          p.tag,
          JSON.stringify(p.tags),
          nextRunTime(now()),
          now(),
          projectId,
          p.text,
          p.engine,
        ),
    ),
    syncTopics(projectId, owner),
    ...capacityGuards(owner),
  ]);
  const ids = prompts
    .filter((_, i) => results[i].meta.changes)
    .map((p) => p.id);
  if (!ids.length)
    throw new ApiError(
      409,
      'Os prompts já existem ou o limite do projeto foi atingido.',
    );
  // Provider failures are recorded on the durable runs and never undo saved prompts.
  const monitoring = await startMonitoring(owner, projectId);
  return {
    id: ids[0],
    ids,
    added: ids.length,
    skipped: inputs.length - ids.length,
    monitoring,
  };
}
export async function ownedPrompt(id: string, owner: string) {
  const p = await db()
    .prepare(
      'SELECT prompts.*,projects.language_code,projects.owner_id FROM prompts JOIN projects ON projects.id=prompts.project_id WHERE prompts.id=? AND projects.owner_id=? AND projects.archived=0',
    )
    .bind(id, owner)
    .first<Record<string, unknown>>();
  if (!p) throw new ApiError(404, 'Prompt não encontrado.');
  return p;
}
export async function updatePrompt(
  id: string,
  owner: string,
  data: Record<string, unknown>,
) {
  const p = await ownedPrompt(id, owner);
  const input = promptInput(
    { ...p, tags: JSON.parse(String(p.tags_json)), ...data },
    String(p.language_code),
  );
  for (const key of ['active', 'archived'])
    if (key in data && typeof data[key] !== 'boolean')
      throw new ApiError(400, 'Estado inválido.');
  const archived =
    'archived' in data ? Number(data.archived) : Number(p.archived);
  const active = archived
    ? 0
    : 'active' in data
      ? Number(data.active)
      : Number(p.active);
  const changed =
    input.text !== p.text ||
    input.engine !== p.engine ||
    (active && (!p.active || p.archived));
  const [result] = await db().batch([
    db()
      .prepare(
        `UPDATE prompts SET text=?,engine=?,tag=?,tags_json=?,active=?,archived=?,next_run_at=? WHERE id=?
     AND (?=1 OR (NOT EXISTS(SELECT 1 FROM prompts other WHERE other.project_id=? AND other.id<>? AND other.archived=0 AND other.text=? COLLATE NOCASE AND other.engine=?)))`,
      )
      .bind(
        input.text,
        input.engine,
        input.tag,
        JSON.stringify(input.tags),
        active,
        archived,
        changed ? nextRunTime(now()) : p.next_run_at,
        id,
        archived,
        p.project_id,
        id,
        input.text,
        input.engine,
      ),
    syncTopics(String(p.project_id), owner),
    ...(!archived ? capacityGuards(owner) : []),
  ]);
  if (!result.meta.changes)
    throw new ApiError(
      409,
      'This prompt already exists or the account capacity was reached.',
    );
  await startMonitoring(owner, String(p.project_id));
  return { ok: true };
}
