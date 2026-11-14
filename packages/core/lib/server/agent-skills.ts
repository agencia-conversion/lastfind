// The agent's skills, in the Agent Skills format: packages/core/agent-skills/<name>/SKILL.md and the files beside it (its
// references), bundled at build time: Lastfind's own (see agent-skills/LICENSE for which are adapted from the Agentic SEO
// Skills plugin, MIT, and which are Lastfind's, AGPL-3.0-only), plus the skills each workspace writes or changes, kept in
// D1 (`agent_skills`, their versions in `agent_artifact_versions`). Think lists the active ones (name and description) to
// the model, which activates one when a task matches it. A skill is never made from one message: a person writes one, or
// the skill curator learns one from the same kind of work repeated across conversations (learnSkill). The agent improves
// one when the person corrects how it was done; a change learned in a turn that read third-party content waits for a
// person (a proposal), every other applies at once and can be restored. Lifecycle: draft, active, off, merged.
import { manifest, type SkillSource } from 'agents/skills';
import { db, now } from './env';
import { ApiError } from './http';
import { roleAtLeast, type Actor } from './auth';
import { keepVersion, learnedRefusal, listVersions, projectNames, restoreVersion, writeContent, type Changed, type Learner } from './agent';
import {
  AGENT_SKILLS_MAX,
  BUILTIN_SKILL_TITLES,
  SKILL_BODY_MAX,
  SKILL_CHECKS,
  SKILL_CLUSTER_MIN,
  SKILL_UNUSED_DAYS,
  addedBy,
  automatic,
  changedLines,
  checkSkillText,
  foreignRun,
  parseSkill,
  scanText,
  skillTemplate,
  skillText,
  skillTitle,
  type ParsedSkill,
  type SkillOp,
  type SkillStatus,
  type SkillStatusReason,
} from '@/lib/agent-learning';
import type { Json } from './mcp-tools';

type Entry = ParsedSkill & { resources: { path: string; content: string }[] };

/** Skill entries from bundled files (path to text); a SKILL.md without a name or a description is left out. */
export function skillEntries(files: Record<string, string>): Entry[] {
  const entries = new Map<string, Entry>();
  for (const [path, text] of Object.entries(files)) {
    const match = /agent-skills\/([a-z0-9-]+)\/SKILL\.md$/.exec(path);
    const parsed = match && parseSkill(text);
    if (match && parsed) entries.set(match[1], { ...parsed, name: parsed.name || match[1], resources: [] });
  }
  for (const [path, content] of Object.entries(files)) {
    const match = /agent-skills\/([a-z0-9-]+)\/(?!SKILL\.md$)(.+)$/.exec(path);
    if (match) entries.get(match[1])?.resources.push({ path: match[2], content });
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const AGENT_SKILLS = skillEntries(import.meta.glob('../../agent-skills/**/*.md', { query: '?raw', import: 'default', eager: true }));
const BUNDLED = new Map(AGENT_SKILLS.map((entry) => [entry.name, entry]));
/** Names a team skill never takes: Lastfind's, and the ones planned for it. */
const RESERVED = new Set([...BUNDLED.keys(), ...Object.keys(BUILTIN_SKILL_TITLES), 'content-writing']);
const bundleText = (entry: Entry) => skillText(entry);
/** A short fingerprint of a text (whether Lastfind's skill changed since the workspace edited it). */
const textHash = (text: string) => {
  let a = 2166136261;
  let b = 16777619;
  for (let index = 0; index < text.length; index++) {
    a = Math.imul(a ^ text.charCodeAt(index), 16777619);
    b = Math.imul(b ^ text.charCodeAt(index), 2166136261);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
};

/** A change the agent proposes that waits for a person (it learned it from a conversation that read third-party content). */
type Proposal = { content: string; version: number; author: string; conversation_id: string | null; why: string; at: string };
type Row = {
  id: string;
  name: string;
  title: string;
  content: string;
  origin: 'builtin' | 'user' | 'agent';
  base_hash: string | null;
  enabled: number;
  status: SkillStatus;
  status_reason: SkillStatusReason | null;
  merged_into: string | null;
  proposal: string | null;
  locked: number;
  version: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
  last_author: string | null;
};
const proposalOf = (row: Pick<Row, 'proposal'> | null): Proposal | null => {
  try {
    return row?.proposal ? (JSON.parse(row.proposal) as Proposal) : null;
  } catch {
    return null;
  }
};
const rows = async (workspaceId: string) =>
  (
    await db()
      .prepare(
        `SELECT id,name,title,content,origin,base_hash,enabled,status,status_reason,merged_into,proposal,locked,version,updated_by,updated_at,created_at,
         (SELECT author FROM agent_artifact_versions v WHERE v.artifact_id=agent_skills.id ORDER BY version DESC LIMIT 1) last_author
         FROM agent_skills WHERE workspace_id=? AND deleted_at IS NULL ORDER BY name`,
      )
      .bind(workspaceId)
      .all<Row>()
  ).results;

/** What the agent reads: the active skills, Lastfind's (the workspace's copy when it changed one; one it turned off left out) and the team's. */
export function mergedSkills(list: Row[]) {
  const byName = new Map(list.map((row) => [row.name, row]));
  const out: (Entry & { revision: number | null })[] = [];
  for (const entry of AGENT_SKILLS) {
    // A team skill that took a name Lastfind uses later never replaces Lastfind's: only the workspace's copy of it does.
    const row = byName.get(entry.name)?.origin === 'builtin' ? byName.get(entry.name)! : null;
    if (row && row.status !== 'active') continue;
    const parsed = row ? parseSkill(row.content) : null;
    out.push(parsed ? { ...parsed, license: entry.license, resources: entry.resources, revision: row!.version } : { ...entry, revision: null });
  }
  for (const row of list) {
    if (row.origin === 'builtin' || BUNDLED.has(row.name) || row.status !== 'active') continue;
    const parsed = parseSkill(row.content);
    if (parsed) out.push({ ...parsed, resources: [], revision: row.version });
  }
  return out;
}

const within = <T>(promise: Promise<T>, ms = 2_000) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The skills took too long to read.')), ms))]);

/**
 * The skills of a conversation's workspace, as one Think source (listed again before every turn, so a skill saved in a
 * conversation is there from its next turn). `versions`: the version of each skill the last listing served. A slow or
 * failed read keeps the last listing (Lastfind's skills at first).
 */
export function workspaceSkills(conversation: () => string): SkillSource & { versions: Map<string, number | null>; catalog: { name: string; description: string }[] } {
  let owner: string | null = null;
  let current = manifest({ id: 'lastfind', skills: AGENT_SKILLS });
  const versions = new Map<string, number | null>();
  const describe = (skills: readonly Entry[]) => skills.map(({ name, description }) => ({ name, description }));
  // What the model reads to choose a skill (its name and description; the rest only once activated): the turn's instructions
  // carry it, as Think's own catalog block gives way to them.
  const source = {
    id: 'lastfind',
    versions,
    catalog: describe(AGENT_SKILLS),
    async list() {
      try {
        owner ??= (await within(db().prepare('SELECT workspace_id FROM agent_conversations WHERE id=?').bind(conversation()).first<{ workspace_id: string }>()))?.workspace_id ?? null;
        const merged = mergedSkills(owner ? await within(rows(owner)) : []);
        current = manifest({ id: 'lastfind', skills: merged.map(({ revision: _revision, ...skill }) => skill) });
        versions.clear();
        for (const skill of merged) versions.set(skill.name, skill.revision);
        source.catalog = describe(merged);
      } catch (error) {
        console.warn('Lastfind skills: kept the last listing.', error instanceof Error ? error.message.slice(0, 120) : 'Unknown error');
      }
      return current.list();
    },
    readResource: ((skill, path) => current.readResource(skill, path)) as SkillSource['readResource'],
  };
  return source;
}

// ---------------------------------------------------------------- the workspace's skills

const member = (actor: Actor) => {
  if (!roleAtLeast(actor.role, 'member')) throw new ApiError(403, 'Your role in this workspace does not allow this action.');
};
const readRow = (workspaceId: string, name: string) => db().prepare('SELECT * FROM agent_skills WHERE workspace_id=? AND name=? AND deleted_at IS NULL').bind(workspaceId, name).first<Row>();
const teamCount = async (workspaceId: string) =>
  Number((await db().prepare("SELECT COUNT(*) n FROM agent_skills WHERE workspace_id=? AND origin<>'builtin' AND status='active' AND deleted_at IS NULL").bind(workspaceId).first<{ n: number }>())?.n ?? 0);
/** A skill's status, with `enabled` kept in step (the code before the lifecycle reads it). */
const setStatus = (id: string, status: SkillStatus, reason: SkillStatusReason | null, mergedInto: string | null = null) =>
  db().prepare('UPDATE agent_skills SET status=?,status_reason=?,merged_into=?,enabled=?,updated_at=? WHERE id=?').bind(status, reason, mergedInto, status === 'active' ? 1 : 0, now(), id);

/** A new row with its first version (`author`); a built-in's copy starts from Lastfind's text, by `lastfind`. */
async function insertSkill(
  workspaceId: string,
  skill: { name: string; title: string; content: string; origin: Row['origin']; author: string; conversationId: string | null; baseHash?: string; status?: SkillStatus; reason?: SkillStatusReason | null },
) {
  const id = crypto.randomUUID();
  const at = now();
  const status = skill.status ?? 'active';
  const made = await db()
    .prepare(
      `INSERT INTO agent_skills(id,workspace_id,name,title,content,origin,base_hash,enabled,status,status_reason,locked,version,updated_by,created_at,updated_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,0,1,?,?,? WHERE NOT EXISTS (SELECT 1 FROM agent_skills WHERE workspace_id=? AND name=? AND deleted_at IS NULL)`,
    )
    .bind(id, workspaceId, skill.name, skill.title, skill.content, skill.origin, skill.baseHash ?? null, status === 'active' ? 1 : 0, status, skill.reason ?? null, skill.author, at, at, workspaceId, skill.name)
    .run();
  if (made.meta.changes) await keepVersion(id, 1, { title: skill.title, content: skill.content, author: skill.author, conversationId: skill.conversationId }, at, 0);
  return readRow(workspaceId, skill.name);
}
/** The workspace's copy of a Lastfind skill (made the first time it is changed, its version 1 Lastfind's text). */
async function copyOf(workspaceId: string, name: string) {
  const row = await readRow(workspaceId, name);
  if (row) return row;
  const entry = BUNDLED.get(name);
  if (!entry) return null;
  const text = bundleText(entry);
  return insertSkill(workspaceId, { name, title: BUILTIN_SKILL_TITLES[name]?.[0] ?? name, content: text, origin: 'builtin', author: 'lastfind', conversationId: null, baseHash: textHash(text) });
}

const DAY_MS = 86_400_000;
/** Per skill: uses in the last 30 days, the ratings of those answers, the projects that used it, and its last use ever. */
async function skillStats(workspaceId: string) {
  const { results } = await db()
    .prepare(
      `SELECT u.skill,COUNT(DISTINCT CASE WHEN u.created_at>=?1 THEN u.conversation_id||':'||u.message_id END) uses,
       COALESCE(SUM(u.created_at>=?1 AND f.rating=1),0) up,COALESCE(SUM(u.created_at>=?1 AND f.rating=-1),0) down,
       COUNT(DISTINCT CASE WHEN u.created_at>=?1 THEN u.project_id END) projects,MAX(u.created_at) last_used
       FROM agent_skill_uses u LEFT JOIN agent_feedback f ON f.conversation_id=u.conversation_id AND f.message_id=u.message_id
       WHERE u.workspace_id=?2 GROUP BY u.skill`,
    )
    .bind(new Date(Date.now() - 30 * DAY_MS).toISOString(), workspaceId)
    .all<{ skill: string; uses: number; up: number; down: number; projects: number; last_used: string | null }>();
  return new Map(results.map((row) => [row.skill, row]));
}
/** What the skill curator learned each skill from (counts only, never which conversations). */
async function learnedFrom(workspaceId: string) {
  const { results } = await db()
    .prepare('SELECT skill,conversations,projects,decided_at FROM agent_skill_kinds WHERE workspace_id=? AND skill IS NOT NULL ORDER BY decided_at')
    .bind(workspaceId)
    .all<{ skill: string; conversations: number; projects: number; decided_at: string }>();
  return new Map(results.map((row) => [row.skill, { conversations: Number(row.conversations), projects: Number(row.projects), at: row.decided_at }]));
}

/**
 * Agent > Skills: Lastfind's (`lastfind`, or `changed` once the workspace edited one) and the team's (`team`, or `learned`
 * when the skill curator learned it), with their status, uses and ratings in 30 days, the projects that used them, their
 * last use and, for a learned one, what it was learned from; `outdated`: Lastfind changed its text since; `proposal`: a
 * change waits for a person.
 */
export async function listSkills(actor: Actor) {
  const [list, stats, learned] = await Promise.all([rows(actor.workspaceId), skillStats(actor.workspaceId), learnedFrom(actor.workspaceId)]);
  const byName = new Map(list.map((row) => [row.name, row]));
  const item = (name: string, row: Row | null, text: string, source: 'lastfind' | 'changed' | 'team' | 'learned', bundle?: string) => {
    const stat = stats.get(name);
    const status: SkillStatus = row?.status ?? 'active';
    return {
      name,
      id: row?.id ?? null,
      title: row && source !== 'changed' ? row.title : null,
      description: parseSkill(text)?.description ?? '',
      source,
      status,
      status_reason: row?.status_reason ?? null,
      merged_into: row?.merged_into ?? null,
      enabled: status === 'active',
      locked: !!row?.locked,
      version: row?.version ?? null,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
      outdated: !!(row && bundle && row.base_hash !== textHash(bundle)),
      reverted: row?.last_author === 'guard',
      proposal: !!proposalOf(row),
      uses: Number(stat?.uses ?? 0),
      up: Number(stat?.up ?? 0),
      down: Number(stat?.down ?? 0),
      projects: Number(stat?.projects ?? 0),
      last_used_at: stat?.last_used ?? null,
      learned: source === 'learned' ? (learned.get(name) ?? null) : null,
    };
  };
  return {
    skills: [
      ...AGENT_SKILLS.map((entry) => {
        const row = byName.get(entry.name)?.origin === 'builtin' ? byName.get(entry.name)! : null;
        return item(entry.name, row, row?.content ?? bundleText(entry), row ? 'changed' : 'lastfind', bundleText(entry));
      }),
      ...list.filter((row) => row.origin !== 'builtin').map((row) => item(row.name, row, row.content, row.origin === 'agent' ? 'learned' : 'team')),
    ],
    canEdit: roleAtLeast(actor.role, 'member'),
    max: AGENT_SKILLS_MAX,
  };
}

/**
 * One skill whole, shaped as an artifact for the artifact view: `{ artifact: { id, name, title, content (the body, its
 * frontmatter's fields in `skill`), version, updated_at, updated_by, skill: { ...its listing, description, bundled,
 * proposal, used_in } }, canEdit }`. "Used in": uses per project in 30 days, and the reader's own last five conversations
 * with it (conversations are each person's: other people's are never listed).
 */
export async function readSkill(actor: Actor, name: string) {
  const { skills, canEdit } = await listSkills(actor);
  const found = skills.find((skill) => skill.name === name);
  if (!found) throw new ApiError(404, 'Skill not found.');
  const row = found.id ? await readRow(actor.workspaceId, name) : null;
  const text = row?.content ?? bundleText(BUNDLED.get(name)!);
  const parsed = parseSkill(text) ?? { name, description: '', body: text };
  const proposal = proposalOf(row);
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const [projects, mine] = await db().batch<{ id: string; name: string; uses: number; title: string; at: string }>([
    db()
      .prepare(
        `SELECT u.project_id id,COALESCE(p.name,'') name,COUNT(DISTINCT u.conversation_id||':'||u.message_id) uses FROM agent_skill_uses u LEFT JOIN projects p ON p.id=u.project_id
         WHERE u.workspace_id=? AND u.skill=? AND u.created_at>=? GROUP BY u.project_id ORDER BY uses DESC LIMIT 20`,
      )
      .bind(actor.workspaceId, name, since),
    db()
      .prepare(
        `SELECT c.id,c.title,c.project_id name,MAX(u.created_at) at FROM agent_skill_uses u JOIN agent_conversations c ON c.id=u.conversation_id
         WHERE u.workspace_id=? AND u.skill=? AND c.account_id=? AND c.deleted_at IS NULL AND c.title<>'' GROUP BY c.id ORDER BY at DESC LIMIT 5`,
      )
      .bind(actor.workspaceId, name, actor.id),
  ]);
  return {
    artifact: {
      // The same id whether or not the workspace has its copy: its chat's conversations carry it.
      id: `skill:${name}`,
      name,
      title: skillTitle(name, false, found.source === 'team' || found.source === 'learned' ? found.title : null),
      content: parsed.body,
      version: row?.version ?? null,
      updated_at: row?.updated_at ?? null,
      updated_by: row?.updated_by ?? null,
      skill: {
        ...found,
        description: parsed.description,
        bundled: BUNDLED.has(name),
        proposal: proposal && { why: proposal.why, at: proposal.at, version: proposal.version, ...changedLines(text, proposal.content) },
        used_in: {
          projects: (projects.results ?? []).map((item) => ({ id: item.id, name: item.name, uses: Number(item.uses) })),
          conversations: (mine.results ?? []).map((item) => ({ id: item.id, title: item.title, project_id: item.name, at: item.at })),
        },
      },
    },
    canEdit,
  };
}

const cleanTitle = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) : '');
/** A draft's text: never live, so it may be half written; it still carries nothing a skill cannot (checked again to turn it on). */
function draftRefusal(prev: string, next: string) {
  const skill = parseSkill(next);
  if (!skill || skill.body.length > SKILL_BODY_MAX) return SKILL_CHECKS.long[0];
  return scanText(changedLines(prev, next).added.join('\n')) ? SKILL_CHECKS.text[0] : null;
}

/**
 * A person's save (members). With `content` a whole SKILL.md and no skill by that name: a new team skill, on (the API's
 * create). Otherwise the skill's new body (`content`), and optionally its `description` and `title`, against the version
 * they loaded (`expected` or `version`; 409 in the artifacts' shape when it moved on). Changing Lastfind's makes the
 * workspace's copy. A draft's text may be half written; any other is checked as a skill.
 */
export async function saveSkill(actor: Actor, data: Json) {
  member(actor);
  const name = String(data.name ?? '');
  const content = typeof data.content === 'string' ? data.content.replace(/\r\n/g, '\n') : '';
  const bundled = BUNDLED.get(name);
  const existed = await readRow(actor.workspaceId, name);
  if (!existed && !bundled) {
    if (RESERVED.has(name)) throw new ApiError(409, 'Lastfind uses this name. Choose another.');
    const checked = checkSkillText(null, content, { auto: false });
    if ('error' in checked) throw new ApiError(400, checked.error);
    if (checked.skill.name !== name) throw new ApiError(400, 'The name in the text and the skill differ.');
    if ((await teamCount(actor.workspaceId)) >= AGENT_SKILLS_MAX) throw new ApiError(409, 'A workspace keeps up to 25 skills of its own on: turn one off first.');
    const made = await insertSkill(actor.workspaceId, { name, title: cleanTitle(data.title) || name, content: skillText(checked.skill), origin: 'user', author: actor.id, conversationId: null });
    if (!made) throw new ApiError(409, 'A skill with this name exists.');
    return readSkill(actor, name);
  }
  const current = existed?.content ?? bundleText(bundled!);
  const parsed = parseSkill(current)!;
  // A whole SKILL.md (the API, Markdown edits that keep the frontmatter), or the body the editor holds.
  const whole = parseSkill(content);
  const next = whole
    ? content
    : skillText({ ...parsed, body: content, ...(typeof data.description === 'string' ? { description: data.description } : {}) });
  if (existed?.status === 'draft') {
    const refused = draftRefusal(current, next);
    if (refused) throw new ApiError(400, refused);
  } else {
    // Lastfind's skill gets its copy only for a text that passes.
    const checked = checkSkillText(current, next, { auto: false });
    if ('error' in checked) throw new ApiError(400, checked.error);
  }
  const final = existed?.status === 'draft' ? next : skillText(parseSkill(next)!);
  const renamed = existed && existed.origin !== 'builtin' && cleanTitle(data.title) && cleanTitle(data.title) !== existed.title;
  // Nothing changed (an editor opened and closed): no copy of Lastfind's, no version.
  if (final === current && !renamed) return readSkill(actor, name);
  const row = existed ?? (await copyOf(actor.workspaceId, name));
  if (!row) throw new ApiError(409, 'Try again.');
  const title = renamed ? cleanTitle(data.title) : row.title;
  // No version: the editor loaded Lastfind's text as shipped (its copy's version 1, unless someone changed it meanwhile).
  const loaded = data.expected ?? data.version;
  // `force` ("Keep mine" after a 409): over whatever version is there now.
  const expected = data.force === true ? undefined : loaded === null || loaded === undefined ? (bundled && !existed ? 1 : existed ? -1 : undefined) : Number(loaded);
  const written = await writeContent(row.id, { title, content: final, author: actor.id, conversationId: null }, Number.isInteger(expected) ? expected : undefined, 'agent_skills');
  if (!written) throw new ApiError(409, 'This skill changed while you were editing it.');
  return readSkill(actor, name);
}

/** "New skill": a team draft from the template (never in the chats until a person turns it on), named after its title. */
export async function createSkillDraft(actor: Actor, data: Json) {
  member(actor);
  const title = cleanTitle(data.title) || 'New skill';
  const base =
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'skill';
  const taken = new Set((await rows(actor.workspaceId)).map((row) => row.name));
  let name = base.length >= 3 ? base : `${base}-skill`;
  for (let index = 2; taken.has(name) || RESERVED.has(name); index++) name = `${base}-${index}`;
  const made = await insertSkill(actor.workspaceId, { name, title, content: skillTemplate(name), origin: 'user', author: actor.id, conversationId: null, status: 'draft', reason: 'person' });
  if (!made) throw new ApiError(409, 'Try again.');
  return readSkill(actor, name);
}

/**
 * A person's settings for a skill (members): `title` (a team skill's), `description`, `locked` (the agent and the curator
 * may not change it), `status` (`active` turns it on, after its text passes as a skill and the cap allows; `deprecated`
 * turns it off; `enabled` is the same as a boolean), and `proposal` (`apply`: the change the agent proposed becomes a
 * version by this person; `dismiss`: it is dropped).
 */
export async function setSkill(actor: Actor, name: string, data: Json) {
  member(actor);
  const row = BUNDLED.has(name) ? await copyOf(actor.workspaceId, name) : await readRow(actor.workspaceId, name);
  if (!row) throw new ApiError(404, 'Skill not found.');
  const status = data.status === 'active' || data.enabled === true ? 'active' : data.status === 'deprecated' || data.enabled === false ? 'deprecated' : null;
  if (status === 'active' && row.status !== 'active') {
    if (row.origin !== 'builtin') {
      const checked = checkSkillText(null, row.content, { auto: false });
      if ('error' in checked) throw new ApiError(400, checked.error);
      if ((await teamCount(actor.workspaceId)) >= AGENT_SKILLS_MAX) throw new ApiError(409, 'A workspace keeps up to 25 skills of its own on: turn one off first.');
    }
    await setStatus(row.id, 'active', null).run();
  } else if (status === 'deprecated' && row.status !== 'deprecated') await setStatus(row.id, 'deprecated', 'person').run();
  if (typeof data.locked === 'boolean') await db().prepare('UPDATE agent_skills SET locked=?,updated_at=? WHERE id=?').bind(data.locked ? 1 : 0, now(), row.id).run();
  if (row.origin !== 'builtin' && cleanTitle(data.title) && cleanTitle(data.title) !== row.title)
    await db().prepare('UPDATE agent_skills SET title=?,updated_at=? WHERE id=?').bind(cleanTitle(data.title), now(), row.id).run();
  if (typeof data.description === 'string') await saveSkill(actor, { name, content: parseSkill(row.content)?.body ?? '', description: data.description, expected: row.version });
  const proposal = proposalOf(row);
  if (proposal && (data.proposal === 'apply' || data.proposal === 'dismiss')) {
    if (data.proposal === 'apply') {
      const written = await writeContent(row.id, { title: row.title, content: proposal.content, author: actor.id, conversationId: proposal.conversation_id }, proposal.version, 'agent_skills');
      if (!written) throw new ApiError(409, 'This skill changed since the agent proposed this: the proposal no longer applies.');
    }
    await db().prepare('UPDATE agent_skills SET proposal=NULL WHERE id=?').bind(row.id).run();
  }
  return readSkill(actor, name);
}

/** A team skill leaves the workspace; Lastfind's goes back to Lastfind's text (`restore`). Its history stays. */
export async function deleteSkill(actor: Actor, name: string) {
  member(actor);
  const row = await readRow(actor.workspaceId, name);
  if (!row) throw new ApiError(404, 'Skill not found.');
  await db().prepare('UPDATE agent_skills SET deleted_at=? WHERE id=?').bind(now(), row.id).run();
  return { deleted: true, restored: row.origin === 'builtin' };
}

// ---------------------------------------------------------------- the agent's changes (in a chat, and the curator's)

/** What a turn knows about the skills: the ones activated in this conversation (only those may change). */
export type SkillUse = { activated: ReadonlySet<string> };

const refuse = (code: string, message: string) => ({ error: { code, message } });
const changedSkill = (row: { id: string; name: string; title: string }, version: number, prev: string, next: string): { changed: Changed } => {
  const { added, removed } = changedLines(prev, next);
  return { changed: { target: 'skill', id: row.id, name: row.name, title: row.title, version, added: added.slice(0, 20), removed: removed.slice(0, 20) } };
};
const versionsOf = async (id: string) =>
  (await db().prepare('SELECT version,author,content,conversation_id,created_at FROM agent_artifact_versions WHERE artifact_id=? ORDER BY version').bind(id).all<{ version: number; author: string; content: string; conversation_id: string | null; created_at: string }>()).results;

/** Every project's own names in the workspace (brand, aliases, site, tracked brands): what a shared skill must not carry. */
export async function workspaceNames(workspaceId: string) {
  const { results } = await db().prepare('SELECT name,domain,aliases_json,competitors_json FROM projects WHERE workspace_id=?').bind(workspaceId).all<Record<string, unknown>>();
  return [...new Set(results.flatMap((project) => projectNames(project)))];
}

/**
 * `improve_skill` and the curator's skill.patch: replaces `old` (found once in the skill) with `new`, in a skill this
 * conversation activated and the person's words ground (or, for the skill curator, three conversations of the same work).
 * Lastfind's first change makes the workspace's copy. The agent changes a skill at most twice per conversation (not in the
 * chat beside the open skill: `open`, where each change quotes the person), the curator once a day; a locked skill, or a
 * line a person wrote, only a person changes. `propose`: it learned this from third-party content, so the change waits
 * for a person (`{ proposed }`) instead of applying.
 */
export async function patchSkill(
  learner: Learner,
  use: SkillUse,
  args: { name: string; old: string; new: string; why?: string; quote?: unknown },
  options: { open?: boolean; propose?: boolean } = {},
): Promise<Json> {
  const name = String(args.name ?? '');
  if (!use.activated.has(name)) return refuse('invalid_argument', 'Only a skill used in this conversation can change: activate it first.');
  const refused = learnedRefusal(learner, String(args.new ?? ''), args.quote);
  if (refused) return refused;
  const existing = await readRow(learner.workspaceId, name);
  const entry = BUNDLED.get(name);
  if (!existing && !entry) return refuse('not_found', 'Skill not found.');
  if (existing?.locked) return refuse('permission_denied', 'The team locked this skill: only a person changes it.');
  const text = existing?.content ?? bundleText(entry!);
  const old = String(args.old ?? '');
  if (!old || text.split(old).length !== 2) return refuse('invalid_argument', 'old must be text found exactly once in the skill.');
  const history = existing ? await versionsOf(existing.id) : [];
  // A line a person wrote only a person changes (Lastfind's lines and the agent's may change): every line `old` touches.
  const at = text.indexOf(old);
  const end = text.indexOf('\n', at + old.length);
  const touched = text.slice(text.lastIndexOf('\n', at) + 1, end < 0 ? undefined : end).split('\n').filter((line) => line.trim());
  if (existing && touched.some((line) => { const by = addedBy(history, line); return !automatic(by) && by !== 'lastfind'; }))
    return refuse('permission_denied', 'A person wrote this line: only a person changes it (the team edits it in Agent > Skills).');
  const next = text.replace(old, () => String(args.new ?? ''));
  const checked = checkSkillText(text, next, { auto: true, names: await workspaceNames(learner.workspaceId) });
  if ('error' in checked) return refuse('invalid_argument', checked.error);
  const automaticVersions = history.filter((version) => automatic(version.author) && version.author !== 'guard');
  if (learner.author === 'curator' && automaticVersions.some((version) => version.created_at.slice(0, 10) === now().slice(0, 10)))
    return refuse('rate_limited', 'This skill already changed by itself today.');
  if (learner.author === 'agent' && !options.open && automaticVersions.filter((version) => version.conversation_id === learner.conversationId).length >= 2)
    return refuse('rate_limited', 'This skill already changed twice in this conversation: the team can edit it in Agent > Skills.');
  // Never back to a text a person or the guard moved away from.
  if (history.slice(0, -1).some((version) => version.content.trim() === skillText(checked.skill).trim())) return refuse('invalid_argument', 'This brings back an earlier version that was changed or undone.');
  const row = existing ?? (await copyOf(learner.workspaceId, name));
  if (!row) return refuse('conflict', 'Try again.');
  if (options.propose) return proposeSkill(learner, row, skillText(checked.skill), String(args.why ?? ''));
  return writeSkill(learner, row, skillText(checked.skill));
}

/** A change kept beside the skill until a person applies or dismisses it (Agent > Skills); a newer one replaces it. */
async function proposeSkill(learner: Learner, row: Row, next: string, why: string) {
  const proposal: Proposal = { content: next, version: row.version, author: learner.author, conversation_id: learner.conversationId, why: why.slice(0, 300), at: now() };
  await db().prepare('UPDATE agent_skills SET proposal=? WHERE id=?').bind(JSON.stringify(proposal), row.id).run();
  const { added, removed } = changedLines(row.content, next);
  return { proposed: { target: 'skill', id: row.id, name: row.name, title: row.title, added: added.slice(0, 20), removed: removed.slice(0, 20) } };
}

async function writeSkill(learner: Learner, row: Row, next: string) {
  const written = await writeContent(row.id, { title: row.title, content: next, author: learner.author, conversationId: learner.conversationId }, row.version, 'agent_skills');
  if (!written) return refuse('conflict', 'The skill changed meanwhile: nothing was written.');
  return changedSkill(row, written.version, row.content, next);
}

/** Which skill (and version) an answer used, so its ratings count for that version. */
export async function recordSkillUses(conversationId: string, messageId: string, used: [string, number | null][]) {
  if (!used.length) return;
  const at = now();
  await db().batch(
    used.map(([skill, version]) =>
      db()
        .prepare('INSERT OR IGNORE INTO agent_skill_uses(conversation_id,message_id,workspace_id,project_id,skill,version,created_at) SELECT id,?,workspace_id,project_id,?,?,? FROM agent_conversations WHERE id=?')
        .bind(messageId, skill, version, at, conversationId),
    ),
  );
}

/**
 * Undoes an automatic change the answers got worse after (no model call): its first 5 answers have 2 or more 👎 and no
 * 👍. The previous text comes back as a version by `guard`; the change can be applied again from the history. A skill the
 * agent learned whose first version did that is turned off (`degraded`): a person turns it on again.
 */
export async function revertDegraded(workspaceId: string) {
  const { results } = await db()
    .prepare(
      `SELECT s.id,s.name,s.title,s.version,s.content,s.origin,v.conversation_id,
       (SELECT content FROM agent_artifact_versions p WHERE p.artifact_id=s.id AND p.version<s.version ORDER BY p.version DESC LIMIT 1) prev
       FROM agent_skills s JOIN agent_artifact_versions v ON v.artifact_id=s.id AND v.version=s.version
       WHERE s.workspace_id=? AND s.deleted_at IS NULL AND s.status='active' AND v.author IN ('agent','curator')`,
    )
    .bind(workspaceId)
    .all<{ id: string; name: string; title: string; version: number; content: string; origin: Row['origin']; conversation_id: string | null; prev: string | null }>();
  let undone = 0;
  for (const row of results) {
    if (row.prev === null && row.origin !== 'agent') continue;
    const rating = await db()
      .prepare(
        `SELECT COALESCE(SUM(f.rating=1),0) up,COALESCE(SUM(f.rating=-1),0) down FROM
         (SELECT conversation_id,message_id FROM agent_skill_uses WHERE workspace_id=? AND skill=? AND version=? ORDER BY created_at LIMIT 5) u
         JOIN agent_feedback f ON f.conversation_id=u.conversation_id AND f.message_id=u.message_id`,
      )
      .bind(workspaceId, row.name, row.version)
      .first<{ up: number; down: number }>();
    if (Number(rating?.down ?? 0) < 2 || Number(rating?.up ?? 0) > 0) continue;
    if (row.prev === null) {
      await setStatus(row.id, 'deprecated', 'degraded').run();
      undone++;
    } else if (await writeContent(row.id, { title: row.title, content: row.prev, author: 'guard', conversationId: row.conversation_id }, row.version, 'agent_skills')) undone++;
  }
  return undone;
}

/** Turns off the skills the agent learned that nobody used in SKILL_UNUSED_DAYS (SQL only; a person's and Lastfind's never). */
export async function retireUnused(workspaceId: string) {
  const since = new Date(Date.now() - SKILL_UNUSED_DAYS * DAY_MS).toISOString();
  const result = await db()
    .prepare(
      `UPDATE agent_skills SET status='deprecated',status_reason='unused',enabled=0,updated_at=? WHERE workspace_id=? AND origin='agent' AND status='active' AND deleted_at IS NULL
       AND created_at<? AND NOT EXISTS (SELECT 1 FROM agent_skill_uses u WHERE u.workspace_id=agent_skills.workspace_id AND u.skill=agent_skills.name AND u.created_at>=?)`,
    )
    .bind(now(), workspaceId, since, since)
    .run();
  return result.meta.changes;
}

/** The workspace's library for the skill curator: the active skills (with the agent's own bodies when the library is full), and whether it is. */
export async function skillLibrary(workspaceId: string) {
  const list = await rows(workspaceId);
  const full = (await teamCount(workspaceId)) >= AGENT_SKILLS_MAX;
  const agentOwn = new Set(list.filter((row) => row.origin === 'agent' && row.status === 'active').map((row) => row.name));
  const titles = new Map(list.map((row) => [row.name, row.title]));
  return {
    full,
    skills: mergedSkills(list).map((skill) => ({
      name: skill.name,
      title: skillTitle(skill.name, false, titles.get(skill.name)),
      description: skill.description,
      ...(full && agentOwn.has(skill.name) ? { body: skill.body } : {}),
    })),
  };
}

/** The cluster a skill curator's operation comes from: its kind, conversations, who and where, and what it read. */
export type Cluster = { kind: string; ids: string[]; conversations: number; projects: number; people: number; thirdParty: boolean; personWords: string; assistantText: string };

/**
 * Applies the skill curator's operation (as `curator`), with the same checks as every change: the evidence cites at least
 * three of the cluster's conversations; a new skill follows the format, takes no name Lastfind or the team uses, names no
 * project of the workspace and copies no passage of the assistant's text. It is on at once, unless the conversations read
 * third-party content (a draft for review) or the library filled up meanwhile (a draft). A patch goes through patchSkill
 * (a proposal after third-party content); a merge, only of the agent's own skills, patches `into` and marks the others
 * merged. Whatever happened, the class is recorded so it is never sent again (one judged not worth a skill, after 30 days).
 */
export async function learnSkill(workspaceId: string, projectId: string, op: SkillOp, cluster: Cluster): Promise<{ applied: string | null; code: string | null }> {
  const record = (skill: string | null) =>
    db()
      .prepare(
        `INSERT INTO agent_skill_kinds(workspace_id,kind,skill,conversations,projects,people,decided_at) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id,kind) DO UPDATE SET skill=COALESCE(excluded.skill,agent_skill_kinds.skill),conversations=excluded.conversations,projects=excluded.projects,people=excluded.people,decided_at=excluded.decided_at`,
      )
      .bind(workspaceId, cluster.kind, skill, cluster.conversations, cluster.projects, cluster.people, now())
      .run();
  const done = async (skill: string | null, code: string | null) => {
    await record(skill);
    return { applied: code ? null : skill, code };
  };
  if (op.op === 'none') return done(null, 'none');
  if (op.evidence.length < SKILL_CLUSTER_MIN || op.evidence.some((id) => !cluster.ids.includes(id))) return done(null, 'no_evidence');
  const learner: Learner = {
    workspaceId,
    projectId,
    project: { id: projectId },
    author: 'curator',
    conversationId: null as unknown as string,
    pt: false,
    canWrite: true,
    evidence: [cluster.personWords],
    foreign: cluster.assistantText,
    cluster: op.evidence,
  };
  const names = await workspaceNames(workspaceId);
  if (op.op === 'skill.create') {
    if (RESERVED.has(op.name) || (await readRow(workspaceId, op.name))) return done(null, 'exists');
    const text = skillText({ name: op.name, description: op.description, body: op.body });
    const checked = checkSkillText(null, text, { auto: true, names });
    if ('error' in checked) return done(null, checked.code);
    const refused = learnedRefusal(learner, `${op.description}\n${op.body}`, null);
    if (refused) return done(null, refused.error.code === 'invalid_argument' ? 'copied' : String(refused.error.code));
    const full = (await teamCount(workspaceId)) >= AGENT_SKILLS_MAX;
    const draft = cluster.thirdParty ? 'review' : full ? 'full' : null;
    const made = await insertSkill(workspaceId, {
      name: op.name,
      title: op.title,
      content: skillText(checked.skill),
      origin: 'agent',
      author: 'curator',
      conversationId: null,
      status: draft ? 'draft' : 'active',
      reason: draft,
    });
    return made ? done(op.name, null) : done(null, 'conflict');
  }
  const into = op.op === 'skill.patch' ? op.name : op.into;
  if (op.op === 'skill.patch') {
    const result = await patchSkill(learner, { activated: new Set([into]) }, { name: into, old: op.old, new: op.new, why: op.why }, { propose: cluster.thirdParty });
    return result.changed || result.proposed ? done(into, null) : done(null, String(result.error?.code ?? 'unknown'));
  }
  // A merge: the agent's own skills only, never after third-party content (too large a change to review as a proposal).
  if (cluster.thirdParty) return done(null, 'review');
  const target = await readRow(workspaceId, into);
  const sources = await Promise.all(op.from.map((name) => readRow(workspaceId, name)));
  if (!target || target.locked || target.status !== 'active' || sources.some((row) => !row || row.origin !== 'agent' || row.locked)) return done(null, 'not_allowed');
  const checked = checkSkillText(target.content, op.content, { auto: true, names });
  if ('error' in checked) return done(null, checked.code);
  if (foreignRun(changedLines(target.content, op.content).added.join('\n'), cluster.personWords, cluster.assistantText)) return done(null, 'copied');
  const written = await writeSkill(learner, target, skillText(checked.skill));
  if (!('changed' in written)) return done(null, 'conflict');
  await db().batch(sources.map((row) => setStatus(row!.id, 'merged', 'merged', into)));
  return done(into, null);
}

/** The skill open beside a chat: its whole text, whatever its status (null when there is none by that name). */
export async function openSkill(workspaceId: string, name: string) {
  const row = await readRow(workspaceId, name);
  const text = row?.content ?? (BUNDLED.has(name) ? bundleText(BUNDLED.get(name)!) : null);
  return text === null ? null : { name, text };
}

/** A skill's history (none while Lastfind's is as shipped). */
export async function skillVersions(actor: Actor, name: string) {
  const row = await readRow(actor.workspaceId, name);
  if (!row) {
    if (!BUNDLED.has(name)) throw new ApiError(404, 'Skill not found.');
    return { current: null, canRestore: roleAtLeast(actor.role, 'member'), versions: [] };
  }
  return listVersions(actor, { table: 'agent_skills', id: row.id });
}
export async function restoreSkill(actor: Actor, name: string, version: unknown, expected?: unknown) {
  const row = await readRow(actor.workspaceId, name);
  if (!row) throw new ApiError(404, 'Skill not found.');
  return restoreVersion(actor, { table: 'agent_skills', id: row.id }, version, expected);
}

/** The text and version of the workspace's skills with these names (for the curator). */
export async function workspaceSkillBodies(workspaceId: string, names: readonly string[]) {
  if (!names.length) return [];
  return mergedSkills(await rows(workspaceId))
    .filter((skill) => names.includes(skill.name))
    .map((skill) => ({ name: skill.name, version: skill.revision, body: skill.body }));
}
