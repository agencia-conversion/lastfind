import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalCitations,
  canonicalCitationsJson,
  canonicalSourceDomain,
  canonicalSourceUrl,
} from '../lib/source-url.mjs';

test('variations of one page share one canonical URL', () => {
  const page = 'https://news.example/best-streaming';
  for (const variant of [
    'https://news.example/best-streaming',
    'https://www.news.example/best-streaming',
    'http://news.example/best-streaming',
    'https://NEWS.example/best-streaming/',
    'https://news.example/best-streaming?utm_source=chatgpt.com',
    'https://news.example/best-streaming?utm_source=chatgpt.com&utm_medium=x&gclid=1&fbclid=2',
    'https://news.example/best-streaming#:~:text=The%20best%20service%20overall',
    'https://news.example:443/best-streaming?srsltid=abc#top',
  ])
    assert.equal(canonicalSourceUrl(variant), page, variant);
});

test('different pages stay different and the path keeps its case', () => {
  assert.notEqual(canonicalSourceUrl('https://news.example/A'), canonicalSourceUrl('https://news.example/a'));
  assert.notEqual(canonicalSourceUrl('https://news.example/a'), canonicalSourceUrl('https://news.example/b'));
  assert.notEqual(
    canonicalSourceUrl('https://youtube.com/watch?v=one'),
    canonicalSourceUrl('https://youtube.com/watch?v=two'),
    'a content parameter identifies the page',
  );
  assert.notEqual(canonicalSourceUrl('https://help.example/a'), canonicalSourceUrl('https://other.example/a'));
  // Subdomains are other sites.
  assert.notEqual(canonicalSourceUrl('https://help.news.example/a'), canonicalSourceUrl('https://news.example/a'));
});

test('query order does not matter, the root keeps its slash and the function is idempotent', () => {
  assert.equal(canonicalSourceUrl('https://x.example/p?b=2&a=1'), canonicalSourceUrl('https://x.example/p?a=1&b=2'));
  assert.equal(canonicalSourceUrl('https://www.x.example'), 'https://x.example/');
  assert.equal(canonicalSourceUrl('https://x.example/'), 'https://x.example/');
  for (const url of [
    'https://www.google.com/search?kgmid=/g/11n57dtjr1&hl=en#x',
    'http://a.example/x//?q=a b&utm_campaign=z',
  ]) {
    const once = canonicalSourceUrl(url) as string;
    assert.equal(canonicalSourceUrl(once), once);
  }
});

test('values that are not public http(s) URLs have no canonical form', () => {
  for (const value of ['', 'not a url', 'ftp://x.example/a', 'javascript:alert(1)', 'https://user:pass@x.example/', null, 4])
    assert.equal(canonicalSourceUrl(value), null, String(value));
});

test('domain keys are lowercase hosts without www', () => {
  assert.equal(canonicalSourceDomain('WWW.News.Example.'), 'news.example');
  assert.equal(canonicalSourceDomain('news.example'), 'news.example');
});

test('a response keeps one citation per page, with the first title and the domain of the canonical URL', () => {
  const list = canonicalCitations([
    { url: 'https://www.news.example/a#:~:text=one', domain: 'news.example', title: 'First' },
    { url: 'https://news.example/a?utm_source=chatgpt.com', domain: 'news.example', title: 'Second' },
    { url: 'https://news.example/b', domain: 'wrong.example', title: 'B' },
    { url: 'not a url', domain: 'x', title: 'Kept as it was' },
  ]);
  assert.deepEqual(list, [
    { url: 'https://news.example/a', domain: 'news.example', title: 'First' },
    { url: 'https://news.example/b', domain: 'news.example', title: 'B' },
    { url: 'not a url', domain: 'x', title: 'Kept as it was' },
  ]);
});

test('stored JSON is rewritten only when it changes and bad values pass through', () => {
  const clean = JSON.stringify([{ url: 'https://news.example/a', domain: 'news.example', title: 'A' }]);
  assert.equal(canonicalCitationsJson(clean), clean);
  assert.equal(
    canonicalCitationsJson(JSON.stringify([{ url: 'https://www.news.example/a/', domain: 'news.example', title: 'A' }])),
    clean,
  );
  assert.equal(canonicalCitationsJson(null), null);
  assert.equal(canonicalCitationsJson('{broken'), '{broken');
  assert.equal(canonicalCitationsJson('{"not":"a list"}'), '{"not":"a list"}');
  assert.equal(canonicalCitationsJson('[]'), '[]');
});
