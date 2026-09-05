import test from 'node:test';
import assert from 'node:assert/strict';
import { JsonBodyError, readBoundedJson } from '../lib/bounded-json.ts';
function streamRequest(stream: ReadableStream<Uint8Array>, length?: string) {
  return new Request(
    'https://instance.example.test/api/projects/test/storage',
    {
      method: 'POST',
      body: stream,
      duplex: 'half',
      headers: length ? { 'content-length': length } : {},
    } as RequestInit & { duplex: 'half' },
  );
}
void test('Oversized declared content length is rejected and cancelled before buffering', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    readBoundedJson(
      streamRequest(stream, String(13 * 1024 * 1024)),
      8 * 1024 * 1024,
    ),
    (error) => error instanceof JsonBodyError && error.kind === 'too_large',
  );
  assert.equal(cancelled, true);
});
void test('Unknown or understated content length is counted and cancelled at the byte limit', async () => {
  for (const length of [undefined, '1']) {
    let produced = 0,
      cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced++;
        controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
        if (produced === 13) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    await assert.rejects(
      readBoundedJson(streamRequest(stream, length), 8 * 1024 * 1024),
      (error) => error instanceof JsonBodyError && error.kind === 'too_large',
    );
    assert.equal(cancelled, true);
    assert.ok(
      produced < 13,
      'An oversized request must stop before consuming the full input',
    );
  }
});
void test('Bounded parser accepts exact-limit UTF-8 across chunks and rejects malformed JSON or UTF-8', async () => {
  const bytes = new TextEncoder().encode('{"name":"São Paulo"}');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  assert.deepEqual(await readBoundedJson(streamRequest(stream), bytes.length), {
    name: 'São Paulo',
  });
  for (const raw of ['{invalid', '', '[1,']) {
    await assert.rejects(
      readBoundedJson(
        new Request('https://instance.example.test/', {
          method: 'POST',
          body: raw,
        }),
        1024,
      ),
      (error) =>
        error instanceof JsonBodyError && error.kind === 'invalid_json',
    );
  }
  const invalid = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(0xff));
      controller.close();
    },
  });
  await assert.rejects(
    readBoundedJson(streamRequest(invalid), 1024),
    (error) => error instanceof JsonBodyError && error.kind === 'invalid_json',
  );
});
