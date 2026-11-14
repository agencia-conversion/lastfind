// Background project restores (Settings > Project data), both editions. The owner confirms, the file goes once to the
// private bucket (a file in parts of RESTORE_PART_BYTES, or a backup already stored there), and from then on a restore
// driver's alarm (worker/project-store.ts, `restore-drive`) runs restoreStep until it ends, whether or not the page is
// open: a backup of the current state first, then the verified rows into a new generation (the same begin, chunk and
// commit the storage CLI uses), which is switched only after the server has verified every row. Cloud only takes a file
// Lastfind made of this project; the independent edition takes any backup of the project.
import { env } from 'cloudflare:workers';
import { db, now } from './env';
import { ApiError } from './http';
import { rawResponsesBucket } from './raw-responses';
import { ownerRestore } from './capabilities';
import { listProjectBackups, madeByLastfind, startProjectBackup } from './project-backups';
import {
  beginProjectStoreRestore,
  commitProjectStoreRestore,
  restoreProjectStoreChunk,
  syncProjectStore,
  type StoreManifest,
} from './project-store';
import {
  BACKUP_WINDOW_BYTES,
  MAX_RESTORE_BYTES,
  RESTORE_PART_BYTES,
  backupFingerprint,
  backupIdentity,
  backupLines,
  backupPartKey,
  backupPrefix,
  checkBackupRecord,
  newBackupCheck,
  type BackupCheck,
  type BackupManifest,
} from '@/lib/project-backups';

/** Why a restore failed, as the app tells it (the panel words each one in the viewer's language). */
export type RestoreError = 'invalid' | 'other-project' | 'not-made-here' | 'backup' | 'changed' | 'upload' | 'timeout' | 'failed';
export type ProjectRestore = {
  id: string;
  status: 'uploading' | 'running' | 'done' | 'failed';
  step: 'saving' | 'uploading' | 'verifying';
  label: string;
  source: 'file' | 'backup';
  rows: number;
  created_at: string;
  finished_at: string | null;
  error: RestoreError | null;
};
type Row = Omit<ProjectRestore, 'source' | 'rows' | 'error'> & {
  project_id: string;
  workspace_id: string;
  requested_by: string | null;
  backup_id: string | null;
  object_key: string | null;
  upload_id: string | null;
  upload_parts_json: string | null;
  bytes: number;
  manifest_json: string | null;
  generation: string | null;
  safety_backup_id: string | null;
  state_json: string | null;
  attempts: number;
  error: string | null;
  updated_at: string;
};
/** Where the restore is reading: the objects of the file, in order, and a byte offset in the current one. */
type ReadState = { keys: string[]; part: number; offset: number; rows: number; check: BackupCheck };

/** One alarm turn of work; the alarm comes back right after. */
const STEP_MS = 8000;
/** An upload with no part for this long was abandoned (the page closed while sending): it fails. */
const STALE_UPLOAD_MS = 10 * 60000;
/** A running restore not touched for this long has lost its alarm: reading its status wakes the driver again. */
const QUIET_MS = 2 * 60000;
/** A running restore not touched for this long fails. */
const TIMEOUT_MS = 30 * 60000;
/** Consecutive transient failures (a publication holding the lease, the store briefly unavailable) before it fails. */
const MAX_ATTEMPTS = 40;
const READ_BYTES = 1024 * 1024;
const EDGE_BYTES = 64 * 1024;

class RestoreFailure extends Error {
  constructor(public code: RestoreError) {
    super(code);
  }
}
const ACTIVE = 'A restore of this project is already running.';
const unavailable = () => new ApiError(503, 'Project analytics are temporarily unavailable.');
const bucketOrFail = () => rawResponsesBucket() ?? (() => { throw unavailable(); })();
const uploadKey = (workspaceId: string, projectId: string, id: string) =>
  `restores/v1/${encodeURIComponent(workspaceId)}/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}.ndjson`;

function publicRestore(row: Row): ProjectRestore {
  const state = row.state_json ? (JSON.parse(row.state_json) as ReadState) : null;
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    label: row.label,
    source: row.backup_id ? 'backup' : 'file',
    rows: state?.rows ?? 0,
    created_at: row.created_at,
    finished_at: row.finished_at,
    error: (row.error as RestoreError | null) ?? null,
  };
}
async function readRow(projectId: string, workspaceId: string, id: string) {
  return db().prepare('SELECT * FROM project_restores WHERE id=? AND project_id=? AND workspace_id=?').bind(id, projectId, workspaceId).first<Row>();
}

/** Wakes the restore's driver: a project store instance of its own, never a store generation. */
async function wake(id: string) {
  const stores = (env as unknown as { PROJECT_STORES?: DurableObjectNamespace }).PROJECT_STORES;
  if (!stores) throw unavailable();
  const response = await stores.get(stores.idFromName(`restore-driver:${id}`)).fetch('https://project-store/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restore-drive', id }),
  });
  if (!response.ok) throw unavailable();
}

async function finish(row: Row, status: 'done' | 'failed', error: RestoreError | null) {
  const bucket = rawResponsesBucket();
  if (bucket && row.object_key) {
    if (row.status === 'uploading' && row.upload_id)
      await bucket.resumeMultipartUpload(row.object_key, row.upload_id).abort().catch(() => undefined);
    await bucket.delete(row.object_key).catch(() => undefined);
  }
  const at = now();
  await db()
    .prepare("UPDATE project_restores SET status=?,error=?,finished_at=?,updated_at=? WHERE id=? AND status IN ('uploading','running')")
    .bind(status, error, at, at, row.id)
    .run();
  Object.assign(row, { status, error, finished_at: at, updated_at: at });
}

/** The first line of the first object and the last line of the last one: the manifest and the footer. */
async function edges(bucket: R2Bucket, keys: string[]) {
  const line = async (key: string, last: boolean) => {
    const object = await bucket.get(key, { range: last ? { suffix: EDGE_BYTES } : { offset: 0, length: EDGE_BYTES } });
    if (!object) throw new RestoreFailure('invalid');
    const lines = new TextDecoder().decode(await object.arrayBuffer()).split('\n').filter((item) => item.trim());
    try {
      return JSON.parse((last ? lines.at(-1) : lines[0]) ?? '') as { type?: string; manifest?: BackupManifest };
    } catch {
      throw new RestoreFailure('invalid');
    }
  };
  return [await line(keys[0], false), await line(keys.at(-1)!, true)] as const;
}
/** The footer of a file, checked against its manifest and this project before anything changes. */
async function checkedManifest(bucket: R2Bucket, keys: string[], projectId: string, workspaceId: string) {
  const [header, footer] = await edges(bucket, keys);
  if (header.type !== 'manifest' || footer.type !== 'footer' || !header.manifest || !footer.manifest) throw new RestoreFailure('invalid');
  try {
    if (backupIdentity(header.manifest) !== backupIdentity(footer.manifest)) throw new RestoreFailure('invalid');
  } catch {
    throw new RestoreFailure('invalid');
  }
  if (footer.manifest.projectId !== projectId || footer.manifest.ownerId !== workspaceId) throw new RestoreFailure('other-project');
  return footer.manifest;
}
const failureMessage: Record<RestoreError, [number, string]> = {
  invalid: [400, 'The file is not a complete Lastfind backup.'],
  'other-project': [400, 'This backup belongs to another project.'],
  'not-made-here': [403, 'Only backups Lastfind made of this project can be restored here.'],
  backup: [409, 'Could not keep a backup of the current state, so nothing was restored.'],
  changed: [409, 'Project changed during restore. Export a current snapshot and try again.'],
  upload: [409, 'The upload was interrupted. Choose the file again.'],
  timeout: [409, 'The restore stopped. Try again.'],
  failed: [409, 'The restore stopped. Try again.'],
};
const asApiError = (code: RestoreError) => new ApiError(...failureMessage[code]);

/** Fails an upload abandoned mid-way and a run whose driver stopped; wakes a quiet one. */
async function tend(row: Row) {
  const idle = Date.now() - Date.parse(row.updated_at);
  if (row.status === 'uploading' && idle > STALE_UPLOAD_MS) await finish(row, 'failed', 'upload');
  else if (row.status === 'running' && idle > TIMEOUT_MS) await finish(row, 'failed', 'timeout');
  else if (row.status === 'running' && idle > QUIET_MS) await wake(row.id).catch(() => undefined);
  return row;
}

/** The newest restore of the project (the panel shows it whenever it is opened). */
export async function latestProjectRestore(projectId: string, workspaceId: string) {
  const row = await db()
    .prepare('SELECT * FROM project_restores WHERE project_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 1')
    .bind(projectId, workspaceId)
    .first<Row>();
  return row ? publicRestore(await tend(row)) : null;
}

async function insert(row: Partial<Row> & Pick<Row, 'id' | 'project_id' | 'workspace_id' | 'status' | 'label'>) {
  const active = await db()
    .prepare("SELECT * FROM project_restores WHERE project_id=? AND workspace_id=? AND status IN ('uploading','running')")
    .bind(row.project_id, row.workspace_id)
    .first<Row>();
  if (active) {
    // An upload still open belongs to a page that was closed or reloaded: the owner's new choice replaces it.
    if (active.status === 'uploading') await finish(active, 'failed', 'upload');
    else if ((await tend(active)).status === 'running') throw new ApiError(409, ACTIVE);
  }
  const at = now();
  const columns = { step: 'saving', created_at: at, updated_at: at, ...row };
  try {
    await db()
      .prepare(`INSERT INTO project_restores(${Object.keys(columns).join(',')}) VALUES(${Object.keys(columns).map(() => '?').join(',')})`)
      .bind(...Object.values(columns))
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) throw new ApiError(409, ACTIVE);
    throw error;
  }
  return (await readRow(row.project_id, row.workspace_id, row.id))!;
}

/**
 * Starts a restore after the owner confirmed it: `{ backup: id }` restores a stored backup right away; `{ file: { name,
 * bytes } }` opens an upload of that size (send its parts, then complete it).
 */
export async function startProjectRestore(projectId: string, workspaceId: string, requestedBy: string, input: Record<string, unknown>) {
  const bucket = bucketOrFail();
  const id = crypto.randomUUID();
  if (typeof input.backup === 'string') {
    const backup = await db()
      .prepare("SELECT id,parts,created_at FROM project_backups WHERE id=? AND project_id=? AND workspace_id=? AND status='ready'")
      .bind(input.backup, projectId, workspaceId)
      .first<{ id: string; parts: number; created_at: string }>();
    if (!backup || backup.parts < 1) throw new ApiError(404, 'Backup not found.');
    const prefix = backupPrefix(workspaceId, projectId, backup.id);
    const keys = Array.from({ length: backup.parts }, (_, part) => backupPartKey(prefix, part));
    let manifest;
    try {
      manifest = await checkedManifest(bucket, keys, projectId, workspaceId);
    } catch (error) {
      throw error instanceof RestoreFailure ? asApiError(error.code) : error;
    }
    const state: ReadState = { keys, part: 0, offset: 0, rows: 0, check: newBackupCheck() };
    const row = await insert({ id, project_id: projectId, workspace_id: workspaceId, requested_by: requestedBy, status: 'running', label: backup.created_at, backup_id: backup.id, manifest_json: JSON.stringify(manifest), state_json: JSON.stringify(state) });
    await wake(id).catch(() => undefined); // Reading the status wakes it again if this did not.
    return { restore: publicRestore(row) };
  }
  const file = input.file as { name?: unknown; bytes?: unknown } | undefined;
  const bytes = Number(file?.bytes);
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new ApiError(400, 'The file is not a complete Lastfind backup.');
  if (bytes > MAX_RESTORE_BYTES) throw new ApiError(413, 'The file is larger than 1 GB.');
  // eslint-disable-next-line no-control-regex
  const name = (typeof file?.name === 'string' ? file.name : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 120) || 'backup.ndjson';
  const key = uploadKey(workspaceId, projectId, id);
  const row = await insert({ id, project_id: projectId, workspace_id: workspaceId, requested_by: requestedBy, status: 'uploading', label: name, object_key: key, bytes });
  try {
    const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' } });
    await db().prepare('UPDATE project_restores SET upload_id=? WHERE id=?').bind(upload.uploadId, id).run();
  } catch (error) {
    await finish(row, 'failed', 'upload');
    throw error;
  }
  return { restore: publicRestore(row), partBytes: RESTORE_PART_BYTES, parts: Math.ceil(bytes / RESTORE_PART_BYTES) };
}

async function uploading(projectId: string, workspaceId: string, id: string) {
  const row = await readRow(projectId, workspaceId, id);
  if (!row || row.status !== 'uploading' || !row.object_key || !row.upload_id) throw new ApiError(404, 'Restore not found.');
  return row;
}
const partCount = (row: Row) => Math.ceil(row.bytes / RESTORE_PART_BYTES);

/** One part of the file (1-based), exactly RESTORE_PART_BYTES except the last. */
export async function uploadProjectRestorePart(projectId: string, workspaceId: string, id: string, part: number, request: Request) {
  const row = await uploading(projectId, workspaceId, id);
  const total = partCount(row);
  if (!Number.isInteger(part) || part < 1 || part > total) throw new ApiError(400, 'Invalid upload part.');
  const expected = part < total ? RESTORE_PART_BYTES : row.bytes - RESTORE_PART_BYTES * (total - 1);
  // Checked before the body is read: a larger body is refused without holding it.
  if (Number(request.headers.get('content-length')) !== expected) throw new ApiError(400, 'Invalid upload part.');
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength !== expected) throw new ApiError(400, 'Invalid upload part.');
  const uploaded = await bucketOrFail().resumeMultipartUpload(row.object_key!, row.upload_id!).uploadPart(part, body);
  await db()
    .prepare("UPDATE project_restores SET upload_parts_json=json_set(COALESCE(upload_parts_json,'{}'),'$.\"'||?||'\"',?),updated_at=? WHERE id=? AND status='uploading'")
    .bind(String(part), uploaded.etag, now(), id)
    .run();
  return { part };
}

/** The whole file is in the bucket: it is checked (manifest, footer, this project, Cloud: made by Lastfind) and starts. */
export async function completeProjectRestoreUpload(projectId: string, workspaceId: string, id: string) {
  const row = await uploading(projectId, workspaceId, id);
  const bucket = bucketOrFail();
  const etags = JSON.parse(row.upload_parts_json || '{}') as Record<string, string>;
  const parts = Array.from({ length: partCount(row) }, (_, index) => ({ partNumber: index + 1, etag: etags[String(index + 1)] }));
  if (parts.some((part) => !part.etag)) throw new ApiError(400, 'Invalid upload part.');
  try {
    await bucket.resumeMultipartUpload(row.object_key!, row.upload_id!).complete(parts);
    const keys = [row.object_key!];
    if ((await bucket.head(row.object_key!))?.size !== row.bytes) throw new RestoreFailure('upload');
    const manifest = await checkedManifest(bucket, keys, projectId, workspaceId);
    if (!ownerRestore && !(await madeByLastfind(projectId, workspaceId, manifest))) throw new RestoreFailure('not-made-here');
    const state: ReadState = { keys, part: 0, offset: 0, rows: 0, check: newBackupCheck() };
    await db()
      .prepare("UPDATE project_restores SET status='running',step='saving',upload_id=NULL,manifest_json=?,state_json=?,updated_at=? WHERE id=? AND status='uploading'")
      .bind(JSON.stringify(manifest), JSON.stringify(state), now(), id)
      .run();
  } catch (error) {
    const code = error instanceof RestoreFailure ? error.code : 'upload';
    await finish({ ...row, upload_id: null }, 'failed', code);
    throw error instanceof RestoreFailure ? asApiError(code) : error;
  }
  await wake(id).catch(() => undefined);
  return { restore: publicRestore((await readRow(projectId, workspaceId, id))!) };
}

async function save(row: Row, values: Partial<Row>) {
  Object.assign(row, values, { updated_at: now() });
  const keys = Object.keys(values);
  await db()
    .prepare(`UPDATE project_restores SET ${[...keys, 'updated_at'].map((key) => `${key}=?`).join(',')} WHERE id=? AND status='running'`)
    .bind(...keys.map((key) => row[key as keyof Row] ?? null), row.updated_at, row.id)
    .run();
}

/** Reads the file from where it stopped, checking each record and uploading the rows of each chunk into the candidate. */
async function upload(row: Row, deadline: number) {
  const bucket = bucketOrFail();
  const state = JSON.parse(row.state_json!) as ReadState;
  while (!state.check.footer && Date.now() < deadline) {
    const key = state.keys[state.part];
    if (!key) throw new RestoreFailure('invalid');
    let object = await bucket.get(key, { range: { offset: state.offset, length: READ_BYTES } });
    let bytes = object ? new Uint8Array(await object.arrayBuffer()) : new Uint8Array();
    let end = !!object && state.offset + bytes.byteLength >= object.size;
    if (object && !end && bytes.lastIndexOf(10) < 0) {
      // A record longer than the usual read: read up to the largest record there can be.
      object = await bucket.get(key, { range: { offset: state.offset, length: BACKUP_WINDOW_BYTES } });
      bytes = object ? new Uint8Array(await object.arrayBuffer()) : new Uint8Array();
      end = !!object && state.offset + bytes.byteLength >= object.size;
    }
    if (!object) throw new RestoreFailure('invalid');
    const cut = end ? bytes.byteLength : bytes.lastIndexOf(10) + 1;
    if (!cut) throw new RestoreFailure('invalid');
    let records;
    try {
      records = backupLines(bytes.subarray(0, cut));
    } catch {
      throw new RestoreFailure('invalid');
    }
    for (const record of records) {
      let chunk;
      try {
        chunk = await checkBackupRecord(state.check, record, row.project_id);
      } catch (error) {
        throw new RestoreFailure(error instanceof Error && error.message === 'This backup belongs to another project.' ? 'other-project' : 'invalid');
      }
      if (!chunk) continue;
      await restoreProjectStoreChunk(row.project_id, row.workspace_id, row.generation!, chunk.entity, chunk.rows);
      state.rows += chunk.rows.length;
    }
    if (end) Object.assign(state, { part: state.part + 1, offset: 0 });
    else state.offset += cut;
    // A turn that stops after this point reads again from here; rows already uploaded are the same rows.
    await save(row, { state_json: JSON.stringify(state), attempts: 0 });
  }
  if (!state.check.footer) return;
  if (backupFingerprint(state.check.footer) !== backupFingerprint(JSON.parse(row.manifest_json!) as BackupManifest)) throw new RestoreFailure('invalid');
  await save(row, { step: 'verifying', attempts: 0 });
}

async function advance(row: Row, deadline: number) {
  const projectId = row.project_id,
    workspaceId = row.workspace_id;
  if (row.step === 'saving') {
    if (!row.generation) {
      // The restore needs every saved change published to the project store first (the same `sync` the CLI uses).
      for (let step = 0; step < 10; step++)
        if (await syncProjectStore(projectId, workspaceId).then((result) => result.done, () => true)) break;
      const { generation } = await beginProjectStoreRestore(projectId, workspaceId, JSON.parse(row.manifest_json!) as StoreManifest);
      await save(row, { generation, attempts: 0 });
    }
    // The backup of the current state, so the owner can go back: nothing is uploaded before it is ready.
    if (!row.safety_backup_id) await save(row, { safety_backup_id: (await startProjectBackup(projectId, workspaceId, row.requested_by ?? workspaceId)).id, attempts: 0 });
    const safety = (await listProjectBackups(projectId, workspaceId)).find((backup) => backup.id === row.safety_backup_id);
    if (!safety || safety.status === 'failed') throw new RestoreFailure('backup');
    if (safety.status !== 'ready') return save(row, {});
    await save(row, { step: 'uploading', attempts: 0 });
  }
  if (row.step === 'uploading') await upload(row, deadline);
  while (row.step === 'verifying' && Date.now() < deadline) {
    if ((await commitProjectStoreRestore(projectId, workspaceId, row.generation!)).done) return finish(row, 'done', null);
    await save(row, { attempts: 0 });
  }
}

const TRANSIENT = new Set([
  'Project publication is already running.',
  'Finish pending publications before restoring the project.',
  'Finish pending publications before exporting the project.',
  'Project analytics are temporarily unavailable.',
]);
function failureOf(error: unknown): RestoreError | null {
  if (error instanceof RestoreFailure) return error.code;
  if (error instanceof ApiError) {
    if (TRANSIENT.has(error.message) || error.status === 503) return null;
    if (error.message.startsWith('Restore checksum differs')) return 'invalid';
    if (error.message.startsWith('Project changed') || error.message.startsWith('Project targets changed')) return 'changed';
    if (error.message.startsWith('The snapshot does not belong')) return 'other-project';
    return 'failed';
  }
  return null; // An unexpected failure (a network blip, a timeout) is tried again, a bounded number of times.
}

/** One turn of a running restore (the driver's alarm). True while it has more to do. */
export async function restoreStep(id: string) {
  const row = await db().prepare('SELECT * FROM project_restores WHERE id=?').bind(id).first<Row>();
  if (!row || row.status !== 'running') return false;
  try {
    await advance(row, Date.now() + STEP_MS);
  } catch (error) {
    const code = failureOf(error);
    if (code || row.attempts + 1 >= MAX_ATTEMPTS) await finish(row, 'failed', code ?? 'failed');
    else await save(row, { attempts: row.attempts + 1 });
    if (!code) console.error(`Project restore step failed (${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}).`);
  }
  return row.status === 'running';
}

/** Whether a restore of the project is uploading or running (the storage CLI's own restore waits for it). */
export async function projectRestoreActive(projectId: string, workspaceId: string) {
  return !!(await db()
    .prepare("SELECT 1 FROM project_restores WHERE project_id=? AND workspace_id=? AND status IN ('uploading','running') LIMIT 1")
    .bind(projectId, workspaceId)
    .first());
}
