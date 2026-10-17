// One page is one URL. The catalog key of a cited URL is this canonical form, so
// the same page cited with a tracking suffix, a text-fragment highlight, `www`,
// `http` or a trailing slash is stored, counted and classified once.
//
// Only what cannot change the page is removed: the fragment (browsers jump to
// `#:~:text=` passages, the server never sees it), click/campaign identifiers,
// `www.`, the scheme and trailing slashes. The path keeps its case and every
// other query parameter stays (`?v=` identifies a video), sorted so their order
// does not matter. The functions are idempotent. Dependency-free, so the Worker
// and the preview tooling share the same rule.

const TRACKING_PARAMETER =
  /^(utm_[a-z0-9_]*|gclid|gbraid|wbraid|dclid|fbclid|msclkid|msockid|yclid|twclid|ttclid|srsltid|igshid|mc_cid|mc_eid|mkt_tok|_ga|_gl|_hsenc|_hsmi)$/i;

/** The canonical URL of a page, or null when the value is not a public http(s) URL. */
export function canonicalSourceUrl(value) {
  if (typeof value !== 'string') return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  url.protocol = 'https:';
  url.hostname = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  url.hash = '';
  const query = new URLSearchParams([...url.searchParams].filter(([key]) => !TRACKING_PARAMETER.test(key)));
  query.sort();
  url.search = query.toString();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

/** The canonical domain key: lowercase host without `www.` and without a trailing dot. */
export const canonicalSourceDomain = (value) =>
  String(value ?? '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

/** The domain of a catalog URL. */
export const sourceUrlDomain = (url) => new URL(url).hostname.replace(/^www\./, '');

/**
 * A response's citation list with one entry per canonical URL (the first title
 * wins) and the domain recomputed from it. Entries without a usable URL stay as
 * they are, so no stored occurrence is ever dropped.
 * @param {{ url: string, domain: string, title: string }[]} list
 */
export function canonicalCitations(list) {
  const seen = new Set();
  const kept = [];
  for (const item of list) {
    const url = canonicalSourceUrl(item?.url);
    if (!url) {
      kept.push(item);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    kept.push({ ...item, url, domain: sourceUrlDomain(url) });
  }
  return kept;
}

/**
 * The stored JSON of a citation list in canonical form. Returns the same string
 * when nothing changes (so an already clean row is never rewritten) and passes
 * null or unreadable values through untouched.
 * @param {string | null | undefined} json
 */
export function canonicalCitationsJson(json) {
  if (typeof json !== 'string') return json;
  let list;
  try {
    list = JSON.parse(json);
  } catch {
    return json;
  }
  if (!Array.isArray(list)) return json;
  const next = JSON.stringify(canonicalCitations(list));
  return next === json ? json : next;
}
