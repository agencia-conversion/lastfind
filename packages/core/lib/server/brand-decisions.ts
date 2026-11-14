import {
  MAX_COMPETITORS,
  activeEvents,
  applyOps,
  applyOpsChecked,
  brandKey,
  deriveRows,
  deriveState,
  invertOps,
  resolveMerge,
  type BrandsOverview,
  type DecisionEvidence,
  type DecisionKind,
  type DecisionPayload,
  type Suggestion,
  type TargetOp,
} from '@/lib/brand-decisions';
import { competitorIdentity } from '@/lib/competitor-identity';
import { brandProse, matchesBrand, mentionText, normalizeDomain, normalizeText } from '@/lib/metrics';
import { nameForm } from '@/lib/brand-mention-check';
import type { BrandTarget } from '@/lib/types';
import { waitUntil } from 'cloudflare:workers';
import { db, now } from './env';
import { timed } from './server-timing';
import { foundProject, ownedProjectStatement, projectStoreStatement } from './project-reads';
import type { StoreRegistry } from './project-store';
import { ApiError, textField } from './http';
import { ownedProject, projectFromRow } from './workspace';
import { projectInput } from './validation';
import {
  COMPETITOR_ANALYSIS_DAYS,
  competitorAnalysisStatus,
  ensureCompetitorAnalysis,
  syncCountedBrands,
} from './competitor-analysis';
import { projectReadDatabase, storedCopy } from './project-store-read';

import { decisionEventsFrom, decisionEventsStatement, loadDecisionEvents } from './brand-decision-events';
import { roleDecisionsStatements, rolesFrom, withModelRoles } from './brand-roles';
import {
  domainDiscoveryConfig,
  domainWork,
  loadDomainLookups,
  lookupView,
  monthStart,
  projectDomainSpend,
  withSiteChecks,
  type LookupRow,
} from './brand-domain-lookups';
import { siteCheckWork } from '@/lib/brand-domain';
export { withoutDecided } from './brand-decision-events';
import type { User } from './auth';

const ACTIONS = ['confirm', 'reject', 'alias', 'domain', 'rename', 'undo'] as const;

const savedKey = (projectId: string) => `brand-suggestions:${projectId}`;
/** The list reviewed before the analysis restarted, and how many answers it came from. */
async function savedSuggestions(projectId: string): Promise<{ suggestions: Suggestion[]; analyzed: number }> {
  const row = await db()
    .prepare('SELECT value FROM system_state WHERE key=?')
    .bind(savedKey(projectId))
    .first<{ value: string }>();
  try {
    const saved = row ? JSON.parse(row.value) : null;
    // Older saves were the bare list.
    if (Array.isArray(saved)) return { suggestions: saved as Suggestion[], analyzed: 0 };
    return saved && Array.isArray(saved.suggestions)
      ? { suggestions: saved.suggestions as Suggestion[], analyzed: Number(saved.analyzed) || 0 }
      : { suggestions: [], analyzed: 0 };
  } catch {
    return { suggestions: [], analyzed: 0 };
  }
}

/**
 * The monitored competitor a discovered name may be, when one name holds the other's whole name as contiguous words (`nameForm`,
 * either way). The analysis already counts such a name as the competitor when the decision model says it is the same business;
 * one it kept apart is left to the person, who merges it or not. Null when none.
 */
export function sameBrandHint(name: string, competitors: readonly BrandTarget[]) {
  const key = mentionText(name);
  return competitors.find((target) => [target.name, ...(target.aliases ?? [])]
    .some((spelling) => nameForm(name, [mentionText(spelling)]) || nameForm(spelling, [key])))?.name ?? null;
}

/** The answer excerpts of one row of the Brands list (brandsOverview sends run ids only). */
export async function brandEvidence(projectId: string, workspaceId: string, key: string) {
  const [projectRow, events, status] = await Promise.all([
    ownedProject(projectId, workspaceId),
    loadDecisionEvents(projectId),
    competitorAnalysisStatus(projectId, workspaceId).catch(() => null),
  ]);
  const project = projectFromRow(projectRow);
  const rows = deriveRows(project.competitors, (status?.suggestions ?? []) as Suggestion[], deriveState(events), {}, project.domain);
  const row = rows.find((item) => item.key === key);
  return { status: row?.status ?? null, evidence: row?.evidence ?? [] };
}

/**
 * The Brands list paints from the last one computed for the project (its analysis finished), kept in this isolate (ten
 * minutes at most) or in the project's store (for the store's current data and analysis job, see ProjectStore.responseCopy;
 * a day at most), marked `cachedAt`; the screen then reads it again with `fresh`, as it does after every decision. Reading it costs about
 * 2.5 s of D1 and project store; the copy, one D1 read (the project, beside the session) and one store read.
 */
const OVERVIEW_TTL_MS = 10 * 60_000;
/** The store's copy is only found for the data and analysis job it was made from: it may be older (a day at most). */
const STORE_COPY_TTL_MS = 24 * 3600_000;
const lastOverviews = new Map<string, BrandsOverview & { cachedAt: string }>();
const overviewKey = (projectId: string, workspaceId: string) => JSON.stringify(['brands-overview', projectId, workspaceId]);
const cacheable = (overview: BrandsOverview) => overview.analysis.status === 'complete' && !overview.analysis.stale && !overview.analysis.unavailable;
const isFresh = (overview: BrandsOverview | undefined, at = Date.now()): overview is BrandsOverview & { cachedAt: string } =>
  !!overview?.cachedAt && at - Date.parse(overview.cachedAt) < OVERVIEW_TTL_MS;
/** Forget this isolate's copy (a decision just changed the list); the screen's fresh read replaces the store's. */
export const forgetBrandsOverview = (projectId: string, workspaceId: string) => lastOverviews.delete(overviewKey(projectId, workspaceId));

/** The project and its store registry, as rows (null when absent). */
type ProjectReads = Promise<(Record<string, unknown> | null)[]>;
/** Owned by `workspaceId`: `early` was read by project id alone (by a caller that sent it before it knew the owner). */
async function ownedReads(projectId: string, workspaceId: string, early?: ProjectReads) {
  const owned = (row: Record<string, unknown> | null) => (row && row.workspace_id === workspaceId ? row : null);
  const reads =
    early ??
    db()
      .batch([ownedProjectStatement(projectId, workspaceId), projectStoreStatement(projectId, workspaceId)])
      .then((results) => results.map((read) => (read.results[0] as Record<string, unknown> | undefined) ?? null));
  const [project, registry] = (await reads).map(owned);
  return { project: foundProject(project), registry };
}

export async function brandsOverview(
  projectId: string,
  workspaceId: string,
  { fresh = false, early }: { fresh?: boolean; early?: ProjectReads } = {},
): Promise<BrandsOverview> {
  const key = overviewKey(projectId, workspaceId);
  const kept = lastOverviews.get(key);
  if (!fresh && isFresh(kept)) {
    // A copy goes only to whom owns the project now (a 404 otherwise): the read the full list also starts with.
    try {
      if (early) await ownedReads(projectId, workspaceId, early);
      else foundProject(await ownedProjectStatement(projectId, workspaceId).first<Record<string, unknown>>());
    } catch (error) {
      lastOverviews.delete(key);
      throw error;
    }
    return kept;
  }
  // The store copy is looked up (and its key known) beside the computation: a fresh read keeps what it computes there.
  const reads = ownedReads(projectId, workspaceId, early);
  // Publication behind: the computation publishes first, so a copy would miss what it brings.
  const copy = reads.then(({ project, registry }) =>
    registry?.generation && registry.source_revision === registry.applied_revision
      ? storedCopy({ ownerId: workspaceId, projectId, generation: String(registry.generation) }, ['brands-overview', workspaceId, project], { analysis: true })
      : null,
  );
  copy.catch(() => {});
  if (!fresh) {
    await reads;
    const found = await copy.catch(() => null);
    const stored = found?.value ? (JSON.parse(found.value) as BrandsOverview & { cachedAt: string }) : undefined;
    if (stored?.cachedAt && Date.now() - Date.parse(stored.cachedAt) < STORE_COPY_TTL_MS) {
      if (isFresh(stored)) lastOverviews.set(key, stored);
      if (lastOverviews.size > 16) lastOverviews.delete(lastOverviews.keys().next().value!);
      return stored;
    }
  }
  const read = await readBrandsOverview(projectId, workspaceId);
  lastOverviews.delete(key);
  if (!cacheable(read)) return read;
  const stamped = { ...read, cachedAt: now() };
  lastOverviews.set(key, stamped);
  // ponytail: up to 16 projects per isolate (~0.5 MB each); an LRU by bytes if accounts get bigger.
  if (lastOverviews.size > 16) lastOverviews.delete(lastOverviews.keys().next().value!);
  (await copy.catch(() => null))?.keep(JSON.stringify(stamped));
  return read;
}

async function readBrandsOverview(
  projectId: string,
  workspaceId: string,
): Promise<BrandsOverview> {
  // Every D1 round trip counts (~250 ms each in production): the project, its store, the decisions and the model roles are
  // read in one; the analysis status, the stored domains and the month's domain spend then run side by side.
  const [projectRead, registryRead, eventsRead, namesRead, questionsRead] = await timed('base', () =>
    db().batch([
      ownedProjectStatement(projectId, workspaceId),
      projectStoreStatement(projectId, workspaceId),
      decisionEventsStatement(projectId),
      ...roleDecisionsStatements(projectId),
    ]),
  );
  const projectRow = foundProject(projectRead.results[0] as Record<string, unknown> | undefined);
  const project = projectFromRow(projectRow);
  const events = decisionEventsFrom(eventsRead.results as never);
  const roles = rolesFrom(namesRead.results as never, questionsRead.results as never);
  const config = domainDiscoveryConfig();
  const [status, monthSpent] = await Promise.all([
    // The project store can be busy or unavailable for a moment: decisions and the last list stay readable.
    timed('analysis', () =>
      competitorAnalysisStatus(projectId, workspaceId, { project: projectRow, registry: (registryRead.results[0] as StoreRegistry | undefined) ?? null }, undefined, roles),
    ).catch(() => null),
    config.paid ? projectDomainSpend(projectId, monthStart(now())).catch(() => 0) : 0,
  ]);
  const state = deriveState(events);
  const active = activeEvents(events);
  // A target change restarts the analysis and its suggestions return only when it
  // completes. Meanwhile show the list the owner was reviewing, marked as updating.
  const updating = !status || status.status === 'pending' || status.status === 'running';
  const found = (status?.suggestions ?? []) as Suggestion[];
  // Roles the decision model already settled (read from the database, never asked here: the analysis job asks).
  const decided = Promise.resolve(roles);
  const live = await withModelRoles(projectId, found, decided);
  // The store serves the last complete list while the pass runs; the copy saved at the decision only when the store does not answer.
  const saved = live.length || !updating ? null : (status?.previous ?? (await savedSuggestions(projectId)));
  const suggestions = saved ? await withModelRoles(projectId, saved.suggestions, decided) : live;
  // Stored discoveries of these brands only fill the ones that have no domain; a failure here never hides the list.
  const lookups = await loadDomainLookups(
    workspaceId,
    project.location_code,
    [...suggestions.map((item) => item.key ?? brandKey(item.name)), ...Object.keys(state.rejected)],
  ).catch(() => new Map<string, LookupRow>());
  const undone = new Set(events.map((event) => event.undoes));
  const byId = new Map(events.map((event) => [event.id, event]));
  const last = active.at(-1);
  const settled = status?.status === 'complete' && !saved;
  const spent = settled ? monthSpent : 0;
  const owed = settled
    ? domainWork(project.id, deriveRows(project.competitors, suggestions.filter((item) => !item.ambiguous), state, {}, project.domain), lookups, config, spent)
    : null;
  // The reads of the brands' sites confirm (or send to review) their domains; the ones still owed count as pending work.
  const views = Object.fromEntries([...lookups].map(([key, row]) => [key, lookupView(row)]));
  const { rows, sites } = await withSiteChecks(
    (sites) => deriveRows(project.competitors, suggestions, state, views, project.domain, { sites, locationCode: project.location_code }),
    project.location_code,
  );
  const sitesOwed = settled ? siteCheckWork(rows, sites, Date.now(), project.location_code).length : 0;
  return {
    maxCompetitors: MAX_COMPETITORS,
    // The list carries which answers back each row, not their text (two thirds of the bytes): the side panel asks
    // brandEvidence for the excerpts of the one brand it opens.
    rows: rows.map((row) => ({
      ...row,
      evidence: row.evidence.map(({ runId, createdAt }) => ({ runId, createdAt, excerpt: '' })),
      sameAs: row.status === 'discovered' ? sameBrandHint(row.name, project.competitors) : null,
    })),
    domainDiscovery: { pending: owed?.work.length ?? 0, sites: sitesOwed, paid: config.paid, capped: !!owed?.capped && config.paid },
    state,
    history: events
      .slice(-30)
      .reverse()
      .map((event) => {
        const subject = event.undoes ? byId.get(event.undoes) : event;
        return {
          id: event.id,
          seq: event.seq,
          kind: event.kind,
          name: subject?.payload.name ?? event.payload.name,
          into: subject?.payload.into ?? null,
          undoes: event.undoes,
          active: event.kind !== 'undo' && !undone.has(event.id),
          author: event.author,
          createdAt: event.createdAt,
        };
      }),
    undoable: last ? { id: last.id, kind: last.kind, name: last.payload.name } : null,
    analysis: {
      status: status?.status ?? 'idle',
      processed: status?.processed ?? 0,
      total: status?.total ?? 0,
      truncated: status?.truncated ?? false,
      needsEnsure: !!status?.needsEnsure,
      stale: !live.length && updating && suggestions.length > 0,
      // Answers the discovered counts come from: the denominator of their visibility.
      analyzed: saved ? saved.analyzed : status?.status === 'complete' ? status.processed : 0,
      unavailable: !status,
      publicationPending: !!status?.publicationPending,
      error: status?.error ?? null,
    },
  };
}

async function sha256(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Run IDs the decision was based on, with the hash of the saved answer. */
async function evidenceFor(projectId: string, workspaceId: string, value: unknown): Promise<DecisionEvidence[]> {
  const ids = Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, 5)
    : [];
  if (!ids.length) return [];
  try {
    const database = await projectReadDatabase(projectId, workspaceId);
    const { results } = await database
      .prepare(`SELECT id,answer FROM runs WHERE project_id=? AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(projectId, ...ids)
      .all<{ id: string; answer: string | null }>();
    return Promise.all(
      results.map(async (row) => ({ runId: row.id, sha256: row.answer ? await sha256(row.answer) : null })),
    );
  } catch {
    return ids.map((runId) => ({ runId, sha256: null }));
  }
}

const like = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

/** Saved answers (analysis window) that mention both sides of a merge: they must count once. */
async function overlapOf(projectId: string, workspaceId: string, a: string[], b: string[]) {
  try {
    const database = await projectReadDatabase(projectId, workspaceId);
    const cutoff = new Date(Date.now() - COMPETITOR_ANALYSIS_DAYS * 86400000).toISOString();
    const any = (names: string[]) => names.map(() => "answer LIKE ? ESCAPE '\\'").join(' OR ');
    // Discovery counts keep separate occurrences of nested names. "Viki"
    // inside "Rakuten Viki" alone is not an overlap of the two discoveries.
    const nested = a.some((left) => b.some((right) =>
      brandKey(left) !== brandKey(right) &&
      (brandKey(left).includes(brandKey(right)) || brandKey(right).includes(brandKey(left))),
    ));
    if (nested) {
      const separate = (answer: string, names: string[], others: string[]) => names.some((name) => {
        let text = normalizeText(brandProse(answer));
        const short = normalizeText(name);
        for (const other of others) {
          const long = normalizeText(other);
          if (long !== short && long.includes(short)) {
            const escaped = long.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            text = text.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'giu'), '$1 ');
          }
        }
        return matchesBrand(text, { name, domain: '' });
      });
      let overlap = 0;
      const size = 25;
      for (let offset = 0; ; offset += size) {
        const { results } = await database.prepare(
          `SELECT answer FROM runs WHERE project_id=? AND status='complete' AND response_available=1 AND created_at>=? AND (${any(a)}) AND (${any(b)}) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
        ).bind(projectId, cutoff, ...a.map(like), ...b.map(like), size, offset).all<{ answer: string }>();
        overlap += results.filter((row) => separate(row.answer, a, b) && separate(row.answer, b, a)).length;
        if (results.length < size) return overlap;
      }
    }
    const row = await database
      .prepare(
        `SELECT COUNT(*) AS total FROM runs WHERE project_id=? AND status='complete' AND response_available=1 AND created_at>=? AND (${any(a)}) AND (${any(b)})`,
      )
      .bind(projectId, cutoff, ...a.map(like), ...b.map(like))
      .first<{ total: number }>();
    return Number(row?.total ?? 0);
  } catch {
    return null;
  }
}

const count = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1e9 ? (value as number) : null;

function domainOf(value: unknown) {
  try {
    return normalizeDomain(textField(value, 'Domínio', 3, 253));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, error instanceof Error ? error.message : 'Domínio inválido');
  }
}

export async function decideBrand(
  projectId: string,
  user: User,
  input: Record<string, unknown>,
) {
  const kind = input.action as DecisionKind;
  if (!ACTIONS.includes(kind)) throw new ApiError(400, 'Invalid brand decision.');
  const [owned, events] = await Promise.all([ownedProject(projectId, user.id), loadDecisionEvents(projectId)]);
  const project = projectFromRow(owned);
  const state = deriveState(events);
  let ops: TargetOp[] = [];
  let payload: DecisionPayload;
  let key: string;
  let undoes: string | null = null;

  if (kind === 'undo') {
    const target = activeEvents(events).find((event) => event.id === input.eventId);
    if (!target) throw new ApiError(409, 'This decision was already undone or does not exist.');
    ops = invertOps(target.payload.ops);
    key = target.brandKey;
    undoes = target.id;
    payload = { name: target.payload.name, ops };
    // The list may have moved on (renamed, domain taken, ...): never record an undo that undoes nothing.
    if (!applyOpsChecked(project.competitors, ops).effective)
      throw new ApiError(409, 'This decision can no longer be undone because the brand list changed since.');
  } else {
    const name = textField(input.name, 'Marca', 2, 80);
    if (!competitorIdentity(name)) throw new ApiError(400, 'Invalid brand decision.');
    key =
      typeof input.key === 'string' && input.key.length > 0 && input.key.length <= 120
        ? input.key
        : brandKey(name);
    const own = [project.name, ...project.aliases].map(brandKey);
    if (own.includes(key) || own.includes(brandKey(name)))
      throw new ApiError(400, 'Your own brand cannot be reviewed here.');
    const target = project.competitors.find((item) => brandKey(item.name) === key || brandKey(item.name) === brandKey(name));
    payload = { name, ops, evidence: await evidenceFor(projectId, user.id, input.evidence) };
    if (kind === 'confirm') {
      if (target) throw new ApiError(409, 'This brand is already monitored.');
      const domain = input.domain ? domainOf(input.domain) : state.domains[key];
      if (!domain) throw new ApiError(400, 'Enter a domain for this brand before confirming it.');
      if (project.competitors.length >= MAX_COMPETITORS)
        throw new ApiError(409, 'Competitor limit reached. Remove, reject or merge a monitored competitor first.');
      const displayName = state.names[key] ?? name;
      // A renamed discovery keeps the names it was found under, or its old mentions stop counting.
      const renamedFrom = activeEvents(events)
        .filter((event) => event.kind === 'rename' && event.brandKey === key)
        .flatMap((event) => [event.payload.name, event.payload.previous ?? '']);
      // The detector's own aliases of the row (sub-brands, other spellings) keep counting once the brand is monitored.
      const detected = Array.isArray(input.aliases)
        ? input.aliases.filter((item): item is string => typeof item === 'string' && item.trim().length >= 2 && item.trim().length <= 80).map((item) => item.trim())
        : [];
      const aliases = [
        ...new Map(
          [...(state.merged[key] ?? []).map((source) => source.name), name, ...renamedFrom, ...detected]
            .filter((item) => item && brandKey(item) !== brandKey(displayName))
            .map((item) => [brandKey(item), item]),
        ).values(),
      ].slice(0, 10);
      payload.domain = domain;
      ops = [{ op: 'add', target: { name: displayName, domain, ...(aliases.length ? { aliases } : {}) } }];
    } else if (kind === 'reject') {
      payload.domain = target?.domain ?? (input.domain ? domainOf(input.domain) : (state.domains[key] ?? null));
      payload.sense = typeof input.sense === 'string' ? input.sense.trim().slice(0, 200) : '';
      payload.responses = count(input.responses);
      ops = target ? [{ op: 'remove', target }] : [];
    } else if (kind === 'alias') {
      const into = textField(input.into, 'Marca', 2, 80);
      const intoKey = resolveMerge(
        state,
        typeof input.intoKey === 'string' && input.intoKey.length <= 120 ? input.intoKey : brandKey(into),
      );
      const destination = project.competitors.find((item) => brandKey(item.name) === intoKey);
      if (intoKey === key || own.includes(intoKey)) throw new ApiError(400, 'Choose another brand to merge into.');
      if (state.rejected[intoKey] || state.mergedInto[key] || resolveMerge(state, intoKey) === key || (target && !destination))
        throw new ApiError(400, 'This brand cannot be merged there.');
      const names = [
        ...new Set([name, ...(target?.aliases ?? []), ...(state.merged[key] ?? []).map((source) => source.name)]),
      ];
      payload.into = destination?.name ?? into;
      payload.intoKey = intoKey;
      payload.names = names;
      payload.responses = count(input.responses);
      if (target) ops.push({ op: 'remove', target });
      if (destination) {
        const known = destination.aliases ?? [];
        ops.push({
          op: 'alias',
          key: intoKey,
          names: names.filter((item) => !known.some((alias) => brandKey(alias) === brandKey(item))),
        });
      } else {
        const intoNames = [
          into,
          ...(state.merged[intoKey] ?? []).map((source) => source.name),
        ];
        payload.overlap = await overlapOf(projectId, user.id, names, intoNames);
      }
    } else if (kind === 'domain') {
      const domain = domainOf(input.domain);
      payload.domain = domain;
      payload.previous = target?.domain ?? state.domains[key] ?? null;
      if (target && target.domain !== domain)
        ops = [{ op: 'set', key: brandKey(target.name), field: 'domain', from: target.domain, to: domain }];
    } else {
      const displayName = textField(input.displayName, 'Nome', 2, 80);
      if (!competitorIdentity(displayName)) throw new ApiError(400, 'Invalid brand decision.');
      payload.displayName = displayName;
      payload.previous = state.names[key] ?? target?.name ?? name;
      if (target && target.name !== displayName)
        ops = [
          { op: 'set', key: brandKey(target.name), field: 'name', from: target.name, to: displayName },
          { op: 'alias', key: brandKey(displayName), names: [target.name] },
        ];
    }
    payload.ops = ops;
  }

  const next = applyOps(project.competitors, ops);
  const changed = JSON.stringify(next) !== JSON.stringify(project.competitors);
  if (changed) {
    if (next.length > MAX_COMPETITORS)
      throw new ApiError(409, 'Competitor limit reached. Remove, reject or merge a monitored competitor first.');
    // A settings save keeps 10 variations per competitor; a decision must not lose the rest in silence.
    if (next.some((item) => (item.aliases?.length ?? 0) > 10)) throw new ApiError(400, 'Use up to 10 name variations.');
    // The same rules as a settings save: unique names and domains, valid aliases.
    projectInput({ ...owned, aliases: project.aliases, additional_domains: project.additional_domains, competitors: next });
  }
  const id = crypto.randomUUID();
  const revision = Number(owned.competitor_targets_revision || 0);
  const nextJson = changed ? JSON.stringify(next satisfies BrandTarget[]) : String(owned.competitors_json);
  const insert = db()
    .prepare(
      `INSERT INTO brand_decision_events(id,workspace_id,project_id,seq,kind,brand_key,undoes,payload_json,author,created_at)
       SELECT ?,?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM brand_decision_events WHERE project_id=?),?,?,?,?,?,?
       WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND competitor_targets_revision=? AND competitors_json=?)`,
    )
    // The list must be exactly what this batch's UPDATE writes (or, with no change, what we read):
    // a revision of revision+1 alone also appears when another save won the race.
    .bind(id, user.id, projectId, projectId, kind, key, undoes, JSON.stringify(payload), user.email, now(), projectId, user.id, changed ? revision + 1 : revision, nextJson);
  try {
    const results = await db().batch(
      changed
        ? [
            db()
              .prepare(
                'UPDATE projects SET competitors_json=?,competitor_targets_revision=competitor_targets_revision+1 WHERE id=? AND workspace_id=? AND competitor_targets_revision=?',
              )
              .bind(nextJson, projectId, user.id, revision),
            insert,
          ]
        : [insert],
    );
    if (!results.at(-1)?.meta.changes)
      throw new ApiError(409, 'The brand list changed. Reload and try again.');
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('brand_decision_events.undoes'))
      throw new ApiError(409, 'This decision was already undone or does not exist.');
    if (message.includes('brand_decision_events'))
      throw new ApiError(409, 'The brand list changed. Reload and try again.');
    throw error;
  }
  forgetBrandsOverview(projectId, user.id);
  // The decision is saved: the analysis it restarts and the counted discoveries follow after the answer (a few store and
  // D1 round trips, seconds on a busy store). The Brands screen starts the analysis itself if it reads before (needsEnsure).
  waitUntil(afterDecision(projectId, user.id, changed));
  return { ok: true, id, changed, analysisScheduled: changed };
}

async function afterDecision(projectId: string, workspaceId: string, changed: boolean) {
  // The Worker keeps this alive about 30 s after the answer, and a store busy with its alarms answers slowly: what matters
  // most goes first.
  if (changed)
    // A busy store can answer 503 for a moment: asked again twice, 2 and 4 s later (the next visit to Brands also asks).
    // It is asked again until the store's job follows the new targets (an answer that still says needsEnsure counts as a miss).
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const started = await ensureCompetitorAnalysis(projectId, workspaceId);
        if (started?.publicationPending || !(await competitorAnalysisStatus(projectId, workspaceId)).needsEnsure) break;
      } catch {
        /* Asked again below. */
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  // A rejection, a merge or their undo changes which discoveries share of voice and position count.
  await syncCountedBrands(projectId, workspaceId).catch(() => {});
  if (changed)
    try {
      // Only for when the store does not answer: while it does, it serves the last complete list itself (`previous`).
      const before = await competitorAnalysisStatus(projectId, workspaceId);
      const list = before.previous ?? (before.suggestions.length ? { suggestions: before.suggestions, analyzed: before.status === 'complete' ? before.processed : 0 } : null);
      if (list?.suggestions.length)
        await db().prepare('INSERT OR REPLACE INTO system_state(key,value) VALUES(?,?)').bind(savedKey(projectId), JSON.stringify(list)).run();
    } catch {
      /* Only the list shown while the store is unreachable. */
    }
  forgetBrandsOverview(projectId, workspaceId);
}
