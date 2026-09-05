import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  archiveRawResponse,
  captureRawResponse,
  rawArchiveKey,
  validRawArchiveObject,
  type RawArchiveBucket,
} from '../lib/raw-responses.ts';

const scope = {
  ownerId: 'sites:owner/a',
  projectId: 'project-1',
  runId: 'run-1',
  engine: 'chat_gpt',
  taskId: 'task-1',
};
const endpoint =
  'https://api.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_get/advanced/task-1';
const receivedAt = '2026-09-05T07:05:00.000Z';
const body =
  '{\n  "version": "1.0", "status_code": 20000, "cost": 0,\n  "tasks": [{"id":"task-1","status_code":20000,"result":[{"answer":"Original — café", "additional_provider_field":true}]}]\n}\n';
const payload = captureRawResponse(body, endpoint, receivedAt, scope.taskId)!;

void test('archives the exact single-task JSON and checksum, without adding request headers', async () => {
  let writes = 0;
  const expectedHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const bucket: RawArchiveBucket = {
    async put(key, value, options) {
      writes++;
      assert.equal(value, body);
      assert.equal(key, rawArchiveKey(scope, expectedHash));
      assert.equal(options.sha256, expectedHash);
      assert.equal(options.customMetadata.owner, scope.ownerId);
      assert.equal(options.customMetadata.run, scope.runId);
      assert.equal(options.customMetadata.task, scope.taskId);
      assert.equal(options.customMetadata.received_at, receivedAt);
      assert.equal(options.httpMetadata.cacheControl, 'private, no-store');
      assert.equal('Authorization' in options.customMetadata, false);
      return { key };
    },
  };
  const archive = await archiveRawResponse(bucket, scope, payload);
  assert.equal(writes, 1);
  assert.equal(archive.status, 'archived');
  assert.equal(archive.sha256, expectedHash);
  assert.equal(archive.bytes, Buffer.byteLength(body));
  assert.ok(archive.stored_at);
});

void test('multi-task responses, different tasks and malformed envelopes can never be archived', async () => {
  let writes = 0;
  const bucket: RawArchiveBucket = {
    async put() {
      writes++;
      return {};
    },
  };
  const multi = JSON.stringify({
    status_code: 20000,
    tasks: [{ id: 'task-1' }, { id: 'another-tenant-task' }],
  });
  assert.equal(
    captureRawResponse(multi, endpoint, receivedAt, scope.taskId),
    undefined,
  );
  assert.equal(
    captureRawResponse(body, endpoint, receivedAt, 'wrong-task'),
    undefined,
  );
  assert.equal(
    captureRawResponse(
      body,
      'https://another.example/',
      receivedAt,
      scope.taskId,
    ),
    undefined,
  );
  assert.equal(
    captureRawResponse('not JSON', endpoint, receivedAt, scope.taskId),
    undefined,
  );
  const rejected = await archiveRawResponse(bucket, scope, {
    ...payload,
    body: multi,
  });
  const wrongScope = await archiveRawResponse(
    bucket,
    { ...scope, taskId: 'different-task' },
    payload,
  );
  assert.equal(rejected.status, 'failed');
  assert.equal(wrongScope.status, 'failed');
  assert.equal(writes, 0);
});

void test('disabled or failed object storage never reports success or leaks an error payload', async () => {
  const disabled = await archiveRawResponse(undefined, scope, payload);
  assert.equal(disabled.status, 'not_configured');
  assert.equal(disabled.key, null);
  const failed = await archiveRawResponse(
    {
      async put() {
        throw new Error('Internal secret credential must not be exposed');
      },
    },
    scope,
    payload,
  );
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'storage_write_failed');
  assert.equal(failed.key, null);
  assert.equal(JSON.stringify(failed).includes('credential'), false);
  const notWritten = await archiveRawResponse(
    {
      async put() {
        return null;
      },
    },
    scope,
    payload,
  );
  assert.equal(notWritten.status, 'failed');
});

void test('download provenance refuses cross-owner pointers, mismatched bytes and altered checksums', async () => {
  const hash = createHash('sha256').update(body).digest('hex');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(body),
  );
  const expected = {
    key: rawArchiveKey(scope, hash),
    sha256: hash,
    bytes: Buffer.byteLength(body),
  };
  const object = {
    key: expected.key,
    size: expected.bytes,
    checksums: { sha256: digest },
    customMetadata: {
      owner: scope.ownerId,
      project: scope.projectId,
      run: scope.runId,
      sha256: hash,
    },
  };
  assert.equal(validRawArchiveObject(scope, expected, object), true);
  assert.equal(
    validRawArchiveObject(
      { ...scope, ownerId: 'different-owner' },
      expected,
      object,
    ),
    false,
  );
  assert.equal(
    validRawArchiveObject(
      { ...scope, projectId: 'different-project' },
      expected,
      object,
    ),
    false,
  );
  assert.equal(
    validRawArchiveObject(scope, expected, {
      ...object,
      size: object.size + 1,
    }),
    false,
  );
  assert.equal(
    validRawArchiveObject(scope, expected, {
      ...object,
      customMetadata: { ...object.customMetadata, owner: 'different-owner' },
    }),
    false,
  );
  assert.equal(
    validRawArchiveObject(scope, expected, { ...object, checksums: {} }),
    false,
  );
  assert.equal(
    validRawArchiveObject(scope, expected, {
      ...object,
      checksums: { sha256: new ArrayBuffer(32) },
    }),
    false,
  );
  assert.notEqual(
    rawArchiveKey(scope, hash),
    rawArchiveKey({ ...scope, ownerId: 'sites:owner%2Fa' }, hash),
  );
});

void test('an unresponsive archive write times out without blocking the collected answer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let started!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = archiveRawResponse(
      {
        put() {
          started();
          return new Promise(() => {});
        },
      },
      scope,
      payload,
    );
    await writing;
    t.mock.timers.tick(8000);
    const result = await pending;
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'storage_write_failed');
    assert.equal(result.key, null);
  } finally {
    t.mock.timers.reset();
  }
});
