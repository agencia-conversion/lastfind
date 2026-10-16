import { promptUnits } from '@/lib/prompt-units';
import {
  type Topic,
  type Project,
  type Prompt,
  type Run,
  type Workspace,
} from '@/lib/types';
import { db, setting } from './env';
import { ApiError } from './http';
import { USAGE_CREDITS_SQL } from '@/lib/reservations';
import {
  accountCapabilities,
  usageWindow,
  providerSettings,
} from './capabilities';
import type { User } from './auth';
export async function ownedProject(id: string, userId: string) {
  const p = await db()
    .prepare('SELECT * FROM projects WHERE id=? AND owner_id=? AND archived=0')
    .bind(id, userId)
    .first<Record<string, unknown>>();
  if (!p) throw new ApiError(404, 'Projeto não encontrado.');
  return p;
}
export function projectFromRow(p: Record<string, unknown>): Project {
  return {
    id: String(p.id),
    name: String(p.name),
    domain: String(p.domain),
    aliases: JSON.parse(String(p.aliases_json || '[]')),
    additional_domains: JSON.parse(String(p.additional_domains_json || '[]')),
    competitors: JSON.parse(String(p.competitors_json)),
    location_code: Number(p.location_code),
    language_code: String(p.language_code),
    engines: JSON.parse(String(p.engines_json || '["chat_gpt"]')),
    daily_enabled: Number(p.daily_enabled),
    interval_hours: Number(p.interval_hours),
    category: typeof p.category === 'string' ? p.category : '',
    audience: typeof p.audience === 'string' ? p.audience : '',
    created_at: String(p.created_at),
  };
}
export { runFromRow } from './run-rows';
export async function workspace(
  user: User,
  selected?: string | null,
): Promise<Workspace> {
  const database = db();
  const capacityStatement = database.prepare(`SELECT (SELECT COUNT(DISTINCT COALESCE(q.unit_id,q.id)) FROM prompts q JOIN projects p ON p.id=q.project_id WHERE p.owner_id=? AND p.archived=0 AND q.archived=0) AS prompts, (SELECT COUNT(*) FROM topics t JOIN projects p ON p.id=t.project_id WHERE p.owner_id=? AND p.archived=0) AS topics`).bind(user.id,user.id);
  const [limits, capabilities, capacity, projectRows, heartbeat] = await Promise.all([usageWindow(user.id), accountCapabilities(user.id), capacityStatement.first<{ prompts: number; topics: number }>(),
    database
      .prepare(
        'SELECT * FROM projects WHERE owner_id=? AND archived=0 ORDER BY created_at',
      )
      .bind(user.id)
      .all<Record<string, unknown>>(),
    database
      .prepare("SELECT value FROM system_state WHERE key='scheduler_heartbeat'")
      .first<{ value: string }>(),
  ]);
  const usagePromise = database
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(${USAGE_CREDITS_SQL}),0) AS credits FROM runs WHERE owner_id=? AND created_at>=?`,
      )
      .bind(user.id, limits.periodStart)
      .first<{ total: number; credits: number }>();
  const projects = projectRows.results.map(projectFromRow);
  const projectId = projects.some((p) => p.id === selected)
    ? selected!
    : (projects[0]?.id ?? null);
  let topics: Topic[] = [];
  let prompts: Prompt[] = [];
  const runs: Run[] = [];
  let monitoring: Workspace['monitoring'] = { pending: 0, last: null };
  if (projectId) {
    const [p, t, activity] = await Promise.all([
      database
        .prepare(
          'SELECT * FROM prompts WHERE project_id=? ORDER BY created_at DESC',
        )
        .bind(projectId)
        .all<Record<string, unknown>>(),
      database
        .prepare(
          'SELECT id,project_id,name,engines_override_json FROM topics WHERE project_id=? ORDER BY name',
        )
        .bind(projectId)
        .all<Topic>(),
      database
        .prepare(`SELECT (SELECT COUNT(*) FROM runs WHERE project_id=? AND status IN ('queued','submitting','pending')) pending,
        (SELECT MAX(completed_at) FROM runs WHERE project_id=? AND status='complete') last`)
        .bind(projectId, projectId)
        .first<{ pending: number; last: string | null }>(),
    ]);
    topics = t.results.map((topic) => ({ ...topic, engines_override: JSON.parse(String((topic as unknown as Record<string, unknown>).engines_override_json || 'null')) }));
    prompts = promptUnits(p.results.map((row) => ({
      ...row,
      tags: JSON.parse(String(row.tags_json)),
    })) as unknown as Prompt[]).map((prompt) => ({ id: prompt.id, unit_id: prompt.unit_id, project_id: prompt.project_id, text: prompt.text, engine: prompt.engine, engines: prompt.engines, engines_override: prompt.engines_override, subscription_ids: prompt.subscription_ids, tag: prompt.tag, tags: prompt.tags, active: prompt.active, archived: prompt.archived, next_run_at: prompt.next_run_at, created_at: prompt.created_at }));

    monitoring = activity ?? monitoring;
  }
  const usage = await usagePromise;
  return {
    user: { email: user.email, name: user.name },
    projects,
    prompts,
    topics,
    capabilities,
    capacity: capacity ?? { prompts: 0, topics: 0 },
    runs,
    monitoring,
    selectedProjectId: projectId,
    usage: {
      used: usage?.total ?? 0,
      creditsUsed: usage?.credits ?? 0,
      creditsLimit: limits.creditsLimit,
      limit: limits.limit,
      period: limits.periodStart.slice(0, 10),
    },
    config: {
      dataforseo: !!(
        setting('DATAFORSEO_LOGIN') && setting('DATAFORSEO_PASSWORD')
      ),
      scheduling:
        !!heartbeat && Date.now() - Date.parse(heartbeat.value) < 60 * 60000,
      schedulerLastSeen: heartbeat?.value ?? null,
      providerSettings,
    },
  };
}
