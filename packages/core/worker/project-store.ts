import { DurableObject } from 'cloudflare:workers';
import { competitorIdentity } from '../lib/competitor-identity';
import {
  RUN_STORE_COLUMNS,
  PROMPT_STORE_COLUMNS,
  storeColumns,
  canonicalStoreRow,
  validStoreScope,
  type StoreMessage,
  type StoreRow,
  type StoreValue,
  type StoreScope,
  type StoreChange,
} from '../lib/project-store-contract';
import { matchesBrand } from '../lib/metrics';
import {
  discoverCompetitors,
  type CompetitorCandidate,
  type DiscoveryAnswer,
  type DiscoverySeed,
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
  phase: 'seeds' | 'analysis';
  needs_rescan: number;
};

// A Durable Object gets 128 MB and one thread, and discovery holds the whole
// page plus its derived representations in memory while running synchronously.
// The peak tracks the bytes on the page, so the byte budget is what keeps it
// inside half the memory; the answer budget bounds the per-answer fixed cost,
// which is what the object blocks the thread for.
const ANALYSIS_PAGE_SIZE = 10;
const ANALYSIS_PAGE_BYTES = 256 * 1024;
const MAX_EVIDENCE = 3;
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

// A stored seed is a windowed copy of an answer, so its offsets only line up
// with the window. The page being analysed already carries every one of its own
// answers in full, and the extractor derives their seed contexts locally; a
// windowed copy of the same answer adds nothing and makes the extractor mask a
// range that the window does not contain. Reference only answers from outside
// the page.
function referencesOutsidePage(
  seedAnswers: readonly DiscoveryAnswer[],
  pageAnswers: readonly DiscoveryAnswer[],
): DiscoveryAnswer[] {
  const pageIds = new Set(pageAnswers.map((answer) => answer.id));
  return seedAnswers.filter((seed) => !pageIds.has(seed.id));
}

export class ProjectStore extends DurableObject<Record<string, unknown>> {
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(
      'CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)',
    );
    sql.exec(
      'CREATE TABLE IF NOT EXISTS store_versions (entity TEXT,id TEXT,revision INTEGER NOT NULL,PRIMARY KEY(entity,id))',
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS runs (${RUN_STORE_COLUMNS.map((c) => `${c} ${RUN_NUMBERS.has(c) ? 'NUMERIC' : 'TEXT'}${c === 'id' ? ' PRIMARY KEY' : ''}${defaults[c] ? ` DEFAULT ${defaults[c]}` : ''}`).join(',')})`,
    );
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
    sql.exec(
      'CREATE INDEX IF NOT EXISTS runs_project_date ON runs(project_id,created_at,id)',
    );
    sql.exec(
      'CREATE INDEX IF NOT EXISTS runs_prompt_date ON runs(prompt_id,created_at,id)',
    );
    sql.exec(
      'CREATE INDEX IF NOT EXISTS runs_status_date ON runs(status,created_at,id)',
    );
    sql.exec(
      'CREATE INDEX IF NOT EXISTS prompts_topic ON prompts(project_id,tag)',
    );
    const runColumns = new Set(
      sql
        .exec<{ name: string }>('PRAGMA table_info(runs)')
        .toArray()
        .map((column) => column.name),
    );
    for (const column of [
      'analysis_revision',
      'analysis_targets_json',
      'analysis_mentions_json',
      'analysis_pending_revision',
      'analysis_pending_targets_json',
      'analysis_pending_mentions_json',
    ])
      if (!runColumns.has(column))
        sql.exec(`ALTER TABLE runs ADD COLUMN ${column} TEXT`);
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
        PRIMARY KEY(revision,name),UNIQUE(revision,identity))`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS competitor_suggestions_staging (
        revision TEXT NOT NULL,name TEXT NOT NULL,identity TEXT NOT NULL,
        domain TEXT,domain_state TEXT NOT NULL,score REAL NOT NULL,
        answer_count INTEGER NOT NULL,evidence_json TEXT NOT NULL,
        PRIMARY KEY(revision,name),UNIQUE(revision,identity))`,
    );
    this.ensureSuggestionIdentity('competitor_suggestions');
    this.ensureSuggestionIdentity('competitor_suggestions_staging');
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

  private frozenUntil() {
    const until = Number(this.meta('analysis_frozen_until') || 0);
    if (until > Date.now()) return until;
    if (until) {
      this.setMeta('analysis_frozen_until', '0');
      this.setMeta('analysis_freeze_token', '');
    }
    return 0;
  }

  private analysisStatus() {
    const sql = this.ctx.storage.sql;
    const job = sql
      .exec<AnalysisJob>('SELECT * FROM competitor_analysis_jobs WHERE id=1')
      .toArray()[0];
    const suggestions = job
      ? sql
          .exec<{
            name: string;
            domain: string | null;
            score: number;
            answer_count: number;
            evidence_json: string;
          }>(
            `SELECT name,domain,score,answer_count,evidence_json
             FROM competitor_suggestions WHERE revision=?
             ORDER BY score DESC,answer_count DESC,name LIMIT 20`,
            job.revision,
          )
          .toArray()
          .map((row) => ({
            name: row.name,
            domain: row.domain,
            score: Number(row.score),
            answerCount: Number(row.answer_count),
            evidence: JSON.parse(row.evidence_json),
          }))
      : [];
    return {
      revision: job?.revision ?? this.meta('analysis_revision') ?? null,
      configVersion: Number(job?.config_version ?? 0),
      status: job?.status ?? 'idle',
      processed: Number(job?.processed ?? 0),
      scanned: Number(job?.scanned ?? 0),
      phase: job?.phase ?? 'seeds',
      total: Number(job?.total_eligible ?? 0),
      truncated: Boolean(job?.truncated),
      cutoff: job?.cutoff ?? null,
      maxRuns: Number(job?.max_runs ?? 10000),
      error: job?.error ?? null,
      updatedAt: job?.updated_at ?? null,
      suggestions,
      mutationRevision: Number(this.meta('analysis_mutation_revision') || 0),
      frozen: Number(this.meta('analysis_frozen_until') || 0) > Date.now(),
    };
  }

  private clearActiveAnalysis() {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM competitor_suggestions');
    sql.exec('DELETE FROM competitor_suggestions_staging');
    sql.exec(`UPDATE runs SET analysis_revision=NULL,analysis_targets_json=NULL,
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
      message.targets.length > 6 ||
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
    if (current && current.config_version > message.configVersion)
      return this.analysisStatus();
    if (current?.revision === message.revision && !message.restart) {
      if (
        this.meta('analysis_revision') === current.revision &&
        !this.meta('analysis_targets_json')
      )
        this.setMeta('analysis_targets_json', current.targets_json);
      if (current.config_version < message.configVersion)
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
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        `INSERT INTO competitor_analysis_jobs(
          id,revision,config_version,targets_json,cutoff,max_runs,processed,scanned,phase,total_eligible,truncated,
          cursor_created_at,cursor_id,status,error,updated_at,seed_answers_json,needs_rescan)
         VALUES(1,?,?,?,?,?,0,0,'seeds',?,?,NULL,NULL,?,NULL,?,'[]',0)
         ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,
          config_version=excluded.config_version,targets_json=excluded.targets_json,cutoff=excluded.cutoff,
          max_runs=excluded.max_runs,processed=0,scanned=0,phase='seeds',
          total_eligible=excluded.total_eligible,
          truncated=excluded.truncated,
          cursor_created_at=NULL,cursor_id=NULL,status=excluded.status,error=NULL,
          updated_at=excluded.updated_at,seed_answers_json='[]',needs_rescan=0`,
        message.revision,
        message.configVersion,
        JSON.stringify(targets),
        message.cutoff,
        message.maxRuns,
        total,
        eligible > message.maxRuns ? 1 : 0,
        total ? 'pending' : 'complete',
        stamp,
      );
      sql.exec('DELETE FROM competitor_suggestions_staging');
      sql.exec(
        `UPDATE runs SET analysis_pending_revision=NULL,
         analysis_pending_targets_json=NULL,analysis_pending_mentions_json=NULL
         WHERE analysis_pending_revision IS NOT NULL`,
      );
      if (!total) this.clearActiveAnalysis();
    });
    if (total) void this.ctx.storage.setAlarm(Date.now() + 100);
    return this.analysisStatus();
  }

  private mergeSuggestions(
    revision: string,
    candidates: CompetitorCandidate[],
  ) {
    const sql = this.ctx.storage.sql;
    for (const candidate of candidates.slice(0, 20)) {
      const identity = competitorIdentity(candidate.name);
      const existing = sql
        .exec<{
          name: string;
          score: number;
          answer_count: number;
          evidence_json: string;
          domain: string | null;
          domain_state: DomainEvidenceState;
        }>(
          `SELECT name,score,answer_count,evidence_json,domain,domain_state
           FROM competitor_suggestions_staging WHERE revision=? AND identity=?`,
          revision,
          identity,
        )
        .toArray()[0];
      const evidence = [
        ...(existing ? JSON.parse(existing.evidence_json) : []),
        ...candidate.evidence,
      ]
        .filter(
          (item, index, all) =>
            all.findIndex((other) => other.runId === item.runId) === index,
        )
        .slice(0, MAX_EVIDENCE);
      const domain = mergeDomainEvidence(
        existing
          ? { domain: existing.domain, state: existing.domain_state }
          : null,
        { domain: candidate.domain, state: candidate.domainEvidence },
      );
      sql.exec(
        `INSERT INTO competitor_suggestions_staging(
           revision,name,identity,domain,domain_state,score,answer_count,evidence_json)
         VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(revision,identity) DO UPDATE SET
         domain=excluded.domain,
         domain_state=excluded.domain_state,
         score=MAX(excluded.score,competitor_suggestions_staging.score),
         answer_count=competitor_suggestions_staging.answer_count+excluded.answer_count,
         evidence_json=excluded.evidence_json`,
        revision,
        existing?.name ?? candidate.name.normalize('NFC'),
        identity,
        domain.domain,
        domain.state,
        Math.max(Number(existing?.score || 0), candidate.score),
        candidate.answerCount,
        JSON.stringify(evidence),
      );
    }
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
    const cursor = job.cursor_created_at
      ? ' AND (created_at<? OR (created_at=? AND id<?))'
      : '';
    const params: Array<string | number> = [job.cutoff];
    if (job.cursor_created_at)
      params.push(
        job.cursor_created_at,
        job.cursor_created_at,
        job.cursor_id || '',
      );
    const phaseProgress = job.phase === 'seeds' ? job.scanned : job.processed;
    const requestedLimit = Math.min(
      ANALYSIS_PAGE_SIZE,
      job.max_runs - phaseProgress,
    );
    params.push(requestedLimit);
    const fetched = sql
      .exec<{
        id: string;
        answer: string;
        sources_json: string;
        created_at: string;
      }>(
        `SELECT id,answer,sources_json,created_at FROM runs
         WHERE status='complete' AND response_available=1 AND answer IS NOT NULL
         AND created_at>=?${cursor} ORDER BY created_at DESC,id DESC LIMIT ?`,
        ...params,
      )
      .toArray();
    const targets = JSON.parse(job.targets_json) as DiscoverySeed[];
    const encoder = new TextEncoder();
    const rows: typeof fetched = [];
    let pageBytes = 0;
    for (const row of fetched) {
      const bytes = encoder.encode(row.answer).byteLength;
      if (rows.length && pageBytes + bytes > ANALYSIS_PAGE_BYTES) break;
      rows.push(row);
      pageBytes += bytes;
    }
    const analysisAnswers: DiscoveryAnswer[] = rows.map((row) => ({
      id: row.id,
      answer: row.answer,
      sources: JSON.parse(row.sources_json || '[]'),
      createdAt: row.created_at,
    }));
    const priorSeeds: DiscoveryAnswer[] = JSON.parse(
      job.seed_answers_json || '[]',
    );
    const seedAnswers = [...priorSeeds];
    for (const answer of analysisAnswers)
      if (
        seedAnswers.length < 12 &&
        targets.some((target) => matchesBrand(answer.answer, target))
      )
        seedAnswers.push(boundedSeedAnswer(answer, targets));
    if (job.phase === 'seeds') {
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
      void this.ctx.storage.setAlarm(Date.now() + 250);
      return this.analysisStatus();
    }
    const candidates = discoverCompetitors(analysisAnswers, targets, {
      maxCandidates: 20,
      maxEvidencePerCandidate: MAX_EVIDENCE,
      referenceAnswers: referencesOutsidePage(seedAnswers, analysisAnswers),
    });
    const mentions = rows.map((row) => ({
      id: row.id,
      mentions: JSON.stringify(
        Object.fromEntries(
          targets.map((target) => [
            target.name,
            matchesBrand(row.answer, target),
          ]),
        ),
      ),
    }));
    const processed = job.processed + rows.length;
    const done =
      (rows.length === fetched.length && fetched.length < requestedLimit) ||
      processed >= job.max_runs;
    const last = rows.at(-1);
    const stamp = new Date().toISOString();
    const rescanCutoff = new Date(
      Date.now() - ANALYSIS_WINDOW_MS,
    ).toISOString();
    const rescanEligible =
      done && job.needs_rescan
        ? Number(
            sql
              .exec<{ count: number }>(
                `SELECT COUNT(*) count FROM (
                   SELECT id FROM runs WHERE status='complete' AND response_available=1
                   AND answer IS NOT NULL AND created_at>=?
                   ORDER BY created_at DESC,id DESC LIMIT ?)`,
                rescanCutoff,
                job.max_runs + 1,
              )
              .one().count,
          )
        : 0;
    this.ctx.storage.transactionSync(() => {
      for (const row of mentions)
        sql.exec(
          `UPDATE runs SET analysis_pending_revision=?,analysis_pending_targets_json=?,analysis_pending_mentions_json=?
           WHERE id=? AND status='complete' AND response_available=1`,
          job.revision,
          job.targets_json,
          row.mentions,
          row.id,
        );
      this.mergeSuggestions(job.revision, candidates);
      if (done && job.needs_rescan) {
        sql.exec(
          `UPDATE runs SET analysis_pending_revision=NULL,
           analysis_pending_targets_json=NULL,analysis_pending_mentions_json=NULL
           WHERE analysis_pending_revision=?`,
          job.revision,
        );
        sql.exec(
          'DELETE FROM competitor_suggestions_staging WHERE revision=?',
          job.revision,
        );
        sql.exec(
          `UPDATE competitor_analysis_jobs SET processed=0,scanned=0,phase='seeds',
           cutoff=?,total_eligible=?,truncated=?,
           cursor_created_at=NULL,cursor_id=NULL,status=?,error=NULL,
           updated_at=?,seed_answers_json='[]',needs_rescan=0
           WHERE id=1 AND revision=?`,
          rescanCutoff,
          Math.min(rescanEligible, job.max_runs),
          rescanEligible > job.max_runs ? 1 : 0,
          rescanEligible ? 'pending' : 'complete',
          stamp,
          job.revision,
        );
        if (!rescanEligible) {
          sql.exec('DELETE FROM competitor_suggestions');
          this.setMeta('analysis_revision', job.revision);
          this.setMeta('analysis_targets_json', job.targets_json);
          this.setMeta(
            'analysis_mutation_revision',
            String(Number(this.meta('analysis_mutation_revision') || 0) + 1),
          );
        }
      } else {
        sql.exec(
          `UPDATE competitor_analysis_jobs SET processed=?,cursor_created_at=?,cursor_id=?,
           status=?,error=NULL,updated_at=?,seed_answers_json=? WHERE id=1 AND revision=?`,
          processed,
          last?.created_at ?? job.cursor_created_at,
          last?.id ?? job.cursor_id,
          done ? 'complete' : 'running',
          stamp,
          JSON.stringify(seedAnswers.slice(0, 12)),
          job.revision,
        );
        if (done) {
          sql.exec(
            `UPDATE runs SET analysis_revision=analysis_pending_revision,
             analysis_targets_json=analysis_pending_targets_json,
             analysis_mentions_json=analysis_pending_mentions_json,
             analysis_pending_revision=NULL,analysis_pending_targets_json=NULL,
             analysis_pending_mentions_json=NULL
             WHERE analysis_pending_revision=?`,
            job.revision,
          );
          sql.exec(
            'DELETE FROM competitor_suggestions WHERE revision=?',
            job.revision,
          );
          sql.exec(
            `INSERT INTO competitor_suggestions(
               revision,name,identity,domain,domain_state,score,answer_count,evidence_json)
             SELECT revision,name,identity,domain,domain_state,score,answer_count,evidence_json
             FROM competitor_suggestions_staging WHERE revision=?`,
            job.revision,
          );
          sql.exec(
            'DELETE FROM competitor_suggestions WHERE revision!=?',
            job.revision,
          );
          sql.exec(
            'DELETE FROM competitor_suggestions_staging WHERE revision=?',
            job.revision,
          );
          this.setMeta('analysis_revision', job.revision);
          this.setMeta('analysis_targets_json', job.targets_json);
          this.setMeta(
            'analysis_mutation_revision',
            String(Number(this.meta('analysis_mutation_revision') || 0) + 1),
          );
        }
      }
    });
    if (!done || Boolean(job.needs_rescan))
      void this.ctx.storage.setAlarm(Date.now() + 250);
    return this.analysisStatus();
  }

  async alarm() {
    const revision = this.ctx.storage.sql
      .exec<{ revision: string }>(
        'SELECT revision FROM competitor_analysis_jobs WHERE id=1',
      )
      .toArray()[0]?.revision;
    try {
      this.processAnalysisPage();
    } catch (error) {
      this.ctx.storage.sql.exec(
        "UPDATE competitor_analysis_jobs SET status='failed',error=?,updated_at=? WHERE id=1 AND revision=?",
        error instanceof Error
          ? error.message.slice(0, 500)
          : 'Competitor analysis failed',
        new Date().toISOString(),
        revision || '',
      );
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
          const values = columns.map((key) => data[key] ?? null);
          if (
            values.some(
              (v) =>
                typeof v !== 'string' && typeof v !== 'number' && v !== null,
            )
          )
            throw new Error('Invalid publication values');
          if (change.entity === 'semantic_evaluations') {
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
          } else sql.exec(
            `INSERT INTO ${change.entity}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns
              .filter((c) => c !== 'id')
              .map((c) => `${c}=excluded.${c}`)
              .join(',')}`,
            ...values,
          );
          if (
            change.entity === 'runs' &&
            change.revision > 0 &&
            Object.prototype.hasOwnProperty.call(data, 'answer') &&
            activeRevision &&
            activeTargetsJson
          ) {
            const activeRun = sql
              .exec<{ answer: string }>(
                `SELECT answer FROM runs WHERE id=? AND status='complete'
                 AND response_available=1 AND answer IS NOT NULL`,
                change.id,
              )
              .toArray()[0];
            if (activeRun) {
              sql.exec(
                `UPDATE runs SET analysis_revision=?,analysis_targets_json=?,
                 analysis_mentions_json=? WHERE id=?`,
                activeRevision,
                activeTargetsJson,
                JSON.stringify(
                  Object.fromEntries(
                    activeTargets.map((target) => [
                      target.name,
                      matchesBrand(activeRun.answer, target),
                    ]),
                  ),
                ),
                change.id,
              );
              activeOverlayChanged = true;
            }
          }
        } else sql.exec(`DELETE FROM ${change.entity} WHERE id=?`, change.id);
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
        else if (total) {
          this.ctx.storage.transactionSync(() => {
            sql.exec(
              `UPDATE runs SET analysis_pending_revision=NULL,
               analysis_pending_targets_json=NULL,analysis_pending_mentions_json=NULL
               WHERE analysis_pending_revision=?`,
              job.revision,
            );
            sql.exec(
              'DELETE FROM competitor_suggestions_staging WHERE revision=?',
              job.revision,
            );
            sql.exec(
              `UPDATE competitor_analysis_jobs SET processed=0,scanned=0,phase='seeds',
               cutoff=?,total_eligible=?,truncated=?,cursor_created_at=NULL,cursor_id=NULL,
               status='pending',error=NULL,updated_at=?,seed_answers_json='[]',needs_rescan=0
               WHERE id=1 AND revision=?`,
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
  async fetch(request: Request) {
    try {
      if (request.method !== 'POST')
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 8 * 1024 * 1024)
        throw new Error('Storage request is too large');
      const message = JSON.parse(raw) as StoreMessage;
      this.authorize(message.scope, message.action === 'initialize');
      const sql = this.ctx.storage.sql;
      let result: unknown;
      if (message.action === 'initialize') result = { initialized: true };
      else if (message.action === 'apply')
        result = this.apply(message.scope, message.changes);
      else if (message.action === 'status')
        result = {
          schema: 1,
          runs: sql
            .exec<{ count: number }>('SELECT COUNT(*) count FROM runs')
            .one().count,
          prompts: sql
            .exec<{ count: number }>('SELECT COUNT(*) count FROM prompts')
            .one().count,
          analysisRevision: this.meta('analysis_revision') ?? null,
          analysisMutationRevision: Number(
            this.meta('analysis_mutation_revision') || 0,
          ),
        };
      else if (message.action === 'analysis-start')
        result = this.startAnalysis(message);
      else if (message.action === 'analysis-status')
        result = this.analysisStatus();
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
          sql.exec(
            'DELETE FROM competitor_suggestions_staging WHERE revision=?',
            message.revision,
          );
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
        const limit = Math.max(1, Math.min(100, Number(message.limit) || 100));
        const cursor = sql.exec<StoreRow>(
          `SELECT ${storeColumns(message.entity).join(',')} FROM ${message.entity} WHERE id>? ORDER BY id LIMIT ?`,
          message.cursor || '',
          limit + 1,
        );
        const rows: StoreRow[] = [];
        let bytes = 0,
          hasMore = false;
        for (const row of cursor) {
          const size = new TextEncoder().encode(JSON.stringify(row)).byteLength;
          if (
            rows.length &&
            (rows.length === limit || bytes + size > 4 * 1024 * 1024)
          ) {
            hasMore = true;
            break;
          }
          if (size > 4 * 1024 * 1024)
            throw new Error('A project record is too large');
          rows.push(row);
          bytes += size;
        }
        result = { rows, nextCursor: hasMore ? rows.at(-1)?.id : null };
      } else if (message.action === 'query') {
        if (
          !Array.isArray(message.statements) ||
          message.statements.length > 10
        )
          throw new Error('Invalid query batch');
        const encoder = new TextEncoder();
        let queryBytes = 0;
        result = this.ctx.storage.transactionSync(() =>
          message.statements.map((statement) => {
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
      } else throw new Error('Unknown storage operation');
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
