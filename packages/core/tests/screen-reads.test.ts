import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveriesReadPath, firstScreenReads, overviewReadPaths, reportFilterQuery, researchReadPath, screenReportPath } from '../components/analytics/screen-reads.ts';
import { expandAppPath } from '../components/analytics/app-routes.ts';

// The app page sends a screen's first reads along with itself: they must be the very paths the screen then asks, built from
// its state as it opens with no filter (live-app.tsx), or the browser asks them again.
const opened = (tab: string, days = '28') =>
  reportFilterQuery({
    projectId: 'p-1',
    days,
    startDate: '',
    endDate: '',
    engine: 'all',
    topic: '',
    tags: '',
    query: '',
    tab,
    mention: 'all',
    brand: '',
    gap: false,
    source: { kind: 'all', group: 'domain', page: 1, type: '', owner: '', origin: 'all', sort: undefined },
  });

test('first reads are the paths each screen asks when it opens with no filter but the period', () => {
  const overview = overviewReadPaths('/api', opened('overview'));
  assert.deepEqual(firstScreenReads('overview', 'p-1', new URLSearchParams()), [
    screenReportPath('/api', 'overview', opened('overview')),
    overview.sources,
    overview.content,
    overview.history,
    overview.fanout,
    overview.types,
    overview.contentTypes,
    researchReadPath(false, 'p-1', opened('overview')),
    // The discoveries the Overview ranks, the same read as the header's Brands menu (it used to wait for the page).
    '/api/projects/p-1/brands?top=50',
  ]);
  assert.equal(discoveriesReadPath('p-1'), '/api/projects/p-1/brands?top=50');
  assert.equal(overview.sources, '/api/reports?project=p-1&days=28&view=sources&kind=cited&group=domain&order=presence');
  assert.deepEqual(firstScreenReads('sources', 'p-1', new URLSearchParams('days=7')), [screenReportPath('/api', 'sources', opened('sources', '7'))]);
  assert.equal(firstScreenReads('sources', 'p-1', new URLSearchParams())[0], '/api/reports?project=p-1&days=28&kind=all&evidence=1&change=1&group=domain&page=1&origin=all&view=sources');
  assert.deepEqual(firstScreenReads('prompts', 'p-1', new URLSearchParams()), [
    '/api/reports?project=p-1&days=28&view=prompts&compact=1',
    '/api/projects/p-1/brand-research?project=p-1&days=28',
  ]);
  assert.deepEqual(firstScreenReads('models', 'p-1', new URLSearchParams()), ['/api/reports?project=p-1&days=28&view=analysis']);
  assert.deepEqual(firstScreenReads('responses', 'p-1', new URLSearchParams()), [
    screenReportPath('/api', 'responses', opened('responses')),
    '/api/reports?project=p-1&days=28&view=summary',
    '/api/projects/p-1/brands?top=50',
  ]);
  // The page reads the address in its long form (`project` and `tab` name the screen): they used to count as filters, and
  // no screen got its reads with the page.
  const address = (path: string) => {
    const url = new URL(path, 'https://local.invalid');
    return expandAppPath(url.pathname.split('/').filter(Boolean), url.searchParams)!;
  };
  assert.deepEqual(firstScreenReads('overview', 'p-1', address('/acme-k7m2qd')), firstScreenReads('overview', 'p-1', new URLSearchParams()));
  assert.deepEqual(firstScreenReads('prompts', 'p-1', address('/acme-k7m2qd/prompts?period=7d')), firstScreenReads('prompts', 'p-1', new URLSearchParams('days=7')));
  assert.deepEqual(firstScreenReads('sources', 'p-1', address('/acme-k7m2qd/sources?model=chatgpt')), []);
  // Any other filter, or a screen without first reads: nothing is sent, the screen reads as usual.
  assert.deepEqual(firstScreenReads('overview', 'p-1', new URLSearchParams('engine=gemini')), []);
  assert.deepEqual(firstScreenReads('overview', 'p-1', new URLSearchParams('days=7&start=2026-01-01')), []);
  assert.deepEqual(firstScreenReads('settings', 'p-1', new URLSearchParams()), []);
});

// Every read a screen sends carries the header's filters; the comparison too, except the sentiment, which has none.
test('every screen read carries the header models, topics, tags and comparison', () => {
  // Several topics go as repeated `topic` parameters: a topic name may hold a comma.
  const header = { engine: 'gemini,perplexity', topic: 'Pricing\nSEO, GEO', tags: 'paid,budget', compareStart: '2026-08-01', compareEnd: '2026-08-28' };
  for (const tab of ['overview', 'prompts', 'responses', 'sources', 'competitors', 'models', 'fanout']) {
    const filters = reportFilterQuery({ projectId: 'p-1', days: '28', tab, ...header, source: { kind: 'all', group: 'domain', page: 1, origin: 'all' } });
    const paths = [screenReportPath('/api', tab, filters)!, ...Object.values(overviewReadPaths('/api', filters)), researchReadPath(false, 'p-1', filters), researchReadPath(true, 'p-1', filters)];
    for (const path of paths) {
      const query = new URL(path, 'https://local.invalid').searchParams;
      assert.deepEqual([query.get('engine'), query.getAll('topic'), query.get('tags')], [header.engine, ['Pricing', 'SEO, GEO'], header.tags], `${tab}: ${path}`);
      const compared = !path.includes('/brand-research?');
      assert.deepEqual([query.get('compareStart'), query.get('compareEnd')], compared ? [header.compareStart, header.compareEnd] : [null, null], `${tab}: ${path}`);
    }
  }
  // An address with a tag gets no reads sent with the page (those are unfiltered): the screen asks its own.
  assert.equal(firstScreenReads('overview', 'p-1', new URLSearchParams('tags=paid')).length, 0);
});

test('drill down: Responses filtered by a cited domain read it as the server source filter, the own domain as own=1', () => {
  const responses = (cites: string, tab = 'responses') => reportFilterQuery({ projectId: 'p-1', days: '28', tab, cites }).toString();
  assert.equal(responses('own'), 'project=p-1&days=28&own=1');
  assert.equal(responses('example.com'), 'project=p-1&days=28&source=example.com');
  assert.equal(responses(''), 'project=p-1&days=28');
  // Only Responses reads it: another screen keeps its own report.
  assert.equal(responses('own', 'overview'), 'project=p-1&days=28');
  // A page (URL) is a source of the URL group.
  assert.equal(responses('https://example.com/guide'), 'project=p-1&days=28&source=https%3A%2F%2Fexample.com%2Fguide&sourceGroup=url');
  // A sentiment band and a prompt: Responses only.
  const filtered = (tab: string) => reportFilterQuery({ projectId: 'p-1', days: '28', tab, sentiment: 'positive', prompt: 'unit-1' }).toString();
  assert.equal(filtered('responses'), 'project=p-1&days=28&sentiment=positive&prompt=unit-1');
  assert.equal(filtered('overview'), 'project=p-1&days=28');
});
