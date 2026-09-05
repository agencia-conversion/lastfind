import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesBrand,
  extractResponse,
  summarize,
  csvCell,
  normalizeDomain,
  safeUrl,
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
