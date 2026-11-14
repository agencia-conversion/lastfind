import { brandLabel, registrableDomain } from './brand-domain.ts';
import { mentionText, namePattern } from './metrics.ts';
import type { Citation } from './types.ts';

/**
 * The pages an AI answer cites, read for one marked name (v13, sources): an AI often copies a listicle, and the listicle's
 * entry says whose business the name is. The page is reduced once (`pageDigest`: its language, title, text and links, bounded)
 * and kept for every project (lib/server/cited-sources.ts); each question then looks for the name in it (`sourceEntries`).
 * An entry that links to the card's own domain is the card's business; one that links to another site whose name spells
 * it is that business (a same-named one); one without a link is only evidence, with the page's market cues. No word list:
 * the cues are the page's language, its host's country code and the card's country named in the page (in the page's
 * language or the card's).
 */

/** Pages read per answer, and what one page may take. */
export const SOURCE_PAGES_PER_ANSWER = 4;
export const SOURCE_PAGE_MAX_BYTES = 1_500_000;
export const SOURCE_PAGE_TIMEOUT_MS = 6000;
const TEXT_MAX = 100_000;
const LINKS_MAX = 400;
const NEAR = 300;

export type PageDigest = { lang: string; title: string; text: string; links: { text: string; href: string; at: number }[] };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Linear: one pass, no nested quantifier.
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/giu, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });

/** Whether a robots header asks not to index. */
export const headerNoindex = (header: string) => /noindex/iu.test(header.slice(0, 2000));

/** Elements whose content is never text. */
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object']);
/** Elements that end a line. */
const BLOCKS = new Set(['br', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'tr', 'section', 'article', 'dt', 'dd', 'td', 'th', 'blockquote', 'ol', 'ul', 'table', 'header', 'footer', 'nav', 'main', 'aside']);
const TAG_MAX = 4000;
const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]{0,2000})"|'([^']{0,2000})'|([^\\s"'>]{1,2000}))`, 'iu').exec(tag);
  return match ? decode(match[1] ?? match[2] ?? match[3] ?? '') : null;
};

/**
 * A page as the checks keep it, in one linear scan (indexOf from tag to tag, never a pattern over the whole body): its
 * language (`<html lang>`), title, visible text with one line per block, the links (anchor text, absolute address and where
 * the anchor sits in `text`), and whether a robots meta tag asks not to index it; bounded. Scripts, styles, comments and the
 * like are skipped; a tag longer than TAG_MAX ends the scan.
 */
export function scanPage(html: string, url: string): { digest: PageDigest; noindex: boolean } {
  // ASCII letters only, so every offset in `lower` is the same in `html`.
  const lower = html.replace(/[A-Z]+/gu, (letters) => letters.toLowerCase());
  const links: PageDigest['links'] = [];
  let text = '';
  let lang = '';
  let title = '';
  let noindex = false;
  // The text is built piece by piece, already normalized (one space, one line per block), so each link's offset holds.
  const add = (piece: string) => {
    if (text.length >= TEXT_MAX) return;
    let part = piece.replace(/[ \t\f\v\r\n]+/gu, (space) => (space.includes('\n') ? ' ' : ' '));
    if (!text || text.endsWith(' ') || text.endsWith('\n')) part = part.replace(/^ +/u, '');
    text += part;
  };
  const line = () => {
    text = text.replace(/ $/u, '');
    if (text && !text.endsWith('\n')) text += '\n';
  };
  let anchor: { href: string | null; at: number } | null = null;
  let at = 0;
  while (at < html.length && text.length < TEXT_MAX) {
    const open = html.indexOf('<', at);
    add(decode(html.slice(at, open < 0 ? html.length : open)));
    if (open < 0) break;
    if (lower.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      at = close < 0 ? html.length : close + 3;
      continue;
    }
    const close = html.indexOf('>', open + 1);
    if (close < 0 || close - open > TAG_MAX) break;
    const tag = html.slice(open, close + 1);
    const name = /^<\/?([a-z][a-z0-9-]{0,30})/iu.exec(tag)?.[1]?.toLowerCase() ?? '';
    const ending = tag[1] === '/';
    at = close + 1;
    if (!name) continue;
    if (!ending && SKIPPED.has(name)) {
      const end = lower.indexOf(`</${name}`, at);
      const after = end < 0 ? -1 : html.indexOf('>', end);
      at = after < 0 ? html.length : after + 1;
      continue;
    }
    if (!ending && name === 'title') {
      const end = lower.indexOf('</title', at);
      if (!title) title = decode(html.slice(at, end < 0 ? Math.min(html.length, at + 1000) : end)).replace(/\s+/gu, ' ').trim().slice(0, 300);
      const after = end < 0 ? -1 : html.indexOf('>', end);
      at = after < 0 ? html.length : after + 1;
      continue;
    }
    if (!ending && name === 'html' && !lang) lang = (/^[a-z]{2,3}/iu.exec(attribute(tag, 'lang') ?? '')?.[0] ?? '').toLowerCase();
    if (!ending && name === 'meta' && (attribute(tag, 'name') ?? '').toLowerCase() === 'robots' && /noindex/iu.test(attribute(tag, 'content') ?? '')) noindex = true;
    if (BLOCKS.has(name)) line();
    if (name === 'a') {
      if (!ending) {
        add(' ');
        anchor = { href: attribute(tag, 'href'), at: text.length };
      } else if (anchor) {
        const label = text.slice(anchor.at).replace(/\s+/gu, ' ').trim();
        if (label && anchor.href && links.length < LINKS_MAX)
          try {
            const absolute = new URL(anchor.href, url);
            if (absolute.protocol === 'http:' || absolute.protocol === 'https:') links.push({ text: label.slice(0, 120), href: absolute.href.slice(0, 300), at: anchor.at });
          } catch {
            // An address that does not parse is no link.
          }
        anchor = null;
        add(' ');
      }
    }
  }
  return { digest: { lang, title, text: text.trim().slice(0, TEXT_MAX), links }, noindex };
}
/** The digest alone (see scanPage). */
export const pageDigest = (html: string, url: string) => scanPage(html, url).digest;

/**
 * Whether an address may be read: http or https on its default port, a public host name (lowercase, trailing dots dropped,
 * at least two labels and none empty, never an address in any notation, IPv6, localhost or a local or internal name). Every
 * redirect is checked again (lib/server/cited-sources.ts). Both editions run on Cloudflare Workers, whose `fetch` cannot
 * reach private networks, so a name that resolves to a private address is refused by the runtime; outside Workers this
 * check alone would not be enough (it would need to resolve each host and refuse private, loopback, link-local, CGNAT and
 * ULA addresses on every hop).
 */
export function publicAddress(value: string) {
  let address: URL;
  try {
    address = new URL(value);
  } catch {
    return null;
  }
  if ((address.protocol !== 'https:' && address.protocol !== 'http:') || address.port || address.username || address.password) return null;
  // Normalized first: lowercase, no trailing dot ("localhost." is localhost), no empty label.
  const host = address.hostname.toLowerCase().replace(/\.+$/u, '');
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((label) => !label) || host.startsWith('[') || host.includes(':')) return null;
  // An address in any notation (decimal, octal, hex, dotted or not): a numeric last label is never a public name.
  if (/^(0x[0-9a-f]*|\d+)$/u.test(labels.at(-1)!)) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|arpa)$/u.test(host)) return null;
  address.hostname = host;
  address.hash = '';
  return address;
}

export type SourceEntry = {
  url: string;
  title: string;
  /** own: the entry links to the card's domain; homonym: to another site whose name spells it; other: another site; null: no link. */
  link: 'own' | 'homonym' | 'other' | null;
  linked_domain: string | null;
  /** The entry and what surrounds it on the page (the list item or paragraph), bounded. */
  near: string;
  page_language: string;
  page_country_code: string | null;
  /** The card's country is named on the page (its title or the entry's surroundings). */
  names_card_country: boolean;
};

/** The two-letter country code of a host, when its top level domain is one (".com.br" → "br"), else null. */
const hostCountry = (host: string) => {
  const last = host.toLowerCase().split('.').at(-1) ?? '';
  return /^[a-z]{2}$/u.test(last) ? last : null;
};
/** The country of `iso` named in these languages (Intl), for the page's market cue. */
export function countryNames(iso: string, languages: readonly string[]) {
  const names = new Set<string>();
  for (const language of languages)
    try {
      const name = new Intl.DisplayNames([language], { type: 'region' }).of(iso.toUpperCase());
      if (name && name.toUpperCase() !== iso.toUpperCase()) names.add(name);
    } catch {
      // A language Intl does not know names nothing.
    }
  return [...names];
}

/**
 * The entries for `name` on a page: each place its text holds the name as a whole word, with the link on or right around
 * it, the block around it and the page's market cues. At most three entries a page; linked ones first.
 */
export function sourceEntries(digest: PageDigest, url: string, name: string, card: { domains: readonly string[]; country: string | null; language?: string }): SourceEntry[] {
  const own = new Set(card.domains.map((domain) => registrableDomain(domain)));
  const label = brandLabel(name);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${namePattern(name)}(?![\\p{L}\\p{N}])`, 'giu');
  const folded = mentionText(digest.text);
  const pageHost = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const countries = card.country ? countryNames(card.country, [digest.lang || 'en', card.language || 'en', 'en']) : [];
  const namesCountry = (text: string) => countries.some((country) => mentionText(text).includes(mentionText(country)));
  const entries: SourceEntry[] = [];
  const seenBlocks = new Set<number>();
  for (const match of folded.matchAll(pattern)) {
    const at = match.index;
    // Part of a longer name ("Conversion Sciences"): another organization's, not an entry for this one.
    if (/^ \p{Lu}/u.test(digest.text.slice(at + match[0].length, at + match[0].length + 2))) continue;
    // The entry: from its line's start, through what follows it (a heading's description), bounded.
    const start = Math.max(digest.text.lastIndexOf('\n', at) + 1, at - NEAR);
    const end = Math.min(digest.text.length, at + match[0].length + NEAR);
    if (seenBlocks.has(start)) continue;
    seenBlocks.add(start);
    // The link on the name, else one in the same block whose text or address spells the name.
    const inBlock = digest.links.filter((link) => link.at >= start - 2 && link.at <= end);
    const onName = inBlock.find((link) => link.at <= at + match[0].length && link.at + link.text.length >= at - 1);
    const spelled = inBlock.find((link) => brandLabel(link.text).includes(label) || brandLabel(hostOf(link.href).split('.')[0] ?? '') === label);
    const link = onName ?? spelled ?? null;
    const host = link ? hostOf(link.href) : '';
    const domain = host ? registrableDomain(host) : null;
    const kind: SourceEntry['link'] = !domain || domain === registrableDomain(pageHost)
      ? null
      : own.has(domain)
        ? 'own'
        : brandLabel(domain.split('.')[0] ?? '') === label
          ? 'homonym'
          : 'other';
    const near = digest.text.slice(start, end).replace(/\s+/gu, ' ').trim();
    entries.push({
      url,
      title: digest.title,
      link: kind,
      linked_domain: kind ? domain : null,
      near,
      page_language: digest.lang,
      page_country_code: hostCountry(pageHost),
      names_card_country: namesCountry(`${digest.title}\n${near}`),
    });
  }
  // Linked entries first, then those that open their line (a list item or heading: "6. Conversion"), then the rest.
  const heads = (entry: SourceEntry) => /^[\s\d.)#*>-]*$/u.test(mentionText(entry.near).split(mentionText(name))[0] ?? 'x');
  return entries.sort((a, b) => Number(!a.link) - Number(!b.link) || Number(!heads(a)) - Number(!heads(b))).slice(0, 3);
}
const hostOf = (href: string) => {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./u, '');
  } catch {
    return '';
  }
};

/**
 * What the cited pages settle, only from the links code read (never from a page's text): counted when an entry links the
 * name to the card's own domain and no cited page links it to any other domain; not when one links it to a same-named site
 * and none to the card's; `conflict` when one links to the card's and another elsewhere (an operator decides); otherwise
 * nothing (the entries go to the reader as evidence).
 */
export function sourcesVerdict(entries: readonly SourceEntry[]): 'counted' | 'not' | 'conflict' | null {
  const own = entries.some((entry) => entry.link === 'own');
  const elsewhere = entries.some((entry) => entry.link === 'homonym' || entry.link === 'other');
  const homonym = entries.some((entry) => entry.link === 'homonym');
  return own ? (elsewhere ? 'conflict' : 'counted') : homonym ? 'not' : null;
}

/**
 * The entries as the reader may see them: the facts code read (the link's kind and domain, the page's host, language and
 * country code, the card's country named) and the page's text only as delimited, untrusted evidence, never quotable.
 */
export function readerEvidence(entries: readonly SourceEntry[]) {
  return entries.slice(0, 6).map((entry) => ({
    page_host: (() => {
      try {
        return new URL(entry.url).hostname;
      } catch {
        return '';
      }
    })(),
    link: entry.link,
    linked_domain: entry.linked_domain,
    page_language: entry.page_language,
    page_country_code: entry.page_country_code,
    names_card_country: entry.names_card_country,
    untrusted_page_text: `<<<${entry.near.replace(/<<<|>>>/gu, ' ').slice(0, 300)}>>>`,
  }));
}

/**
 * The cited sources that bear on the marked passage: those its footnotes point to ("[2]", "[[2]]", in the line that holds
 * the marked name), else all of them; at most SOURCE_PAGES_PER_ANSWER, web pages only.
 */
export function passageSources(excerpt: string, sources: readonly Citation[]) {
  const at = excerpt.indexOf('⟦');
  const lineStart = excerpt.lastIndexOf('\n', at) + 1;
  const lineEnd = excerpt.indexOf('\n', at);
  const line = excerpt.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  const marked = [...line.matchAll(/\[\[?(\d{1,3})\]\]?/gu)].map((match) => Number(match[1]) - 1).filter((index) => index >= 0 && index < sources.length);
  const web = (source: Citation | undefined) => !!source && /^https?:\/\//u.test(source.url);
  const chosen = marked.length ? [...new Set(marked)].map((index) => sources[index]!).filter(web) : [];
  return (chosen.length ? chosen : sources.filter(web)).slice(0, SOURCE_PAGES_PER_ANSWER);
}

/** Whether robots.txt lets `agent` read `path`: the longest matching Allow or Disallow of its group, else of `*`. */
export function robotsAllows(robots: string, agent: string, path: string) {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.slice(0, 200_000).split(/\r?\n/u)) {
    const line = raw.replace(/#.*$/u, '').trim();
    const [key, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const field = key?.trim().toLowerCase();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      lastWasAgent = false;
      // Bounded: at most ROBOTS_RULES rules of ROBOTS_RULE_MAX characters, repeated wildcards collapsed.
      if (value && value.length <= ROBOTS_RULE_MAX && current.rules.length < ROBOTS_RULES) current.rules.push({ allow: field === 'allow', path: value.replace(/\*+/gu, '*') });
    } else if (line) lastWasAgent = false;
  }
  const mine = groups.find((group) => group.agents.some((name) => name !== '*' && agent.toLowerCase().includes(name))) ?? groups.find((group) => group.agents.includes('*'));
  if (!mine) return true;
  const best = mine.rules.filter((rule) => wildcardMatch(rule.path, path)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0];
  return best ? best.allow : true;
}

const ROBOTS_RULES = 200;
const ROBOTS_RULE_MAX = 512;
/**
 * A robots.txt rule against a path, linear: the rule's pieces between `*` are found in order, the first at the start, and a
 * final `$` anchors the end.
 */
export function wildcardMatch(rule: string, path: string) {
  const anchored = rule.endsWith('$');
  const pieces = (anchored ? rule.slice(0, -1) : rule).split('*');
  if (!path.startsWith(pieces[0]!)) return false;
  let at = pieces[0]!.length;
  for (let index = 1; index < pieces.length; index++) {
    const piece = pieces[index]!;
    if (index === pieces.length - 1 && anchored) return path.length - piece.length >= at && path.endsWith(piece);
    const found = path.indexOf(piece, at);
    if (found < 0) return false;
    at = found + piece.length;
  }
  return !anchored || at === path.length;
}
