import test from 'node:test';
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
    await assert.rejects(requestJson('/api/workspace'), {
      message: 'Could not complete this operation. Please try again.',
    });
    locale('lastfind_locale=pt-BR');
    globalThis.fetch = async () => Response.json({}, { status: 503 });
    await assert.rejects(requestJson('/api/workspace'), {
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
