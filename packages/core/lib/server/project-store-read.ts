import { ensureProjectStore, syncProjectStore } from './project-store';
import { projectStoreRpc } from './project-store-transport';
import { ApiError } from './http';
import type { StoreScope, StoreValue } from '@/lib/project-store-contract';
export class AnalyticsStatement {
  constructor(
    readonly database: AnalyticsDatabase,
    readonly sql: string,
    readonly params: StoreValue[] = [],
  ) {}
  bind(...params: StoreValue[]) {
    return new AnalyticsStatement(this.database, this.sql, params);
  }
  async all<T = Record<string, unknown>>() {
    return (await this.database.batch<T>([this]))[0];
  }
  async first<T = Record<string, unknown>>() {
    return (await this.all<T>()).results[0] ?? null;
  }
}
export class AnalyticsDatabase {
  readonly mode = 'project';
  constructor(private scope: StoreScope) {}
  prepare(sql: string) {
    return new AnalyticsStatement(this, sql);
  }
  batch<T = Record<string, unknown>>(
    statements: AnalyticsStatement[],
  ): Promise<{ results: T[] }[]> {
    return projectStoreRpc({
      scope: this.scope,
      action: 'query',
      statements: statements.map((s) => ({ sql: s.sql, params: s.params })),
    });
  }
}
export async function projectReadDatabase(projectId: string, ownerId: string) {
  let registry = await ensureProjectStore(projectId, ownerId);
  if (registry.source_revision !== registry.applied_revision) {
    try {
      await syncProjectStore(projectId, ownerId, 100);
    } catch (error) {
      // Another publisher holds the project lease. The last acknowledged DO
      // snapshot remains readable; operational/storage errors still fail closed.
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
    }
    registry = await ensureProjectStore(projectId, ownerId);
  }
  return new AnalyticsDatabase({
    ownerId,
    projectId,
    generation: registry.generation,
  });
}
