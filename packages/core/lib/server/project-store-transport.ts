import { env } from 'cloudflare:workers';
import { ApiError } from './http';
import { storeIdentity, type StoreMessage } from '@/lib/project-store-contract';

const STORE_TIMEOUT_MS = 15000;
const UNAVAILABLE = 'Project analytics are temporarily unavailable.';

export type ProjectStoreFailure =
  | 'unconfigured'
  | 'timeout'
  | 'rejected'
  | 'unreachable';

// A dedicated type so callers can recognise a storage outage. It deliberately
// keeps status 503: 409 already means "another publisher holds the lease" and is
// swallowed by projectReadDatabase and ensureCompetitorAnalysis, so reusing it
// here would turn a storage failure into a silent success.
export class ProjectStoreUnavailableError extends ApiError {
  constructor(public readonly reason: ProjectStoreFailure) {
    super(503, UNAVAILABLE);
    this.name = 'ProjectStoreUnavailableError';
  }
}

function reasonFor(error: unknown): ProjectStoreFailure {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && error.name === 'ProjectStoreRejected')
    return 'rejected';
  return 'unreachable';
}

// The Durable Object is the only place that knows why the call failed, and the
// caller only ever saw a generic 503. Record the cause next to the action so an
// incident is diagnosable from the Worker log; never echo it to the client.
function reportStoreFailure(
  message: StoreMessage,
  reason: ProjectStoreFailure,
  error: unknown,
) {
  console.error('Lastfind project store failed:', {
    action: message.action,
    projectId: message.scope?.projectId ?? null,
    reason,
    timeoutMs: reason === 'timeout' ? STORE_TIMEOUT_MS : undefined,
    error:
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : 'Unknown error',
  });
}

export function projectStorageConfigured() {
  return !!env.PROJECT_STORES;
}

export async function projectStoreRpc<T>(message: StoreMessage): Promise<T> {
  if (!env.PROJECT_STORES) {
    reportStoreFailure(
      message,
      'unconfigured',
      new Error('PROJECT_STORES binding is missing'),
    );
    throw new ProjectStoreUnavailableError('unconfigured');
  }
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
        signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      }),
    );
    if (!response.ok) {
      const detail = await response
        .text()
        .then((text) => text.slice(0, 500))
        .catch(() => '');
      const rejected = new Error(
        `Storage rejected operation with ${response.status}${detail ? `: ${detail}` : ''}`,
      );
      rejected.name = 'ProjectStoreRejected';
      throw rejected;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const reason = reasonFor(error);
    reportStoreFailure(message, reason, error);
    throw new ProjectStoreUnavailableError(reason);
  }
}
