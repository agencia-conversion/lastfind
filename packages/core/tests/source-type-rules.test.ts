import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SOURCE_TYPE_RULE_ENTRIES, pageTypeRule, pageTypeRuleSql, siteTypeRule, siteTypeRuleSql } from '../lib/source-type-rules.ts';
import { DOMAIN_TYPES } from '../lib/source-types.ts';

// The traps of each layer, with the type a person reading the site would give (null: the catalog decides).
const CASES: [string, string | null][] = [
  ['youtube.com', 'social'], ['m.youtube.com', 'social'], ['kids.youtube.com', 'social'], ['tv.youtube.com', 'corporate'],
  ['youtube.tv', 'corporate'], ['br.pinterest.com', 'social'], ['x.com', 'social'], ['linkedin.com', 'social'],
  ['reddit.com', 'ugc'], ['old.reddit.com', 'ugc'], ['themelissakim.medium.com', 'ugc'], ['news.ycombinator.com', 'ugc'],
  ['ycombinator.com', null], ['reclameaqui.com.br', 'ugc'], ['community.synology.com', 'ugc'], ['forums.androidcentral.com', 'ugc'],
  ['g1.globo.com', 'press'], ['globoplay.globo.com', 'corporate'], ['ajuda.globoplay.globo.com', 'corporate'],
  ['folha.uol.com.br', 'press'], ['brasilescola.uol.com.br', 'reference'], ['pagseguro.uol.com.br', 'corporate'],
  ['economictimes.indiatimes.com', 'press'], ['m.economictimes.com', 'press'], ['tech.yahoo.com', 'press'], ['nytimes.com', 'press'],
  ['cnet.com', 'editorial'], ['prnewswire.com', 'editorial'],
  ['help.netflix.com', 'corporate'], ['help.instagram.com', 'corporate'], ['press.wbd.com', 'corporate'], ['ayuda.vix.com', 'corporate'],
  ['ri.magazineluiza.com.br', 'corporate'], ['hulu.com', 'corporate'],
  ['help.com', null], ['help.com.br', null], ['support.co.uk', null], ['loja.com.br', null],
  ['docs.python.org', 'reference'], ['developer.mozilla.org', 'reference'], ['docs.google.com', 'ugc'], ['support.google.com', 'corporate'],
  ['pt.wikipedia.org', 'reference'], ['en.m.wikipedia.org', 'reference'], ['netflix.fandom.com', 'reference'],
  ['nasa.gov', 'institutional'], ['docs.fcc.gov', 'institutional'], ['ibge.gov.br', 'institutional'], ['gov.br', 'institutional'],
  ['scholarship.claremont.edu', 'institutional'], ['ox.ac.uk', 'institutional'], ['stf.jus.br', 'institutional'],
  ['camara.leg.br', 'institutional'], ['mit.edu', 'institutional'], ['who.int', 'institutional'], ['meti.go.jp', 'institutional'],
  ['abcnews.go.com', null], ['example.ac', null], ['retirehub.org', null], ['commonsensemedia.org', null], ['usp.br', 'institutional'],
  ['documentarytube.com', null], ['proxy.goincop1.workers.dev', null], ['acme.zendesk.com', 'corporate'], ['a.b.c.youtube.com', 'social'],
  ['a.b.c.d.youtube.com', null], ['', null], ['localhost', null],
];

void test('each layer types its traps the way a reader would', () => {
  for (const [host, type] of CASES) assert.equal(siteTypeRule(host), type, host);
});

void test('the lists are plain lowercase hosts, typed once, and no listed site sits under another', () => {
  const { sites, hosts, prefixes } = SOURCE_TYPE_RULE_ENTRIES;
  for (const entry of [...sites, ...hosts, ...prefixes]) assert.match(entry, /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, entry);
  for (const entry of [...sites, ...hosts]) assert.ok(!entry.startsWith('www.'), entry);
  assert.equal(new Set(sites).size, sites.length, 'a site is in one list only');
  for (const site of sites) {
    assert.ok(DOMAIN_TYPES.includes(siteTypeRule(site) as never), site);
    for (const other of sites) assert.ok(other === site || !other.endsWith(`.${site}`), `${other} sits under ${site}`);
  }
  for (const host of hosts) assert.ok(!sites.includes(host), host);
});

// The Sources filter runs the same rules in the project's SQLite: for every selection, each host must be kept or
// dropped exactly as the TypeScript rules type it, and a host no rule decides must reach the catalog's ELSE.
void test('the SQL of the type filter agrees with the TypeScript rules for every type', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE sources(key TEXT)');
  const insert = sqlite.prepare('INSERT INTO sources(key) VALUES (?)');
  const hosts = [...new Set([...CASES.map(([host]) => host), ...SOURCE_TYPE_RULE_ENTRIES.sites, ...SOURCE_TYPE_RULE_ENTRIES.hosts,
    ...SOURCE_TYPE_RULE_ENTRIES.prefixes.map((label) => `${label}.example.com`), 'sub.a.b.c.d.youtube.com', 'x.y.gov.uk'])];
  for (const host of hosts) insert.run(host);
  for (const selected of [...DOMAIN_TYPES.map((type) => [type]), ['social', 'press'], ['unclassified', 'reference'], []]) {
    const rules = siteTypeRuleSql('key', selected);
    const rows = sqlite
      .prepare(`SELECT key,CASE ${rules.sql} ELSE 'catalog' END decided FROM sources`)
      .all(...(rules.params as string[])) as { key: string; decided: number | string }[];
    for (const row of rows) {
      const type = siteTypeRule(row.key);
      assert.equal(String(row.decided), type === null ? 'catalog' : selected.includes(type) ? '1' : '0', `${row.key} with ${selected.join(',')}`);
    }
  }
});

test("a site's root URL is its homepage without the evaluator, in code and in the Sources filter's SQL alike", () => {
  const cases: [string, string | null][] = [
    ['https://acme.example/', 'homepage'],
    ['https://acme.example', 'homepage'],
    ['http://www.loja.example.com.br/', 'homepage'],
    ['https://acme.example/pricing', null],
    ['https://acme.example/blog/', null],
    ['https://acme.example/?page=2', null],
    ['https://acme.example/#top', null],
    ['ftp://acme.example/', null],
    ['not a url', null],
  ];
  for (const [url, type] of cases) assert.equal(pageTypeRule(url), type, url);
  const sqlite = new DatabaseSync(':memory:');
  for (const selected of [['homepage'], ['product']]) {
    const rule = pageTypeRuleSql('key', selected);
    const decided = (url: string) => sqlite.prepare(`SELECT CASE ${rule.sql} ELSE NULL END decided FROM (SELECT ? key)`).get(url)!.decided;
    for (const [url, type] of cases.filter(([url]) => url.startsWith('http')))
      assert.equal(decided(url), type ? (selected.includes('homepage') ? 1 : 0) : null, `${url} ${selected}`);
  }
});
