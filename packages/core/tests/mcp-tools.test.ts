import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import * as z from 'zod';
import { type Json, keyOf, nextKey, nextPage, pageOf, projection, routeOf, ToolError, toolErrorCode, toolsFor, TOOLS, type ToolContext } from '../lib/server/mcp-tools.ts';

const ORDER = [
  'list_projects', 'get_project', 'get_overview', 'list_prompts', 'get_prompt', 'list_responses', 'get_response', 'compare_brands',
  'list_discovered_brands', 'get_sentiment', 'list_sources', 'get_source_types', 'get_source', 'compare_ai_models', 'get_query_fanout',
  'list_opportunities', 'get_semantic_branding', 'get_semantic_evidence', 'get_products', 'get_ai_bots', 'get_comparison',
  'create_prompts', 'update_prompt', 'set_prompt_status', 'organize_prompts', 'create_topic', 'update_topic', 'delete_topic', 'decide_brand',
];
const WRITES = new Set(ORDER.slice(21));

/** Runs a tool against a context that records the calls and answers what the routes would (shape only). */
async function calls(name: string, args: Record<string, unknown>, answers: Record<string, unknown> = {}) {
  const made: { method: string; path: string; body?: unknown }[] = [];
  const reply = (path: string) => {
    const file = routeOf(new URL(path, 'https://app.test').pathname)?.file ?? '';
    return structuredClone((answers[file] ?? (file === 'api/workspace' ? { projects: [{ id: 'p1' }], prompts: [], topics: [] } : {})) as Record<string, unknown>);
  };
  const context: ToolContext = {
    // The body as it is sent (JSON).
    call: async (method, path, body) => (made.push({ method, path, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) }), reply(path)),
    everyWorkspace: async (path) => (made.push({ method: 'GET', path }), [{ workspaceId: 'o1', role: 'owner', data: reply(path) }]),
  };
  const tool = TOOLS.find((each) => each.name === name)!;
  const result = await tool.run(tool.input.parse(args), context);
  return { made, result, query: new URL(made[0].path, 'https://app.test').searchParams };
}

test('the 29 tools keep their fixed order, and a read token sees no change', () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), ORDER);
  assert.deepEqual(toolsFor(true).map((tool) => tool.name), ORDER);
  assert.deepEqual(toolsFor(false).map((tool) => tool.name), ORDER.filter((name) => !WRITES.has(name)));
  for (const tool of TOOLS) {
    assert.equal(!!tool.write, WRITES.has(tool.name), tool.name);
    // A change is never read-only for a client and always asks for confirmation.
    if (tool.write) assert.match(tool.description, /confirm with the user/);
    assert.equal(z.toJSONSchema(tool.input, { io: 'input' }).type, 'object', tool.name);
    assert.equal(z.toJSONSchema(tool.output, { io: 'output' }).type, 'object', tool.name);
  }
});

test('every call of every tool reaches an existing route and method', async () => {
  const minimal: Record<string, Record<string, unknown>> = {
    get_response: { response: 'r1' }, get_prompt: { prompt: 'q1' }, get_source: { source: 'example.com' }, get_semantic_evidence: { brand: 'Acme' },
    create_prompts: { prompts: [{ text: 'Which CRM is best?' }] }, update_prompt: { prompt: 'q1', text: 'Which CRM is best?' },
    set_prompt_status: { prompts: ['q1'], status: 'pause' }, organize_prompts: { prompts: ['q1'], topic: 'CRM' }, create_topic: { name: 'CRM' },
    update_topic: { topic: 't1', name: 'CRM' }, delete_topic: { topic: 't1' }, decide_brand: { action: 'reject', name: 'Rival' },
  };
  for (const name of ORDER) {
    const { made } = await calls(name, { ...(name === 'list_projects' ? {} : { project: 'p1' }), ...minimal[name] });
    assert.ok(made.length, name);
    for (const { method, path } of made) {
      const route = routeOf(new URL(path, 'https://app.test').pathname);
      assert.ok(route, `${name}: ${path} is no route`);
      const file = new URL(`../app/${route.file}/route.ts`, import.meta.url);
      assert.ok(existsSync(file), `${name}: ${route.file}`);
      assert.match(readFileSync(file, 'utf8'), new RegExp(`export (async function|const) ${method}\\b`), `${name}: ${method} ${route.file}`);
      assert.equal(method === 'GET', !WRITES.has(name), `${name} reads with GET and changes with another method`);
    }
  }
});

test('the arguments become the query string the screens send', async () => {
  const filters = { project: 'p1', start: '2026-09-01', end: '2026-09-30', compare_start: '2026-08-01', compare_end: '2026-08-31', engines: ['gemini', 'google_ai_mode'], topic: 'Pricing', tags: ['paid', 'budget'], query: 'crm' };
  const overview = (await calls('get_overview', filters)).query;
  assert.deepEqual(Object.fromEntries(overview), { project: 'p1', days: '28', start: '2026-09-01', end: '2026-09-30', compareStart: '2026-08-01', compareEnd: '2026-08-31', engine: 'gemini,google_ai_mode', topic: 'Pricing', tags: 'paid,budget', query: 'crm', view: 'summary' });
  assert.equal((await calls('get_overview', { project: 'p1' })).query.toString(), 'project=p1&days=28&view=summary');

  const prompts = await calls('list_prompts', { project: 'p1', days: 7, competitor_gaps_only: true });
  assert.equal(prompts.made[1].path, '/api/reports?project=p1&days=7&gap=competitor-only&view=prompts&compact=1');

  const responses = (await calls('list_responses', { project: 'p1', prompt: 'q1', brand: 'Rival', mention: 'missing', source: 'https://example.com/a', cursor: 'k:abc' })).query;
  assert.equal(responses.get('view'), 'history');
  assert.deepEqual([responses.get('prompt'), responses.get('brand'), responses.get('mention'), responses.get('source'), responses.get('sourceGroup'), responses.get('sourceKind'), responses.get('cursor')], ['q1', 'Rival', 'missing', 'https://example.com/a', 'url', 'cited', 'abc']);

  const sources = (await calls('list_sources', { project: 'p1', kind: 'cited', group: 'url', source_types: ['listicle', 'comparison'], owners: ['third-party'], sort: 'presence', dir: 'asc', cursor: 'p:3', query: 'blog' })).query;
  assert.deepEqual(Object.fromEntries(sources), { project: 'p1', days: '28', query: 'blog', kind: 'cited', evidence: '1', change: '1', group: 'url', page: '3', type: 'listicle,comparison', owner: 'third-party', origin: 'all', sort: 'presence', dir: 'asc', view: 'sources' });

  assert.equal((await calls('get_source', { project: 'p1', source: 'example.com' })).query.get('view'), 'domain-detail');
  assert.equal((await calls('get_source', { project: 'p1', source: 'https://example.com/a' })).query.get('view'), 'url-detail');
  assert.equal((await calls('get_source_types', { project: 'p1', by: 'content' })).query.get('view'), 'content-types');
  assert.equal((await calls('get_query_fanout', { project: 'p1', query_key: 'best crm' })).query.get('key'), 'best crm');
  assert.equal((await calls('get_query_fanout', { project: 'p1', intent: 'i-1' })).query.get('intent'), 'i-1');
  assert.equal((await calls('list_opportunities', { project: 'p1', days: 7 })).query.get('view'), 'opportunities');
  const models = (await calls('compare_ai_models', { project: 'p1', cursor: 'p:2' })).query;
  assert.deepEqual([models.get('topicPage'), models.get('promptPage')], ['2', '2']);

  // Sentiment has no comparison (researchReadPath); the panel takes the period alone.
  const sentiment = await calls('get_sentiment', { project: 'p1', engines: ['gemini'] });
  assert.equal(sentiment.made[0].path, '/api/projects/p1/brand-research?project=p1&days=28&engine=gemini');
  assert.equal((await calls('get_semantic_branding', { project: 'p1', period: '2026-09-07' })).made[0].path, '/api/projects/p1/semantic/panel?days=28&period=2026-09-07');
  assert.equal((await calls('get_semantic_evidence', { project: 'p1', brand: 'Acme', cursor: 'k:25' })).made[0].path, '/api/projects/p1/semantic/panel/evidence?days=28&brand=Acme&cursor=25');

  // The sentiment index of every brand and model (sentimentScore); the screen's evaluator settings and spend ceiling stay out.
  const research = await calls('get_sentiment', { project: 'p1' }, { 'api/projects/[id]/brand-research': { configured: true, configuration: { monthlyCeilingUsd: 10 }, jobs: [{}], brands: [{ brand: 'Acme', assessed: 4, scoreTotal: 300, channels: [{ engine: 'gemini', assessed: 0, scoreTotal: 0 }] }] } });
  assert.deepEqual([research.result.brands[0].sentiment_index, research.result.brands[0].channels[0].sentiment_index, research.result.evaluator_enabled], [75, null, true]);
  assert.equal('configuration' in research.result || 'jobs' in research.result, false);

  const decision = await calls('decide_brand', { project: 'p1', action: 'merge', name: 'Rival Inc', into: 'Rival' });
  assert.deepEqual([decision.made[0].method, decision.made[0].path, decision.made[0].body], ['POST', '/api/projects/p1/brands', { action: 'alias', name: 'Rival Inc', into: 'Rival' }]);
  const status = await calls('set_prompt_status', { project: 'p1', prompts: ['q1', 'q2'], status: 'archive' });
  assert.deepEqual(status.made[0].body, { project_id: 'p1', ids: ['q1', 'q2'], action: 'archive' });
  const created = await calls('create_prompts', { project: 'p1', prompts: [{ text: 'Which CRM is best?', topic: 'CRM', engines: ['gemini'] }] });
  assert.deepEqual(created.made[0].body, { project_id: 'p1', prompts: [{ text: 'Which CRM is best?', tag: 'CRM', tags: [], engines: ['gemini'] }] });
  // The paid domain discovery of the Brands route is not a decision a tool can ask for.
  assert.throws(() => TOOLS.find((tool) => tool.name === 'decide_brand')!.input.parse({ project: 'p1', action: 'discover-domains' }));
});

test('list_prompts joins the prompts with their metrics, filters and pages them', async () => {
  const prompts = Array.from({ length: 60 }, (_, index) => ({ id: `q${index}`, text: `Question ${index}`, tag: index % 2 ? 'Odd' : 'Even', tags: index % 3 ? [] : ['three'], engines: ['chat_gpt'], active: index !== 1 ? 1 : 0, archived: index === 2 ? 1 : 0 }));
  const answers = { 'api/workspace': { prompts }, 'api/reports': { q0: { responses: 4, visibility: 50 } } };
  const first = await calls('list_prompts', { project: 'p1' }, answers);
  assert.equal(first.result.total, 59);
  assert.equal(first.result.prompts.length, 50);
  assert.equal(first.result.next_cursor, 'p:2');
  assert.deepEqual(first.result.prompts[0].metrics, { responses: 4, visibility: 50 });
  assert.equal(first.result.prompts[1].status, 'paused');
  assert.equal(first.result.prompts[1].metrics, null);
  assert.equal((await calls('list_prompts', { project: 'p1', cursor: 'p:2' }, answers)).result.next_cursor, null);
  assert.equal((await calls('list_prompts', { project: 'p1', topic: 'Odd', tags: ['three'] }, answers)).result.total, 10);
  assert.deepEqual((await calls('list_prompts', { project: 'p1', competitor_gaps_only: true }, answers)).result.prompts.map((row: { id: string }) => row.id), ['q0']);
});

test('get_ai_bots reads the screen\'s route and adds the screen\'s rates and changes, never the connection\'s details', async () => {
  const connection = { state: 'active', zone: 'example.com', plan: 'Pro Website', paid: true, tokenHint: 'ab12', canManage: true, problem: null, backfilling: false, lastSyncAt: '2026-11-11T03:00:00Z', preview: false };
  const report = {
    connection,
    period: { from: '2026-10-15', to: '2026-11-11', compareFrom: '2026-09-17', compareTo: '2026-10-14', days: 28, covered: 28, previousCovered: 28, compared: true },
    totals: { visits: 200, previousVisits: 100, requests: 10000, pages: 40, previousPages: 50, sitePages: 300, bots: 5, previousBots: 3, operators: 3, errors: 20, previousErrorRate: 0.05, referrals: 12, previousReferrals: 0 },
    trend: [{ date: '2026-11-10', training: 3, search: 2, user: 1 }],
    bots: [
      { id: 'gptbot', name: 'GPTBot', operator: 'OpenAI', purpose: 'training', visits: 120, previous: 60, pages: 30, errors: 10, lastDay: '2026-11-10' },
      { id: 'oai-searchbot', name: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'search', visits: 50, previous: 30, pages: 12, errors: 5, lastDay: '2026-11-10' },
      { id: 'chatgpt-user', name: 'ChatGPT-User', operator: 'OpenAI', purpose: 'user', visits: 30, previous: 10, pages: 9, errors: 5, lastDay: '2026-11-09' },
    ],
    operators: [{ operator: 'OpenAI', visits: 200, referrals: 12 }],
    pages: [{ path: '/pricing', visits: 40, bots: 3, cited: true }],
    statuses: [{ status: 'ok', visits: 180 }, { status: 'not_found', visits: 20 }],
    llms: [{ id: 'chatgpt', name: 'ChatGPT', operator: 'OpenAI', visits: 12, previous: 0, pages: 2, lastDay: '2026-11-10' }],
    landings: [{ path: '/pricing', visits: 12, llms: 1, cited: true }],
  };
  const { made, result } = await calls('get_ai_bots', { project: 'p1', days: 28, compare_start: '2026-08-01', compare_end: '2026-08-28' }, { 'api/projects/[id]/ai-bots': { connection, report } });
  assert.equal(made[0].path, '/api/projects/p1/ai-bots?days=28&compareStart=2026-08-01&compareEnd=2026-08-28');
  assert.deepEqual(result.connection, { connected: true, needs_attention: false, first_days_loading: false, last_read_at: '2026-11-11T03:00:00Z', example_data: false });
  assert.doesNotMatch(JSON.stringify(result), /ab12|Pro Website|example\.com|canManage|tokenHint/);
  assert.deepEqual([result.totals.error_rate, result.totals.previous_error_rate, result.totals.ai_share_of_visits, 'previousErrorRate' in result.totals], [10, 5, 2, false]);
  // A growth from zero is no percentage; a change of the error rate is in points.
  assert.deepEqual(result.change, { visits_pct: 100, pages_pct: -20, bots: 2, error_rate_pp: 5, referrals_pct: null });
  assert.deepEqual(result.by_purpose, { training: 120, search: 50, user: 30 });
  assert.equal('daily' in result, false);
  assert.deepEqual([result.llms, result.landing_pages], [report.llms, report.landings]);
  assert.deepEqual((await calls('get_ai_bots', { project: 'p1', include_daily: true }, { 'api/projects/[id]/ai-bots': { connection, report } })).result.daily, report.trend);
  // Not measured is said, never zero.
  const free = await calls('get_ai_bots', { project: 'p1' }, { 'api/projects/[id]/ai-bots': { connection, report: { ...report, totals: { ...report.totals, referrals: null, previousReferrals: null, previousErrorRate: null } } } });
  assert.deepEqual([free.result.change.referrals_pct, free.result.change.error_rate_pp, free.result.totals.previous_error_rate], [null, null, null]);
  assert.match(free.result.referrals_note, /not measured/);
  const none = await calls('get_ai_bots', { project: 'p1' }, { 'api/projects/[id]/ai-bots': { connection: { ...connection, state: 'none' }, report: null } });
  assert.deepEqual([none.result.connection.connected, none.result.report], [false, null]);
  assert.match(none.result.note, /connects it in Settings, Traffic/);
});

test('get_products opens a product or a brand page, and list_responses filters by sentiment', async () => {
  const detail = { withProducts: 4, cards: 9, product: { key: 'acme phone 5', title: 'Acme Phone 5', image: 'https://cdn/x.png', price: { min: 10, max: 20, currency: 'USD' } }, brand: null, products: [], engines: [], days: [], prompts: [], stores: [], beside: [], answers: [{ run: 'r1', price: 12, currency: 'USD' }], answered: 1, truncated: false };
  const product = await calls('get_products', { project: 'p1', product: 'acme phone 5' }, { 'api/reports': detail });
  assert.deepEqual([product.query.get('view'), product.query.get('key')], ['product-detail', 'acme-phone-5']);
  assert.deepEqual(product.result.product, { key: 'acme phone 5', title: 'Acme Phone 5', shown_price: { min: 10, max: 20, currency: 'USD' } });
  assert.equal(product.result.answers[0].shown_price, 12);
  assert.equal((await calls('get_products', { project: 'p1', brand: 'Acme Corp' }, { 'api/reports': { ...detail, product: null, brand: { name: 'Acme Corp' } } })).query.get('key'), 'brands/acme-corp');
  await assert.rejects(calls('get_products', { project: 'p1', product: 'gone' }, { 'api/reports': { ...detail, product: null } }), (error: unknown) => error instanceof ToolError && error.code === 'not_found');
  const list = await calls('get_products', { project: 'p1' }, { 'api/reports': { products: [{ key: 'a', image: 'https://cdn/a.png', price: null }] } });
  assert.deepEqual([list.query.get('view'), list.result.products], ['products', [{ key: 'a', shown_price: null }]]);
  assert.equal((await calls('list_responses', { project: 'p1', sentiment: 'negative', brand: 'Rival' })).query.get('sentiment'), 'negative');
  assert.throws(() => TOOLS.find((tool) => tool.name === 'list_responses')!.input.parse({ project: 'p1', sentiment: 'angry' }));
});

test('get_comparison reads the Comparison report with its filters and gives rates in percent, null when unread', async () => {
  const report = {
    status: 'ready', brand: 'Acme', engines: ['chat_gpt'], left: [{ engine: 'google_ai_overviews', reason: 'instructions' }], answers: 4, ties: 1, undecided: 0,
    discarded: { total: 1, order: 1, evidence: 0, scores: 0 }, days: [{ day: '2026-11-13', brands: { Acme: 71.666, Rival: null } }],
    own: { brand: 'Acme', options: 4, decided: 4, wins: 1, placed: 3, winRate: 0.25, position: 4 / 3, score: 71.666, cells: 5, cellsAsked: 8 }, previous: null,
    brands: [{ brand: 'Acme', own: true, options: 4, wins: 1, placed: 3, winRate: 0.25, position: 4 / 3, score: 71.666 }, { brand: 'Rival', own: false, options: 4, wins: 0, placed: 0, winRate: 0, position: null, score: null }],
    attributes: [{ id: 'price', name: 'Price', brands: [{ brand: 'Acme', options: 0, wins: 0, placed: 0, winRate: null, position: null }] }],
    products: [{ id: 'seo', options: 4, wins: 0.5, winRate: 0.125, score: 70.04, brands: { Acme: 70.04, Rival: null } }], personas: [], filters: { products: [{ id: 'seo', name: 'SEO' }], personas: [] },
  };
  const { made, result } = await calls('get_comparison', { project: 'p1', days: 28, product: 'seo' }, { 'api/projects/[id]/comparison': report });
  assert.equal(made[0]!.path, '/api/projects/p1/comparison?days=28&product=seo');
  assert.deepEqual([result.own.score, result.own.win_rate, result.own.average_position, result.own.coverage, result.ties], [71.7, 25, 1.33, 62.5, 1]);
  assert.deepEqual([result.products[0].wins, result.products[0].win_rate, result.products[0].brand_scores], [0.5, 12.5, { Acme: 70, Rival: null }]);
  assert.equal((await calls('get_comparison', { project: 'p1', days: 28, attribute: 'price' }, { 'api/projects/[id]/comparison': report })).made[0]!.path, '/api/projects/p1/comparison?days=28&attribute=price');
  assert.deepEqual([result.discarded.total, result.daily[0].scores], [1, { Acme: 71.7, Rival: null }]);
  assert.deepEqual(result.brands.map((row: Json) => [row.brand, row.win_rate, row.average_position]), [['Acme', 25, 1.33], ['Rival', 0, null]]);
  assert.equal(result.attributes[0].brands[0].win_rate, null);
});

test('cursors: pages and keysets round trip, anything else is refused', () => {
  assert.equal(pageOf(undefined), 1);
  assert.equal(pageOf(nextPage(1, true)!), 2);
  assert.equal(nextPage(4, false), null);
  assert.equal(keyOf(nextKey('WyIyMDI2Il0=')!), 'WyIyMDI2Il0=');
  assert.equal(nextKey(null), null);
  for (const bad of ['2', 'p:0', 'p:abc', 'p:99999', 'x:1'])
    assert.throws(() => pageOf(bad), (error: unknown) => error instanceof ToolError && error.code === 'invalid_argument', bad);
  assert.throws(() => keyOf('p:2'), ToolError);
});

test('the projection drops billing and configuration, nulls what was not measured, cleans and rounds', () => {
  const summary = {
    metrics: { responses: 10, visibility: 33.3333, shareOfVoice: 0, citationPresence: 20, mentionPosition: 0, cost: 1.25 },
    availability: { visibility: { current: 10, previous: 8 }, shareOfVoice: { current: null, previous: 3 }, citationPresence: { current: 10, previous: null }, mentionPosition: { current: null, previous: null } },
    comparison: { comparable: true, hasPreviousData: true, previous: { responses: 8, visibility: 25, shareOfVoice: 10, citationPresence: 0, mentionPosition: 0, cost: 2 }, delta: { responses: 2, visibility: 8.3333, shareOfVoice: -10, citationPresence: 20, mentionPosition: 0, cost: -0.75 } },
    leaderboard: [{ name: 'Acme', visibility: 33.3333, color: '#123456' }],
    usage: { used: 3, creditsUsed: 9 },
    capabilities: { engines: [] },
    config: { dataforseo: true },
    creditsLimit: 100,
    note: 'line one\nline\u0007 two\u0000',
    answer: 'x'.repeat(30),
  };
  const out = projection(summary, 20) as Json;
  assert.deepEqual(out.metrics, { responses: 10, visibility: 33.33, shareOfVoice: null, citationPresence: 20, mentionPosition: null });
  assert.deepEqual(out.comparison.previous, { responses: 8, visibility: 25, shareOfVoice: 10, citationPresence: null, mentionPosition: null });
  assert.deepEqual(out.comparison.delta, { responses: 2, visibility: 8.33, shareOfVoice: null, citationPresence: null, mentionPosition: null });
  assert.deepEqual(out.leaderboard, [{ name: 'Acme', visibility: 33.33 }]);
  for (const key of ['usage', 'capabilities', 'config', 'creditsLimit']) assert.equal(key in out, false, key);
  assert.equal(out.note, 'line one\nline two');
  assert.equal(out.answer, `${'x'.repeat(20)}…`);
  assert.doesNotMatch(JSON.stringify(out), /cost|credits|color/);
  // A comparison the report calls not comparable compares nothing.
  const incomparable = projection({ ...summary, comparison: { ...summary.comparison, comparable: false } }) as Json;
  assert.equal(incomparable.comparison.delta.visibility, null);
  // A row without answers measured no rate; a difference of zero answers is still measured.
  assert.deepEqual(projection({ responses: 0, mentions: 0, visibility: 0, previous: { responses: 3, visibility: 66.666 }, delta: { responses: 0, visibility: -66.666 } }), {
    responses: 0, mentions: 0, visibility: null, previous: { responses: 3, visibility: 66.67 }, delta: { responses: 0, visibility: null },
  });
  assert.deepEqual(projection({ responses: 2, visibility: 50, delta: { responses: 0, visibility: 0 }, previous: { responses: 2, visibility: 50 } }), { responses: 2, visibility: 50, delta: { responses: 0, visibility: 0 }, previous: { responses: 2, visibility: 50 } });
});

test('a route refusal becomes the tool error code', () => {
  assert.equal(toolErrorCode(400), 'invalid_argument');
  assert.equal(toolErrorCode(403, 'Your role in this workspace does not allow this action.'), 'permission_denied');
  assert.equal(toolErrorCode(403, "This workspace reached its plan's prompt limit, shared by all its projects. Archive a prompt in any project to add another."), 'limit_reached');
  assert.equal(toolErrorCode(409, 'Competitor limit reached. Remove, reject or merge a monitored competitor first.'), 'limit_reached');
  assert.equal(toolErrorCode(404), 'not_found');
  assert.equal(toolErrorCode(409), 'conflict');
  assert.equal(toolErrorCode(503), 'unavailable');
});
