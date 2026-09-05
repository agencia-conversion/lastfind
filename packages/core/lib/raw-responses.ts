/** A complete, single-task response body from DataForSEO; never request headers. */
export type RawProviderResponse = {
  body: string;
  endpoint: string;
  receivedAt: string;
  taskId: string;
};
export type RawArchiveScope = {
  ownerId: string;
  projectId: string;
  runId: string;
  engine: string;
  taskId: string;
};
export type RawArchiveRecord = {
  status: 'not_captured' | 'not_configured' | 'archived' | 'failed';
  key: string | null;
  sha256: string | null;
  bytes: number | null;
  stored_at: string | null;
  error: string | null;
};
export type RawArchiveMetadata = Omit<RawArchiveRecord, 'key'>;
export type RawArchiveBucket = {
  put(
    key: string,
    value: string,
    options: {
      sha256: string;
      httpMetadata: { contentType: string; cacheControl: string };
      customMetadata: Record<string, string>;
    },
  ): Promise<unknown>;
};
const MAX_RAW_BYTES = 16 * 1024 * 1024;
const empty = (
  status: RawArchiveRecord['status'],
  error: string | null = null,
): RawArchiveRecord => ({
  status,
  error,
  key: null,
  sha256: null,
  bytes: null,
  stored_at: null,
});

export function rawArchiveKey(
  scope: Pick<RawArchiveScope, 'ownerId' | 'projectId' | 'runId'>,
  sha256: string,
) {
  return `raw/v1/${encodeURIComponent(scope.ownerId)}/${encodeURIComponent(scope.projectId)}/${encodeURIComponent(scope.runId)}/${sha256}.json`;
}
export function hexDigest(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Null for batches, malformed envelopes or a different task: never mix tenants. */
export function captureRawResponse(
  body: string,
  endpoint: string,
  receivedAt: string,
  expectedTaskId: string,
): RawProviderResponse | undefined {
  try {
    const parsed = JSON.parse(body) as {
      status_code?: number;
      tasks?: { id?: unknown }[];
    };
    if (
      !expectedTaskId ||
      parsed.status_code !== 20000 ||
      !Array.isArray(parsed.tasks) ||
      parsed.tasks.length !== 1 ||
      parsed.tasks[0]?.id !== expectedTaskId
    )
      return;
    if (
      !endpoint.startsWith('https://api.dataforseo.com/v3/') ||
      !Number.isFinite(Date.parse(receivedAt))
    )
      return;
    return { body, endpoint, receivedAt, taskId: expectedTaskId };
  } catch {
    return;
  }
}

async function boundedStorageWrite(pending: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Archive write timeout')),
          8000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function archiveRawResponse(
  bucket: RawArchiveBucket | undefined,
  scope: RawArchiveScope,
  response: RawProviderResponse | undefined,
): Promise<RawArchiveRecord> {
  if (!bucket) return empty('not_configured');
  // Validate again at this trust boundary even when capture originated internally.
  const captured =
    response &&
    captureRawResponse(
      response.body,
      response.endpoint,
      response.receivedAt,
      scope.taskId,
    );
  if (!captured) return empty('failed', 'single_task_payload_unavailable');
  const bytes = new TextEncoder().encode(captured.body);
  if (bytes.byteLength > MAX_RAW_BYTES)
    return empty('failed', 'payload_too_large');
  const sha256 = hexDigest(await crypto.subtle.digest('SHA-256', bytes));
  const key = rawArchiveKey(scope, sha256);
  try {
    const stored = await boundedStorageWrite(
      bucket.put(key, captured.body, {
        sha256,
        httpMetadata: {
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'private, no-store',
        },
        customMetadata: {
          schema: 'lastfind.dataforseo.response.v1',
          owner: scope.ownerId,
          project: scope.projectId,
          run: scope.runId,
          engine: scope.engine,
          task: scope.taskId,
          endpoint: captured.endpoint,
          received_at: captured.receivedAt,
          sha256,
        },
      }),
    );
    if (!stored) return empty('failed', 'storage_write_failed');
    return {
      status: 'archived',
      key,
      sha256,
      bytes: bytes.byteLength,
      stored_at: new Date().toISOString(),
      error: null,
    };
  } catch {
    // Provider collection has already been paid. Keep its normalized result and
    // never repeat a provider submission to repair an optional archive write.
    return empty('failed', 'storage_write_failed');
  }
}

/** Check object provenance before streaming any bytes to a caller. */
export function validRawArchiveObject(
  scope: Pick<RawArchiveScope, 'ownerId' | 'projectId' | 'runId'>,
  expected: { key: string; sha256: string; bytes: number },
  object: {
    key: string;
    size: number;
    customMetadata?: Record<string, string>;
    checksums: { sha256?: ArrayBuffer };
  },
) {
  return (
    /^[a-f0-9]{64}$/.test(expected.sha256) &&
    expected.key === rawArchiveKey(scope, expected.sha256) &&
    object.key === expected.key &&
    object.size === expected.bytes &&
    object.customMetadata?.owner === scope.ownerId &&
    object.customMetadata?.project === scope.projectId &&
    object.customMetadata?.run === scope.runId &&
    object.customMetadata?.sha256 === expected.sha256 &&
    !!object.checksums.sha256 &&
    hexDigest(object.checksums.sha256) === expected.sha256
  );
}
