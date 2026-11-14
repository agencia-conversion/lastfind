import {
  SOURCE_PAGE_MAX_BYTES,
  SOURCE_PAGE_TIMEOUT_MS,
  headerNoindex,
  passageSources,
  publicAddress,
  scanPage,
  robotsAllows,
  sourceEntries,
  sourcesVerdict,
  type PageDigest,
  type SourceEntry,
} from '@/lib/cited-sources';
import type { Citation } from '@/lib/types';
import { db, now, setting } from './env';
// Its own digest, so the agent's tools (which read this store) do not load the decision jobs.
const hash = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** How the checks name themselves to the sites they read. */
export const SOURCE_AGENT = 'LastfindBot/1.0 (+https://lastfind.ai)';
const ROBOTS_MAX_BYTES = 200_000;

type Kept = { status: string; origin: string; content_json: string | null; fetched_at: string; expires_at: string };
const DAY_MS = 86_400_000;
/**
 * How long a page read stays in the shared store: `SOURCE_PAGE_TTL_DAYS` (a server setting), 30 days by default, 1 to 90.
 * A page that could not be read, and a robots.txt, are asked again after SOURCE_PAGE_FAILURE_DAYS.
 */
export const pageTtlDays = () => {
  const days = Math.round(Number(setting('SOURCE_PAGE_TTL_DAYS') || 30));
  return Number.isFinite(days) ? Math.min(90, Math.max(1, days)) : 30;
};
export const SOURCE_PAGE_FAILURE_DAYS = 7;
/** The store's key of a normalized address. */
export const pageKey = async (address: URL) => hash(`page:${address.href}`);

/** A response's body up to `max` bytes, or null when it is longer (the rest is never read). */
async function boundedText(response: Response, max: number) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) all.set(chunk, (at += chunk.byteLength) - chunk.byteLength);
  return new TextDecoder().decode(all);
}

/** A stored row that has not expired, or null. */
async function kept(key: string) {
  const row = await db().prepare('SELECT status,origin,content_json,fetched_at,expires_at FROM source_pages WHERE url_key=?').bind(key).first<Kept>();
  return row && row.expires_at > now() ? row : null;
}
/** Stores a page read (or why it could not be), with its time to live: pageTtlDays when read, 7 days otherwise. */
async function keep(key: string, url: string, status: string, content: { digest?: PageDigest | null; text?: string; finalUrl?: string; bytes?: number; origin?: 'fetch' | 'agent' } = {}) {
  const json = content.text ?? (content.digest ? JSON.stringify(content.digest) : null);
  const stamp = now();
  // A robots.txt (`text`) is asked again sooner, like a page that could not be read.
  const days = status === 'ok' && content.text === undefined ? pageTtlDays() : SOURCE_PAGE_FAILURE_DAYS;
  await db()
    .prepare(
      `INSERT INTO source_pages(url_key,url,final_url,title,language,status,origin,bytes,content_sha256,content_json,fetched_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(url_key) DO UPDATE SET url=excluded.url,final_url=excluded.final_url,title=excluded.title,language=excluded.language,status=excluded.status,origin=excluded.origin,
       bytes=excluded.bytes,content_sha256=excluded.content_sha256,content_json=excluded.content_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`,
    )
    .bind(
      key,
      url.slice(0, 2000),
      content.finalUrl?.slice(0, 2000) ?? null,
      content.digest?.title.slice(0, 300) ?? null,
      content.digest?.lang.slice(0, 8) ?? null,
      status,
      content.origin ?? 'fetch',
      content.bytes ?? null,
      json ? await hash(json) : null,
      json ? json.slice(0, 400_000) : null,
      stamp,
      new Date(Date.parse(stamp) + days * DAY_MS).toISOString(),
    )
    .run();
}
/** That a stored page served a reading (instead of a fetch or a paid read): by whom, for which project. */
async function used(key: string, purpose: 'mentions' | 'agent', projectId: string | null) {
  const stamp = now();
  await db()
    .batch([
      db().prepare('UPDATE source_pages SET used_at=?,uses=uses+1 WHERE url_key=?').bind(stamp, key),
      db().prepare('INSERT INTO source_page_uses(url_key,used_at,purpose,project_id) VALUES(?,?,?,?)').bind(key, stamp, purpose, projectId),
    ])
    .catch(() => {});
}

/** Redirects followed by hand, each address checked again (`publicAddress`). */
const REDIRECTS_MAX = 3;
/**
 * A GET of a public address that follows at most REDIRECTS_MAX redirects itself, checking every Location again: a page can
 * never send the Worker to a local, internal or literal address, another port or another scheme. Null when refused.
 */
export async function publicFetch(value: string, headers: Record<string, string>, deadline: number) {
  let address = publicAddress(value);
  for (let hop = 0; address && hop <= REDIRECTS_MAX; hop++) {
    const response = await fetch(address.href, { headers, redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (response.status < 300 || response.status >= 400) return response;
    await response.body?.cancel().catch(() => {});
    const location = response.headers.get('location');
    address = location ? publicAddress(new URL(location, address).href) : null;
  }
  return null;
}

/** The site's robots.txt (kept like a page, under its origin); empty when it has none or it cannot be read. */
async function robotsOf(origin: string) {
  const key = await hash(`robots:${origin}`);
  const row = await kept(key);
  if (row) return row.content_json ?? '';
  let text = '';
  try {
    const response = await publicFetch(`${origin}/robots.txt`, { 'user-agent': SOURCE_AGENT }, Date.now() + SOURCE_PAGE_TIMEOUT_MS);
    text = response?.ok ? ((await boundedText(response, ROBOTS_MAX_BYTES)) ?? '') : '';
  } catch {
    text = '';
  }
  await keep(key, `${origin}/robots.txt`, 'ok', { text: text.slice(0, 200_000) }).catch(() => {});
  return text;
}

/**
 * One cited page as a digest, read at most once per time to live for every project: robots.txt and a noindex are
 * respected, the read stops at SOURCE_PAGE_MAX_BYTES and SOURCE_PAGE_TIMEOUT_MS, and only HTML is read. Null when the page
 * could not be read (kept that way too, so it is not asked again until the time to live ends).
 */
export async function citedPage(url: string, projectId: string | null = null): Promise<PageDigest | null> {
  const address = publicAddress(url);
  if (!address) return null;
  const key = await pageKey(address);
  const row = await kept(key);
  // A page the agent's reader stored has no links: Lastfind reads it itself (free) and keeps that instead.
  if (row && row.origin === 'fetch') {
    if (row.status !== 'ok' || !row.content_json) return null;
    try {
      const digest = JSON.parse(row.content_json) as PageDigest;
      await used(key, 'mentions', projectId);
      return digest;
    } catch {
      return null;
    }
  }
  let finalUrl = address.href;
  let bytes = 0;
  const record = async (status: string, digest: PageDigest | null) => {
    await keep(key, address.href, status, { digest, finalUrl, bytes }).catch(() => {});
    return digest;
  };
  if (!robotsAllows(await robotsOf(address.origin), SOURCE_AGENT, address.pathname + address.search)) return record('robots', null);
  try {
    const response = await publicFetch(address.href, { 'user-agent': SOURCE_AGENT, accept: 'text/html,application/xhtml+xml' }, Date.now() + SOURCE_PAGE_TIMEOUT_MS);
    if (!response?.ok) {
      await response?.body?.cancel().catch(() => {});
      return record('failed', null);
    }
    if (!/html/iu.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel().catch(() => {});
      return record('not_html', null);
    }
    const html = await boundedText(response, SOURCE_PAGE_MAX_BYTES);
    if (html === null) return record('too_large', null);
    finalUrl = response.url || address.href;
    bytes = new TextEncoder().encode(html).byteLength;
    if (headerNoindex(response.headers.get('x-robots-tag') ?? '')) return record('noindex', null);
    // Failed first: a page whose reading stops the Worker is not read again until its time to live ends.
    await record('failed', null);
    const { digest, noindex } = scanPage(html, response.url || address.href);
    if (noindex) return record('noindex', null);
    // Bounded under the table's limit: the text gives way first.
    while (JSON.stringify(digest).length > 400_000 && digest.text.length > 1000) digest.text = digest.text.slice(0, Math.floor(digest.text.length * 0.8));
    return record('ok', digest);
  } catch {
    return record('failed', null);
  }
}

/**
 * What the cited pages say of the marked name of a question: the passage's sources (its footnotes, else all of them,
 * at most SOURCE_PAGES_PER_ANSWER), each read side by side, their entries for the name, and what they settle (see
 * `sourcesVerdict`). Never throws: a page that cannot be read adds nothing.
 */
export async function citedEvidence(
  excerpt: string,
  sources: readonly Citation[],
  name: string,
  card: { domains: readonly string[]; country: string | null; language?: string },
  projectId: string | null = null,
): Promise<{ entries: SourceEntry[]; verdict: ReturnType<typeof sourcesVerdict>; pages: number }> {
  const chosen = passageSources(excerpt, sources);
  const pages = await Promise.all(chosen.map((source) => citedPage(source.url, projectId).catch(() => null)));
  const entries = pages.flatMap((page, at) => (page ? sourceEntries(page, chosen[at]!.url, name, card) : []));
  return { entries, verdict: sourcesVerdict(entries), pages: pages.filter(Boolean).length };
}

/**
 * Public search data the agent paid for (Google results, volumes, keyword and domain data, backlinks), kept per workspace
 * (`search_data`): the key is a digest of the workspace, the path and its payload (keywords, country, language, depth, limit).
 * Never shared across workspaces: a free, dated hit would tell one workspace what another one searched (a competitor, say).
 * How long a reply stays good: Google results a day, volumes 30 days, other keyword, domain and backlink data 7 days; anything
 * else is not kept. v2: per workspace (v1, shared by request, never shipped).
 */
export const searchDataDays = (path: string) =>
  path.startsWith('serp/') ? 1 : /\/(keyword_overview|search_volume)\//.test(path) ? 30 : /^(dataforseo_labs|backlinks)\//.test(path) ? 7
    : path.startsWith('on_page/content_parsing/') ? pageTtlDays() : 0;
const stable = (value: unknown): string =>
  Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
      : JSON.stringify(value ?? null);
export const searchDataKey = (workspace: string, path: string, payload: unknown) => hash(`search:v2:${workspace}:${path}:${stable(payload)}`);
/** A stored reply that has not expired, with the day it was read; null when there is none (or the store cannot be read). */
export async function storedSearchData(workspace: string, path: string, payload: unknown) {
  if (!workspace || !searchDataDays(path)) return null;
  const row = await db()
    .prepare('SELECT result_json,read_at FROM search_data WHERE request_key=? AND expires_at>?')
    .bind(await searchDataKey(workspace, path, payload), now())
    .first<{ result_json: string; read_at: string }>()
    .catch(() => null);
  if (!row) return null;
  try {
    return { result: JSON.parse(row.result_json) as Record<string, unknown>, readAt: row.read_at };
  } catch {
    return null;
  }
}
/** Keeps a reply for the next request with the same path and payload (a failure to keep it changes nothing). */
export async function keepSearchData(workspace: string, path: string, payload: unknown, result: unknown) {
  const days = searchDataDays(path);
  const json = JSON.stringify(result);
  if (!workspace || !days || json.length > 400_000) return;
  const stamp = now();
  await db()
    .prepare(
      `INSERT INTO search_data(request_key,path,result_json,read_at,expires_at) VALUES(?,?,?,?,?)
       ON CONFLICT(request_key) DO UPDATE SET result_json=excluded.result_json,read_at=excluded.read_at,expires_at=excluded.expires_at`,
    )
    .bind(await searchDataKey(workspace, path, payload), path, json, stamp, new Date(Date.parse(stamp) + days * DAY_MS).toISOString())
    .run()
    .catch(() => {});
}
