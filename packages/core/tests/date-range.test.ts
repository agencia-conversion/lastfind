import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKey,
  DEMO_FIRST_DATE,
  DEMO_LAST_DATE,
  DEMO_TODAY,
  getDateRange,
  isValidDateRange,
  parseISODate,
} from '../components/analytics/date-range.ts';
import {
  defaultFilters,
  demoEnd,
  demoPrompts,
  demoResponses,
  getDemoReport,
  selectResponses,
  type DemoFilters,
} from '../components/analytics/demo-data.ts';
import {
  parseFilters,
  serializeFilters,
} from '../components/analytics/routes.ts';

const DAY_MS = 86_400_000;

await test('ISO dates validate leap years and actual UTC dates without accepting rollovers', () => {
  for (const value of ['2000-02-29', '2024-02-29', '2026-09-09']) {
    const date = parseISODate(value);
    assert.ok(date);
    assert.equal(date.toISOString(), `${value}T00:00:00.000Z`);
    assert.equal(dateKey(date), value);
  }
  for (const value of [
    '1900-02-29',
    '2025-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-9-09',
    '09/09/2026',
    ' 2026-09-09',
    '2026-09-09T00:00:00Z',
    '',
    undefined,
    null,
  ]) {
    assert.equal(parseISODate(value), undefined, String(value));
  }
  assert.equal(dateKey(new Date('2026-09-09T23:00:00-03:00')), '2026-09-10');
});

await test('custom periods include both dates, support leap days and remain bounded to 366 days', () => {
  const sameDay = getDateRange({
    days: 'custom',
    from: '2026-09-01',
    to: '2026-09-01',
  });
  assert.equal(sameDay.days, 1);
  assert.equal(sameDay.start, Date.UTC(2026, 8, 1));
  assert.equal(sameDay.end, Date.UTC(2026, 8, 2));
  assert.deepEqual([sameDay.from, sameDay.to], ['2026-09-01', '2026-09-01']);
  const leap = getDateRange({
    days: 'custom',
    from: '2024-02-28',
    to: '2024-03-01',
  });
  assert.equal(leap.days, 3);
  assert.equal(leap.end - leap.start, 3 * DAY_MS);
  assert.equal(isValidDateRange('2024-01-01', '2024-12-31'), true);
  assert.equal(isValidDateRange('2024-01-01', '2025-01-01'), false);
  assert.equal(isValidDateRange('2000-01-01', '2000-01-01'), true);
  assert.equal(isValidDateRange(DEMO_LAST_DATE, DEMO_LAST_DATE), true);
  for (const [from, to] of [
    ['1999-12-31', '2000-01-01'],
    ['2026-09-09', DEMO_TODAY],
    ['2026-09-02', '2026-09-01'],
    ['2026-02-30', '2026-03-01'],
    ['', '2026-09-01'],
  ])
    assert.equal(isValidDateRange(from, to), false, `${from} — ${to}`);
});

await test('presets end on the last complete demo day and malformed custom input has a safe fallback', () => {
  assert.equal(dateKey(new Date(demoEnd)), DEMO_TODAY);
  assert.equal(demoResponses[0].date.slice(0, 10), DEMO_FIRST_DATE);
  assert.equal(demoResponses.at(-1)!.date.slice(0, 10), DEMO_LAST_DATE);
  for (const days of ['1', '7', '14', '28', '30']) {
    const range = getDateRange({ days });
    assert.equal(range.days, Number(days));
    assert.equal(range.end, demoEnd);
    assert.equal(range.to, DEMO_LAST_DATE);
    assert.equal(range.end - range.start, Number(days) * DAY_MS);
  }
  const fallback = getDateRange({ days: '28' });
  for (const input of [
    { days: 'custom' },
    { days: 'custom', from: '2026-09-01' },
    { days: 'custom', from: '2026-09-09', to: '2026-09-01' },
    { days: 'custom', from: '2000-01-01', to: '2026-09-09' },
    { days: '999999999' },
    { days: '-1' },
    { days: 'NaN' },
  ])
    assert.deepEqual(getDateRange(input), fallback);
  assert.deepEqual(
    getDateRange({ days: '7', from: '2026-09-01' }),
    getDateRange({ days: '7' }),
    'A valid preset remains the fallback when the custom pair is incomplete',
  );
});

await test('live date bounds include today and reject a 91-day custom window', () => {
  const bounds = { firstDate: '2000-01-01', lastDate: '2026-10-13', maxDays: 90 };
  assert.equal(isValidDateRange('2026-10-13', '2026-10-13', bounds), true);
  assert.equal(isValidDateRange('2026-07-16', '2026-10-13', bounds), true);
  assert.equal(isValidDateRange('2026-07-15', '2026-10-13', bounds), false);
  assert.equal(isValidDateRange('2026-10-13', '2026-10-14', bounds), false);
  assert.deepEqual(
    [getDateRange({ days: '1' }, bounds).from, getDateRange({ days: '1' }, bounds).to],
    ['2026-10-13', '2026-10-13'],
  );
  assert.deepEqual(
    [getDateRange({ days: 'custom', from: '2026-09-01', to: '2026-09-30' }, bounds).days],
    [30],
  );
});

await test('custom report boundaries include the final day and compare the preceding equal-length interval', () => {
  const filters: DemoFilters = {
    ...defaultFilters,
    days: 'custom',
    from: '2026-08-15',
    to: '2026-08-18',
    models: ['ChatGPT', 'Claude'],
  };
  const range = getDateRange(filters);
  const current = selectResponses(demoPrompts, filters);
  const previous = selectResponses(demoPrompts, filters, true);
  assert.equal(current.length, 4 * 10 * 2);
  assert.equal(previous.length, current.length);
  assert.deepEqual(
    [...new Set(current.map((row) => row.date.slice(0, 10)))],
    ['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'],
  );
  assert.deepEqual(
    [...new Set(previous.map((row) => row.date.slice(0, 10)))],
    ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'],
  );
  assert.ok(
    current.every(
      (row) =>
        Date.parse(row.date) >= range.start && Date.parse(row.date) < range.end,
    ),
  );
  assert.ok(
    previous.every(
      (row) =>
        Date.parse(row.date) >= range.start - 4 * DAY_MS &&
        Date.parse(row.date) < range.start,
    ),
  );
  const ids = new Set(current.map((row) => row.id));
  assert.ok(previous.every((row) => !ids.has(row.id)));
  const report = getDemoReport(demoPrompts, filters);
  assert.deepEqual(report.responses, current);
  assert.deepEqual(report.previous, previous);
  assert.deepEqual(
    report.trend.map((point) => point.date),
    ['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'],
  );
  assert.equal(
    selectResponses(demoPrompts, {
      ...filters,
      from: '2026-08-18',
      to: '2026-08-18',
    }).length,
    20,
  );
});

await test('dates outside available fixtures stay visible in the trend without fabricated responses', () => {
  const report = getDemoReport(demoPrompts, {
    ...defaultFilters,
    days: 'custom',
    from: '2026-07-14',
    to: '2026-07-17',
  });
  assert.equal(report.responses.length, 2 * 10 * defaultFilters.models.length);
  assert.equal(report.previous.length, 0);
  assert.deepEqual(
    report.trend.map((point) => point.date),
    ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17'],
  );
  for (const point of report.trend.slice(0, 2)) {
    for (const brand of report.brands)
      assert.equal(Reflect.get(point, brand.id), 0);
  }
  const year = getDemoReport(demoPrompts, {
    ...defaultFilters,
    days: 'custom',
    from: '2024-01-01',
    to: '2024-12-31',
  });
  assert.equal(year.trend.length, 366);
  assert.equal(year.trend[0].date, '2024-01-01');
  assert.equal(year.trend.at(-1)!.date, '2024-12-31');
  assert.equal(year.responses.length, 0);
  assert.equal(year.previous.length, 0);
  assert.ok(
    year.brands.every(
      (brand) =>
        Number.isFinite(brand.visibility) && Number.isFinite(brand.change),
    ),
  );
});

await test('custom date URLs round-trip model selections and omit preset days canonically', () => {
  for (const models of [['ChatGPT', 'Claude'], []] as const) {
    const filters: DemoFilters = {
      days: 'custom',
      from: '2026-08-01',
      to: '2026-08-12',
      models: [...models],
      country: 'Brazil',
      topic: 'Agências de SEO',
      tag: 'Comparação & compra',
    };
    const search = serializeFilters(filters);
    assert.equal(search.get('days'), null);
    assert.equal(search.get('from'), filters.from);
    assert.equal(search.get('to'), filters.to);
    assert.equal(
      search.get('models'),
      models.length ? 'chatgpt,claude' : 'none',
    );
    assert.deepEqual(parseFilters(search), filters);
    assert.equal(
      serializeFilters(parseFilters(search)).toString(),
      search.toString(),
    );
    search.set('days', '7');
    assert.deepEqual(
      parseFilters(search),
      filters,
      'A valid date pair takes priority over legacy preset parameters',
    );
  }
  for (const days of ['1', '7', '14', '28', '30']) {
    assert.deepEqual(
      parseFilters(serializeFilters({ ...defaultFilters, days })),
      { ...defaultFilters, days },
    );
  }
});

await test('invalid or incomplete date URLs discard both bounds while keeping other valid filters', () => {
  for (const dateQuery of [
    'from=2026-08-01',
    'to=2026-08-12',
    'from=2026-08-12&to=2026-08-01',
    'from=2026-02-29&to=2026-03-01',
    'from=1999-12-31&to=2000-01-01',
    'from=2026-09-09&to=2026-09-10',
    'from=2024-01-01&to=2025-01-01',
  ]) {
    const parsed = parseFilters(
      new URLSearchParams(`${dateQuery}&days=7&models=claude&country=Brazil`),
    );
    assert.deepEqual(parsed, {
      ...defaultFilters,
      days: '7',
      models: ['Claude'],
      country: 'Brazil',
    });
    assert.equal(
      serializeFilters(parsed).toString(),
      'days=7&models=claude&country=Brazil',
    );
    assert.deepEqual(
      parseFilters(new URLSearchParams(dateQuery)),
      defaultFilters,
    );
  }
  assert.equal(
    serializeFilters({
      ...defaultFilters,
      days: 'custom',
      from: '2026-09-09',
      to: '2026-09-01',
    }).toString(),
    '',
  );
});

await test('nonpreset numeric periods respect live bounds and invalid numbers retain the safe fallback', () => {
  const bounds = { firstDate: '2000-01-01', lastDate: '2026-10-14', maxDays: 90 };
  const range = getDateRange({days:'60'}, bounds);
  assert.deepEqual([range.days,range.from,range.to],[60,'2026-08-16','2026-10-14']);
  assert.equal(range.end-range.start,60*DAY_MS);
  assert.equal(getDateRange({days:'90'},bounds).days,90);
  for (const days of ['0','-1','1.5','91','366','Infinity','NaN','']) assert.deepEqual(getDateRange({days},bounds),getDateRange({days:'28'},bounds));
  assert.equal(getDateRange({days:'60'},{...bounds,maxDays:14}).days,14);
});
