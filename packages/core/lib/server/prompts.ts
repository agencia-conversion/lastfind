import type { Engine } from '@/lib/engines';
import { db, now } from './env';
import { ownedProject } from './workspace';
import { ApiError, textField } from './http';
import { isEngine, ENGINES, ENGINE_META, ENGINE_LABELS } from '@/lib/engines';
import {
  accountCapabilities,
  capacityGuards,
  collectNewPromptsImmediately,
  promptEngineGuards,
} from './capabilities';
import { syncTopics } from './topics';
import { nextRunTime, nextWeeklyRunTime } from '@/lib/scheduling';
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
export function engineSelection(
  value: unknown,
  language: string,
  allowed: readonly string[],
): Engine[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > ENGINES.length ||
    value.some((engine) => !isEngine(engine))
  )
    throw new ApiError(400, 'Select at least one available AI model.');
  const engines = [...new Set(value)] as Engine[];
  if (engines.some((engine) => !allowed.includes(engine)))
    throw new ApiError(
      403,
      'This AI channel is not available for this account.',
    );
  if (language !== 'en' && engines.includes('gemini'))
    throw new ApiError(400, 'Gemini is available in English projects only.');
  return engines;
}
async function enginesFor(
  owner: string,
  project: Record<string, unknown>,
  topic: string,
  override: unknown,
  topicOverride?: string | null,
  retainedEngines: Engine[] = [],
) {
  const capabilities = await accountCapabilities(owner);
  const row = await db()
    .prepare(
      'SELECT engines_override_json FROM topics WHERE project_id=? AND name=?',
    )
    .bind(project.id, topic)
    .first<{ engines_override_json: string | null }>();
  return engineSelection(
    override ??
      JSON.parse(
        (topicOverride === undefined
          ? row?.engines_override_json
          : topicOverride) || String(project.engines_json || '["chat_gpt"]'),
      ),
    String(project.language_code),
    [...capabilities.engines, ...retainedEngines],
  );
}
function subscriptionInsert(
  projectId: string,
  unitId: string,
  id: string,
  input: ReturnType<typeof promptInput>,
  override: string | null,
  next: string,
  active = 1,
  archived = 0,
) {
  return db()
    .prepare(`INSERT INTO prompts(id,unit_id,project_id,text,engine,tag,tags_json,engines_override_json,next_run_at,active,archived,subscribed,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)`)
    .bind(
      id,
      unitId,
      projectId,
      input.text,
      input.engine,
      input.tag,
      JSON.stringify(input.tags),
      override,
      next,
      active,
      archived,
      now(),
    );
}
export async function addPrompts(
  owner: string,
  projectId: string,
  inputs: Record<string, unknown>[],
) {
  const project = await ownedProject(projectId, owner);
  if (!inputs.length || inputs.length > 100)
    throw new ApiError(400, 'Add between 1 and 100 questions.');
  const capabilities = await accountCapabilities(owner);
  const next =
    capabilities.promptLimit === 10
      ? nextWeeklyRunTime(now())
      : collectNewPromptsImmediately && Number(project.daily_enabled)
        ? now()
        : nextRunTime(now());
  const statements: D1PreparedStatement[] = [],
    ids: string[] = [];
  const seen = new Map<string, { id: string; engines: Set<Engine> }>();
  const existing = (
    await db()
      .prepare('SELECT * FROM prompts WHERE project_id=? AND archived=0')
      .bind(projectId)
      .all<Record<string, unknown>>()
  ).results;
  for (const row of existing) {
    const key = String(row.text).toLowerCase();
    const entry = seen.get(key) ?? {
      id: String(row.unit_id || row.id),
      engines: new Set<Engine>(),
    };
    if (row.subscribed !== 0) entry.engines.add(row.engine as Engine);
    seen.set(key, entry);
  }
  const inputMetadata = new Map<string, string>();
  for (const data of inputs) {
    const input = promptInput(data, String(project.language_code));
    const override =
      'engines' in data
        ? data.engines
        : 'engine' in data
          ? [data.engine]
          : null;
    const engines = await enginesFor(owner, project, input.tag, override);
    for (const engine of engines)
      promptInput({ ...input, engine }, String(project.language_code));
    const key = input.text.toLowerCase(),
      entry = seen.get(key);
    const metadata = JSON.stringify([input.tag, [...input.tags].sort()]);
    if (inputMetadata.has(key) && inputMetadata.get(key) !== metadata)
      throw new ApiError(
        409,
        'This question exists with different organization or state. Edit the existing question.',
      );
    inputMetadata.set(key, metadata);
    const previous = existing.find(
      (row) => String(row.unit_id || row.id) === entry?.id,
    );
    if (
      previous &&
      (previous.tag !== input.tag ||
        !previous.active ||
        JSON.stringify([...JSON.parse(String(previous.tags_json))].sort()) !==
          JSON.stringify([...input.tags].sort()))
    )
      throw new ApiError(
        409,
        'This question exists with different organization or state. Edit the existing question.',
      );
    const unitId = entry?.id ?? crypto.randomUUID();
    const selected = entry?.engines ?? new Set<Engine>();
    let added = false;
    for (const engine of engines)
      if (!selected.has(engine)) {
        const id = !entry && !added ? unitId : crypto.randomUUID();
        statements.push(
          subscriptionInsert(
            projectId,
            unitId,
            id,
            { ...input, engine },
            override === null
              ? null
              : JSON.stringify([...new Set([...selected, ...engines])]),
            next,
          ),
        );
        selected.add(engine);
        added = true;
      }
    if (added) {
      ids.push(unitId);
      if (entry)
        statements.push(
          db()
            .prepare(
              'UPDATE prompts SET engines_override_json=? WHERE project_id=? AND unit_id=?',
            )
            .bind(JSON.stringify([...selected]), projectId, unitId),
        );
    }
    seen.set(key, { id: unitId, engines: selected });
  }
  if (!ids.length) throw new ApiError(409, 'These questions already exist.');
  await db().batch([
    ...statements,
    syncTopics(projectId, owner),
    ...capacityGuards(owner),
  ]);
  const monitoring = await startMonitoring(owner, projectId);
  return {
    id: ids[0],
    ids: [...new Set(ids)],
    added: new Set(ids).size,
    skipped: inputs.length - new Set(ids).size,
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
  if (!p) throw new ApiError(404, 'Prompt not found.');
  return p;
}
export async function promptUpdateStatements(
  id: string,
  owner: string,
  data: Record<string, unknown>,
  projectOverride?: Record<string, unknown>,
  topicOverride?: string | null,
) {
  const authorized = await ownedPrompt(id, owner),
    project = projectOverride ?? (await ownedProject(String(authorized.project_id), owner));
  const unitId = String(authorized.unit_id || authorized.id);
  const rows = (
    await db()
      .prepare(
        'SELECT * FROM prompts WHERE project_id=? AND COALESCE(unit_id,id)=? ORDER BY subscribed DESC,archived,id',
      )
      .bind(authorized.project_id, unitId)
      .all<Record<string, unknown>>()
  ).results;
  // Derive the edit from the exact snapshot checked by the transaction guard.
  // The authorization read can precede a concurrent archive or engine edit.
  const current = rows.find((row) => row.id === authorized.id);
  if (!current) throw new ApiError(409, 'This question changed. Refresh and try again.');
  const p = { ...authorized, ...current };
  const input = promptInput(
    { ...p, tags: JSON.parse(String(p.tags_json)), ...data },
    String(p.language_code),
  );
  for (const key of ['active', 'archived'])
    if (key in data && typeof data[key] !== 'boolean')
      throw new ApiError(400, 'Invalid state.');
  const archived =
    'archived' in data ? Number(data.archived) : Number(p.archived);
  const active = archived
    ? 0
    : 'active' in data
      ? Number(data.active)
      : Number(p.active);
  const override =
    'engines' in data
      ? data.engines
      : 'engine' in data
        ? [data.engine]
        : JSON.parse(String(p.engines_override_json || 'null'));
  const engines =
    archived && !('engines' in data) && !('engine' in data)
      ? (JSON.parse(
          String(p.engines_override_json || JSON.stringify([...new Set(rows.filter((row) => row.subscribed !== 0).map((row) => row.engine))])),
        ) as Engine[])
      : await enginesFor(owner, project, input.tag, override, topicOverride,
          p.archived ? [] : rows.filter((row) => row.subscribed !== 0).map((row) => row.engine as Engine));
  if (!archived)
    for (const engine of engines)
      promptInput({ ...input, engine }, String(project.language_code));
  const duplicate = await db()
    .prepare(
      'SELECT id FROM prompts WHERE project_id=? AND COALESCE(unit_id,id)<>? AND archived=0 AND text=? COLLATE NOCASE LIMIT 1',
    )
    .bind(p.project_id, unitId, input.text)
    .first();
  if (!archived && duplicate)
    throw new ApiError(409, 'This question already exists.');
  const capabilities = await accountCapabilities(owner),
    next =
      capabilities.promptLimit === 10
        ? nextWeeklyRunTime(now())
        : nextRunTime(now());
  const changed =
    input.text !== p.text || (active && (!p.active || p.archived));
  const chosen = new Set<Engine>();
  const statements = rows.map((row) => {
    const subscribed =
      engines.includes(row.engine as Engine) &&
      !chosen.has(row.engine as Engine);
    if (subscribed) chosen.add(row.engine as Engine);
    return db()
      .prepare(
        'UPDATE prompts SET unit_id=?,text=?,tag=?,tags_json=?,engines_override_json=?,active=?,archived=?,subscribed=?,next_run_at=CASE WHEN ? THEN ? ELSE next_run_at END WHERE id=?',
      )
      .bind(
        unitId,
        input.text,
        input.tag,
        JSON.stringify(input.tags),
        override === null ? null : JSON.stringify(engines),
        active,
        archived,
        Number(subscribed),
        Number(Boolean(changed || (subscribed && !row.subscribed))),
        next,
        row.id,
      );
  });
  for (const engine of engines)
    if (!chosen.has(engine))
      statements.push(
        subscriptionInsert(
          String(p.project_id),
          unitId,
          crypto.randomUUID(),
          { ...input, engine },
          override === null ? null : JSON.stringify(engines),
          next,
          active,
          archived,
        ),
      );
  const existingTopic = await db().prepare(
    'SELECT id FROM topics WHERE project_id=? AND name=?',
  ).bind(p.project_id, input.tag).first();
  return {
    // Existing questions may be reduced after downgrade. New units/topics still
    // enforce their dimension atomically; engineSelection rejects new paid models.
    capacityChecks: { engines: !archived && Boolean(p.archived), prompts: !archived && Boolean(p.archived), topics: !archived && !existingTopic },
    projectId: String(p.project_id),
    statements: [
      db().prepare(`INSERT INTO prompt_mutation_checks(id,unchanged)
        SELECT ?,CASE WHEN (SELECT json_group_array(json_array(id,archived,subscribed,active,text,tag,tags_json,engines_override_json))
          FROM (SELECT * FROM prompts WHERE project_id=? AND COALESCE(unit_id,id)=? ORDER BY id))=? THEN 1 ELSE 0 END`)
        .bind(unitId, p.project_id, unitId, JSON.stringify([...rows].sort((a,b)=>String(a.id)<String(b.id)?-1:1)
          .map(row=>[row.id,row.archived,row.subscribed,row.active,row.text,row.tag,row.tags_json,row.engines_override_json]))),
      db().prepare('DELETE FROM prompt_mutation_checks WHERE id=?').bind(unitId),
      ...promptEngineGuards(owner, unitId, archived ? [] : engines, Boolean(p.archived)),
      db()
        .prepare(
          'UPDATE prompts SET subscribed=0 WHERE project_id=? AND COALESCE(unit_id,id)=?',
        )
        .bind(p.project_id, unitId),
      ...statements,
    ],
  };
}
export async function updatePrompt(
  id: string,
  owner: string,
  data: Record<string, unknown>,
) {
  const { projectId, statements, capacityChecks } = await promptUpdateStatements(
    id,
    owner,
    data,
  );
  await db().batch([
    ...statements,
    syncTopics(projectId, owner),
    ...capacityGuards(owner, capacityChecks),
  ]);
  await startMonitoring(owner, projectId);
  return { ok: true };
}
export async function reconcileInheritedPrompts(
  projectId: string,
  owner: string,
  topic?: string,
  projectOverride?: Record<string, unknown>,
  topicOverride?: string | null,
) {
  const rows = (
    await db()
      .prepare(
        'SELECT MIN(id) id FROM prompts WHERE project_id=? AND engines_override_json IS NULL' +
          (topic ? ' AND tag=?' : '') +
          ' GROUP BY COALESCE(unit_id,id)',
      )
      .bind(projectId, ...(topic ? [topic] : []))
      .all<{ id: string }>()
  ).results;
  const statements: D1PreparedStatement[] = [];
  for (const row of rows)
    statements.push(
      ...(
        await promptUpdateStatements(
          row.id,
          owner,
          { engines: null },
          projectOverride,
          topicOverride,
        )
      ).statements,
    );
  return statements;
}
