import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandFavicon,
  faviconHost,
  faviconResponse,
  measureBrandFavicon,
  pageNames,
  probeSite,
  resetFaviconCache,
  smallestIco,
} from '../lib/server/favicon.ts';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const reply = (body: BodyInit, type: string, status = 200) => new Response(body, { status, headers: { 'content-type': type } });

void test('only public hostnames are read', () => {
  assert.equal(faviconHost('https://www.Tubitv.com/path'), 'tubitv.com');
  // The same deny-list as every page the product reads (publicAddress): local names of any kind, never an address.
  for (const bad of ['', 'localhost', '127.0.0.1', '10.0.0.1', 'intranet.local', 'printer.lan', 'nas.home', 'files.intranet', 'a_b.com', 'x'.repeat(260) + '.com'])
    assert.equal(faviconHost(bad), null, bad);
});

void test('reads the icon declared by the brand domain, else /favicon.ico', async () => {
  resetFaviconCache();
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url === 'https://tubitv.com/') return reply('<html><link rel="shortcut icon" href="/static/icon.png"></html>', 'text/html');
    if (url === 'https://tubitv.com/static/icon.png') return reply(png, 'image/png');
    return reply('missing', 'text/plain', 404);
  }) as typeof fetch;
  const icon = await brandFavicon('tubitv.com', fetcher);
  assert.equal(icon?.type, 'image/png');
  assert.ok(seen.every((url) => new URL(url).hostname === 'tubitv.com'));
  const calls = seen.length;
  await brandFavicon('tubitv.com', fetcher);
  assert.equal(seen.length, calls, 'second read is cached');

  resetFaviconCache();
  const fallback = (async (input: RequestInfo | URL) =>
    String(input).endsWith('/favicon.ico') ? reply(Uint8Array.from([0, 0, 1, 0, 9]), 'image/x-icon') : reply('<html></html>', 'text/html')) as typeof fetch;
  assert.equal((await brandFavicon('roku.com', fallback))?.type, 'image/x-icon');
});

void test('SVG declared icons are served with a sandbox CSP; HTML and oversized bodies are refused', async () => {
  resetFaviconCache();
  const svgBody = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const svg = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://svgbrand.com/') return reply('<html><link rel="icon" href="/icon.svg"></html>', 'text/html');
    if (url === 'https://svgbrand.com/icon.svg') return reply(svgBody, 'image/svg+xml');
    return reply('missing', 'text/plain', 404);
  }) as typeof fetch;
  const icon = await brandFavicon('svgbrand.com', svg);
  assert.equal(icon?.type, 'image/svg+xml');
  const response = await faviconResponse(async () => ({}), 'svgbrand.com', svg);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/svg+xml');
  assert.match(response.headers.get('Content-Security-Policy') ?? '', /sandbox/);
  assert.match(response.headers.get('Content-Security-Policy') ?? '', /default-src 'none'/);

  resetFaviconCache();
  const big = (async (input: RequestInfo | URL) =>
    String(input).endsWith('/favicon.ico') ? reply(new Uint8Array(200_000).fill(0x89), 'image/png') : reply('', 'text/html')) as typeof fetch;
  assert.equal(await brandFavicon('big.com', big), null);
});

void test('Google last resort is used only when the site fails; generic globe is treated as failure', async () => {
  resetFaviconCache();
  const googlePng = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.startsWith('https://www.google.com/s2/favicons')) return reply(googlePng, 'image/png');
    return reply('down', 'text/plain', 404);
  }) as typeof fetch;
  const probe = await measureBrandFavicon('fallback.com', fetcher);
  assert.equal(probe.source, 'google');
  assert.equal(probe.icon?.type, 'image/png');
  assert.ok(seen.some((url) => url.includes('google.com/s2/favicons')));
  assert.ok(seen.some((url) => url === 'https://fallback.com/' || url === 'https://fallback.com/favicon.ico'));

  resetFaviconCache();
  // Live Google sz=64 default globe (neverssl.com); SHA-256 matches GOOGLE_GLOBE_SHA256 in favicon.ts.
  const globe = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAADFBMVEX///9CwP0tvP3n9f+FijQ1AAAAKklEQVRYhe3MQREAIAwDsA78e0ZEP9wuEZBMKQKBQCD4KTil3FIAANjoAWU3BwHY9CtUAAAAAElFTkSuQmCC',
      'base64',
    ),
  );
  const globeFetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://www.google.com/s2/favicons')) return reply(globe, 'image/png');
    return reply('down', 'text/plain', 404);
  }) as typeof fetch;
  const globeProbe = await measureBrandFavicon('globe.com', globeFetcher);
  assert.equal(globeProbe.icon, null);
  assert.equal(globeProbe.failure, 'generic-google');
});

void test('failure is cached briefly; answers 404; auth required', async () => {
  resetFaviconCache();
  let calls = 0;
  const down = (async () => {
    calls++;
    throw new Error('offline');
  }) as typeof fetch;
  assert.equal((await faviconResponse(async () => ({}), 'down.com', down)).status, 404);
  const first = calls;
  await faviconResponse(async () => ({}), 'down.com', down);
  assert.equal(calls, first);
  assert.equal((await faviconResponse(async () => null, 'down.com', down)).status, 401);

  resetFaviconCache();
  const now = Date.now();
  await brandFavicon('expire.com', down, now);
  const afterFail = calls;
  await brandFavicon('expire.com', down, now + 14 * 60_000);
  assert.equal(calls, afterFail, 'still within failure TTL');
  await brandFavicon('expire.com', down, now + 16 * 60_000);
  assert.ok(calls > afterFail, 'failure cache expired after 15 minutes');
});

void test('redirects must stay on https and a public host; the cached icon is a compact copy', async () => {
  resetFaviconCache();
  const seen: string[] = [];
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    assert.equal(init?.redirect, 'manual');
    if (url === 'https://ok.com/') return redirect('https://www.ok.com/home');
    if (url === 'https://www.ok.com/home') return reply('<html></html>', 'text/html');
    if (url === 'https://ok.com/favicon.ico') return reply(png, 'image/png');
    if (url === 'https://bad.com/' || url === 'https://bad.com/favicon.ico') return redirect('http://169.254.169.254/latest');
    if (url.startsWith('https://www.google.com/s2/favicons')) return reply('missing', 'text/plain', 404);
    return reply('missing', 'text/plain', 404);
  }) as typeof fetch;
  const icon = await brandFavicon('ok.com', fetcher);
  assert.equal(icon?.type, 'image/png');
  assert.equal(icon?.image.buffer.byteLength, png.byteLength, 'not a view of the 128 KB read buffer');
  assert.equal(await brandFavicon('bad.com', fetcher), null);
  assert.ok(!seen.some((url) => url.includes('169.254')));
});

void test('concurrent lookups for one host share one fetch', async () => {
  resetFaviconCache();
  let calls = 0;
  const fetcher = (async (input: RequestInfo | URL) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return String(input).endsWith('/favicon.ico') ? reply(png, 'image/png') : reply('<html></html>', 'text/html');
  }) as typeof fetch;
  const all = await Promise.all([1, 2, 3].map(() => brandFavicon('once.com', fetcher)));
  assert.ok(all.every((icon) => icon?.type === 'image/png'));
  assert.equal(calls, 2, 'one page read + one favicon.ico read');
});

/** An in-memory stand-in for the R2 bucket: bytes plus the custom metadata the cache reads. */
function memoryStore() {
  const objects = new Map<string, { bytes: Uint8Array; meta: Record<string, string> }>();
  return {
    objects,
    store: {
      async get(key: string) {
        const object = objects.get(key);
        return object ? { customMetadata: object.meta, arrayBuffer: async () => object.bytes.slice().buffer } : null;
      },
      async put(key: string, value: Uint8Array, options: { customMetadata: Record<string, string> }) {
        objects.set(key, { bytes: value.slice(), meta: options.customMetadata });
        return null;
      },
    } as unknown as import('../lib/server/favicon.ts').FaviconStore,
  };
}

void test('icons are kept in the bucket: 30 days fresh, then served while one background read refreshes, refetched after 90', async () => {
  const { objects, store } = memoryStore();
  let calls = 0;
  const site = (async (input: RequestInfo | URL) => {
    calls++;
    return String(input).endsWith('/favicon.ico') ? reply(png, 'image/png') : reply('<html></html>', 'text/html');
  }) as typeof fetch;
  const day = 24 * 60 * 60_000;
  const start = Date.parse('2026-10-01T00:00:00Z');
  resetFaviconCache();
  assert.equal((await brandFavicon('kept.com', site, start, { store }))?.type, 'image/png');
  assert.equal(objects.get('favicons/v1/kept.com')?.meta.state, 'icon');
  const fetched = calls;
  // Another isolate (empty memory) reads the bucket, not the site.
  resetFaviconCache();
  assert.equal((await brandFavicon('kept.com', site, start + 29 * day, { store }))?.type, 'image/png');
  assert.equal(calls, fetched);
  // Stale: served at once, refreshed after the response.
  resetFaviconCache();
  const deferred: Promise<unknown>[] = [];
  assert.equal((await brandFavicon('kept.com', site, start + 31 * day, { store, defer: (work) => deferred.push(work) }))?.type, 'image/png');
  // The lookup itself (kept alive for the requests that join it) and the background refresh.
  assert.equal(deferred.length, 2);
  await Promise.all(deferred);
  assert.ok(calls > fetched);
  assert.equal(objects.get('favicons/v1/kept.com')?.meta.fetchedAt, new Date(start + 31 * day).toISOString());
  // Too old: read again before answering.
  resetFaviconCache();
  const before = calls;
  await brandFavicon('kept.com', site, start + 31 * day + 91 * day, { store });
  assert.ok(calls > before);
});

void test('a host without an icon is remembered for 7 days; an unreachable site is not stored; a failed refresh keeps the icon', async () => {
  const { objects, store } = memoryStore();
  let calls = 0;
  const none = (async (input: RequestInfo | URL) => {
    calls++;
    return String(input).startsWith('https://www.google.com/') ? reply('missing', 'text/plain', 404) : reply('<html></html>', 'text/html');
  }) as typeof fetch;
  const day = 24 * 60 * 60_000;
  const start = Date.parse('2026-10-01T00:00:00Z');
  resetFaviconCache();
  assert.equal(await brandFavicon('noicon.com', none, start, { store }), null);
  assert.equal(objects.get('favicons/v1/noicon.com')?.meta.state, 'missing');
  const first = calls;
  resetFaviconCache();
  assert.equal(await brandFavicon('noicon.com', none, start + 6 * day, { store }), null);
  assert.equal(calls, first, 'missing answer kept for 7 days');
  resetFaviconCache();
  await brandFavicon('noicon.com', none, start + 8 * day, { store });
  assert.ok(calls > first, 'asked again after 7 days');

  const down = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  resetFaviconCache();
  assert.equal(await brandFavicon('down.com', down, start, { store }), null);
  assert.equal(objects.has('favicons/v1/down.com'), false);

  // A stale icon whose site is now down stays as it was.
  objects.set('favicons/v1/stale.com', { bytes: png, meta: { state: 'icon', fetchedAt: new Date(start - 40 * day).toISOString() } });
  resetFaviconCache();
  const deferred: Promise<unknown>[] = [];
  assert.equal((await brandFavicon('stale.com', down, start, { store, defer: (work) => deferred.push(work) }))?.type, 'image/png');
  await Promise.all(deferred);
  assert.equal(objects.get('favicons/v1/stale.com')?.meta.state, 'icon');
  assert.equal(objects.get('favicons/v1/stale.com')?.meta.fetchedAt, new Date(start - 40 * day).toISOString());

  // A bucket that fails is not an error: the site is read directly.
  const broken = { get: async () => { throw new Error('r2 down'); }, put: async () => { throw new Error('r2 down'); } } as unknown as import('../lib/server/favicon.ts').FaviconStore;
  const site = (async (input: RequestInfo | URL) => String(input).endsWith('/favicon.ico') ? reply(png, 'image/png') : reply('<html></html>', 'text/html')) as typeof fetch;
  resetFaviconCache();
  assert.equal((await brandFavicon('r2down.com', site, start, { store: broken }))?.type, 'image/png');
});

void test('the browser keeps an icon for 30 days and a missing one for a day, without varying by cookie', async () => {
  const site = (async (input: RequestInfo | URL) => String(input).endsWith('/favicon.ico') ? reply(png, 'image/png') : reply('<html></html>', 'text/html')) as typeof fetch;
  resetFaviconCache();
  const ok = await faviconResponse(async () => ({}), 'browser.com', site);
  assert.equal(ok.headers.get('Cache-Control'), 'private, max-age=2592000, stale-while-revalidate=604800');
  assert.equal(ok.headers.get('Vary'), null);
  const down = (async () => { throw new Error('offline'); }) as typeof fetch;
  const missing = await faviconResponse(async () => ({}), 'nobrowser.com', down);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('Cache-Control'), 'private, max-age=86400');
  // The public demo's copy is the same for everyone: any cache may keep it.
  const shared = await faviconResponse(async () => true, 'browser.com', site, { shared: true });
  assert.equal(shared.headers.get('Cache-Control'), 'public, max-age=2592000, stale-while-revalidate=604800');
  assert.equal((await faviconResponse(async () => true, 'nobrowser.com', down, { shared: true })).headers.get('Cache-Control'), 'public, max-age=86400');
});

void test('the declared icon nearest a row’s size is read; fluid, mask and touch icons only when nothing else is declared', async () => {
  resetFaviconCache();
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url === 'https://sizes.com/')
      return reply(
        `<html><link rel="fluid-icon" href="/fluid.png"><link rel="mask-icon" href="/mask.svg"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">
         <link rel="icon" sizes="192x192" href="/192.png"><link rel="icon" sizes="16x16" href="/16.png"><link rel="icon" sizes="32x32" href="/32.png"></html>`,
        'text/html',
      );
    if (url.endsWith('.png')) return reply(png, 'image/png');
    return reply('missing', 'text/plain', 404);
  }) as typeof fetch;
  await brandFavicon('sizes.com', fetcher);
  assert.deepEqual(seen, ['https://sizes.com/', 'https://sizes.com/32.png']);
  resetFaviconCache();
  seen.length = 0;
  const touchOnly = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url === 'https://touch.com/') return reply('<link rel="fluid-icon" href="/fluid.png"><link rel="apple-touch-icon" href="/touch.png">', 'text/html');
    return reply(png, 'image/png');
  }) as typeof fetch;
  await brandFavicon('touch.com', touchOnly);
  assert.deepEqual(seen, ['https://touch.com/', 'https://touch.com/touch.png']);
});

void test('a favicon.ico keeps only the image closest above 32 px, as a valid one-image .ico', () => {
  // Three images: 16 px (8 bytes), 32 px (12 bytes), 256 px (40 bytes).
  const entries = [
    { width: 16, bytes: 8 },
    { width: 32, bytes: 12 },
    { width: 0, bytes: 40 },
  ];
  const size = 6 + 16 * entries.length + entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const ico = new Uint8Array(size);
  const view = new DataView(ico.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);
  let offset = 6 + 16 * entries.length;
  entries.forEach((entry, index) => {
    const at = 6 + 16 * index;
    ico[at] = entry.width;
    ico[at + 1] = entry.width;
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, entry.bytes, true);
    view.setUint32(at + 12, offset, true);
    ico.fill(index + 1, offset, offset + entry.bytes);
    offset += entry.bytes;
  });
  const trimmed = smallestIco(ico);
  const out = new DataView(trimmed.buffer);
  assert.deepEqual([out.getUint16(2, true), out.getUint16(4, true), trimmed[6], out.getUint32(14, true), out.getUint32(18, true)], [1, 1, 32, 12, 22]);
  assert.deepEqual([...trimmed.subarray(22)], Array(12).fill(2));
  // One image, or anything that does not parse, is kept as it came.
  const broken = ico.slice();
  new DataView(broken.buffer).setUint32(6 + 16 + 12, 9999, true);
  assert.equal(smallestIco(broken), broken);
  assert.equal(smallestIco(trimmed), trimmed);
});

void test('a site read says whether the site answered, where it led and what it calls itself, and keeps its icon', async () => {
  resetFaviconCache();
  assert.deepEqual(pageNames('<title> Tom&#39;s Guide &amp; more </title><meta content="Tom’s Guide" property="og:site_name">'), {
    title: "Tom's Guide & more",
    siteName: 'Tom’s Guide',
  });
  const kept = new Map<string, { body: Uint8Array; meta: Record<string, string> }>();
  const store = {
    get: async (key: string) => {
      const item = kept.get(key);
      return item ? ({ customMetadata: item.meta, arrayBuffer: async () => item.body.slice().buffer } as unknown as R2ObjectBody) : null;
    },
    put: async (key: string, body: Uint8Array, options: { customMetadata: Record<string, string> }) => {
      kept.set(key, { body, meta: options.customMetadata });
      return null as unknown as R2Object;
    },
  } as unknown as Pick<R2Bucket, 'get' | 'put'>;
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://nickelodeon.com/') return new Response(null, { status: 301, headers: { location: 'https://www.nick.com/' } });
    if (url === 'https://www.nick.com/') return reply('<title>Nickelodeon | Kids</title><link rel="icon" href="/i.png">', 'text/html');
    if (url === 'https://www.nick.com/i.png') return reply(png, 'image/png');
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const read = await probeSite('nickelodeon.com', fetcher, Date.now(), store);
  assert.deepEqual(read?.site, { reachable: true, host: 'nick.com', title: 'Nickelodeon | Kids', siteName: null });
  assert.equal(read?.icon, true);
  assert.ok(kept.has('favicons/v1/nickelodeon.com'), 'the icon is in the bucket before any screen asks');
  const nothing = (async () => {
    throw new Error('no network');
  }) as typeof fetch;
  assert.equal((await brandFavicon('nickelodeon.com', nothing))?.type, 'image/png', 'served without reading the site again');
  const down = await probeSite('gone.com', fetcher, Date.now(), store);
  assert.equal(down?.site.reachable, false);
  const blocked = await probeSite('blocked.com', (async () => reply('no', 'text/plain', 403)) as typeof fetch, Date.now(), store);
  assert.equal(blocked?.site.reachable, true, 'a site that refuses robots still exists');
  const origin = await probeSite('cf.com', (async () => reply('', 'text/html', 530)) as typeof fetch, Date.now(), store);
  assert.equal(origin?.site.reachable, false, 'Cloudflare could not reach the origin');
  const loop = (async (input: RequestInfo | URL) => new Response(null, { status: 301, headers: { location: `${String(input)}x` } })) as typeof fetch;
  assert.equal((await probeSite('hops.com', loop, Date.now(), store))?.site.reachable, true, 'more redirects than followed still answered');
  const slow = (async () => {
    throw new DOMException('slow', 'TimeoutError');
  }) as typeof fetch;
  assert.equal((await probeSite('slow.com', slow, Date.now(), store))?.site.reachable, true, 'a slow site is not held against it');
});
