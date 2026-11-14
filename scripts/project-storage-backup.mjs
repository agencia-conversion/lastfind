import { createReadStream } from 'node:fs';
import { open, link, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectBackup } from '../packages/core/lib/project-backups.ts';

export { inspectBackup };
export async function saveBackup(stream, path, { project } = {}) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    const manifest = await inspectBackup(stream, {
      project,
      onBytes: (bytes) => file.writeFile(bytes),
    });
    await file.sync();
    await file.close();
    // Hard-link creation is atomic and fails if the chosen destination exists;
    // never overwrite an earlier checkpoint or follow a destination symlink.
    await link(temporary, path);
    return manifest;
  } finally {
    await file.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}
export async function inspectBackupFile(path, options = {}) {
  return inspectBackup(createReadStream(path), options);
}
