import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesBrand,
  extractResponse,
  summarize,
  countAllMentions,
  csvCell,
  normalizeDomain,
  safeUrl,
  firstMentionPosition,
} from '../lib/metrics.ts';
import type { Run } from '../lib/types.ts';
await test('brand matching respects Unicode, case, accents and word boundaries', () => {
  const brand = { name: 'São Paulo', domain: 'sp.example' };
  assert.equal(matchesBrand('SÃO PAULO é citado.', brand), true);
  assert.equal(
    matchesBrand('Paulownia', { name: 'Paulo', domain: 'example.com' }),
    false,
  );
  assert.equal(
    matchesBrand('Abrandb', { name: 'Brand', domain: 'example.com' }),
    false,
  );
  assert.equal(
    matchesBrand('Conheça o C++.', { name: 'C++', domain: 'example.com' }),
    true,
  );
  assert.equal(
    matchesBrand('Only [website](https://acme.example) appears.', {
      name: 'Acme',
      domain: 'acme.example',
    }),
    false,
  );
});
await test('provider response parser extracts answer, de-duplicates sources and rejects unsafe URLs', () => {
  const r = extractResponse({
    model: 'test',
    markdown: 'Acme is mentioned.',
    sources: [
      { url: 'https://acme.example/a', title: 'Acme' },
      { url: 'javascript:alert(1)' },
    ],
    items: [
      {
        sources: [
          { url: 'https://acme.example/a' },
          { url: 'https://www.reference.example/a' },
        ],
      },
    ],
  });
  assert.equal(r.answer, 'Acme is mentioned.');
  assert.equal(r.sources.length, 2);
  assert.equal(r.sources[1].domain, 'reference.example');
  assert.throws(() => extractResponse({ items: [] }));
  assert.equal(
    extractResponse({
      items: [{ original_text: 'First' }, { markdown: 'Second' }],
    }).answer,
    'First\n\nSecond',
  );
});
await test('visibility and voice count completed answers once, with historical brand snapshots', () => {
  const base = {
    id: 'test',
    project_id: 'project',
    prompt_id: 'prompt',
    prompt_text: 'Test prompt',
    engine: 'chat_gpt',
    created_at: '2026-09-04T00:00:00Z',
    completed_at: '2026-09-04T00:00:00Z',
    error: null,
    status: 'complete',
    cost: 0.0012,
    sources: [],
    brand_name: 'Old name',
  };
  const runs = [
    { ...base, mentions: { 'Old name': true, Other: true } },
    { ...base, mentions: { 'Old name': false, Other: true } },
    { ...base, status: 'failed', mentions: { 'Old name': true } },
  ] as Run[];
  const m = summarize(runs, 'New name');
  assert.equal(m.visibility, 50);
  assert.equal(m.responses, 2);
  assert.ok(Math.abs(m.shareOfVoice - 100 / 3) < 1e-9);
  assert.equal(m.mentions, 1);
  assert.equal(summarize([], 'Acme').visibility, 0);
});
await test('share-of-voice denominator survives a primary rename and a since-removed competitor, and a single day matches the period KPI', () => {
  const base = {
    id: 'test',
    project_id: 'project',
    prompt_id: 'prompt',
    prompt_text: 'Test prompt',
    engine: 'chat_gpt',
    created_at: '2026-09-04T00:00:00Z',
    completed_at: '2026-09-04T00:00:00Z',
    error: null,
    status: 'complete',
    cost: 0,
    sources: [],
  };
  const runs = [
    // Old snapshot: brand was "OldPrimary"; "Orbit" was tracked back then
    // but is not a competitor in today's roster.
    { ...base, brand_name: 'OldPrimary', mentions: { OldPrimary: true, Orbit: true } },
    // Current snapshot: brand renamed to "NewPrimary"; today's roster only
    // lists "Modo" (which was not mentioned in this run).
    { ...base, brand_name: 'NewPrimary', mentions: { NewPrimary: true, Modo: false } },
  ] as Run[];
  // The denominator counts every mentions_json truthy entry regardless of
  // whether it is still tracked today: OldPrimary + Orbit + NewPrimary = 3,
  // not just entries matching the current roster.
  assert.equal(countAllMentions(runs), 3);
  // The primary numerator uses each run's own historical `brand_name`
  // (matching `summarize`), so a mid-range rename does not drop mentions.
  const primaryMentions = runs.filter((r) => r.mentions[r.brand_name]).length;
  assert.equal(primaryMentions, 2);
  // A single-day dataset's daily share of voice must equal the same data's
  // period-aggregate KPI — both are `mentions / countAllMentions`.
  const dailyShareOfVoice = (primaryMentions / countAllMentions(runs)) * 100;
  assert.ok(
    Math.abs(dailyShareOfVoice - summarize(runs, 'NewPrimary').shareOfVoice) <
      1e-9,
  );
});
await test('mention position only uses answer prose, supports selected competitors and stays unavailable when absent', () => {
  const targets = [
    { name: 'Lastfind', domain: 'lastfind.test' },
    { name: 'Rival', domain: 'rival.test' },
    { name: 'Other', domain: 'other.test' },
  ];
  assert.equal(
    firstMentionPosition(
      'https://rival.test appears first. Lastfind is the relevant answer.',
      ['Rival'],
      targets,
    ),
    null,
  );
  assert.equal(
    firstMentionPosition(
      'Other, then Rival, then Lastfind.',
      ['Rival'],
      targets,
    ),
    2,
  );
  assert.equal(
    firstMentionPosition(
      'Lastfind only appears in prose.',
      ['Lastfind', 'lastfind'],
      targets,
    ),
    1,
  );
  assert.equal(
    firstMentionPosition('No tracked name here.', ['Rival'], targets),
    null,
  );
  assert.equal(
    firstMentionPosition(
      'RivalCo appears before Lastfind.',
      ['Lastfind'],
      [
        { name: 'Lastfind', domain: 'lastfind.test' },
        { name: 'Rival', domain: 'rival.test', aliases: ['RivalCo'] },
      ],
    ),
    2,
  );
  assert.equal(
    firstMentionPosition(
      '## Sources\n[Lastfind](https://lastfind.test)\nMore source notes.',
      ['Lastfind'],
      [{ name: 'Lastfind', domain: 'lastfind.test' }],
    ),
    null,
  );
  assert.equal(
    firstMentionPosition(
      '## Fontes\n- [Lastfind](https://lastfind.test)',
      ['Lastfind'],
      [{ name: 'Lastfind', domain: 'lastfind.test' }],
    ),
    null,
  );
  assert.equal(
    firstMentionPosition(
      'São Paulo aparece no texto.',
      ['Sao Paulo'],
      [{ name: 'São Paulo', domain: 'sao-paulo.test' }],
    ),
    1,
  );
  assert.equal(
    firstMentionPosition(
      'Resposta útil.\n- [Lastfind](https://lastfind.test)',
      ['Lastfind'],
      [{ name: 'Lastfind', domain: 'lastfind.test' }],
    ),
    null,
  );
});
await test('CSV neutralizes formula injection and escapes quotes', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('  @SUM(A1)'), '"\'  @SUM(A1)"');
  assert.equal(csvCell('a "quote"'), '"a ""quote"""');
});
await test('domains normalize and URL protocols are restricted', () => {
  assert.equal(normalizeDomain('https://www.Example.com/path'), 'example.com');
  assert.throws(() => normalizeDomain('https://user:password@example.com'));
  assert.throws(() => normalizeDomain('javascript:alert(1)'));
  assert.throws(() => normalizeDomain('localhost'));
  assert.equal(safeUrl('data:text/html,test'), null);
  assert.equal(safeUrl('https://user:secret@example.com'), null);
  assert.equal(safeUrl('https://example.com'), 'https://example.com/');
});
