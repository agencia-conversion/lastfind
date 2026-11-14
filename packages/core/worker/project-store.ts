import { DurableObject } from 'cloudflare:workers';
import { competitorIdentity } from '../lib/competitor-identity';
import { MAX_COMPETITORS } from '../lib/brand-decisions';
import {
  MAX_KEPT_RESPONSE_CHARS,
  RUN_STORE_COLUMNS,
  PROMPT_STORE_COLUMNS,
  storeColumns,
  canonicalStoreRow,
  extendStoreDigest,
  validStoreScope,
  type StoreEntity,
  type StoreMessage,
  type StoreQuery,
  type StoreRow,
  type StoreValue,
  type StoreScope,
  type StoreChange,
} from '../lib/project-store-contract';
import type { BotDay } from '../lib/ai-bots';
import { matchesBrand, mentionOffsets, mentionText, normalizeText } from '../lib/metrics';
import { brandMentions, commonSpellings, pairLean } from '../lib/brand-mention-check';
import { agentBackupKey, backupPartKey, backupPrefix, type BackupManifest } from '../lib/project-backups';
import { POSITIONS_BASIS_SUFFIX, POSITIONS_VERSION, runPositionEntries } from '../lib/run-positions';
import { BRAND_COUNTED_SQL, BRAND_MERGED_SQL } from '../lib/server/run-rows';
import {
  EFFECTIVE_MENTIONS_SQL,
  EFFECTIVE_POSITIONS_BASIS_SQL,
  EFFECTIVE_TARGETS_SQL,
} from '../lib/server/run-rows';
import { canonicalCitationsJson } from '../lib/source-url.mjs';
import { PRODUCT_ENGINES, PRODUCTS_SCAN, cardText, extractProducts, httpsUrl, productKey, rawProviderResult } from '../lib/products';
import { brandKey } from '../lib/brand-decisions';
import {
  DETECTOR_VERSION,
  brandDetectionKey,
  lowercaseCounter,
  lowercaseFrom,
  mergeNameTally,
  resolveNames,
  tallyName,
  tallyNames,
  type CompetitorCandidate,
  type DiscoveryAnswer,
  type DiscoverySeed,
  type NameTally,
  type AnswerTallies,
  type BrandRole,
  extractBrandMentions,
  MAX_DISCOVERY_ANSWER_CHARACTERS,
  type LowercaseCounts,
  type LowercaseUse,
  type KnownBrand,
  trackedBrandKeys,
} from '../lib/competitor-discovery';

const RUN_NUMBERS = new Set([
  'response_available',
  'cost',
  'raw_response_bytes',
]);
const PROMPT_NUMBERS = new Set(['active', 'archived', 'subscribed']);
const defaults: Record<string, string> = {
  subscribed: '1',
  mentions_json: "'{}'",
  sources_json: "'[]'",
  search_queries_json: "'[]'",
  response_available: '1',
  cost: '0',
  raw_response_status: "'not_captured'",
};

type AnalysisJob = {
  revision: string;
  config_version: number;
  targets_json: string;
  cutoff: string;
  max_runs: number;
  processed: number;
  scanned: number;
  total_eligible: number;
  truncated: number;
  cursor_created_at: string | null;
  cursor_id: string | null;
  status: 'pending' | 'running' | 'complete' | 'failed';
  error: string | null;
  updated_at: string;
  seed_answers_json: string;
  /**
   * `extend`: a pass that reads again only the answers the target change can alter (extendDiff), the rest from the active
   * one's; `resolve`: the pages are done, the window's texts are read for lowercase words a part per alarm, then promoted.
   */
  phase: 'seeds' | 'analysis' | 'extend' | 'resolve';
  needs_rescan: number;
};
/** Rows of competitor_answer_names whose tag is no longer used, deleted this many per alarm (a whole window at once took seconds). */
const DROP_ROWS = 2000;
/**
 * Pages an extending alarm works before it lets the store answer reads again (it continues 50 ms later). Counted in pages,
 * not time: a Durable Object's clock stands still while it computes, so a time budget never ends inside one alarm.
 */
const EXTEND_PAGES_PER_ALARM = 4;
/** No request for this long (screens poll every few seconds): the store is idle, and an alarm does a larger share of the analysis (it ends at the next alarm). */
const IDLE_MS = 300;
/** Pages of a full pass an idle alarm reads (one while reads are coming); each page is alone in memory, their writes go together. */
const FULL_PAGES_IDLE = 4;
/**
 * The pause after every analysis alarm. A request that arrives during a turn is not seen as traffic until it runs, so
 * turns never follow each other closely: on the Netflix copy, two-second turns 10 ms apart made Cloudflare drop the queued
 * reads ("Durable Object is overloaded. Requests queued for too long.", in the preview Worker's log).
 */
const ALARM_GAP_MS = 250;
/** Answers written to the store this recently: the analysis waits (an import or a collection publishing in blocks). */
const WRITES_QUIET_MS = 3000;
/** Answers an extending page reads; only the ones it analyses again count against ANALYSIS_PAGE_SIZE and ANALYSIS_PAGE_BYTES. */
const EXTEND_PAGE_ROWS = 100;
/** Texts an alarm reads at the end of a pass for their lowercase words (lowercaseCounter): 200 while reads come, three times as many idle. */
const RESOLVE_TEXTS = 200;
/** Texts read between two saves of the counts: a new instance goes on from the last save (writing them every part cost more than counting). */
const RESOLVE_SAVE_TEXTS = 2000;
/** A text as the matcher (mentionText) and the detector (brandDetectionKey) fold it, without spaces or punctuation. */
const compactFolds = (text: string) => {
  const folds = [normalizeText(text), brandDetectionKey(text)].map((fold) => fold.replace(/[^\p{L}\p{N}]+/gu, ''));
  return folds[0] === folds[1] ? [folds[0]!] : folds;
};
/**
 * One answer's tally of one name as its row keeps it: `[key, spellings, answers, flags, role, italic answers, domains, excerpt]`
 * (flags: 1 structured, 2 listed, 4 company, 8 opener). The excerpt only while the answer is among the name's newest
 * MAX_EVIDENCE, the ones the list shows; a name's other answers get theirs read again if they ever become its newest.
 * Older rows kept the whole tally (an object).
 */
type PackedTally = [string, Record<string, number>, number, number, BrandRole, number, Record<string, number> | 0, string | null] | NameTally;
const packTally = (tally: NameTally, excerpt: boolean): PackedTally => [
  tally.key,
  tally.spellings,
  tally.answers,
  (tally.structured ? 1 : 0) | (tally.listed ? 2 : 0) | (tally.company ? 4 : 0) | (tally.opener ? 8 : 0),
  tally.role,
  tally.italicAnswers ?? 0,
  tally.domains ?? 0,
  excerpt ? (tally.evidence[0]?.excerpt ?? null) : null,
];
/** The tally packTally kept, as tallyNames gave it (a missing excerpt is null: resolveSuggestions reads it again when shown). */
function unpackTally(item: PackedTally, runId: string, createdAt: string): NameTally {
  if (!Array.isArray(item)) return item;
  const [key, spellings, answers, flags, role, italicAnswers, domains, excerpt] = item;
  return {
    key,
    spellings,
    answers,
    ...(flags & 1 ? { structured: true } : {}),
    ...(flags & 2 ? { listed: true } : {}),
    ...(flags & 4 ? { company: true } : {}),
    role,
    ...(flags & 8 ? { opener: true } : {}),
    ...(italicAnswers ? { italicAnswers } : {}),
    ...(domains ? { domains } : {}),
    evidence: [{ runId, createdAt, excerpt: excerpt as string }],
  };
}
type ExtendDiff = {
  /** Names of the targets the change leaves as they were. */
  kept: Set<string>;
  /** An answer that holds one of these (compactFolds) is analysed again: every spelling of an added, changed or removed target. */
  needles: string[];
  /** The changed targets' spellings as common words are read (mentionText): the common words of the others must not move. */
  spellings: Set<string>;
};

// A Durable Object gets 128 MB and one thread, and discovery holds the whole
// page plus its derived representations in memory while running synchronously.
// The peak tracks the bytes on the page, so the byte budget is what keeps it
// inside half the memory; the answer budget bounds the per-answer fixed cost,
// which is what the object blocks the thread for.
const ANALYSIS_PAGE_SIZE = 10;
const ANALYSIS_PAGE_BYTES = 256 * 1024;
const MAX_EVIDENCE = 3;
/** Names a status read returns: the most mentioned first, after the caller's exclusions (names the decision model settled as not competitors). */
const MAX_STATUS_SUGGESTIONS = 200;
/** Settled competitors a status read returns besides those (most mentioned first); ponytail: evidence travels for each, page it past this. */
const MAX_STATUS_COMPETITORS = 1000;
const ANALYSIS_WINDOW_MS = 90 * 86400000;

type DomainEvidenceState = 'none' | 'unique' | 'conflict';

function storeFlag(value: StoreValue | undefined, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) && value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 && Number(normalized) === 1;
  }
  return false;
}

/** Old tables without identities (ensureSuggestionIdentity): two rows of one identity keep a domain only if they agree. */
function mergeDomainEvidence(
  existing: { domain: string | null; state: DomainEvidenceState } | null,
  incoming: { domain: string | null; state: DomainEvidenceState },
) {
  if (existing?.state === 'conflict' || incoming.state === 'conflict')
    return { domain: null, state: 'conflict' as const };
  if (incoming.state === 'none')
    return existing ?? { domain: null, state: 'none' as const };
  if (!incoming.domain)
    return existing ?? { domain: null, state: 'none' as const };
  if (!existing || existing.state === 'none')
    return { domain: incoming.domain, state: 'unique' as const };
  if (existing.domain === incoming.domain) return existing;
  return { domain: null, state: 'conflict' as const };
}

/**
 * The detector's conclusion about a name, saved with the suggestion. Its comparison key is not kept: decisions and the
 * monitored list compare names with brandKey.
 */
type Detection = {
  ambiguous?: boolean;
  plain?: boolean;
  reasons?: string[];
  role?: string;
  days?: Record<string, number>;
  /** Answers of the window that write the name in lowercase. */
  lowercaseAnswers?: number;
  /** Answers of the window that write the name in italics (a title; structure-v6). */
  italicAnswers?: number;
  structured?: boolean;
  aliases?: string[];
};
function detectionOf(candidate: CompetitorCandidate): Detection {
  return {
    days: candidate.days ?? {},
    ambiguous: !!candidate.ambiguous,
    ...(candidate.plain ? { plain: true } : {}),
    lowercaseAnswers: candidate.lowercaseAnswers ?? 0,
    ...(candidate.italicAnswers ? { italicAnswers: candidate.italicAnswers } : {}),
    ...(candidate.structured ? { structured: true } : {}),
    ...(candidate.aliases?.length ? { aliases: candidate.aliases } : {}),
    reasons: candidate.reasons ?? [],
    ...(candidate.role && candidate.role !== 'competitor' ? { role: candidate.role } : {}),
  };
}
/** What a suggestion carries to the API: the detector's conclusion, not its working counts. */
function detectionView(json: string | null) {
  if (!json) return {};
  const { plain: _plain, lowercaseAnswers: _lowercase, italicAnswers: _italic, headOrdinary: _head, structured: _structured, ...view } = JSON.parse(json) as Detection & { headOrdinary?: boolean };
  return view;
}

// ponytail: the seed phase and these windows fed the statistical detector this module no longer uses; they stay
// only so jobs saved mid-phase finish as before. Remove them together with the 'seeds' phase.
function boundedSeedAnswer(answer: DiscoveryAnswer, targets: DiscoverySeed[]) {
  const lower = answer.answer.toLocaleLowerCase();
  const positions = targets
    .flatMap((target) => [target.name, ...(target.aliases || [])])
    .map((name) => lower.indexOf(name.toLocaleLowerCase()))
    .filter((position) => position >= 0);
  const center = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, center - 4000);
  return { ...answer, answer: answer.answer.slice(start, start + 8000) };
}

// Marks the mention ranks as pending. No ON CONFLICT clause: inside a trigger the firing statement's own policy would replace it.
const POSITIONS_PENDING = `UPDATE store_meta SET value='1' WHERE key='positions_pending' AND value<>'1';
  INSERT INTO store_meta(key,value) SELECT 'positions_pending','1' WHERE NOT EXISTS(SELECT 1 FROM store_meta WHERE key='positions_pending');`;
const RUN_POSITIONS_TABLE = `CREATE TABLE IF NOT EXISTS run_positions (
  run_id TEXT NOT NULL,basis TEXT NOT NULL,entries_json TEXT NOT NULL,PRIMARY KEY(run_id,basis)) WITHOUT ROWID`;
/**
 * Every column of a stored answer, in the order `runs` exposes them. `run_rows` holds them all but the answer text, which
 * lives in `run_answers`: a report reads only the columns it needs, so the analytical rows stay small (about a third of a
 * row with its text) and a cold store reads a few pages per answer instead of the whole text. The `answer` column of
 * `run_rows` is only the text of rows saved before the split, until the alarm has moved it (moveAnswersPage).
 */
const RUN_ROW_COLUMNS = [
  ...RUN_STORE_COLUMNS,
  'analysis_pending_revision',
  'analysis_pending_targets_json',
  'analysis_pending_mentions_json',
  // The discoveries (brand keys) the active analysis found in the answer: share of voice counts them (ANSWER_BRANDS_SQL).
  'analysis_brands_json',
] as const;
const RUN_ROWS_TABLE = `CREATE TABLE IF NOT EXISTS run_rows (${RUN_ROW_COLUMNS.map((c) => `${c} ${RUN_NUMBERS.has(c) ? 'NUMERIC' : 'TEXT'}${c === 'id' ? ' PRIMARY KEY' : ''}${defaults[c] ? ` DEFAULT ${defaults[c]}` : ''}`).join(',')})`;
// The text is a correlated subquery, not a join: SQLite only evaluates it for a query that uses `answer`. The rows keep
// `owner_id` (the store's own format, in every backup); reports name the workspace as the control database does, `workspace_id`.
const RUNS_VIEW = `CREATE VIEW runs AS SELECT ${RUN_ROW_COLUMNS.map((c) =>
  c === 'answer' ? 'COALESCE(r.answer,(SELECT a.answer FROM run_answers a WHERE a.run_id=r.id)) answer' : `r.${c}`,
).join(',')},r.owner_id workspace_id FROM run_rows r`;
/** Answers whose text one alarm moves into `run_answers` (about 1.5 MB). */
const ANSWER_MOVE_PAGE = 250;

/**
 * Report results kept by the store (report_cache), keyed by the exact statements and valid for one `data_epoch`: every
 * write a report can see (answers, prompts, assessments, the active analysis) advances the epoch through triggers, so a
 * kept result is always the one the statements would return now. Statements on tables written outside the epoch
 * (competitor analysis, products/offers, store bookkeeping) or on the clock are never kept.
 */
const UNCACHED_TABLES =
  /\b(competitor_analysis_jobs|competitor_suggestions|mention_checks|mention_asks|competitor_suggestions_staging|competitor_answer_names|run_products|run_offers|run_offer_scans|store_versions|report_cache|report_templates|bot_hits|bot_days|bot_referrals|referral_pages|site_paths|sqlite_\w+)\b|'now'|random\(|current_(date|time)/i;
const ACTIVE_ANALYSIS_SQL = "(SELECT value FROM store_meta WHERE key='analysis_revision')";
// A Durable Object's isolate (128 MB) is shared by several stores: what a store keeps and scans stays at a few megabytes.
const MAX_CACHED_RESULT_BYTES = 1024 * 1024;
const MAX_CACHED_RESULTS = 300;
const MAX_CACHED_BYTES = 12 * 1024 * 1024;
/** Whole responses kept (kept_responses): how many, how many characters in all, and per response (the Worker sends none larger). */
const MAX_KEPT_RESPONSES = 120;
/** Newest copies kept per read whatever the data (stale-while-revalidate), a few reads per screen and filter. */
const MAX_LAST_RESPONSES = 40;
const MAX_KEPT_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Default first-screen reads the store recomputes after each change (report_templates), and for how long after their last use. */
const MAX_WARM_TEMPLATES = 48;
const WARM_TEMPLATE_TTL_MS = 7 * 86400000;
/**
 * Quiet time after a change before recomputing, and the gap between two recomputations: a large project's first-screen read
 * takes seconds, and 48 of them 50 ms apart kept the store busy enough for Cloudflare to drop queued reads ("Durable Object
 * is overloaded"). A collection publishes on every scheduler tick (5 minutes) for an hour or more, and sentiment, the brand
 * analysis and the decision models land after it: with 20 s every one of those changes recomputed every remembered read
 * (6.3 million rows for a project of 10,000 answers), and the next change threw the result away. Ten minutes lets a burst
 * settle first, so a day's collection is recomputed a few times instead of dozens (docs/costs.md).
 */
const WARM_QUIET_MS = 10 * 60_000;
/** The longest the recomputation waits for the data to settle (changes on every tick all day). */
const WARM_MAX_WAIT_MS = 60 * 60_000;
const WARM_GAP_MS = 1000;
const EPOCH_BUMP = `UPDATE store_meta SET value=CAST(value AS INTEGER)+1 WHERE key='data_epoch';
  INSERT INTO store_meta(key,value) SELECT 'data_epoch','1' WHERE NOT EXISTS(SELECT 1 FROM store_meta WHERE key='data_epoch');`;
type ReportRead = { asked: string[]; snapped: string[]; warm?: boolean };
type WarmTemplate = { statements: StoreQuery[]; slots: [number, number, number][]; asked: string[]; rolling: boolean };
async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Later than any `created_at` (ISO 8601 text), so `created_at<?` keeps every answer and `created_at>=?` none. */
const AFTER_EVERY_ANSWER = '9999-12-31T23:59:59.999Z';
// Pages of 300 answers a `status` with `fill` ranks before it answers; a project with more pending leaves the rest to `positions-fill`.
const STATUS_FILL_PAGES = 8;
/**
 * A background backup (backup-start): the NDJSON of exportProjectStore, written by the alarm to the private bucket in
 * numbered parts. Each alarm turn writes pages for a few seconds; a change to the data between pages starts it again.
 */
type BackupJob = {
  id: string;
  status: 'running' | 'ready' | 'failed';
  revision: number;
  prefix: string;
  /** data_epoch and analysis mutation revision when the pass started: any other value means the data changed. */
  signature: string;
  attempts: number;
  started: boolean;
  entity: StoreEntity;
  cursor: string;
  digest: string;
  digests: Record<StoreEntity, string>;
  counts: Record<StoreEntity, number>;
  parts: number;
  bytes: number;
  manifest?: BackupManifest;
  error?: string;
};
const BACKUP_SLICE_MS = 5000;
const BACKUP_PART_BYTES = 4 * 1024 * 1024;
const BACKUP_ATTEMPTS = 20;
const BACKUP_ENTITIES: StoreEntity[] = ['prompts', 'runs', 'semantic_evaluations'];

/**
 * One turn of a background restore (lib/server/project-restores.ts restoreStep), set by the Worker entry: the store
 * module itself never imports the Worker's server code.
 */
let restoreDriver: ((id: string) => Promise<boolean>) | undefined;
export const setRestoreDriver = (step: (id: string) => Promise<boolean>) => {
  restoreDriver = step;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export class ProjectStore extends DurableObject<Record<string, unknown>> {
  /**
   * The end of a pass's lowercase counter while this instance lives: `saved`, the job cursor its last saved counts reached;
   * `cursor`, the text it has read up to since (saved again every RESOLVE_SAVE_TEXTS texts).
   */
  private resolving: { saved: string; segment: number; cursor: string; unsaved: number; counter: ReturnType<typeof lowercaseCounter> } | null = null;
  /** When this instance last answered a request, and last received answers (apply): how much an alarm may do now. */
  private lastRequest = 0;
  private lastWrite = 0;
  /** The schema checks of `fetch` ran in this instance (ensureRunPositions and the products/offers tables). */
  private ensured = false;
  /** Inside an alarm: the analysis steps need not compute the status a caller would read. */
  private quiet = false;
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS store_versions (entity TEXT,id TEXT,revision INTEGER NOT NULL,PRIMARY KEY(entity,id))',
    );
    this.ensureRunSplit();
    sql.exec(
      `CREATE TABLE IF NOT EXISTS prompts (${PROMPT_STORE_COLUMNS.map((c) => `${c} ${PROMPT_NUMBERS.has(c) ? 'INTEGER' : 'TEXT'}${c === 'id' ? ' PRIMARY KEY' : ''}${defaults[c] ? ` DEFAULT ${defaults[c]}` : ''}`).join(',')})`,
    );
    const promptColumns = new Set(sql.exec<{ name: string }>('PRAGMA table_info(prompts)').toArray().map((column) => column.name));
    for (const [column, type] of [['unit_id', 'TEXT'], ['engines_override_json', 'TEXT'], ['subscribed', 'INTEGER NOT NULL DEFAULT 1']])
      if (!promptColumns.has(column)) sql.exec(`ALTER TABLE prompts ADD COLUMN ${column} ${type}`);
    sql.exec('CREATE INDEX IF NOT EXISTS prompts_unit ON prompts(unit_id)');
    sql.exec(`CREATE TABLE IF NOT EXISTS semantic_evaluations (
      id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,config_revision INTEGER NOT NULL,
      assessment_json TEXT NOT NULL,answer_sha256 TEXT NOT NULL,
      rubric TEXT NOT NULL,model TEXT NOT NULL,coverage TEXT NOT NULL,
      cost_usd REAL NOT NULL,created_at TEXT NOT NULL)`);
    sql.exec('CREATE INDEX IF NOT EXISTS semantic_project_date ON semantic_evaluations(project_id,created_at)');
    sql.exec('CREATE INDEX IF NOT EXISTS semantic_run ON semantic_evaluations(run_id)');
    sql.exec(
      'CREATE INDEX IF NOT EXISTS runs_project_date ON run_rows(project_id,created_at,id)',
    );
    sql.exec(
      'CREATE INDEX IF NOT EXISTS runs_prompt_date ON run_rows(prompt_id,created_at,id)',
    );
    sql.exec(
      'CREATE INDEX IF NOT EXISTS runs_status_date ON run_rows(status,created_at,id)',
    );
    // One prompt's answers of a period (the prompt page and every read filtered by a prompt): without statistics SQLite
    // would read the whole period by status or project and test each answer (reports.ts reads a prompt with `+r.project_id`).
    sql.exec(
      'CREATE INDEX IF NOT EXISTS runs_prompt_status_date ON run_rows(prompt_id,status,created_at)',
    );
    sql.exec(
      'CREATE INDEX IF NOT EXISTS prompts_topic ON prompts(project_id,tag)',
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS competitor_analysis_jobs (
        id INTEGER PRIMARY KEY CHECK(id=1),revision TEXT NOT NULL,config_version INTEGER NOT NULL,
        targets_json TEXT NOT NULL,
        cutoff TEXT NOT NULL,max_runs INTEGER NOT NULL,processed INTEGER NOT NULL DEFAULT 0,
        scanned INTEGER NOT NULL DEFAULT 0,phase TEXT NOT NULL DEFAULT 'seeds',
        truncated INTEGER NOT NULL DEFAULT 0,
        total_eligible INTEGER NOT NULL DEFAULT 0,cursor_created_at TEXT,cursor_id TEXT,
        status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,
        seed_answers_json TEXT NOT NULL DEFAULT '[]',
        needs_rescan INTEGER NOT NULL DEFAULT 0)`,
    );
    const jobColumns = new Set(
      sql
        .exec<{ name: string }>('PRAGMA table_info(competitor_analysis_jobs)')
        .toArray()
        .map((column) => column.name),
    );
    if (!jobColumns.has('needs_rescan'))
      sql.exec(
        'ALTER TABLE competitor_analysis_jobs ADD COLUMN needs_rescan INTEGER NOT NULL DEFAULT 0',
      );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS competitor_suggestions (
        revision TEXT NOT NULL,name TEXT NOT NULL,identity TEXT NOT NULL,
        domain TEXT,domain_state TEXT NOT NULL,score REAL NOT NULL,
        answer_count INTEGER NOT NULL,evidence_json TEXT NOT NULL,
        detection_json TEXT,
        PRIMARY KEY(revision,name),UNIQUE(revision,identity))`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS competitor_suggestions_staging (
        revision TEXT NOT NULL,name TEXT NOT NULL,identity TEXT NOT NULL,
        domain TEXT,domain_state TEXT NOT NULL,score REAL NOT NULL,
        answer_count INTEGER NOT NULL,evidence_json TEXT NOT NULL,
        detection_json TEXT,
        PRIMARY KEY(revision,name),UNIQUE(revision,identity))`,
    );
    // The names each answer of the pass writes (structure-v7): the end of the pass counts every family once per answer.
    sql.exec(
      `CREATE TABLE IF NOT EXISTS competitor_answer_names (
        revision TEXT NOT NULL,run_id TEXT NOT NULL,created_at TEXT NOT NULL,keys_json TEXT NOT NULL,
        PRIMARY KEY(revision,run_id)) WITHOUT ROWID`,
    );
    // Each answer's own tallies (the window's are their sum), kept for the active analysis (activeTag); `reused`: carried from
    // it unread by an extending pass, with the ranks it carries for the new reading (`positions_basis`, `positions_json`).
    const nameColumns = new Set(sql.exec<{ name: string }>('PRAGMA table_info(competitor_answer_names)').toArray().map((column) => column.name));
    for (const [column, type] of [['tallies_json', 'TEXT'], ['reused', 'INTEGER NOT NULL DEFAULT 0'], ['positions_basis', 'TEXT'], ['positions_json', 'TEXT']])
      if (!nameColumns.has(column)) sql.exec(`ALTER TABLE competitor_answer_names ADD COLUMN ${column} ${type}`);
    // The end of a pass's working state (`names`, `counts`: megabytes on a large window), apart from store_meta, which every
    // request reads whole (authorize).
    sql.exec('CREATE TABLE IF NOT EXISTS analysis_resolve (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    // The active analysis's lowercase counts over its answers (`names`, `counts`): an extending pass adds the answers it gained
    // and takes off the ones it lost, and reads every text only for names the active analysis did not count.
    sql.exec('CREATE TABLE IF NOT EXISTS analysis_lowercase (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    // The mentions of a common-word brand only the decision model can settle (lib/brand-mention-check.ts), one per
    // answer and brand: pending (no verdict) until the Worker sends it (`mention-verdicts`), and kept across passes.
    sql.exec(
      `CREATE TABLE IF NOT EXISTS mention_checks (
        run_id TEXT NOT NULL,brand TEXT NOT NULL,excerpt TEXT NOT NULL,verdict INTEGER,
        PRIMARY KEY(run_id,brand)) WITHOUT ROWID`,
    );
    // v12: mention_checks is no longer written (its CREATE stays so older stores open). Each question asked about
    // a mention, per answer, brand and overlay (`slot`: the active analysis or the pass in progress), as the exact JSON the
    // decision model will read: a verdict applies only to that JSON, and `decided_config` (model, prompt and card) re-opens
    // it when any of them changes, the previous verdict staying applied until the new one lands.
    sql.exec(
      `CREATE TABLE IF NOT EXISTS mention_asks (
        run_id TEXT NOT NULL,brand TEXT NOT NULL,slot TEXT NOT NULL CHECK(slot IN ('active','pending')),
        request_json TEXT NOT NULL,counted INTEGER,decided_config TEXT,
        PRIMARY KEY(run_id,brand,slot)) WITHOUT ROWID`,
    );
    // Before structure-v7, the one-word names some page vouched for; the window decides that now.
    sql.exec('DROP TABLE IF EXISTS competitor_attributed_names');
    this.ensureSuggestionIdentity('competitor_suggestions');
    this.ensureSuggestionIdentity('competitor_suggestions_staging');
    this.ensureRunProductsTable();
    this.ensureRunOffersTable();
    this.ensureRunPositions();
    this.ensureReportCache();
    // Rows stored before the source catalog keep their original URLs until the
    // alarm has rewritten them page by page (canonicalizeSourcesPage); rows stored
    // before the split keep their text inline until it moves them (moveAnswersPage).
    // Answers stored before Products (or before its extraction changed) have their cards read from the archive (scanProductsPage).
    if (this.meta('owner') && (this.meta('sources_canonical') !== 'done' || this.meta('answers_split') === 'pending' || this.meta('products_scan') !== PRODUCTS_SCAN))
      void ctx.blockConcurrencyWhile(async () => {
        await this.alarmBy(Date.now() + 50);
      });
  }

  /**
   * Schema step of the answer split (see RUN_ROW_COLUMNS). A store from before it renames its `runs` table to `run_rows`
   * (its rows, indexes and triggers keep their identity) and marks the text as still inline; the alarm then moves it
   * into `run_answers` in bounded pages while `runs` reads either place. A new store starts split.
   */
  private ensureRunSplit() {
    const sql = this.ctx.storage.sql;
    const type = (name: string) =>
      sql.exec<{ type: string }>('SELECT type FROM sqlite_master WHERE name=?', name).toArray()[0]?.type;
    if (type('runs') === 'table')
      this.ctx.storage.transactionSync(() => {
        // Its column list named `answer`; the split's version is created by ensureRunPositions.
        sql.exec('DROP TRIGGER IF EXISTS run_positions_update');
        sql.exec('ALTER TABLE runs RENAME TO run_rows');
        if (sql.exec('SELECT 1 FROM run_rows LIMIT 1').toArray().length) this.setMeta('answers_split', 'pending');
      });
    sql.exec(RUN_ROWS_TABLE);
    const columns = new Set(sql.exec<{ name: string }>('PRAGMA table_info(run_rows)').toArray().map((column) => column.name));
    for (const column of RUN_ROW_COLUMNS)
      if (!columns.has(column)) sql.exec(`ALTER TABLE run_rows ADD COLUMN ${column} TEXT`);
    sql.exec('CREATE TABLE IF NOT EXISTS run_answers (run_id TEXT PRIMARY KEY,answer TEXT NOT NULL)');
    const view = sql.exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='view' AND name='runs'").toArray()[0]?.sql;
    if (view !== RUNS_VIEW)
      this.ctx.storage.transactionSync(() => {
        if (view) sql.exec('DROP VIEW runs');
        sql.exec(RUNS_VIEW);
      });
  }

  /** Moves the inline text of up to `size` rows saved before the split into `run_answers`. True while rows remain. */
  private moveAnswersPage(size = ANSWER_MOVE_PAGE) {
    if (this.meta('answers_split') !== 'pending') return false;
    const sql = this.ctx.storage.sql;
    const after = this.meta('answers_split_cursor') ?? '';
    const last = sql
      .exec<{ id: string }>('SELECT id FROM run_rows WHERE id>? ORDER BY id LIMIT 1 OFFSET ?', after, size - 1)
      .toArray()[0]?.id;
    this.ctx.storage.transactionSync(() => {
      const range = last ? 'id>? AND id<=?' : 'id>?';
      const bounds = last ? [after, last] : [after];
      // A row published after the split already has its text in run_answers and none inline.
      sql.exec(
        `INSERT INTO run_answers(run_id,answer) SELECT id,answer FROM run_rows WHERE ${range} AND answer IS NOT NULL ON CONFLICT(run_id) DO NOTHING`,
        ...bounds,
      );
      sql.exec(`UPDATE run_rows SET answer=NULL WHERE ${range} AND answer IS NOT NULL`, ...bounds);
      if (last) this.setMeta('answers_split_cursor', last);
      else this.setMeta('answers_split', 'done');
    });
    return !!last;
  }

  /** The report cache, its warm list and the triggers that advance `data_epoch` (see UNCACHED_TABLES). */
  private ensureReportCache() {
    const sql = this.ctx.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS report_cache (key TEXT PRIMARY KEY,epoch INTEGER NOT NULL,results TEXT NOT NULL,bytes INTEGER NOT NULL,stored_at INTEGER NOT NULL)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS report_templates (key TEXT PRIMARY KEY,template TEXT NOT NULL,used_at INTEGER NOT NULL,warmed_epoch INTEGER NOT NULL DEFAULT -1)',
    );
    // Reads remembered with the counted-brands join of 30/10 took 30 s on a large project: recomputing one reset
    // the store on every alarm. They are forgotten; the screens remember the current reads again.
    sql.exec("DELETE FROM report_templates WHERE template LIKE '%counted_brands%'");
    // Whole responses (keepCopy). The text comes last, so reading a row's size, age or epoch never walks its overflow pages.
    // The first layout (response_copies, before the text was last and copies of older data were removed) is dropped: a cache.
    sql.exec('DROP TABLE IF EXISTS response_copies');
    sql.exec(
      'CREATE TABLE IF NOT EXISTS kept_responses (key TEXT PRIMARY KEY,epoch INTEGER NOT NULL,bytes INTEGER NOT NULL,stored_at INTEGER NOT NULL,value TEXT NOT NULL)',
    );
    sql.exec('CREATE INDEX IF NOT EXISTS kept_responses_age ON kept_responses(stored_at)');
    // The newest copy of a read whatever the data: painted at once, as stale, while the read is computed again.
    sql.exec('CREATE TABLE IF NOT EXISTS last_responses (base TEXT PRIMARY KEY,bytes INTEGER NOT NULL,stored_at INTEGER NOT NULL,value TEXT NOT NULL)');
    // run_positions is not here: ranks only fill in what the answers already imply, and nothing is kept while they are pending.
    const tracked: [string, string, string][] = [
      ['run_rows', 'INSERT', ''],
      ['run_rows', 'DELETE', ''],
      // The pending analysis columns are a pass in progress, which reports never read.
      ['run_rows', `UPDATE OF ${RUN_STORE_COLUMNS.join(',')}`, ''],
      ['run_answers', 'INSERT', ''],
      ['run_answers', 'UPDATE', ''],
      ['run_answers', 'DELETE', ''],
      ['prompts', 'INSERT', ''],
      ['prompts', 'UPDATE', ''],
      ['prompts', 'DELETE', ''],
      ['semantic_evaluations', 'INSERT', ''],
      ['semantic_evaluations', 'UPDATE', ''],
      ['semantic_evaluations', 'DELETE', ''],
      ['store_meta', 'INSERT', "WHEN NEW.key='analysis_revision'"],
      ['store_meta', 'UPDATE', "WHEN NEW.key='analysis_revision'"],
      ['store_meta', 'DELETE', "WHEN OLD.key='analysis_revision'"],
    ];
    for (const [table, event, when] of tracked)
      sql.exec(
        `CREATE TRIGGER IF NOT EXISTS report_epoch_${table}_${event.split(' ')[0].toLowerCase()} AFTER ${event} ON ${table} ${when} BEGIN ${EPOCH_BUMP} END`,
      );
    // The discoveries share of voice and position count (setCountedBrands) are read by reports too.
    for (const [event, row] of [['INSERT', 'NEW'], ['UPDATE', 'NEW'], ['DELETE', 'OLD']]) {
      sql.exec(`DROP TRIGGER IF EXISTS report_epoch_brand_excluded_${event.toLowerCase()}`);
      for (const key of ['brand_counted', 'brand_merged'])
        sql.exec(
          `CREATE TRIGGER IF NOT EXISTS report_epoch_${key}_${event.toLowerCase()} AFTER ${event} ON store_meta WHEN ${row}.key='${key}' BEGIN ${EPOCH_BUMP} END`,
        );
    }
  }

  private epoch() {
    return Number(this.meta('data_epoch') || 0);
  }

  /** A batch whose result the store may keep: every statement reads only epoch-tracked tables. */
  private cacheable(statements: StoreQuery[]) {
    return statements.every(
      (statement) =>
        typeof statement?.sql === 'string' &&
        !UNCACHED_TABLES.test(statement.sql) &&
        !statement.sql.split(ACTIVE_ANALYSIS_SQL).join('').split(BRAND_COUNTED_SQL).join('').split(BRAND_MERGED_SQL).join('').includes('store_meta'),
    );
  }

  /**
   * A report read: the kept result when the statements were already answered at this epoch, else the live result, kept
   * for the next read. Nothing is kept or served while mention ranks are pending (the reader fills them first). A
   * default first-screen read (`warm`) is also remembered, with its period bounds marked, so the alarm recomputes it
   * after the next change (warmStep).
   */
  private async reportQueries(statements: StoreQuery[], report: ReportRead) {
    const valid =
      Array.isArray(report?.asked) &&
      Array.isArray(report.snapped) &&
      report.asked.length === report.snapped.length &&
      report.asked.length > 0 &&
      report.asked.length <= 4 &&
      [...report.asked, ...report.snapped].every((bound) => typeof bound === 'string' && bound.length <= 40);
    if (!valid || !Array.isArray(statements) || !this.cacheable(statements)) return this.runQueries(statements);
    const template = report.warm ? this.warmTemplate(statements, report) : null;
    const [key, templateKey] = await Promise.all([
      sha256(JSON.stringify(statements)),
      template ? sha256(JSON.stringify(template)) : null,
    ]);
    // Synchronous from here: the epoch read is the one the result belongs to.
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    if (template && templateKey) {
      sql.exec(
        `INSERT INTO report_templates(key,template,used_at) VALUES(?,?,?)
         ON CONFLICT(key) DO UPDATE SET used_at=excluded.used_at WHERE report_templates.used_at<excluded.used_at-3600000`,
        templateKey,
        JSON.stringify(template),
        now,
      );
      sql.exec('DELETE FROM report_templates WHERE used_at<?', now - WARM_TEMPLATE_TTL_MS);
      sql.exec(
        'DELETE FROM report_templates WHERE key IN (SELECT key FROM report_templates ORDER BY used_at DESC LIMIT -1 OFFSET ?)',
        MAX_WARM_TEMPLATES,
      );
    }
    if (this.meta('positions_pending') !== '0') return this.runQueries(statements);
    const epoch = this.epoch();
    const kept = sql
      .exec<{ results: string }>('SELECT results FROM report_cache WHERE key=? AND epoch=?', key, epoch)
      .toArray()[0];
    if (kept) return JSON.parse(kept.results) as ReturnType<ProjectStore['runQueries']>;
    const results = this.runQueries(statements);
    this.keepResults(key, epoch, results);
    return results;
  }

  private keepResults(key: string, epoch: number, results: ReturnType<ProjectStore['runQueries']>) {
    const text = JSON.stringify(results.map((result) => ({ results: result.results, meta: { ...result.meta, cached: true } })));
    if (text.length > MAX_CACHED_RESULT_BYTES) return;
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM report_cache WHERE epoch<>?', epoch);
    sql.exec(
      'INSERT INTO report_cache(key,epoch,results,bytes,stored_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET epoch=excluded.epoch,results=excluded.results,bytes=excluded.bytes,stored_at=excluded.stored_at',
      key,
      epoch,
      text,
      text.length,
      Date.now(),
    );
    // The newest results first, up to a count and a size.
    sql.exec(
      `DELETE FROM report_cache WHERE key IN (SELECT key FROM (SELECT key,ROW_NUMBER() OVER newest n,SUM(bytes) OVER newest total
        FROM report_cache WINDOW newest AS (ORDER BY stored_at DESC,key)) WHERE n>? OR total>?)`,
      MAX_CACHED_RESULTS,
      MAX_CACHED_BYTES,
    );
  }

  /**
   * The read with its period bounds marked: which parameters are which bound, and the bounds themselves, as offsets from
   * the end for a rolling window (its end is "now") or as asked for fixed dates. Null when no parameter is a bound.
   */
  private warmTemplate(statements: StoreQuery[], report: ReportRead): WarmTemplate | null {
    const slots: [number, number, number][] = [];
    const marked = statements.map((statement, index) => ({
      sql: statement.sql,
      params: (Array.isArray(statement.params) ? statement.params : []).map((param, position) => {
        const bound = typeof param === 'string' ? report.snapped.indexOf(param) : -1;
        if (bound < 0) return param;
        slots.push([index, position, bound]);
        return null;
      }),
    }));
    const end = Date.parse(report.asked.at(-1)!);
    if (!slots.length || report.asked.some((bound) => !Number.isFinite(Date.parse(bound)))) return null;
    const rolling = Math.abs(end - Date.now()) < 5 * 60_000;
    return {
      statements: marked,
      slots,
      asked: rolling ? report.asked.map((bound) => String(Date.parse(bound) - end)) : report.asked,
      rolling,
    };
  }

  /**
   * A whole response the Worker computed (kept_responses). `base` names the Worker's own inputs; the key adds what can
   * change here (data epoch, analysis revisions, the period bounds as moved and, with `analysis`, the competitor analysis
   * job), so a copy is only found for the data it was computed from. None while mention ranks are pending.
   */
  private responseCopy(probe: unknown, bounds: string[] | null) {
    const { base, analysis, last } = (probe ?? {}) as { base?: unknown; analysis?: unknown; last?: unknown };
    if (typeof base !== 'string' || !/^[a-f0-9]{64}$/.test(base)) throw new Error('Invalid response copy');
    if (this.meta('positions_pending') !== '0') return null;
    const sql = this.ctx.storage.sql;
    const job = analysis ? this.analysisJobState() : null;
    const epoch = this.epoch();
    const key = JSON.stringify([base, epoch, this.meta('analysis_revision') ?? null, this.meta('analysis_mutation_revision') ?? '0', bounds, job]);
    const row = sql.exec<{ value: string; stored_at: number }>('SELECT value,stored_at FROM kept_responses WHERE key=?', key).toArray()[0];
    const stale = last && !row ? sql.exec<{ value: string; stored_at: number }>('SELECT value,stored_at FROM last_responses WHERE base=?', base).toArray()[0] : undefined;
    return { key, epoch, ...(row ? { value: row.value, storedAt: row.stored_at } : {}), ...(stale ? { last: { value: stale.value, storedAt: stale.stored_at } } : {}) };
  }

  /** Where the competitor analysis is (part of the Brands reads' copy key and of the first screens' warm-up check). */
  private analysisJobState() {
    return this.ctx.storage.sql.exec('SELECT revision,status,updated_at,processed FROM competitor_analysis_jobs WHERE id=1').toArray()[0] ?? null;
  }

  /**
   * Keeps a response computed at `epoch` under the key responseCopy gave, unless the data has changed since or it is larger than
   * MAX_KEPT_RESPONSE_CHARS. Copies of older data (never found again) are removed, and the oldest ones beyond
   * MAX_KEPT_RESPONSES or MAX_KEPT_RESPONSE_BYTES: the store holds a few megabytes of copies at most.
   */
  private keepCopy(key: unknown, epoch: unknown, value: unknown, last = false) {
    if (typeof key !== 'string' || key.length > 2000 || typeof value !== 'string') throw new Error('Invalid response copy');
    if (value.length > MAX_KEPT_RESPONSE_CHARS) return { kept: false };
    const sql = this.ctx.storage.sql;
    // The newest copy of its read, even when the data moved while it was computed: a later read paints it while it is redone.
    // The newest first, up to a count and a size (read from the row heads only), like the copies above.
    const base = last ? (JSON.parse(key) as unknown[])[0] : null;
    if (typeof base === 'string' && /^[a-f0-9]{64}$/.test(base)) {
      sql.exec(
        'INSERT INTO last_responses(base,bytes,stored_at,value) VALUES(?,?,?,?) ON CONFLICT(base) DO UPDATE SET bytes=excluded.bytes,stored_at=excluded.stored_at,value=excluded.value',
        base,
        value.length,
        Date.now(),
        value,
      );
      let count = 0,
        total = 0;
      const doomed: string[] = [];
      for (const row of sql.exec<{ base: string; bytes: number }>('SELECT base,bytes FROM last_responses ORDER BY stored_at DESC,base')) {
        count++;
        total += Number(row.bytes);
        if (count > MAX_LAST_RESPONSES || total > MAX_KEPT_RESPONSE_BYTES) doomed.push(row.base);
      }
      for (const doomedBase of doomed) sql.exec('DELETE FROM last_responses WHERE base=?', doomedBase);
    }
    if (epoch !== this.epoch()) return { kept: false };
    sql.exec('DELETE FROM kept_responses WHERE epoch<>?', epoch);
    sql.exec(
      'INSERT INTO kept_responses(key,epoch,bytes,stored_at,value) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET bytes=excluded.bytes,stored_at=excluded.stored_at,value=excluded.value',
      key,
      epoch,
      value.length,
      Date.now(),
      value,
    );
    // The newest first, up to a count and a size; read from the age index and the row heads only.
    let count = 0,
      total = 0;
    const doomed: string[] = [];
    for (const row of sql.exec<{ key: string; bytes: number }>('SELECT key,bytes FROM kept_responses ORDER BY stored_at DESC,key')) {
      count++;
      total += Number(row.bytes);
      if (count > MAX_KEPT_RESPONSES || total > MAX_KEPT_RESPONSE_BYTES) doomed.push(row.key);
    }
    for (const doomedKey of doomed) sql.exec('DELETE FROM kept_responses WHERE key=?', doomedKey);
    return { kept: !doomed.includes(key) };
  }

  /** Data changed (`before` is the epoch before the operation): recompute the remembered reads once publication is quiet. */
  private async changed(before: number) {
    if (this.epoch() === before) return;
    // Ten minutes after the last change, but no later than WARM_MAX_WAIT_MS after the first one not yet recomputed: a project
    // whose decisions or answers land on every tick all day is still recomputed hourly, not never (and not every 20 s).
    const now = Date.now();
    let since = Number(this.meta('warm_pending_since') || 0);
    if (!since) this.setMeta('warm_pending_since', String((since = now)));
    const at = Math.min(now + WARM_QUIET_MS, Math.max(since + WARM_MAX_WAIT_MS, now + WARM_GAP_MS));
    this.setMeta('warm_after', String(at));
    await this.alarmBy(at);
  }

  private async alarmBy(at: number) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  /**
   * Recomputes one remembered read for the current data: its bounds moved for "now" exactly as a request moves them,
   * then executed and kept (unless already kept). Returns whether reads remain. One read per call, so the object never
   * holds requests back for longer than one report.
   */
  private async warmStep(force = false) {
    if (!this.meta('owner') || this.meta('answers_split') === 'pending' || this.meta('sources_canonical') !== 'done') return false;
    if (!force && Date.now() < Number(this.meta('warm_after') || 0)) return true;
    const sql = this.ctx.storage.sql;
    const epoch = this.epoch();
    const row = sql
      .exec<{ key: string; template: string }>(
        'SELECT key,template FROM report_templates WHERE warmed_epoch<>? AND used_at>=? ORDER BY used_at DESC LIMIT 1',
        epoch,
        Date.now() - WARM_TEMPLATE_TTL_MS,
      )
      .toArray()[0];
    if (!row) {
      // Every remembered read is recomputed for this data: the next change waits its quiet time again.
      this.ctx.storage.sql.exec("DELETE FROM store_meta WHERE key='warm_pending_since'");
      return false;
    }
    for (let page = 0, cursor = ''; page < STATUS_FILL_PAGES && this.meta('positions_pending') !== '0'; page++)
      cursor = this.ctx.storage.transactionSync(() => this.fillRunPositions(cursor)).cursor;
    if (this.meta('positions_pending') !== '0') return true;
    const template = JSON.parse(row.template) as WarmTemplate;
    const now = Date.now();
    const asked = template.asked.map((bound) => (template.rolling ? new Date(now + Number(bound)).toISOString() : bound));
    const snapped = this.snapBounds(this.meta('project')!, asked);
    const statements = template.statements.map((statement) => ({ ...statement, params: [...statement.params] }));
    for (const [index, position, bound] of template.slots) statements[index].params[position] = snapped[bound];
    const key = await sha256(JSON.stringify(statements));
    if (this.epoch() !== epoch) return true;
    // Marked before it runs: a read that takes the store past its limits (and resets it) is not tried again on every alarm.
    sql.exec('UPDATE report_templates SET warmed_epoch=? WHERE key=?', epoch, row.key);
    try {
      if (!sql.exec('SELECT 1 FROM report_cache WHERE key=? AND epoch=?', key, epoch).toArray().length)
        this.keepResults(key, epoch, this.runQueries(statements));
    } catch {
      // A read the store refuses now (too large) is not retried before the next change.
    }
    return true;
  }

  /**
   * Source catalog: a cited URL is stored once per response in its canonical
   * form (source-url.mjs), so a page cited with tracking suffixes, a text
   * fragment, `www` or a trailing slash is one source everywhere. New rows are
   * canonicalized by apply(); this walks the rows stored before that, in id order
   * and one bounded page per call, and records its progress so a restart
   * resumes. Rows already canonical are not rewritten. Returns true while rows remain.
   */
  private canonicalizeSourcesPage(size = 100) {
    if (!this.meta('owner') || this.meta('sources_canonical') === 'done') return false;
    const sql = this.ctx.storage.sql;
    const rows = sql
      .exec<{ id: string; sources_json: string | null; consulted_sources_json: string | null }>(
        'SELECT id,sources_json,consulted_sources_json FROM runs WHERE id>? ORDER BY id LIMIT ?',
        this.meta('sources_canonical_cursor') ?? '',
        size,
      )
      .toArray();
    this.ctx.storage.transactionSync(() => {
      for (const row of rows) {
        const sources = canonicalCitationsJson(row.sources_json);
        const consulted = canonicalCitationsJson(row.consulted_sources_json);
        if (sources !== row.sources_json || consulted !== row.consulted_sources_json) {
          sql.exec('UPDATE run_rows SET sources_json=?,consulted_sources_json=? WHERE id=?', sources ?? '[]', consulted ?? null, row.id);
          // Its kept tallies read the old links (and the active counts, its row).
          sql.exec('DELETE FROM competitor_answer_names WHERE revision=? AND run_id=?', this.activeTag(), row.id);
          sql.exec('DELETE FROM analysis_lowercase');
        }
      }
      if (rows.length < size) this.setMeta('sources_canonical', 'done');
      else this.setMeta('sources_canonical_cursor', rows[rows.length - 1].id);
    });
    return rows.length === size;
  }

  private ensureSuggestionIdentity(
    table: 'competitor_suggestions' | 'competitor_suggestions_staging',
  ) {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      const columns = new Set(
        sql
          .exec<{ name: string }>(`PRAGMA table_info(${table})`)
          .toArray()
          .map((column) => column.name),
      );
      const addedIdentity = !columns.has('identity');
      if (addedIdentity)
        sql.exec(`ALTER TABLE ${table} ADD COLUMN identity TEXT`);
      if (!columns.has('domain_state'))
        sql.exec(
          `ALTER TABLE ${table} ADD COLUMN domain_state TEXT NOT NULL DEFAULT 'none'`,
        );
      // What the free detector concluded (key, ambiguous, reasons, role). Rows
      // saved before it existed read as null: no conclusion, shown as before.
      if (!columns.has('detection_json'))
        sql.exec(`ALTER TABLE ${table} ADD COLUMN detection_json TEXT`);
      const needsBackfill =
        addedIdentity ||
        Number(
          sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) count FROM ${table} WHERE identity IS NULL OR identity=''`,
            )
            .one().count,
        ) > 0;
      if (!needsBackfill) {
        sql.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_revision_identity ON ${table}(revision,identity)`,
        );
        return;
      }
      const rows = sql
        .exec<{
          revision: string;
          name: string;
          domain: string | null;
          score: number;
          answer_count: number;
          evidence_json: string;
        }>(
          `SELECT revision,name,domain,score,answer_count,evidence_json FROM ${table}
           ORDER BY revision,answer_count DESC,score DESC,name`,
        )
        .toArray();
      const merged = new Map<
        string,
        {
          revision: string;
          name: string;
          identity: string;
          domain: string | null;
          domainState: DomainEvidenceState;
          score: number;
          answerCount: number;
          evidence: CompetitorCandidate['evidence'];
        }
      >();
      for (const row of rows) {
        const identity = competitorIdentity(row.name);
        const key = `${row.revision}\u0000${identity}`;
        const previous = merged.get(key);
        const domain = mergeDomainEvidence(
          previous
            ? { domain: previous.domain, state: previous.domainState }
            : null,
          {
            domain: row.domain,
            state: row.domain ? 'unique' : 'none',
          },
        );
        const evidence = [
          ...(previous?.evidence ?? []),
          ...JSON.parse(row.evidence_json),
        ]
          .filter(
            (item, index, all) =>
              all.findIndex((other) => other.runId === item.runId) === index,
          )
          .slice(0, MAX_EVIDENCE);
        merged.set(key, {
          revision: row.revision,
          name: previous?.name ?? row.name.normalize('NFC'),
          identity,
          domain: domain.domain,
          domainState: domain.state,
          score: Math.max(previous?.score ?? 0, Number(row.score)),
          answerCount: (previous?.answerCount ?? 0) + Number(row.answer_count),
          evidence,
        });
      }
      sql.exec(`DELETE FROM ${table}`);
      for (const row of merged.values())
        sql.exec(
          `INSERT INTO ${table}(revision,name,identity,domain,domain_state,score,answer_count,evidence_json)
           VALUES(?,?,?,?,?,?,?,?)`,
          row.revision,
          row.name,
          row.identity,
          row.domain,
          row.domainState,
          row.score,
          row.answerCount,
          JSON.stringify(row.evidence),
        );
      sql.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_revision_identity ON ${table}(revision,identity)`,
      );
    });
  }

  private meta(key: string) {
    return this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM store_meta WHERE key=?', key)
      .toArray()[0]?.value;
  }

  private setMeta(key: string, value: string) {
    this.ctx.storage.sql.exec(
      'INSERT INTO store_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      value,
    );
  }

  private activeTargets(): DiscoverySeed[] {
    const revision = this.meta('analysis_revision');
    if (!revision) return [];
    let raw = this.meta('analysis_targets_json');
    if (!raw) {
      raw = this.ctx.storage.sql
        .exec<{ analysis_targets_json: string }>(
          `SELECT analysis_targets_json FROM runs
           WHERE analysis_revision=? AND analysis_targets_json IS NOT NULL LIMIT 1`,
          revision,
        )
        .toArray()[0]?.analysis_targets_json;
      if (raw) this.setMeta('analysis_targets_json', raw);
    }
    try {
      const targets = JSON.parse(raw || '[]');
      return Array.isArray(targets) ? targets : [];
    } catch {
      return [];
    }
  }

  /**
   * The spellings of these targets that the window's answers use as common words (lib/brand-mention-check.ts), read once
   * per analysis revision (one read of the window) and kept for the active analysis and the pass in progress.
   */
  /** Whether commonNames has read the window for `revision` already (a read of every text: a turn of its own). */
  private commonRead(revision: string) {
    const saved = (parseJson(this.meta('mention_common') ?? 'null') ?? {}) as Record<string, { names?: unknown; counters?: unknown }>;
    return Array.isArray(saved[revision]?.names) && !!saved[revision]?.counters;
  }

  private commonNames(revision: string, targets: DiscoverySeed[]) {
    const saved = (parseJson(this.meta('mention_common') ?? 'null') ?? {}) as Record<string, { names: string[]; terms: string[]; counters?: unknown }>;
    // (An entry before structure-v12 has no counters and older terms: read again.)
    if (Array.isArray(saved[revision]?.names) && saved[revision].counters) return { names: new Set(saved[revision].names), terms: new Set(saved[revision].terms) };
    const answers = function* (sql: SqlStorage) {
      for (const row of sql.exec<{ answer: string }>(
        `SELECT answer FROM runs WHERE status='complete' AND response_available=1 AND answer IS NOT NULL AND created_at>=?
         ORDER BY created_at DESC,id DESC LIMIT 10000`,
        new Date(Date.now() - ANALYSIS_WINDOW_MS).toISOString(),
      ))
        yield row.answer;
    };
    const found = commonSpellings(targets, answers(this.ctx.storage.sql));
    const other = Object.entries(saved).filter(([key]) => key !== revision).slice(-1);
    this.setMeta('mention_common', JSON.stringify({ ...Object.fromEntries(other), [revision]: found }));
    return { names: new Set(found.names), terms: new Set(found.terms) };
  }

  /**
   * The mentions of one answer for one overlay (`slot`), `{target name: boolean}`: a mention only the decision model can
   * settle counts once its verdict on this exact question said so (mention_asks); a new or changed question waits there,
   * not counted. A question the other overlay already has decided starts with that verdict (a reprocess does not dip).
   */
  private overlayMentions(runId: string, answer: string, sourcesJson: string | null, targets: DiscoverySeed[], common: { names: Set<string>; terms: Set<string> }, slot: 'active' | 'pending', prompt: string | null) {
    const sql = this.ctx.storage.sql;
    const cited = parseJson(sourcesJson || '[]');
    const sources = Array.isArray(cited) ? cited.map((source) => (source as { domain?: unknown })?.domain).filter((domain): domain is string => typeof domain === 'string') : [];
    const results = brandMentions(answer, targets, common.names, sources, common.terms, prompt ?? '');
    // No decision model to ask: what the rules leave open counts, as the matcher did before v9.
    const noModel = this.meta('mention_model') === '0';
    return JSON.stringify(
      Object.fromEntries(
        targets.map((target, index) => {
          const result = results[index]!;
          if (typeof result === 'boolean') {
            sql.exec('DELETE FROM mention_asks WHERE run_id=? AND brand=? AND slot=?', runId, target.name, slot);
            return [target.name, result];
          }
          if (noModel) {
            sql.exec('DELETE FROM mention_asks WHERE run_id=? AND brand=? AND slot=?', runId, target.name, slot);
            // A name question ("Amazon Prime Video" for Prime Video) takes its form's lean instead.
            return [target.name, result.request.pair ? pairLean(result.request.pair) : true];
          }
          const request = JSON.stringify(result.request);
          const kept = sql.exec<{ request_json: string; counted: number | null }>('SELECT request_json,counted FROM mention_asks WHERE run_id=? AND brand=? AND slot=?', runId, target.name, slot).toArray()[0];
          if (kept?.request_json === request) return [target.name, kept.counted === 1];
          const other = sql
            .exec<{ counted: number | null; decided_config: string | null }>('SELECT counted,decided_config FROM mention_asks WHERE run_id=? AND brand=? AND slot<>? AND request_json=? AND counted IS NOT NULL', runId, target.name, slot, request)
            .toArray()[0];
          sql.exec('INSERT OR REPLACE INTO mention_asks(run_id,brand,slot,request_json,counted,decided_config) VALUES(?,?,?,?,?,?)', runId, target.name, slot, request, other?.counted ?? null, other?.decided_config ?? null);
          return [target.name, other?.counted === 1];
        }),
      ),
    );
  }

  /**
   * The decision model's verdicts (the Worker, lib/server/brand-mention-checks.ts): `[run id, target name, slot, the question's
   * JSON, counted, the config it was decided under]`. A verdict applies only to the question it judged, and turns the brand
   * on or off in that slot's overlay only.
   */
  private setMentionVerdicts(verdicts: unknown) {
    if (
      !Array.isArray(verdicts) ||
      verdicts.length > 100 ||
      verdicts.some(
        (item) =>
          !Array.isArray(item) ||
          item.length !== 6 ||
          typeof item[0] !== 'string' || item[0].length > 200 ||
          typeof item[1] !== 'string' || item[1].length > 300 ||
          (item[2] !== 'active' && item[2] !== 'pending') ||
          typeof item[3] !== 'string' || item[3].length > 20000 ||
          typeof item[4] !== 'boolean' ||
          typeof item[5] !== 'string' || item[5].length > 400,
      )
    )
      throw new Error('Invalid mention verdicts');
    const sql = this.ctx.storage.sql;
    let applied = 0;
    this.ctx.storage.transactionSync(() => {
      for (const [runId, brand, slot, request, counted, config] of verdicts as [string, string, 'active' | 'pending', string, boolean, string][]) {
        if (!sql.exec('UPDATE mention_asks SET counted=?,decided_config=? WHERE run_id=? AND brand=? AND slot=? AND request_json=?', Number(counted), config, runId, brand, slot, request).rowsWritten) continue;
        applied++;
        const column = slot === 'active' ? 'analysis_mentions_json' : 'analysis_pending_mentions_json';
        const json = sql.exec<{ json: string | null }>(`SELECT ${column} json FROM run_rows WHERE id=?`, runId).toArray()[0]?.json ?? null;
        const mentions = parseJson(json || 'null') as Record<string, boolean> | null;
        if (mentions && Object.hasOwn(mentions, brand) && mentions[brand] !== counted)
          sql.exec(`UPDATE run_rows SET ${column}=? WHERE id=?`, JSON.stringify({ ...mentions, [brand]: counted }), runId);
      }
    });
    return { applied };
  }

  private frozenUntil() {
    const until = Number(this.meta('analysis_frozen_until') || 0);
    if (until > Date.now()) return until;
    if (until) {
      this.setMeta('analysis_frozen_until', '0');
      this.setMeta('analysis_freeze_token', '');
    }
    return 0;
  }

  private analysisStatus(read: { exclude?: unknown; include?: unknown; limit?: unknown } = {}) {
    // An alarm reads nobody's status: the suggestions and their evidence are not read for nothing.
    if (this.quiet) return null as never;
    const sql = this.ctx.storage.sql;
    const job = sql
      .exec<AnalysisJob>('SELECT * FROM competitor_analysis_jobs WHERE id=1')
      .toArray()[0];
    const keys = (value: unknown) => new Set(Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []);
    // Names a name question settled as a monitored brand itself ("Amazon Prime Video"): that brand, never a discovery beside it.
    const exclude = new Set([...keys(read.exclude), ...keys(parseJson(this.meta('brand_aliases') ?? '[]'))]);
    // Settled competitors are listed whatever their count (up to MAX_STATUS_COMPETITORS); the limit bounds the rest.
    const include = keys(read.include);
    const limit = Math.min(MAX_STATUS_SUGGESTIONS, Math.max(1, Math.trunc(Number(read.limit) || MAX_STATUS_SUGGESTIONS)));
    // The names are chosen on the light columns first; only the chosen ones read their evidence (most of a large
    // analysis is left out, and its excerpts were read for nothing).
    const select = (revision: string) => {
      let others = 0;
      let included = 0;
      const chosen = sql
        .exec<{ name: string }>('SELECT name FROM competitor_suggestions WHERE revision=? ORDER BY answer_count DESC,score DESC,name', revision)
        .toArray()
        .map((row) => row.name)
        .filter((name) => {
          const key = brandKey(name);
          if (exclude.has(key)) return false;
          return include.has(key) ? included++ < MAX_STATUS_COMPETITORS : others++ < limit;
        });
      return sql
        .exec<{
          name: string;
          domain: string | null;
          score: number;
          answer_count: number;
          evidence_json: string;
          detection_json: string | null;
        }>(
          `SELECT name,domain,score,answer_count,evidence_json,detection_json
           FROM competitor_suggestions WHERE revision=? AND name IN (SELECT value FROM json_each(?))
           ORDER BY answer_count DESC,score DESC,name`,
          revision,
          JSON.stringify(chosen),
        )
        .toArray()
        .map((row) => ({
          name: row.name,
          domain: row.domain,
          score: Number(row.score),
          answerCount: Number(row.answer_count),
          evidence: JSON.parse(row.evidence_json),
          ...detectionView(row.detection_json),
        }));
    };
    const suggestions = job ? select(job.revision) : [];
    // While a pass over new targets runs, the last complete analysis stays readable: the list it found and how many answers.
    const active = this.meta('analysis_revision');
    const previous =
      job && ['pending', 'running'].includes(job.status) && active && active !== job.revision
        ? {
            suggestions: select(active),
            analyzed: Number(sql.exec<{ n: number }>('SELECT COUNT(*) n FROM run_rows WHERE analysis_revision=?', active).one().n),
          }
        : null;
    return {
      revision: job?.revision ?? this.meta('analysis_revision') ?? null,
      configVersion: Number(job?.config_version ?? 0),
      status: job?.status ?? 'idle',
      processed: Number(job?.processed ?? 0),
      scanned: Number(job?.scanned ?? 0),
      phase: job?.phase === 'extend' || job?.phase === 'resolve' ? 'analysis' : (job?.phase ?? 'seeds'),
      total: Number(job?.total_eligible ?? 0),
      truncated: Boolean(job?.truncated),
      cutoff: job?.cutoff ?? null,
      maxRuns: Number(job?.max_runs ?? 10000),
      error: job?.error ?? null,
      updatedAt: job?.updated_at ?? null,
      suggestions,
      ...(previous ? { previous } : {}),
      detector: this.analysisDetector(job),
      // Discoveries made by an older detector stay until an explicit restart (owner or Admin) redoes them.
      staleDetector: this.staleDetector(job) ? { current: this.analysisDetector(job), available: DETECTOR_VERSION } : null,
      mutationRevision: Number(this.meta('analysis_mutation_revision') || 0),
      frozen: Number(this.meta('analysis_frozen_until') || 0) > Date.now(),
    };
  }

  /**
   * The discoveries share of voice and position count (BRAND_COUNTED_SQL), `{brand key: its group's key}`, sent by the
   * Worker from the decisions it keeps (settled competitors, not rejected; a merged name in its group). Written only when
   * they change: a write starts a new data epoch, so every kept report is computed again.
   */
  private setCountedBrands(groups: unknown, aliases: unknown = []) {
    const entries = groups && typeof groups === 'object' && !Array.isArray(groups) ? Object.entries(groups) : null;
    if (!entries || entries.length > 50_000 || entries.some(([key, group]) => key.length > 300 || typeof group !== 'string' || group.length > 300))
      throw new Error('Invalid counted brands');
    if (!Array.isArray(aliases) || aliases.length > 1000 || aliases.some((key) => typeof key !== 'string' || key.length > 300)) throw new Error('Invalid brand aliases');
    // The discovered names that are a monitored brand itself: never listed as a discovery (analysisStatus).
    const alias = JSON.stringify([...new Set(aliases as string[])].sort());
    if ((this.meta('brand_aliases') ?? '[]') !== alias) this.setMeta('brand_aliases', alias);
    // Two values reports read apart (BRAND_COUNTED_SQL, BRAND_MERGED_SQL): the keys, and the few merged into another brand.
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const counted = JSON.stringify(entries.map(([key]) => key));
    const merged = JSON.stringify(Object.fromEntries(entries.filter(([key, group]) => key !== group)));
    const changed = this.meta('brand_counted') !== counted || this.meta('brand_merged') !== merged;
    if (changed) {
      this.setMeta('brand_counted', counted);
      this.setMeta('brand_merged', merged);
    }
    return { changed };
  }

  /**
   * The preview import (its operations route, Cloud only): production's competitor analysis as it is, so the
   * copy counts the discoveries production counts instead of detecting them again (another detector, window and verdicts).
   * `begin` drops this store's own analysis and keeps production's job, finished (the same target list never restarts it),
   * under production's detector; `rows` writes pages of answers (`[id, mentions, discoveries]`, under the job's revision and
   * targets) and of names; `commit` makes the analysis active with the discoveries production counts.
   */
  private adoptAnalysis(message: Extract<StoreMessage, { action: 'analysis-adopt' }>) {
    const sql = this.ctx.storage.sql;
    const text = (value: unknown, max: number) => value === null || (typeof value === 'string' && value.length <= max);
    if (message.step === 'begin') {
      const job = message.job;
      const number = (key: string) => (Number.isSafeInteger(Number(job?.[key])) ? Number(job![key]) : 0);
      if (
        !text(message.detector, 100) ||
        (job && (typeof job.revision !== 'string' || !job.revision || job.revision.length > 200 || typeof job.targets_json !== 'string' || !text(job.targets_json, 200_000) || !text(job.cutoff, 40) || !text(job.updated_at, 40)))
      )
        throw new Error('Invalid adopted analysis');
      this.ctx.storage.transactionSync(() => {
        this.clearActiveAnalysis();
        sql.exec('UPDATE run_rows SET analysis_brands_json=NULL WHERE analysis_brands_json IS NOT NULL');
        sql.exec('DELETE FROM competitor_analysis_jobs');
        sql.exec("DELETE FROM store_meta WHERE key IN ('brand_offsets_cursor','analysis_detector_available')");
        if (job)
          sql.exec(
            `INSERT INTO competitor_analysis_jobs(id,revision,config_version,targets_json,cutoff,max_runs,processed,scanned,phase,
              total_eligible,truncated,status,updated_at) VALUES(1,?,?,?,?,?,?,?,'analysis',?,?,'complete',?)`,
            job.revision,
            number('config_version'),
            job.targets_json,
            job.cutoff ?? new Date().toISOString(),
            Math.min(10000, Math.max(1, number('max_runs') || 10000)),
            number('processed'),
            number('scanned'),
            number('total_eligible'),
            number('truncated') ? 1 : 0,
            job.updated_at ?? new Date().toISOString(),
          );
        this.setMeta('analysis_detector', message.detector ?? '');
        this.setMeta('analysis_job_detector', message.detector ?? '');
      });
      return { ok: true };
    }
    const job = sql.exec<AnalysisJob>('SELECT revision,targets_json FROM competitor_analysis_jobs WHERE id=1').toArray()[0];
    if (message.step === 'rows') {
      const runs = message.runs ?? [];
      const suggestions = message.suggestions ?? [];
      if (
        !job ||
        !Array.isArray(runs) ||
        !Array.isArray(suggestions) ||
        runs.length > 2000 ||
        suggestions.length > 500 ||
        runs.some((row) => !Array.isArray(row) || typeof row[0] !== 'string' || row[0].length > 200 || !text(row[1], 100_000) || !text(row[2], 200_000)) ||
        suggestions.some((row) => typeof row?.name !== 'string' || typeof row.identity !== 'string' || typeof row.domain_state !== 'string' || typeof row.evidence_json !== 'string' || !text(row.domain ?? null, 300) || !text(row.detection_json ?? null, 100_000) || row.evidence_json.length > 200_000)
      )
        throw new Error('Invalid adopted analysis');
      // How many of the answers this store holds: an import that names none of them is reading the wrong project.
      const answers = sql.exec<{ n: number }>('SELECT COUNT(*) n FROM run_rows WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify(runs.map(([id]) => id))).one().n;
      this.ctx.storage.transactionSync(() => {
        for (const [id, mentions, brands] of runs)
          sql.exec(
            'UPDATE run_rows SET analysis_revision=?,analysis_targets_json=?,analysis_mentions_json=?,analysis_brands_json=? WHERE id=?',
            job.revision,
            job.targets_json,
            mentions,
            brands,
            id,
          );
        for (const row of suggestions)
          sql.exec(
            `INSERT OR REPLACE INTO competitor_suggestions(revision,name,identity,domain,domain_state,score,answer_count,evidence_json,detection_json)
             VALUES(?,?,?,?,?,?,?,?,?)`,
            job.revision,
            row.name,
            row.identity,
            row.domain ?? null,
            row.domain_state,
            Number(row.score) || 0,
            Math.trunc(Number(row.answer_count) || 0),
            row.evidence_json,
            row.detection_json ?? null,
          );
      });
      return { answers, suggestions: suggestions.length };
    }
    this.ctx.storage.transactionSync(() => {
      if (job) {
        this.setMeta('analysis_revision', job.revision);
        this.setMeta('analysis_targets_json', job.targets_json);
      }
      this.setMeta('analysis_mutation_revision', String(Number(this.meta('analysis_mutation_revision') || 0) + 1));
      this.setCountedBrands(message.groups);
      // The discoveries are not a reported column: kept reports of the old ones must not be served again.
      sql.exec(EPOCH_BUMP);
    });
    return { active: job?.revision ?? null };
  }

  /**
   * Where each discovery is first named in its answer (the offsets mention ranks compare), a page of answers per
   * alarm after a pass. True while answers remain; when done, a new data epoch makes kept reports rank with them.
   */
  private fillBrandOffsets(limit = 200) {
    const sql = this.ctx.storage.sql;
    const cursor = this.meta('brand_offsets_cursor');
    const revision = this.meta('analysis_revision');
    if (cursor == null || !revision) return false;
    const spellings = this.suggestionSpellings(revision);
    // Only answers with an offset still to find: the end of a pass writes them without (an answer it kept, with its own).
    const rows = sql
      .exec<{ id: string; answer: string | null; brands: string }>(
        `SELECT r.id id,r.answer answer,r.analysis_brands_json brands FROM runs r
         WHERE r.analysis_revision=? AND r.analysis_brands_json LIKE '{"%' AND r.analysis_brands_json LIKE '%:null%' AND r.id>? ORDER BY r.id LIMIT ?`,
        revision,
        cursor,
        limit,
      )
      .toArray();
    for (const row of rows) {
      const keys = Object.keys(JSON.parse(row.brands) as Record<string, number | null>);
      const offsets = mentionOffsets(row.answer, keys.map((key) => spellings.get(key) ?? [key]));
      const value = JSON.stringify(Object.fromEntries(keys.map((key, index) => [key, offsets[index] ?? null])));
      if (value !== row.brands) sql.exec('UPDATE run_rows SET analysis_brands_json=? WHERE id=?', value, row.id);
    }
    if (rows.length === limit) {
      this.setMeta('brand_offsets_cursor', rows[limit - 1]!.id);
      return true;
    }
    sql.exec("DELETE FROM store_meta WHERE key='brand_offsets_cursor'");
    // The ranks kept for the old offsets are stale: a new epoch (a trigger more on store_meta nests too deep in the store).
    sql.exec(EPOCH_BUMP);
    return false;
  }

  /** The detector of the pass in progress, else the one that produced the active suggestions. */
  private analysisDetector(job: AnalysisJob | undefined) {
    return (job && ['pending', 'running'].includes(job.status) ? this.meta('analysis_job_detector') : this.meta('analysis_detector')) || null;
  }

  /**
   * The active suggestions came from an older detector. New answers redo the pass under the current one (10/11/2026: a
   * frozen analysis left the new answers without discoveries, so share of voice lost them); until then the status says so.
   */
  private staleDetector(job: AnalysisJob | undefined) {
    const detector = this.analysisDetector(job);
    return !!detector && detector !== DETECTOR_VERSION;
  }

  private clearActiveAnalysis() {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM competitor_suggestions');
    sql.exec('DELETE FROM mention_asks');
    this.clearStaging();
    this.dropTag(this.activeTag());
    this.setMeta('analysis_answers_tag', `none~${Number(this.meta('analysis_pass_seq') || 0)}`);
    sql.exec('DELETE FROM analysis_lowercase');
    sql.exec("DELETE FROM store_meta WHERE key IN ('analysis_answers','analysis_answers_common','analysis_answers_model')");
    sql.exec(`UPDATE run_rows SET analysis_revision=NULL,analysis_targets_json=NULL,
      analysis_mentions_json=NULL,analysis_pending_revision=NULL,
      analysis_pending_targets_json=NULL,analysis_pending_mentions_json=NULL
      WHERE analysis_revision IS NOT NULL OR analysis_pending_revision IS NOT NULL`);
    sql.exec(
      "DELETE FROM store_meta WHERE key IN ('analysis_revision','analysis_targets_json')",
    );
    this.setMeta(
      'analysis_mutation_revision',
      String(Number(this.meta('analysis_mutation_revision') || 0) + 1),
    );
  }

  private startAnalysis(
    message: Extract<StoreMessage, { action: 'analysis-start' }>,
  ) {
    if (this.frozenUntil())
      throw new Error('Competitor analysis is temporarily paused');
    if (
      !message.revision ||
      message.revision.length > 200 ||
      !Number.isSafeInteger(message.configVersion) ||
      message.configVersion < 0 ||
      !Array.isArray(message.targets) ||
      !message.targets.length ||
      // Your brand plus the monitored competitors.
      message.targets.length > MAX_COMPETITORS + 1 ||
      !Number.isFinite(Date.parse(message.cutoff)) ||
      !Number.isInteger(message.maxRuns) ||
      message.maxRuns < 1 ||
      message.maxRuns > 10000
    )
      throw new Error('Invalid competitor analysis request');
    const targets = message.targets as DiscoverySeed[];
    for (const target of targets)
      if (
        !target ||
        typeof target.name !== 'string' ||
        !target.name ||
        typeof target.domain !== 'string' ||
        !target.domain
      )
        throw new Error('Invalid competitor analysis target');
    const sql = this.ctx.storage.sql;
    const current = sql
      .exec<AnalysisJob>('SELECT * FROM competitor_analysis_jobs WHERE id=1')
      .toArray()[0];
    // An older config is ignored (a slower request for targets the project already left), except an explicit restart of the
    // same targets (Admin's reprocess) and a version the project confirmed as its current one (`confirmed`): a store that
    // adopted another store's analysis (a preview copy) holds that store's newer version, and would otherwise never take its own.
    const restartSame = !!message.restart && current?.revision === message.revision;
    if (current && current.config_version > message.configVersion && !restartSame && !message.confirmed)
      return this.analysisStatus();
    if (current?.revision === message.revision && !message.restart) {
      if (
        this.meta('analysis_revision') === current.revision &&
        !this.meta('analysis_targets_json')
      )
        this.setMeta('analysis_targets_json', current.targets_json);
      // Same targets: the job stands; only its version follows the project's (up, or down to a confirmed one).
      if (current.config_version !== message.configVersion)
        sql.exec(
          'UPDATE competitor_analysis_jobs SET config_version=?,updated_at=? WHERE id=1',
          message.configVersion,
          new Date().toISOString(),
        );
      if (current.status === 'failed') {
        sql.exec(
          "UPDATE competitor_analysis_jobs SET status='pending',error=NULL,updated_at=? WHERE id=1",
          new Date().toISOString(),
        );
        void this.ctx.storage.setAlarm(Date.now() + 100);
      }
      // A pass whose alarm was lost (its retries ran out) goes on when the screen asks for it again.
      else if (current.status === 'pending' || current.status === 'running') void this.alarmBy(Date.now() + 100);
      return this.analysisStatus();
    }
    const eligible = Number(
      sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) count FROM (
             SELECT id FROM runs WHERE status='complete' AND response_available=1
             AND answer IS NOT NULL AND created_at>=?
             ORDER BY created_at DESC,id DESC LIMIT ?)`,
          message.cutoff,
          message.maxRuns + 1,
        )
        .one().count,
    );
    const total = Math.min(eligible, message.maxRuns);
    const stamp = new Date().toISOString();
    // A brand decision changes a target or two: the pass reads again only the answers that name them (an explicit restart reads all).
    const extend = !message.restart && this.extendable(targets, message.mentionModel !== false);
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        `INSERT INTO competitor_analysis_jobs(
          id,revision,config_version,targets_json,cutoff,max_runs,processed,scanned,phase,total_eligible,truncated,
          cursor_created_at,cursor_id,status,error,updated_at,seed_answers_json,needs_rescan)
         VALUES(1,?,?,?,?,?,0,0,?,?,?,NULL,NULL,?,NULL,?,'[]',0)
         ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,
          config_version=excluded.config_version,targets_json=excluded.targets_json,cutoff=excluded.cutoff,
          max_runs=excluded.max_runs,processed=0,scanned=0,phase=excluded.phase,
          total_eligible=excluded.total_eligible,
          truncated=excluded.truncated,
          cursor_created_at=NULL,cursor_id=NULL,status=excluded.status,error=NULL,
          updated_at=excluded.updated_at,seed_answers_json='[]',needs_rescan=0`,
        message.revision,
        restartSame ? Math.max(current!.config_version, message.configVersion) : message.configVersion,
        JSON.stringify(targets),
        message.cutoff,
        message.maxRuns,
        extend ? 'extend' : 'seeds',
        total,
        eligible > message.maxRuns ? 1 : 0,
        total ? 'pending' : 'complete',
        stamp,
      );
      if (extend) this.setMeta('analysis_extend_base', this.meta('analysis_revision')!);
      this.clearStaging();
      this.newPassTag(message.revision);
      sql.exec(
        `UPDATE run_rows SET analysis_pending_revision=NULL,
         analysis_pending_targets_json=NULL,analysis_pending_mentions_json=NULL
         WHERE analysis_pending_revision IS NOT NULL`,
      );
      sql.exec("DELETE FROM mention_asks WHERE slot='pending'");
      this.setMeta('analysis_job_detector', DETECTOR_VERSION);
      // Without a decision model (no key) the questions are never answered: they count as the matcher found them.
      this.setMeta('mention_model', message.mentionModel === false ? '0' : '1');
      // A new pass reads which names are common words again, over its own window.
      sql.exec("DELETE FROM store_meta WHERE key='mention_common'");
      if (!total) this.clearActiveAnalysis();
    });
    if (total) void this.ctx.storage.setAlarm(Date.now() + 100);
    return this.analysisStatus();
  }

  /**
   * A page only tallies the names it reads (structure-v7): the tallies of the window's pages add up in any order and
   * each answer keeps its own names, so the end of the pass decides once over the whole window, the same however the
   * answers were paged. Staging rows are keyed by the name's detection key; an answer read again replaces its names.
   */
  private stageNames(
    revision: string,
    tag: string,
    names: NameTally[],
    answers: (AnswerTallies & { reused?: boolean; positionsBasis?: string | null; positionsJson?: string | null })[],
  ) {
    const sql = this.ctx.storage.sql;
    // The answers each name's excerpts now come from (its newest MAX_EVIDENCE): only they keep theirs in their own rows.
    const shown = new Map<string, Set<string>>();
    for (const tally of names) {
      const existing = sql
        .exec<{ detection_json: string }>('SELECT detection_json FROM competitor_suggestions_staging WHERE revision=? AND name=?', revision, tally.key)
        .toArray()[0];
      const merged = existing ? mergeNameTally(JSON.parse(existing.detection_json) as NameTally, tally, MAX_EVIDENCE) : tally;
      shown.set(tally.key, new Set(merged.evidence.map((item) => item.runId)));
      sql.exec(
        `INSERT INTO competitor_suggestions_staging(revision,name,identity,domain,domain_state,score,answer_count,evidence_json,detection_json)
         VALUES(?,?,?,NULL,'none',?,?,'[]',?) ON CONFLICT(revision,name) DO UPDATE SET
         score=excluded.score,answer_count=excluded.answer_count,detection_json=excluded.detection_json`,
        revision,
        tally.key,
        tally.key,
        merged.structured ? 1 : 0.5,
        merged.answers,
        JSON.stringify(merged),
      );
    }
    for (const answer of answers)
      sql.exec(
        `INSERT OR REPLACE INTO competitor_answer_names(revision,run_id,created_at,keys_json,tallies_json,reused,positions_basis,positions_json)
         VALUES(?,?,?,?,?,?,?,?)`,
        tag,
        answer.id,
        answer.createdAt,
        // A carried answer's names stay in its active row: this pass only marks it.
        answer.reused ? '[]' : JSON.stringify(answer.keys),
        answer.reused ? null : JSON.stringify(answer.tallies.map((tally) => packTally(tally, shown.get(tally.key)?.has(answer.id) ?? false))),
        answer.reused ? 1 : 0,
        answer.positionsBasis ?? null,
        answer.positionsJson ?? null,
      );
  }

  /** A pass's staging (all passes' without `revision`); its answer rows go with its tag (newPassTag). */
  private clearStaging(revision?: string) {
    const sql = this.ctx.storage.sql;
    if (revision === undefined) sql.exec('DELETE FROM competitor_suggestions_staging');
    else sql.exec('DELETE FROM competitor_suggestions_staging WHERE revision=?', revision);
  }

  private stagedTallies(revision: string) {
    return this.ctx.storage.sql
      .exec<{ detection_json: string }>('SELECT detection_json FROM competitor_suggestions_staging WHERE revision=? ORDER BY name', revision)
      .toArray()
      .map((row) => JSON.parse(row.detection_json) as NameTally);
  }

  private known?: { stamp: string; brands: KnownBrand[] };
  /**
   * The brands this project already knows (structure-v15): the active analysis's discoveries its decisions count (a settled
   * competitor, not rejected, or a name merged into one, `brand_counted`), each with its aliases and domain. A pass finds
   * them in every answer by their spellings first (knownBrandMentions). Read once per active analysis and decisions.
   */
  private knownBrands(): KnownBrand[] {
    const revision = this.meta('analysis_revision');
    const counted = this.meta('brand_counted');
    if (!revision || !counted) return [];
    const stamp = `${revision}\n${counted}`;
    if (this.known?.stamp === stamp) return this.known.brands;
    const keys = new Set((parseJson(counted) ?? []) as string[]);
    const brands: KnownBrand[] = [];
    for (const row of this.ctx.storage.sql.exec<{ name: string; domain: string | null; detection_json: string | null }>(
      'SELECT name,domain,detection_json FROM competitor_suggestions WHERE revision=?',
      revision,
    )) {
      if (!keys.has(brandKey(row.name))) continue;
      const detection = (row.detection_json ? (parseJson(row.detection_json) ?? {}) : {}) as { aliases?: string[]; lowercaseAnswers?: number };
      brands.push({ name: row.name, spellings: [row.name, ...(detection.aliases ?? []), ...(row.domain ? [row.domain] : [])], ...((detection.lowercaseAnswers ?? 0) > 0 ? { ordinary: true } : {}) });
    }
    this.known = { stamp, brands };
    return brands;
  }

  /** Each suggestion's spellings (its name and aliases) by brand key: where fillBrandOffsets looks for it. */
  private suggestionSpellings(revision: string | undefined) {
    const spellings = new Map<string, string[]>();
    if (!revision) return spellings;
    for (const row of this.ctx.storage.sql.exec<{ name: string; detection_json: string | null }>('SELECT name,detection_json FROM competitor_suggestions WHERE revision=?', revision)) {
      const aliases = row.detection_json ? ((JSON.parse(row.detection_json) as { aliases?: string[] }).aliases ?? []) : [];
      spellings.set(brandKey(row.name), [row.name, ...aliases]);
    }
    return spellings;
  }

  /**
   * The end of a pass: the window's tallies and each answer's names are resolved once (resolveNames): ordinary words and
   * titles judged on one read of the window's answers (each split into words once; one scan per name over the 8,800
   * Netflix answers went past the Durable Object's CPU limit), families folded in one canonical order and every name
   * counted once per answer. The result replaces the active suggestions.
   */
  private resolveSuggestions(revision: string, targets: DiscoverySeed[], lowercase: LowercaseUse) {
    const sql = this.ctx.storage.sql;
    const tallies = this.stagedTallies(revision);
    // Excerpts an extension's carried answers did not keep (they were not shown when kept): read again from their answers.
    const missing = new Map<string, Set<string>>();
    for (const tally of tallies)
      for (const item of tally.evidence) if (item.excerpt === null) missing.set(item.runId, (missing.get(item.runId) ?? new Set()).add(tally.key));
    if (missing.size) {
      const known = new Set(targets.map((target) => brandDetectionKey(target.name)));
      const excerpts = new Map<string, string>();
      for (const row of sql.exec<{ id: string; answer: string | null }>('SELECT id,answer FROM runs WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...missing.keys()]))) {
        const keys = missing.get(row.id)!;
        for (const mention of extractBrandMentions((row.answer ?? '').slice(0, MAX_DISCOVERY_ANSWER_CHARACTERS), known))
          if (keys.has(mention.key) && !excerpts.has(`${row.id}|${mention.key}`)) excerpts.set(`${row.id}|${mention.key}`, mention.excerpt);
      }
      for (const tally of tallies)
        for (const item of tally.evidence) if (item.excerpt === null) item.excerpt = excerpts.get(`${item.runId}|${tally.key}`) ?? '';
    }
    const common = this.commonNames(revision, targets).names;
    // A carried answer's names are its active row's, less those the new targets cover (as its page staged them).
    const tracked = trackedBrandKeys(targets, common);
    const answers = sql
      .exec<{ run_id: string; created_at: string; keys_json: string; reused: number; carried: string | null }>(
        `SELECT n.run_id,n.created_at,n.keys_json,n.reused,b.keys_json carried FROM competitor_answer_names n
         LEFT JOIN competitor_answer_names b ON n.reused=1 AND b.revision=? AND b.run_id=n.run_id
         WHERE n.revision=? ORDER BY n.run_id`,
        this.activeTag(),
        this.passTag(revision),
      )
      .toArray()
      .map((row) => ({
        id: row.run_id,
        createdAt: row.created_at,
        keys: row.reused ? (JSON.parse(row.carried ?? '[]') as string[]).filter((key) => !tracked(key)) : (JSON.parse(row.keys_json) as string[]),
      }));
    const hits = new Map<string, string[]>();
    const found = resolveNames(tallies, answers, targets, lowercase, {
      evidenceLimit: MAX_EVIDENCE,
      common,
      onAnswer: (id, names) => hits.set(id, names),
    });
    const before = this.suggestionSpellings(this.meta('analysis_revision'));
    sql.exec('DELETE FROM competitor_suggestions WHERE revision=?', revision);
    for (const candidate of found)
      sql.exec(
        `INSERT INTO competitor_suggestions(revision,name,identity,domain,domain_state,score,answer_count,evidence_json,detection_json)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        revision,
        candidate.name.normalize('NFC'),
        competitorIdentity(candidate.name),
        candidate.domain,
        candidate.domainEvidence,
        candidate.score,
        candidate.answerCount,
        JSON.stringify(candidate.evidence),
        JSON.stringify(detectionOf(candidate)),
      );
    // Each answer keeps its discoveries, counted in share of voice at once. Where each is first named, for the rank
    // among every identified brand, is filled afterwards a page at a time (fillBrandOffsets): reading every text inside this
    // last write took Netflix's 9,500 answers past the store's CPU and memory limits, and the alarm kept failing. An answer
    // an extending pass did not read keeps its offsets while it names the same brands under the same spellings.
    const after = this.suggestionSpellings(revision);
    const kept = new Map(
      sql
        .exec<{ id: string; brands: string | null }>(
          `SELECT r.id id,r.analysis_brands_json brands FROM competitor_answer_names n JOIN run_rows r ON r.id=n.run_id
           WHERE n.revision=? AND n.reused=1`,
          this.passTag(revision),
        )
        .toArray()
        .map((row) => [row.id, row.brands]),
    );
    const same = (key: string) => JSON.stringify(before.get(key) ?? null) === JSON.stringify(after.get(key) ?? null);
    for (const [id, names] of hits) {
      const keys = names.map((name) => brandKey(name));
      const stored = kept.get(id);
      if (stored && JSON.stringify(Object.keys(parseJson(stored) ?? {})) === JSON.stringify(keys) && keys.every(same)) continue;
      const value = JSON.stringify(Object.fromEntries(keys.map((key) => [key, null])));
      sql.exec('UPDATE run_rows SET analysis_brands_json=? WHERE id=? AND analysis_brands_json IS NOT ?', value, id, value);
    }
    this.setMeta('brand_offsets_cursor', '');
    sql.exec('DELETE FROM competitor_suggestions WHERE revision!=?', revision);
    sql.exec('DELETE FROM competitor_suggestions_staging WHERE revision=?', revision);
  }

  private processAnalysisPage() {
    const sql = this.ctx.storage.sql;
    const frozenUntil = this.frozenUntil();
    if (frozenUntil) {
      void this.ctx.storage.setAlarm(frozenUntil);
      return this.analysisStatus();
    }
    const job = sql
      .exec<AnalysisJob>('SELECT * FROM competitor_analysis_jobs WHERE id=1')
      .toArray()[0];
    if (!job || !['pending', 'running'].includes(job.status))
      return this.analysisStatus();
    // An older detector's pages cannot be added to this one's (structure-v7 tallies names and keeps each answer's names):
    // a pass it began starts again under this detector.
    if (this.meta('analysis_job_detector') !== DETECTOR_VERSION) return this.restartPass(job);
    if (job.phase === 'resolve') return this.resolveStep(job);
    if (job.phase === 'extend') return this.processExtendPages(job);
    const phaseProgress = job.phase === 'seeds' ? job.scanned : job.processed;
    const first = this.fullPageRows(job.cutoff, job.cursor_created_at, job.cursor_id, Math.min(ANALYSIS_PAGE_SIZE, job.max_runs - phaseProgress));
    const targets = JSON.parse(job.targets_json) as DiscoverySeed[];
    const answersOf = (rows: typeof first.rows): DiscoveryAnswer[] =>
      rows.map((row) => ({ id: row.id, answer: row.answer, sources: JSON.parse(row.sources_json || '[]'), createdAt: row.created_at }));
    if (job.phase === 'seeds') {
      const { rows, fetched, requestedLimit } = first;
      const seedAnswers: DiscoveryAnswer[] = JSON.parse(job.seed_answers_json || '[]');
      for (const answer of answersOf(rows))
        if (seedAnswers.length < 12 && targets.some((target) => matchesBrand(answer.answer, target))) seedAnswers.push(boundedSeedAnswer(answer, targets));
      const scanned = job.scanned + rows.length;
      const seedsDone =
        seedAnswers.length >= 12 ||
        (rows.length === fetched.length && fetched.length < requestedLimit) ||
        scanned >= job.max_runs;
      const last = rows.at(-1);
      sql.exec(
        `UPDATE competitor_analysis_jobs SET scanned=?,phase=?,processed=0,
         cursor_created_at=?,cursor_id=?,status='running',updated_at=?,
         seed_answers_json=? WHERE id=1 AND revision=?`,
        scanned,
        seedsDone ? 'analysis' : 'seeds',
        seedsDone ? null : (last?.created_at ?? job.cursor_created_at),
        seedsDone ? null : (last?.id ?? job.cursor_id),
        new Date().toISOString(),
        JSON.stringify(seedAnswers.slice(0, 12)),
        job.revision,
      );
      void this.ctx.storage.setAlarm(Date.now() + ALARM_GAP_MS);
      return this.analysisStatus();
    }
    // Pages one after the other: one while reads are coming, more while nobody reads (each page alone in memory), and all of
    // their writes in one transaction (a name the pages share is staged once).
    // The window's common words are read in a turn of their own (every text), the pages after them.
    if (!this.commonRead(job.revision)) {
      this.commonNames(job.revision, targets);
      void this.ctx.storage.setAlarm(Date.now() + ALARM_GAP_MS);
      return this.analysisStatus();
    }
    const common = this.commonNames(job.revision, targets);
    const budget = this.idle() ? FULL_PAGES_IDLE : 1;
    const sum = new Map<string, NameTally>();
    const answers: AnswerTallies[] = [];
    const mentions: { id: string; mentions: string }[] = [];
    let processed = job.processed;
    let cursorAt = job.cursor_created_at;
    let cursorId = job.cursor_id;
    let done = false;
    for (let pages = 1, page = first; ; pages++) {
      const tallied = tallyNames(answersOf(page.rows), targets, MAX_EVIDENCE, common.names, this.knownBrands());
      for (const row of page.rows)
        mentions.push({ id: row.id, mentions: this.overlayMentions(row.id, row.answer, row.sources_json, targets, common, 'pending', row.prompt_text) });
      for (const tally of tallied.names) sum.set(tally.key, sum.has(tally.key) ? mergeNameTally(sum.get(tally.key)!, tally, MAX_EVIDENCE) : tally);
      answers.push(...tallied.answers);
      processed += page.rows.length;
      cursorAt = page.rows.at(-1)?.created_at ?? cursorAt;
      cursorId = page.rows.at(-1)?.id ?? cursorId;
      done = (page.rows.length === page.fetched.length && page.fetched.length < page.requestedLimit) || processed >= job.max_runs;
      if (done || pages >= budget) break;
      page = this.fullPageRows(job.cutoff, cursorAt, cursorId, Math.min(ANALYSIS_PAGE_SIZE, job.max_runs - processed));
    }
    const stamp = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      for (const row of mentions)
        sql.exec(
          `UPDATE run_rows SET analysis_pending_revision=?,analysis_pending_targets_json=?,analysis_pending_mentions_json=?
           WHERE id=? AND status='complete' AND response_available=1`,
          job.revision,
          job.targets_json,
          row.mentions,
          row.id,
        );
      this.stageNames(job.revision, this.passTag(job.revision), [...sum.values()], answers);
      sql.exec(
        `UPDATE competitor_analysis_jobs SET processed=?,cursor_created_at=?,cursor_id=?,
         status='running',error=NULL,updated_at=? WHERE id=1 AND revision=?`,
        processed,
        cursorAt,
        cursorId,
        stamp,
        job.revision,
      );
      if (done) this.beginResolve(job);
    });
    void this.ctx.storage.setAlarm(Date.now() + ALARM_GAP_MS);
    return this.analysisStatus();
  }

  /** The next page of the window (newest first): up to `limit` answers and ANALYSIS_PAGE_BYTES of text. */
  private fullPageRows(cutoff: string, cursorAt: string | null, cursorId: string | null, limit: number) {
    const params: Array<string | number> = [cutoff];
    if (cursorAt) params.push(cursorAt, cursorAt, cursorId || '');
    params.push(limit);
    const fetched = this.ctx.storage.sql
      .exec<{ id: string; answer: string; sources_json: string; created_at: string; prompt_text: string | null }>(
        `SELECT id,answer,sources_json,created_at,prompt_text FROM runs
         WHERE status='complete' AND response_available=1 AND answer IS NOT NULL
         AND created_at>=?${cursorAt ? ' AND (created_at<? OR (created_at=? AND id<?))' : ''} ORDER BY created_at DESC,id DESC LIMIT ?`,
        ...params,
      )
      .toArray();
    const encoder = new TextEncoder();
    const rows: typeof fetched = [];
    let bytes = 0;
    for (const row of fetched) {
      const size = encoder.encode(row.answer).byteLength;
      if (rows.length && bytes + size > ANALYSIS_PAGE_BYTES) break;
      rows.push(row);
      bytes += size;
    }
    return { rows, fetched, requestedLimit: limit };
  }

  /**
   * Answer rows are tagged (competitor_answer_names.revision): the active analysis's rows (`analysis_answers_tag`, kept for
   * the next pass to extend) and the pass in progress's (`analysis_pass_tag`). A full pass becomes active by taking its tag,
   * so no row is rewritten; tags no longer used are deleted a part per alarm (`analysis_answers_drop`).
   */
  private activeTag() {
    return this.meta('analysis_answers_tag') ?? '@active';
  }

  private passTag(revision: string) {
    return this.meta('analysis_pass_tag') ?? revision;
  }

  private dropTag(tag: string) {
    const drop = (parseJson(this.meta('analysis_answers_drop') ?? '[]') ?? []) as string[];
    if (!drop.includes(tag)) this.setMeta('analysis_answers_drop', JSON.stringify([...drop, tag]));
  }

  /** A pass (re)starts: its rows get a tag of their own; the rows of the pass it replaces are dropped. */
  private newPassTag(revision: string) {
    const old = this.meta('analysis_pass_tag');
    if (old && old !== this.activeTag()) this.dropTag(old);
    const seq = Number(this.meta('analysis_pass_seq') || 0) + 1;
    this.setMeta('analysis_pass_seq', String(seq));
    this.setMeta('analysis_pass_tag', `${revision}~${seq}`);
  }

  /** Deletes DROP_ROWS rows of a dropped tag; true while some remain. */
  private dropStep() {
    const sql = this.ctx.storage.sql;
    const drop = (parseJson(this.meta('analysis_answers_drop') ?? '[]') ?? []) as string[];
    const tag = drop[0];
    if (tag === undefined) return false;
    if (tag === this.activeTag() || tag === this.meta('analysis_pass_tag')) {
      this.setMeta('analysis_answers_drop', JSON.stringify(drop.slice(1)));
      return drop.length > 1;
    }
    const deleted = sql.exec(
      'DELETE FROM competitor_answer_names WHERE revision=? AND run_id IN (SELECT run_id FROM competitor_answer_names WHERE revision=? LIMIT ?)',
      tag,
      tag,
      DROP_ROWS,
    ).rowsWritten;
    if (deleted < DROP_ROWS) this.setMeta('analysis_answers_drop', JSON.stringify(drop.slice(1)));
    return deleted >= DROP_ROWS || drop.length > 1;
  }

  /** Nobody asked the store anything for IDLE_MS: an alarm may do a larger share of the analysis. */
  private idle() {
    return Date.now() - this.lastRequest > IDLE_MS;
  }

  /**
   * The pages are done: the texts to read for lowercase words next (resolveStep), then the pass is promoted. A full pass reads
   * every text for every name. An extending pass starts from the active analysis's counts: it reads every text only for the
   * names those counts lack (`missing`), and for the others only the answers it gained (`added`) and lost (`removed`).
   */
  private beginResolve(job: AnalysisJob) {
    const sql = this.ctx.storage.sql;
    const names = this.stagedTallies(job.revision).map((tally) => [tally.key, tallyName(tally)] as [string, string]);
    const base = job.phase === 'extend' ? this.baseLowercase() : null;
    const phrase = (name: string) => /\s/u.test(name) && name.toLocaleLowerCase() !== name;
    const known = ([key, name]: [string, string]) =>
      !!base &&
      key.split(' ').every((word) => Object.hasOwn(base.counts.words, word)) &&
      (!phrase(name) || (base.names.get(key) === name && Object.hasOwn(base.counts.phrases, key)));
    const segments = base
      ? [
          { texts: 'all', names: names.filter((name) => !known(name)) },
          { texts: 'added', names: names.filter(known) },
          { texts: 'removed', names: names.filter(known) },
        ].filter((segment) => segment.names.length)
      : [{ texts: 'all', names }];
    sql.exec('DELETE FROM analysis_resolve');
    // Thousands of names: each segment's list apart, read only when its counter is built.
    sql.exec("INSERT INTO analysis_resolve(key,value) VALUES('plan',?)", JSON.stringify({ incremental: !!base, segments: segments.map(({ texts }) => ({ texts })) }));
    segments.forEach((segment, index) => sql.exec('INSERT INTO analysis_resolve(key,value) VALUES(?,?)', `names:${index}`, JSON.stringify(segment.names)));
    this.resolving = null;
    this.ctx.storage.sql.exec(
      "UPDATE competitor_analysis_jobs SET phase='resolve',cursor_id='',updated_at=? WHERE id=1 AND revision=?",
      new Date().toISOString(),
      job.revision,
    );
  }

  /** The active analysis's lowercase counts and the names they were counted for, when they still match its answers. */
  private baseLowercase() {
    if (this.meta('analysis_answers') !== this.meta('analysis_revision')) return null;
    const stored = (key: string) => this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM analysis_lowercase WHERE key=?', key).toArray()[0]?.value;
    const names = parseJson(stored('names') ?? 'null') as [string, string][] | null;
    const counts = parseJson(stored('counts') ?? 'null') as LowercaseCounts | null;
    return names && counts ? { names: new Map(names), counts } : null;
  }

  /**
   * RESOLVE_TEXTS texts of the current segment read for lowercase words (they add up, lowercaseCounter); after the last
   * segment, the pass is promoted in one transaction with the job's completion. Answers that arrived meanwhile read the
   * window again after it. The job's cursor is `segment:run id` of the last saved counts.
   */
  private resolveStep(job: AnalysisJob) {
    const sql = this.ctx.storage.sql;
    const targets = JSON.parse(job.targets_json) as DiscoverySeed[];
    type Segment = { texts: 'all' | 'added' | 'removed' };
    const stored = (key: string) => sql.exec<{ value: string }>('SELECT value FROM analysis_resolve WHERE key=?', key).toArray()[0]?.value ?? 'null';
    const plan = (parseJson(stored('plan')) ?? { incremental: false, segments: [] }) as { incremental: boolean; segments: Segment[] };
    // Built once per segment (thousands of names) and kept by this instance between alarms; a new instance goes on from the
    // counts saved last (analysis_resolve `counts:<segment>`, at the job's cursor).
    const saved = `${job.revision}|${job.cursor_id ?? ''}`;
    let state = this.resolving?.saved === saved ? this.resolving : null;
    if (!state) {
      const cursor = job.cursor_id || '0:';
      const segment = Number(cursor.slice(0, cursor.indexOf(':'))) || 0;
      const run = cursor.slice(cursor.indexOf(':') + 1);
      const names = ((parseJson(stored(`names:${segment}`)) ?? []) as [string, string][]).map(([key, name]) => ({ key, name }));
      const counts = run ? ((parseJson(stored(`counts:${segment}`)) as LowercaseCounts | null) ?? undefined) : undefined;
      // Rebuilt: saved after this part, so an instance that never lives to the next alarm still moves on.
      state = { saved, segment, cursor: run, unsaved: RESOLVE_SAVE_TEXTS, counter: lowercaseCounter(names, counts) };
    }
    // Out of the cache while it counts: a failure part way leaves nothing half counted for the next alarm.
    this.resolving = null;
    const segment = plan.segments[state.segment];
    if (segment) {
      const texts = {
        all: 'SELECT n.run_id,(SELECT answer FROM runs WHERE id=n.run_id) answer FROM competitor_answer_names n WHERE n.revision=?1 AND n.run_id>?3',
        added: `SELECT n.run_id,(SELECT answer FROM runs WHERE id=n.run_id) answer FROM competitor_answer_names n WHERE n.revision=?1 AND n.run_id>?3
          AND NOT EXISTS(SELECT 1 FROM competitor_answer_names b WHERE b.revision=?2 AND b.run_id=n.run_id)`,
        removed: `SELECT b.run_id,(SELECT answer FROM runs WHERE id=b.run_id) answer FROM competitor_answer_names b WHERE b.revision=?2 AND b.run_id>?3
          AND NOT EXISTS(SELECT 1 FROM competitor_answer_names n WHERE n.revision=?1 AND n.run_id=b.run_id)`,
      }[segment.texts];
      const limit = this.idle() ? RESOLVE_TEXTS * 2 : RESOLVE_TEXTS;
      const rows = sql
        .exec<{ run_id: string; answer: string | null }>(`${texts} ORDER BY 1 LIMIT ?4`, this.passTag(job.revision), this.activeTag(), state.cursor, limit)
        .toArray();
      for (const row of rows) if (row.answer) state.counter.add(row.answer);
      const last = rows.length === limit;
      // The segment's counts are saved when it ends (or every RESOLVE_SAVE_TEXTS texts); the next segment starts its own counter.
      if (!last || state.unsaved + rows.length >= RESOLVE_SAVE_TEXTS) {
        const cursor = last ? `${state.segment}:${rows.at(-1)!.run_id}` : `${state.segment + 1}:`;
        const counter = state.counter;
        this.ctx.storage.transactionSync(() => {
          sql.exec('INSERT OR REPLACE INTO analysis_resolve(key,value) VALUES(?,?)', `counts:${state.segment}`, JSON.stringify(counter.counts()));
          sql.exec('UPDATE competitor_analysis_jobs SET cursor_id=?,updated_at=? WHERE id=1 AND revision=?', cursor, new Date().toISOString(), job.revision);
        });
        if (last) this.resolving = { saved: `${job.revision}|${cursor}`, segment: state.segment, cursor: rows.at(-1)!.run_id, unsaved: 0, counter };
      } else this.resolving = { ...state, cursor: rows.at(-1)!.run_id, unsaved: state.unsaved + rows.length };
      void this.ctx.storage.setAlarm(Date.now() + ALARM_GAP_MS);
      return this.analysisStatus();
    }
    // Every segment is counted: the window's counts, from the active analysis's plus what changed when the pass extends it.
    const segmentCounts = plan.segments.map((_, index) => (parseJson(stored(`counts:${index}`)) ?? { words: {}, phrases: {} }) as LowercaseCounts);
    const counts: LowercaseCounts = { words: {}, phrases: {} };
    if (plan.incremental) {
      const base = this.baseLowercase()!;
      const at = (texts: Segment['texts']) => plan.segments.findIndex((item) => item.texts === texts);
      const [all, added, removed] = [at('all'), at('added'), at('removed')].map((index) => segmentCounts[index] ?? { words: {}, phrases: {} });
      const known = (parseJson(stored(`names:${at('added') >= 0 ? at('added') : at('removed')}`)) ?? []) as [string, string][];
      const own = (counted: Record<string, number>, key: string) => (Object.hasOwn(counted, key) ? counted[key]! : 0);
      for (const [key, name] of known) {
        for (const word of key.split(' ')) counts.words[word] = own(base.counts.words, word) + own(added!.words, word) - own(removed!.words, word);
        // A name of several words written another way in lowercase is also counted whole (lowercaseCounter's phrases).
        if (/\s/u.test(name) && name.toLocaleLowerCase() !== name)
          counts.phrases[key] = own(base.counts.phrases, key) + own(added!.phrases, key) - own(removed!.phrases, key);
      }
      // The missing names were counted over every text: theirs is the exact count, also for a word they share with the others.
      Object.assign(counts.words, all!.words);
      Object.assign(counts.phrases, all!.phrases);
    } else Object.assign(counts, segmentCounts[0] ?? counts);
    const names = plan.segments.flatMap((item, index) => (item.texts === 'removed' ? [] : ((parseJson(stored(`names:${index}`)) ?? []) as [string, string][])));
    const current = sql.exec<AnalysisJob>('SELECT * FROM competitor_analysis_jobs WHERE id=1').toArray()[0]!;
    const rescan = !!current.needs_rescan;
    this.ctx.storage.transactionSync(() => {
      sql.exec("UPDATE competitor_analysis_jobs SET status='complete',error=NULL,updated_at=? WHERE id=1 AND revision=?", new Date().toISOString(), job.revision);
      this.promoteAnalysis(current, targets, lowercaseFrom(counts));
      sql.exec('DELETE FROM analysis_resolve');
      sql.exec('DELETE FROM analysis_lowercase');
      sql.exec("INSERT INTO analysis_lowercase(key,value) VALUES('names',?),('counts',?)", JSON.stringify(names), JSON.stringify(counts));
      this.resolving = null;
      // Answers arrived during the pass: the window it read is promoted, then read again for them (extending when it can).
      if (rescan) this.rescanWindow(current);
    });
    if (rescan) void this.ctx.storage.setAlarm(Date.now() + 250);
    return this.analysisStatus();
  }

  /** The pass starts again from its first answer, reading every one (a detector change, or a change an extension cannot follow). */
  private restartPass(job: AnalysisJob) {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      this.clearStaging(job.revision);
      this.newPassTag(job.revision);
      sql.exec('DELETE FROM analysis_resolve');
      sql.exec(
        `UPDATE run_rows SET analysis_pending_revision=NULL,analysis_pending_targets_json=NULL,analysis_pending_mentions_json=NULL
         WHERE analysis_pending_revision=?`,
        job.revision,
      );
      sql.exec("DELETE FROM mention_asks WHERE slot='pending'");
      sql.exec(
        `UPDATE competitor_analysis_jobs SET processed=0,scanned=0,phase='seeds',cursor_created_at=NULL,cursor_id=NULL,
         status='pending',error=NULL,updated_at=?,seed_answers_json='[]' WHERE id=1 AND revision=?`,
        new Date().toISOString(),
        job.revision,
      );
      this.setMeta('analysis_job_detector', DETECTOR_VERSION);
    });
    void this.ctx.storage.setAlarm(Date.now() + 250);
    return this.analysisStatus();
  }

  /**
   * The pass's answers become the active analysis (one transaction with the job's completion): its questions, overlays and
   * suggestions; the ranks it carried for the answers it did not read; and its answer rows, kept for the next pass to extend.
   */
  private promoteAnalysis(job: AnalysisJob, targets: DiscoverySeed[], lowercase: LowercaseUse) {
    const sql = this.ctx.storage.sql;
    // The pass's questions become the active ones, in the same transaction as the overlays they decide.
    sql.exec(
      "DELETE FROM mention_asks WHERE slot='active' AND run_id IN (SELECT id FROM run_rows WHERE analysis_pending_revision=?)",
      job.revision,
    );
    sql.exec(
      "UPDATE mention_asks SET slot='active' WHERE slot='pending' AND run_id IN (SELECT id FROM run_rows WHERE analysis_pending_revision=?)",
      job.revision,
    );
    sql.exec(
      `UPDATE run_rows SET analysis_revision=analysis_pending_revision,
       analysis_targets_json=analysis_pending_targets_json,
       analysis_mentions_json=analysis_pending_mentions_json,
       analysis_pending_revision=NULL,analysis_pending_targets_json=NULL,
       analysis_pending_mentions_json=NULL
       WHERE analysis_pending_revision=?`,
      job.revision,
    );
    // Ranks of an answer the pass did not read, under the reading it now has (a verdict since then changed the reading: none).
    sql.exec(
      `INSERT OR IGNORE INTO run_positions(run_id,basis,entries_json)
       SELECT n.run_id,n.positions_basis,n.positions_json FROM competitor_answer_names n JOIN run_rows r ON r.id=n.run_id
       WHERE n.revision=? AND n.positions_json IS NOT NULL AND r.analysis_revision=?
       AND n.positions_basis=r.analysis_revision||':'||COALESCE(r.analysis_mentions_json,'')||?`,
      this.passTag(job.revision),
      job.revision,
      POSITIONS_BASIS_SUFFIX,
    );
    this.resolveSuggestions(job.revision, targets, lowercase);
    const common = this.commonNames(job.revision, targets);
    // The active rows become the pass's. A pass that carried nothing gives its tag: no row is rewritten, the old ones are
    // dropped a part per alarm. Otherwise a carried answer keeps its row (its names a new target covers are left out when
    // read, and an answer naming a spelling the targets lose is read again), the others take the rows the pass wrote, and an
    // answer the window let go of loses its row: only what the pass read is written.
    const tag = this.passTag(job.revision);
    const active = this.activeTag();
    const [measure] = sql
      .exec<{ read: number; carried: number }>('SELECT SUM(reused=0) read,SUM(reused=1) carried FROM competitor_answer_names WHERE revision=?', tag)
      .toArray();
    this.setMeta('analysis_last_pass', JSON.stringify({ read: Number(measure?.read ?? 0), carried: Number(measure?.carried ?? 0) }));
    if (!Number(measure?.carried ?? 0)) {
      if (active !== tag) this.dropTag(active);
      this.setMeta('analysis_answers_tag', tag);
    } else {
      sql.exec(
        'DELETE FROM competitor_answer_names WHERE revision=? AND run_id NOT IN (SELECT run_id FROM competitor_answer_names WHERE revision=? AND reused=1)',
        active,
        tag,
      );
      sql.exec('DELETE FROM competitor_answer_names WHERE revision=? AND reused=1', tag);
      sql.exec('UPDATE competitor_answer_names SET revision=?,positions_basis=NULL,positions_json=NULL WHERE revision=?', active, tag);
    }
    this.setMeta('analysis_answers', job.revision);
    this.setMeta('analysis_answers_common', JSON.stringify({ names: [...common.names].sort(), terms: [...common.terms].sort() }));
    this.setMeta('analysis_answers_model', this.meta('mention_model') ?? '1');
    this.setMeta('analysis_revision', job.revision);
    this.setMeta('analysis_targets_json', job.targets_json);
    // A pass begun by an older detector and finished by this one is still the older one's.
    this.setMeta('analysis_detector', this.meta('analysis_job_detector') ?? '');
    this.setMeta('analysis_mutation_revision', String(Number(this.meta('analysis_mutation_revision') || 0) + 1));
  }

  /** After a promoted pass that new answers arrived during: the same targets over the current window. */
  private rescanWindow(job: AnalysisJob) {
    const sql = this.ctx.storage.sql;
    const cutoff = new Date(Date.now() - ANALYSIS_WINDOW_MS).toISOString();
    const eligible = Number(
      sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) count FROM (
             SELECT id FROM runs WHERE status='complete' AND response_available=1
             AND answer IS NOT NULL AND created_at>=?
             ORDER BY created_at DESC,id DESC LIMIT ?)`,
          cutoff,
          job.max_runs + 1,
        )
        .one().count,
    );
    sql.exec("DELETE FROM mention_asks WHERE slot='pending'");
    this.clearStaging(job.revision);
    this.newPassTag(job.revision);
    sql.exec(
      `UPDATE competitor_analysis_jobs SET processed=0,scanned=0,phase=?,
       cutoff=?,total_eligible=?,truncated=?,
       cursor_created_at=NULL,cursor_id=NULL,status=?,error=NULL,
       updated_at=?,seed_answers_json='[]',needs_rescan=0
       WHERE id=1 AND revision=?`,
      this.extendable(JSON.parse(job.targets_json) as DiscoverySeed[], this.meta('mention_model') !== '0') ? 'extend' : 'seeds',
      cutoff,
      Math.min(eligible, job.max_runs),
      eligible > job.max_runs ? 1 : 0,
      eligible ? 'pending' : 'complete',
      new Date().toISOString(),
      job.revision,
    );
    if (eligible) this.setMeta('analysis_extend_base', this.meta('analysis_revision') ?? '');
    else this.clearActiveAnalysis();
  }

  /**
   * What a change from the active analysis's targets to `next` alters, or null when an extension cannot follow it (the
   * remaining targets reordered). An answer holding none of the needles reads exactly as before: added or changed targets
   * are not named in it (false), the others' mentions stand, and its names lose only those the new targets now cover.
   */
  private extendDiff(next: DiscoverySeed[]): ExtendDiff | null {
    let base: DiscoverySeed[];
    try {
      base = JSON.parse(this.meta('analysis_targets_json') || 'null');
    } catch {
      return null;
    }
    if (!Array.isArray(base)) return null;
    const text = (target: DiscoverySeed) => JSON.stringify(target);
    const before = new Set(base.map(text));
    const after = new Set(next.map(text));
    const kept = next.filter((target) => before.has(text(target)));
    if (JSON.stringify(base.filter((target) => after.has(text(target)))) !== JSON.stringify(kept)) return null;
    const names = (targets: DiscoverySeed[]) => targets.flatMap((target) => [target.name, ...(target.aliases ?? [])]);
    const changed = [...next.filter((target) => !before.has(text(target))), ...base.filter((target) => !after.has(text(target)))];
    // A spelling the targets no longer have stops covering the names that share a word with it ("Video" of "Prime Video").
    const remaining = new Set(names(next).map(brandDetectionKey));
    const words = names(base)
      .map(brandDetectionKey)
      .filter((key) => !remaining.has(key))
      .flatMap((key) => key.split(' '))
      .map((word) => word.replace(/(?<=\p{L}{3})s$/u, ''));
    const needles = [...new Set([...names(changed), ...words].flatMap(compactFolds).filter(Boolean))];
    return { kept: new Set(kept.map((target) => target.name)), needles, spellings: new Set(names(changed).map((name) => mentionText(name.trim()))) };
  }

  /** Whether the next pass over `targets` can extend the active analysis instead of reading every answer again. */
  private extendable(targets: DiscoverySeed[], mentionModel: boolean) {
    const active = this.meta('analysis_revision');
    return (
      !!active &&
      this.meta('analysis_answers') === active &&
      this.meta('analysis_detector') === DETECTOR_VERSION &&
      this.meta('analysis_answers_model') === (mentionModel ? '1' : '0') &&
      !!this.meta('analysis_answers_common') &&
      !!this.extendDiff(targets)
    );
  }

  /**
   * Up to EXTEND_PAGES_PER_ALARM extending pages, then the store answers reads again: each answer the change can alter is
   * analysed as a full pass would (the same functions, the same window), every other one is carried from the active
   * analysis: its mentions, names and tallies, and its ranks. The common words are read again over the window first; when
   * the other targets' change (the window moved), the pass reads every answer (restartPass).
   */
  private processExtendPages(job: AnalysisJob) {
    const sql = this.ctx.storage.sql;
    const targets = JSON.parse(job.targets_json) as DiscoverySeed[];
    const base = this.meta('analysis_extend_base');
    const diff = base && base === this.meta('analysis_revision') && this.meta('analysis_answers') === base ? this.extendDiff(targets) : null;
    if (!diff) return this.restartPass(job);
    if (!this.commonRead(job.revision)) {
      this.commonNames(job.revision, targets);
      void this.ctx.storage.setAlarm(Date.now() + ALARM_GAP_MS);
      return this.analysisStatus();
    }
    const common = this.commonNames(job.revision, targets);
    const saved = parseJson(this.meta('analysis_answers_common') ?? 'null') as { names?: string[]; terms?: string[] } | null;
    const others = (names: Iterable<string>, terms: Iterable<string>) =>
      JSON.stringify([
        [...names].filter((name) => !diff.spellings.has(name)).sort(),
        [...terms].filter((term) => ![...diff.spellings].some((spelling) => term.includes(spelling))).sort(),
      ]);
    if (!saved || others(saved.names ?? [], saved.terms ?? []) !== others(common.names, common.terms)) return this.restartPass(job);
    const tracked = trackedBrandKeys(targets, common.names);
    let current = job;
    for (let page = 1; ; page++) {
      if (this.extendPage(current, targets, diff, common, tracked)) {
        void this.ctx.storage.setAlarm(Date.now() + 250);
        break;
      }
      if (page >= (this.idle() ? EXTEND_PAGES_PER_ALARM : 1)) {
        void this.ctx.storage.setAlarm(Date.now() + ALARM_GAP_MS);
        break;
      }
      current = sql.exec<AnalysisJob>('SELECT * FROM competitor_analysis_jobs WHERE id=1').toArray()[0]!;
    }
    return this.analysisStatus();
  }

  /** One extending page (one transaction); true when the pass is over (promoted, or started again for new answers). */
  private extendPage(
    job: AnalysisJob,
    targets: DiscoverySeed[],
    diff: ExtendDiff,
    common: { names: Set<string>; terms: Set<string> },
    tracked: (key: string) => boolean,
  ) {
    const sql = this.ctx.storage.sql;
    const base = this.meta('analysis_revision')!;
    const cursor = job.cursor_created_at ? ' AND (r.created_at<? OR (r.created_at=? AND r.id<?))' : '';
    const params: Array<string | number> = [this.activeTag(), POSITIONS_BASIS_SUFFIX, job.cutoff];
    if (job.cursor_created_at) params.push(job.cursor_created_at, job.cursor_created_at, job.cursor_id || '');
    const requestedLimit = Math.min(EXTEND_PAGE_ROWS, job.max_runs - job.processed);
    params.push(requestedLimit);
    const fetched = sql
      .exec<{
        id: string;
        answer: string;
        sources_json: string;
        created_at: string;
        prompt_text: string | null;
        revision: string | null;
        mentions: string | null;
        keys_json: string | null;
        tallies_json: string | null;
        positions: string | null;
        asked: number;
      }>(
        `SELECT r.id,r.answer,r.sources_json,r.created_at,r.prompt_text,r.analysis_revision revision,r.analysis_mentions_json mentions,
           n.keys_json,n.tallies_json,p.entries_json positions,
           EXISTS(SELECT 1 FROM mention_asks a WHERE a.run_id=r.id AND a.slot='active') asked
         FROM runs r LEFT JOIN competitor_answer_names n ON n.revision=? AND n.run_id=r.id
         LEFT JOIN run_positions p ON p.run_id=r.id AND p.basis=r.analysis_revision||':'||COALESCE(r.analysis_mentions_json,'')||?
         WHERE r.status='complete' AND r.response_available=1 AND r.answer IS NOT NULL
         AND r.created_at>=?${cursor} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`,
        ...params,
      )
      .toArray();
    const encoder = new TextEncoder();
    type Carried = AnswerTallies & { reused?: boolean; positionsBasis?: string | null; positionsJson?: string | null };
    const carried: Carried[] = [];
    const mentions = new Map<string, string>();
    // The questions of a carried answer stay the same (none names a changed target): copied to the pass, as a full pass asks them.
    type Ask = { brand: string; request_json: string; counted: number | null; decided_config: string | null };
    const asks: [string, Ask][] = [];
    const read: typeof fetched = [];
    let readBytes = 0;
    let taken = 0;
    for (const row of fetched) {
      const before = row.revision === base && row.keys_json && row.tallies_json ? (parseJson(row.mentions || 'null') as Record<string, unknown> | null) : null;
      const asked = before && row.asked
        ? sql.exec<Ask>("SELECT brand,request_json,counted,decided_config FROM mention_asks WHERE run_id=? AND slot='active'", row.id).toArray()
        : [];
      const reusable =
        !!before &&
        targets.every((target) => !diff.kept.has(target.name) || typeof before[target.name] === 'boolean') &&
        asked.every((ask) => diff.kept.has(ask.brand)) &&
        !compactFolds(row.answer).some((fold) => diff.needles.some((needle) => fold.includes(needle)));
      if (!reusable) {
        const bytes = encoder.encode(row.answer).byteLength;
        if (read.length && (read.length >= ANALYSIS_PAGE_SIZE || readBytes + bytes > ANALYSIS_PAGE_BYTES)) break;
        read.push(row);
        readBytes += bytes;
      } else {
        // A full pass counts an asked mention by the verdict on the same question (overlayMentions).
        const verdicts = new Map(asked.map((ask) => [ask.brand, ask.counted === 1]));
        for (const ask of asked) asks.push([row.id, ask]);
        const json = JSON.stringify(
          Object.fromEntries(targets.map((target) => [target.name, diff.kept.has(target.name) ? (verdicts.get(target.name) ?? before![target.name]) : false])),
        );
        mentions.set(row.id, json);
        // Its names stay in its active row; their tallies count in this pass, less those the new targets cover.
        const tallies = (JSON.parse(row.tallies_json!) as PackedTally[]).map((item) => unpackTally(item, row.id, row.created_at)).filter((tally) => !tracked(tally.key));
        carried.push({
          id: row.id,
          createdAt: row.created_at,
          keys: [],
          tallies,
          reused: true,
          positionsBasis: row.positions == null ? null : `${job.revision}:${json}${POSITIONS_BASIS_SUFFIX}`,
          positionsJson: row.positions,
        });
      }
      taken++;
    }
    const rows = fetched.slice(0, taken);
    const page = tallyNames(
      read.map((row) => ({ id: row.id, answer: row.answer, sources: JSON.parse(row.sources_json || '[]'), createdAt: row.created_at })),
      targets,
      MAX_EVIDENCE,
      common.names,
      this.knownBrands(),
    );
    for (const row of read)
      mentions.set(row.id, this.overlayMentions(row.id, row.answer, row.sources_json, targets, common, 'pending', row.prompt_text));
    const answers = [...carried, ...page.answers];
    const sum = new Map<string, NameTally>();
    for (const answer of answers)
      for (const tally of answer.tallies) sum.set(tally.key, sum.has(tally.key) ? mergeNameTally(sum.get(tally.key)!, tally, MAX_EVIDENCE) : tally);
    const processed = job.processed + rows.length;
    const done = (rows.length === fetched.length && fetched.length < requestedLimit) || processed >= job.max_runs;
    const last = rows.at(-1);
    this.ctx.storage.transactionSync(() => {
      for (const [id, json] of mentions)
        sql.exec(
          `UPDATE run_rows SET analysis_pending_revision=?,analysis_pending_targets_json=?,analysis_pending_mentions_json=?
           WHERE id=? AND status='complete' AND response_available=1`,
          job.revision,
          job.targets_json,
          json,
          id,
        );
      for (const [id, ask] of asks)
        sql.exec(
          'INSERT OR REPLACE INTO mention_asks(run_id,brand,slot,request_json,counted,decided_config) VALUES(?,?,?,?,?,?)',
          id,
          ask.brand,
          'pending',
          ask.request_json,
          ask.counted,
          ask.counted === null ? null : ask.decided_config,
        );
      this.stageNames(job.revision, this.passTag(job.revision), [...sum.values()], answers);
      sql.exec(
        `UPDATE competitor_analysis_jobs SET processed=?,cursor_created_at=?,cursor_id=?,status='running',error=NULL,updated_at=?
         WHERE id=1 AND revision=?`,
        processed,
        last?.created_at ?? job.cursor_created_at,
        last?.id ?? job.cursor_id,
        new Date().toISOString(),
        job.revision,
      );
      if (done) this.beginResolve(job);
    });
    return done;
  }

  /**
   * A restore driver (lib/server/project-restores.ts): an instance of its own, named after the restore, that only runs
   * restoreStep from its alarm until the restore ends. It never holds store data, and a store generation never drives.
   */
  private async drive(id: unknown) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || this.meta('owner')) throw new Error('Invalid restore');
    this.setMeta('restore_drive', id);
    await this.alarmBy(Date.now() + 50);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  async alarm() {
    const restore = this.meta('restore_drive');
    if (restore) {
      let more = true;
      try {
        if (!restoreDriver) throw new Error('No restore driver');
        more = await restoreDriver(restore);
      } catch {
        // restoreStep records its own failures; anything else (its database unreachable) is tried again shortly.
      }
      if (more) await this.ctx.storage.setAlarm(Date.now() + 1000);
      else this.ctx.storage.sql.exec("DELETE FROM store_meta WHERE key='restore_drive'");
      return;
    }
    const epoch = this.epoch();
    let sourcesRetry = 0;
    try {
      if (this.canonicalizeSourcesPage()) sourcesRetry = 100;
    } catch {
      // The page is retried later; reports keep reading the stored rows meanwhile.
      sourcesRetry = 30_000;
    }
    try {
      if (this.moveAnswersPage()) sourcesRetry ||= 100;
    } catch {
      // Same: `runs` reads the text where it is.
      sourcesRetry = 30_000;
    }
    try {
      if (await this.scanProductsPage()) sourcesRetry ||= 100;
    } catch {
      // An archive read failed: the page is read again later; Products shows the cards found so far.
      sourcesRetry ||= 30_000;
    }
    if (sourcesRetry) {
      const current = await this.ctx.storage.getAlarm();
      if (current === null || current > Date.now() + sourcesRetry) await this.ctx.storage.setAlarm(Date.now() + sourcesRetry);
    }
    const revision = this.ctx.storage.sql
      .exec<{ revision: string }>(
        'SELECT revision FROM competitor_analysis_jobs WHERE id=1',
      )
      .toArray()[0]?.revision;
    try {
      // Answers are arriving (an import, a collection publishing): their writes go first, the analysis goes on after them.
      if (Date.now() - this.lastWrite < WRITES_QUIET_MS) await this.alarmBy(this.lastWrite + WRITES_QUIET_MS);
      else {
        this.quiet = true;
        this.processAnalysisPage();
      }
    } catch (error) {
      this.ctx.storage.sql.exec(
        "UPDATE competitor_analysis_jobs SET status='failed',error=?,updated_at=? WHERE id=1 AND revision=?",
        error instanceof Error
          ? error.message.slice(0, 500)
          : 'Competitor analysis failed',
        new Date().toISOString(),
        revision || '',
      );
    } finally {
      this.quiet = false;
    }
    // One heavy step per alarm: on the Netflix copy, a pass's page, 2,000 dropped rows, an offsets page and a recomputed
    // report in the same turn took up to 5 s, and Cloudflare dropped the reads queued behind it. While a pass runs (or
    // waits for writes), the rest waits for it; then one of them per alarm, the remembered reads last.
    const passing = this.ctx.storage.sql
      .exec<{ status: string }>("SELECT status FROM competitor_analysis_jobs WHERE id=1 AND status IN ('pending','running')")
      .toArray().length > 0;
    let worked = passing;
    if (passing) await this.alarmBy(Date.now() + ALARM_GAP_MS);
    try {
      // Rows of tags no longer used, a part per alarm.
      if (!worked && this.ctx.storage.transactionSync(() => this.dropStep())) {
        worked = true;
        await this.alarmBy(Date.now() + ALARM_GAP_MS);
      }
    } catch {
      await this.alarmBy(Date.now() + 30_000);
    }
    try {
      if (!worked && this.ctx.storage.transactionSync(() => this.fillBrandOffsets())) {
        worked = true;
        await this.alarmBy(Date.now() + ALARM_GAP_MS);
      }
    } catch {
      // Offsets only refine positions: the next alarm tries the page again.
      await this.alarmBy(Date.now() + 30_000);
    }
    try {
      if (!worked && (await this.backupStep())) {
        worked = true;
        await this.alarmBy(Date.now() + 100);
      }
    } catch (error) {
      const job = this.backupJob();
      if (job?.status === 'running')
        this.setMeta('backup_job', JSON.stringify({ ...job, status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'Backup failed' }));
    }
    // A promoted analysis or moved rows count as a change; then one remembered read is recomputed, if any is due.
    try {
      await this.changed(epoch);
      if (!worked && (await this.warmStep()))
        await this.alarmBy(Math.max(Number(this.meta('warm_after') || 0), Date.now() + WARM_GAP_MS));
    } catch {
      // Warming only saves time: the next change or the next read computes the reports anyway.
    }
  }
  private authorize(scope: StoreScope, initialize = false) {
    if (!validStoreScope(scope)) throw new Error('Invalid storage scope');
    const sql = this.ctx.storage.sql;
    const existing = sql
      .exec<{ key: string; value: string }>('SELECT key,value FROM store_meta')
      .toArray();
    if (!existing.length) {
      if (!initialize) throw new Error('Storage generation is not initialized');
      this.ctx.storage.transactionSync(() => {
        for (const [key, value] of Object.entries({
          owner: scope.ownerId,
          project: scope.projectId,
          generation: scope.generation,
          schema: '1',
          // A new store only ever receives canonical sources (apply), so there is nothing to rewrite.
          sources_canonical: 'done',
        }))
          sql.exec('INSERT INTO store_meta(key,value) VALUES(?,?)', key, value);
      });
    } else {
      const meta = Object.fromEntries(existing.map((r) => [r.key, r.value]));
      if (
        meta.owner !== scope.ownerId ||
        meta.project !== scope.projectId ||
        meta.generation !== scope.generation ||
        meta.schema !== '1'
      )
        throw new Error('Storage ownership mismatch');
    }
  }
  /**
   * The project was deleted: everything this generation holds goes (tables, report copies, the alarm). Only its own project
   * may ask; a store never initialized has nothing to check and is wiped the same way.
   */
  private async erase(scope: StoreScope) {
    if (!validStoreScope(scope)) throw new Error('Invalid storage scope');
    const meta = Object.fromEntries(
      this.ctx.storage.sql.exec<{ key: string; value: string }>("SELECT key,value FROM store_meta WHERE key IN ('project','generation')").toArray().map((row) => [row.key, row.value]),
    );
    if ((meta.project && meta.project !== scope.projectId) || (meta.generation && meta.generation !== scope.generation))
      throw new Error('Storage ownership mismatch');
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    return { erased: true };
  }
  /** The project moved workspace: the owner sealed into this store (and its rows) goes from `from` to the scope's. Idempotent. */
  private rekey(scope: StoreScope, from: unknown) {
    if (!validStoreScope(scope) || typeof from !== 'string' || !from || from.length > 200) throw new Error('Invalid storage scope');
    const sql = this.ctx.storage.sql;
    const meta = Object.fromEntries(sql.exec<{ key: string; value: string }>('SELECT key,value FROM store_meta').toArray().map((r) => [r.key, r.value]));
    if (meta.project !== scope.projectId || meta.generation !== scope.generation) throw new Error('Storage ownership mismatch');
    if (meta.owner === scope.ownerId) return { rekeyed: false };
    if (meta.owner !== from) throw new Error('Storage ownership mismatch');
    this.ensureRunSplit();
    this.ctx.storage.transactionSync(() => {
      sql.exec("UPDATE store_meta SET value=? WHERE key='owner'", scope.ownerId);
      // `runs` is a view over `run_rows` (the answer split); the epoch triggers drop the reports kept for the old owner.
      sql.exec('UPDATE run_rows SET owner_id=? WHERE owner_id=?', scope.ownerId, from);
      sql.exec('UPDATE semantic_evaluations SET owner_id=? WHERE owner_id=?', scope.ownerId, from);
    });
    return { rekeyed: true };
  }
  private apply(scope: StoreScope, changes: StoreChange[]) {
    if (!Array.isArray(changes) || changes.length > 100)
      throw new Error('Invalid publication batch');
    const sql = this.ctx.storage.sql;
    let applied = 0;
    let restartAnalysis = false;
    let activeOverlayChanged = false;
    const activeRevision = this.meta('analysis_revision');
    const activeTargets = this.activeTargets();
    const activeTargetsJson = activeTargets.length
      ? JSON.stringify(activeTargets)
      : null;
    this.ctx.storage.transactionSync(() => {
      for (const change of changes) {
        if (
          !['runs', 'prompts', 'semantic_evaluations'].includes(change.entity) ||
          typeof change.id !== 'string' ||
          !change.id ||
          change.id.length > 200 ||
          !Number.isSafeInteger(change.revision) ||
          change.revision < 0
        )
          throw new Error('Invalid publication');
        const data = change.data;
        if (
          data &&
          (data.id !== change.id ||
            data.project_id !== scope.projectId ||
            (change.entity !== 'prompts' && data.owner_id !== scope.ownerId))
        )
          throw new Error('Publication ownership mismatch');
        const version = sql
          .exec<{ revision: number }>(
            'SELECT revision FROM store_versions WHERE entity=? AND id=?',
            change.entity,
            change.id,
          )
          .toArray()[0];
        if (version && version.revision >= change.revision) continue;
        if (change.entity === 'runs' && change.revision > 0) {
          const changesEligibility =
            !data ||
            ['answer', 'status', 'response_available', 'created_at'].some(
              (key) => Object.prototype.hasOwnProperty.call(data, key),
            );
          if (changesEligibility) {
            const previous = sql
              .exec<{
                status: string;
                response_available: StoreValue;
                has_answer: number;
                created_at: string;
              }>(
                'SELECT status,response_available,answer IS NOT NULL has_answer,created_at FROM runs WHERE id=?',
                change.id,
              )
              .toArray()[0];
            const wasEligible =
              previous?.status === 'complete' &&
              storeFlag(previous.response_available) &&
              previous.has_answer === 1;
            const nextResponseAvailable =
              data &&
              Object.prototype.hasOwnProperty.call(data, 'response_available')
                ? data.response_available
                : previous?.response_available;
            const nextEligible =
              !!data &&
              (data.status ?? previous?.status) === 'complete' &&
              storeFlag(nextResponseAvailable, !previous) &&
              (Object.prototype.hasOwnProperty.call(data, 'answer')
                ? data.answer !== null
                : previous?.has_answer === 1);
            restartAnalysis ||= Boolean(
              wasEligible !== nextEligible ||
              (nextEligible &&
                (Object.prototype.hasOwnProperty.call(data!, 'answer') ||
                  (data!.created_at !== undefined &&
                    data!.created_at !== previous?.created_at))),
            );
          }
        }
        if (change.entity === 'semantic_evaluations' && !data)
          throw new Error('Semantic assessments are append-only');
        if (data) {
          const columns = storeColumns(change.entity).filter((column) =>
            Object.prototype.hasOwnProperty.call(data, column),
          );
          const values = columns.map((key) =>
            change.entity === 'runs' && (key === 'sources_json' || key === 'consulted_sources_json')
              ? (canonicalCitationsJson(data[key] as string | null) ?? null)
              : (data[key] ?? null),
          );
          if (
            values.some(
              (v) =>
                typeof v !== 'string' && typeof v !== 'number' && v !== null,
            )
          )
            throw new Error('Invalid publication values');
          if (!columns.length) {
            // a publication with no known column (an old products side channel) only advances the revision
          } else if (change.entity === 'semantic_evaluations') {
            const previous = sql.exec<StoreRow>(
              `SELECT ${storeColumns(change.entity).join(',')} FROM semantic_evaluations WHERE id=?`,
              change.id,
            ).toArray()[0];
            if (previous && canonicalStoreRow(change.entity, previous, 3) !== canonicalStoreRow(change.entity, data, 3))
              throw new Error('Semantic assessment mutation rejected');
            if (!previous) sql.exec(
              `INSERT INTO semantic_evaluations(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
              ...values,
            );
          } else {
            // A run's text goes to run_answers; its row keeps none inline (see RUN_ROW_COLUMNS).
            const text = change.entity === 'runs' ? columns.indexOf('answer') : -1;
            sql.exec(
              `INSERT INTO ${change.entity === 'runs' ? 'run_rows' : change.entity}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns
                .filter((c) => c !== 'id')
                .map((c) => `${c}=excluded.${c}`)
                .join(',')}`,
              ...values.map((value, index) => (index === text ? null : value)),
            );
            // The active analysis's rows of this answer read its old text, links or question: the next pass reads it again.
            if (change.entity === 'runs' && (text >= 0 || columns.includes('sources_json') || columns.includes('prompt_text'))) {
              // The active counts counted its old text: the next extension reads every text again (analysis_lowercase).
              if (sql.exec('DELETE FROM competitor_answer_names WHERE revision=? AND run_id=?', this.activeTag(), change.id).rowsWritten) sql.exec('DELETE FROM analysis_lowercase');
            }
            if (text >= 0) {
              if (values[text] === null) sql.exec('DELETE FROM run_answers WHERE run_id=?', change.id);
              else
                sql.exec(
                  'INSERT INTO run_answers(run_id,answer) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET answer=excluded.answer',
                  change.id,
                  values[text],
                );
              // New text, new ranks: the row trigger (run_positions_update) does not see the text.
              sql.exec('DELETE FROM run_positions WHERE run_id=?', change.id);
              sql.exec(POSITIONS_PENDING);
            }
          }
          if (change.entity === 'runs' && typeof data.products_json === 'string')
            this.replaceRunProducts(change.id, parseJson(data.products_json));
          if (
            change.entity === 'runs' &&
            change.revision > 0 &&
            Object.prototype.hasOwnProperty.call(data, 'answer') &&
            activeRevision &&
            activeTargetsJson
          ) {
            const activeRun = sql
              .exec<{ answer: string; sources_json: string | null; prompt_text: string | null }>(
                `SELECT answer,sources_json,prompt_text FROM runs WHERE id=? AND status='complete'
                 AND response_available=1 AND answer IS NOT NULL`,
                change.id,
              )
              .toArray()[0];
            if (activeRun) {
              sql.exec(
                `UPDATE run_rows SET analysis_revision=?,analysis_targets_json=?,
                 analysis_mentions_json=? WHERE id=?`,
                activeRevision,
                activeTargetsJson,
                this.overlayMentions(change.id, activeRun.answer, activeRun.sources_json, activeTargets, this.commonNames(activeRevision, activeTargets), 'active', activeRun.prompt_text),
                change.id,
              );
              activeOverlayChanged = true;
            }
          }
        } else {
          // A removed run takes its product cards with it (and the offers of the Products removed in Oct 2026).
          if (change.entity === 'runs') {
            sql.exec('DELETE FROM run_products WHERE run_id=?', change.id);
            sql.exec('DELETE FROM run_offers WHERE run_id=?', change.id);
            sql.exec('DELETE FROM run_offer_scans WHERE run_id=?', change.id);
          }
          if (change.entity === 'runs') sql.exec('DELETE FROM run_answers WHERE run_id=?', change.id);
          if (change.entity === 'runs') sql.exec('DELETE FROM mention_checks WHERE run_id=?', change.id);
          if (change.entity === 'runs') sql.exec('DELETE FROM mention_asks WHERE run_id=?', change.id);
          if (change.entity === 'runs' && sql.exec('DELETE FROM competitor_answer_names WHERE run_id=?', change.id).rowsWritten) sql.exec('DELETE FROM analysis_lowercase');
          sql.exec(`DELETE FROM ${change.entity === 'runs' ? 'run_rows' : change.entity} WHERE id=?`, change.id);
        }
        sql.exec(
          'INSERT INTO store_versions(entity,id,revision) VALUES(?,?,?) ON CONFLICT(entity,id) DO UPDATE SET revision=excluded.revision',
          change.entity,
          change.id,
          change.revision,
        );
        applied++;
      }
      if (activeOverlayChanged)
        this.setMeta(
          'analysis_mutation_revision',
          String(Number(this.meta('analysis_mutation_revision') || 0) + 1),
        );
    });
    if (restartAnalysis) {
      const job = sql
        .exec<AnalysisJob>('SELECT * FROM competitor_analysis_jobs WHERE id=1')
        .toArray()[0];
      if (job) {
        const cutoff = ['pending', 'running'].includes(job.status)
          ? job.cutoff
          : new Date(Date.now() - ANALYSIS_WINDOW_MS).toISOString();
        const eligible = Number(
          sql
            .exec<{ count: number }>(
              `SELECT COUNT(*) count FROM (
                 SELECT id FROM runs WHERE status='complete' AND response_available=1
                 AND answer IS NOT NULL AND created_at>=?
                 ORDER BY created_at DESC,id DESC LIMIT ?)`,
              cutoff,
              job.max_runs + 1,
            )
            .one().count,
        );
        const total = Math.min(eligible, job.max_runs);
        const stamp = new Date().toISOString();
        if (total && ['pending', 'running'].includes(job.status))
          sql.exec(
            `UPDATE competitor_analysis_jobs SET total_eligible=?,truncated=?,
             needs_rescan=1,updated_at=? WHERE id=1 AND revision=?`,
            total,
            eligible > job.max_runs ? 1 : 0,
            stamp,
            job.revision,
          );
        // New answers with an older detector's analysis too: an extension cannot mix detectors, so this is a full pass.
        else if (total) {
          this.ctx.storage.transactionSync(() => {
            sql.exec(
              `UPDATE run_rows SET analysis_pending_revision=NULL,
               analysis_pending_targets_json=NULL,analysis_pending_mentions_json=NULL
               WHERE analysis_pending_revision=?`,
              job.revision,
            );
            sql.exec("DELETE FROM mention_asks WHERE slot='pending'");
            this.clearStaging(job.revision);
            this.newPassTag(job.revision);
            // New answers over the same targets: an extension reads only them (and the ones the window let go of drop out).
            const extend = this.extendable(JSON.parse(job.targets_json) as DiscoverySeed[], this.meta('mention_model') !== '0');
            if (extend) this.setMeta('analysis_extend_base', this.meta('analysis_revision')!);
            sql.exec(
              `UPDATE competitor_analysis_jobs SET processed=0,scanned=0,phase=?,
               cutoff=?,total_eligible=?,truncated=?,cursor_created_at=NULL,cursor_id=NULL,
               status='pending',error=NULL,updated_at=?,seed_answers_json='[]',needs_rescan=0
               WHERE id=1 AND revision=?`,
              extend ? 'extend' : 'seeds',
              cutoff,
              total,
              eligible > job.max_runs ? 1 : 0,
              stamp,
              job.revision,
            );
          });
        } else
          this.ctx.storage.transactionSync(() => {
            this.clearActiveAnalysis();
            sql.exec(
              `UPDATE competitor_analysis_jobs SET cutoff=?,processed=0,scanned=0,
               phase='seeds',cursor_created_at=NULL,cursor_id=NULL,seed_answers_json='[]',
               total_eligible=0,truncated=0,status='complete',error=NULL,
               updated_at=?,needs_rescan=0 WHERE id=1 AND revision=?`,
              cutoff,
              stamp,
              job.revision,
            );
          });
        if (total) void this.ctx.storage.setAlarm(Date.now() + 100);
      }
    }
    return { applied };
  }
  /**
   * `run_positions` holds each complete answer's brand ranks (see runPositionEntries), read by reports instead of the answers.
   * One row per answer and reading (`basis`: the active analysis revision, a digest of the target list, with the mentions that
   * analysis found for the answer, or '' for the collection snapshot), so an analysis that restarts over the same targets, or is cleared and rebuilt, finds its rows again. A change to
   * the answer itself drops its rows and flags the table as pending; `positions-fill` rewrites what is missing. An absent flag
   * means pending too, so the first read after this migration backfills every answer.
   */
  private ensureRunPositions() {
    const sql = this.ctx.storage.sql;
    const definition = sql
      .exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='run_positions'")
      .toArray()[0]?.sql;
    // The first version keyed rows by answer alone, so a new reading replaced the old one: rebuild the table keeping its rows.
    if (definition?.includes('run_id TEXT PRIMARY KEY'))
      this.ctx.storage.transactionSync(() => {
        for (const name of ['insert', 'update', 'delete', 'revision_insert', 'revision_update', 'revision_delete'])
          sql.exec(`DROP TRIGGER IF EXISTS run_positions_${name}`);
        sql.exec('ALTER TABLE run_positions RENAME TO run_positions_single');
        sql.exec(RUN_POSITIONS_TABLE);
        sql.exec('INSERT INTO run_positions(run_id,basis,entries_json) SELECT run_id,basis,entries_json FROM run_positions_single');
        sql.exec('DROP TABLE run_positions_single');
      });
    else sql.exec(RUN_POSITIONS_TABLE);
    const pending = POSITIONS_PENDING;
    // Ranks saved before the basis carried the mentions (no ':' in it) cannot say which mentions they used: the next read ranks again.
    // Checked once per store (`positions_legacy`): no code writes such a basis any more, and the check reads the whole table
    // (no index on `basis`). Run on every request it read every rank row each time, the most rows a store read (11/11/2026).
    if (this.meta('positions_legacy') !== 'done') {
      const legacy = `FROM run_positions WHERE basis<>'${POSITIONS_BASIS_SUFFIX}' AND instr(basis,':')=0`;
      if (sql.exec(`SELECT 1 ${legacy} LIMIT 1`).toArray().length) {
        sql.exec(`DELETE ${legacy}`);
        sql.exec(pending);
      }
      // Only an initialized store: an empty store_meta is how `authorize` knows a store is new.
      if (this.meta('owner')) this.setMeta('positions_legacy', 'done');
    }
    // A new ranking version (POSITIONS_VERSION) changes every basis: the next reads rank the answers again. Only a store
    // already initialized: an empty store_meta is how `authorize` knows a store is new.
    if (this.meta('owner') && (this.meta('positions_version') ?? '1') !== String(POSITIONS_VERSION)) {
      sql.exec(pending);
      this.setMeta('positions_version', String(POSITIONS_VERSION));
    }
    const stale = `DELETE FROM run_positions WHERE run_id=NEW.id;`;
    sql.exec(`CREATE TRIGGER IF NOT EXISTS run_positions_insert AFTER INSERT ON run_rows BEGIN ${stale} ${pending} END`);
    sql.exec(
      `CREATE TRIGGER IF NOT EXISTS run_positions_update AFTER UPDATE OF status,response_available,targets_json,
        mentions_json ON run_rows BEGIN ${stale} ${pending} END`,
    );
    sql.exec(
      `CREATE TRIGGER IF NOT EXISTS run_positions_delete AFTER DELETE ON run_rows BEGIN
        DELETE FROM run_positions WHERE run_id=OLD.id; ${pending} END`,
    );
    // An overlay write only changes which basis the answer reads; the ranks under its other bases stay for a restart.
    sql.exec(
      `CREATE TRIGGER IF NOT EXISTS run_positions_overlay AFTER UPDATE OF analysis_revision,analysis_mentions_json ON run_rows BEGIN ${pending} END`,
    );
    // A new, cleared or restored overlay changes which basis an answer reads, not the ranks saved under the others.
    for (const [name, event, row] of [['insert', 'INSERT', 'NEW'], ['update', 'UPDATE', 'NEW'], ['delete', 'DELETE', 'OLD']])
      sql.exec(
        `CREATE TRIGGER IF NOT EXISTS run_positions_revision_${name} AFTER ${event} ON store_meta
         WHEN ${row}.key='analysis_revision' BEGIN ${pending} END`,
      );
  }

  /**
   * Saves the ranks of up to `limit` complete answers after `cursor` that have none under the current reading. The last page
   * (fewer than `limit`) checks the whole table again and only then clears the pending flag, in the same synchronous step.
   */
  private fillRunPositions(cursor: string, limit = 300) {
    const sql = this.ctx.storage.sql;
    const missing = `FROM runs r WHERE r.status='complete' AND r.response_available=1
      AND NOT EXISTS(SELECT 1 FROM run_positions p WHERE p.run_id=r.id AND p.basis=${EFFECTIVE_POSITIONS_BASIS_SQL})`;
    const rows = sql
      .exec<{ id: string; answer: string | null; targets_json: string; mentions_json: string; basis: string }>(
        `SELECT r.id,r.answer,${EFFECTIVE_TARGETS_SQL} targets_json,${EFFECTIVE_MENTIONS_SQL} mentions_json,
          ${EFFECTIVE_POSITIONS_BASIS_SQL} basis ${missing} AND r.id>? ORDER BY r.id LIMIT ?`,
        cursor,
        limit,
      )
      .toArray();
    for (const row of rows)
      sql.exec(
        'INSERT OR REPLACE INTO run_positions(run_id,basis,entries_json) VALUES(?,?,?)',
        row.id,
        row.basis,
        runPositionEntries(row.answer, String(row.targets_json), String(row.mentions_json)),
      );
    const filled = rows.length;
    if (filled === limit) return { cursor: rows[limit - 1].id, done: false, filled };
    if (sql.exec(`SELECT 1 ${missing} LIMIT 1`).toArray().length) return { cursor: '', done: false, filled };
    // Ranks read under a target list that is no longer the active one; kept while the overlay is cleared, for the rebuild.
    const active = this.meta('analysis_revision');
    if (active) {
      sql.exec(`DELETE FROM run_positions WHERE basis<>'${POSITIONS_BASIS_SUFFIX}' AND substr(basis,1,?)<>?`, active.length + 1, `${active}:`);
      // Same revision, other mentions (or an older ranking version): the analysis found something else for that answer since.
      sql.exec(
        `DELETE FROM run_positions WHERE basis<>'${POSITIONS_BASIS_SUFFIX}' AND EXISTS(SELECT 1 FROM runs r WHERE r.id=run_positions.run_id
          AND r.analysis_revision=? AND ${EFFECTIVE_POSITIONS_BASIS_SQL}<>run_positions.basis)`,
        active,
      );
    }
    this.setMeta('positions_pending', '0');
    return { cursor: '', done: true, filled };
  }

  /**
   * Data retention (lib/retention.ts): the text of the answers created before `before` is removed, `limit` at a time, oldest
   * first, from where the last call stopped (`retention_cursor`; `retention_before`: every answer before it holds no text).
   * Everything a report counts stays (the row, its brands, positions, citations and searches), so a period's numbers do not
   * change; only the answer's text is gone. Answers never move back in time once published, so the mark only advances.
   */
  private purgeAnswerText(before: unknown, limit: unknown, dryRun: boolean) {
    if (typeof before !== 'string' || before.length > 40 || !Number.isFinite(Date.parse(before))) throw new Error('Invalid retention date');
    const size = Math.min(500, Math.max(1, Math.trunc(Number(limit) || 200)));
    const sql = this.ctx.storage.sql;
    const project = this.meta('project') ?? '';
    const done = this.meta('retention_before') ?? '';
    const [at, id] = (this.meta('retention_cursor') ?? '').split('|');
    const from = done > (at ?? '') ? done : (at ?? '');
    const text = `(r.answer IS NOT NULL OR EXISTS(SELECT 1 FROM run_answers a WHERE a.run_id=r.id))`;
    if (dryRun)
      return {
        answers: Number(
          sql.exec<{ n: number }>(`SELECT COUNT(*) n FROM run_rows r WHERE r.project_id=? AND r.created_at>=? AND r.created_at<? AND ${text}`, project, done, before).one().n,
        ),
        before,
      };
    return this.ctx.storage.transactionSync(() => {
      const rows = sql
        .exec<{ id: string; created_at: string; held: number }>(
          `SELECT r.id,r.created_at,${text} held FROM run_rows r WHERE r.project_id=? AND r.created_at<?
           AND (r.created_at>? OR (r.created_at=? AND r.id>?)) ORDER BY r.created_at,r.id LIMIT ?`,
          project,
          before,
          from,
          from,
          from === at ? (id ?? '') : '',
          size,
        )
        .toArray();
      const purged = rows.filter((row) => Number(row.held)).map((row) => row.id);
      if (purged.length) {
        const ids = JSON.stringify(purged);
        sql.exec('DELETE FROM run_answers WHERE run_id IN (SELECT value FROM json_each(?))', ids);
        sql.exec('UPDATE run_rows SET answer=NULL WHERE answer IS NOT NULL AND id IN (SELECT value FROM json_each(?))', ids);
      }
      const last = rows.at(-1);
      if (rows.length < size) {
        this.setMeta('retention_before', before > done ? before : done);
        sql.exec("DELETE FROM store_meta WHERE key='retention_cursor'");
      } else this.setMeta('retention_cursor', `${last!.created_at}|${last!.id}`);
      return { answers: purged.length, more: rows.length === size, before };
    });
  }

  /**
   * Each report period boundary moved to the first answer at or after it (or past every answer). Every report compares
   * boundaries with `runs.created_at` only (>= and <), so the moved boundary selects exactly the same answers, and a
   * report asked a minute later reads with the same parameters while no answer crossed a boundary: its cached result stays exact.
   */
  private snapBounds(projectId: string, bounds: unknown) {
    if (!Array.isArray(bounds) || bounds.length > 4 || bounds.some((bound) => typeof bound !== 'string' || bound.length > 40))
      throw new Error('Invalid report bounds');
    return (bounds as string[]).map(
      (bound) =>
        this.ctx.storage.sql
          .exec<{ at: string | null }>('SELECT MIN(created_at) at FROM run_rows WHERE project_id=? AND created_at>=?', projectId, bound)
          .one().at ?? AFTER_EVERY_ANSWER,
    );
  }

  /** One page of an exported entity in id order: at most `limit` rows and about 4 MiB. */
  private scanPage(entity: StoreEntity, cursor: string, limit: number) {
    const rows: StoreRow[] = [];
    let bytes = 0,
      hasMore = false;
    for (const row of this.ctx.storage.sql.exec<StoreRow>(
      `SELECT ${storeColumns(entity).join(',')} FROM ${entity} WHERE id>? ORDER BY id LIMIT ?`,
      cursor,
      limit + 1,
    )) {
      const size = new TextEncoder().encode(JSON.stringify(row)).byteLength;
      if (rows.length && (rows.length === limit || bytes + size > 4 * 1024 * 1024)) {
        hasMore = true;
        break;
      }
      if (size > 4 * 1024 * 1024) throw new Error('A project record is too large');
      rows.push(row);
      bytes += size;
    }
    return { rows, nextCursor: hasMore ? (rows.at(-1)?.id as string) : null };
  }

  private backupJob(): BackupJob | undefined {
    const value = this.meta('backup_job');
    return value ? (JSON.parse(value) as BackupJob) : undefined;
  }

  private freshBackup(job: Pick<BackupJob, 'id' | 'status' | 'revision' | 'prefix' | 'attempts'>): BackupJob {
    return {
      ...job,
      signature: '',
      started: false,
      entity: 'prompts',
      cursor: '',
      digest: '',
      // Same key order as exportProjectStore's footer, so both files are byte for byte the same.
      digests: { runs: '', prompts: '', semantic_evaluations: '' },
      counts: { runs: 0, prompts: 0, semantic_evaluations: 0 },
      parts: 0,
      bytes: 0,
    };
  }

  /**
   * Writes the running backup for a few seconds: header, pages of each entity (with the same chained digests as the
   * export) and footer, flushed as parts of about 4 MiB. True while it still has work. A change to the data since the
   * pass started (another request runs while a part is uploaded) restarts it, over the same part keys.
   */
  private async backupStep() {
    let job = this.backupJob();
    if (job?.status !== 'running') return false;
    // Old rows still being rewritten by this alarm would change between pages: wait for those passes.
    if (this.meta('answers_split') === 'pending' || this.meta('sources_canonical') !== 'done') return true;
    const bucket = this.env.RAW_RESPONSES as R2Bucket | undefined;
    if (!bucket) throw new Error('Backup storage is unavailable');
    const signature = () => `${this.epoch()}:${Number(this.meta('analysis_mutation_revision') || 0)}`;
    if (!job.signature) job.signature = signature();
    const identity = {
      schema: 4 as const,
      projectId: String(this.meta('project')),
      ownerId: String(this.meta('owner')),
      generation: String(this.meta('generation')),
      revision: job.revision,
    };
    const analysis = { analysisRevision: this.meta('analysis_revision') ?? null, analysisMutationRevision: Number(this.meta('analysis_mutation_revision') || 0) };
    const encoder = new TextEncoder();
    let part: string[] = [],
      partBytes = 0;
    const write = (record: unknown) => {
      const line = JSON.stringify(record) + '\n';
      const size = encoder.encode(line).byteLength;
      part.push(line);
      partBytes += size;
      job!.bytes += size;
    };
    const flush = async () => {
      if (!part.length) return;
      await bucket.put(backupPartKey(job!.prefix, job!.parts), part.join(''), { httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' } });
      job!.parts++;
      part = [];
      partBytes = 0;
    };
    const deadline = Date.now() + BACKUP_SLICE_MS;
    let changed = false;
    if (!job.started) {
      write({ type: 'manifest', manifest: { ...identity, ...analysis } });
      job.started = true;
    }
    while (!job.manifest && Date.now() < deadline) {
      const page = this.scanPage(job.entity, job.cursor, 100);
      job.digest = await extendStoreDigest(job.digest, job.entity, page.rows, 4);
      if (signature() !== job.signature) {
        changed = true;
        break;
      }
      job.counts[job.entity] += page.rows.length;
      write({ type: 'chunk', entity: job.entity, rows: page.rows });
      if (page.nextCursor) job.cursor = page.nextCursor;
      else {
        job.digests[job.entity] = job.digest;
        const next = BACKUP_ENTITIES[BACKUP_ENTITIES.indexOf(job.entity) + 1];
        if (next) Object.assign(job, { entity: next, cursor: '', digest: '' });
        else {
          // The project's agent conversations, snapshotted by the request that started the backup, go before the footer.
          const agent = await bucket.get(agentBackupKey(job.prefix));
          const lines = agent ? await agent.text() : '';
          if (lines) {
            const bytes = encoder.encode(lines).byteLength;
            part.push(lines);
            partBytes += bytes;
            job.bytes += bytes;
          }
          job.manifest = { ...identity, digests: job.digests, counts: job.counts, ...analysis };
          write({ type: 'footer', manifest: job.manifest });
        }
      }
      if (partBytes >= BACKUP_PART_BYTES) await flush();
      if (signature() !== job.signature) {
        changed = true;
        break;
      }
    }
    if (!changed) await flush();
    if (changed || signature() !== job.signature) {
      if (job.attempts + 1 >= BACKUP_ATTEMPTS) throw new Error('The project kept changing during the backup');
      job = this.freshBackup({ ...job, attempts: job.attempts + 1 });
    } else if (job.manifest) job.status = 'ready';
    this.setMeta('backup_job', JSON.stringify(job));
    return job.status === 'running';
  }

  private status() {
    return {
      schema: 1,
      analysisRevision: this.meta('analysis_revision') ?? null,
      analysisMutationRevision: Number(this.meta('analysis_mutation_revision') || 0),
      positionsPending: this.meta('positions_pending') !== '0',
      // Older rows are still being rewritten to canonical source URLs (an alarm, outside any revision).
      sourcesCanonical: this.meta('sources_canonical') === 'done',
    };
  }

  private runQueries(statements: StoreQuery[]) {
    if (!Array.isArray(statements) || statements.length > 10)
      throw new Error('Invalid query batch');
    const sql = this.ctx.storage.sql;
    const encoder = new TextEncoder();
    let queryBytes = 0;
    return this.ctx.storage.transactionSync(() =>
      statements.map((statement) => {
        const readSql = statement.sql?.trim().replace(/;$/, '');
        const syntax = readSql?.replace(/'(?:''|[^'])*'/g, "''");
        if (
          !readSql ||
          readSql.length > 50000 ||
          !/^(SELECT|WITH)\b/i.test(readSql) ||
          /;|--|\/\*|\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|REPLACE|TRIGGER)\b/i.test(
            syntax,
          ) ||
          !Array.isArray(statement.params) ||
          statement.params.length > 100
        )
          throw new Error('Only bounded read queries are allowed');
        const cursor = sql.exec<StoreRow>(readSql, ...statement.params);
        const rows: StoreRow[] = [];
        for (const row of cursor) {
          queryBytes += encoder.encode(JSON.stringify(row)).byteLength;
          if (rows.length >= 10000 || queryBytes > 4 * 1024 * 1024)
            throw new Error('Query result is too large');
          rows.push(row);
        }
        return {
          results: rows,
          meta: {
            rows_read: cursor.rowsRead,
            rows_written: cursor.rowsWritten,
          },
        };
      }),
    );
  }

  /**
   * AI bots (lib/ai-bots.ts): what the collector read from the customer's own zone analytics, one row per day, bot, path and
   * status (summed requests and bytes), the day's totals (`requests`, every request to the zone; `complete`, the whole UTC day
   * was read), the visits AI answers sent (`bot_referrals`, and from 13/11/2026 the pages they landed on, `referral_pages`) and the
   * site's pages seen (`site_paths`, the first and last day).
   * Outside the report epoch (UNCACHED_TABLES): reads of these tables are never kept.
   * ponytail: not in backups (BACKUP_ENTITIES), so a restore starts the bot history again from the 31 days Cloudflare keeps;
   * add them as backup entities when a customer needs older history across a restore.
   */
  private ensureBotTables() {
    const sql = this.ctx.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS bot_hits (day TEXT NOT NULL,bot TEXT NOT NULL,path TEXT NOT NULL,status INTEGER NOT NULL,hits INTEGER NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(day,bot,path,status)) WITHOUT ROWID',
    );
    sql.exec('CREATE TABLE IF NOT EXISTS bot_days (day TEXT PRIMARY KEY,requests INTEGER NOT NULL,complete INTEGER NOT NULL,referrals INTEGER,synced_at TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS bot_referrals (day TEXT NOT NULL,host TEXT NOT NULL,visits INTEGER NOT NULL,PRIMARY KEY(day,host)) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS site_paths (path TEXT PRIMARY KEY,first_day TEXT NOT NULL,last_day TEXT NOT NULL) WITHOUT ROWID');
    sql.exec('CREATE TABLE IF NOT EXISTS referral_pages (day TEXT NOT NULL,host TEXT NOT NULL,path TEXT NOT NULL,visits INTEGER NOT NULL,PRIMARY KEY(day,host,path)) WITHOUT ROWID');
  }

  /** Each day replaces what was kept for it, in one transaction (a day read again later, now complete, takes its place). */
  private putBotDays(days: BotDay[], syncedAt: string) {
    const valid =
      Array.isArray(days) &&
      days.length <= 40 &&
      typeof syncedAt === 'string' &&
      days.every(
        (day) =>
          /^\d{4}-\d{2}-\d{2}$/.test(day?.day) &&
          Array.isArray(day.hits) &&
          day.hits.length <= 20000 &&
          Array.isArray(day.paths) &&
          day.paths.length <= 20000 &&
          (day.landings == null || (Array.isArray(day.landings) && day.landings.length <= 20000)),
      );
    if (!valid) throw new Error('Invalid AI bots days');
    const sql = this.ctx.storage.sql;
    let rows = 0;
    this.ctx.storage.transactionSync(() => {
      for (const day of days) {
        sql.exec('DELETE FROM bot_hits WHERE day=?', day.day);
        sql.exec('DELETE FROM bot_referrals WHERE day=?', day.day);
        sql.exec('DELETE FROM referral_pages WHERE day=?', day.day);
        for (const [bot, path, status, hits, bytes] of day.hits) {
          sql.exec('INSERT OR REPLACE INTO bot_hits(day,bot,path,status,hits,bytes) VALUES(?,?,?,?,?,?)', day.day, String(bot).slice(0, 64), String(path).slice(0, 512), Number(status) || 0, Number(hits) || 0, Number(bytes) || 0);
          rows++;
        }
        for (const [host, visits] of day.referrals ?? [])
          sql.exec('INSERT OR REPLACE INTO bot_referrals(day,host,visits) VALUES(?,?,?)', day.day, String(host).slice(0, 255), Number(visits) || 0);
        for (const [host, path, visits] of day.landings ?? [])
          sql.exec('INSERT OR REPLACE INTO referral_pages(day,host,path,visits) VALUES(?,?,?,?)', day.day, String(host).slice(0, 255), String(path).slice(0, 512), Number(visits) || 0);
        for (const path of day.paths)
          sql.exec(
            'INSERT INTO site_paths(path,first_day,last_day) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET first_day=min(first_day,excluded.first_day),last_day=max(last_day,excluded.last_day)',
            String(path).slice(0, 512),
            day.day,
            day.day,
          );
        const referrals = day.referrals ? day.referrals.reduce((sum, [, visits]) => sum + (Number(visits) || 0), 0) : null;
        sql.exec(
          'INSERT OR REPLACE INTO bot_days(day,requests,complete,referrals,synced_at) VALUES(?,?,?,?,?)',
          day.day,
          Number(day.requests) || 0,
          day.complete ? 1 : 0,
          referrals,
          syncedAt,
        );
      }
    });
    return { days: days.length, rows };
  }

  private ensureRunProductsTable() {
    const sql = this.ctx.storage.sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS run_products (
        run_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        engine TEXT NOT NULL,
        title TEXT NOT NULL,
        title_key TEXT NOT NULL,
        gpcid TEXT,
        match_key TEXT NOT NULL,
        price_text TEXT,
        price_value REAL,
        currency TEXT,
        rating_value REAL,
        rating_votes INTEGER,
        merchants_json TEXT NOT NULL DEFAULT '[]',
        domain TEXT,
        url TEXT,
        tag TEXT,
        image_url TEXT,
        PRIMARY KEY(run_id, position))`,
    );
    // The card's picture (PRODUCTS_SCAN v2): stores made before it gain the column, filled by their next scan.
    if (!sql.exec<{ name: string }>('PRAGMA table_info(run_products)').toArray().some((column) => column.name === 'image_url'))
      sql.exec('ALTER TABLE run_products ADD COLUMN image_url TEXT');
    sql.exec('CREATE INDEX IF NOT EXISTS run_products_match ON run_products(match_key)');
    sql.exec('CREATE INDEX IF NOT EXISTS run_products_run ON run_products(run_id)');
  }

  /**
   * The product cards of one answer (lib/products.ts extractProducts), replacing what it had: from its publication, or
   * read from its archived response (scanProductsPage). Inside the caller's transaction.
   */
  private replaceRunProducts(runId: string, cards: unknown) {
    const sql = this.ctx.storage.sql;
    const engine = sql.exec<{ engine: string }>('SELECT engine FROM run_rows WHERE id=?', runId).toArray()[0]?.engine;
    sql.exec('DELETE FROM run_products WHERE run_id=?', runId);
    if (!engine) return;
    // The extraction's text (entities decoded), so a card published or imported before it reads the same.
    const text = cardText;
    const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    // A card without a title is not one: skipped, never a reason to refuse the answer's publication.
    const valid = (Array.isArray(cards) ? cards : []).filter((card) => text(card?.title, 300)).slice(0, 50);
    for (const [index, card] of valid.entries()) {
      const title = text(card.title, 300)!;
      const key = productKey(title);
      sql.exec(
        `INSERT INTO run_products(run_id,position,engine,title,title_key,match_key,price_text,price_value,currency,rating_value,rating_votes,merchants_json,url,tag,image_url)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        runId, index + 1, engine, title, key, key, text(card.priceText, 60), number(card.price), text(card.currency, 8),
        number(card.rating), number(card.votes), JSON.stringify(text(card.store, 120) ? [text(card.store, 120)] : []),
        text(card.url, 2000), text(card.label, 120), httpsUrl(card.image),
      );
    }
  }

  /**
   * Reads the cards of answers stored before Products (or before PRODUCTS_SCAN changed) from their archived responses, one
   * page per alarm in id order, and records where it stopped. Answers published since carry their own cards; reading one
   * again writes the same. True while answers remain.
   */
  private async scanProductsPage(size = 40) {
    if (!this.meta('owner') || this.meta('products_scan') === PRODUCTS_SCAN) return false;
    const sql = this.ctx.storage.sql;
    const bucket = this.env.RAW_RESPONSES as R2Bucket | undefined;
    const rows = bucket
      ? sql.exec<{ id: string; engine: string; raw_response_key: string }>(
          `SELECT id,engine,raw_response_key FROM run_rows WHERE id>? AND engine IN (${PRODUCT_ENGINES.map(() => '?').join(',')})
           AND status='complete' AND raw_response_key IS NOT NULL ORDER BY id LIMIT ?`,
          this.meta('products_scan_cursor') ?? '',
          ...PRODUCT_ENGINES,
          size,
        ).toArray()
      : [];
    // A response missing from the archive (an imported or restored project) keeps the cards it was published with.
    const read = await Promise.all(
      rows.map(async (row) => {
        const object = await bucket!.get(row.raw_response_key);
        return object ? { id: row.id, cards: extractProducts(rawProviderResult(await object.text()), row.engine) } : null;
      }),
    );
    this.ctx.storage.transactionSync(() => {
      let changed = false;
      for (const { id, cards } of read.filter((item) => item !== null)) {
        const before = sql.exec<{ n: number }>('SELECT COUNT(*) n FROM run_products WHERE run_id=?', id).toArray()[0].n;
        // Removed while its response was read: nothing to keep.
        if (!sql.exec('SELECT 1 FROM run_rows WHERE id=?', id).toArray().length) continue;
        this.replaceRunProducts(id, cards);
        changed ||= before > 0 || cards.length > 0;
      }
      if (rows.length < size) {
        // Cards kept without an archived response (imported or restored) get the extraction's text too: entities decoded.
        for (const card of sql.exec<{ run_id: string; position: number; title: string; price_text: string | null; merchants_json: string; tag: string | null }>(
          "SELECT run_id,position,title,price_text,merchants_json,tag FROM run_products WHERE title LIKE '%&%;%' OR price_text LIKE '%&%;%' OR merchants_json LIKE '%&%;%' OR tag LIKE '%&%;%'",
        ).toArray()) {
          const title = cardText(card.title, 300) ?? card.title;
          const stores = (JSON.parse(card.merchants_json || '[]') as unknown[]).map((store) => cardText(store, 120)).filter(Boolean);
          sql.exec(
            'UPDATE run_products SET title=?,title_key=?,match_key=?,price_text=?,merchants_json=?,tag=? WHERE run_id=? AND position=?',
            title, productKey(title), productKey(title), cardText(card.price_text, 60), JSON.stringify(stores), cardText(card.tag, 120), card.run_id, card.position,
          );
          changed = true;
        }
        this.setMeta('products_scan', PRODUCTS_SCAN);
        sql.exec("DELETE FROM store_meta WHERE key='products_scan_cursor'");
      } else this.setMeta('products_scan_cursor', rows[rows.length - 1].id);
      // The cards are not a run column: a kept report of the old cards must not be served again.
      if (changed) sql.exec(EPOCH_BUMP);
    });
    return rows.length === size;
  }

  private ensureRunOffersTable() {
    const sql = this.ctx.storage.sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS run_offers (
        run_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        offer_key TEXT NOT NULL,
        offer_name TEXT NOT NULL,
        brand TEXT,
        stance TEXT NOT NULL,
        price_text TEXT,
        excerpt TEXT,
        catalog_key TEXT NOT NULL,
        PRIMARY KEY(run_id, position))`,
    );
    sql.exec('CREATE INDEX IF NOT EXISTS run_offers_offer ON run_offers(offer_key)');
    sql.exec('CREATE INDEX IF NOT EXISTS run_offers_run ON run_offers(run_id)');
    sql.exec(
      `CREATE TABLE IF NOT EXISTS run_offer_scans (
        run_id TEXT PRIMARY KEY,
        catalog_key TEXT NOT NULL,
        mentions INTEGER NOT NULL,
        scanned_at TEXT NOT NULL)`,
    );
  }

  async fetch(request: Request) {
    try {
      if (request.method !== 'POST')
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 8 * 1024 * 1024)
        throw new Error('Storage request is too large');
      const message = JSON.parse(raw) as StoreMessage;
      this.lastRequest = Date.now();
      if ((message.action === 'apply' && Array.isArray(message.changes) && message.changes.length) || message.action === 'analysis-adopt') this.lastWrite = Date.now();
      if ((message as { action: string }).action === 'restore-drive') return await this.drive((message as unknown as { id: unknown }).id);
      if (message.action === 'rekey') return Response.json(this.rekey(message.scope, message.from), { headers: { 'Cache-Control': 'private, no-store' } });
      if (message.action === 'erase') return Response.json(await this.erase(message.scope), { headers: { 'Cache-Control': 'private, no-store' } });
      this.authorize(message.scope, message.action === 'initialize');
      const sql = this.ctx.storage.sql;
      // Once per instance after the store is authorized (the constructor ran them before a new store had its owner): keep the
      // old products/offers tables available for the run deletes in apply, the ranks table current and the bot tables there.
      // Each reads the schema.
      if (!this.ensured) {
        this.ensureRunProductsTable();
        this.ensureRunOffersTable();
        this.ensureRunPositions();
        this.ensureBotTables();
        this.ensured = true;
      }
      const epoch = this.epoch();
      let result: unknown;
      if (message.action === 'initialize') result = { initialized: true };
      else if (message.action === 'apply')
        result = this.apply(message.scope, message.changes);
      else if (message.action === 'status') {
        // A bounded part of the pending ranks is saved in this same turn; the caller finishes the rest with `positions-fill`.
        for (let page = 0, cursor = ''; message.fill && page < STATUS_FILL_PAGES && this.meta('positions_pending') !== '0'; page++)
          cursor = this.ctx.storage.transactionSync(() => this.fillRunPositions(cursor)).cursor;
        const bounds = message.bounds ? this.snapBounds(message.scope.projectId, message.bounds) : null;
        result = {
          ...this.status(),
          epoch: this.epoch(),
          // The data changed less than WARM_QUIET_MS ago: the first screens' warm-up waits for it to settle (first-screen-warm.ts).
          settling: Date.now() < Number(this.meta('warm_after') || 0),
          ...(bounds ? { bounds } : {}),
          ...(message.copy ? { copy: this.responseCopy(message.copy, bounds) } : {}),
          ...(message.job ? { job: this.analysisJobState() } : {}),
        };
      }
      else if (message.action === 'copy-get')
        result = this.responseCopy(message.copy, message.bounds ? this.snapBounds(message.scope.projectId, message.bounds) : null);
      else if (message.action === 'copy-put')
        result = this.keepCopy(message.key, message.epoch, message.value, message.last === true);
      else if (message.action === 'retention-purge')
        result = this.purgeAnswerText(message.before, message.limit, message.dryRun === true);
      else if (message.action === 'positions-fill')
        result = this.ctx.storage.transactionSync(() =>
          this.fillRunPositions(typeof message.cursor === 'string' ? message.cursor : ''),
        );
      else if (message.action === 'analysis-start')
        result = this.startAnalysis(message);
      else if (message.action === 'analysis-status')
        result = this.analysisStatus(message);
      else if (message.action === 'mention-verdicts')
        result = this.setMentionVerdicts(message.verdicts);
      else if (message.action === 'brand-counted')
        result = this.setCountedBrands(message.groups, message.aliases);
      else if (message.action === 'analysis-adopt')
        result = this.adoptAnalysis(message);
      else if (message.action === 'analysis-process')
        result = this.processAnalysisPage();
      else if (message.action === 'analysis-freeze') {
        if (
          !message.token ||
          message.token.length > 200 ||
          !Number.isSafeInteger(message.until) ||
          message.until <= Date.now() ||
          message.until > Date.now() + 60000
        )
          throw new Error('Invalid competitor analysis freeze');
        this.setMeta('analysis_freeze_token', message.token);
        this.setMeta('analysis_frozen_until', String(message.until));
        await this.ctx.storage.setAlarm(message.until);
        result = {
          revision: this.meta('analysis_revision') ?? null,
          mutationRevision: Number(
            this.meta('analysis_mutation_revision') || 0,
          ),
          frozen: true,
        };
      } else if (message.action === 'analysis-resume') {
        if (this.meta('analysis_freeze_token') !== message.token)
          throw new Error('Competitor analysis freeze token mismatch');
        this.setMeta('analysis_frozen_until', '0');
        this.setMeta('analysis_freeze_token', '');
        const job = sql
          .exec<AnalysisJob>(
            'SELECT * FROM competitor_analysis_jobs WHERE id=1',
          )
          .toArray()[0];
        if (job && job.status !== 'complete') {
          sql.exec(
            "UPDATE competitor_analysis_jobs SET status='pending',error=NULL,updated_at=? WHERE id=1",
            new Date().toISOString(),
          );
          void this.ctx.storage.setAlarm(Date.now() + 100);
        }
        result = this.analysisStatus();
      } else if (message.action === 'analysis-cancel') {
        if (!message.revision || message.revision.length > 200)
          throw new Error('Invalid competitor analysis revision');
        const job = sql
          .exec<{ revision: string }>(
            'SELECT revision FROM competitor_analysis_jobs WHERE id=1',
          )
          .toArray()[0];
        const cancelled = job?.revision === message.revision;
        if (cancelled) {
          this.clearStaging(message.revision);
          this.newPassTag(message.revision);
          sql.exec(
            'DELETE FROM competitor_analysis_jobs WHERE id=1 AND revision=?',
            message.revision,
          );
          await this.ctx.storage.deleteAlarm();
        }
        result = { cancelled };
      } else if (message.action === 'analysis-set-current') {
        if (!message.revision || message.revision.length > 200)
          throw new Error('Invalid competitor analysis revision');
        this.setMeta('analysis_revision', message.revision);
        const restoredTargets = sql
          .exec<{ analysis_targets_json: string }>(
            `SELECT analysis_targets_json FROM runs
             WHERE analysis_revision=? AND analysis_targets_json IS NOT NULL LIMIT 1`,
            message.revision,
          )
          .toArray()[0]?.analysis_targets_json;
        if (restoredTargets)
          this.setMeta('analysis_targets_json', restoredTargets);
        this.setMeta(
          'analysis_mutation_revision',
          String(Number(this.meta('analysis_mutation_revision') || 0) + 1),
        );
        result = { ok: true };
      } else if (message.action === 'scan') {
        if (!['runs', 'prompts', 'semantic_evaluations'].includes(message.entity))
          throw new Error('Invalid entity');
        result = this.scanPage(message.entity, message.cursor || '', Math.max(1, Math.min(100, Number(message.limit) || 100)));
      } else if (message.action === 'backup-start') {
        if (typeof message.id !== 'string' || !/^[a-f0-9-]{36}$/.test(message.id) || !Number.isSafeInteger(message.revision) || message.revision < 0)
          throw new Error('Invalid backup');
        const job = this.backupJob();
        if (job?.status === 'running' && job.id !== message.id) throw new Error('A backup is already running');
        if (job?.id !== message.id) {
          this.setMeta('backup_job', JSON.stringify(this.freshBackup({
            id: message.id,
            status: 'running',
            revision: message.revision,
            prefix: backupPrefix(message.scope.ownerId, message.scope.projectId, message.id),
            attempts: 0,
          })));
          await this.alarmBy(Date.now() + 50);
        }
        result = { status: 'running' };
      } else if (message.action === 'backup-status') {
        const job = this.backupJob();
        result = job && job.id === message.id
          ? { status: job.status, parts: job.parts, bytes: job.bytes, manifest: job.manifest ?? null, error: job.error ?? null }
          : { status: 'unknown' };
      } else if (message.action === 'bots-put') {
        result = this.putBotDays(message.days, message.syncedAt);
      } else if (message.action === 'bots-clear') {
        const sql = this.ctx.storage.sql;
        this.ctx.storage.transactionSync(() => {
          for (const table of ['bot_hits', 'bot_days', 'bot_referrals', 'referral_pages', 'site_paths']) sql.exec(`DELETE FROM ${table}`);
        });
        result = { cleared: true };
      } else if (message.action === 'query') {
        result = message.report ? await this.reportQueries(message.statements, message.report) : this.runQueries(message.statements);
      } else if (message.action === 'warm') {
        // Recomputes the remembered first-screen reads now (operators and tests; the alarm does it after each change).
        let warmed = 0;
        while (warmed < 16 && (await this.warmStep(true))) warmed++;
        result = { warmed, pending: warmed === 16 };
      } else throw new Error('Unknown storage operation');
      await this.changed(epoch);
      const body = JSON.stringify(result);
      if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024)
        throw new Error('Storage response is too large');
      return new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : 'Storage operation failed',
        },
        { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
  }
}
