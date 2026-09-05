import test from 'node:test';
import assert from 'node:assert/strict';
import { configureProjectStorage } from '../../../scripts/project-storage-config.mjs';
import {
  assertRawStorageAvailable,
  provisionRawStorage,
  rawBucketName,
} from '../../../scripts/raw-storage.mjs';
const database = {
  binding: 'DB',
  database_name: 'lastfind-test',
  database_id: '12345678-1234-4000-8000-123456789abc',
};
const installation = {
  account_id: 'account-test',
  name: 'lastfind-test',
  vars: { OWNER_EMAIL: 'owner@example.com' },
  d1_databases: [database],
};

void test('personal deploy entrypoint requires owner authentication before provisioning resources', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = mkdtempSync(path.join(tmpdir(), 'lastfind-personal-gate-'));
  try {
    for (const vars of [{}, { OWNER_EMAIL: 'operator@example.test' }]) {
      writeFileSync(
        path.join(directory, 'wrangler.selfhost.json'),
        JSON.stringify({ ...installation, vars }),
      );
      const result = spawnSync(
        process.execPath,
        [path.resolve('scripts/deploy-selfhost.mjs')],
        { cwd: directory, encoding: 'utf8' },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Owner authentication secrets are missing/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('new installation gets a SQLite namespace without altering the D1 binding', () => {
  const configured = configureProjectStorage(installation);
  assert.deepEqual(configured.d1_databases, [database]);
  assert.equal(configured.vars.OWNER_EMAIL, 'owner@example.com');
  assert.deepEqual(configured.durable_objects.bindings, [
    { name: 'PROJECT_STORES', class_name: 'ProjectStore' },
  ]);
  assert.deepEqual(configured.exports.ProjectStore, {
    type: 'durable-object',
    storage: 'sqlite',
  });
  assert.equal('migrations' in configured, false);
  assert.deepEqual(configureProjectStorage(configured), configured);
});

void test('namespace name collisions and incompatible existing storage fail closed', () => {
  assert.throws(
    () =>
      configureProjectStorage({
        ...installation,
        durable_objects: {
          bindings: [{ name: 'PROJECT_STORES', class_name: 'OtherStore' }],
        },
      }),
    /Refusing/,
  );
  assert.throws(
    () =>
      configureProjectStorage({
        ...installation,
        durable_objects: {
          bindings: [
            {
              name: 'PROJECT_STORES',
              class_name: 'ProjectStore',
              script_name: 'other-worker',
            },
          ],
        },
      }),
    /Refusing/,
  );
  assert.throws(
    () =>
      configureProjectStorage({
        ...installation,
        exports: {
          ProjectStore: { type: 'durable-object', storage: 'legacy-kv' },
        },
      }),
    /SQLite/,
  );
  assert.throws(
    () =>
      configureProjectStorage({
        ...installation,
        migrations: [{ tag: 'v1' }],
        exports: { Other: { type: 'durable-object', storage: 'sqlite' } },
      }),
    /Review its namespace identity/,
  );
});

void test('R2 preflight fails before provisioning anything when the account has not enabled archives', () => {
  const commands: string[][] = [];
  assert.throws(
    () =>
      assertRawStorageAvailable(
        { account_id: installation.account_id },
        {
          runCommand: (args: string[]) => {
            commands.push(args);
            throw Object.assign(new Error('inactive'), {
              output: 'R2 inactive [code: 10042]',
            });
          },
        },
      ),
    /Activate R2 in the Cloudflare dashboard/,
  );
  assert.deepEqual(commands, [['r2', 'bucket', 'list']]);
});

void test('raw bucket provisioning confirms creation, resumes idempotently and preserves other bindings', () => {
  const commands: string[][] = [];
  const bucket = rawBucketName(installation);
  let exists = false;
  const runCommand = (
    args: string[],
    options: { env?: Record<string, string> } = {},
  ) => {
    commands.push(args);
    assert.equal(options.env?.CLOUDFLARE_ACCOUNT_ID, 'account-test');
    if (args[2] === 'create') {
      exists = true;
      return '';
    }
    return exists
      ? `name: ${bucket}\ncreation_date: today\n`
      : 'No buckets found.';
  };
  const config = provisionRawStorage(
    {
      ...installation,
      r2_buckets: [{ binding: 'EXTRA', bucket_name: 'unrelated-preserved' }],
    },
    { runCommand },
  );
  assert.deepEqual(config.r2_buckets, [
    { binding: 'EXTRA', bucket_name: 'unrelated-preserved' },
    { binding: 'RAW_RESPONSES', bucket_name: bucket },
  ]);
  const repeated = provisionRawStorage(config, { runCommand });
  assert.deepEqual(repeated, config);
  assert.equal(commands.filter((args) => args[2] === 'create').length, 1);
  assert.equal(
    commands.some((args) => args.includes('public') || args.includes('delete')),
    false,
  );
});

void test('configured raw archives are verified and never silently replaced or disabled', () => {
  const config = {
    ...installation,
    r2_buckets: [
      {
        binding: 'RAW_RESPONSES',
        bucket_name: 'preserved-original',
        jurisdiction: 'eu',
      },
    ],
  };
  const verified = provisionRawStorage(config, {
    runCommand: (args: string[]) => {
      assert.deepEqual(args, ['r2', 'bucket', 'list', '--jurisdiction', 'eu']);
      return 'name: preserved-original\n';
    },
  });
  assert.equal(verified, config);
  assert.throws(
    () => provisionRawStorage(config, { runCommand: () => '' }),
    /Refusing to replace/,
  );
  assert.throws(
    () =>
      provisionRawStorage(config, {
        runCommand: () => {
          throw Object.assign(new Error('inactive'), { output: '10042' });
        },
      }),
    /bindings were preserved/,
  );
  assert.throws(
    () =>
      provisionRawStorage(installation, {
        runCommand: () => {
          throw Object.assign(new Error('unauthorized'), { output: '10000' });
        },
      }),
    /unauthorized/,
  );
});

void test('bucket names remain within R2 limits and unconfirmed creates do not produce a binding', () => {
  const name = rawBucketName({ ...installation, name: 'a'.repeat(51) });
  assert.equal(name.length, 63);
  assert.match(name, /-raw-12345678$/);
  assert.throws(
    () =>
      provisionRawStorage(installation, {
        runCommand: () => 'No buckets found.',
      }),
    /creation was not confirmed/,
  );
  assert.throws(
    () => rawBucketName({ ...installation, d1_databases: [] }),
    /Create the installation database/,
  );
});

void test('private installation checkpoints are atomic and tighten existing file permissions', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { writePrivateJson } =
    await import('../../../scripts/private-files.mjs');
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lastfind-checkpoint-'),
  );
  const file = path.join(directory, 'config.json');
  try {
    fs.writeFileSync(file, '{"old":true}', { mode: 0o644 });
    writePrivateJson(file, { database_id: database.database_id });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
      database_id: database.database_id,
    });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(directory), ['config.json']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
