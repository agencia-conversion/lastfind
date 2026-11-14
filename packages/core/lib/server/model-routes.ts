import { isDecisionModel } from '@/lib/classifier-models';
import {
  chatModelFor,
  decisionModelFor,
  MODEL_PROVIDER_KEYS,
  PROVIDER_ORDER_SETTING,
  providerOrder,
  REST_MS,
  type FailoverReason,
  type ModelProvider,
} from '@/lib/model-providers';
import { setting } from './env';

// Which provider a model call goes to (lib/model-providers.ts has the rules) and which ones rest after a failure; the
// day's tally Admin shows is model-tally.ts. No network and no database here: lib/server/decisions-api.ts and the
// agent (worker/agent.ts) make the calls.

export const providerKey = (provider: ModelProvider) => setting(MODEL_PROVIDER_KEYS[provider]);
/** Any model provider has a key: the generative tasks (agent, wizards, intents, learning) can run. */
export const modelKeyConfigured = () => (Object.keys(MODEL_PROVIDER_KEYS) as ModelProvider[]).some((provider) => !!providerKey(provider));
/** A provider of decision models has a key (OpenRouter, or OpenAI for its own decision model): the classifiers can run. */
export const decisionKeyConfigured = () => !!providerKey('openrouter') || !!providerKey('openai');
export const modelProviderOrder = () => providerOrder(setting(PROVIDER_ORDER_SETTING));

// Per isolate: a provider that just failed rests (REST_MS) and the next calls start at the next one. Another server finds out
// with one call of its own, which the provider refuses without billing.
const resting = new Map<ModelProvider, number>();
export const restingUntil = (provider: ModelProvider) => resting.get(provider) ?? 0;
export function rest(provider: ModelProvider, reason: FailoverReason) {
  if (REST_MS[reason]) resting.set(provider, Date.now() + REST_MS[reason]);
}
/** For tests: every provider available again. */
export const forgetRests = () => resting.clear();

export type Route = { provider: ModelProvider; model: string };
/**
 * Where a call saved as `model` can go, in the admin's order: providers with a key that serve it, the ones resting last
 * (still tried when nothing else is left). `task` lets a generative task run another family's model of its own.
 */
export function modelRoutes(model: string, { task, decisions = isDecisionModel(model) }: { task?: string; decisions?: boolean } = {}): Route[] {
  const at = Date.now();
  const routes = modelProviderOrder().flatMap((provider) => {
    if (!providerKey(provider)) return [];
    const served = decisions ? decisionModelFor(provider, model) : chatModelFor(provider, model, task);
    return served ? [{ provider, model: served }] : [];
  });
  return [...routes.filter((route) => restingUntil(route.provider) <= at), ...routes.filter((route) => restingUntil(route.provider) > at)];
}

