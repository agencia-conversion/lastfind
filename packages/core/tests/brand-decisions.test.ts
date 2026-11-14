import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeEvents,
  aliasTargets,
  applyOps,
  brandKey,
  brandsDigest,
  brandPathLabel,
  deriveRows,
  deriveState,
  evidenceSnippet,
  invertOps,
  type DecisionEvent,
  type DecisionPayload,
  type Suggestion,
} from '../lib/brand-decisions.ts';
import { matchesBrand } from '../lib/metrics.ts';
import type { BrandTarget } from '../lib/types.ts';

let seq = 0;
const event = (
  kind: DecisionEvent['kind'],
  name: string,
  payload: Partial<DecisionPayload> = {},
  undoes: string | null = null,
): DecisionEvent => ({
  id: `e${++seq}`,
  seq,
  kind,
  brandKey: brandKey(name),
  undoes,
  payload: { name, ops: [], ...payload },
  author: 'owner@test',
  createdAt: '2026-10-17T00:00:00.000Z',
});
const suggestion = (name: string, answerCount: number, domain: string | null = null): Suggestion => ({
  name,
  domain,
  answerCount,
  evidence: [{ runId: `run-${name}`, excerpt: `${name} excerpt`, createdAt: '2026-10-16T00:00:00.000Z' }],
});
const prime: BrandTarget = { name: 'Prime Video', domain: 'primevideo.com' };

void test('keys keep the plus sign: Paramount+ is not Paramount nor Paramount Plus', () => {
  assert.equal(brandKey('Paramount+'), 'paramount+');
  assert.notEqual(brandKey('Paramount+'), brandKey('Paramount Plus'));
  assert.equal(brandKey('  Pluto   TV '), 'pluto tv');
  assert.equal(brandKey('Crunchyroll'), brandKey('crunchyroll'));
});

void test('brand path uses the list display name for a discovery, not the lowercase key', () => {
  assert.equal(
    brandPathLabel('criterion channel', ['Netflix', 'Max', 'Criterion Channel']),
    'Criterion Channel',
  );
  assert.equal(brandPathLabel('max', ['Netflix', 'Max', 'Criterion Channel']), 'Max');
  assert.equal(brandPathLabel('criterion channel', ['Netflix', 'Max']), 'criterion channel');
});

void test('an undo is a compensating event: the state is derived from the active events only', () => {
  const reject = event('reject', 'Roku', { responses: 12 });
  const confirm = event('confirm', 'Tubi', { domain: 'tubitv.com' });
  const undo = event('undo', 'Roku', {}, reject.id);
  const events = [reject, confirm, undo];
  assert.deepEqual(activeEvents(events).map((item) => item.id), [confirm.id]);
  const state = deriveState(events);
  assert.deepEqual(Object.keys(state.rejected), []);
  assert.equal(state.confirmed.tubi.domain, 'tubitv.com');
  assert.deepEqual(Object.keys(deriveState([reject, confirm]).rejected), ['roku']);
});

void test('the last decision on a brand wins and reopening a rejected brand allows confirming it', () => {
  const reject = event('reject', 'Roku');
  const confirm = event('confirm', 'Roku', { domain: 'roku.com' });
  const state = deriveState([reject, confirm]);
  assert.equal(state.rejected.roku, undefined);
  assert.equal(state.confirmed.roku.domain, 'roku.com');
  assert.equal(deriveState([confirm, event('reject', 'Roku')]).confirmed.roku, undefined);
});

void test('operations on the monitored list are exactly reversible', () => {
  const tubi: BrandTarget = { name: 'Tubi', domain: 'tubitv.com' };
  const added = applyOps([prime], [{ op: 'add', target: tubi }]);
  assert.deepEqual(added.map((item) => item.name), ['Prime Video', 'Tubi']);
  assert.deepEqual(applyOps(added, invertOps([{ op: 'add', target: tubi }])), [prime]);

  const ops = [
    { op: 'remove' as const, target: tubi },
    { op: 'alias' as const, key: 'prime video', names: ['Amazon Prime Video'] },
  ];
  const merged = applyOps(added, ops);
  assert.deepEqual(merged, [{ ...prime, aliases: ['Amazon Prime Video'] }]);
  assert.deepEqual(applyOps(merged, invertOps(ops)), [{ ...prime, aliases: [] }, tubi]);

  const renamed = [
    { op: 'set' as const, key: 'prime video', field: 'name' as const, from: 'Prime Video', to: 'Amazon Prime' },
    { op: 'alias' as const, key: 'amazon prime', names: ['Prime Video'] },
  ];
  const after = applyOps([prime], renamed);
  assert.deepEqual(after, [{ name: 'Amazon Prime', domain: 'primevideo.com', aliases: ['Prime Video'] }]);
  assert.deepEqual(applyOps(after, invertOps(renamed)), [{ ...prime, aliases: [] }]);

  const moved = [{ op: 'set' as const, key: 'prime video', field: 'domain' as const, from: 'primevideo.com', to: 'amazon.com' }];
  assert.equal(applyOps([prime], moved)[0].domain, 'amazon.com');
  assert.equal(applyOps(applyOps([prime], moved), invertOps(moved))[0].domain, 'primevideo.com');
});

void test('adding is idempotent for the same brand or domain and never touches unrelated entries', () => {
  const same = applyOps([prime], [{ op: 'add', target: { name: 'prime video', domain: 'other.com' } }]);
  assert.equal(same.length, 1);
  const sameDomain = applyOps([prime], [{ op: 'add', target: { name: 'Another', domain: 'primevideo.com' } }]);
  assert.equal(sameDomain.length, 1);
});

void test('discoveries: rejected and merged brands leave the active list, aliases add to the destination', () => {
  const suggestions = [
    suggestion('Roku', 40),
    suggestion('Tubi', 368, 'tubitv.com'),
    suggestion('Paramount+', 335),
    suggestion('Paramount Plus', 8),
  ];
  const events = [
    event('reject', 'Roku', { responses: 40, sense: 'device maker' }),
    event('alias', 'Paramount Plus', { intoKey: 'paramount+', into: 'Paramount+', responses: 8, overlap: 2 }),
  ];
  const rows = deriveRows([prime], suggestions, deriveState(events));
  const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
  assert.equal(byName.Roku.status, 'rejected');
  assert.equal(byName.Roku.sense, 'device maker');
  assert.equal(byName.Tubi.status, 'discovered');
  assert.equal(byName.Tubi.domainSuggested, true);
  assert.equal(byName['Paramount Plus'], undefined);
  assert.deepEqual(byName['Paramount+'].aliases, ['Paramount Plus']);
  // 335 + 8 answers, 2 of them mention both names: they count once.
  assert.equal(byName['Paramount+'].responses, 341);
  assert.deepEqual(rows.map((row) => row.name), ['Tubi', 'Paramount+', 'Roku']);
});

void test('a confirmed domain overrides the suggested one; monitored brands never repeat as discoveries', () => {
  const state = deriveState([event('domain', 'Tubi', { domain: 'tubi.tv' })]);
  const rows = deriveRows([prime], [suggestion('Tubi', 5, 'wrong.com'), suggestion('prime video', 9)], state);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].domain, 'tubi.tv');
  assert.equal(rows[0].domainSuggested, false);
});

void test('a rejected brand that used to be monitored stays listed with the numbers kept at the time', () => {
  const rows = deriveRows([], [], deriveState([event('reject', 'Hulu', { responses: 77, domain: 'hulu.com' })]));
  assert.deepEqual(
    rows.map((row) => [row.name, row.status, row.responses, row.domain]),
    [['Hulu', 'rejected', 77, 'hulu.com']],
  );
});

void test('unknown numbers stay unknown instead of becoming zero', () => {
  const rows = deriveRows([], [], deriveState([event('reject', 'Hulu')]));
  assert.equal(rows[0].responses, null);
});

void test('a merged alias counts a response once, even when it mentions both names', () => {
  const target: BrandTarget = { name: 'Paramount+', domain: 'paramountplus.com', aliases: ['Paramount Plus'] };
  assert.equal(matchesBrand('I like Paramount+ and also Paramount Plus.', target), true);
  assert.equal(matchesBrand('Only Paramount Plus here.', target), true);
  assert.equal(matchesBrand('Only Paramount here.', target), false);
});

void test('AI-flagged candidates keep their review state from the free detector', () => {
  const rows = deriveRows([], [{ ...suggestion('Cats', 7), ambiguous: true, reasons: ['title'], key: 'cats' }], deriveState([]));
  assert.equal(rows[0].review, true);
  assert.deepEqual(rows[0].reasons, ['title']);
});

const clean = (value: string) => value.replace(/\[\[\d+\]\]\([^)]*\)?/g, ' ').replace(/[*]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').split(/\s+/).join(' ');
void test('evidence snippets drop markdown and citations, cut at words and mark the brand', () => {
  const raw =
    'acebook.com/fb-answers… Many viewers also pick **[Peacock](https://www.peacocktv.com/x)** for live sports [[1]](https://www.msn.com/en-us/news/very/long/path) and originals, while the rest of this sentence keeps going on and on for a long while so that it needs to be cut somewhere [[2]](https://www.msn.com/…';
  const parts = evidenceSnippet(raw, ['Peacock'], 120);
  const text = parts.map((part) => part.text).join('');
  assert.ok(!/\]\(|https?:|\[\[|\*\*|acebook/.test(text), text);
  assert.ok(text.startsWith('Many viewers also pick Peacock for live sports'), text);
  assert.ok(text.endsWith(' …'), text);
  assert.deepEqual(parts.filter((part) => part.match).map((part) => part.text), ['Peacock']);
  // Cut at a word boundary: the last word before the ellipsis is a whole word of the answer.
  const last = text.slice(0, -2).trim().split(' ').pop()!;
  assert.ok(clean(raw).split(' ').includes(last), last);
  assert.deepEqual(evidenceSnippet('Nothing about it', ['Roku']), [{ text: 'Nothing about it', match: false }]);
});

void test('evidence snippets drop partial words at both ends of a stored excerpt', () => {
  const join = (parts: { text: string }[]) => parts.map((part) => part.text).join('');
  const head = ') 3. Peacock or Paramount+ — Best for Classic Sitcom Hubs - Peacock: Essential if your favorite si';
  assert.equal(join(evidenceSnippet(`ng-services-for-comedy${head}`, ['Peacock'])).endsWith('favorite …'), true);
  const text = join(evidenceSnippet('gyg6mhjhdRqFBZPdqBedHTjpC2gsMY6BdAMylDtUesH igNml1a4n?purpose=fullsize) 4\\. Tubi (Best free option) A good place to explore true-crime without adding another paid subscription.', ['Tubi']));
  assert.ok(text.startsWith('4. Tubi (Best free option)'), text);
});

void test('alias destinations exclude the own brand, current brand and rejected discoveries', () => {
  const rows = [
    {key: 'netflix', own: true, status: 'tracked'},
    {key: 'hulu', own: false, status: 'tracked'},
    {key: 'viki', own: false, status: 'discovered'},
    {key: 'rakuten viki', own: false, status: 'discovered'},
    {key: 'roku', own: false, status: 'rejected'},
  ];
  assert.deepEqual(aliasTargets(rows, rows[2]).map(row => row.key), ['hulu', 'rakuten viki']);
  assert.deepEqual(aliasTargets(rows, rows[1]), []);
});

test('the Overview digest keeps the most mentioned discovered competitors and counts every discovered brand', () => {
  const row = (key: string, responses: number, extra: Record<string, unknown> = {}) =>
    ({ key, name: key, status: 'discovered', review: false, role: 'competitor', responses, ...extra }) as never;
  const analysis = { analyzed: 10 };
  const digest = brandsDigest({ cachedAt: 'at', analysis, rows: [
    row('a', 1), row('b', 9), row('c', 5), row('doubt', 50, { review: true }), row('client', 40, { role: 'client' }),
    row('kept', 99, { status: 'tracked' }), row('gone', 99, { status: 'rejected' }),
  ] }, 2);
  assert.deepEqual(digest.rows.map((item) => item.key), ['b', 'c']);
  assert.equal(digest.discovered, 5);
  assert.equal(digest.cachedAt, 'at');
  assert.equal(digest.analysis, analysis);
  assert.equal(brandsDigest({ rows: [row('a', 1)], analysis }, 0).rows.length, 1, 'at least one row');
  assert.equal(brandsDigest({ rows: Array.from({ length: 80 }, (_, i) => row(`r${i}`, i)), analysis }, 1e9).rows.length, 50, 'bounded');
});
