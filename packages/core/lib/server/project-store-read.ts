import { env, waitUntil } from 'cloudflare:workers';
import { cachedAnalyticsQuery, sharedQuery } from './analytics-query-cache';
import { appOrigin } from './env';
import { timed } from './server-timing';
import { ensureProjectStore, syncProjectStore, type StoreRegistry } from './project-store';
import { projectStoreRpc } from './project-store-transport';
import { ApiError } from './http';
import { MAX_KEPT_RESPONSE_CHARS, type ResponseCopy, type StoreScope, type StoreValue } from '@/lib/project-store-contract';
export class AnalyticsStatement {
  constructor(
    readonly database: AnalyticsDatabase,
    readonly sql: string,
    readonly params: StoreValue[] = [],
  ) {}
  bind(...params: StoreValue[]) {
    return new AnalyticsStatement(this.database, this.sql, params);
  }
  /** `cache: false` for bulk pages (answers) that are read once: they would only push the small, reusable results out of the cache. */
  async all<T = Record<string, unknown>>(options: { cache?: boolean } = {}) {
    return (await this.database.batch<T>([this], options))[0];
  }
  async first<T = Record<string, unknown>>() {
    return (await this.all<T>()).results[0] ?? null;
  }
}
export class AnalyticsDatabase {
  readonly mode = 'project';
  get cacheKey() {
    return JSON.stringify([this.scope, this.revision]);
  }
  private positions: Promise<void> | null = null;
  /** A read touched tables written outside the store's data epoch: the response it makes is not kept (keepResponse). */
  private unversioned = false;
  constructor(
    private scope: StoreScope,
    private revision = 'uncached',
    private positionsPending = false,
    /** Report period boundaries and where the store moved them (see {@link projectReadDatabase}); also marks a report read. */
    private bounds: Map<string, string> | null = null,
    /** A default first-screen read: the store recomputes it after each change (see ProjectStore.warmStep). */
    private warm = false,
    /** The response the store kept for this read's inputs and its current data, and the key to keep a new one under. */
    private copy: ResponseCopy = null,
  ) {}
  /**
   * The response kept for this read, when it was made with these `extras` (a digest of the Worker reads the probe could not
   * name: they arrive beside the status). Null when there is none: the report is computed, then {@link keepResponse}.
   */
  keptResponse(extras: string) {
    const value = this.copy?.value;
    return value?.startsWith(`${extras}\n`) ? value.slice(extras.length + 1) : null;
  }
  /** Keeps a computed response (its JSON) for the next read of the same inputs, after the response has left. */
  keepResponse(extras: string, body: string) {
    if (!this.copy || this.unversioned || this.positionsPending) return;
    keepCopy(this.scope, this.copy, `${extras}\n${body}`);
  }
  /** The boundary to bind in report SQL: the same answers as `value`, and the same text while no answer crosses it. */
  periodBound(value: string) {
    return this.bounds?.get(value) ?? value;
  }
  /** Saves the mention ranks of answers that have none (new, changed, or read under another analysis): reports sum them from run_positions. */
  ensurePositions() {
    if (!this.positionsPending) return Promise.resolve();
    // A failed fill is retried by the next report; one that succeeded is not repeated for this read.
    return (this.positions ??= (async () => {
      let cursor = '';
      for (let page = 0; ; page++) {
        // 300 answers per page: a project of 100,000 answers is a first read of about 330 calls, then only what is new.
        if (page >= 400) throw new ApiError(503, 'Project analytics are temporarily unavailable.');
        const next = await projectStoreRpc<{ cursor: string; done: boolean }>({ scope: this.scope, action: 'positions-fill', cursor });
        if (next.done) return;
        cursor = next.cursor;
      }
    })().catch((error) => {
      this.positions = null;
      throw error;
    }));
  }
  prepare(sql: string) {
    return new AnalyticsStatement(this, sql);
  }
  batch<T = Record<string, unknown>>(
    statements: AnalyticsStatement[],
    { cache = true }: { cache?: boolean } = {},
  ): Promise<{ results: T[] }[]> {
    const query = statements.map((s) => ({ sql: s.sql, params: s.params }));
    if (query.some((statement) => UNVERSIONED_TABLES.test(statement.sql) || CLOCK_SQL.test(statement.sql))) this.unversioned = true;
    const load = () =>
      projectStoreRpc<{ results: T[] }[]>({
        scope: this.scope,
        action: 'query',
        statements: query,
        // The store answers a report read from the results it keeps for its current data, when it has them.
        ...(this.bounds && cache ? { report: { asked: [...this.bounds.keys()], snapped: [...this.bounds.values()], warm: this.warm } } : {}),
      });
    if (!cache) return load();
    return this.cached(query, [this.scope, this.revision, query], load);
  }
  /**
   * A result computed from these statements' rows alone (`extra` names any other input), cached like their read: a hit
   * skips both the read and the computation.
   */
  derive<T>(statements: AnalyticsStatement[], extra: unknown, compute: () => Promise<T>): Promise<T> {
    const query = statements.map((s) => ({ sql: s.sql, params: s.params }));
    return this.cached(query, ['derived', this.scope, this.revision, extra, query], compute);
  }
  private cached<T>(query: { sql: string }[], parts: unknown[], load: () => Promise<T>): Promise<T> {
    if (this.revision === 'uncached') return load();
    const key = JSON.stringify(parts);
    // Report reads with fixed boundaries are the same for every request until the revision changes, so isolates share them.
    // Products and offers are written outside the revision (their own backfills and scans): those stay per isolate.
    const shared = this.bounds && !query.some((statement) => UNVERSIONED_TABLES.test(statement.sql));
    // The key holds the store scope, its revision and the exact statements: a hit is the answer the store would give now.
    const read = shared
      ? () =>
          sharedQuery(key, load, {
            origin: cacheOrigin(),
            prefix: '__project-store-cache',
            version: env.WORKER_VERSION?.id,
            ttlSeconds: SHARED_READ_TTL_SECONDS,
            timed,
          })
      : load;
    return cachedAnalyticsQuery(key, read, { keep: waitUntil });
  }
}
/**
 * The response the project's store kept for `inputs` and its current data, for a read that is not a report read (the
 * Brands lists): `analysis` adds the competitor analysis job to the key, `bounds` the period as the store moves it.
 * `keep` stores the response computed now under the same key (after the response has left). With `last`, `last` is the
 * newest copy of these inputs whatever the data (none kept for the current data), and `refresh` computes the response again
 * after this one has left and keeps it, so a stale copy can be painted at once (stale-while-revalidate).
 */
export async function storedCopy(scope: StoreScope, inputs: unknown, { analysis = false, bounds, last = false }: { analysis?: boolean; bounds?: string[]; last?: boolean } = {}) {
  const copy = await unpackCopy(await projectStoreRpc<ResponseCopy>({ scope, action: 'copy-get', copy: { base: await copyBase(inputs), analysis, ...(last ? { last } : {}) }, ...(bounds ? { bounds } : {}) }));
  const keep = (value: string) => {
    if (copy) keepCopy(scope, copy, value, last);
  };
  return {
    value: copy?.value ?? null,
    storedAt: copy?.storedAt ?? 0,
    last: copy?.last ?? null,
    keep,
    refresh(compute: () => Promise<string>) {
      if (copy) waitUntil(compute().then(keep, () => {}));
    },
  };
}
/** Copies on their way to the store (keepCopy): the first screens' warm-up waits for them one read at a time. */
const keeping = new Set<Promise<unknown>>();
/**
 * Sends a response to the store under the key it gave, after the response has left. One the store would refuse (larger than
 * MAX_KEPT_RESPONSE_CHARS) is not sent: it would only fill the store's memory with a request body.
 */
function keepCopy(scope: StoreScope, copy: NonNullable<ResponseCopy>, value: string, last = false) {
  const put = packText(value)
    .then((packed) => packed.length > MAX_KEPT_RESPONSE_CHARS ? undefined : projectStoreRpc({ scope, action: 'copy-put', key: copy.key, epoch: copy.epoch, value: packed, ...(last ? { last } : {}) }))
    .catch(() => {});
  keeping.add(put);
  void put.finally(() => keeping.delete(put));
  waitUntil(put);
}
/**
 * A copy larger than the store keeps travels gzipped, base64 after `gz:` (JSON never starts so): the Brands report with every
 * brand's evidence is about 3 MB of JSON and a tenth of that packed. Smaller ones go as they are.
 */
const PACKED = 'gz:';
const gzip = (bytes: BlobPart, stream: CompressionStream | DecompressionStream) => new Response(new Blob([bytes]).stream().pipeThrough(stream));
export async function packText(value: string) {
  if (value.length <= MAX_KEPT_RESPONSE_CHARS) return value;
  const bytes = new Uint8Array(await gzip(value, new CompressionStream('gzip')).arrayBuffer());
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return PACKED + btoa(binary);
}
export async function unpackText(value: string) {
  if (!value.startsWith(PACKED)) return value;
  return gzip(Uint8Array.from(atob(value.slice(PACKED.length)), (char) => char.charCodeAt(0)), new DecompressionStream('gzip')).text();
}
async function unpackCopy(copy: ResponseCopy | undefined) {
  if (!copy) return copy ?? null;
  return {
    ...copy,
    ...(copy.value !== undefined ? { value: await unpackText(copy.value) } : {}),
    ...(copy.last ? { last: { ...copy.last, value: await unpackText(copy.last.value) } } : {}),
  };
}
/** Waits for the copies sent so far (the warm-up, so the store receives one at a time). */
export const keptAll = () => Promise.all(keeping);
/** The code version that shaped a kept response (Cloudflare's version metadata). None locally: this isolate's own. */
let isolateVersion: string | undefined;
export const copyVersion = () => env.WORKER_VERSION?.id ?? (isolateVersion ??= crypto.randomUUID());
/** The Worker's side of a response copy key: the code version and the inputs the caller names (owner, request, D1 rows). */
export const copyBase = (inputs: unknown) => digest([copyVersion(), inputs]);
/** SHA-256 (hex) of a value's JSON. */
export async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** How long a location keeps a shared report read. The key changes with the data, so this only bounds the storage. */
export const SHARED_READ_TTL_SECONDS = 3600;
/** The application's origin, the Worker Cache key space (the cache is per zone); none configured: nothing is shared. */
function cacheOrigin() {
  try {
    return appOrigin();
  } catch {
    return '';
  }
}
/** SQL whose answer moves with the clock: never kept beyond the request (the store's report_cache refuses it too). */
const CLOCK_SQL = /'now'|random\(|current_(date|time)/i;
/** Store tables whose writes do not advance the registry or analysis revisions that key the shared cache. */
const UNVERSIONED_TABLES =
  /\b(run_products|run_offers|run_offer_scans|competitor_analysis_jobs|competitor_suggestions|competitor_suggestions_staging|competitor_attributed_names)\b/;
/**
 * The project's analytical database. `bounds` (report period boundaries) are moved by the store to the first answer at or
 * after each one, read in the same call as the status: report SQL binds them through `periodBound`.
 */
export async function projectReadDatabase(
  projectId: string,
  workspaceId: string,
  known?: StoreRegistry | null,
  bounds?: string[],
  // `copy`: the inputs that name the response this read makes (see ProjectStore.responseCopy): the status also looks for it.
  { warm = false, copy }: { warm?: boolean; copy?: unknown } = {},
) {
  let registry = await ensureProjectStore(projectId, workspaceId, known);
  if (registry.source_revision !== registry.applied_revision) {
    try {
      await syncProjectStore(projectId, workspaceId, 100);
    } catch (error) {
      // Another publisher holds the project lease. The last acknowledged DO
      // snapshot remains readable; operational/storage errors still fail closed.
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
    }
    registry = await ensureProjectStore(projectId, workspaceId);
  }
  const scope = {
    ownerId: workspaceId,
    projectId,
    generation: registry.generation,
  };
  const status = await projectStoreRpc<{
    analysisRevision: string | null;
    analysisMutationRevision: number;
    /** The store's data epoch: every write a report can see advances it (ProjectStore's report_epoch triggers). */
    epoch?: number;
    positionsPending: boolean;
    bounds?: string[];
    sourcesCanonical?: boolean;
    copy?: ResponseCopy;
  }>({ scope, action: 'status', fill: true, ...(bounds ? { bounds } : {}), ...(bounds && copy !== undefined ? { copy: { base: await copyBase(copy) } } : {}) });
  // While publication is behind (another publisher holds the lease) or old sources are still being rewritten, the store can
  // change without a new revision: no sharing then.
  const caughtUp = registry.source_revision === registry.applied_revision && status.sourcesCanonical !== false;
  const moved = bounds && status.bounds?.length === bounds.length && caughtUp;
  return new AnalyticsDatabase(
    scope,
    // The key of every Worker-side copy of this store's reads (the isolate's and the shared cache). The data epoch is in it
    // (10/11/2026): a write the registry and analysis revisions do not see, such as a decision model's verdict landing on
    // answers (mention checks), the discoveries share of voice counts (roles) or any later one, served the older figures
    // from those copies until a new answer arrived.
    `${registry.source_revision}:${registry.applied_revision}:${status.analysisRevision}:${status.analysisMutationRevision}:${status.epoch ?? ''}`,
    status.positionsPending,
    moved ? new Map(bounds.map((bound, index) => [bound, status.bounds![index]])) : null,
    warm,
    // A copy is only kept, or used, for a store that is caught up and whose bounds were moved (the key names them).
    moved ? await unpackCopy(status.copy) : null,
  );
}
