import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOG_EDGE_TTL_SECONDS,
  cachedBlogDocument,
  isBlogDocumentRequest,
} from '../lib/server/blog-edge-cache.ts';

test('only full blog documents in either locale use the shared cache', () => {
  for (const path of ['/blog', '/blog/geo', '/pt-br/blog', '/pt-br/blog/geo']) {
    assert.equal(isBlogDocumentRequest(new Request(`https://lastfind.ai${path}`)), true);
  }
  for (const path of ['/app', '/api/auth/session', '/blog/geo/more', '/pt-br/blogger']) {
    assert.equal(isBlogDocumentRequest(new Request(`https://lastfind.ai${path}`)), false);
  }
  assert.equal(isBlogDocumentRequest(new Request('https://lastfind.ai/blog/geo?_rsc=abc')), false);
  assert.equal(isBlogDocumentRequest(new Request('https://lastfind.ai/blog/geo', { headers: { RSC: '1' } })), false);
  assert.equal(isBlogDocumentRequest(new Request('https://lastfind.ai/blog', { method: 'POST' })), false);
});

test('a released document is shared across visitors for one minute without rendering twice', async () => {
  const entries = new Map<string, Response>();
  const cache = {
    async match(key: Request) { return entries.get(key.url)?.clone(); },
    async put(key: Request, response: Response) { entries.set(key.url, response.clone()); },
  } as unknown as Cache;
  let renders = 0;
  const pending: Promise<unknown>[] = [];
  const render = async (request: Request) => {
    renders++;
    assert.equal(request.headers.get('Cookie'), null);
    assert.equal(request.headers.get('Authorization'), null);
    return new Response('<h1>Article</h1>', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } });
  };
  const first = await cachedBlogDocument(new Request('https://lastfind.ai/blog/geo?utm_source=x', { headers: { Cookie: 'session=one' } }), render, cache, (promise) => pending.push(promise), 'deploy-one');
  await Promise.all(pending);
  assert.equal(first.headers.get('X-Blog-Cache'), 'MISS');
  assert.equal(first.headers.get('Cache-Control'), `public, max-age=0, s-maxage=${BLOG_EDGE_TTL_SECONDS}`);
  const second = await cachedBlogDocument(new Request('https://lastfind.ai/blog/geo?utm_source=y', { headers: { Cookie: 'session=two', Authorization: 'Bearer secret' } }), render, cache, (promise) => pending.push(promise), 'deploy-one');
  assert.equal(second.headers.get('X-Blog-Cache'), 'HIT');
  assert.equal(await second.text(), '<h1>Article</h1>');
  assert.equal(renders, 1);
  const afterDeploy = await cachedBlogDocument(new Request('https://lastfind.ai/blog/geo'), render, cache, (promise) => pending.push(promise), 'deploy-two');
  assert.equal(afterDeploy.headers.get('X-Blog-Cache'), 'MISS');
  await Promise.all(pending);
  const repeated = await cachedBlogDocument(new Request('https://lastfind.ai/blog/geo'), render, cache, (promise) => pending.push(promise), 'deploy-two');
  assert.equal(repeated.headers.get('X-Blog-Cache'), 'HIT');
  assert.equal(renders, 2);
});

test('errors and personalized responses are never stored', async () => {
  let writes = 0;
  const cache = { async match() { return undefined; }, async put() { writes++; } } as unknown as Cache;
  for (const response of [
    new Response('missing', { status: 404, headers: { 'Content-Type': 'text/html' } }),
    new Response('<h1>private</h1>', { headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'sid=x' } }),
    new Response('flight', { headers: { 'Content-Type': 'text/x-component' } }),
  ]) {
    const actual = await cachedBlogDocument(new Request('https://lastfind.ai/blog/geo'), async () => response, cache, () => {}, 'deploy-one');
    assert.equal(actual.headers.get('X-Blog-Cache'), null);
  }
  assert.equal(writes, 0);
});

test('an older selfhost configuration without version metadata does not cache HTML', async () => {
  let renders = 0;
  const cache = { async match() { throw new Error('cache must not be read'); }, async put() { throw new Error('cache must not be written'); } } as unknown as Cache;
  const render = async () => new Response(`render ${++renders}`);
  for (let i = 1; i <= 2; i++) {
    const response = await cachedBlogDocument(new Request('https://example.com/blog'), render, cache, () => {});
    assert.equal(await response.text(), `render ${i}`);
  }
});
