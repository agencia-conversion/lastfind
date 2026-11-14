import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Drive the hook's effect/cleanup contract with a controlled clock and deferred
// JSON bodies. No DOM, server, providers or wall-clock sleeps are involved.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  stdin: {
    contents:
      "export {useReport} from './hooks/use-report';export {createAnalyticsRequest} from './lib/analytics-cache';",
    resolveDir: root + 'packages/core',
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  plugins: [
    {
      name: 'hook-lifecycle',
      setup(builder) {
        builder.onResolve({ filter: /^react$/ }, () => ({
          path: 'react',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const useState=(...a)=>globalThis.reportLifecycle.useState(...a);export const useEffect=(...a)=>globalThis.reportLifecycle.useEffect(...a);',
        }));
        builder.onResolve({ filter: /^@\/lib\/client$/ }, () => ({
          path: root + 'packages/core/lib/client.ts',
        }));
      },
    },
  ],
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(import.meta.url),
  mod,
  mod.exports,
);
const { useReport: readReport, createAnalyticsRequest } = mod.exports;
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function lifecycle(t) {
  let state, dependencies, nextEffect, cleanup;
  const requests = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    let resolve, reject;
    const body = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    requests.push({ url, signal, resolve, reject });
    // Body completion may race cleanup even when fetch already returned headers.
    return { ok: true, headers: new Headers(), json: () => body };
  });
  globalThis.reportLifecycle = {
    useState(initial) {
      state ??= initial;
      return [
        state,
        (value) => {
          state = value;
        },
      ];
    },
    useEffect(effect, deps) {
      if (
        !dependencies ||
        deps.some((value, i) => !Object.is(value, dependencies[i]))
      ) {
        dependencies = deps;
        nextEffect = effect;
      }
    },
  };
  const render = (url, refresh = 0) => {
    const value = readReport(url, refresh);
    if (nextEffect) {
      cleanup?.();
      cleanup = nextEffect();
      nextEffect = undefined;
    }
    return value;
  };
  t.after(() => {
    cleanup?.();
    delete globalThis.reportLifecycle;
  });
  return {
    requests,
    render,
    start: async () => {
      t.mock.timers.tick(180);
      await flush();
    },
  };
}

test('Back and period changes cancel stale requests and settle the current report', async (t) => {
  const hook = lifecycle(t);
  for (const current of ['note', 'absence', 'error']) {
    const url = '/brand-research?days=28&case=' + current;
    assert.equal(hook.render(url).loading, true);
    await hook.start();
    const cancelled = hook.requests.at(-1);
    hook.render(null); // Recent response detail unmounts the report surface.
    assert.equal(cancelled.signal.aborted, true);
    cancelled.reject(new DOMException('Aborted', 'AbortError'));
    hook.render('/brand-research?days=7');
    await hook.start();
    const seven = hook.requests.at(-1);
    hook.render(url); // Back / 7 → 28 while the old period is in flight.
    await hook.start();
    seven.resolve({ score: 100 });
    const pending = hook.requests.at(-1);
    if (current === 'error') pending.reject(new Error('Network unavailable'));
    else
      pending.resolve(
        current === 'note'
          ? { score: 63 }
          : { assessed: 0, reason: 'Not evaluated' },
      );
    await flush();
    const result = hook.render(url);
    assert.equal(result.loading, false);
    if (current === 'error')
      assert.match(result.error, /The server did not respond/);
    else
      assert.deepEqual(
        result.data,
        current === 'note'
          ? { score: 63 }
          : { assessed: 0, reason: 'Not evaluated' },
      );
  }
});

test('an aborted body cannot overwrite a newer result when Back reuses the same key', async (t) => {
  const hook = lifecycle(t),
    url = '/brand-research?days=28';
  hook.render(url);
  await hook.start();
  const old = hook.requests.at(-1);
  hook.render(null);
  hook.render(url);
  await hook.start();
  const current = hook.requests.at(-1);
  current.resolve({ score: 63 });
  await flush();
  old.resolve({ score: 0 });
  await flush();
  assert.equal(hook.render(url).data.score, 63);
});

test('repeated renders keep an in-flight request; explicit refresh invalidates it', async (t) => {
  const hook = lifecycle(t),
    url = '/brand-research?days=28';
  hook.render(url, 0);
  await hook.start();
  const first = hook.requests.at(-1);
  for (let i = 0; i < 10; i++) {
    hook.render(url, 0);
    await hook.start();
  }
  assert.equal(hook.requests.length, 1);
  assert.equal(first.signal.aborted, false);
  hook.render(url, 1);
  await hook.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(hook.requests.length, 2);
  hook.requests.at(-1).resolve({ assessed: 0 });
  await flush();
  assert.deepEqual(hook.render(url, 1), {
    data: { assessed: 0 },
    error: undefined,
    loading: false,
  });
});

test('background cache notifications do not cancel research; a cache invalidation refreshes it', async (t) => {
  const hook = lifecycle(t),
    url = '/brand-research?days=28';
  let now = 0,
    notifications = 0;
  const cache = createAnalyticsRequest(
    async () => ({ responses: 4 }),
    () => now,
  );
  cache.subscribe(() => {
    notifications++;
    hook.render(url, cache.generation);
  });
  const history = '/api/reports?view=history&days=28';
  await cache.request(history);
  hook.render(url, cache.generation);
  await hook.start();
  const research = hook.requests.at(-1);
  now = 16_000;
  await cache.request(history);
  await flush();
  assert.equal(notifications, 1);
  assert.equal(cache.generation, 0);
  assert.equal(research.signal.aborted, false);
  research.resolve({ assessed: 0 });
  await flush();
  assert.equal(hook.render(url, cache.generation).loading, false);
  cache.invalidate();
  hook.render(url, cache.generation);
  await hook.start();
  assert.equal(research.signal.aborted, true);
  hook.requests.at(-1).resolve({ score: 100 });
  await flush();
  assert.equal(hook.render(url, cache.generation).data.score, 100);
});

test('a refresh of the same URL keeps the previous data while it reloads; another URL does not', async (t) => {
  const hook = lifecycle(t),
    url = '/reports?view=summary&project=a';
  hook.render(url, 0);
  await hook.start();
  hook.requests.at(-1).resolve({ responses: 4 });
  await flush();
  assert.equal(hook.render(url, 0).data.responses, 4);
  const refreshing = hook.render(url, 1);
  assert.deepEqual([refreshing.data?.responses, refreshing.loading], [4, true]);
  assert.equal(hook.render('/reports?view=summary&project=b', 1).data, undefined);
});
