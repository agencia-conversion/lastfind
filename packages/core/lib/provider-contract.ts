import { ENGINE_META, type Engine } from './engines.ts';
import { countryIso } from './countries.ts';
/**
 * How collection asks each AI (checked 2026-11-03, source in `source`; PROVIDERS.md, "Plano gratuito de cada IA"): as the user
 * sees it. The provider scrapes only ChatGPT's and Gemini's interfaces (`model` null: the interface picks the model and the
 * search); Claude has no scraper, so its API is asked the way claude.ai's free plan answers (8/11/2026): its model, without
 * extended thinking (off by default there), deciding itself when to search the web. `search`: `always` when the AI always searches, `interface` when the interface
 * decides, `model` when the model decides (web search allowed, never forced). `freeTier`: whether that is what a free-tier
 * user gets. The model that answered is stored on every run.
 */
export const COLLECTION_SETUP: Record<Engine, { model: string | null; search: 'always' | 'interface' | 'model'; freeTier: boolean; source: string }> = {
  chat_gpt: { model: null, search: 'interface', freeTier: true, source: 'https://openai.com/index/introducing-chatgpt-search/' },
  gemini: { model: null, search: 'interface', freeTier: true, source: 'https://gemini.google/subscriptions/' },
  // The free plan's Sonnet (Haiku is offered, Opus is not), the provider's newest Sonnet (web search and reasoning: its models endpoint).
  claude: { model: 'claude-sonnet-5', search: 'model', freeTier: true, source: 'https://claude.com/pricing' },
  // The exception to the interface rule: Sonar with its own search (every Sonar model searches; no provider offers a pure one).
  perplexity: { model: 'sonar', search: 'always', freeTier: false, source: 'https://docs.perplexity.ai/getting-started/models/models/sonar' },
  google_ai_mode: { model: null, search: 'interface', freeTier: true, source: 'https://support.google.com/websearch/answer/16011537' },
  google_ai_overviews: { model: null, search: 'interface', freeTier: true, source: 'https://support.google.com/websearch/answer/14901683' },
};
/**
 * The model the collection asks for an AI with a model API (Claude, Perplexity): the installation's setting
 * (`DATAFORSEO_CLAUDE_MODEL`, `DATAFORSEO_PERPLEXITY_MODEL`), else COLLECTION_SETUP's. Semantic Branding asks the same one.
 */
export const collectionModel = (engine: Engine, setting: (key: string) => string | undefined) =>
  setting(engine === 'claude' ? 'DATAFORSEO_CLAUDE_MODEL' : 'DATAFORSEO_PERPLEXITY_MODEL') || COLLECTION_SETUP[engine].model;
/**
 * The countries Claude's web search takes (`web_search_country_iso_code`, Claude Live and task_post docs, checked 8/11/2026). Any
 * other country is asked without one: Claude still answers there, searching from wherever the provider decides.
 */
export const CLAUDE_SEARCH_COUNTRIES = new Set('AR AT AU BE BR CA CH CL CN DE DK ES FI FR GB HK ID IN IT JP KR MX MY NL NO NZ PH PL PT RU SA SE TR TW US ZA'.split(' '));
// Accepted Standard tasks may use 4xxxx codes while still waiting for results.
export const providerTaskPending = (code: number) => [20100, 40601, 40602].includes(code);
/**
 * A request-level 4xxxx (credentials, funds, rate or cost limits, an invalid POST: docs.dataforseo.com/v3/appendix/errors)
 * refused the whole request, so no task was created and nothing was charged: a definitive failure. The queue states
 * (406xx) and the 40007 notice are not refusals; a 5xxxx or a lost reply stays uncertain.
 */
export const refusedRequest = (code: unknown) => typeof code === 'number' && code >= 40000 && code < 40600 && code !== 40007;

export function providerBase(engine: Engine) {
  if (engine === 'google_ai_mode') return 'serp/google/ai_mode';
  if (engine === 'google_ai_overviews') return 'serp/google/organic';
  return `ai_optimization/${engine}/${ENGINE_META[engine].family === 'responses' ? 'llm_responses' : 'llm_scraper'}`;
}
export function providerResultPath(engine: Engine, task: string) {
  return `task_get/${ENGINE_META[engine].family === 'responses' ? '' : 'advanced/'}${encodeURIComponent(task)}`;
}
/**
 * The extra fee of `load_async_ai_overview` (US$ 0.0006), which the provider returns to the balance when the result has no
 * `ai_overview` element or one with `asynchronous_ai_overview: false` (organic task_post docs, checked 8/11/2026). The free GET
 * reports no cost, so the rule is applied here.
 */
export const ASYNC_AI_OVERVIEW_USD = 0.0006;
export function providerResultCost(
  engine: Engine,
  submittedCost: number,
  result: Record<string, unknown>,
) {
  if (engine === 'google_ai_overviews') {
    const items = Array.isArray(result.items) ? (result.items as { type?: unknown; asynchronous_ai_overview?: unknown }[]) : [];
    const charged = items.some((item) => item?.type === 'ai_overview' && item.asynchronous_ai_overview !== false);
    return charged ? submittedCost : Number(Math.max(0, submittedCost - ASYNC_AI_OVERVIEW_USD).toFixed(9));
  }
  // Standard Responses POST reserves a $0.01 advance plus the task fee.
  // GET is free; its cost=0 is not the final cost of the model's answer.
  const spent = result.money_spent;
  return engine === 'claude' &&
    typeof spent === 'number' &&
    Number.isFinite(spent) &&
    spent >= 0
    ? Number((Math.max(0, submittedCost - 0.01) + spent).toFixed(9))
    : submittedCost;
}
export function providerPayload(
  row: {
    id: string;
    prompt_text: string;
    engine: Engine;
    language_code: string;
    location_code: number;
  },
  options: { callback?: string; model?: string } = {},
) {
  const { engine } = row;
  const common = {
    tag: row.id,
    ...(options.callback && engine !== 'perplexity'
      ? { pingback_url: options.callback }
      : {}),
  };
  if (ENGINE_META[engine].family === 'responses') {
    const iso = countryIso(row.location_code);
    const country = engine !== 'claude' || (iso && CLAUDE_SEARCH_COUNTRIES.has(iso)) ? iso : undefined;
    return {
      ...common,
      user_prompt: row.prompt_text,
      model_name: options.model || COLLECTION_SETUP[engine].model,
      max_output_tokens: 2048,
      // Claude as claude.ai's free plan answers: web search the model may use, never forced; no extended thinking (`use_reasoning`
      // left at its default, off; from 3/11 to 8/11/2026 it was on, the costliest answer of the collection).
      ...(COLLECTION_SETUP[engine].search === 'model' ? { web_search: true } : {}),
      ...(country ? { web_search_country_iso_code: country } : {}),
      system_message: row.language_code === 'pt' ? 'Responda em português.' : 'Answer in English.',
    };
  }
  return {
    ...common,
    keyword: row.prompt_text.replace(/%/g, '%25').replace(/\+/g, '%2B'),
    // AI Mode and Gemini's scraper list Brazilian Portuguese as `pt-BR` and reject `pt` (40501; Gemini measured on 7/11/2026 from
    // Brazil and Portugal, PROVIDERS.md). ChatGPT's scraper and AI Overviews take `pt`.
    language_code:
      (engine === 'google_ai_mode' || engine === 'gemini') && row.language_code === 'pt'
        ? 'pt-BR'
        : row.language_code,
    location_code: row.location_code,
    priority: 1,
    ...(engine === 'google_ai_overviews'
      ? { load_async_ai_overview: true, depth: 10 }
      : {}),
    // AI Mode (serp/google/ai_mode): DataForSEO task_post has no free parameter that
    // forces ai_overview_shopping. Shopping cards appear when Google returns them for
    // the keyword. priority=2 only buys speed. See docs.dataforseo.com.
  };
}
