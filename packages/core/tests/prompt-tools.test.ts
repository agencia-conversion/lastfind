import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePromptCsv, suggestPrompts } from '../lib/prompt-tools.ts';
import { nextRunTime, positiveLimit } from '../lib/scheduling.ts';
void test('CSV accepts quoted commas, escaped quotes, multiline fields and UTF-8 BOM', () => {
  const rows = parsePromptCsv(
    '\uFEFFprompt,engine,topic,tags\r\n"Compare CRM, analytics and ""sales"" tools",chatgpt,Compra,CRM|Decisão\r\n"Which tools\nwork for remote teams?",gemini,Discovery,Remote',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, 'Compare CRM, analytics and "sales" tools');
  assert.deepEqual(rows[0].tags, ['CRM', 'Decisão']);
  assert.equal(rows[1].engine, 'gemini');
  assert.ok(rows[1].text.includes('\n'));
});
void test('CSV accepts semicolon files and rejects malformed and oversized imports', () => {
  assert.equal(
    parsePromptCsv(
      'prompt;engine;topic;tags\nWhich tool is best?;chat_gpt;Compare;B2B',
    )[0].tag,
    'Compare',
  );
  for (const text of [
    'text,engine\n"unterminated,chat_gpt',
    'text,engine\nValid question?,unknown',
    'wrong,engine\nValid question?,chat_gpt',
    'prompt\n' + Array(101).fill('A valid question?').join('\n'),
  ])
    assert.throws(() => parsePromptCsv(text));
});
void test('suggestions reflect audience and language, with discovery prompts unbranded', () => {
  const rows = suggestPrompts({
    name: 'Acme',
    category: 'CRM software',
    audience: 'remote teams',
    language_code: 'en',
  });
  assert.equal(rows.length, 6);
  assert.ok(rows[0].text.includes('CRM software'));
  assert.ok(rows[0].text.includes('remote teams'));
  assert.ok(!rows[0].text.includes('Acme'));
  assert.ok(rows[5].text.includes('Acme'));
});
void test('next runs use the next 4AM Brasilia window across boundaries', () => {
  assert.equal(
    nextRunTime('2026-12-31T23:45:00.000Z'),
    '2027-01-01T07:00:00.000Z',
  );
  assert.equal(
    nextRunTime('2026-09-04T06:59:59.000Z'),
    '2026-09-04T07:00:00.000Z',
  );
  assert.equal(
    nextRunTime('2026-09-04T07:00:00.000Z'),
    '2026-09-05T07:00:00.000Z',
  );
  assert.equal(
    nextRunTime('2026-09-04T12:00:00.000Z'),
    '2026-09-05T07:00:00.000Z',
  );
  for (const value of ['', 'NaN', '-1', 'Infinity', '1.2'])
    assert.equal(positiveLimit(value, 1500), 1500);
});
