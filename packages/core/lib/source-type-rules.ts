// Deterministic site types (ARCHITECTURE.md, "Source types and drill down"): decided before the catalog and the evaluator,
// read at request time, free and the same everywhere (Overview donut, Sources list and filter, domain pages, the queues
// that send work to the evaluator). A host a rule decides never reaches the provider. Changing these lists or their order
// is an algorithm change: bump SOURCE_TYPE_RULES_VERSION (it is part of the report cache key and the Algorithms basis).
import type { DomainType, PageType } from './source-types.ts';

// rules-v2 (8/11/2026): a site's root URL is its homepage (pageTypeRule).
export const SOURCE_TYPE_RULES_VERSION = 'rules-v2';

/**
 * Sites typed by name, including every subdomain (m.youtube.com, pt.wikipedia.org, folha.uol.com.br). High-volume and
 * unambiguous only: the evaluator types the long tail. A site never sits under another site (tested), so one host
 * matches at most one entry.
 */
const SITES: Record<Exclude<DomainType, 'other'>, string[]> = {
  social: [
    'youtube.com', 'youtu.be', 'facebook.com', 'fb.com', 'fb.watch', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com',
    'linkedin.com', 'pinterest.com', 'pinterest.co.uk', 'pinterest.ca', 'pinterest.com.au', 'pinterest.com.mx', 'threads.net',
    'threads.com', 'snapchat.com', 'tumblr.com', 'lemon8-app.com', 'kwai.com', 'twitch.tv', 'vimeo.com', 'dailymotion.com',
    'bsky.app', 'mastodon.social', 't.me', 'telegram.me', 'flickr.com', 'soundcloud.com', 'linktr.ee', 'behance.net',
    'dribbble.com', 'weibo.com', 'vk.com', 'bilibili.com', 'xiaohongshu.com', 'douyin.com', 't.co', 'lnkd.in', 'pin.it',
  ],
  ugc: [
    'reddit.com', 'redd.it', 'quora.com', 'stackoverflow.com', 'stackexchange.com', 'superuser.com', 'serverfault.com',
    'askubuntu.com', 'discord.com', 'discord.gg', 'medium.com', 'substack.com', 'vocal.media', 'hubpages.com', 'wattpad.com',
    'trustpilot.com', 'g2.com', 'capterra.com', 'capterra.com.br', 'getapp.com', 'softwareadvice.com', 'trustradius.com',
    'peerspot.com', 'sitejabber.com', 'yelp.com', 'tripadvisor.com', 'tripadvisor.com.br', 'tripadvisor.co.uk', 'glassdoor.com',
    'glassdoor.com.br', 'reclameaqui.com.br', 'producthunt.com', 'letterboxd.com', 'goodreads.com', 'brainly.com',
    'brainly.com.br', 'steamcommunity.com', 'slashdot.org', 'metafilter.com', 'mouthshut.com', 'github.com', 'gitlab.com',
    'dev.to', 'hashnode.com', 'myanimelist.net',
  ],
  reference: [
    'wikipedia.org', 'wikimedia.org', 'wiktionary.org', 'wikidata.org', 'wikihow.com', 'fandom.com', 'britannica.com',
    'imdb.com', 'crunchbase.com', 'merriam-webster.com', 'dictionary.com', 'dicio.com.br', 'significados.com.br',
    'todamateria.com.br', 'infoescola.com', 'grokipedia.com', 'archive.org', 'collinsdictionary.com', 'thesaurus.com',
    'oxfordlearnersdictionaries.com', 'priberam.org', 'priberam.pt', 'w3schools.com', 'statista.com', 'worldometers.info', 'readthedocs.io',
    'gitbook.io',
  ],
  press: [
    // International news organizations, agencies, broadcasters, news magazines and trade press.
    'nytimes.com', 'washingtonpost.com', 'wsj.com', 'reuters.com', 'apnews.com', 'bloomberg.com', 'ft.com', 'economist.com',
    'theguardian.com', 'bbc.com', 'bbc.co.uk', 'cnn.com', 'foxnews.com', 'nbcnews.com', 'cbsnews.com', 'abcnews.com', 'npr.org',
    'usatoday.com', 'latimes.com', 'nypost.com', 'chicagotribune.com', 'bostonglobe.com', 'sfchronicle.com', 'time.com',
    'newsweek.com', 'theatlantic.com', 'newyorker.com', 'axios.com', 'politico.com', 'thehill.com', 'vox.com', 'slate.com',
    'huffpost.com', 'businessinsider.com', 'insider.com', 'forbes.com', 'fortune.com', 'cnbc.com', 'marketwatch.com',
    'barrons.com', 'fastcompany.com', 'qz.com', 'theverge.com', 'techcrunch.com', 'wired.com', 'arstechnica.com',
    'variety.com', 'hollywoodreporter.com', 'deadline.com', 'thewrap.com', 'indiewire.com', 'rollingstone.com', 'billboard.com',
    'yahoo.com', 'msn.com', 'aljazeera.com', 'dw.com', 'france24.com', 'lemonde.fr', 'elpais.com', 'elmundo.es', 'clarin.com',
    'lanacion.com.ar', 'infobae.com', 'independent.co.uk', 'telegraph.co.uk', 'thetimes.co.uk', 'dailymail.co.uk', 'sky.com',
    'indiatimes.com', 'economictimes.com', 'hindustantimes.com', 'livemint.com', 'ndtv.com', 'abc.net.au', 'smh.com.au', 'scmp.com', 'espn.com',
    'theathletic.com', 'adage.com', 'adweek.com', 'cbc.ca', 'theglobeandmail.com', 'thehindu.com', 'detroitnews.com',
    'seattletimes.com', 'people.com', 'inc.com',
    // Brazil.
    'globo.com', 'uol.com.br', 'folha.com.br', 'estadao.com.br', 'exame.com', 'infomoney.com.br', 'cnnbrasil.com.br',
    'metropoles.com', 'terra.com.br', 'r7.com', 'band.com.br', 'abril.com.br', 'istoe.com.br', 'istoedinheiro.com.br',
    'cartacapital.com.br', 'correiobraziliense.com.br', 'gazetadopovo.com.br', 'em.com.br', 'otempo.com.br', 'clicrbs.com.br',
    'poder360.com.br', 'nexojornal.com.br', 'jovempan.com.br', 'sbt.com.br', 'opovo.com.br', 'ebc.com.br', 'seudinheiro.com',
    'moneytimes.com.br', 'meioemensagem.com.br', 'propmark.com.br', 'mobiletime.com.br', 'tecmundo.com.br', 'tecnoblog.net',
    'olhardigital.com.br', 'canaltech.com.br', 'neofeed.com.br', 'braziljournal.com', 'startups.com.br', 'ig.com.br',
    'estadodeminas.com.br', 'jornaldocommercio.com.br', 'diariodepernambuco.com.br', 'atarde.com.br', 'oantagonista.com.br',
    'bandnews.com.br', 'valor.com.br',
  ],
  editorial: [
    // Review, buying-guide and personal-finance publishers that the evaluator could take for a newsroom.
    'cnet.com', 'techradar.com', 'tomsguide.com', 'pcmag.com', 'nerdwallet.com', 'consumerreports.org', 'reviews.org',
    'prnewswire.com', 'businesswire.com', 'globenewswire.com', 'accessnewswire.com', 'einpresswire.com', 'prweb.com',
    'segs.com.br',
  ],
  corporate: [
    'google.com', 'google.com.br', 'apple.com', 'microsoft.com', 'amazon.com', 'amazon.com.br', 'amazon.co.uk', 'aboutamazon.com',
    'meta.com', 'samsung.com', 'netflix.com', 'hulu.com', 'disneyplus.com', 'primevideo.com', 'max.com', 'hbomax.com', 'hbo.com',
    'peacocktv.com', 'paramountplus.com', 'crunchyroll.com', 'spotify.com', 'deezer.com', 'mercadolivre.com.br',
    'mercadolibre.com', 'magazineluiza.com.br', 'americanas.com.br', 'casasbahia.com.br', 'shopee.com.br', 'aliexpress.com',
    'alibaba.com', 'ebay.com', 'walmart.com', 'target.com', 'bestbuy.com', 'hubspot.com', 'salesforce.com', 'semrush.com',
    'ahrefs.com', 'canva.com', 'rdstation.com', 'nubank.com.br', 'itau.com.br', 'bradesco.com.br', 'mercadopago.com.br',
    'ifood.com.br', 'youtube.tv', 'zendesk.com', 'freshdesk.com', 'myshopify.com',
  ],
  institutional: [
    'europa.eu', 'un.org', 'unesco.org', 'unicef.org', 'worldbank.org', 'imf.org', 'oecd.org', 'weforum.org', 'khanacademy.org',
    'usp.br', 'unicamp.br', 'unesp.br', 'ufrj.br', 'ufmg.br', 'ufrgs.br', 'unb.br', 'fgv.br', 'embrapa.br', 'fiocruz.br',
    'sebrae.com.br', 'pucsp.br', 'puc-rio.br', 'ufsc.br', 'ufpr.br', 'ufpe.br', 'ufba.br', 'ufc.br', 'senai.br', 'redcross.org',
    'nhs.uk', 'police.uk', 'gc.ca', 'canada.ca', 'gov.br',
  ],
};

/** Hosts typed on their own, ahead of every other rule: a product of a site typed otherwise, or a site inside a portal. */
const HOSTS: Record<string, DomainType> = {
  'tv.youtube.com': 'corporate',
  'music.youtube.com': 'corporate',
  'studio.youtube.com': 'corporate',
  'news.ycombinator.com': 'ugc',
  'globoplay.globo.com': 'corporate',
  'pagseguro.uol.com.br': 'corporate',
  'brasilescola.uol.com.br': 'reference',
  'mundoeducacao.uol.com.br': 'reference',
  'michaelis.uol.com.br': 'reference',
  'dictionary.cambridge.org': 'reference',
  'learn.microsoft.com': 'reference',
  'scholar.google.com': 'reference',
  'books.google.com': 'reference',
  // Documents people share, not Google's documentation.
  'docs.google.com': 'ugc',
  'drive.google.com': 'ugc',
  'sites.google.com': 'ugc',
  'plus.espn.com': 'corporate',
  'iview.abc.net.au': 'corporate',
};

/** First label of a host: the company's own help, press or investor pages, its community forum, its documentation. */
const PREFIXES: Record<string, DomainType> = Object.fromEntries([
  ...['help', 'support', 'ajuda', 'ayuda', 'suporte', 'aide', 'hilfe', 'helpcenter', 'help-center', 'faq', 'kb', 'atendimento',
    'status', 'about', 'press', 'newsroom', 'imprensa', 'investor', 'investors', 'investidores', 'ir', 'ri', 'careers', 'jobs',
    'carreiras', 'vagas', 'store', 'shop', 'loja', 'corporate'].map((label) => [label, 'corporate']),
  ...['forum', 'forums', 'community', 'communities', 'comunidade', 'discuss', 'discussions', 'answers', 'foro', 'foros'].map((label) => [label, 'ugc']),
  ...['docs', 'developers', 'developer', 'devdocs'].map((label) => [label, 'reference']),
]);

/** Second-level labels under a country code that are a registry, not a site (help.com.br is not a help subdomain). */
const REGISTRY_LABELS = new Set(['com', 'net', 'org', 'co', 'gov', 'gob', 'edu', 'ac', 'mil', 'ne', 'or', 'go', 'jus', 'leg', 'mp', 'art', 'blog', 'app', 'ind', 'inf', 'nom', 'tv']);
/** Government, education, military and treaty bodies by domain ending (.gov, .edu, .gov.br, .ac.uk, .jus.br...). */
const PUBLIC_TOP = new Set(['gov', 'edu', 'mil', 'int']);
const PUBLIC_SECOND = new Set(['gov', 'gob', 'gouv', 'govt', 'go', 'edu', 'ac', 'mil', 'jus', 'leg', 'mp', 'def']);
/** Ancestors checked above the host itself (a.b.c.youtube.com still finds youtube.com); the SQL below walks the same depth. */
const DEPTH = 3;

const siteType = new Map<string, DomainType>(
  Object.entries(SITES).flatMap(([type, domains]) => domains.map((domain) => [domain, type as DomainType] as const)),
);
const parent = (host: string) => host.slice(host.indexOf('.') + 1);
const institutionalTld = (labels: string[]) =>
  PUBLIC_TOP.has(labels.at(-1)!) || (labels.length > 2 && labels.at(-1)!.length === 2 && PUBLIC_SECOND.has(labels.at(-2)!));
const prefixed = (labels: string[]) =>
  labels.length > 2 && !(labels.length === 3 && REGISTRY_LABELS.has(labels[1]) && labels[2].length === 2) ? PREFIXES[labels[0]] : undefined;

/** The deterministic site type of a domain key (lowercase host without www.), or null when the catalog decides. */
export function siteTypeRule(host: string): DomainType | null {
  if (HOSTS[host]) return HOSTS[host];
  const labels = host.split('.');
  if (labels.length < 2) return null;
  if (institutionalTld(labels)) return 'institutional';
  const prefix = prefixed(labels);
  if (prefix) return prefix;
  for (let key = host, level = 0; level <= DEPTH; level++, key = parent(key)) {
    const type = siteType.get(key);
    if (type) return type;
  }
  return null;
}

const quote = (value: string) => `'${value}'`;
/**
 * The same rules as {@link siteTypeRule} for the Sources list's type filter, which runs in the project's SQLite: `WHEN`
 * clauses of a `CASE` over `key` that answer whether a host a rule decides has one of the `selected` types. A host no
 * rule decides falls through to the caller's `ELSE` (the catalog). Every literal comes from the lists above (tested to
 * be plain host characters); the site lists travel as JSON parameters, in the order the clauses use them.
 */
export function siteTypeRuleSql(key: string, selected: readonly string[]) {
  const wanted = new Set(selected);
  const yes = (type: string) => (wanted.has(type) ? '1' : '0');
  const hosts = Object.keys(HOSTS);
  const ends = (labels: string[]) => labels.map((label) => `${key} GLOB '*.${label}'`);
  const tld = [...ends([...PUBLIC_TOP]), ...ends([...PUBLIC_SECOND].map((label) => `${label}.??`))].join(' OR ');
  const prefixes = Object.entries(PREFIXES);
  const registry = `${key} GLOB '*.*.*' AND NOT (${key} NOT GLOB '*.*.*.*' AND (${ends([...REGISTRY_LABELS].map((label) => `${label}.??`)).join(' OR ')}))`;
  const byPrefix = (type: string) => prefixes.filter(([, value]) => value === type).map(([label]) => `${key} GLOB '${label}.*'`).join(' OR ');
  const ancestors = [key];
  for (let level = 1; level <= DEPTH; level++) ancestors.push(`substr(${ancestors[level - 1]},instr(${ancestors[level - 1]},'.')+1)`);
  const inSites = (list: string) => ancestors.map((ancestor) => `${ancestor} IN (SELECT value FROM json_each(${list}))`).join(' OR ');
  const sites = [...siteType.keys()];
  const chosen = sites.filter((site) => wanted.has(siteType.get(site)!));
  const sql = [
    `WHEN ${key} IN (${hosts.map(quote).join(',')}) THEN ${key} IN (${[...hosts.filter((host) => wanted.has(HOSTS[host])), ''].map(quote).join(',')})`,
    `WHEN ${tld} THEN ${yes('institutional')}`,
    ...(['corporate', 'ugc', 'reference'] as const).map((type) => `WHEN ${registry} AND (${byPrefix(type)}) THEN ${yes(type)}`),
    `WHEN ${inSites('?')} THEN (${inSites('?')})`,
  ].join(' ');
  return { sql, params: [...ancestors.map(() => JSON.stringify(sites)), ...ancestors.map(() => JSON.stringify(chosen))] };
}

/**
 * The deterministic page type of a URL, or null when the catalog decides: a site's root (path "/", no query or fragment) is its
 * homepage, whatever the site, so the evaluator is never asked about it (8/11/2026).
 */
export function pageTypeRule(url: string): PageType | null {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && parsed.pathname === '/' && !parsed.search && !parsed.hash ? 'homepage' : null;
  } catch {
    return null;
  }
}
/** The same rule in the project's SQLite, as a `WHEN` clause over `key` for the Sources list's type filter (see siteTypeRuleSql). */
export function pageTypeRuleSql(key: string, selected: readonly string[]) {
  const rest = `substr(${key},instr(${key},'://')+3)`;
  const root = `(lower(${key}) GLOB 'http*://*' AND (instr(${rest},'/')=0 OR instr(${rest},'/')=length(${rest})) AND instr(${key},'?')=0 AND instr(${key},'#')=0)`;
  return { sql: `WHEN ${root} THEN ${selected.includes('homepage') ? '1' : '0'}`, params: [] as string[] };
}

/** Every listed host and site, for the tests that keep the lists well formed. */
export const SOURCE_TYPE_RULE_ENTRIES = { sites: [...siteType.keys()], hosts: Object.keys(HOSTS), prefixes: Object.keys(PREFIXES) };
