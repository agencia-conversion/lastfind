import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES } from '../lib/engines.ts';
import {
  providerBase,
  providerPayload,
  providerResultPath,
  providerResultCost,
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
