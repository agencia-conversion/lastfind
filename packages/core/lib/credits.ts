import type { Engine } from './engines.ts';
// One credit represents $0.0012 of provider spend. Fixed Standard scrapers/SERP
// use one; Responses use conservative holds until DataForSEO reports final cost.
export const CREDIT_USD = 0.0012;
export const CREDIT_WEIGHTS: Record<Engine, number> = {
  chat_gpt: 1,
  gemini: 1,
  google_ai_mode: 1,
  google_ai_overviews: 1,
  claude: 50,
  perplexity: 15,
};
export function reserveCredits(engine: Engine, prompt = '') {
  if (engine !== 'google_ai_overviews') return CREDIT_WEIGHTS[engine];
  // DataForSEO multiplies Organic pricing for each advanced search operator.
  const operators =
    prompt.match(
      /\b(?:allinanchor|allintext|allintitle|allinurl|define|filetype|id|inanchor|info|intext|intitle|inurl|link|site):/gi,
    )?.length ?? 0;
  return Math.min(Number.MAX_SAFE_INTEGER, 5 ** operators);
}
export function settledCredits(cost: number, reserved: number) {
  if (!Number.isFinite(cost) || cost < 0) return reserved;
  // Float epsilon prevents an exact $0.0012 becoming two credits.
  return Math.max(1, Math.ceil(cost / CREDIT_USD - 1e-8));
}
