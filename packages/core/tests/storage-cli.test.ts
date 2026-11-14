import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installationOrigin,
  ownerStorageClient,
} from '../../../scripts/project-storage-client.mjs';
const key = 'private-owner-key-for-automated-test-only-12345';
const origin = 'https://personal.example';
function bodyText(value: RequestInit['body']) {
  assert.equal(typeof value, 'string');
  return value as string;
}

void test('storage CLI refuses insecure or credential-bearing remote destinations', () => {
  assert.equal(installationOrigin(origin), origin);
  assert.equal(
    installationOrigin('http://localhost:3002'),
    'http://localhost:3002',
  );
  for (const url of [
    'http://personal.example',
    'https://user:secret@personal.example',
    'https://personal.example/app',
    'https://personal.example?secret=x',
    'not-a-url',
  ])
    assert.throws(() => installationOrigin(url));
});

void test('owner CLI uses a scoped session and never puts the access key in a URL or operation payload', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = await ownerStorageClient({
    url: origin,
    key,
    fetchRequest: async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : typeof input === 'string'
            ? input
            : input.href;
      calls.push({ url, init: init ?? {} });
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('Origin'), origin);
      assert.equal(url.includes(key), false);
      if (url.endsWith('/login')) {
        assert.deepEqual(
          JSON.parse(init?.body === undefined ? '' : bodyText(init.body)),
          { key },
        );
        assert.equal(new Headers(init?.headers).has('Cookie'), false);
        return Response.json(
          { ok: true },
          {
            headers: {
              'Set-Cookie':
                '__Host-lastfind-session=private-session; Path=/; Secure; HttpOnly',
            },
          },
        );
      }
      assert.equal(
        new Headers(init?.headers).get('Cookie'),
        '__Host-lastfind-session=private-session',
      );
      assert.equal(
        (init?.body === undefined ? '' : bodyText(init.body)).includes(key),
        false,
      );
      if (url.endsWith('/workspace'))
        return Response.json({
          projects: [
            {
              id: 'project/one',
              name: 'One',
              domain: 'one.example',
              privateExtra: 'discarded',
            },
          ],
        });
      return Response.json({ configured: true, registry: { state: 'shadow' } });
    },
  });
  assert.deepEqual(await client.projects(), [
    { id: 'project/one', name: 'One', domain: 'one.example' },
  ]);
  await client.status('project/one');
  await client.restoreBegin('project/one', {
    schema: 1,
    projectId: 'project/one',
  });
  await client.restoreChunk('project/one', 'new-generation', 'runs', []);
  await client.restoreCommit('project/one', 'new-generation');
  await client.close();
  assert.ok(calls.some((call) => call.url.endsWith('/project%2Fone/storage')));
  assert.deepEqual(JSON.parse(bodyText(calls[3].init.body)), {
    action: 'restore-begin',
    manifest: { schema: 1, projectId: 'project/one' },
  });
  assert.deepEqual(JSON.parse(bodyText(calls[4].init.body)), {
    action: 'restore-chunk',
    generation: 'new-generation',
    entity: 'runs',
    rows: [],
  });
  assert.deepEqual(JSON.parse(bodyText(calls[5].init.body)), {
    action: 'restore-commit',
    generation: 'new-generation',
  });
  assert.ok(calls.at(-1)?.url.endsWith('/logout'));
});

void test('storage CLI fails closed when sign-in has no owner session or an API rejects access', async () => {
  await assert.rejects(
    ownerStorageClient({
      url: origin,
      key,
      fetchRequest: async () => Response.json({ ok: true }),
    }),
    /did not establish/,
  );
  await assert.rejects(
    ownerStorageClient({
      url: origin,
      key,
      fetchRequest: async () =>
        Response.json({ error: 'Invalid access key.' }, { status: 401 }),
    }),
    /Invalid access key/,
  );
  await assert.rejects(
    ownerStorageClient({
      url: origin,
      key,
      fetchRequest: async () =>
        new Response('<html>Sign in</html>', { status: 403 }),
    }),
    /no JSON/,
  );
});

void test('private export uses the same owner session and refuses rejected downloads', async () => {
  let allowed = true;
  const client = await ownerStorageClient({
    url: origin,
    key,
    fetchRequest: async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : typeof input === 'string'
            ? input
            : input.href;
      if (url.endsWith('/login'))
        return Response.json(
          { ok: true },
          {
            headers: {
              'Set-Cookie':
                '__Host-lastfind-session=private-export-session; Path=/; Secure; HttpOnly',
            },
          },
        );
      assert.equal(
        new Headers(init?.headers).get('Cookie'),
        '__Host-lastfind-session=private-export-session',
      );
      assert.equal(new Headers(init?.headers).get('Origin'), origin);
      assert.equal(init?.redirect, 'error');
      if (url.endsWith('/logout')) return Response.json({ ok: true });
      assert.equal(
        url,
        `${origin}/api/projects/project%2Fone/storage?format=export`,
      );
      return new Response(allowed ? '{"type":"manifest"}\n' : 'Forbidden', {
        status: allowed ? 200 : 403,
      });
    },
  });
  assert.equal(
    await new Response(await client.download('project/one')).text(),
    '{"type":"manifest"}\n',
  );
  allowed = false;
  await assert.rejects(client.download('project/one'), /403/);
  await assert.rejects(client.restoreBegin('', {}), /project ID/);
  await client.close();
});
