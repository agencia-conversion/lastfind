import { readTopicWeights } from '@/lib/topic-weights';
import { promptUnits } from '@/lib/prompt-units';
import { storeProjectSlugs } from './project-slugs';
import {
  type Topic,
  type Project,
  type Prompt,
  type Run,
  type Workspace,
} from '@/lib/types';
import { BLOCKED_FRESH_MS, BLOCKED_PREFIX } from '@/lib/platform-spend';
import { SCRAPED_ENGINES, type Engine } from '@/lib/engines';
import { db, setting } from './env';
import { foundProject, ownedProjectStatement } from './project-reads';
import { USAGE_CREDITS_SQL } from '@/lib/reservations';
import { nextCollection, scheduleOf } from '@/lib/scheduling';
import {
  accountCapabilities,
  usageWindow,
  providerSettings,
  collectNewPromptsImmediately,
  projectCreationCondition,
} from './capabilities';
import type { User } from './auth';
import { decisionKeyConfigured } from './model-routes';
/** A limit that stopped this project's collection in the last hours, so the Overview says it (never a silent gap). */
function collectionBlock(value: string | null | undefined) {
  try {
    const block = value ? (JSON.parse(value) as { reason?: string; module?: string; at?: string }) : null;
    if (!block || block.module !== 'collection' || !block.at || Date.now() - Date.parse(block.at) > BLOCKED_FRESH_MS) return null;
    return { reason: String(block.reason ?? 'operation'), at: block.at };
  } catch {
    return null;
  }
}

export async function ownedProject(id: string, userId: string): Promise<Record<string, unknown>> {
  return foundProject(await ownedProjectStatement(id, userId).first<Record<string, unknown>>());
}
/** Only the AIs collected today: one switched off (Claude, Perplexity, 8/11/2026) never reaches a screen, though it stays stored. */
const collected = <T,>(engines: T[]) => engines.filter((engine) => SCRAPED_ENGINES.includes(engine as Engine));
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
    engines: collected(JSON.parse(String(p.engines_json || '["chat_gpt"]'))),
    daily_enabled: Number(p.daily_enabled),
    interval_hours: Number(p.interval_hours),
    collection_hour: scheduleOf(p).hour,
    collection_day: scheduleOf(p).day,
    category: typeof p.category === 'string' ? p.category : '',
    audience: typeof p.audience === 'string' ? p.audience : '',
    created_at: String(p.created_at),
    ...(p.slug ? { slug: String(p.slug) } : {}),
    display_name: typeof p.display_name === 'string' && p.display_name ? p.display_name : null,
    agent_content_mode: p.agent_content_mode === 'wizard' || p.agent_content_mode === 'chat' ? p.agent_content_mode : null,
    raw_retention_days: p.raw_retention_days === null || p.raw_retention_days === undefined ? null : Number(p.raw_retention_days),
    topic_weights: ((weights) => (weights ? Object.fromEntries(weights) : null))(readTopicWeights(p.topic_weights_json)),
  };
}
export { runFromRow } from './run-rows';
export async function workspace(
  user: User,
  selected?: string | null,
  /** `only`: read the project whose id is `selected` alone, never the rest of the account's (the public demo). */
  { only = false }: { only?: boolean } = {},
): Promise<Workspace> {
  const database = db();
  // The project list, the selected project's prompts, topics and activity, the capacity and the scheduler's heartbeat
  // are one D1 round trip (a call costs ~150-250 ms in production, and parallel calls queue behind the connection limit).
  // The selected project (or the first one, as below) is resolved inside SQL, so its reads ride in the same trip.
  // The address names the project by its slug (the app's own reads, by its id); without a name ('') it is the first project.
  // A name that matches none (a typo, an archived or another workspace's project) selects none, never the first.
  const selectedProject = "(SELECT id FROM projects WHERE workspace_id=? AND archived=0 AND ? IN (id,slug,'') ORDER BY created_at LIMIT 1)";
  const projectReads = (id: string) => [
    database
      .prepare(`SELECT * FROM prompts WHERE project_id=${selectedProject} ORDER BY created_at DESC`)
      .bind(user.id, id),
    database
      .prepare(`SELECT id,project_id,name,engines_override_json FROM topics WHERE project_id=${selectedProject} ORDER BY name`)
      .bind(user.id, id),
    database
      .prepare(`SELECT (SELECT COUNT(*) FROM runs WHERE project_id=${selectedProject} AND status IN ('queued','submitting','pending')) pending,
      (SELECT MAX(completed_at) FROM runs WHERE project_id=${selectedProject} AND status='complete') last,
      (SELECT value FROM system_state WHERE key='${BLOCKED_PREFIX}'||${selectedProject}) blocked,
      (SELECT COUNT(*) FROM project_stores WHERE project_id=${selectedProject} AND (initialized=0 OR source_revision<>applied_revision)) unpublished`)
      .bind(user.id, id, user.id, id, user.id, id, user.id, id),
  ];
  // The month's usage is counted from the account's window. That is the calendar month unless a paid period says otherwise:
  // the calendar month's count rides in the batch, and only another window is counted once it is known.
  const usageStatement = (start: string) =>
    database
      // The account's collection credits (the agent spends a balance of its own, shown in the chat).
      .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(${USAGE_CREDITS_SQL}),0) AS credits FROM runs WHERE workspace_id=? AND created_at>=?`)
      .bind(user.id, start);
  const calendarMonth = `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
  const windowRead = usageWindow(user.id);
  windowRead.catch(() => {});
  // Whether the plan has room for another project (the edition's own condition, the one creating a project checks).
  const projectRoom = projectCreationCondition(user.id);
  const [capabilities, [capacityRead, projectRows, heartbeatRead, monthRead, ...firstReads]] = await Promise.all([
    accountCapabilities(user.id),
    database.batch<Record<string, unknown>>([
      database.prepare(`SELECT (SELECT COUNT(DISTINCT COALESCE(q.unit_id,q.id)) FROM prompts q JOIN projects p ON p.id=q.project_id WHERE p.workspace_id=? AND p.archived=0 AND q.archived=0) AS prompts, (SELECT COUNT(*) FROM topics t JOIN projects p ON p.id=t.project_id WHERE p.workspace_id=? AND p.archived=0) AS topics, (SELECT time_zone FROM workspaces WHERE id=?) AS time_zone, CASE WHEN ${projectRoom.sql} THEN 1 ELSE 0 END AS project_room`).bind(user.id, user.id, user.id, ...projectRoom.params),
      // With `only`, the other projects of the account are never read.
      only
        ? database.prepare('SELECT * FROM projects WHERE workspace_id=? AND archived=0 AND id=?').bind(user.id, selected ?? '')
        : database.prepare('SELECT * FROM projects WHERE workspace_id=? AND archived=0 ORDER BY created_at').bind(user.id),
      database.prepare("SELECT value FROM system_state WHERE key='scheduler_heartbeat'"),
      usageStatement(calendarMonth),
      ...projectReads(selected ?? ''),
    ]),
  ]);
  const capacity = capacityRead.results[0] as { prompts: number; topics: number; time_zone: string | null; project_room: number } | undefined;
  const heartbeat = heartbeatRead.results[0] as { value: string } | undefined;
  const projects = projectRows.results.map(projectFromRow);
  await storeProjectSlugs(user.id, projects);
  // The project the address names (its slug, or its id): resolved here, it saves the client a second workspace request. A
  // name that matches no project selects none (the app says "Project not found"); no name is the first project.
  const projectId = (selected ? projects.find((p) => p.id === selected || p.slug === selected) : projects[0])?.id ?? null;
  let topics: Topic[] = [];
  let prompts: Prompt[] = [];
  const runs: Run[] = [];
  let monitoring: Workspace['monitoring'] = { pending: 0, last: null };
  if (projectId) {
    // SQL picked the same project the first wave read (same names, same order).
    const [p, t, activityRead] = firstReads;
    const activity = activityRead.results[0] as { pending: number; last: string | null; blocked?: string | null; unpublished?: number } | undefined;
    topics = (t.results as unknown as Topic[]).map((topic) => ({ ...topic, engines_override: ((engines: Engine[] | null) => engines && collected(engines))(JSON.parse(String((topic as unknown as Record<string, unknown>).engines_override_json || 'null'))) }));
    prompts = promptUnits(p.results.map((row) => ({
      ...row,
      tags: JSON.parse(String(row.tags_json)),
    })) as unknown as Prompt[]).map((prompt) => ({ id: prompt.id, unit_id: prompt.unit_id, project_id: prompt.project_id, text: prompt.text, engine: collected(prompt.engines ?? [])[0] ?? prompt.engine, engines: prompt.engines && collected(prompt.engines), engines_override: prompt.engines_override && collected(prompt.engines_override), subscription_ids: prompt.subscription_ids, tag: prompt.tag, tags: prompt.tags, active: prompt.active, archived: prompt.archived, next_run_at: prompt.next_run_at, created_at: prompt.created_at }));

    monitoring = activity ? { pending: activity.pending, last: activity.last, unpublished: !!activity.unpublished, collectionBlocked: collectionBlock(activity.blocked) } : monitoring;
  }
  const limits = await windowRead;
  const usage =
    limits.periodStart === calendarMonth
      ? (monthRead.results[0] as { total: number; credits: number } | undefined)
      : await usageStatement(limits.periodStart).first<{ total: number; credits: number }>();
  return {
    user: { email: user.email, name: user.name },
    projects,
    prompts,
    topics,
    capabilities,
    capacity: { prompts: capacity?.prompts ?? 0, topics: capacity?.topics ?? 0, projectsFull: capacity?.project_room === 0 },
    timeZone: capacity?.time_zone ?? null,
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
      // Only the independent edition, whose owner holds the keys, reads it (Settings > Monitoring).
      ...(providerSettings ? { openrouter: !!decisionKeyConfigured() } : {}),
      scheduling:
        !!heartbeat && Date.now() - Date.parse(heartbeat.value) < 60 * 60000,
      schedulerLastSeen: heartbeat?.value ?? null,
      providerSettings,
      collectsNow: collectNewPromptsImmediately,
    },
  };
}

/**
 * A workspace admin sets the workspace's time zone (Settings > Monitoring > Collection schedule): every project keeps its day and
 * hour, now read in the new zone, so each prompt not due yet moves to its project's next slot there.
 */
export async function setWorkspaceZone(workspaceId: string, zone: string) {
  const database = db();
  const [capabilities, projects] = await Promise.all([
    accountCapabilities(workspaceId),
    database.prepare('SELECT id,interval_hours,collection_hour,collection_day FROM projects WHERE workspace_id=? AND archived=0').bind(workspaceId).all<Record<string, unknown>>(),
  ]);
  const stamp = new Date().toISOString();
  await database.batch([
    database.prepare('UPDATE workspaces SET time_zone=? WHERE id=?').bind(zone, workspaceId),
    ...projects.results.map((project) =>
      database
        .prepare('UPDATE prompts SET next_run_at=CASE WHEN next_run_at<=? THEN next_run_at ELSE ? END WHERE project_id=? AND archived=0')
        .bind(stamp, nextCollection(stamp, scheduleOf(project, !!capabilities.free, zone)), String(project.id))),
  ]);
}
