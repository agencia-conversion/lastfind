// Background project backups (Settings > Project data): the owner asks for one, the project store's alarm writes it to
// the private bucket (worker/project-store.ts, backupStep) and this module keeps the rows the app lists, downloads and
// expires. Both editions: the bucket is the RAW_RESPONSES binding every installation already has.
import { db, now } from './env';
import { ApiError } from './http';
import { rawResponsesBucket } from './raw-responses';
import { projectStoreRpc } from './project-store-transport';
import { ensureProjectStore, syncProjectStore } from './project-store';
import { agentBackupLines } from './agent-backup';
import {
  BACKUPS_KEPT,
  BACKUP_DAYS,
  agentBackupKey,
  backupFingerprint,
  backupPartKey,
  backupPrefix,
  type BackupManifest,
} from '@/lib/project-backups';

export type ProjectBackup = {
  id: string;
  status: 'running' | 'ready' | 'failed';
  bytes: number;
  created_at: string;
  finished_at: string | null;
};
type Row = Omit<ProjectBackup, 'status'> & {
  status: ProjectBackup['status'] | 'expired';
  project_id: string;
  workspace_id: string;
  generation: string;
  parts: number;
  fingerprint: string | null;
  error: string | null;
  revision: number | null;
};
type StoreBackup = { status: 'running' | 'ready' | 'failed' | 'unknown'; parts?: number; bytes?: number; manifest?: BackupManifest | null; error?: string | null };
/** A backup still running after this long is reported as failed (its store lost the job), so a new one can start. */
const STALE_MS = 2 * 3600000;

const publicBackup = (row: Row): ProjectBackup => ({ id: row.id, status: row.status as ProjectBackup['status'], bytes: row.bytes, created_at: row.created_at, finished_at: row.finished_at });
/** A second request for a backup of the same unchanged data within this time gets the first one back. */
const REPEAT_MS = 10 * 60000;

async function deleteParts(row: Row) {
  const bucket = rawResponsesBucket();
  if (!bucket) return;
  const prefix = backupPrefix(row.workspace_id, row.project_id, row.id);
  for (let cursor: string | undefined; ; ) {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) await bucket.delete(page.objects.map((object) => object.key));
    if (!page.truncated) return;
    cursor = page.cursor;
  }
}

/**
 * The project's backups, newest first. Running ones are brought up to date with their store first; then the newest
 * ready ones (BACKUPS_KEPT, within BACKUP_DAYS) and a failure newer than all of them stay, and the rest expire: their
 * parts are deleted, the row keeps its fingerprint.
 */
export async function listProjectBackups(projectId: string, workspaceId: string): Promise<ProjectBackup[]> {
  const rows = (
    await db()
      .prepare("SELECT * FROM project_backups WHERE project_id=? AND workspace_id=? AND status!='expired' ORDER BY created_at DESC,id")
      .bind(projectId, workspaceId)
      .all<Row>()
  ).results;
  for (const row of rows.filter((item) => item.status === 'running')) {
    let state: StoreBackup;
    try {
      state = await projectStoreRpc<StoreBackup>({
        scope: { ownerId: workspaceId, projectId, generation: row.generation },
        action: 'backup-status',
        id: row.id,
      });
    } catch {
      continue; // The store answers on the next read.
    }
    if (state.status === 'running' && Date.parse(row.created_at) > Date.now() - STALE_MS) continue;
    const ready = state.status === 'ready' && !!state.manifest;
    Object.assign(row, {
      status: ready ? 'ready' : 'failed',
      parts: Number(state.parts) || 0,
      bytes: Number(state.bytes) || 0,
      fingerprint: ready ? backupFingerprint(state.manifest!) : null,
      error: ready ? null : String(state.error || (state.status === 'running' ? 'timeout' : 'lost')).slice(0, 300),
      finished_at: now(),
    });
    await db()
      .prepare("UPDATE project_backups SET status=?,parts=?,bytes=?,fingerprint=?,error=?,finished_at=? WHERE id=? AND status='running'")
      .bind(row.status, row.parts, row.bytes, row.fingerprint, row.error, row.finished_at, row.id)
      .run();
  }
  // A backup a restore is reading right now stays, whatever its age (lib/server/project-restores.ts).
  const reading = new Set(
    (
      await db()
        .prepare("SELECT backup_id FROM project_restores WHERE project_id=? AND workspace_id=? AND status='running' AND backup_id IS NOT NULL")
        .bind(projectId, workspaceId)
        .all<{ backup_id: string }>()
    ).results.map((row) => row.backup_id),
  );
  const cutoff = Date.now() - BACKUP_DAYS * 86400000;
  const firstReady = rows.findIndex((row) => row.status === 'ready'),
    lastFailure = rows.findIndex((row) => row.status === 'failed');
  let ready = 0;
  const visible: ProjectBackup[] = [];
  for (const [index, row] of rows.entries()) {
    const keep =
      row.status === 'running' ||
      reading.has(row.id) ||
      (Date.parse(row.created_at) >= cutoff &&
        (row.status === 'ready'
          ? ++ready <= BACKUPS_KEPT
          : index === lastFailure && (firstReady < 0 || lastFailure < firstReady)));
    if (keep) {
      visible.push(publicBackup(row));
      continue;
    }
    await deleteParts(row);
    await db().prepare("UPDATE project_backups SET status='expired' WHERE id=?").bind(row.id).run();
  }
  return visible;
}

/**
 * Starts a backup of the project's published data; the store's alarm does the work. Idempotent: while one is being made,
 * or when the newest ready one (made in the last minutes) holds this same publication, that backup is the answer, so a
 * repeated click or request never makes a second file. The database keeps at most one running per project.
 */
export async function startProjectBackup(projectId: string, workspaceId: string, requestedBy: string): Promise<{ id: string; backup: ProjectBackup }> {
  const running = (await listProjectBackups(projectId, workspaceId)).find((row) => row.status === 'running');
  if (running) return { id: running.id, backup: running };
  if (!rawResponsesBucket()) throw new ApiError(503, 'Project analytics are temporarily unavailable.');
  // The backup holds what is published to the project store: publish what is pending first, in bounded steps.
  for (let step = 0; step < 10; step++)
    try {
      if ((await syncProjectStore(projectId, workspaceId)).done) break;
    } catch {
      break; // Another publication holds the lease; the check below decides.
    }
  const registry = await ensureProjectStore(projectId, workspaceId);
  if (registry.source_revision !== registry.applied_revision)
    throw new ApiError(409, 'Finish pending publications before exporting the project.');
  const same = await db()
    .prepare("SELECT * FROM project_backups WHERE project_id=? AND workspace_id=? AND status IN ('running','ready') AND generation=? AND revision=? AND created_at>? ORDER BY created_at DESC LIMIT 1")
    .bind(projectId, workspaceId, registry.generation, registry.source_revision, new Date(Date.now() - REPEAT_MS).toISOString())
    .first<Row>();
  if (same) return { id: same.id, backup: publicBackup(same) };
  const id = crypto.randomUUID(),
    createdAt = now();
  try {
    await db()
      .prepare("INSERT INTO project_backups(id,project_id,workspace_id,generation,revision,requested_by,status,created_at) VALUES(?,?,?,?,?,?,'running',?)")
      .bind(id, projectId, workspaceId, registry.generation, registry.source_revision, requestedBy, createdAt)
      .run();
  } catch (error) {
    // Another request started one a moment ago (idx_project_backups_running): that one is the answer.
    const other = error instanceof Error && error.message.includes('UNIQUE')
      ? await db().prepare("SELECT * FROM project_backups WHERE project_id=? AND workspace_id=? AND status='running'").bind(projectId, workspaceId).first<Row>()
      : null;
    if (other) return { id: other.id, backup: publicBackup(other) };
    throw error;
  }
  try {
    // The project's agent conversations, snapshotted now for the store to copy in before its footer (worker/project-store.ts).
    // Only the requesting account's own conversations: the owner downloads this file, and others' chats are private.
    const conversations = await agentBackupLines(workspaceId, projectId, requestedBy);
    if (conversations)
      await rawResponsesBucket()!.put(agentBackupKey(backupPrefix(workspaceId, projectId, id)), conversations, {
        httpMetadata: { contentType: 'application/x-ndjson; charset=utf-8' },
      });
    await projectStoreRpc({
      scope: { ownerId: workspaceId, projectId, generation: registry.generation },
      action: 'backup-start',
      id,
      revision: registry.source_revision,
    });
  } catch (error) {
    await db()
      .prepare("UPDATE project_backups SET status='failed',error='start',finished_at=? WHERE id=?")
      .bind(now(), id)
      .run();
    throw error;
  }
  return { id, backup: { id, status: 'running', bytes: 0, created_at: createdAt, finished_at: null } };
}

/** Streams a ready backup's parts as one NDJSON file. */
export async function downloadProjectBackup(projectId: string, workspaceId: string, id: string) {
  const row = await db()
    .prepare("SELECT * FROM project_backups WHERE id=? AND project_id=? AND workspace_id=? AND status='ready'")
    .bind(id, projectId, workspaceId)
    .first<Row>();
  if (!row) throw new ApiError(404, 'Backup not found.');
  const bucket = rawResponsesBucket();
  if (!bucket) throw new ApiError(503, 'Project analytics are temporarily unavailable.');
  const prefix = backupPrefix(workspaceId, projectId, id);
  let part = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (part >= row.parts) return controller.close();
      const object = await bucket.get(backupPartKey(prefix, part++));
      if (!object) return controller.error(new Error('A backup part is missing.'));
      controller.enqueue(new Uint8Array(await object.arrayBuffer()));
    },
  });
  const day = row.created_at.slice(0, 10);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Length': String(row.bytes),
      'Content-Disposition': `attachment; filename="lastfind-project-${projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${day}.ndjson"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

/** Whether Lastfind itself made a backup of this project with exactly this content (any age, also expired). */
export async function madeByLastfind(projectId: string, workspaceId: string, manifest: unknown) {
  if (!manifest || typeof manifest !== 'object') return false;
  const known = await db()
    .prepare("SELECT 1 FROM project_backups WHERE project_id=? AND workspace_id=? AND fingerprint=? LIMIT 1")
    .bind(projectId, workspaceId, backupFingerprint(manifest as BackupManifest))
    .first();
  return !!known;
}
