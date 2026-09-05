import {
  ensureProjectStore,
  syncProjectStore,
  beginProjectStoreRestore,
  restoreProjectStoreChunk,
  commitProjectStoreRestore,
  type StoreManifest,
} from './project-store';
import { ApiError } from './http';
import type { StoreEntity, StoreRow } from '@/lib/project-store-contract';
import { JsonBodyError, readBoundedJson } from '@/lib/bounded-json';
export async function projectStorageAction(
  projectId: string,
  ownerId: string,
  data: Record<string, unknown>,
) {
  switch (data.action) {
    case 'ensure':
      return { registry: await ensureProjectStore(projectId, ownerId) };
    case 'sync':
      return syncProjectStore(projectId, ownerId, Number(data.rows) || 100);
    case 'restore-begin':
      return beginProjectStoreRestore(
        projectId,
        ownerId,
        data.manifest as StoreManifest,
      );
    case 'restore-chunk':
      return restoreProjectStoreChunk(
        projectId,
        ownerId,
        String(data.generation),
        data.entity as StoreEntity,
        data.rows as StoreRow[],
      );
    case 'restore-commit':
      return commitProjectStoreRestore(
        projectId,
        ownerId,
        String(data.generation),
      );
    default:
      throw new ApiError(400, 'Invalid project storage operation.');
  }
}
export async function storageActionBody(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new ApiError(415, 'Send JSON.');
  try {
    const body = await readBoundedJson(request, 8 * 1024 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw 0;
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof JsonBodyError && error.kind === 'too_large')
      throw new ApiError(413, 'Storage batch is too large.');
    throw new ApiError(400, 'Invalid JSON.');
  }
}
