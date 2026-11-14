import { shareFlight, type Flight } from './analytics-query-cache.ts';
import { publicAddress } from '../cited-sources.ts';

/**
 * Brand favicons are read by our server from the brand's own domain (declared
 * icon, else /favicon.ico). SVG is allowed inside <img> with a sandbox CSP.
 * When the site fails, Google s2/favicons is a last resort (generic globe → null).
 * Failure → null and the interface draws the brand's initial.
 *
 * Every icon read is kept in the private bucket (R2 in Cloud and in the independent installation:
 * `favicons/v1/<host>`), shared by every isolate and user: fresh for 30 days, then still served for
 * up to 90 days while one background read replaces it; a host with no icon is remembered for 7 days;
 * a timeout or an unreachable site only for 15 minutes in memory. The browser keeps an icon for 30 days.
 */
const cache = new Map<string, { icon: Icon | null; expires: number }>();
const pending = new Map<string, Flight<Icon | null>>();
const MAX_ENTRIES = 512;
const MAX_CACHE_BYTES = 8_000_000;
const MAX_REDIRECTS = 3;
let cacheBytes = 0;
const MAX_BYTES = 128_000;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const SUCCESS_TTL = 24 * 60 * 60_000;
const FAILURE_TTL = 15 * 60_000;
const DAY = 24 * 60 * 60_000;
/** The stored copy is served as is for 30 days, then (up to 90) served while a background read replaces it. */
export const FAVICON_FRESH_MS = 30 * DAY;
export const FAVICON_STALE_MS = 90 * DAY;
/** A host whose site and Google have no icon is not asked again for 7 days. */
export const FAVICON_MISSING_MS = 7 * DAY;
/** What the browser keeps: an icon for 30 days (and 7 more while it asks again), a missing one for a day. */
const BROWSER_ICON = `max-age=${FAVICON_FRESH_MS / 1000}, stale-while-revalidate=${(7 * DAY) / 1000}`;
const BROWSER_MISSING = `max-age=${DAY / 1000}`;
const STORE_PREFIX = 'favicons/v1/';
/** The bucket where icons are kept (R2's `get`/`put`), and how to run a refresh after the response. */
export type FaviconStore = Pick<R2Bucket, 'get' | 'put'>;
/** `shared` (faviconResponse): the public demo's response, the same for everyone, so any cache may keep it. */
export type FaviconOptions = { store?: FaviconStore | null; defer?: (work: Promise<unknown>) => void; shared?: boolean };
/** Failures that say the host has no icon (kept for 7 days); the others (timeout, offline, blocked) are retried soon. */
const DEFINITIVE: FaviconFailure[] = ['not-found', 'generic-google', 'oversized', 'invalid-host'];
/** Google sz=64 gray globe for domains with no real icon (neverssl-sized default). */
const GOOGLE_GLOBE_SHA256 = '3b3f0f84421aecde49c19d39f0de8d032a4d71aa9267d834c69d6187979a5ab6';
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
type Icon = { image: Uint8Array; type: string };

export type FaviconSource = 'declared' | 'favicon.ico' | 'google';
export type FaviconFailure =
  | 'invalid-host'
  | 'not-found'
  | 'blocked'
  | 'timeout'
  | 'oversized'
  | 'generic-google'
  | 'offline';

/** What the brand's home page said about itself: whether it answered at all, where it ended and its names. */
export type SiteFacts = { reachable: boolean; host: string; title: string | null; siteName: string | null };

export type FaviconProbe = {
  host: string | null;
  icon: Icon | null;
  source: FaviconSource | null;
  failure: FaviconFailure | null;
  /** The home page read on the way (absent for an invalid host). */
  site?: SiteFacts;
};

/** The host a brand domain names, when it is one the product may read (the same rule as every page read, publicAddress). */
export function faviconHost(value: string) {
  const host = value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  return host.length <= 253 && HOST.test(host) && publicAddress(`https://${host}/`) ? host : null;
}

function sniff(bytes: Uint8Array): string | null {
  const is = (...sig: number[]) => sig.every((byte, index) => bytes[index] === byte);
  if (is(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (is(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (is(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (is(0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (is(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512))).replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<\?xml\b[^>]*>\s*)?(?:<!DOCTYPE\b[^>]*>\s*)?<svg\b/i.test(head)) return 'image/svg+xml';
  return null;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type ReadResult =
  | { ok: true; bytes: Uint8Array; url: string }
  | { ok: false; failure: FaviconFailure };

/** Up to `limit` bytes; longer bodies are cut (`truncate`) or refused. Redirects stay on https and on a public-looking host. */
async function read(url: string, fetcher: typeof fetch, limit: number, truncate: boolean, timeoutMs = 2500): Promise<ReadResult> {
  let response: Response | null = null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetcher(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual',
        headers: { 'User-Agent': 'LastfindFavicon/1.0', Accept: 'image/*,text/html;q=0.8,*/*;q=0.5' },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      response = null;
      if (!location) return { ok: false, failure: 'not-found' };
      try {
        const next = new URL(location, url);
        if (next.protocol !== 'https:' || next.username || next.password || !faviconHost(next.hostname))
          return { ok: false, failure: 'blocked' };
        url = next.href;
      } catch {
        return { ok: false, failure: 'not-found' };
      }
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, failure: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'offline' };
  }
  // More redirects than we follow: the site answered, we only did not go on.
  if (!response) return { ok: false, failure: 'blocked' };
  if (response.status === 403 || response.status === 429 || response.status === 503) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, failure: 'blocked' };
  }
  // Cloudflare's origin errors (520–530: no DNS, refused, timed out) say the site did not answer, like a failed connection.
  if (response.status >= 520 && response.status <= 530) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, failure: 'offline' };
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, failure: 'not-found' };
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(limit);
  let size = 0;
  while (size <= limit) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value.subarray(0, limit - size), size);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  if (size > limit && !truncate) return { ok: false, failure: 'oversized' };
  // A copy: a view would keep the whole `limit` buffer alive in the cache.
  return { ok: true, bytes: bytes.slice(0, Math.min(size, limit)), url };
}

const attribute = (tag: string, name: string) => {
  const found = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return found ? (found[1] ?? found[2] ?? found[3] ?? '') : null;
};

/**
 * How far a declared icon is from what a row draws (18 px, 32 px on dense screens): the smallest size from 32 to 64 is best,
 * then an icon of unknown size (usually a favicon.ico), then a bigger one, then a smaller one; an Apple touch icon (180 px,
 * often 20 KB or more) only when nothing else is declared. `fluid-icon` and `mask-icon` (a one-colour stencil) are not icons.
 */
function iconCost(tag: string) {
  const rel = (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
  const touch = rel.some((token) => token.startsWith('apple-touch-icon'));
  if (!rel.includes('icon') && !touch) return null;
  const widths = [...(attribute(tag, 'sizes') ?? '').matchAll(/(\d+)x\d+/gi)].map((match) => Number(match[1]));
  const cost = (width: number) => (width >= 32 && width <= 64 ? width - 32 : width > 64 ? width : 2000 - width);
  return (touch ? 10_000 : 0) + (widths.length ? Math.min(...widths.map(cost)) : 50);
}

function declared(html: string, base: string) {
  let best: { url: string; cost: number } | null = null;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const cost = iconCost(tag);
    const value = attribute(tag, 'href');
    if (cost === null || !value || (best && best.cost <= cost)) continue;
    try {
      const url = new URL(value.replace(/&amp;/g, '&'), base);
      const host = faviconHost(url.hostname);
      if (url.protocol === 'https:' && !url.username && !url.password && host) best = { url: url.href, cost };
    } catch {
      /* Try the next declaration. */
    }
  }
  return best?.url ?? null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const text = (value: string | null | undefined) =>
  value
    ?.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
      const point = Number(code[1].toLowerCase() === 'x' ? `0${code.slice(1)}` : code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || null;

/** The names a home page gives itself: its `<title>` and `og:site_name` / `application-name`. */
export function pageNames(html: string) {
  const title = /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const meta = (html.match(/<meta\b[^>]*>/gi) ?? []).find((tag) => /^(?:og:site_name|application-name)$/i.test(attribute(tag, 'property') ?? attribute(tag, 'name') ?? ''));
  return { title: text(title), siteName: text(meta ? attribute(meta, 'content') : null) };
}

/**
 * A favicon.ico usually packs every size (16 to 256 px, up to 100 KB and more); a row draws one. The copy we keep is the
 * one image closest above 32 px (else the biggest), as a one-image .ico. Anything that does not parse is kept as it came.
 */
export function smallestIco(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength >= 6 ? view.getUint16(4, true) : 0;
  if (count < 2 || bytes.byteLength < 6 + 16 * count) return bytes;
  let pick = -1, pickCost = Infinity;
  for (let index = 0; index < count; index++) {
    const at = 6 + 16 * index;
    const width = bytes[at] || 256;
    const size = view.getUint32(at + 8, true), offset = view.getUint32(at + 12, true);
    if (!size || offset + size > bytes.byteLength) return bytes;
    // Closest above 32 px, the deepest colours on a tie; below 32 px only when nothing is bigger.
    const cost = (width >= 32 ? width : 1000 - width) * 64 - view.getUint16(at + 6, true);
    if (cost < pickCost) [pick, pickCost] = [index, cost];
  }
  const at = 6 + 16 * pick;
  const size = view.getUint32(at + 8, true), offset = view.getUint32(at + 12, true);
  const out = new Uint8Array(22 + size);
  out.set(bytes.subarray(0, 4));
  out[4] = 1;
  out.set(bytes.subarray(at, at + 12), 6);
  new DataView(out.buffer).setUint32(18, 22, true);
  out.set(bytes.subarray(offset, offset + size), 22);
  return out;
}

async function asIcon(bytes: Uint8Array | null): Promise<Icon | null> {
  if (!bytes?.length) return null;
  const type = sniff(bytes);
  return type ? { image: type === 'image/x-icon' ? smallestIco(bytes) : bytes, type } : null;
}

async function googleFallback(host: string, fetcher: typeof fetch): Promise<{ icon: Icon | null; failure: FaviconFailure | null }> {
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  const result = await read(url, fetcher, MAX_BYTES, false);
  if (!result.ok) return { icon: null, failure: result.failure };
  if ((await sha256Hex(result.bytes)) === GOOGLE_GLOBE_SHA256) return { icon: null, failure: 'generic-google' };
  const icon = await asIcon(result.bytes);
  return icon ? { icon, failure: null } : { icon: null, failure: 'not-found' };
}

/** `pageTimeoutMs`: a background read of the site (domain discovery) waits longer for its home page than a screen's icon. */
async function fetchIcon(host: string, fetcher: typeof fetch, pageTimeoutMs = 2500): Promise<FaviconProbe> {
  let lastFailure: FaviconFailure = 'not-found';
  let site: SiteFacts = { reachable: false, host, title: null, siteName: null };
  try {
    const page = await read(`https://${host}/`, fetcher, 65_536, true, pageTimeoutMs);
    const html = page.ok ? new TextDecoder().decode(page.bytes) : '';
    if (!page.ok) lastFailure = page.failure;
    // A site that answered at all exists, even when it blocks robots or has no page at its root; only one that could not be
    // reached (no address, refused) does not. A slow one is not held against it (on a busy moment the read times out).
    site = {
      reachable: page.ok || page.failure !== 'offline',
      host: page.ok ? (faviconHost(new URL(page.url).hostname) ?? host) : host,
      ...pageNames(html),
    };
    const declaredUrl = html && page.ok ? declared(html, page.url) : null;
    const candidates: { url: string; source: FaviconSource }[] = [
      ...(declaredUrl ? [{ url: declaredUrl, source: 'declared' as const }] : []),
      { url: `https://${host}/favicon.ico`, source: 'favicon.ico' },
    ];

    for (const candidate of candidates) {
      const result = await read(candidate.url, fetcher, MAX_BYTES, false);
      if (!result.ok) {
        lastFailure = result.failure;
        continue;
      }
      const icon = await asIcon(result.bytes);
      if (icon) return { host, icon, source: candidate.source, failure: null, site };
      lastFailure = 'not-found';
    }

    const google = await googleFallback(host, fetcher);
    if (google.icon) return { host, icon: google.icon, source: 'google', failure: null, site };
    return { host, icon: null, source: null, failure: google.failure ?? lastFailure, site };
  } catch {
    return { host, icon: null, source: null, failure: 'offline', site };
  }
}

function remember(host: string, icon: Icon | null, expires: number) {
  const old = cache.get(host);
  if (old) cacheBytes -= old.icon?.image.byteLength ?? 0;
  cache.delete(host);
  cacheBytes += icon?.image.byteLength ?? 0;
  cache.set(host, { icon, expires });
  // Oldest first, by entries and by bytes.
  while (cache.size > MAX_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
    const first = cache.keys().next().value!;
    cacheBytes -= cache.get(first)?.icon?.image.byteLength ?? 0;
    cache.delete(first);
  }
}

type Stored = { icon: Icon | null; fetchedAt: number };
async function readStored(store: FaviconStore, host: string): Promise<Stored | null> {
  const object = await store.get(STORE_PREFIX + host);
  if (!object) return null;
  const fetchedAt = Date.parse(object.customMetadata?.fetchedAt ?? '');
  if (!Number.isFinite(fetchedAt)) return null;
  if (object.customMetadata?.state === 'missing') return { icon: null, fetchedAt };
  const image = new Uint8Array(await object.arrayBuffer());
  const type = sniff(image);
  // Copies kept before icons were trimmed are trimmed as they are read.
  return type && image.byteLength <= MAX_BYTES ? { icon: { image: type === 'image/x-icon' ? smallestIco(image) : image, type }, fetchedAt } : null;
}
function writeStored(store: FaviconStore, host: string, icon: Icon | null, now: number) {
  return store.put(STORE_PREFIX + host, icon ? icon.image : new Uint8Array(0), {
    httpMetadata: icon ? { contentType: icon.type } : undefined,
    customMetadata: { state: icon ? 'icon' : 'missing', fetchedAt: new Date(now).toISOString() },
  });
}
/** Reads the site, keeps a definitive answer in the bucket (a failed refresh never replaces a good copy). */
async function lookup(host: string, fetcher: typeof fetch, now: number, store: FaviconStore | null | undefined, keep: Icon | null, pageTimeoutMs?: number) {
  const probe = await fetchIcon(host, fetcher, pageTimeoutMs);
  const definitive = probe.icon || (probe.failure && DEFINITIVE.includes(probe.failure));
  if (store && definitive && !(keep && !probe.icon)) await writeStored(store, host, probe.icon, now).catch(() => undefined);
  return probe;
}

export async function brandFavicon(
  domain: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  { store, defer }: FaviconOptions = {},
): Promise<Icon | null> {
  const host = faviconHost(domain);
  if (!host) return null;
  const saved = cache.get(host);
  if (saved && saved.expires > now) return saved.icon;
  // One lookup per host at a time, however many tabs ask (an image request the browser dropped still finishes it: `defer`).
  return shareFlight(pending, host, async () => {
    const stored = store ? await readStored(store, host).catch(() => null) : null;
    const age = stored ? now - stored.fetchedAt : Infinity;
    if (stored && age < (stored.icon ? FAVICON_STALE_MS : FAVICON_MISSING_MS)) {
      // An older icon is still served; one background read replaces it.
      if (stored.icon && age >= FAVICON_FRESH_MS) {
        const refresh = lookup(host, fetcher, now, store, stored.icon).catch(() => undefined);
        if (defer) defer(refresh);
      }
      remember(host, stored.icon, now + (stored.icon ? SUCCESS_TTL : FAILURE_TTL));
      return stored.icon;
    }
    const probe = await lookup(host, fetcher, now, store, null);
    remember(host, probe.icon, now + (probe.icon ? SUCCESS_TTL : FAILURE_TTL));
    return probe.icon;
  }, defer ?? (() => {}));
}

/**
 * Reads a brand's site once, in the background (domain discovery): what its home page says (to confirm the site exists and
 * is the brand's) and its icon, which is kept in the bucket and this isolate's memory so the first screen that draws it
 * never waits for the brand's server. A good stored icon is never replaced by a failed read.
 */
/**
 * A brand's home page (or another page of its site, `path`) as text (up to 400 KB, 6 s), on the same guarded path as its icon (https,
 * public host); null when it does not answer.
 */
export async function readHome(domain: string, fetcher: typeof fetch = fetch, path = '/') {
  const host = faviconHost(domain);
  if (!host || !path.startsWith('/') || path.startsWith('//')) return null;
  const page = await read(`https://${host}${path}`, fetcher, 400_000, true, 6000);
  return page.ok ? new TextDecoder().decode(page.bytes) : null;
}

export async function probeSite(domain: string, fetcher: typeof fetch = fetch, now = Date.now(), store?: FaviconStore | null) {
  const host = faviconHost(domain);
  if (!host) return null;
  const stored = store ? await readStored(store, host).catch(() => null) : null;
  const probe = await lookup(host, fetcher, now, store, stored?.icon ?? null, 6000);
  const icon = probe.icon ?? stored?.icon ?? null;
  remember(host, icon, now + (icon ? SUCCESS_TTL : FAILURE_TTL));
  return { host, site: probe.site!, icon: !!icon };
}

/** Uncached probe with accurate source/failure for the measurement script. */
export async function measureBrandFavicon(domain: string, fetcher: typeof fetch = fetch): Promise<FaviconProbe> {
  const host = faviconHost(domain);
  if (!host) return { host: null, icon: null, source: null, failure: 'invalid-host' };
  return fetchIcon(host, fetcher);
}

export function resetFaviconCache() {
  cache.clear();
  pending.clear();
  cacheBytes = 0;
}

export async function faviconResponse(
  readUser: () => Promise<unknown>,
  domain: string,
  fetcher: typeof fetch = fetch,
  options: FaviconOptions = {},
) {
  // The icon is the same for every signed-in person, so it does not vary by cookie; a 401 is never kept.
  const headers = { 'X-Content-Type-Options': 'nosniff' };
  const scope = options.shared ? 'public' : 'private';
  try {
    if (!(await readUser()))
      return new Response(null, { status: 401, headers: { ...headers, 'Cache-Control': 'private, no-store' } });
    const icon = await brandFavicon(domain, fetcher, Date.now(), options);
    if (!icon)
      return new Response(null, { status: 404, headers: { ...headers, 'Cache-Control': `${scope}, ${BROWSER_MISSING}` } });
    return new Response(icon.image as BodyInit, {
      headers: {
        ...headers,
        'Content-Type': icon.type,
        'Cache-Control': `${scope}, ${BROWSER_ICON}`,
        ...(icon.type === 'image/svg+xml' ? { 'Content-Security-Policy': SVG_CSP } : {}),
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: { ...headers, 'Cache-Control': 'private, no-store' } });
  }
}
