// Project backups: the NDJSON snapshot format (manifest, chunks, agent conversations, footer) shared by the storage CLI, the project store's
// background backups (worker/project-store.ts) and the background restore (lib/server/project-restores.ts). No server or Cloud import.
import {
  canonicalStoreRow,
  extendStoreDigest,
  type StoreEntity,
  type StoreRow,
} from './project-store-contract.ts';

/** Background backups kept per project (newest ready ones) and the age at which any backup expires. */
export const BACKUPS_KEPT = 3;
export const BACKUP_DAYS = 30;
/** Largest backup file the app restores; the storage CLI has no such limit. */
export const MAX_RESTORE_BYTES = 1024 * 1024 * 1024;
/** A file the app restores goes to the private bucket in parts of this size (the last one is smaller). */
export const RESTORE_PART_BYTES = 16 * 1024 * 1024;

/** A background backup is written to the private bucket in numbered parts of a few MiB, under its own prefix. */
export const backupPrefix = (ownerId: string, projectId: string, backupId: string) =>
  `backups/v1/${encodeURIComponent(ownerId)}/${encodeURIComponent(projectId)}/${encodeURIComponent(backupId)}/`;
export const backupPartKey = (prefix: string, part: number) => `${prefix}${String(part).padStart(6, '0')}.ndjson`;
/** The agent conversations of a background backup, written before it starts and copied in before its footer. */
export const agentBackupKey = (prefix: string) => `${prefix}agent.ndjson`;

export type BackupManifest = {
  schema: 1 | 2 | 3 | 4;
  projectId: string;
  ownerId: string;
  generation: string;
  revision: number;
  analysisRevision?: string | null;
  analysisMutationRevision?: number;
  digests?: Partial<Record<StoreEntity, string>>;
  counts?: Partial<Record<StoreEntity, number>>;
};
export const backupEntities = (schema: number): StoreEntity[] =>
  schema >= 3 ? ['prompts', 'runs', 'semantic_evaluations'] : ['prompts', 'runs'];

/** What a restore verifies (project, owner, row counts and chained digests): equal fingerprints are the same content. */
export function backupFingerprint(manifest: BackupManifest) {
  return JSON.stringify([
    manifest.schema,
    manifest.projectId,
    manifest.ownerId,
    ...backupEntities(manifest.schema).map((entity) => [manifest.counts?.[entity] ?? null, manifest.digests?.[entity] ?? null]),
  ]);
}

const MAX_LINE = 8 * 1024 * 1024;
const encoder = new TextEncoder();
/** The identity a backup's manifest and footer share (schema, project, owner, generation, revision); throws if invalid. */
export function backupIdentity(manifest: BackupManifest) {
  if (
    !manifest ||
    ![1, 2, 3, 4].includes(manifest.schema) ||
    !(['projectId', 'ownerId', 'generation'] as const).every(
      (key) => typeof manifest[key] === 'string' && manifest[key].length > 0 && manifest[key].length <= 200,
    ) ||
    !Number.isSafeInteger(manifest.revision) ||
    manifest.revision < 0 ||
    (manifest.schema >= 2 &&
      ((manifest.analysisRevision !== null &&
        (typeof manifest.analysisRevision !== 'string' || manifest.analysisRevision.length > 200)) ||
        !Number.isSafeInteger(manifest.analysisMutationRevision) ||
        Number(manifest.analysisMutationRevision) < 0))
  )
    throw new Error('Invalid project backup identity.');
  return JSON.stringify([
    manifest.schema,
    manifest.projectId,
    manifest.ownerId,
    manifest.generation,
    manifest.revision,
    ...(manifest.schema >= 2 ? [manifest.analysisRevision, manifest.analysisMutationRevision] : []),
  ]);
}

type ByteSource = AsyncIterable<Uint8Array | string> | ReadableStream<Uint8Array>;
async function* chunksOf(source: ByteSource) {
  if (!('getReader' in source)) return yield* source;
  const reader = source.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Bounded parser: an incomplete or malformed stream cannot become a backup. */
async function* records(source: ByteSource, onBytes?: (bytes: Uint8Array) => unknown) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  for await (const chunk of chunksOf(source)) {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    if (onBytes) await onBytes(bytes);
    pending += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).replace(/\r$/, '');
      pending = pending.slice(end + 1);
      if (encoder.encode(line).byteLength > MAX_LINE) throw new Error('A project backup record is too large.');
      if (line.trim()) yield JSON.parse(line);
    }
    if (pending.length > MAX_LINE) throw new Error('A project backup record is too large.');
  }
  pending += decoder.decode();
  if (pending.trim()) yield JSON.parse(pending);
}

/** Where a backup check is between records: plain JSON, so a restore in the background can save it and go on later. */
export type BackupCheck = {
  header?: BackupManifest;
  footer?: BackupManifest;
  current: StoreEntity;
  counts: Record<StoreEntity, number>;
  digests: Record<StoreEntity, string>;
  lastIds: Record<StoreEntity, string>;
  seen: StoreEntity[];
};
export const newBackupCheck = (): BackupCheck => ({
  current: 'prompts',
  counts: { prompts: 0, runs: 0, semantic_evaluations: 0 },
  digests: { prompts: '', runs: '', semantic_evaluations: '' },
  lastIds: { prompts: '', runs: '', semantic_evaluations: '' },
  seen: [],
});

/**
 * Checks one record of a backup against `check` (updated in place): manifest first, ordered rows of one owner/project,
 * footer counts and chained digests. Returns the verified rows of a chunk, for the restore to upload.
 */
export async function checkBackupRecord(check: BackupCheck, record: unknown, project?: string) {
  const item = record as { type?: string; manifest?: BackupManifest; entity?: StoreEntity; rows?: StoreRow[] } | null;
  if (check.footer) throw new Error('Unexpected data after the project backup footer.');
  const header = check.header;
  if (!header) {
    if (item?.type !== 'manifest') throw new Error('The project backup manifest must be first.');
    backupIdentity(item.manifest!);
    if (project && item.manifest!.projectId !== project) throw new Error('This backup belongs to another project.');
    check.header = item.manifest;
    return null;
  }
  const entities = backupEntities(header.schema);
  // The project's agent conversations (lib/server/agent-backup.ts): kept in the file for the record, outside the
  // checked store content, so a restore skips them and the fingerprint never depends on them.
  if (item?.type === 'agent') return null;
  if (item?.type === 'chunk') {
    const { entity, rows } = item as { entity: StoreEntity; rows: StoreRow[] };
    if (
      !entities.includes(entity) ||
      !Array.isArray(rows) ||
      rows.length > 100 ||
      entities.indexOf(entity) < entities.indexOf(check.current)
    )
      throw new Error('Invalid project backup chunk.');
    check.current = entity;
    if (!check.seen.includes(entity)) check.seen.push(entity);
    for (const row of rows) {
      if (
        !row ||
        typeof row.id !== 'string' ||
        row.id <= check.lastIds[entity] ||
        row.project_id !== header.projectId ||
        (entity !== 'prompts' && row.owner_id !== header.ownerId)
      )
        throw new Error('Project backup rows are unordered or belong to another owner/project.');
      canonicalStoreRow(entity, row, header.schema);
      check.lastIds[entity] = row.id;
    }
    check.counts[entity] += rows.length;
    check.digests[entity] = await extendStoreDigest(check.digests[entity], entity, rows, header.schema);
    return { entity, rows };
  }
  if (item?.type === 'footer') {
    const manifest = item.manifest as BackupManifest;
    if (
      backupIdentity(manifest) !== backupIdentity(header) ||
      entities.some(
        (entity) =>
          !check.seen.includes(entity) ||
          manifest.counts?.[entity] !== check.counts[entity] ||
          manifest.digests?.[entity] !== check.digests[entity],
      )
    )
      throw new Error('The project backup checksum or row count does not match its footer.');
    check.footer = manifest;
    return null;
  }
  throw new Error('Unknown project backup record.');
}

/** The footer of a finished check; a stream that ended earlier is not a backup. */
export function finishedBackup(check: BackupCheck) {
  if (!check.footer) throw new Error('The project backup is incomplete: no verified footer was received.');
  return check.footer;
}

/** The lines of a window of a backup file that ends at a line break (or at the end of the file). */
export function backupLines(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_LINE * 2) throw new Error('A project backup record is too large.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (encoder.encode(line).byteLength > MAX_LINE) throw new Error('A project backup record is too large.');
    if (line.trim()) lines.push(JSON.parse(line) as unknown);
  }
  return lines;
}
/** A window of a backup file read by the background restore: more than the largest record, so a line always fits. */
export const BACKUP_WINDOW_BYTES = MAX_LINE + 1024 * 1024;

/**
 * Reads a whole backup and verifies it (checkBackupRecord). Returns the footer manifest; `onChunk` receives each
 * verified chunk.
 */
export async function inspectBackup(
  source: ByteSource,
  {
    project,
    onBytes,
    onChunk,
  }: {
    project?: string;
    onBytes?: (bytes: Uint8Array) => unknown;
    onChunk?: (entity: StoreEntity, rows: StoreRow[]) => unknown;
  } = {},
): Promise<BackupManifest> {
  const check = newBackupCheck();
  for await (const record of records(source, onBytes)) {
    const chunk = await checkBackupRecord(check, record, project);
    if (chunk && onChunk) await onChunk(chunk.entity, chunk.rows);
  }
  return finishedBackup(check);
}
