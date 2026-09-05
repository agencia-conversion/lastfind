import { ENGINE_META, type Engine } from './engines.ts';
export function providerBase(engine: Engine) {
  if (engine === 'google_ai_mode') return 'serp/google/ai_mode';
  if (engine === 'google_ai_overviews') return 'serp/google/organic';
  return `ai_optimization/${engine}/${ENGINE_META[engine].family === 'responses' ? 'llm_responses' : 'llm_scraper'}`;
}
export function providerResultPath(engine: Engine, task: string) {
  return `task_get/${ENGINE_META[engine].family === 'responses' ? '' : 'advanced/'}${encodeURIComponent(task)}`;
}
export function providerResultCost(
  engine: Engine,
  submittedCost: number,
  result: Record<string, unknown>,
) {
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
    return {
      ...common,
      user_prompt: row.prompt_text,
      model_name:
        options.model || (engine === 'claude' ? 'claude-haiku-4-5' : 'sonar'),
      max_output_tokens: 2048,
      web_search_country_iso_code: (
        { 2076: 'BR', 2840: 'US', 2826: 'GB' } as Record<number, string>
      )[row.location_code],
      system_message:
        row.language_code === 'pt'
          ? 'Responda em português.'
          : 'Answer in English.',
      ...(engine === 'claude'
        ? { web_search: true, force_web_search: true }
        : {}),
    };
  }
  return {
    ...common,
    keyword: row.prompt_text.replace(/%/g, '%25').replace(/\+/g, '%2B'),
    language_code: row.language_code,
    location_code: row.location_code,
    priority: 1,
    ...(engine === 'chat_gpt' ? { force_web_search: true } : {}),
    ...(engine === 'google_ai_overviews'
      ? { load_async_ai_overview: true, depth: 10 }
      : {}),
  };
}
