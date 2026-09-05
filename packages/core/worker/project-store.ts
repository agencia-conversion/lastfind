import { DurableObject } from 'cloudflare:workers';
import {
  RUN_STORE_COLUMNS,
  PROMPT_STORE_COLUMNS,
  storeColumns,
  validStoreScope,
  type StoreMessage,
  type StoreRow,
  type StoreScope,
  type StoreChange,
} from '../lib/project-store-contract';

const RUN_NUMBERS = new Set([
  'response_available',
  'cost',
  'raw_response_bytes',
]);
const PROMPT_NUMBERS = new Set(['active', 'archived']);
const defaults: Record<string, string> = {
  mentions_json: "'{}'",
  sources_json: "'[]'",
  search_queries_json: "'[]'",
  response_available: '1',
  cost: '0',
  raw_response_status: "'not_captured'",
};
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
    this.ctx.storage.transactionSync(() => {
      for (const change of changes) {
        if (
          !['runs', 'prompts'].includes(change.entity) ||
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
            (change.entity === 'runs' && data.owner_id !== scope.ownerId))
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
          sql.exec(
            `INSERT INTO ${change.entity}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns
              .filter((c) => c !== 'id')
              .map((c) => `${c}=excluded.${c}`)
              .join(',')}`,
            ...values,
          );
        } else sql.exec(`DELETE FROM ${change.entity} WHERE id=?`, change.id);
        sql.exec(
          'INSERT INTO store_versions(entity,id,revision) VALUES(?,?,?) ON CONFLICT(entity,id) DO UPDATE SET revision=excluded.revision',
          change.entity,
          change.id,
          change.revision,
        );
        applied++;
      }
    });
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
        };
      else if (message.action === 'scan') {
        if (!['runs', 'prompts'].includes(message.entity))
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
