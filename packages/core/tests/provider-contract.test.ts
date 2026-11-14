import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES } from '../lib/engines.ts';
import {
  providerBase,
  providerTaskPending,
  providerPayload,
  providerResultPath,
  providerResultCost,
  COLLECTION_SETUP,
} from '../lib/provider-contract.ts';
import { extractResponse } from '../lib/metrics.ts';
import { scheduleWindow } from '../lib/scheduling.ts';
void test('six adapters use documented method, normal priority, prompt size, country and model contracts', () => {
  for (const engine of ENGINES) {
    const p = providerPayload({
      id: 'test',
      prompt_text: 'C++ 50% tools?',
      engine,
      language_code: 'pt',
      location_code: 2076,
    }) as Record<string, unknown>;
    if (engine === 'claude' || engine === 'perplexity') {
      assert.equal(p.user_prompt, 'C++ 50% tools?');
      // Both search from the project's country (Brazil is in Claude's list).
      assert.equal(p.web_search_country_iso_code, 'BR');
      assert.equal(p.priority, undefined);
      assert.equal(providerResultPath(engine, 'id'), 'task_get/id');
    } else {
      assert.equal(p.keyword, 'C%2B%2B 50%25 tools?');
      assert.equal(p.priority, 1);
      assert.equal(providerResultPath(engine, 'id'), 'task_get/advanced/id');
    }
    assert.ok(providerBase(engine));
  }
  assert.equal(providerBase('google_ai_overviews'), 'serp/google/organic');
  assert.equal(
    providerPayload(
      {
        id: 'x',
        prompt_text: 'test',
        engine: 'perplexity',
        language_code: 'en',
        location_code: 2840,
      },
      { callback: 'https://example.com/callback' },
    ).pingback_url,
    undefined,
  );
});
void test('Claude searches when the model decides, without extended thinking, as the free claude.ai (8/11/2026); its search country only where the provider takes one; Perplexity unchanged; the ChatGPT interface decides when to search', () => {
  const payload = (engine: 'claude' | 'chat_gpt' | 'perplexity', language = 'en', location_code = 2076) =>
    providerPayload({ id: 'x', prompt_text: 'test', engine, language_code: language, location_code }) as Record<string, unknown>;
  const claude = payload('claude');
  assert.equal(claude.model_name, COLLECTION_SETUP.claude.model);
  assert.match(String(claude.model_name), /^claude-sonnet-/);
  assert.equal(claude.web_search, true);
  assert.equal(claude.force_web_search, undefined); // never forced: the model decides
  assert.equal(claude.use_reasoning, undefined); // no extended thinking, as claude.ai's free plan (the provider's default, off)
  assert.equal(claude.system_message, 'Answer in English.');
  assert.equal(payload('claude', 'pt').system_message, 'Responda em português.');
  assert.equal(claude.web_search_country_iso_code, 'BR');
  // A country outside the provider's list (Angola, 2024) is still asked, without a search country.
  const angola = payload('claude', 'pt', 2024);
  assert.equal(angola.web_search, true);
  assert.equal('web_search_country_iso_code' in angola, false);
  assert.equal(payload('perplexity', 'pt', 2024).web_search_country_iso_code, 'AO');
  const perplexity = payload('perplexity');
  assert.equal(perplexity.model_name, 'sonar');
  assert.equal(perplexity.system_message, 'Answer in English.');
  assert.equal(perplexity.web_search_country_iso_code, 'BR');
  assert.equal(payload('chat_gpt').force_web_search, undefined);
  for (const engine of ENGINES) assert.match(COLLECTION_SETUP[engine].source, /^https:\/\//);
});
void test('Google AI Mode and Gemini ask for pt-BR, the other scrapers keep pt (DataForSEO rejects pt there; Gemini also pt-PT)', () => {
  const language = (engine: 'google_ai_mode' | 'gemini' | 'chat_gpt' | 'google_ai_overviews', code: string) =>
    (
      providerPayload({
        id: 'x',
        prompt_text: 'test',
        engine,
        language_code: code,
        location_code: 2076,
      }) as Record<string, unknown>
    ).language_code;
  assert.equal(language('google_ai_mode', 'pt'), 'pt-BR');
  assert.equal(language('google_ai_mode', 'en'), 'en');
  assert.equal(language('gemini', 'pt'), 'pt-BR');
  assert.equal(language('gemini', 'en'), 'en');
  assert.equal(language('chat_gpt', 'pt'), 'pt');
  assert.equal(language('google_ai_overviews', 'pt'), 'pt');
});
void test('cited and consulted evidence are separate; null is different from an empty returned list', () => {
  const r = extractResponse({
    markdown: 'Answer',
    sources: [{ url: 'https://cited.example/a' }],
    search_results: [
      { url: 'https://consulted.example/b' },
      { url: 'https://cited.example/a' },
      { url: 'https://consulted.example/b' },
      { url: 'javascript:x' },
    ],
  });
  assert.equal(r.sources.length, 1);
  assert.equal(r.consultedSources?.length, 2);
  assert.equal(extractResponse({ markdown: 'Answer' }).consultedSources, null);
  assert.deepEqual(
    extractResponse({ markdown: 'Answer', search_results: [] })
      .consultedSources,
    [],
  );
});
void test('Responses API section text and annotations are extracted without inventing browsing evidence', () => {
  const result = extractResponse(
    {
      model_name: 'sonar',
      items: [
        { type: 'reasoning', sections: [{ text: 'Ignore this draft.' }] },
        {
          type: 'message',
          sections: [
            {
              type: 'text',
              text: 'Acme is mentioned.',
              annotations: [
                { title: 'Evidence', url: 'https://source.example' },
              ],
            },
          ],
        },
      ],
      fan_out_queries: ['best tools'],
    },
    'perplexity',
  );
  assert.equal(result.answer, 'Acme is mentioned.');
  assert.equal(result.sources.length, 1);
  assert.equal(result.consultedSources, null);
  assert.deepEqual(result.searchQueries, ['best tools']);
});
void test('Claude completion replaces its advance with actual model spending while GET is free', () => {
  assert.equal(
    providerResultCost('claude', 0.0102, { money_spent: 0.016845 }),
    0.017045,
  );
  assert.equal(
    providerResultCost('claude', 0.0102, { money_spent: 0.003 }),
    0.0032,
  );
  assert.equal(providerResultCost('claude', 0.0102, {}), 0.0102);
  assert.equal(providerResultCost('chat_gpt', 0.0012, {}), 0.0012);
});
void test('AI Overviews keeps the async fee only when an asynchronous AI Overview came back (the provider returns it otherwise)', () => {
  const organic = { type: 'organic', url: 'https://example.com' };
  assert.equal(providerResultCost('google_ai_overviews', 0.0012, { items: [organic, { type: 'ai_overview', asynchronous_ai_overview: true }] }), 0.0012);
  assert.equal(providerResultCost('google_ai_overviews', 0.0012, { items: [organic, { type: 'ai_overview' }] }), 0.0012, 'unknown flag: kept');
  assert.equal(providerResultCost('google_ai_overviews', 0.0012, { items: [organic] }), 0.0006, 'absent');
  assert.equal(providerResultCost('google_ai_overviews', 0.0012, { items: [{ type: 'ai_overview', asynchronous_ai_overview: false }] }), 0.0006, 'from cache');
  assert.equal(providerResultCost('google_ai_overviews', 0.0012, {}), 0.0006, 'no result at all');
  assert.equal(providerResultCost('google_ai_overviews', 0, {}), 0, 'never below zero');
});
void test('Google extracts only AI evidence, preserves absent overview, and does not cite organic results', () => {
  const r = extractResponse(
    {
      items: [
        {
          type: 'organic',
          description: 'Acme ranked organic',
          url: 'https://organic.example',
        },
        {
          type: 'ai_overview',
          items: [{ type: 'ai_overview_element', text: 'AI answer' }],
          references: [{ url: 'https://ai-source.example' }],
        },
      ],
    },
    'google_ai_overviews',
  );
  assert.equal(r.answer, 'AI answer');
  assert.equal(r.sources.length, 1);
  assert.equal(r.consultedSources, null);
  assert.equal(
    extractResponse(
      { items: [{ type: 'organic', description: 'Acme' }] },
      'google_ai_overviews',
    ).responseAvailable,
    false,
  );
});
void test('daily reservation keys converge across retries and UTC midnight', () => {
  assert.equal(
    scheduleWindow('2026-09-05T07:00:00Z'),
    '2026-09-05T07:00:00.000Z',
  );
  assert.equal(
    scheduleWindow('2026-09-06T02:00:00Z'),
    '2026-09-05T07:00:00.000Z',
  );
});

void test('accepted Standard queue codes are pending, terminal provider errors are not',()=>{
  for(const code of [20100,40601,40602]) assert.equal(providerTaskPending(code),true);
  for(const code of [20000,40001,40401,40501,50000]) assert.equal(providerTaskPending(code),false);
});
