import test from 'node:test';
import assert from 'node:assert/strict';
import { chatModelFor, decisionModelFor, DEFAULT_PROVIDER_ORDER, directCost, failoverReason, providerOrder } from '../lib/model-providers.ts';

test('the saved order keeps every provider once; an unknown or missing one keeps its default place', () => {
  assert.deepEqual(DEFAULT_PROVIDER_ORDER, ['openai', 'anthropic', 'openrouter']);
  assert.deepEqual(providerOrder(''), ['openai', 'anthropic', 'openrouter']);
  assert.deepEqual(providerOrder('openrouter,openai,anthropic'), ['openrouter', 'openai', 'anthropic']);
  assert.deepEqual(providerOrder(' anthropic , bogus,anthropic'), ['anthropic', 'openai', 'openrouter']);
});

test('a chat call runs the saved model on its own family and on OpenRouter; a generative task runs another family model of its own', () => {
  // The agent's default, an OpenAI model.
  assert.equal(chatModelFor('openai', 'openai/gpt-6-luna', 'agent'), 'gpt-6-luna');
  assert.equal(chatModelFor('anthropic', 'openai/gpt-6-luna', 'agent'), 'claude-haiku-5-5');
  assert.equal(chatModelFor('openrouter', 'openai/gpt-6-luna', 'agent'), 'openai/gpt-6-luna');
  // OpenRouter's spelling of a Claude model is Anthropic's with dashes.
  assert.equal(chatModelFor('anthropic', 'anthropic/claude-haiku-5.5'), 'claude-haiku-5-5');
  // A Gemini wizard pays with the first provider's credits, on that provider's model of the same tier.
  assert.equal(chatModelFor('openai', 'google/gemini-4-argon', 'brain_wizard'), 'gpt-6-sol');
  assert.equal(chatModelFor('anthropic', 'google/gemini-4-argon', 'semantic_attributes'), 'claude-sonnet-5-5');
  // A reader whose model is part of its verdict (no task given) never changes model: only its family or OpenRouter.
  assert.equal(chatModelFor('openai', 'anthropic/claude-haiku-5.5'), null);
  assert.equal(chatModelFor('anthropic', 'openai/gpt-6-luna'), null);
});

test('a decision model never changes: OpenAI serves only its own, Anthropic none, OpenRouter every one', () => {
  assert.equal(decisionModelFor('openai', 'openai/gpt-6-luna-decisions'), 'gpt-6-luna');
  assert.equal(decisionModelFor('openai', 'typesafe/jev-1.14'), null);
  assert.equal(decisionModelFor('openai', 'liquid/d1-ultra'), null);
  assert.equal(decisionModelFor('anthropic', 'openai/gpt-6-luna-decisions'), null);
  assert.equal(decisionModelFor('openrouter', 'liquid/d1-ultra'), 'liquid/d1-ultra');
  assert.equal(chatModelFor('openai', 'openai/gpt-6-luna-decisions', 'agent'), null);
});

test('a direct call costs its tokens at list price; an unknown model or no usage has no cost', () => {
  const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
  // 1M input (200k of it read from cache) and 100k output on GPT-6 Luna: 0.8*0.10 + 0.2*0.01 + 0.1*0.50.
  near(directCost('openai', 'gpt-6-luna', { input: 1_000_000, cacheRead: 200_000, output: 100_000 }), 0.08 + 0.002 + 0.05);
  // Anthropic charges a cache write at 1.25x input; two web searches at US$ 0.01 each.
  near(directCost('anthropic', 'claude-sonnet-5-5', { input: 1_000_000, cacheWrite: 400_000, output: 0, searches: 2 }), 0.6 * 2 + 0.4 * 2 * 1.25 + 0.02);
  // OpenAI's Decisions API: input only.
  near(directCost('openai', 'gpt-6-luna', { input: 50_000, output: 999 }, true), 0.005);
  assert.equal(directCost('openai', 'gpt-unknown', { input: 10, output: 10 }), null);
  assert.equal(directCost('openai', 'gpt-6-luna', {}), null);
});

test('why a refused call moves to the next provider', () => {
  assert.equal(failoverReason(429, '{"error":{"code":"credit_balance_exhausted"}}'), 'credit');
  assert.equal(failoverReason(429, '{"error":{"code":"insufficient_quota"}}'), 'credit');
  assert.equal(failoverReason(400, '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), 'credit');
  assert.equal(failoverReason(402, ''), 'credit');
  assert.equal(failoverReason(401, ''), 'auth');
  assert.equal(failoverReason(429, '{"error":{"code":"rate_limit_exceeded"}}'), 'rate');
  assert.equal(failoverReason(529, 'overloaded'), 'server');
  assert.equal(failoverReason(404, 'model not found'), 'rejected');
});

test('the New project wizard runs its own cheap model on each direct provider, the saved model on OpenRouter', () => {
  assert.equal(chatModelFor('openai', 'openai/gpt-6-luna', 'project_wizard'), 'gpt-6-luna');
  assert.equal(chatModelFor('anthropic', 'openai/gpt-6-luna', 'project_wizard'), 'claude-haiku-5-5');
  assert.equal(chatModelFor('openrouter', 'openai/gpt-6-luna', 'project_wizard'), 'openai/gpt-6-luna');
});
