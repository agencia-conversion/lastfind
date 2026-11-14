import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandDomainCandidates,
  brandDomainDecisionRequest,
  brandDomainFromHits,
  brandDomainHits,
  brandLabel,
  domainConfidence,
  domainFitsBrand,
  domainRelatesToBrand,
  parseBrandDomainResponse,
  guessDomains,
  registrableDomain,
  serpDomains,
  siteCheckWork,
  siteNamesBrand,
  SITE_CHECK_TOP,
  type DomainDecisionInput,
  type SiteCheck,
  aggregatorFor,
  ruledDomain,
} from '../lib/brand-domain.ts';
import { brandKey, deriveRows, deriveState, type DecisionEvent, type Suggestion } from '../lib/brand-decisions.ts';
import { discoverCompetitors } from '../lib/competitor-discovery.ts';

void test('registrable domains keep country second levels and drop subdomains and www', () => {
  assert.equal(registrableDomain('www.netflix.com'), 'netflix.com');
  assert.equal(registrableDomain('help.netflix.com'), 'netflix.com');
  assert.equal(registrableDomain('www.magazineluiza.com.br'), 'magazineluiza.com.br');
  assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('NETFLIX.com.'), 'netflix.com');
});

void test('a brand name is spelled the way a domain label would be', () => {
  assert.equal(brandLabel('Paramount+'), 'paramountplus');
  assert.equal(brandLabel('AT&T'), 'att');
  assert.equal(brandLabel('Rakuten Viki'), 'rakutenviki');
  assert.equal(brandLabel('Mercado Líbre'), 'mercadolibre');
});

void test('answers name a domain in prose, links and citations; the exact-name one is strong', () => {
  const found = brandDomainCandidates('Netflix', {
    texts: ['Watch at www.netflix.com/browse or read https://help.netflix.com/en/node/1.', 'Also netflixsucks.org complains.'],
    urls: ['https://www.imdb.com/title/tt1', 'https://about.netflix.com/en'],
  });
  assert.deepEqual(found.map((item) => [item.domain, item.strong]), [['netflix.com', true], ['netflixsucks.org', false]]);
  assert.equal(found[0]!.hits, 3);
});

void test('the same site in two countries is one candidate; different top levels stay apart', () => {
  const country = brandDomainCandidates('Netflix', { urls: ['https://www.netflix.com.br/x', 'https://netflix.com/y', 'https://netflix.com/z'] });
  assert.deepEqual(country.map((item) => item.domain), ['netflix.com']);
  const brazilOnly = brandDomainCandidates('Magalu', { urls: ['https://www.magalu.com.br/p', 'https://magalu.com.br/q'] });
  assert.deepEqual(brazilOnly.map((item) => item.domain), ['magalu.com.br']);
  const apart = brandDomainCandidates('Apollo', { urls: ['https://apollo.com/a', 'https://apollo.io/b'] });
  assert.deepEqual(apart.map((item) => item.domain), ['apollo.com', 'apollo.io']);
  assert.ok(apart.every((item) => item.strong));
});

void test('a domain from pages of answers is the sum of their hits; prose run together is no host', () => {
  // Two pages, one each: the window decides on the sum (amazon.in is amazon.com in another country), never page by page.
  const pages = [brandDomainHits('Amazon', { texts: ['Rent at amazon.com.'] }), brandDomainHits('Amazon', { texts: ['India: amazon.in, amazon.in'] })];
  const sum: Record<string, number> = {};
  for (const page of pages) for (const [domain, hits] of Object.entries(page)) sum[domain] = (sum[domain] ?? 0) + hits;
  assert.deepEqual(brandDomainFromHits(sum), { domain: 'amazon.in', state: 'unique' });
  assert.deepEqual(brandDomainFromHits({ 'amazon.com': 2, 'amazon.in': 1 }), { domain: 'amazon.com', state: 'unique' });
  assert.deepEqual(brandDomainFromHits({ 'britbox.com': 37, 'britbox.tv': 1 }), { domain: null, state: 'conflict' });
  assert.deepEqual(brandDomainFromHits({}), { domain: null, state: 'none' });
  // "JustWatch.JustWatch", "Hulu.Then": two words without a space, not a host.
  assert.deepEqual(brandDomainHits('JustWatch', { texts: ['Search JustWatch.JustWatch for it, or justwatch.justwatch.'] }), {});
  assert.deepEqual(brandDomainCandidates('Hulu', { texts: ['Try Hulu.Then switch.'] }), []);
  assert.deepEqual(brandDomainHits('JustWatch', { texts: ['See JustWatch.com or JUSTWATCH.COM.'] }), { 'justwatch.com': 2 });
});

void test('a very short or absent name never matches anything', () => {
  assert.deepEqual(brandDomainCandidates('X', { urls: ['https://x.com'] }), []);
  assert.deepEqual(brandDomainCandidates('Netflix', { texts: ['no links here'] }), []);
});

void test('the free analysis suggests the domain the answers spell like the brand, and none when several', () => {
  const answer = (id: string, text: string, urls: string[]) => ({
    id,
    answer: text,
    sources: urls.map((url) => ({ url, domain: new URL(url).hostname, title: 'Page' })),
    createdAt: '2026-10-16T00:00:00.000Z',
  });
  const seeds = [{ name: 'Netflix', domain: 'netflix.com' }];
  const answers = (extra: string) => [
    answer('a', `## Best streaming services\n\n1. **Hulu** is a streaming service with ads, see hulu.com.${extra}\n2. **Tubi** is a free streaming service.\n`, []),
    answer('b', 'Recommended streaming alternatives to Netflix: Hulu offers originals and live TV for subscribers.\n', ['https://www.hulu.com/welcome']),
    answer('c', '## Streaming\n\n1. **Hulu** is a streaming platform company.\n2. **Tubi** is a free streaming platform.\n', []),
  ];
  const hulu = (list: ReturnType<typeof answers>) => discoverCompetitors(list, seeds).find((candidate) => candidate.name === 'Hulu')!;
  assert.equal(hulu(answers('')).domain, 'hulu.com');
  assert.equal(hulu(answers('')).domainEvidence, 'unique');
  // Two sites spelled like the brand: no suggestion, the later steps decide.
  assert.equal(hulu(answers(' Also hulu.tv.')).domain, null);
  // Not spelled like the brand: nothing to suggest.
  assert.equal(discoverCompetitors(answers(''), seeds).find((candidate) => candidate.name === 'Tubi')?.domain ?? null, null);
});

void test('search results: top 10 organic only, one entry per registrable domain at its best rank', () => {
  const item = (rank: number, domain: string, type = 'organic') => ({ type, rank_group: rank, domain, title: `T${rank}` });
  const result = [{ items: [item(1, 'www.netflix.com'), item(2, 'help.netflix.com'), item(3, 'en.wikipedia.org'), item(4, 'x.com', 'paid'), item(11, 'late.com'), { type: 'organic' }] }];
  assert.deepEqual(serpDomains(result), [
    { domain: 'netflix.com', rank: 1, title: 'T1' },
    { domain: 'wikipedia.org', rank: 3, title: 'T3' },
  ]);
  assert.deepEqual(serpDomains(null), []);
  assert.deepEqual(serpDomains([{ items: null }]), []);
});

const input: DomainDecisionInput = {
  brand: 'Hulu',
  category: 'streaming',
  country: 'Brazil',
  candidates: [{ domain: 'hulu.com', rank: 1 }, { domain: 'wikipedia.org', rank: 2 }],
};
const reply = (choice: string, extra: Record<string, unknown> = {}) => ({
  model: 'liquid/d1-ultra',
  answers: { domain: { type: 'choice', choice, confidence: 0.95, ...extra } },
  usage: { cost: 0.0004 },
});

void test('the decision request is one typed choice with an id per candidate and a way out', () => {
  const request = brandDomainDecisionRequest(input, 'liquid/d1-ultra');
  assert.deepEqual(Object.keys(request.questions.domain.criteria), ['c0', 'c1', 'none']);
  assert.match(request.questions.domain.instructions, /untrusted evidence/);
  assert.throws(() => brandDomainDecisionRequest({ ...input, candidates: [] }, 'm'), /No domain candidates/);
});

void test('the decision response maps the choice back to a domain and rejects anything unexpected', () => {
  assert.deepEqual(parseBrandDomainResponse(reply('c0'), input, 'liquid/d1-ultra'), { domain: 'hulu.com', confidence: 0.95, cost: 0.0004 });
  assert.equal(parseBrandDomainResponse(reply('none'), input, 'liquid/d1-ultra').domain, null);
  assert.equal(parseBrandDomainResponse(reply('c1', { confidence: undefined }), input, 'liquid/d1-ultra').confidence, 0);
  assert.throws(() => parseBrandDomainResponse(reply('c9'), input, 'liquid/d1-ultra'), /Unknown Decisions choice/);
  assert.throws(() => parseBrandDomainResponse(reply('c0', { confidence: 3 }), input, 'liquid/d1-ultra'), /confidence/);
  assert.throws(() => parseBrandDomainResponse({ ...reply('c0'), model: 'other/model' }, input, 'liquid/d1-ultra'), /Unexpected Decisions model/);
  assert.throws(() => parseBrandDomainResponse({ ...reply('c0'), usage: { cost: -1 } }, input, 'liquid/d1-ultra'), /cost/);
  assert.equal(domainConfidence(0.8), 'high');
  assert.equal(domainConfidence(0.79), 'low');
  assert.equal(domainConfidence(null), 'low');
});

const suggestion = (name: string, domain: string | null = null): Suggestion => ({
  name,
  domain,
  answerCount: 3,
  evidence: [{ runId: `run-${name}`, excerpt: name, createdAt: '2026-10-16T00:00:00.000Z' }],
});
let seq = 0;
const decision = (kind: DecisionEvent['kind'], name: string, domain: string): DecisionEvent => ({
  id: `e${++seq}`,
  seq,
  kind,
  brandKey: brandKey(name),
  undoes: null,
  payload: { name, domain, ops: [] },
  author: 'owner@test',
  createdAt: '2026-10-17T00:00:00.000Z',
});

void test('a stored discovery fills only brands without a domain and never overrides the user or the analysis', () => {
  const lookups = {
    hulu: { domain: 'hulu.com', confidence: 0.95, source: 'search' as const, candidates: ['wikipedia.org'] },
    tubi: { domain: 'tubi.example', confidence: 0.4, source: 'search' as const, candidates: [] },
    roku: { domain: 'roku.example', confidence: 0.99, source: 'search' as const, candidates: [] },
    pluto: { domain: null, confidence: null, source: null, candidates: ['plutotv.com', 'pluto.example'] },
    max: { domain: 'wrong.example', confidence: 0.99, source: 'search' as const, candidates: [] },
  };
  const state = deriveState([decision('domain', 'Roku', 'roku.com')]);
  const rows = deriveRows(
    [],
    [suggestion('Hulu'), suggestion('Tubi'), suggestion('Roku'), suggestion('Pluto'), suggestion('Max', 'max.com')],
    state,
    lookups,
  );
  const by = (name: string) => rows.find((row) => row.name === name)!;
  assert.deepEqual(
    [by('Hulu').domain, by('Hulu').domainSource, by('Hulu').domainConfidence, by('Hulu').review],
    ['hulu.com', 'search', 'high', false],
  );
  assert.deepEqual([by('Tubi').domainConfidence, by('Tubi').review, by('Tubi').domainReview], ['low', true, true]);
  // The user's own decision and the analysis' domain win over a stored result, whatever its confidence.
  assert.deepEqual([by('Roku').domain, by('Roku').domainSource, by('Roku').domainSuggested, by('Roku').review], ['roku.com', 'user', false, false]);
  assert.deepEqual([by('Max').domain, by('Max').domainSource, by('Max').domainConfidence], ['max.com', 'answers', 'high']);
  // Looked up and still unknown: no domain, to review, with the candidates to pick from.
  assert.deepEqual([by('Pluto').domain, by('Pluto').review, by('Pluto').domainCandidates], [null, true, ['plutotv.com', 'pluto.example']]);
  assert.equal(deriveRows([], [suggestion('Hulu')], state).find((row) => row.name === 'Hulu')!.review, false);
});

void test('a domain that only sat next to the name is not suggested: no favicon of another company', () => {
  assert.equal(domainRelatesToBrand('Tubi', 'tubitv.com'), true);
  assert.equal(domainRelatesToBrand('Rakuten Viki', 'viki.com'), true);
  assert.equal(domainRelatesToBrand('Amazon Prime', 'amazon.com'), true);
  assert.equal(domainRelatesToBrand('Amazon Prime', 'primevideo.com'), true);
  assert.equal(domainRelatesToBrand('Reddit', 'www.reddit.com'), true);
  assert.equal(domainRelatesToBrand('DuckTales', 'google.com'), false);
  assert.equal(domainRelatesToBrand('True Crime', 'netflix.com'), false);
  assert.equal(domainFitsBrand('DuckTales', 'google.com'), false);
  assert.equal(domainFitsBrand('True Crime', 'netflix.com', 'netflix.com'), false);
  assert.equal(domainFitsBrand('YouTube', 'youtube.com'), true);
  // "&" spelled out in the site's name (CI&T, production lookup left without a domain).
  assert.equal(domainFitsBrand('CI&T', 'ciandt.com'), true);
  assert.equal(domainFitsBrand('AT&T', 'att.com'), true);
  assert.equal(domainRelatesToBrand('Disney Plus', 'paramountplus.com'), false);
  assert.equal(domainRelatesToBrand('Banco Inter', 'bancodobrasil.com.br'), false);
  assert.equal(domainRelatesToBrand('Disney Plus', 'disneyplus.com'), true);
  assert.deepEqual(brandDomainCandidates('Reddit', { urls: ['https://www.reddit.com/r/x'] }).map((item) => item.domain), ['reddit.com']);
  // Answers name amazon.com / viki.com even though the brand label is longer than the host label.
  assert.deepEqual(
    brandDomainCandidates('Amazon Prime', { urls: ['https://www.amazon.com/', 'https://www.primevideo.com/'] }).map((item) => item.domain),
    ['amazon.com', 'primevideo.com'],
  );
  assert.deepEqual(brandDomainCandidates('Rakuten Viki', { urls: ['https://www.viki.com/'] }).map((item) => item.domain), ['viki.com']);
  assert.deepEqual(brandDomainCandidates('DuckTales', { urls: ['https://www.google.com/search?q=DuckTales'] }), []);
  const rows = deriveRows(
    [],
    [suggestion('DuckTales', 'google.com'), suggestion('Trash Truck', 'google.com'), suggestion('True Crime', 'netflix.com'), suggestion('Tubi', 'tubitv.com')],
    deriveState([]),
    { ducktales: { domain: 'ducktales.com', confidence: 0.95, source: 'search', candidates: [] } },
    'netflix.com',
  );
  const by = (name: string) => rows.find((row) => row.name === name)!;
  assert.deepEqual([by('DuckTales').domain, by('DuckTales').domainSource, by('DuckTales').review], ['ducktales.com', 'search', false]);
  // Unrelated / project domain: no suggested domain, initial letter; nothing to pick, so nothing asked.
  assert.deepEqual(
    [by('Trash Truck').domain, by('Trash Truck').domainSuggested, by('Trash Truck').review, by('Trash Truck').domainReview],
    [null, false, false, false],
  );
  assert.deepEqual(
    [by('True Crime').domain, by('True Crime').domainSuggested, by('True Crime').domainReview],
    [null, false, false],
  );
  assert.deepEqual([by('Tubi').domainConfidence, by('Tubi').review], ['high', false]);
});

void test('a name on a monitored brand’s site is that brand; two names on one site, one inside the other, are one row', () => {
  const lookups = {
    'amazon prime': { domain: 'primevideo.com', confidence: 0.95, source: 'search' as const, candidates: [] },
    'pbs kids': { domain: 'pbskids.org', confidence: 0.95, source: 'search' as const, candidates: [] },
    'pbs kids video': { domain: 'pbskids.org', confidence: 0.95, source: 'search' as const, candidates: [] },
    'apple music': { domain: 'apple.com', confidence: 0.95, source: 'search' as const, candidates: [] },
    'apple tv': { domain: 'apple.com', confidence: 0.95, source: 'search' as const, candidates: [] },
  };
  const rows = deriveRows(
    [{ name: 'Prime Video', domain: 'primevideo.com' }],
    [suggestion('Amazon Prime'), { ...suggestion('PBS Kids'), answerCount: 9 }, suggestion('PBS KIDS Video'), suggestion('Apple Music'), suggestion('Apple TV')],
    deriveState([]),
    lookups,
  );
  assert.deepEqual(rows.map((row) => [row.name, row.aliases]), [['PBS Kids', ['PBS KIDS Video']], ['Apple Music', []], ['Apple TV', []]]);
});

void test('a home page names the brand by its words in order, its title or site name, also written as one word', () => {
  const page = (title: string | null, siteName: string | null = null) => ({ title, siteName });
  assert.equal(siteNamesBrand('Tom’s Guide', page("Tom's Guide: Tech news")), true);
  assert.equal(siteNamesBrand('Paramount+', page('Paramount Plus | Stream')), true);
  assert.equal(siteNamesBrand('CI&T', page('CI&T | Digital')), true);
  assert.equal(siteNamesBrand('PlutoTV', page('Pluto TV: Watch Free TV')), true);
  assert.equal(siteNamesBrand('Pluto TV', page('PlutoTV')), true);
  assert.equal(siteNamesBrand('Hulu', page(null, 'Hulu')), true);
  assert.equal(siteNamesBrand('São Paulo FC', page('Sao Paulo FC oficial')), true);
  // A word inside another word, or the brand's words apart, is not its name.
  assert.equal(siteNamesBrand('AIM', page('Maintain your site')), false);
  assert.equal(siteNamesBrand('YouTube TV', page('YouTube')), false);
  assert.equal(siteNamesBrand('PBS Kids', page('KidStream: kids TV')), false);
  assert.equal(siteNamesBrand('Max', page(null, null)), false);
  // A parked domain's page is named after the host only.
  assert.equal(siteNamesBrand('Black', page('black.com')), false);
  assert.equal(siteNamesBrand('Amazon Prime', page('Amazon.com: Amazon Prime')), true);
});

void test('the free guess is the name as a .com, and .com.br for a Brazilian project', () => {
  assert.deepEqual(guessDomains('Nickelodeon'), ['nickelodeon.com']);
  assert.deepEqual(guessDomains('Paramount+', 2840), ['paramountplus.com']);
  assert.deepEqual(guessDomains('Hedgehog Digital', 2076), ['hedgehogdigital.com', 'hedgehogdigital.com.br']);
  assert.deepEqual(guessDomains('HP'), []);
});

void test('sites are read for the most mentioned discovered brands only, never again while recent, never for the person’s domain', () => {
  const now = Date.parse('2026-10-29T12:00:00.000Z');
  const row = (name: string, responses: number, domain: string | null = null, extra: Record<string, unknown> = {}) => ({
    name, status: 'discovered', domain, domainSource: domain ? ('answers' as const) : null, review: false, domainReview: false, responses, ...extra,
  });
  const rows = [
    row('Tubi', 90, 'tubi.tv'),
    row('Nickelodeon', 80),
    row('Roku', 70, 'roku.com', { domainSource: 'user' }),
    row('Hollywood', 60, null, { review: true }),
    row('Sling', 50, 'sling.com', { status: 'rejected' }),
    row('Pluto', 40, 'plutotv.com', { domainSource: 'site' }),
    ...Array.from({ length: SITE_CHECK_TOP }, (_, index) => row(`Brand ${index}`, 1, `brand${index}.com`)),
  ];
  const fresh: SiteCheck = { reachable: true, host: 'tubi.tv', title: 'Tubi', siteName: null, checkedAt: '2026-10-20T00:00:00.000Z' };
  const work = siteCheckWork(rows, { 'tubi.tv': fresh, 'pluto.com': { ...fresh, checkedAt: '2026-09-01T00:00:00.000Z' } }, now);
  // Tubi was read 9 days ago; Pluto's guess a month ago is read again; the person's, the brand in review and the rejected one never.
  assert.deepEqual(work.slice(0, 2), ['nickelodeon.com', 'pluto.com']);
  // Tubi, Nickelodeon, Roku and Pluto take four of the top places; the rest go to the first brands below them.
  assert.equal(work.length, 2 + SITE_CHECK_TOP - 4, 'top brands only');
  const down = { ...fresh, reachable: false, checkedAt: '2026-10-28T00:00:00.000Z' };
  assert.ok(siteCheckWork([row('Tubi', 9, 'tubi.tv')], { 'tubi.tv': down }, now).includes('tubi.tv'), 'a site that did not answer is read again a day later');
  // Pure: the same input gives the same output, however many times it is asked.
  for (let run = 0; run < 10; run++) assert.deepEqual(siteCheckWork(rows, {}, now), siteCheckWork(rows, {}, now));
});

void test('site reads confirm, doubt or add a domain to confirm, and never override the person', () => {
  const at = '2026-10-29T00:00:00.000Z';
  const sites: Record<string, SiteCheck> = {
    'tubitv.com': { reachable: true, host: 'tubitv.com', title: 'Tubi: Free Movies', siteName: null, checkedAt: at },
    'peacocktv.com': { reachable: true, host: 'peacocktv.com', title: 'Peacock: Stream TV', siteName: null, checkedAt: at },
    'roku.com': { reachable: false, host: 'roku.com', title: null, siteName: null, checkedAt: at },
    'nickelodeon.com': { reachable: true, host: 'nick.com', title: 'Nickelodeon | Kids shows', siteName: null, checkedAt: at },
    'bravo.com': { reachable: true, host: 'bravo.com', title: 'Domain for sale', siteName: null, checkedAt: at },
    // Read from Brazil, the site sends to its Brazilian edition: the brand's domain is still the one guessed.
    'rakuten.com': { reachable: true, host: 'rakuten.com.br', title: 'Rakuten Brasil', siteName: null, checkedAt: at },
    // A fan site that contains the name and calls itself by its own longer name.
    'androidcentral.com': { reachable: true, host: 'androidcentral.com', title: 'Android Central - News on all Android devices', siteName: 'Android Central', checkedAt: at },
  };
  const rows = deriveRows(
    [],
    [suggestion('Tubi', 'tubitv.com'), suggestion('Roku', 'roku.com'), suggestion('Peacock'), suggestion('Nickelodeon'), suggestion('Bravo'), suggestion('Rakuten'), suggestion('Android')],
    deriveState([]),
    {
      [brandKey('Peacock')]: { domain: 'peacocktv.com', confidence: 0.5, source: 'answers', candidates: [] },
      [brandKey('Android')]: { domain: 'androidcentral.com', confidence: 0.5, source: 'answers', candidates: [] },
    },
    'netflix.com',
    { sites },
  );
  const facts = (name: string) => {
    const row = rows.find((item) => item.name === name)!;
    return [row.domain, row.domainSource, row.domainConfidence, row.domainSite, row.domainReview];
  };
  assert.deepEqual(facts('Tubi'), ['tubitv.com', 'answers', 'high', 'confirmed', false]);
  assert.deepEqual(facts('Roku'), ['roku.com', 'answers', 'low', 'unreachable', true]);
  assert.deepEqual(facts('Peacock'), ['peacocktv.com', 'answers', 'high', 'confirmed', false], 'a partial match the site confirms needs no review');
  assert.deepEqual(facts('Nickelodeon'), ['nick.com', 'site', 'low', 'confirmed', true], 'a guess is always one to confirm');
  assert.deepEqual(facts('Bravo'), [null, null, null, null, false]);
  assert.deepEqual(facts('Rakuten'), ['rakuten.com', 'site', 'low', 'confirmed', true]);
  assert.deepEqual(facts('Android'), ['androidcentral.com', 'answers', 'low', 'unconfirmed', true]);
  const decided = deriveRows([], [suggestion('Roku', 'roku.com')], deriveState([decision('domain', 'Roku', 'roku.com')]), {}, null, { sites });
  assert.deepEqual([decided[0]!.domainSource, decided[0]!.domainSite, decided[0]!.domainReview], ['user', null, false]);
});

test('decision roots of a domain: hubs that only contain the name are no candidate; a lone named top site needs no model', () => {
  assert.equal(aggregatorFor('Face', 'facebook.com'), true);
  assert.equal(aggregatorFor('Pineapple', 'apple.com'), true);
  assert.equal(aggregatorFor('Trip', 'tripadvisor.com.br'), true);
  assert.equal(aggregatorFor('YouTube', 'youtube.com'), false, 'the hub is the brand');
  assert.equal(aggregatorFor('Amazon Prime', 'amazon.com'), false, 'one of the brand’s words');
  assert.equal(aggregatorFor('Netflix', 'netflix.com'), false);
  const named = { reachable: true, title: 'Pluto TV: Watch Free TV', siteName: null };
  // [brand, candidates, pages, expected]
  const cases: [string, { domain: string; rank?: number }[], Record<string, typeof named>, string | null][] = [
    ['Pluto TV', [{ domain: 'plutotv.com', rank: 1 }], { 'plutotv.com': named }, 'plutotv.com'],
    ['Pluto TV', [{ domain: 'plutotv.com' }], { 'plutotv.com': named }, 'plutotv.com'],
    // Two candidates, a page that does not name the brand, an unreachable one or no read: the model decides.
    ['Pluto TV', [{ domain: 'plutotv.com', rank: 1 }, { domain: 'plutotv.net', rank: 2 }], { 'plutotv.com': named }, null],
    ['Sling', [{ domain: 'sling.com', rank: 1 }], { 'sling.com': { reachable: true, title: 'Live TV, anywhere', siteName: null } }, null],
    ['Pluto TV', [{ domain: 'plutotv.com', rank: 1 }], { 'plutotv.com': { ...named, reachable: false } }, null],
    ['Pluto TV', [{ domain: 'plutotv.com', rank: 1 }], {}, null],
    // A same-named business far down the search for the brand in its category (an airline for a faucet maker).
    ['Delta', [{ domain: 'delta.com', rank: 7 }], { 'delta.com': { reachable: true, title: 'Delta Air Lines', siteName: null } }, null],
  ];
  for (const [name, candidates, pages, expected] of cases) assert.equal(ruledDomain(name, candidates, pages), expected, `${name} ${JSON.stringify(candidates)}`);
});
