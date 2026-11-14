import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTopic, parsePromptCsv, promptSourcesEmptyText, suggestPrompts } from '../lib/prompt-tools.ts';
import { positiveLimit, scheduleOf, nextCollection, lastCollection, slotKey, scheduleWindow, validDay, validHour, validTimeZone, quotaWeek } from '../lib/scheduling.ts';
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
void test('a prompt without a topic takes the project language default', () => {
  assert.equal(defaultTopic('pt'), 'Geral');
  assert.equal(defaultTopic('pt-BR'), 'Geral');
  assert.equal(defaultTopic('en'), 'General');
  assert.equal(defaultTopic(undefined), 'General');
  assert.equal(parsePromptCsv('prompt\nWhich tool is best?', 'en')[0].tag, 'General');
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
const SP = 'America/Sao_Paulo';
const daily = (hour: number, zone = SP) => scheduleOf({ interval_hours: 24, collection_hour: hour }, false, zone);
const weekly = (hour: number, day = 1, zone = SP) => scheduleOf({ interval_hours: 168, collection_hour: hour, collection_day: day }, false, zone);

void test('the default is Monday 04:00 in the workspace time zone; a stored workspace without one is São Paulo', () => {
  // Existing rows (no day, interval 24) keep 04:00 São Paulo daily (07:00 UTC, the same instant as before the hours went local).
  assert.deepEqual(scheduleOf({ interval_hours: 24 }), { weekly: false, day: 1, hour: 4, zone: SP });
  assert.deepEqual(scheduleOf({ interval_hours: 24, collection_hour: 22 }, true, 'Asia/Tokyo'), { weekly: true, day: 1, hour: 22, zone: 'Asia/Tokyo' });
  assert.deepEqual(scheduleOf({ collection_hour: 99, collection_day: 9 }, false, 'Not/AZone'), { weekly: false, day: 1, hour: 4, zone: SP });
  for (const bad of [-1, 24, 7.5, '7', null]) assert.equal(validHour(bad), false);
  for (const bad of [-1, 7, 1.5, '1', null]) assert.equal(validDay(bad), false);
  for (const bad of ['', 'Mars/Base', 7, null, 'x'.repeat(65)]) assert.equal(validTimeZone(bad), false);
  assert.equal(validTimeZone('Europe/Lisbon'), true);
  assert.equal(nextCollection('2026-11-03T12:00:00.000Z', scheduleOf({ interval_hours: 168 })), '2026-11-09T07:00:00.000Z', 'Monday 04:00 BRT');
  for (const value of ['', 'NaN', '-1', 'Infinity', '1.2'])
    assert.equal(positiveLimit(value, 1500), 1500);
});

void test('each project collects on its day and at its hour in the workspace time zone, daily or weekly', () => {
  // Daily at 04:00 São Paulo (UTC-3), across the year boundary.
  assert.equal(nextCollection('2026-12-31T23:45:00.000Z', daily(4)), '2027-01-01T07:00:00.000Z');
  assert.equal(nextCollection('2026-09-04T06:59:59.000Z', daily(4)), '2026-09-04T07:00:00.000Z');
  assert.equal(nextCollection('2026-09-04T07:00:00.000Z', daily(4)), '2026-09-05T07:00:00.000Z');
  // Weekly on Wednesday at 09:00 Tokyo (UTC+9): Wednesday 00:00 UTC.
  assert.equal(nextCollection('2026-11-03T12:00:00.000Z', weekly(9, 3, 'Asia/Tokyo')), '2026-11-04T00:00:00.000Z');
  assert.equal(nextCollection('2026-11-04T00:00:00.000Z', weekly(9, 3, 'Asia/Tokyo')), '2026-11-11T00:00:00.000Z');
  assert.equal(lastCollection('2026-11-10T23:59:59.000Z', weekly(9, 3, 'Asia/Tokyo')), '2026-11-04T00:00:00.000Z');
  // Sunday at 23:00 São Paulo is Monday 02:00 UTC.
  assert.equal(nextCollection('2026-11-02T03:00:00.000Z', weekly(23, 0)), '2026-11-09T02:00:00.000Z');
  // New York keeps 02:00 local across its clock changes; the skipped 02:00 of 14 March runs just after the change (03:00 EDT).
  const ny = daily(2, 'America/New_York');
  assert.equal(nextCollection('2026-10-31T12:00:00.000Z', ny), '2026-11-01T07:00:00.000Z', '02:00 EST, after the fall back');
  assert.equal(nextCollection('2026-10-30T12:00:00.000Z', ny), '2026-10-31T06:00:00.000Z', '02:00 EDT');
  assert.equal(nextCollection('2027-03-13T08:00:00.000Z', ny), '2027-03-14T07:00:00.000Z');
  assert.equal(nextCollection('2027-03-14T08:00:00.000Z', ny), '2027-03-15T06:00:00.000Z');
});

void test("the run key is the slot's local date: once per slot, even when the hour moves within the day or the clock changes", () => {
  // A delayed reservation keeps its slot's date; 23:00 São Paulo is 02:00 UTC the next day, still its own local date.
  assert.equal(slotKey('2026-10-13T02:10:00.000Z', daily(23)), '2026-10-12');
  assert.equal(slotKey('2026-10-13T06:59:00.000Z', daily(23)), '2026-10-12');
  // Moving the hour later on the same day maps to the date already collected (the unique key refuses the second run).
  assert.equal(slotKey('2026-10-12T07:00:00.000Z', daily(4)), slotKey('2026-10-13T01:00:00.000Z', daily(22)));
  // Every local day of a year with clock changes has its own key.
  const keys = new Set<string>();
  for (let at = Date.parse('2026-01-01T12:00:00.000Z'); at < Date.parse('2027-01-01T12:00:00.000Z'); at += 86_400_000)
    keys.add(slotKey(new Date(at).toISOString(), daily(0, 'Europe/London')));
  assert.equal(keys.size, 365);
  // Semantic Branding keeps its own day: 07:00 UTC.
  assert.equal(scheduleWindow('2026-10-12T07:00:00.000Z').slice(0, 10), '2026-10-12');
  assert.equal(scheduleWindow('2026-10-12T06:59:00.000Z').slice(0, 10), '2026-10-11');
});

void test('the weekly quota week is Monday 00:00 in the workspace zone, and every weekly slot falls inside its own week', () => {
  assert.equal(quotaWeek('2026-10-12T03:00:00.000Z'), '2026-10-12T03:00:00.000Z');
  assert.equal(quotaWeek('2026-10-12T02:59:59.000Z'), '2026-10-05T03:00:00.000Z');
  assert.equal(quotaWeek('2026-11-03T00:00:00.000Z', 'Asia/Tokyo'), '2026-11-01T15:00:00.000Z');
  for (const zone of [SP, 'Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati'])
    for (let day = 0; day < 7; day++)
      for (let hour = 0; hour < 24; hour += 5) {
        const first = nextCollection('2026-10-11T12:00:00.000Z', weekly(hour, day, zone));
        const second = nextCollection(first, weekly(hour, day, zone));
        assert.ok(quotaWeek(first, zone) <= first && quotaWeek(second, zone) > first, `${zone} ${day} ${hour}`);
      }
});

void test('moving the day or hour mid-week never opens a second weekly-quota week', () => {
  // A weekly-only project collected on Monday 12 October at 04:00 São Paulo (10 runs, its whole weekly quota).
  const collected = '2026-10-12T07:00:00.000Z';
  for (const [changedAt, hour, day] of [['2026-10-12T08:00:00.000Z', 22, 1], ['2026-10-12T08:00:00.000Z', 3, 4], ['2026-10-14T12:00:00.000Z', 0, 6], ['2026-10-18T23:00:00.000Z', 23, 0]] as const) {
    const next = nextCollection(changedAt, weekly(hour, day));
    // Either the next slot is in the same quota week (so those 10 runs are counted and refuse it)…
    if (quotaWeek(next) === quotaWeek(collected)) assert.ok(next > collected, `${changedAt} ${hour}`);
    // …or it is in a later week, never earlier than the next Monday.
    else assert.ok(quotaWeek(next) > quotaWeek(collected) && next >= '2026-10-19T03:00:00.000Z', `${changedAt} ${hour}`);
  }
  assert.equal(quotaWeek(nextCollection('2026-10-12T08:00:00.000Z', weekly(22))), quotaWeek(collected));
});

const en = (text: string) => text;
const pt = (_: string, text: string) => text;

test('empty Sources says "no answers" only when there are none', () => {
  assert.match(promptSourcesEmptyText(true, en), /no answer was collected/);
  assert.match(promptSourcesEmptyText(false, en), /answers collected in this period cited no sources/);
  assert.doesNotMatch(promptSourcesEmptyText(false, en), /no answer was collected/);
  assert.match(promptSourcesEmptyText(true, pt), /nenhuma resposta foi coletada/);
  assert.match(promptSourcesEmptyText(false, pt), /não citaram fontes/);
});
