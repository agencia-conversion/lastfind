/**
 * The model providers a call can go to, in the order an admin chose (Admin > Providers): OpenAI and Anthropic with their
 * own API keys, and OpenRouter. A call goes to the first provider that has a key, can serve it and is not resting after a
 * failure; credit or quota exhausted, a rate limit, a server error or a refused key moves it to the next one
 * (lib/server/model-router.ts). Pure: the server, the Admin screen and the tests read the same table.
 *
 * Which model each provider runs. The model saved in Admin > Classifiers (an OpenRouter id such as `openai/gpt-6-luna`)
 * stays the source: OpenRouter runs it as it is; OpenAI runs it directly when it is one of OpenAI's, and Anthropic when it
 * is one of Anthropic's. For the generative tasks below, a provider whose family the saved model is not runs the task's
 * model of its own (DIRECT_MODELS), so the order decides whose credits pay. Decision models (closed labels with
 * probabilities) never change model: the readings they give are tied to the model that gave them, so OpenAI's decision
 * model runs on OpenAI's key, the others (Liquid, TypeSafe) only on OpenRouter, and Anthropic serves none (its API gives no
 * probability distribution over the labels).
 */
import { isDecisionModel } from './classifier-models.ts';

export const MODEL_PROVIDERS = ['openai', 'anthropic', 'openrouter'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
export const MODEL_PROVIDER_NAMES: Record<ModelProvider, string> = { openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter' };
export const MODEL_PROVIDER_KEYS = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY' } as const;
/** `platform_settings` key of the order, a comma-separated list such as `openai,anthropic,openrouter`. */
export const PROVIDER_ORDER_SETTING = 'LLM_PROVIDER_ORDER';
export const DEFAULT_PROVIDER_ORDER: readonly ModelProvider[] = ['openai', 'anthropic', 'openrouter'];

/** The saved order; a provider missing from it (or an unreadable value) keeps its place in the default order. */
export function providerOrder(raw: string): ModelProvider[] {
  const named = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is ModelProvider => (MODEL_PROVIDERS as readonly string[]).includes(part));
  return [...new Set([...named, ...DEFAULT_PROVIDER_ORDER])];
}

/**
 * The model of each generative task on a provider whose family the saved model is not. Current models (12/11/2026):
 * the cheap tier where the code default is a cheap model (the agent, its learning review, the search intents), the middle
 * tier where it is a reasoning model with web search (the Brain and attribute wizards).
 */
export const DIRECT_MODELS = {
  agent: { openai: 'gpt-6-luna', anthropic: 'claude-haiku-5-5' },
  agent_curator: { openai: 'gpt-6-luna', anthropic: 'claude-haiku-5-5' },
  fanout_intents: { openai: 'gpt-6-luna', anthropic: 'claude-haiku-5-5' },
  brain_wizard: { openai: 'gpt-6-sol', anthropic: 'claude-sonnet-5-5' },
  semantic_attributes: { openai: 'gpt-6-sol', anthropic: 'claude-sonnet-5-5' },
  // The New project wizard (lib/new-project-ai.ts): the agent's cheap tier, as its OpenRouter default.
  project_wizard: { openai: 'gpt-6-luna', anthropic: 'claude-haiku-5-5' },
} as const satisfies Record<string, { openai: string; anthropic: string }>;
export type GenerativeTask = keyof typeof DIRECT_MODELS;
export const isGenerativeTask = (task: string | undefined): task is GenerativeTask => !!task && Object.hasOwn(DIRECT_MODELS, task);

/** `anthropic/claude-haiku-5.5` (OpenRouter's spelling) is `claude-haiku-5-5` on Anthropic's API. */
const anthropicId = (model: string) => model.replaceAll('.', '-');

/** The model `provider` runs for a chat call saved as `model`, or null when it does not serve it. */
export function chatModelFor(provider: ModelProvider, model: string, task?: string): string | null {
  if (provider === 'openrouter') return model;
  if (isDecisionModel(model)) return null;
  if (model.startsWith(`${provider}/`)) return provider === 'anthropic' ? anthropicId(model.slice(10)) : model.slice(7);
  return isGenerativeTask(task) ? DIRECT_MODELS[task][provider] : null;
}

/** The model `provider` runs for a typed decision saved as `model`, or null: OpenAI's decision model on OpenAI, any on OpenRouter. */
export function decisionModelFor(provider: ModelProvider, model: string): string | null {
  if (provider === 'openrouter') return model;
  if (provider === 'openai') return /^openai\/(.+)-decisions$/u.exec(model)?.[1] ?? null;
  return null;
}

/**
 * US$ per million tokens: uncached input, cached input read, output. List prices checked on 12/11/2026 in the providers'
 * pricing pages. A model not listed has no computed cost: the caller keeps its reservation (`unsettled`), as for a call
 * that reported none.
 */
const PRICES: Record<string, [number, number, number]> = {
  'openai:gpt-6-luna': [0.1, 0.01, 0.5],
  'openai:gpt-6-sol': [2, 0.2, 10],
  'openai:gpt-6-astra': [10, 1, 50],
  'anthropic:claude-haiku-5-5': [0.1, 0.01, 0.5],
  'anthropic:claude-sonnet-5-5': [2, 0.2, 10],
  'anthropic:claude-opus-5-5': [4, 0.2, 20],
};
/** OpenAI's Decisions API: US$ 0.10 per million input tokens, output not charged. */
const DECISION_INPUT_PER_MILLION = 0.1;
/** A web search call: US$ 10 per thousand on both providers. */
const SEARCH_USD = 0.01;
export type TokenUsage = { input?: number; cacheRead?: number; cacheWrite?: number; output?: number; searches?: number };

export function directCost(provider: Exclude<ModelProvider, 'openrouter'>, model: string, usage: TokenUsage, decisions = false): number | null {
  if (typeof usage.input !== 'number') return null;
  if (decisions) return (usage.input * DECISION_INPUT_PER_MILLION) / 1e6;
  const price = PRICES[`${provider}:${model}`];
  if (!price) return null;
  const read = usage.cacheRead ?? 0;
  const write = usage.cacheWrite ?? 0;
  // A cache write costs a quarter more than plain input on Anthropic; OpenAI writes for free (counted as input either way).
  const plain = Math.max(0, usage.input - read - write) + write * (provider === 'anthropic' ? 1.25 : 1);
  return (plain * price[0] + read * price[1] + (usage.output ?? 0) * price[2]) / 1e6 + (usage.searches ?? 0) * SEARCH_USD;
}

export type FailoverReason = 'credit' | 'auth' | 'rate' | 'server' | 'rejected';
/** How long a provider rests in this server after each kind of failure: credit and keys are not fixed in a minute. */
export const REST_MS: Record<FailoverReason, number> = { credit: 15 * 60_000, auth: 15 * 60_000, rate: 30_000, server: 30_000, rejected: 0 };

/**
 * Why an error answer moves the call to the next provider. Every error answer does: the provider did no work and bills none.
 * `credit`: OpenAI's 429 `credit_balance_exhausted` or `insufficient_quota`, Anthropic's 400 "credit balance is too low",
 * OpenRouter's 402. `rejected`: another 4xx (the request or the model is refused here; the next provider may take it).
 */
export function failoverReason(status: number, body = ''): FailoverReason {
  if (status === 402 || /credit_balance_exhausted|insufficient_quota|credit balance is too low|billing/iu.test(body)) return 'credit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  if (status >= 500 || status === 408) return 'server';
  return 'rejected';
}
