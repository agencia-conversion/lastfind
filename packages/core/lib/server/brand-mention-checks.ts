import { brandKey } from '@/lib/brand-decisions';
import {
  CANARY_CATEGORIES,
  MENTION_CHECK_BATCH,
  MENTION_CHECK_CONTEXT,
  MENTION_CHECK_CONTEXTS,
  MENTION_CHECK_MONTHLY_USD,
  MENTION_CHECK_RESERVE_USD,
  MENTION_OWN_BATCH,
  MENTION_HOMONYM_RESERVE_USD,
  MENTION_OWN_PROMPT_VERSION,
  MENTION_OWN_SURE,
  MENTION_PROMPT_VERSION,
  MENTION_READER_RESERVE_USD,
  MENTION_TIEBREAK_SIZE,
  brandMentions,
  homonymSearchRequest,
  mentionCard,
  mentionReaderDecisionRequest,
  mentionReaderRequest,
  parseHomonymSearch,
  parseMentionReader,
  parseMentionReaderDecision,
  quoteFound,
  mentionProfile,
  mentionRulesEvidence,
  mentionTiebreakQuestion,
  mentionTiebreakRequest,
  parseMentionTiebreak,
  type MentionTiebreak,
  mentionCheckRequest,
  mentionQuestion,
  parseMentionCheckResponse,
  type MentionAsk,
  type MentionCard,
  type MentionCheck,
  type MentionHomonym,
  type MentionVerdict,
} from '@/lib/brand-mention-check';
import { ROLE_RETRY_AFTER_MS } from '@/lib/brand-roles';
import { buildTargetSnapshot } from '@/lib/target-snapshot.mjs';
import type { BrandTarget } from '@/lib/types';
import { db, now } from './env';
import { claimDecisionJob, completeDecisionJob, DecisionProviderError, failDecisionJob, hash, markStaleUnknown, requestDecisions } from './decision-jobs';
import { postChat } from './decisions-api';
import { mentionConfirmModel, mentionModel, mentionReaderModel, mentionTiebreakModel } from './classifier-models';
import { getProjectStore } from './project-store';
import { projectReadDatabase } from './project-store-read';
import { projectStoreRpc } from './project-store-transport';
import { ownedProject } from './workspace';
import { countryIso, countryName } from '@/lib/countries';
import { isDecisionModel } from '@/lib/classifier-models';
import { AGENT_MODEL } from '@/lib/agent';
import { citedEvidence } from './cited-sources';
import { readerEvidence } from '@/lib/cited-sources';
import type { Citation } from '@/lib/types';
import { decisionKeyConfigured } from './model-routes';

/** Pending questions read per project and step (ten requests at most). */
const PENDING_PER_STEP = MENTION_CHECK_BATCH * 10;
/** Verdicts per store message (the store refuses more). */
const VERDICTS_PER_MESSAGE = 100;
const CONTEXTS_SQL = `context_key IN (${MENTION_CHECK_CONTEXTS.map((context) => `'${context}'`).join(',')})`;
/** A project's checks this month (before v12 too), reservations included: what its monthly limit is compared with. */
const PROJECT_SPENT_SQL = `SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs WHERE ${CONTEXTS_SQL} AND project_id=? AND requested_at>=?`;
/** The project's monthly limit: its own (NULL is unlimited), else MENTION_CHECK_MONTHLY_USD. */
const LIMIT_SQL = `COALESCE((SELECT CASE WHEN monthly_usd IS NULL THEN 1e12 ELSE monthly_usd END FROM brand_mention_settings WHERE project_id=?),?)`;
const DAY_MS = 86_400_000;
export const monthStart = () => `${now().slice(0, 7)}-01T00:00:00.000Z`;

export type MentionBudget = {
  /** The monthly limit in US$, null when unlimited. */
  cap: number | null;
  custom: boolean;
  spent: number;
  /** The last 7 days' spend a day, and the days it leaves of this month's limit (null: no spend, or unlimited). */
  dailyUsd: number;
  daysLeft: number | null;
  /** Not one more request fits this month: the mentions left wait, not counted. */
  exhausted: boolean;
  /** Past 80% of the limit. */
  alarm: boolean;
  /** Questions the project's store still has to ask (the Worker's last step), null before the first. */
  pending: number | null;
};

/** Each project's mention-check budget this month (Admin › Algorithms and the project's Settings › Competitors). */
export async function mentionBudgets(projectIds: string[]): Promise<Map<string, MentionBudget>> {
  if (!projectIds.length) return new Map();
  const month = monthStart();
  const week = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const { results } = await db()
    .prepare(
      `SELECT p.value id,s.monthly_usd cap,s.project_id IS NOT NULL custom,st.pending,
        (SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs j WHERE j.${CONTEXTS_SQL} AND j.project_id=p.value AND j.requested_at>=?) spent,
        (SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs j WHERE j.${CONTEXTS_SQL} AND j.project_id=p.value AND j.requested_at>=?) week
      FROM json_each(?) p LEFT JOIN brand_mention_settings s ON s.project_id=p.value LEFT JOIN brand_mention_status st ON st.project_id=p.value`,
    )
    .bind(month, week, JSON.stringify(projectIds))
    .all<{ id: string; cap: number | null; custom: number; pending: number | null; spent: number; week: number }>();
  return new Map(
    results.map((row) => {
      const cap = row.custom ? row.cap : MENTION_CHECK_MONTHLY_USD;
      const spent = Number(row.spent ?? 0);
      const dailyUsd = Number(row.week ?? 0) / 7;
      const left = cap === null ? null : Math.max(0, cap - spent);
      return [
        row.id,
        {
          cap,
          custom: !!row.custom,
          spent,
          dailyUsd,
          daysLeft: left === null || dailyUsd <= 0 ? null : Math.floor(left / dailyUsd),
          exhausted: cap !== null && spent + MENTION_CHECK_RESERVE_USD > cap,
          alarm: cap !== null && cap > 0 && spent > cap * 0.8,
          pending: row.pending == null ? null : Number(row.pending),
        },
      ];
    }),
  );
}

type Pending = { run_id: string; brand: string; slot: 'active' | 'pending'; request_json: string };
/**
 * Whether the own brand's verdict goes to the tie-breaker: unclear, or counted under MENTION_OWN_SURE (or without a
 * probability). An operator's decision never does.
 */
const escalates = (question: { own: boolean }, verdict: { choice: string; counted: boolean; p: number | null }) =>
  question.own && verdict.choice !== 'operator' && (verdict.choice === 'unclear' || (verdict.counted && (verdict.p ?? 0) < MENTION_OWN_SURE));
type Question = { rows: Pending[]; ask: MentionAsk; card: MentionCard; strict: boolean; own: boolean };
const identity = (row: { run_id: string; brand: string; slot: string }) => `${row.run_id}\n${row.brand}\n${row.slot}`;
// Rows to (re)ask: no verdict yet, or decided under another model, prompt or card than now. Held rows are left out inside
// the LIMIT, so a request in flight never blocks the queue.
const OPEN_SQL = `FROM mention_asks m WHERE m.brand IN (SELECT key FROM json_each(?))
  AND (m.counted IS NULL OR m.decided_config IS NOT (SELECT value FROM json_each(?) WHERE key=m.brand))`;

/**
 * The mentions of common-word brands the store could not settle by text (lib/brand-mention-check.ts), a step per project.
 * Each pending row is the exact question for one answer, brand and overlay; its key (`check_key`) is a digest of the model
 * asked and the whole question, so a verdict kept in D1 (`brand_mention_verdicts`) is reused only for that same question
 * (free), and the rest go to the decision model (Admin › Classifiers `brand_mentions`, never a fallback), up to
 * MENTION_CHECK_BATCH distinct questions per request, with at most one canary (a fake card, monitor only). Each request is a
 * `brand_research_jobs` row reserved before it leaves, under the platform's ceilings and, in the same statement, the
 * project's monthly limit (its Settings › Competitors, MENTION_CHECK_MONTHLY_USD by default): at the limit nothing more is
 * reserved and the mentions left wait, not counted. A request that may have been billed is never sent again. Returns the
 * requests sent. `free` (a preview's imported verdicts, 12/11/2026): only the kept verdicts are applied, nothing is asked or
 * searched, and it returns the questions it settled.
 */
export async function checkMentions(projectId: string, workspaceId: string, budget: { left: number; deadline: number }, { free = false } = {}) {
  const registry = await getProjectStore(projectId, workspaceId);
  if (!registry?.initialized) return 0;
  const database = db();
  const store = await projectReadDatabase(projectId, workspaceId, registry);
  const project = await ownedProject(projectId, workspaceId);
  const targets = buildTargetSnapshot(project) as BrandTarget[];
  const category = typeof project.category === 'string' ? project.category : '';
  const model = mentionModel();
  // The project's market and monitored topics: what tells a same-named business elsewhere from this one.
  const { results: tags } = await database
    .prepare("SELECT DISTINCT tag FROM prompts WHERE project_id=? AND archived=0 AND TRIM(COALESCE(tag,''))<>'' ORDER BY tag LIMIT 12")
    .bind(projectId)
    .all<{ tag: string }>();
  const location = Number(project.location_code);
  const market = [countryIso(location) ? countryName(location) : '', typeof project.language_code === 'string' ? project.language_code : ''].filter(Boolean).join(', ');
  const context = { market, topics: tags.map((row) => row.tag) };
  // The own brand's card also lists the businesses named like it elsewhere, searched once (ownHomonyms); until then none.
  const readerModel = mentionReaderModel();
  // The search writes names and searches the web: a chat model, the agent's when the reader is a decision model.
  const searchModel = isDecisionModel(readerModel) ? AGENT_MODEL : readerModel;
  const ownBase = targets[0] ? mentionCard(targets[0], true, category, context) : null;
  const searchKey = ownBase ? await hash(`${searchModel}\n${JSON.stringify(ownBase)}`) : '';
  let homonyms = ownBase ? await storedHomonyms(projectId, searchKey) : null;
  let cards = new Map<string, MentionCard>();
  const configs: Record<string, string> = {};
  // An operator's decision in Admin bumps `revision`: every row re-opens once and takes the kept verdicts again, for free.
  const status = await database.prepare('SELECT revision FROM brand_mention_status WHERE project_id=?').bind(projectId).first<{ revision: number }>();
  // The own brand's rows also depend on its tie-breaker's and reader's models: changing one re-opens them.
  const tiebreakModel = mentionTiebreakModel();
  const confirmModel = mentionConfirmModel();
  const shape = async () => {
    cards = new Map(targets.map((target, index) => [target.name, mentionCard(target, index === 0, category, index === 0 ? { ...context, homonyms: homonyms ?? [] } : context)]));
    for (const [name, card] of cards) {
      const own = name === targets[0]?.name;
      configs[name] = `${model}|${own ? MENTION_OWN_PROMPT_VERSION : MENTION_PROMPT_VERSION}|${(await hash(JSON.stringify(card))).slice(0, 16)}|${status?.revision ?? 0}${own ? `|${tiebreakModel}|${readerModel}|${confirmModel}` : ''}`;
    }
  };
  await shape();
  const scope = { ownerId: workspaceId, projectId, generation: registry.generation };
  const open = await database
    .prepare(`SELECT input_json FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND ${CONTEXTS_SQL} AND status IN ('pending','submitting','unknown','failed') AND (status<>'failed' OR cost_usd>0)`)
    .bind(projectId, workspaceId)
    .all<{ input_json: string }>();
  const heldKeys = new Set<string>();
  const heldRows = new Set<string>();
  for (const row of open.results) {
    try {
      for (const check of JSON.parse(row.input_json).checks as { key: string; rows?: string[] }[]) {
        heldKeys.add(check.key);
        for (const held of check.rows ?? []) heldRows.add(held);
      }
    } catch {
      /* A row that cannot be read holds no checks. */
    }
  }
  let brands = JSON.stringify(configs);
  const { results: pending } = await store
    .prepare(`SELECT m.run_id,m.brand,m.slot,m.request_json ${OPEN_SQL} AND (m.run_id||char(10)||m.brand||char(10)||m.slot) NOT IN (SELECT value FROM json_each(?)) ORDER BY m.run_id,m.brand,m.slot LIMIT ?`)
    .bind(brands, brands, JSON.stringify([...heldRows]), PENDING_PER_STEP)
    .all<Pending>({ cache: false });
  // The first time the own brand has a question to ask, the one search for its same-named businesses (within the budget).
  if (!free && homonyms === null && ownBase && category.trim() && decisionKeyConfigured() && pending.some((row) => row.brand === targets[0]!.name)) {
    homonyms = await searchHomonyms(projectId, workspaceId, searchModel, ownBase, searchKey);
    if (homonyms) {
      await shape();
      brands = JSON.stringify(configs);
    }
  }
  const send = async (verdicts: [string, string, 'active' | 'pending', string, boolean, string][]) => {
    for (let start = 0; start < verdicts.length; start += VERDICTS_PER_MESSAGE)
      await projectStoreRpc({ scope, action: 'mention-verdicts', verdicts: verdicts.slice(start, start + VERDICTS_PER_MESSAGE) });
  };
  const sendQuestion = (question: Question, verdict: { counted: boolean }) =>
    question.rows.map((row) => [row.run_id, row.brand, row.slot, row.request_json, verdict.counted, configs[row.brand]!] as [string, string, 'active' | 'pending', string, boolean, string]);
  // One question per distinct check_key: the same evidence in two overlays, or in two answers, is asked once.
  const questions = new Map<string, Question>();
  for (const row of pending) {
    const card = cards.get(row.brand);
    let ask: MentionAsk;
    try {
      ask = JSON.parse(row.request_json) as MentionAsk;
    } catch {
      continue;
    }
    if (!card || typeof ask?.excerpt !== 'string' || !Array.isArray(ask.options)) continue;
    // A name question ("Amazon Prime Video" for a monitored name) is asked once per pair, never the own brand's two-question path.
    const own = row.brand === targets[0]?.name && !ask.pair;
    const key = await hash(`${model}\n${JSON.stringify(mentionQuestion(ask, card, own))}`);
    const question = questions.get(key) ?? { rows: [], ask, card, strict: !category.trim(), own };
    question.rows.push(row);
    questions.set(key, question);
  }
  let asked = 0;
  let settledFree = 0;
  if (questions.size) {
    const { results: kept } = await database
      .prepare("SELECT check_key,counted,choice,p_counted p FROM brand_mention_verdicts WHERE project_id=? AND canary=0 AND stage='main' AND check_key IN (SELECT value FROM json_each(?))")
      .bind(projectId, JSON.stringify([...questions.keys()]))
      .all<{ check_key: string; counted: number; choice: string; p: number | null }>();
    const known = new Map(kept.map((row) => [row.check_key, row]));
    // The own brand's unclear verdicts, and its counts under MENTION_OWN_SURE, go to the tie-breaker (one per question, by
    // its parent key); until it answers the rows stay open, not counted. What it left unclear is decided not counted and
    // listed for an operator.
    const unclearOwn = [...questions].filter(([key, question]) => { const verdict = known.get(key); return !!verdict && escalates(question, { choice: verdict.choice, counted: verdict.counted === 1, p: verdict.p }); }).map(([key]) => key);
    const { results: broken } = unclearOwn.length
      ? await database
          .prepare("SELECT parent_key,counted,choice,request_json FROM brand_mention_verdicts WHERE project_id=? AND stage='tiebreak' AND model=? AND parent_key IN (SELECT value FROM json_each(?))")
          .bind(projectId, tiebreakModel, JSON.stringify(unclearOwn))
          .all<{ parent_key: string; counted: number; choice: string; request_json: string | null }>()
      : { results: [] };
    const tiebroken = new Map(broken.map((row) => [row.parent_key, row]));
    // What the tie-breaker left unclear goes to the reader (readMention); its readings, kept by the parent key, decide: a
    // settled one, else not counted (the operator's list), except the reader's "homonym" still waiting for the second reader.
    const unsure = broken.filter((row) => row.choice === 'unclear').map((row) => row.parent_key);
    const { results: readings } = unsure.length
      ? await database
          .prepare(`SELECT parent_key,counted,settled,entity,quote,model FROM brand_mention_readings WHERE project_id=? AND model IN (?,?,'${SOURCES_MODEL}') AND parent_key IN (SELECT value FROM json_each(?))`)
          .bind(projectId, readerModel, confirmModel, JSON.stringify(unsure))
          .all<{ parent_key: string; counted: number; settled: number; entity: string; quote: string | null; model: string }>()
      : { results: [] };
    const settled = new Map(readings.filter((row) => row.settled).map((row) => [row.parent_key, row.counted === 1]));
    const confirmed = new Set(readings.filter((row) => row.model === confirmModel).map((row) => row.parent_key));
    // The reader's "homonym" waits for the second reader (another model) when its quote is in the window.
    const homonym = new Map(
      readings.filter((row) => confirmModel !== readerModel && row.model === readerModel && row.entity === 'homonym' && !confirmed.has(row.parent_key)).map((row) => [row.parent_key, row.quote ?? '']),
    );
    const readParents = new Set(readings.map((row) => row.parent_key));
    const tiebreak: [string, Question][] = [];
    const reading: [string, Question, MentionAsk][] = [];
    const fromKept = [...questions].flatMap(([key, question]) => {
      const verdict = known.get(key);
      if (!verdict) return [];
      if (escalates(question, { choice: verdict.choice, counted: verdict.counted === 1, p: verdict.p })) {
        const broke = tiebroken.get(key);
        if (broke && broke.choice !== 'unclear') return sendQuestion(question, { counted: broke.counted === 1 });
        if (broke) {
          if (settled.has(key)) return sendQuestion(question, { counted: settled.get(key)! });
          const window = askOf(broke.request_json);
          const waiting = !!window && homonym.has(key) && quoteFound(window, homonym.get(key)!);
          if (readParents.has(key) && !waiting) return sendQuestion(question, { counted: false });
          if (window && !heldKeys.has(key)) reading.push([key, question, window]);
          return [];
        }
        if (!heldKeys.has(key)) tiebreak.push([key, question]);
        return [];
      }
      return sendQuestion(question, { counted: verdict.counted === 1 });
    });
    // The rows settled by kept verdicts (what a `free` pass returns).
    settledFree = fromKept.length;
    await send(fromKept);
    const ask = [...questions].filter(([key]) => !known.has(key) && !heldKeys.has(key));
    if (!free && decisionKeyConfigured()) {
      if (ask.length) {
        const fresh = await askModel(projectId, workspaceId, model, category, ask, budget);
        asked += fresh.asked;
        await send(fresh.verdicts.flatMap(([key, question, verdict]) => (escalates(question, verdict) ? (tiebreak.push([key, question]), []) : sendQuestion(question, verdict))));
      }
      const apply = (question: Question, verdict: MentionVerdict) => send(sendQuestion(question, verdict));
      const reader: Reader = { model: readerModel, confirm: confirmModel, profile: await ownProfile(workspaceId, projectId), country: countryIso(location) ?? null, language: typeof project.language_code === 'string' ? project.language_code : '' };
      if (tiebreak.length) asked += await breakTies(projectId, workspaceId, store, targets, tiebreakModel, tiebreak, budget, apply, reader);
      const cited = await citationsOf(store, reading.map(([, question]) => question.rows[0]!.run_id));
      for (const [parent, question, window] of reading) {
        if (budget.left <= 0 || Date.now() > budget.deadline) break;
        const verdict = await readMention(projectId, workspaceId, reader, parent, question, window, reader.profile ? { ...question.card, profile: reader.profile } : question.card, cited.get(question.rows[0]!.run_id) ?? [], budget);
        if (verdict) {
          asked++;
          await apply(question, verdict);
        }
      }
    }
  }
  await saveStatus(projectId, store, brands);
  return free ? settledFree : asked;
}

/** The pending count and the common-word counters of the project's store, kept in D1 for Admin. */
async function saveStatus(projectId: string, store: Awaited<ReturnType<typeof projectReadDatabase>>, brands: string) {
  const [row] = (
    await store
      .prepare(`SELECT (SELECT COUNT(*) ${OPEN_SQL}) pending,(SELECT value FROM store_meta WHERE key='mention_common') common`)
      .bind(brands, brands)
      .all<{ pending: number; common: string | null }>({ cache: false })
  ).results;
  let common: string | null = null;
  try {
    // Only the counters of the newest revision (the active analysis or the pass in progress).
    const saved = JSON.parse(row?.common ?? 'null') as Record<string, { counters?: unknown }> | null;
    const last = saved ? Object.values(saved).at(-1)?.counters : undefined;
    common = last ? JSON.stringify(last).slice(0, 8000) : null;
  } catch {
    common = null;
  }
  await db()
    .prepare(
      `INSERT INTO brand_mention_status(project_id,pending,common_json,updated_at) VALUES(?,?,?,?)
       ON CONFLICT(project_id) DO UPDATE SET pending=excluded.pending,common_json=excluded.common_json,updated_at=excluded.updated_at
       WHERE brand_mention_status.pending IS NOT excluded.pending OR brand_mention_status.common_json IS NOT excluded.common_json`,
    )
    .bind(projectId, Math.max(0, Number(row?.pending ?? 0)), common, now())
    .run();
}

/** A number from a hex digest, to pick positions and names from a batch's key the same way on every retry. */
const pick = (digest: string, from: number, modulo: number) => (modulo > 0 ? parseInt(digest.slice(from, from + 8), 16) % modulo : 0);

/**
 * The canary of a batch, or null: a real excerpt of it whose marked name is capitalized and the brand's own, asked about a
 * fake business of the same name, at a plausible domain, in a fixed synthetic category (CANARY_CATEGORIES: never another
 * project's data), all picked from the batch key. Its verdict is only shown in Admin. None for a brand without category.
 */
function canaryFor(category: string, batch: [string, Question][], digest: string) {
  if (!category.trim()) return null;
  const candidates = batch.filter(([, question]) => /\p{Lu}/u.test(question.ask.span) && [question.card.name, ...question.card.aliases].some((name) => name.trim().toLowerCase() === question.ask.span.trim().toLowerCase()));
  if (!candidates.length) return null;
  const kinds = CANARY_CATEGORIES.filter((kind) => kind !== category.trim().toLowerCase());
  const [, real] = candidates[pick(digest, 0, candidates.length)]!;
  const letters = digest.replace(/[^a-f]/gu, '').padEnd(4, 'x').slice(0, 4);
  const slug = real.card.name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '') || 'brand';
  const card: MentionCard = { name: real.card.name, aliases: [], domains: [`${slug}${letters}.com`], what: kinds[pick(digest, 8, kinds.length)]!, ...(real.card.market ? { market: real.card.market } : {}) };
  return { card, ask: real.ask, at: pick(digest, 16, batch.length + 1) };
}

/** The Decisions request for one batch, its job and its D1 verdicts; null when no job could be reserved, a throw when it failed. */
async function askBatch(
  projectId: string,
  workspaceId: string,
  model: string,
  batch: [string, Question][],
  canary: { card: MentionCard; ask: MentionAsk; at: number } | null,
) {
  const database = db();
  const batchKey = await hash(batch.map(([key]) => key).sort().join('\n'));
  const canaryKey = canary ? await hash(`${model}\n${JSON.stringify(mentionQuestion(canary.ask, canary.card))}`) : null;
  const checks: MentionCheck[] = batch.map(([key, question]) => ({ key, ask: question.ask, card: question.card, seed: key, strict: question.strict, own: question.own }));
  if (canary && canaryKey) checks.splice(Math.min(canary.at, checks.length), 0, { key: canaryKey, ask: canary.ask, card: canary.card, seed: canaryKey });
  const jobId = await claimDecisionJob({
    projectId,
    workspaceId,
    contextKey: MENTION_CHECK_CONTEXT,
    provider: 'brand-mentions',
    model,
    inputKey: await hash(`${MENTION_CHECK_CONTEXT}:${model}:${batchKey}:${canaryKey ?? ''}`),
    reserveUsd: MENTION_CHECK_RESERVE_USD,
    inputJson: JSON.stringify({ checks: batch.map(([key, question]) => ({ key, rows: question.rows.map(identity) })), canary: canaryKey }),
    retryAfterMs: ROLE_RETRY_AFTER_MS,
    cap: { sql: `(${PROJECT_SPENT_SQL})+?<=${LIMIT_SQL}`, params: [projectId, monthStart(), MENTION_CHECK_RESERVE_USD, projectId, MENTION_CHECK_MONTHLY_USD] },
  });
  if (!jobId) return null;
  try {
    // No fallback: a verdict is kept under the model asked, and only that model passed the gate.
    const result = await requestDecisions(model, null, {
      label: 'Brand mentions',
      payload: (engine) => mentionCheckRequest(engine, checks),
      parse: (raw, engine) => parseMentionCheckResponse(raw, engine, checks),
    });
    const verdicts = result.model === model ? result.verdicts : result.verdicts.map((verdict) => ({ ...verdict, choice: 'unclear', counted: false }));
    const done = now();
    const share = result.cost == null ? null : result.cost / checks.length;
    const byKey = new Map(checks.map((check, index) => [check.key, verdicts[index]!]));
    await database.batch([
      completeDecisionJob(jobId, result, JSON.stringify([...byKey]), MENTION_CHECK_RESERVE_USD, done),
      ...checks.map((check) => {
        const verdict = byKey.get(check.key)!;
        const isCanary = check.key === canaryKey;
        const row = isCanary ? null : batch.find(([key]) => key === check.key)![1].rows[0]!;
        // The project's own brand keeps every question it was asked: Admin audits them and lists the unclear ones.
        const kept = check.own ? JSON.stringify(check.ask) : null;
        return database
          .prepare(`INSERT INTO brand_mention_verdicts(project_id,check_key,run_id,brand_key,choice,counted,p_counted,canary,model,cost_usd,decided_at,own,request_json)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM brand_research_jobs WHERE id=? AND completed_at=? AND status IN ('completed','unsettled'))
          ON CONFLICT(project_id,check_key) DO NOTHING`)
          .bind(projectId, check.key, row?.run_id ?? '', brandKey(row?.brand ?? check.card.name), verdict.choice, Number(verdict.counted), verdict.p, Number(isCanary), result.model, share, done, Number(!!check.own), kept, jobId, done);
      }),
    ]);
    return batch.map(([key, question]) => [key, question, byKey.get(key)!] as [string, Question, MentionVerdict]);
  } catch (error) {
    await failDecisionJob(jobId, error, MENTION_CHECK_RESERVE_USD, 'Brand mention');
    throw error;
  }
}

/**
 * The questions no verdict answers yet: the own brand's alone (MENTION_OWN_BATCH), the others MENTION_CHECK_BATCH a request
 * with at most one canary each, and, when only the own brand is asked, one canary request of its own per step.
 */
async function askModel(projectId: string, workspaceId: string, model: string, category: string, ask: [string, Question][], budget: { left: number; deadline: number }) {
  await markStaleUnknown('brand-mentions:', MENTION_CHECK_RESERVE_USD);
  const own = ask.filter(([, question]) => question.own);
  const others = ask.filter(([, question]) => !question.own);
  const batches: [string, Question][][] = [];
  for (let start = 0; start < others.length; start += MENTION_CHECK_BATCH) batches.push(others.slice(start, start + MENTION_CHECK_BATCH));
  for (let start = 0; start < own.length; start += MENTION_OWN_BATCH) batches.push(own.slice(start, start + MENTION_OWN_BATCH));
  const verdicts: [string, Question, MentionVerdict][] = [];
  let asked = 0;
  let canaried = false;
  // A request cooling down after a failure (a provider's 504) must not hold the queue behind it: the next batches go on.
  // Three refusals in a row (the monthly limit, a platform ceiling) or two failures end the step.
  let refused = 0;
  let failed = 0;
  for (const batch of batches) {
    if (budget.left <= 0 || Date.now() > budget.deadline || refused >= 3 || failed >= 2) break;
    const shared = !batch[0]![1].own;
    const canary = shared ? canaryFor(category, batch, await hash(batch.map(([key]) => key).sort().join('\n'))) : null;
    try {
      const answered = await askBatch(projectId, workspaceId, model, batch, canary);
      if (!answered) {
        refused++;
        continue;
      }
      refused = 0;
      budget.left--;
      asked++;
      canaried ||= !!canary;
      verdicts.push(...answered);
    } catch (error) {
      budget.left--;
      asked++;
      failed++;
      console.warn(`Brand mentions: ${error instanceof Error ? error.message : 'failed'}; the mentions wait, not counted.`);
    }
  }
  // The own brand alone asked: one canary of its own, so its yes rate is still watched.
  const ownAsked = verdicts.filter(([, question]) => question.own);
  if (!canaried && ownAsked.length && budget.left > 0 && Date.now() <= budget.deadline) {
    const digest = await hash(ownAsked.map(([key]) => key).sort().join('\n'));
    const canary = canaryFor(category, ownAsked.map(([key, question]) => [key, question] as [string, Question]), digest);
    if (canary) {
      try {
        if (await askBatch(projectId, workspaceId, model, [], { ...canary, at: 0 })) {
          budget.left--;
          asked++;
        }
      } catch {
        /* A canary that failed only leaves Admin's rate as it was. */
      }
    }
  }
  return { asked, verdicts };
}

/** The project's common words and generic terms of its newest pass, as the store keeps them (`mention_common`). */
async function commonOf(store: Awaited<ReturnType<typeof projectReadDatabase>>) {
  const [row] = (await store.prepare("SELECT value FROM store_meta WHERE key='mention_common'").all<{ value: string }>({ cache: false })).results;
  try {
    const saved = JSON.parse(row?.value ?? 'null') as Record<string, { names?: string[]; terms?: string[] }> | null;
    const last = saved ? Object.values(saved).at(-1) : null;
    return { names: new Set(last?.names ?? []), terms: new Set(last?.terms ?? []) };
  } catch {
    return { names: new Set<string>(), terms: new Set<string>() };
  }
}

/**
 * The own brand's tie-breaker: one request per question to a stronger model (Admin › Classifiers
 * `brand_mentions_tiebreak`), over the whole answer of the question's first row (MENTION_TIEBREAK_SIZE) and what the text
 * rules saw in it. Its verdict is kept in D1 under its own key, with the parent question's key; counted at 0.9 or more,
 * not at 0.1 or less, else unclear (decided not counted, and listed in Admin for an operator). Same jobs ledger, ceilings
 * and project budget as the questions. Returns the requests sent.
 */
async function breakTies(
  projectId: string,
  workspaceId: string,
  store: Awaited<ReturnType<typeof projectReadDatabase>>,
  targets: BrandTarget[],
  model: string,
  items: [string, Question][],
  budget: { left: number; deadline: number },
  apply: (question: Question, verdict: MentionVerdict) => Promise<unknown>,
  reader: Reader,
) {
  const database = db();
  const common = await commonOf(store);
  const { results: runs } = await store
    .prepare('SELECT id,answer,sources_json,prompt_text FROM runs WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(items.map(([, question]) => question.rows[0]!.run_id))]))
    .all<{ id: string; answer: string | null; sources_json: string | null; prompt_text: string | null }>({ cache: false });
  const byRun = new Map(runs.map((run) => [run.id, run]));
  const { profile } = reader;
  let asked = 0;
  let refused = 0;
  let failed = 0;
  for (const [parent, question] of items) {
    if (budget.left <= 0 || Date.now() > budget.deadline) break;
    const run = byRun.get(question.rows[0]!.run_id);
    if (!run?.answer) continue;
    const citations = citationList(run.sources_json);
    const sources = citations.map((source) => source.domain);
    const [result] = brandMentions(run.answer, targets, common.names, sources, common.terms, run.prompt_text ?? '', MENTION_TIEBREAK_SIZE);
    // The rules settle it now (a pass with another window): the next pass asks again if needed.
    if (!result || typeof result !== 'object') continue;
    const rules = mentionRulesEvidence(run.answer, targets, 0);
    const card = profile ? { ...question.card, profile } : question.card;
    const question2 = mentionTiebreakQuestion(result.request, card, rules);
    const key = await hash(`${model}\n${JSON.stringify(question2)}\n${parent}`);
    const check: MentionTiebreak = { key, ask: result.request, card, seed: key, rules };
    const jobId = await claimDecisionJob({
      projectId,
      workspaceId,
      contextKey: MENTION_CHECK_CONTEXT,
      provider: 'brand-mentions-tiebreak',
      model,
      inputKey: await hash(`${MENTION_CHECK_CONTEXT}:tiebreak:${key}`),
      reserveUsd: MENTION_CHECK_RESERVE_USD,
      inputJson: JSON.stringify({ checks: [{ key: parent, rows: question.rows.map(identity) }], tiebreak: key }),
      retryAfterMs: ROLE_RETRY_AFTER_MS,
      cap: { sql: `(${PROJECT_SPENT_SQL})+?<=${LIMIT_SQL}`, params: [projectId, monthStart(), MENTION_CHECK_RESERVE_USD, projectId, MENTION_CHECK_MONTHLY_USD] },
    });
    if (!jobId) {
      if (++refused >= 3) break;
      continue;
    }
    refused = 0;
    budget.left--;
    asked++;
    try {
      const answer = await requestDecisions(model, null, {
        label: 'Brand mention tie-breaker',
        payload: (engine) => mentionTiebreakRequest(engine, [check]),
        parse: (raw, engine) => parseMentionTiebreak(raw, engine, [check]),
      });
      const verdict = answer.model === model ? answer.verdicts[0]! : { choice: 'unclear', counted: false, p: null };
      const done = now();
      await database.batch([
        completeDecisionJob(jobId, answer, JSON.stringify([[key, verdict]]), MENTION_CHECK_RESERVE_USD, done),
        database
          .prepare(`INSERT INTO brand_mention_verdicts(project_id,check_key,run_id,brand_key,choice,counted,p_counted,canary,model,cost_usd,decided_at,own,request_json,stage,parent_key)
          SELECT ?,?,?,?,?,?,?,0,?,?,?,1,?,'tiebreak',? WHERE EXISTS(SELECT 1 FROM brand_research_jobs WHERE id=? AND completed_at=? AND status IN ('completed','unsettled'))
          ON CONFLICT(project_id,check_key) DO NOTHING`)
          .bind(projectId, key, run.id, brandKey(question.card.name), verdict.choice, Number(verdict.counted), verdict.p, answer.model, answer.cost, done, JSON.stringify({ ...result.request, rules }).slice(0, 20000), parent, jobId, done),
      ]);
      if (verdict.choice !== 'unclear') await apply(question, verdict);
      else if (budget.left > 0 && Date.now() <= budget.deadline) {
        // Unsure on the whole answer too: the reader reads the same window; until it answers the rows wait, not counted.
        const read = await readMention(projectId, workspaceId, reader, parent, question, result.request, card, citations, budget);
        if (read) {
          asked++;
          await apply(question, read);
        }
      }
    } catch (error) {
      await failDecisionJob(jobId, error, MENTION_CHECK_RESERVE_USD, 'Brand mention tie-breaker');
      console.warn(`Brand mention tie-breaker: ${error instanceof Error ? error.message : 'failed'}; the mention waits, not counted.`);
      if (++failed >= 2) break;
    }
  }
  return asked;
}

/**
 * What the project wrote about itself (its Brain's first files): it tells the tie-breaker and the reader the services and
 * facts that set the brand apart from a same-named business. Empty when it has no Brain.
 */
async function ownProfile(workspaceId: string, projectId: string) {
  const { results: files } = await db()
    .prepare('SELECT title,content FROM agent_artifacts WHERE workspace_id=? AND project_id=? AND brain=1 AND memory=0 AND deleted_at IS NULL ORDER BY created_at,rowid LIMIT 3')
    .bind(workspaceId, projectId)
    .all<{ title: string; content: string }>()
    .catch(() => ({ results: [] as { title: string; content: string }[] }));
  return mentionProfile(files);
}

/** The reader of the own brand's residual: its model, the project's profile and market (the cited pages' cues). */
type Reader = { model: string; confirm: string; profile: string; country: string | null; language: string };
/** The readings the cited pages settle are kept under this name instead of a model's. */
const SOURCES_MODEL = 'cited-sources';
/** An answer's cited sources (`runs.sources_json`), web addresses only. */
function citationList(json: string | null): Citation[] {
  try {
    const list = JSON.parse(json || '[]') as Partial<Citation>[];
    return Array.isArray(list)
      ? list.filter((item) => item && typeof item.url === 'string' && typeof item.domain === 'string').map((item) => ({ url: item.url!, domain: item.domain!, title: typeof item.title === 'string' ? item.title : '' }))
      : [];
  } catch {
    return [];
  }
}
/** The cited sources of these answers, read from the project's store. */
async function citationsOf(store: Awaited<ReturnType<typeof projectReadDatabase>>, runIds: string[]) {
  if (!runIds.length) return new Map<string, Citation[]>();
  const { results } = await store
    .prepare('SELECT id,sources_json FROM runs WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(runIds)]))
    .all<{ id: string; sources_json: string | null }>({ cache: false });
  return new Map(results.map((row) => [row.id, citationList(row.sources_json)]));
}

/** A tie-breaker's stored window (`request_json`) as an ask, or null when it cannot be read. */
function askOf(json: string | null): MentionAsk | null {
  try {
    const ask = JSON.parse(json ?? 'null') as MentionAsk | null;
    return ask && typeof ask.excerpt === 'string' && Array.isArray(ask.options) ? ask : null;
  } catch {
    return null;
  }
}

/** The same-named businesses found for this card (null: never searched). */
async function storedHomonyms(projectId: string, searchKey: string) {
  const row = await db().prepare('SELECT homonyms_json FROM brand_mention_homonyms WHERE project_id=? AND search_key=?').bind(projectId, searchKey).first<{ homonyms_json: string }>();
  if (!row) return null;
  try {
    const list = JSON.parse(row.homonyms_json);
    return Array.isArray(list) ? (list as MentionHomonym[]) : [];
  } catch {
    return [];
  }
}

/**
 * The one search for the own brand's same-named businesses (homonymSearchRequest), a job of the project's checks (same
 * ledger, ceilings and monthly budget), kept per project and card in `brand_mention_homonyms`. Null when it was not done
 * now (refused by a cap, cooling down after a failure, or failed): the questions go on without it.
 */
async function searchHomonyms(projectId: string, workspaceId: string, model: string, card: MentionCard, searchKey: string) {
  const jobId = await claimDecisionJob({
    projectId,
    workspaceId,
    contextKey: MENTION_CHECK_CONTEXT,
    provider: 'brand-mentions-homonyms',
    model,
    inputKey: await hash(`${MENTION_CHECK_CONTEXT}:homonyms:${searchKey}`),
    reserveUsd: MENTION_HOMONYM_RESERVE_USD,
    inputJson: JSON.stringify({ checks: [], homonyms: searchKey }),
    retryAfterMs: ROLE_RETRY_AFTER_MS,
    cap: { sql: `(${PROJECT_SPENT_SQL})+?<=${LIMIT_SQL}`, params: [projectId, monthStart(), MENTION_HOMONYM_RESERVE_USD, projectId, MENTION_CHECK_MONTHLY_USD] },
  });
  if (!jobId) return null;
  try {
    const result = await requestDecisions(model, null, { label: 'Brand mention homonyms', post: postChat, timeoutMs: 120_000, payload: (engine) => homonymSearchRequest(engine, card), parse: parseHomonymSearch });
    const found = mentionCard({ name: card.name, domain: card.domains[0] ?? '', domains: card.domains.slice(1), aliases: [] } as BrandTarget, true, '', { homonyms: result.homonyms }).homonyms ?? [];
    const done = now();
    await db().batch([
      completeDecisionJob(jobId, result, JSON.stringify({ homonyms: found.length }), MENTION_HOMONYM_RESERVE_USD, done),
      db()
        .prepare('INSERT INTO brand_mention_homonyms(project_id,search_key,homonyms_json,model,cost_usd,searched_at) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,search_key) DO NOTHING')
        .bind(projectId, searchKey, JSON.stringify(found), result.model, result.cost, done),
    ]);
    return found;
  } catch (error) {
    await failDecisionJob(jobId, error, MENTION_HOMONYM_RESERVE_USD, 'Brand mention homonyms');
    console.warn(`Brand mention homonyms: ${error instanceof Error ? error.message : 'failed'}; the questions go on without them.`);
    return null;
  }
}

/**
 * The own brand's reader on what the tie-breaker left unclear: the cited pages first (free), then one chat reading of the
 * same window (`chatRead`), settled when it counts the card or rules out another entity with its quote in the text; its
 * quoted "homonym" goes to the second reader (v14), which settles it as not counted when it also says a same-named business
 * or another entity. Anything else is not counted and listed in Admin for an operator.
 */
async function readMention(
  projectId: string,
  workspaceId: string,
  reader: Reader,
  parent: string,
  question: Question,
  ask: MentionAsk,
  card: MentionCard,
  citations: readonly Citation[],
  budget: { left: number; deadline: number },
): Promise<MentionVerdict | null> {
  const database = db();
  const { model } = reader;
  // First the cited pages (free, kept for every project), by the links code read on them only: an entry linking the name to
  // the card's site counts when no cited page links it elsewhere, one linking to a same-named site does not, a conflict goes
  // to an operator; anything else is evidence for the reader (its text delimited and untrusted).
  const evidence = citations.length
    ? await citedEvidence(ask.excerpt, citations, ask.span || card.name, { domains: card.domains, country: reader.country, language: reader.language }, projectId)
    : { entries: [], verdict: null };
  if (evidence.verdict) {
    const sourcesKey = await hash(`${SOURCES_MODEL}\n${parent}\n${JSON.stringify(evidence.entries.map((item) => [item.url, item.link, item.linked_domain]))}`);
    const counted = evidence.verdict === 'counted';
    const settled = evidence.verdict !== 'conflict';
    const domains = [...new Set(evidence.entries.filter((item) => item.linked_domain).map((item) => `${item.link} ${item.linked_domain}`))].join(', ');
    await database
      .prepare('INSERT INTO brand_mention_readings(project_id,check_key,parent_key,run_id,entity,quote,counted,settled,model,cost_usd,decided_at) VALUES(?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(project_id,check_key) DO NOTHING')
      .bind(projectId, sourcesKey, parent, question.rows[0]!.run_id, counted ? 'card' : settled ? 'homonym' : 'unclear', `Cited pages link it to: ${domains}`.slice(0, 300), Number(counted), Number(settled), SOURCES_MODEL, now())
      .run();
    return { choice: counted ? 'same_business' : settled ? 'other_entity' : 'unclear', counted, p: null };
  }
  const cited = readerEvidence(evidence.entries);
  const first = await chatRead(projectId, workspaceId, model, 'reader', parent, question, ask, card, cited, budget, (read) => read.verdict);
  // A chat reader backs its entity with a quote found in the answer; a decision model writes none, its label probability is the backing.
  const backed = (reading: string, quote: string) => isDecisionModel(reading) || quoteFound(ask, quote);
  if (!first || first.entity !== 'homonym' || reader.confirm === model || !backed(model, first.quote)) return first?.verdict ?? null;
  // v14: "a same-named business" is final only when a second reader of another model says it too (or another entity), with
  // its own quote in the answer; otherwise not counted and listed for an operator. Until it answers the rows wait.
  const second = await chatRead(projectId, workspaceId, reader.confirm, 'confirm', parent, question, ask, card, cited, budget, (read) =>
    (read.entity === 'homonym' && backed(reader.confirm, read.quote)) || read.verdict.choice === 'other_entity' ? { choice: 'other_entity', counted: false, p: null } : UNCLEAR,
  );
  return second?.verdict ?? null;
}

const UNCLEAR: MentionVerdict = { choice: 'unclear', counted: false, p: null };

/**
 * One chat reading of the own brand's window (mentionReaderRequest) by `model`, kept in `brand_mention_readings` by its key
 * and the parent question's; `decide` turns the parsed answer into the verdict kept (`settled` when it is not unclear). A
 * kept reading is free. An answer that came back unreadable, or a call that may have been billed, is final (`failed`, not
 * counted); a refusal or a cap returns null and the rows wait.
 */
async function chatRead(
  projectId: string,
  workspaceId: string,
  model: string,
  role: 'reader' | 'confirm',
  parent: string,
  question: Question,
  ask: MentionAsk,
  card: MentionCard,
  cited: ReturnType<typeof readerEvidence>,
  budget: { left: number; deadline: number },
  decide: (read: ReturnType<typeof parseMentionReader>) => MentionVerdict,
): Promise<{ verdict: MentionVerdict; entity: string; quote: string } | null> {
  const database = db();
  // A decision model (9/11/2026, chosen in Admin) reads the same data as one closed question; a chat model quotes the text.
  const decision = isDecisionModel(model);
  const sent = decision ? (() => { const { state, questions } = mentionReaderDecisionRequest(model, ask, card, cited); return { state, questions }; })() : mentionReaderRequest(model, ask, card, cited).messages;
  const key = await hash(`${model}\n${JSON.stringify(sent)}\n${parent}${role === 'confirm' ? '\nconfirm' : ''}`);
  const kept = await database
    .prepare('SELECT counted,settled,entity,quote FROM brand_mention_readings WHERE project_id=? AND check_key=?')
    .bind(projectId, key)
    .first<{ counted: number; settled: number; entity: string; quote: string | null }>();
  if (kept) return { verdict: { choice: kept.counted ? 'same_business' : kept.settled ? 'other_entity' : 'unclear', counted: kept.counted === 1, p: null }, entity: kept.entity, quote: kept.quote ?? '' };
  if (budget.left <= 0 || Date.now() > budget.deadline) return null;
  const label = role === 'confirm' ? 'Brand mention second reader' : 'Brand mention reader';
  const jobId = await claimDecisionJob({
    projectId,
    workspaceId,
    contextKey: MENTION_CHECK_CONTEXT,
    provider: role === 'confirm' ? 'brand-mentions-confirm' : 'brand-mentions-reader',
    model,
    inputKey: await hash(`${MENTION_CHECK_CONTEXT}:${role}:${key}`),
    reserveUsd: MENTION_READER_RESERVE_USD,
    inputJson: JSON.stringify({ checks: [{ key: parent, rows: question.rows.map(identity) }], reader: key }),
    retryAfterMs: ROLE_RETRY_AFTER_MS,
    cap: { sql: `(${PROJECT_SPENT_SQL})+?<=${LIMIT_SQL}`, params: [projectId, monthStart(), MENTION_READER_RESERVE_USD, projectId, MENTION_CHECK_MONTHLY_USD] },
  });
  if (!jobId) return null;
  budget.left--;
  const keep = (verdict: MentionVerdict, entity: string, quote: string, cost: number | null, used: string, done: string) =>
    database
      .prepare('INSERT INTO brand_mention_readings(project_id,check_key,parent_key,run_id,entity,quote,counted,settled,model,cost_usd,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,check_key) DO NOTHING')
      .bind(projectId, key, parent, question.rows[0]!.run_id, entity, quote, Number(verdict.counted), Number(verdict.choice !== 'unclear'), used, cost, done);
  try {
    const answer = decision
      ? await requestDecisions(model, null, { label, timeoutMs: 60_000, payload: (engine) => mentionReaderDecisionRequest(engine, ask, card, cited), parse: (raw, engine) => parseMentionReaderDecision(raw, engine) })
      : await requestDecisions(model, null, { label, post: postChat, timeoutMs: 60_000, payload: (engine) => mentionReaderRequest(engine, ask, card, cited), parse: (raw) => parseMentionReader(raw, ask) });
    const verdict = answer.model === model ? decide(answer) : UNCLEAR;
    const done = now();
    await database.batch([completeDecisionJob(jobId, answer, JSON.stringify([[key, verdict]]), MENTION_READER_RESERVE_USD, done), keep(verdict, answer.entity, answer.quote, answer.cost, answer.model, done)]);
    return { verdict, entity: answer.entity, quote: answer.quote };
  } catch (error) {
    await failDecisionJob(jobId, error, MENTION_READER_RESERVE_USD, label);
    console.warn(`${label}: ${error instanceof Error ? error.message : 'failed'}; the mention waits, not counted.`);
    const final = error instanceof DecisionProviderError && (error.unknown || (error.status >= 200 && error.status < 300));
    if (!final) return null;
    await keep(UNCLEAR, 'failed', '', error.cost, model, now()).run();
    return { verdict: UNCLEAR, entity: 'failed', quote: '' };
  }
}

/**
 * An operator's decision on an `unclear` verdict of a project's own brand (Admin › Algorithms): it becomes `operator`,
 * counted or not, and the project's questions re-open once so the store takes it (free: from D1). False when there was
 * no such verdict.
 */
export async function resolveMentionVerdict(projectId: string, checkKey: string, counted: boolean) {
  const database = db();
  const changed = await database
    .prepare(
      `UPDATE brand_mention_verdicts SET choice='operator',counted=?,decided_at=? WHERE project_id=? AND check_key=? AND own=1 AND canary=0 AND stage='main' AND choice<>'operator'
       AND EXISTS(SELECT 1 FROM brand_mention_verdicts t WHERE t.project_id=brand_mention_verdicts.project_id AND t.parent_key=brand_mention_verdicts.check_key AND t.stage='tiebreak' AND t.choice='unclear')`,
    )
    .bind(Number(counted), now(), projectId, checkKey)
    .run();
  if (!changed.meta.changes) return false;
  await database
    .prepare(
      `INSERT INTO brand_mention_status(project_id,pending,updated_at,revision) VALUES(?,0,?,1)
       ON CONFLICT(project_id) DO UPDATE SET revision=brand_mention_status.revision+1,updated_at=excluded.updated_at`,
    )
    .bind(projectId, now())
    .run();
  return true;
}
