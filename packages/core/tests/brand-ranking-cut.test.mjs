import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { byRankingValue, cutBrandRanking } from '../lib/brand-ranking-cut.ts';

const rows = (names) => names.map((name) => ({ name, domain: `${name}.test` }));
const isProject = (domain) => (row) => row.domain === domain;

test('cut keeps at most six brands when the project is inside the top six', () => {
  const list = rows(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  const cut = cutBrandRanking(list, isProject('c.test'));
  assert.deepEqual(
    cut.map(({ row, rank }) => [row.name, rank]),
    [
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
      ['e', 5],
      ['f', 6],
    ],
  );
});

test('cut pins the project as sixth with its real rank when it is outside the top five', () => {
  const list = rows(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'ours']);
  const cut = cutBrandRanking(list, isProject('ours.test'));
  assert.deepEqual(
    cut.map(({ row, rank }) => [row.name, rank]),
    [
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
      ['e', 5],
      ['ours', 8],
    ],
  );
});

test('cut returns the full list when there are six or fewer brands', () => {
  const list = rows(['a', 'b', 'ours']);
  const cut = cutBrandRanking(list, isProject('ours.test'));
  assert.equal(cut.length, 3);
  assert.equal(cut[2].rank, 3);
});

test('ranking orders report and discovered brands together by the shown value, then mentions', () => {
  // Discovered brands were appended after the report leaderboard (Zenith 32,6% below Orbit 20,9%).
  const list = [
    { name: 'Rival', value: 69.8, count: 30 },
    { name: 'Netflix', value: 67.4, count: 29 },
    { name: 'Orbit', value: 20.9, count: 9 },
    { name: 'Empty', value: null, count: 0 },
    { name: 'Zenith', value: 32.6, count: 14 },
    { name: 'Tie', value: 20.9, count: 12 },
  ].sort(byRankingValue());
  assert.deepEqual(list.map((row) => row.name), ['Rival', 'Netflix', 'Zenith', 'Tie', 'Orbit', 'Empty']);
});

test('a position ranks lower first and a brand without one goes last, even with more mentions', () => {
  const list = [
    { name: 'Second', value: 2.4, count: 12 },
    { name: 'Unmeasured', value: null, count: 40 },
    { name: 'First', value: 1.2, count: 3 },
    { name: 'Third', value: 3, count: 20 },
  ].sort(byRankingValue(true));
  assert.deepEqual(list.map((row) => row.name), ['First', 'Second', 'Third', 'Unmeasured']);
});

test('the Overview ranking shows and orders by the trend toggle, from the one shared state', () => {
  const liveApp = readFileSync(new URL('../components/analytics/live-app.tsx', import.meta.url), 'utf8');
  // One state for both cards: the toggle sets it, the ranking reads it (no second toggle or copy).
  assert.equal((liveApp.match(/useState<'visibility' \| 'shareOfVoice' \| 'position'>/g) || []).length, 1);
  assert.match(liveApp, /value=\{\[overviewChart\]\} onValueChange=\{\(value\) => \{ if \(value\[0\]\) setOverviewChart/);
  // Its value is the chart's period value of that metric (share of voice in percent), visibility the report's.
  assert.match(liveApp, /if \(overviewChart === 'visibility'\) return visibility;\s*const value = overviewTotals\.get\(chartKeys\.get\(key\) \?\? ''\);\s*return value == null \? null : overviewChart === 'shareOfVoice' \? value \* 100 : value;/);
  assert.match(liveApp, /\.sort\(byRankingValue\(overviewChart === 'position'\)\)/);
  // The column is named for the metric; no count of mentions beside it (since 10/11/2026).
  assert.match(liveApp, /rankingLabel = overviewChart === 'shareOfVoice' \? t\('Share of voice', 'Share of voice'\) : overviewChart === 'position' \? t\('Average position', 'Posição média'\) : t\('Visibility', 'Visibilidade'\)/);
  assert.match(liveApp, /\{ key: overviewChart, header: rankingLabel,/);
  assert.doesNotMatch(liveApp, /ariaLabel=\{t\('Brand ranking', 'Ranking de marcas'\)\}[\s\S]{0,4000}\{ key: 'mentions'/);
});

test('no brand or item position beside a figure: rankings say it only in their "#" column', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  // Topic coverage: no "1st"/"1º" chip beside the topic (the bar list has no badge slot any more).
  assert.doesNotMatch(read('components/analytics/overview-topics.tsx'), /ordinal|TagBadge/);
  assert.doesNotMatch(read('components/lastfind/presentation/bar-list.tsx'), /badge/);
  // Semantic Branding: no Rank KPI ("#2 of 6") and no "2nd of 6" beside a score.
  const summary = read('components/analytics/semantic-summary.tsx');
  assert.doesNotMatch(summary, /l\('Rank', 'Posição'\)/);
  assert.match(summary, /<MetricGrid columns=\{4\} mobilePairs/);
  for (const file of ['semantic-association-report.tsx', 'semantic-justifications.tsx', 'semantic-perception.tsx'])
    assert.doesNotMatch(read(`components/analytics/${file}`), /usePositionLabel|standings\(/, file);
});
