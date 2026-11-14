import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson } from '../lib/client.ts';

void test('client fallback errors follow the selected locale, preserve API messages and keep cancellation silent', async () => {
  const fetchRequest = globalThis.fetch;
  const documentProperty = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const locale = (cookie: string) =>
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { cookie },
    });
  try {
    for (const [cookie, expected] of [
      ['', 'The server did not respond. Please try again.'],
      ['lastfind_locale=en', 'The server did not respond. Please try again.'],
      [
        'other=1; lastfind_locale=pt-BR',
        'O servidor não respondeu. Tente novamente.',
      ],
    ]) {
      locale(cookie);
      globalThis.fetch = async () =>
        new Response('<html>Gateway unavailable</html>', { status: 503 });
      await assert.rejects(
        requestJson('/api/auth/code', 'POST', {
          email: 'fixture@example.invalid',
        }),
        { message: expected },
      );
      globalThis.fetch = async () => {
        throw new TypeError('Failed to fetch');
      };
      await assert.rejects(
        requestJson('/api/auth/verify', 'POST', { code: '12345678' }),
        { message: expected },
      );
    }
    locale('lastfind_locale=en');
    globalThis.fetch = async () => Response.json(null, { status: 503 });
    await assert.rejects(requestJson('/api/workspace', 'POST'), {
      message: 'Could not complete this operation. Please try again.',
    });
    locale('lastfind_locale=pt-BR');
    globalThis.fetch = async () => Response.json({}, { status: 503 });
    await assert.rejects(requestJson('/api/workspace', 'POST'), {
      message: 'Não foi possível concluir. Tente novamente.',
    });
    globalThis.fetch = async () =>
      Response.json(
        { error: 'The code is invalid or expired.' },
        { status: 401 },
      );
    await assert.rejects(requestJson('/api/auth/verify'), {
      message: 'The code is invalid or expired.',
    });
    const cancelled = new DOMException(
      'This operation was aborted',
      'AbortError',
    );
    globalThis.fetch = async () => {
      throw cancelled;
    };
    await assert.rejects(
      requestJson('/api/reports'),
      (error) => error === cancelled,
    );
    globalThis.fetch = async () => Response.json({ ok: true });
    assert.deepEqual(await requestJson('/api/workspace'), { ok: true });
  } finally {
    globalThis.fetch = fetchRequest;
    if (documentProperty)
      Object.defineProperty(globalThis, 'document', documentProperty);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

void test('a read that meets a 503 waits and tries again; a write is never repeated', async () => {
  const fetchRequest = globalThis.fetch;
  mock.timers.enable({ apis: ['setTimeout'] });
  const settle = async <T>(promise: Promise<T>) => {
    let done = false;
    const watched = promise.finally(() => { done = true; });
    watched.catch(() => {});
    for (let step = 0; step < 20 && !done; step++) {
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(10_000);
    }
    return watched;
  };
  try {
    let calls = 0;
    globalThis.fetch = async () =>
      ++calls < 3 ? Response.json({ error: 'busy' }, { status: 503 }) : Response.json({ ok: true });
    assert.deepEqual(await settle(requestJson('/api/projects/p/reports?view=competitors')), { ok: true });
    assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => (calls++, Response.json({ error: 'busy' }, { status: 503 }));
    await assert.rejects(settle(requestJson('/api/projects/p/reports')), { message: 'busy' });
    assert.equal(calls, 5, 'gives up after the last wait');
    calls = 0;
    await assert.rejects(settle(requestJson('/api/projects/p', 'PATCH', {})), { message: 'busy' });
    assert.equal(calls, 1);
  } finally {
    mock.timers.reset();
    globalThis.fetch = fetchRequest;
  }
});

test('a file a deploy replaced reads as a stale part of the app; other errors do not', async () => {
  const { isStaleChunk } = await import('../lib/client.ts');
  assert.equal(isStaleChunk(new TypeError('Failed to fetch dynamically imported module: https://lastfind.ai/assets/artifact-editor-1a2b.js')), true);
  assert.equal(isStaleChunk(new TypeError('Importing a module script failed.')), true);
  assert.equal(isStaleChunk(new Error('Cannot read properties of undefined')), false);
  assert.equal(isStaleChunk(undefined), false);
});
