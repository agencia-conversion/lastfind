import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  extendStoreDigest,
  type StoreRow,
} from '../lib/project-store-contract.ts';
import {
  inspectBackup,
  inspectBackupFile,
  saveBackup,
} from '../../../scripts/project-storage-backup.mjs';

const header = {
  schema: 1,
  projectId: 'project-one',
  ownerId: 'owner-one',
  generation: 'generation-one',
  revision: 12,
};
const prompts: StoreRow[] = [
  {
    id: 'prompt-1',
    project_id: header.projectId,
    text: 'Visibilidade em São Paulo → 東京',
    engine: 'chat_gpt',
  },
];
const runs: StoreRow[] = [
  {
    id: 'run-1',
    project_id: header.projectId,
    owner_id: header.ownerId,
    answer: 'Olá, análise ☀️',
    raw_response_key: 'private/archive.json',
    raw_response_sha256: 'a'.repeat(64),
  },
];

async function backup(promptRows = prompts, runRows = runs) {
  const manifest = {
    ...header,
    counts: { prompts: promptRows.length, runs: runRows.length },
    digests: {
      prompts: await extendStoreDigest('', 'prompts', promptRows),
      runs: await extendStoreDigest('', 'runs', runRows),
    },
  };
  const records = [
    { type: 'manifest', manifest: header },
    { type: 'chunk', entity: 'prompts', rows: promptRows },
    { type: 'chunk', entity: 'runs', rows: runRows },
    { type: 'footer', manifest },
  ];
  return {
    manifest,
    records,
    bytes: Buffer.from(
      records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    ),
  };
}
function stream(bytes: Uint8Array, size = 7) {
  function* chunks() {
    for (let offset = 0; offset < bytes.length; offset += size)
      yield bytes.subarray(offset, offset + size);
  }
  return Readable.from(chunks());
}

void test('project export preserves UTF-8 bytes, canonical checksums and exact restore chunks', async () => {
  const { bytes, manifest } = await backup();
  const chunks: { entity: string; rows: StoreRow[] }[] = [];
  const actual = await inspectBackup(stream(bytes, 1), {
    project: header.projectId,
    onChunk: (entity: string, rows: StoreRow[]) =>
      chunks.push({ entity, rows }),
  });
  assert.deepEqual(actual, manifest);
  assert.deepEqual(chunks, [
    { entity: 'prompts', rows: prompts },
    { entity: 'runs', rows: runs },
  ]);
  const empty = await backup([], []);
  assert.deepEqual(await inspectBackup(stream(empty.bytes)), empty.manifest);
});

void test('project backup is private and atomic; interrupted exports and existing destinations remain untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lastfind-backup-'));
  try {
    const { bytes, manifest } = await backup();
    const path = join(directory, 'project.ndjson');
    assert.deepEqual(
      await saveBackup(stream(bytes), path, { project: header.projectId }),
      manifest,
    );
    assert.deepEqual(await readFile(path), bytes);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(
      await inspectBackupFile(path, { project: header.projectId }),
      manifest,
    );
    await assert.rejects(saveBackup(stream(bytes), path), { code: 'EEXIST' });
    const linked = join(directory, 'linked.ndjson');
    await symlink(path, linked);
    await assert.rejects(saveBackup(stream(bytes), linked), { code: 'EEXIST' });
    const incomplete = join(directory, 'incomplete.ndjson');
    await assert.rejects(
      saveBackup(stream(bytes.subarray(0, 120)), incomplete),
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      'linked.ndjson',
      'project.ndjson',
    ]);
    assert.deepEqual(await readFile(path), bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('restore rejects tampering, incomplete manifests and owner/project mixing before commit', async () => {
  const { records, bytes } = await backup();
  const encode = (value: unknown) => Readable.from([JSON.stringify(value)]);
  const changed = bytes.toString().replace('Olá, análise', 'Changed answer');
  await assert.rejects(inspectBackup(Readable.from([changed])), /checksum/);
  await assert.rejects(
    inspectBackup(stream(bytes), { project: 'project-other' }),
    /another project/,
  );
  await assert.rejects(
    inspectBackup(
      Readable.from([
        records
          .slice(0, -1)
          .map((record) => JSON.stringify(record))
          .join('\n'),
      ]),
    ),
    /incomplete/,
  );
  await assert.rejects(
    inspectBackup(
      encode({ type: 'manifest', manifest: { ...header, revision: -1 } }),
    ),
    /identity/,
  );
  for (const [name, value] of [
    ['owner_id', 'owner-other'],
    ['project_id', 'project-other'],
  ] as const) {
    const mixed = await backup(prompts, [{ ...runs[0], [name]: value }]);
    await assert.rejects(
      inspectBackup(stream(mixed.bytes)),
      /another owner\/project/,
    );
  }
  const unordered = await backup([
    { ...prompts[0], id: 'prompt-2' },
    prompts[0],
  ]);
  await assert.rejects(inspectBackup(stream(unordered.bytes)), /unordered/);
  const tooMany = await backup(
    Array.from({ length: 101 }, (_, index) => ({
      ...prompts[0],
      id: `p-${String(index).padStart(3, '0')}`,
    })),
  );
  await assert.rejects(
    inspectBackup(stream(tooMany.bytes, 1024)),
    /Invalid project backup chunk/,
  );
  await assert.rejects(
    inspectBackup(Readable.from([bytes, JSON.stringify({ unexpected: true })])),
    /after.*footer/,
  );
});

void test('backup parser rejects malformed UTF-8 and bounds an unfinished NDJSON line', async () => {
  await assert.rejects(
    inspectBackup(Readable.from([Buffer.from([0xc3, 0x28])])),
    /encoded data/,
  );
  await assert.rejects(
    inspectBackup(Readable.from([' '.repeat(8 * 1024 * 1024 + 1)])),
    /too large/,
  );
});

void test('schema 4 backup preserves unit subscriptions and Semantic rows while legacy digests remain stable', async () => {
  const unitRows = [{ ...prompts[0], unit_id: 'prompt-1', subscribed: 1, engines_override_json: '["chat_gpt","gemini"]' }];
  assert.equal(await extendStoreDigest('', 'prompts', prompts, 3), await extendStoreDigest('', 'prompts', unitRows, 3));
  assert.notEqual(await extendStoreDigest('', 'prompts', prompts, 4), await extendStoreDigest('', 'prompts', unitRows, 4));
  const manifest = { ...header, schema: 4, analysisRevision: null, analysisMutationRevision: 0 };
  const footer = { ...manifest, counts: { prompts: 1, runs: 1, semantic_evaluations: 0 }, digests: { prompts: await extendStoreDigest('', 'prompts', unitRows, 4), runs: await extendStoreDigest('', 'runs', runs, 4), semantic_evaluations: await extendStoreDigest('', 'semantic_evaluations', [], 4) } };
  const records = [{ type: 'manifest', manifest }, { type: 'chunk', entity: 'prompts', rows: unitRows }, { type: 'chunk', entity: 'runs', rows: runs }, { type: 'chunk', entity: 'semantic_evaluations', rows: [] }, { type: 'footer', manifest: footer }];
  const bytes = records.map(record => JSON.stringify(record)).join('\n') + '\n';
  assert.deepEqual(await inspectBackup(Readable.from([bytes])), footer);
  await assert.rejects(inspectBackup(Readable.from([bytes.replace('"subscribed":1','"subscribed":0')])), /checksum/);
});
