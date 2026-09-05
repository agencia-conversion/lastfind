import { db, now } from './env';
import { ApiError } from './http';
import { withLease } from './leases';
import {
  projectStorageConfigured,
  projectStoreRpc,
} from './project-store-transport';
import {
  extendStoreDigest,
  type StoreEntity,
  type StoreRow,
  type StoreScope,
  type StoreChange,
} from '@/lib/project-store-contract';
export type StoreRegistry = {
  project_id: string;
  owner_id: string;
  generation: string;
  initialized: number;
  source_revision: number;
  applied_revision: number;
  verification_json: string | null;
  candidate_generation: string | null;
  candidate_manifest_json: string | null;
  last_error: string | null;
  updated_at: string;
};
export type StoreManifest = {
  schema: 1;
  projectId: string;
  ownerId: string;
  generation: string;
  revision: number;
  digests: Record<StoreEntity, string>;
  counts: Record<StoreEntity, number>;
};
type Verification = {
  generation: string;
  revision: number;
  entity: StoreEntity;
  cursor: string;
  digest: string;
  digests: Record<StoreEntity, string>;
  counts: Record<StoreEntity, number>;
  done: boolean;
};
const scopeOf = (r: StoreRegistry, generation = r.generation): StoreScope => ({
  ownerId: r.owner_id,
  projectId: r.project_id,
  generation,
});
export async function getProjectStore(projectId: string, ownerId: string) {
  return db()
    .prepare('SELECT * FROM project_stores WHERE project_id=? AND owner_id=?')
    .bind(projectId, ownerId)
    .first<StoreRegistry>();
}
export async function registerProjectStore(projectId: string, ownerId: string) {
  let registry = await getProjectStore(projectId, ownerId);
  if (!registry) {
    await db()
      .prepare(
        `INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),? FROM projects WHERE id=? AND owner_id=?`,
      )
      .bind(now(), projectId, ownerId)
      .run();
    registry = await getProjectStore(projectId, ownerId);
  }
  if (!registry) throw new ApiError(404, 'Project not found.');
  return registry;
}
export async function ensureProjectStore(projectId: string, ownerId: string) {
  if (!projectStorageConfigured())
    throw new ApiError(503, 'Project analytics are temporarily unavailable.');
  let registry = await registerProjectStore(projectId, ownerId);
  if (!registry.initialized) {
    await projectStoreRpc({ scope: scopeOf(registry), action: 'initialize' });
    await db()
      .prepare(
        'UPDATE project_stores SET initialized=1,updated_at=? WHERE project_id=? AND generation=?',
      )
      .bind(now(), projectId, registry.generation)
      .run();
    registry = { ...registry, initialized: 1 };
  }
  return registry;
}
export async function syncProjectStore(
  projectId: string,
  ownerId: string,
  rows = 100,
) {
  const result = await withLease(
    `project-storage:${projectId}`,
    60000,
    async () => {
      const registry = await ensureProjectStore(projectId, ownerId);
      const pending = (
        await db()
          .prepare(
            'SELECT entity,entity_id,revision,operation,data_json FROM project_store_outbox WHERE project_id=? ORDER BY revision LIMIT ?',
          )
          .bind(projectId, Math.max(1, Math.min(100, rows)))
          .all<{
            entity: StoreEntity;
            entity_id: string;
            revision: number;
            operation: string;
            data_json: string | null;
          }>()
      ).results;
      const changes: StoreChange[] = [];
      let bytes = 0;
      for (const item of pending) {
        const data =
          item.operation === 'delete'
            ? null
            : (JSON.parse(item.data_json || 'null') as StoreRow | null);
        if (item.operation !== 'delete' && !data)
          throw new Error('Publication payload is missing');
        const change = {
          entity: item.entity,
          id: item.entity_id,
          revision: item.revision,
          data,
        };
        const size = new TextEncoder().encode(
          JSON.stringify(change),
        ).byteLength;
        if (changes.length && bytes + size > 4 * 1024 * 1024) break;
        if (size > 4 * 1024 * 1024)
          throw new Error('Publication exceeds the object request limit');
        changes.push(change);
        bytes += size;
      }
      if (changes.length) {
        await projectStoreRpc({
          scope: scopeOf(registry),
          action: 'apply',
          changes,
        });
        // This acknowledgement deletes the temporary JSON payload. A failed ACK
        // repeats an idempotent DO publication, never a paid provider submission.
        await db()
          .prepare(
            `DELETE FROM project_store_outbox WHERE project_id=? AND EXISTS(SELECT 1 FROM json_each(?) x WHERE entity=json_extract(x.value,'$.entity') AND entity_id=json_extract(x.value,'$.id') AND revision=json_extract(x.value,'$.revision'))`,
          )
          .bind(
            projectId,
            JSON.stringify(
              changes.map(({ entity, id, revision }) => ({
                entity,
                id,
                revision,
              })),
            ),
          )
          .run();
      }
      await db()
        .prepare(
          `UPDATE project_stores SET applied_revision=source_revision,last_error=NULL,updated_at=? WHERE project_id=? AND generation=? AND NOT EXISTS(SELECT 1 FROM project_store_outbox WHERE project_id=?)`,
        )
        .bind(now(), projectId, registry.generation, projectId)
        .run();
      const current = (await getProjectStore(projectId, ownerId))!;
      return {
        done: current.source_revision === current.applied_revision,
        published: changes.length,
        registry: current,
      };
    },
  );
  if (!result)
    throw new ApiError(409, 'Project publication is already running.');
  return result;
}
export async function flushProjectStores(
  options: { projects?: number; rows?: number } = {},
) {
  if (!projectStorageConfigured()) return { checked: 0, unconfigured: true };
  const pending = (
    await db()
      .prepare(
        'SELECT project_id,owner_id FROM project_stores WHERE initialized=0 OR source_revision!=applied_revision ORDER BY updated_at LIMIT ?',
      )
      .bind(Math.max(1, Math.min(5, options.projects || 2)))
      .all<{ project_id: string; owner_id: string }>()
  ).results;
  let checked = 0;
  for (const project of pending)
    try {
      await syncProjectStore(
        project.project_id,
        project.owner_id,
        options.rows || 50,
      );
      checked++;
    } catch {
      await db()
        .prepare(
          "UPDATE project_stores SET last_error='publication_failed',updated_at=? WHERE project_id=?",
        )
        .bind(now(), project.project_id)
        .run();
    }
  return { checked };
}
export async function exportProjectStore(projectId: string, ownerId: string) {
  const registry = await ensureProjectStore(projectId, ownerId);
  if (registry.source_revision !== registry.applied_revision)
    throw new ApiError(
      409,
      'Finish pending publications before exporting the project.',
    );
  const revision = registry.source_revision,
    generation = registry.generation;
  const encoder = new TextEncoder();
  let entity: StoreEntity = 'prompts',
    cursor = '',
    digest = '',
    started = false,
    finished = false;
  const digests: Record<StoreEntity, string> = { runs: '', prompts: '' },
    counts: Record<StoreEntity, number> = { runs: 0, prompts: 0 };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        const current = await getProjectStore(projectId, ownerId);
        if (
          !current ||
          current.source_revision !== revision ||
          current.applied_revision !== revision ||
          current.generation !== generation
        )
          throw new Error('Project changed during export. Retry the snapshot.');
        if (!started) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: 'manifest',
                manifest: {
                  schema: 1,
                  projectId,
                  ownerId,
                  generation,
                  revision,
                },
              }) + '\n',
            ),
          );
          started = true;
        }
        const page = await projectStoreRpc<{
          rows: StoreRow[];
          nextCursor: string | null;
        }>({
          scope: scopeOf(registry),
          action: 'scan',
          entity,
          cursor,
          limit: 100,
        });
        digest = await extendStoreDigest(digest, entity, page.rows);
        counts[entity] += page.rows.length;
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: 'chunk', entity, rows: page.rows }) + '\n',
          ),
        );
        if (page.nextCursor) cursor = page.nextCursor;
        else {
          digests[entity] = digest;
          if (entity === 'prompts') {
            entity = 'runs';
            cursor = '';
            digest = '';
          } else {
            const last = await getProjectStore(projectId, ownerId);
            if (
              last?.source_revision !== revision ||
              last.generation !== generation
            )
              throw new Error('Project changed during export.');
            const manifest: StoreManifest = {
              schema: 1,
              projectId,
              ownerId,
              generation,
              revision,
              digests,
              counts,
            };
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ type: 'footer', manifest }) + '\n',
              ),
            );
            finished = true;
            controller.close();
          }
        }
      } catch (error) {
        finished = true;
        controller.error(error);
      }
    },
    cancel() {
      finished = true;
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="lastfind-project-${projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}.ndjson"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
export async function beginProjectStoreRestore(
  projectId: string,
  ownerId: string,
  manifest: StoreManifest,
) {
  const registry = await ensureProjectStore(projectId, ownerId);
  if (
    !manifest ||
    manifest.schema !== 1 ||
    manifest.projectId !== projectId ||
    manifest.ownerId !== ownerId ||
    !['runs', 'prompts'].every(
      (e) =>
        /^[a-f0-9]{64}$/.test(manifest.digests?.[e as StoreEntity]) &&
        Number.isSafeInteger(manifest.counts?.[e as StoreEntity]) &&
        manifest.counts[e as StoreEntity] >= 0,
    )
  )
    throw new ApiError(
      400,
      'The snapshot does not belong to this project or is invalid.',
    );
  if (registry.source_revision !== registry.applied_revision)
    throw new ApiError(
      409,
      'Finish pending publications before restoring the project.',
    );
  const generation = crypto.randomUUID();
  await projectStoreRpc({
    scope: scopeOf(registry, generation),
    action: 'initialize',
  });
  await db()
    .prepare(
      'UPDATE project_stores SET candidate_generation=?,candidate_manifest_json=?,verification_json=NULL,updated_at=? WHERE project_id=? AND owner_id=?',
    )
    .bind(
      generation,
      JSON.stringify({
        ...manifest,
        restoreStartRevision: registry.source_revision,
      }),
      now(),
      projectId,
      ownerId,
    )
    .run();
  return { generation };
}
export async function restoreProjectStoreChunk(
  projectId: string,
  ownerId: string,
  generation: string,
  entity: StoreEntity,
  rows: StoreRow[],
) {
  const result = await withLease(
    `project-storage:${projectId}`,
    60000,
    async () => {
      const registry = await ensureProjectStore(projectId, ownerId);
      if (
        registry.candidate_generation !== generation ||
        !['runs', 'prompts'].includes(entity) ||
        !Array.isArray(rows) ||
        rows.length > 100 ||
        rows.some(
          (r) =>
            !r ||
            typeof r.id !== 'string' ||
            r.project_id !== projectId ||
            (entity === 'runs' && r.owner_id !== ownerId),
        )
      )
        throw new ApiError(400, 'Invalid restore batch.');
      if (registry.verification_json)
        throw new ApiError(
          409,
          'Restore verification has started. Upload to a new restore generation.',
        );
      return projectStoreRpc({
        scope: scopeOf(registry, generation),
        action: 'apply',
        changes: rows.map((data) => ({
          entity,
          id: String(data.id),
          revision: 0,
          data,
        })),
      });
    },
  );
  if (!result)
    throw new ApiError(409, 'Project publication is already running.');
  return result;
}
export async function commitProjectStoreRestore(
  projectId: string,
  ownerId: string,
  generation: string,
) {
  const result = await withLease(
    `project-storage:${projectId}`,
    60000,
    async () => {
      const registry = await ensureProjectStore(projectId, ownerId);
      if (registry.generation === generation && !registry.candidate_generation)
        return { done: true, registry };
      if (
        registry.candidate_generation !== generation ||
        !registry.candidate_manifest_json
      )
        throw new ApiError(400, 'Unknown restore generation.');
      const expected: StoreManifest & { restoreStartRevision: number } =
        JSON.parse(registry.candidate_manifest_json);
      if (
        registry.source_revision !== expected.restoreStartRevision ||
        registry.applied_revision !== registry.source_revision
      )
        throw new ApiError(
          409,
          'Project changed during restore. Export a current snapshot and try again.',
        );
      const state: Verification = registry.verification_json
        ? JSON.parse(registry.verification_json)
        : {
            generation,
            revision: registry.source_revision,
            entity: 'prompts',
            cursor: '',
            digest: '',
            digests: { runs: '', prompts: '' },
            counts: { runs: 0, prompts: 0 },
            done: false,
          };
      const page = await projectStoreRpc<{
        rows: StoreRow[];
        nextCursor: string | null;
      }>({
        scope: scopeOf(registry, generation),
        action: 'scan',
        entity: state.entity,
        cursor: state.cursor,
        limit: 100,
      });
      state.digest = await extendStoreDigest(
        state.digest,
        state.entity,
        page.rows,
      );
      state.counts[state.entity] += page.rows.length;
      if (page.nextCursor) state.cursor = page.nextCursor;
      else {
        state.digests[state.entity] = state.digest;
        if (state.entity === 'prompts') {
          state.entity = 'runs';
          state.cursor = '';
          state.digest = '';
        } else state.done = true;
      }
      if (!state.done) {
        await db()
          .prepare(
            'UPDATE project_stores SET verification_json=? WHERE project_id=? AND candidate_generation=?',
          )
          .bind(JSON.stringify(state), projectId, generation)
          .run();
        return { done: false, registry };
      }
      if (
        ['runs', 'prompts'].some(
          (e) =>
            state.digests[e as StoreEntity] !==
              expected.digests[e as StoreEntity] ||
            state.counts[e as StoreEntity] !==
              expected.counts[e as StoreEntity],
        )
      )
        throw new ApiError(
          409,
          'Restore checksum differs from the exported snapshot. The active generation is unchanged.',
        );
      const switched = await db()
        .prepare(
          'UPDATE project_stores SET generation=candidate_generation,candidate_generation=NULL,candidate_manifest_json=NULL,verification_json=NULL,updated_at=? WHERE project_id=? AND owner_id=? AND candidate_generation=? AND source_revision=? AND applied_revision=source_revision',
        )
        .bind(now(), projectId, ownerId, generation, state.revision)
        .run();
      if (!switched.meta.changes)
        throw new ApiError(409, 'Project changed before restore activation.');
      return {
        done: true,
        registry: await getProjectStore(projectId, ownerId),
        manifest: expected,
      };
    },
  );
  if (!result)
    throw new ApiError(409, 'Project publication is already running.');
  return result;
}
