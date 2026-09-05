import { createReadStream } from 'node:fs';
import { open, link, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  canonicalStoreRow,
  extendStoreDigest,
} from '../packages/core/lib/project-store-contract.ts';

const MAX_LINE = 8 * 1024 * 1024;
const entities = ['prompts', 'runs'];
function identity(manifest) {
  if (
    !manifest ||
    manifest.schema !== 1 ||
    !['projectId', 'ownerId', 'generation'].every(
      (key) =>
        typeof manifest[key] === 'string' &&
        manifest[key].length > 0 &&
        manifest[key].length <= 200,
    ) ||
    !Number.isSafeInteger(manifest.revision) ||
    manifest.revision < 0
  )
    throw new Error('Invalid project backup identity.');
  return JSON.stringify([
    manifest.schema,
    manifest.projectId,
    manifest.ownerId,
    manifest.generation,
    manifest.revision,
  ]);
}

/** Bounded parser: an incomplete or malformed stream cannot become a backup. */
async function* records(stream, onBytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  for await (const chunk of stream) {
    const bytes =
      typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    if (onBytes) await onBytes(bytes);
    pending += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).replace(/\r$/, '');
      pending = pending.slice(end + 1);
      if (Buffer.byteLength(line) > MAX_LINE)
        throw new Error('A project backup record is too large.');
      if (line.trim()) yield JSON.parse(line);
    }
    if (Buffer.byteLength(pending) > MAX_LINE)
      throw new Error('A project backup record is too large.');
  }
  pending += decoder.decode();
  if (pending.trim()) yield JSON.parse(pending);
}

export async function inspectBackup(
  stream,
  { project, onBytes, onChunk } = {},
) {
  let header,
    footer,
    current = 'prompts';
  const counts = { prompts: 0, runs: 0 },
    digests = { prompts: '', runs: '' },
    lastIds = { prompts: '', runs: '' },
    seen = new Set();
  for await (const record of records(stream, onBytes)) {
    if (footer)
      throw new Error('Unexpected data after the project backup footer.');
    if (!header) {
      if (record.type !== 'manifest')
        throw new Error('The project backup manifest must be first.');
      identity(record.manifest);
      if (project && record.manifest.projectId !== project)
        throw new Error('This backup belongs to another project.');
      header = record.manifest;
      continue;
    }
    if (record.type === 'chunk') {
      const { entity, rows } = record;
      if (
        !entities.includes(entity) ||
        !Array.isArray(rows) ||
        rows.length > 100 ||
        (current === 'runs' && entity !== 'runs')
      )
        throw new Error('Invalid project backup chunk.');
      current = entity;
      seen.add(entity);
      for (const row of rows) {
        if (
          !row ||
          typeof row.id !== 'string' ||
          row.id <= lastIds[entity] ||
          row.project_id !== header.projectId ||
          (entity === 'runs' && row.owner_id !== header.ownerId)
        )
          throw new Error(
            'Project backup rows are unordered or belong to another owner/project.',
          );
        canonicalStoreRow(entity, row);
        lastIds[entity] = row.id;
      }
      counts[entity] += rows.length;
      digests[entity] = await extendStoreDigest(digests[entity], entity, rows);
      if (onChunk) await onChunk(entity, rows);
    } else if (record.type === 'footer') {
      const manifest = record.manifest;
      if (
        identity(manifest) !== identity(header) ||
        entities.some(
          (entity) =>
            !seen.has(entity) ||
            manifest.counts?.[entity] !== counts[entity] ||
            manifest.digests?.[entity] !== digests[entity],
        )
      )
        throw new Error(
          'The project backup checksum or row count does not match its footer.',
        );
      footer = manifest;
    } else throw new Error('Unknown project backup record.');
  }
  if (!footer)
    throw new Error(
      'The project backup is incomplete: no verified footer was received.',
    );
  return footer;
}

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
