// AI bots (lib/ai-bots.ts): the catalog lookups, a recorded GraphQL day read into the store's rows, the query's parts, the
// period's days and the example data of a preview. No network: the answers are fixtures of Cloudflare's response shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_BOTS } from '../lib/ai-bots-catalog.ts';
import { AI_REFERRERS } from '../lib/ai-bots-catalog.ts';
import { BOT_TOKENS, CLOUDFLARE_TOKEN_TEMPLATE_URL, LLMS, addDays, dayQuery, graphqlProblem, matchBot, parseDay, partsFor, periodDays, utmReferrer, referrerOf, reportStatements, referrerOperator, statusClass, weekly } from '../lib/ai-bots.ts';
import { exampleBotDays } from '../lib/ai-bots-fixture.ts';

const recorded = JSON.parse(readFileSync(new URL('./fixtures/ai-bots-graphql.json', import.meta.url), 'utf8'));

test('the catalog covers the agreed bots, each with an operator and a purpose', () => {
  const names = new Set(AI_BOTS.map((bot) => bot.name));
  for (const name of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Googlebot', 'Google-CloudVertexBot', 'Gemini', 'Bingbot', 'Applebot', 'Applebot-Extended', 'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'Bytespider', 'Amazonbot', 'CCBot', 'DuckAssistBot', 'MistralAI-User', 'cohere-ai', 'YouBot'])
    assert.ok(names.has(name), name);
  assert.equal(new Set(AI_BOTS.map((bot) => bot.id)).size, AI_BOTS.length);
  for (const bot of AI_BOTS) assert.ok(bot.operator && ['training', 'search', 'user'].includes(bot.purpose) && bot.tokens.length, bot.id);
});

test('a user agent is read by its longest token, case-insensitively; an unknown one is no bot', () => {
  assert.equal(matchBot('Mozilla/5.0 (compatible; GPTBot/1.2)')?.id, 'gptbot');
  assert.equal(matchBot('ChatGPT-User/1.0')?.id, 'chatgpt-user');
  assert.equal(matchBot('Safari (Applebot-Extended/0.1)')?.id, 'applebot-extended');
  assert.equal(matchBot('Safari (Applebot/0.1)')?.id, 'applebot');
  assert.equal(matchBot('Mozilla/5.0 (compatible; bingbot/2.0)')?.id, 'bingbot');
  assert.equal(matchBot('META-EXTERNALAGENT/1.1')?.id, 'meta-externalagent');
  assert.equal(matchBot('Mozilla/5.0 (compatible; Kangaroo Bot/1.0)')?.id, 'other');
  assert.equal(matchBot('Mozilla/5.0 (Windows NT 10.0) Chrome/130'), null);
  assert.equal(referrerOperator('www.perplexity.ai'), 'Perplexity');
  assert.equal(referrerOperator('example.org'), null);
});

test('the LLM classifier: one row per host, the hosts of one LLM share its id, name and operator', () => {
  assert.equal(new Set(AI_REFERRERS.map((row) => row.host)).size, AI_REFERRERS.length);
  for (const row of AI_REFERRERS) assert.ok(/^[a-z0-9.-]+$/.test(row.host) && !row.host.startsWith('www.') && row.id && row.name && row.operator, row.host);
  for (const llm of LLMS) assert.equal(new Set(AI_REFERRERS.filter((row) => row.id === llm.id).map((row) => `${row.name} ${row.operator}`)).size, 1, llm.id);
  assert.equal(referrerOf('chat.openai.com')?.id, 'chatgpt');
  assert.equal(referrerOf('WWW.ChatGPT.com')?.name, 'ChatGPT');
  for (const name of ['ChatGPT', 'Perplexity', 'Claude', 'Gemini', 'Copilot']) assert.ok(LLMS.some((llm) => llm.name === name), name);
});

test('a recorded day becomes the store rows: summed per bot, path and status, unknown agents dropped', () => {
  const day = parseDay('2026-11-09', recorded.day.data, { complete: true, referrals: true });
  assert.equal(day.requests, 9800);
  assert.equal(day.complete, true);
  const hit = (bot: string, path: string) => day.hits.find((row) => row[0] === bot && row[1] === path);
  assert.deepEqual(hit('gptbot', '/blog/seo'), ['gptbot', '/blog/seo', 200, 150, 6000000]);
  assert.deepEqual(hit('chatgpt-user', '/pricing'), ['chatgpt-user', '/pricing', 404, 12, 0]);
  assert.equal(hit('applebot-extended', '/docs')?.[3], 9);
  assert.equal(hit('meta-externalagent', '/docs')?.[2], 503);
  assert.equal(hit('other', '/')?.[2], 403);
  assert.equal(day.hits.length, 6, 'the agent no catalog token names is dropped');
  assert.deepEqual(day.paths, ['/', '/blog/seo', '/pricing']);
  assert.deepEqual(day.referrals, [['chatgpt.com', 18], ['perplexity.ai', 4]]);
  assert.deepEqual(day.landings, [['chatgpt.com', '/pricing', 12], ['chatgpt.com', '/blog/seo', 6], ['perplexity.ai', '/', 4]], 'each LLM host by landing page; another site’s visits dropped');
  assert.equal(parseDay('2026-11-09', recorded.day.data, { complete: false, referrals: false }).referrals, null, 'a Free zone has no referrals, never zero');
  assert.deepEqual(parseDay('2026-11-09', null, { complete: true, referrals: false }), { day: '2026-11-09', requests: 0, complete: true, hits: [], paths: [], referrals: null, landings: null });
});

test('a ChatGPT link opened without a referrer counts by its utm_source, once', () => {
  assert.equal(utmReferrer('utm_source=chatgpt.com')?.id, 'chatgpt');
  assert.equal(utmReferrer('?ref=x&utm_source=www.perplexity.ai&utm_medium=referral')?.id, 'perplexity');
  assert.equal(utmReferrer('utm_source=newsletter'), null);
  assert.equal(utmReferrer(''), null);
  const zone = structuredClone(recorded.day.data);
  zone.viewer.zones[0].utm = [
    { count: 5, dimensions: { clientRequestQuery: '?utm_source=chatgpt.com', clientRequestPath: '/pricing' } },
    { count: 3, dimensions: { clientRequestQuery: 'utm_source=chatgpt.com&utm_medium=app', clientRequestPath: '/guide' } },
    // Cloudflare's LIKE also matches a longer value; only an LLM's own host counts.
    { count: 9, dimensions: { clientRequestQuery: 'utm_source=chatgpt.com.example', clientRequestPath: '/' } },
  ];
  const day = parseDay('2026-11-09', zone, { complete: true, referrals: true });
  assert.deepEqual(day.referrals, [['chatgpt.com', 26], ['perplexity.ai', 4]]);
  assert.deepEqual(day.landings, [['chatgpt.com', '/pricing', 17], ['chatgpt.com', '/blog/seo', 6], ['perplexity.ai', '/', 4], ['chatgpt.com', '/guide', 3]]);
  // Asked only of a zone that answers it, and never for a visit an LLM's referrer already counts.
  const query = dayQuery(partsFor({ pages: false, referrals: true, utm: true }));
  assert.match(query, /utm: httpRequestsAdaptiveGroups\(limit: 1000, .*\{clientRequestQuery_like: "%utm_source=chatgpt\.com%"\}/);
  assert.match(query, /clientRefererHost_notin: \[.*"chat\.openai\.com"/);
  assert.doesNotMatch(dayQuery(partsFor({ pages: false, referrals: true })), /clientRequestQuery/);
  assert.doesNotMatch(dayQuery(partsFor({ pages: true, referrals: false, utm: true })), /clientRequestQuery/);
});

test('GraphQL errors are told apart: a token without access, the rate limit, anything else', () => {
  assert.equal(graphqlProblem(recorded.authz.errors), 'auth');
  assert.equal(graphqlProblem(recorded.budget.errors), 'budget');
  assert.equal(graphqlProblem(recorded.unknownField.errors), 'other');
  assert.equal(graphqlProblem(null), null);
  assert.equal(graphqlProblem([]), null);
});

test('the day query asks only what the zone can answer', () => {
  const free = dayQuery(partsFor({ pages: true, referrals: false }));
  assert.match(free, /bots: httpRequestsAdaptiveGroups\(limit: 10000/);
  assert.match(free, /requestSource: "eyeball"/);
  assert.match(free, /pages: httpRequestsAdaptiveGroups/);
  assert.doesNotMatch(free, /clientRefererHost/);
  assert.match(dayQuery(partsFor({ pages: false, referrals: true })), /clientRefererHost_in: \[.*"chatgpt\.com"/);
  assert.match(dayQuery(partsFor({ pages: false, referrals: true })), /dimensions \{ clientRefererHost clientRequestPath \}/);
  for (const token of BOT_TOKENS) assert.ok(free.includes(`%${token}%`), token);
});

test('the report is one store batch of at most 10 reads, with or without a drill down', () => {
  const days = { from: '2026-11-01', to: '2026-11-08' };
  for (const filter of [{}, { bot: 'gptbot' }, { llm: 'chatgpt', page: '/pricing' }]) assert.ok(reportStatements(days, days, filter).length <= 10);
});

test('a period is read in whole UTC days: a rolling one ends with today, a chosen one with its last day', () => {
  assert.deepEqual(periodDays('2026-10-13T15:00:00.000Z', '2026-11-10T15:00:00.000Z'), { from: '2026-10-14', to: '2026-11-11' });
  assert.deepEqual(periodDays('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'), { from: '2026-10-01', to: '2026-11-01' });
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(statusClass(200), 'ok');
  assert.equal(statusClass(301), 'redirect');
  assert.equal(statusClass(404), 'not_found');
  assert.equal(statusClass(403), 'forbidden');
  assert.equal(statusClass(429), 'client_error');
  assert.equal(statusClass(502), 'server_error');
});

test('weeks start on Monday and sum their days', () => {
  const rows = [
    { date: '2026-11-08', training: 1, search: 2, user: 3 }, // Sunday
    { date: '2026-11-09', training: 10, search: 0, user: 0 }, // Monday
    { date: '2026-11-10', training: 5, search: 1, user: 0 },
  ];
  assert.deepEqual(weekly(rows), [
    { date: '2026-11-02', training: 1, search: 2, user: 3 },
    { date: '2026-11-09', training: 15, search: 1, user: 0 },
  ]);
});

test('preview example days are deterministic, partial today and without referrals on a Free zone', () => {
  const paid = exampleBotDays({ today: '2026-11-10', referrals: true, paths: ['/blog/cited'] });
  assert.deepEqual(paid, exampleBotDays({ today: '2026-11-10', referrals: true, paths: ['/blog/cited'] }));
  assert.equal(paid.length, 61);
  assert.equal(paid.at(-1)?.day, '2026-11-10');
  assert.equal(paid.at(-1)?.complete, false);
  assert.ok(paid.some((day) => day.hits.some((row) => row[1] === '/blog/cited')));
  assert.ok(paid.every((day) => day.referrals && day.requests > 0));
  for (const day of paid) assert.equal(day.landings?.reduce((sum, row) => sum + row[2], 0), day.referrals?.reduce((sum, row) => sum + row[1], 0), `${day.day}: the landings add up to the visits sent`);
  assert.ok(exampleBotDays({ today: '2026-11-10', referrals: false }).every((day) => day.referrals === null));
  for (const day of paid) assert.equal(new Set(day.hits.map((row) => `${row[0]} ${row[1]} ${row[2]}`)).size, day.hits.length, `${day.day}: one row per bot, path and status`);
});

test("the Create token link opens Cloudflare's token form with the three read-only permissions, every account and zone, and the name", () => {
  const url = new URL(CLOUDFLARE_TOKEN_TEMPLATE_URL);
  assert.equal(`${url.origin}${url.pathname}`, 'https://dash.cloudflare.com/profile/api-tokens');
  // Cloudflare's documented template keys (an unknown key is dropped silently, so a typo would leave a permission out).
  assert.deepEqual(JSON.parse(url.searchParams.get('permissionGroupKeys')!), [
    { key: 'account_analytics', type: 'read' }, { key: 'analytics', type: 'read' }, { key: 'zone', type: 'read' },
  ]);
  assert.equal(url.searchParams.get('accountId'), '*');
  assert.equal(url.searchParams.get('zoneId'), 'all');
  assert.equal(url.searchParams.get('name'), 'Lastfind, read only');
  assert.doesNotMatch(CLOUDFLARE_TOKEN_TEMPLATE_URL, /\+/, 'a space is %20, never +');
});
