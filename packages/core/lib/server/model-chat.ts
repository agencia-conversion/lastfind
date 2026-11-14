import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { APICallError, defaultSettingsMiddleware, wrapLanguageModel, type LanguageModelUsage } from 'ai';
import { directCost, failoverReason } from '@/lib/model-providers';
import { modelRoutes, providerKey, rest, type Route } from './model-routes';
import { recordModelCall } from './model-tally';

// The agent's chat model for the AI SDK (worker/agent.ts): its turns stream with tools, so it runs on the providers' AI SDK
// adapters. The one-shot calls of the classifiers and wizards go through decisions-api.ts.

type LanguageModel = ReturnType<typeof wrapLanguageModel>;
export type ReasoningEffort = 'none' | 'low';

function languageModel({ provider, model }: Route, effort?: ReasoningEffort): LanguageModel {
  const apiKey = providerKey(provider);
  if (provider === 'openrouter') return createOpenRouter({ apiKey, headers: { 'X-Title': 'Lastfind' } }).chat(model, { usage: { include: true }, ...(effort ? { reasoning: { effort } } : {}) });
  const base = provider === 'openai' ? createOpenAI({ apiKey })(model) : createAnthropic({ apiKey })(model);
  if (!effort) return base;
  const providerOptions: Record<string, Record<string, string>> = provider === 'openai' ? { openai: { reasoningEffort: effort } } : { anthropic: { effort: 'low' } };
  return wrapLanguageModel({ model: base, middleware: defaultSettingsMiddleware({ settings: { providerOptions } }) });
}

/**
 * The routes of `model` in the admin's order as one model: an error answer before anything was read moves the call to the
 * next provider, recorded for Admin as the one-shot calls are. `onServed` learns which route answered each call (its cost
 * is computed from it). Null when no provider with a key serves the model.
 */
export function chainedChatModel(model: string, task: string, { effort, onServed }: { effort?: ReasoningEffort; onServed?: (route: Route) => void } = {}): LanguageModel | null {
  const routes = modelRoutes(model, { task, decisions: false });
  if (!routes.length) return null;
  const models = routes.map((current) => languageModel(current, effort));
  const attempt = async <T>(call: (candidate: LanguageModel) => PromiseLike<T>): Promise<T> => {
    for (const [index, current] of routes.entries()) {
      try {
        const answer = await call(models[index]!);
        onServed?.(current);
        return answer;
      } catch (error) {
        if (index === routes.length - 1 || !APICallError.isInstance(error) || typeof error.statusCode !== 'number') throw error;
        const reason = failoverReason(error.statusCode, error.responseBody ?? error.message);
        rest(current.provider, reason);
        await recordModelCall(current.provider, task, current.model, { failover: reason, status: error.statusCode });
        console.warn(`Lastfind model call: ${current.provider} answered HTTP ${error.statusCode} (${reason}); trying ${routes[index + 1]!.provider}.`);
      }
    }
    throw new Error('unreachable');
  };
  return wrapLanguageModel({
    model: models[0]!,
    middleware: { specificationVersion: 'v4', wrapGenerate: ({ params }) => attempt((candidate) => candidate.doGenerate(params)), wrapStream: ({ params }) => attempt((candidate) => candidate.doStream(params)) },
  });
}

/** What one served chat call cost: OpenRouter's reported cost, or the direct provider's tokens at its list price. */
export function servedCost(route: Route | null, usage: Partial<LanguageModelUsage> | undefined, metadata: Record<string, unknown> | undefined): number | undefined {
  if (!route || route.provider === 'openrouter') {
    const cost = (metadata?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage?.cost;
    return typeof cost === 'number' && Number.isFinite(cost) ? cost : undefined;
  }
  return (
    directCost(route.provider, route.model, {
      input: usage?.inputTokens,
      cacheRead: usage?.inputTokenDetails?.cacheReadTokens,
      cacheWrite: usage?.inputTokenDetails?.cacheWriteTokens,
      output: usage?.outputTokens,
    }) ?? undefined
  );
}
