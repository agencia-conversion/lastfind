import { env } from 'cloudflare:workers';
import { ApiError } from './http';
import { storeIdentity, type StoreMessage } from '@/lib/project-store-contract';
export function projectStorageConfigured() {
  return !!env.PROJECT_STORES;
}
export async function projectStoreRpc<T>(message: StoreMessage): Promise<T> {
  if (!env.PROJECT_STORES)
    throw new ApiError(503, 'Project analytics are temporarily unavailable.');
  const body = JSON.stringify(message);
  if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024)
    throw new ApiError(413, 'Project storage batch is too large.');
  try {
    const stub = env.PROJECT_STORES.get(
      env.PROJECT_STORES.idFromName(storeIdentity(message.scope)),
    );
    const response = await stub.fetch(
      new Request('https://project-store/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(15000),
      }),
    );
    if (!response.ok) throw new Error('Storage rejected operation');
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Project analytics are temporarily unavailable.');
  }
}
