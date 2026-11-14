import { countryIso } from './countries.ts';

export const ENGINES = [
  'chat_gpt',
  'gemini',
  'claude',
  'perplexity',
  'google_ai_mode',
  'google_ai_overviews',
] as const;
export type Engine = (typeof ENGINES)[number];
export const ENGINE_LABELS: Record<Engine, string> = {
  chat_gpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
  google_ai_mode: 'Google AI Mode',
  google_ai_overviews: 'AI Overviews',
};
export const ENGINE_META: Record<
  Engine,
  {
    icon: string;
    family: 'scraper' | 'responses' | 'serp';
    batch: boolean;
    maxLength: number;
    /** The countries (ISO alpha-2) the endpoint collects in, when it is not every country of countries.ts. */
    countries?: { only: string[] } | { except: string[] };
  }
> = {
  chat_gpt: {
    icon: 'openai',
    family: 'scraper',
    batch: true,
    maxLength: 1000,
    countries: { except: 'AQ AS BQ CC CK CN CW CX GG GS GU HM IM JE MP NF NU PN SX TK UM VE'.split(' ') },
  },
  gemini: {
    icon: 'gemini-color',
    family: 'scraper',
    batch: true,
    maxLength: 1000,
  },
  claude: {
    icon: 'claude-color',
    family: 'responses',
    batch: true,
    maxLength: 500,
  },
  perplexity: {
    icon: 'perplexity-color',
    family: 'responses',
    batch: false,
    maxLength: 500,
  },
  google_ai_mode: {
    icon: 'ai-mode',
    family: 'serp',
    batch: true,
    maxLength: 700,
    countries: { except: ['CN'] },
  },
  google_ai_overviews: {
    icon: 'google-color',
    family: 'serp',
    batch: true,
    maxLength: 700,
    countries: { except: ['CN'] },
  },
};
/**
 * The AIs this version collects and offers, in every edition and screen (since 8/11/2026): only what is scraped from an AI's own
 * interface or results page. The ones asked through a model API (Claude, Perplexity) are off; their history is kept.
 */
export const SCRAPED_ENGINES = ENGINES.filter((engine) => ENGINE_META[engine].family !== 'responses');
/** `engine IN …` for a read that does not take the header's AI filter (parseReportFilter): only the AIs collected today (constant names). */
export const COLLECTED_ENGINES_SQL = `(${SCRAPED_ENGINES.map((engine) => `'${engine}'`).join(',')})`;
export const isEngine = (value: unknown): value is Engine =>
  ENGINES.includes(value as Engine);
/**
 * Why an AI cannot collect for a project, or null when it can: its country. Every AI answers in both languages of prompts
 * (English and Portuguese; Gemini's interface in Portuguese since 7/11/2026, asked as `pt-BR`, PROVIDERS.md). Country lists, checked in DataForSEO's docs on 2026-10-28 (PROVIDERS.md): ChatGPT, its scraper's locations CSV;
 * Claude, the documented `web_search_country_iso_code` values; Google AI Mode and AI Overviews, Google's own availability
 * lists (China is the one DataForSEO country without them). Perplexity takes any ISO code; Gemini's scraper reports the same
 * 213 countries as Google.
 */
export function engineUnavailable(engine: Engine, location: number): 'country' | null {
  return engineCollectsIn(engine, location) ? null : 'country';
}
export function engineCollectsIn(engine: Engine, location: number) {
  const iso = countryIso(location);
  const countries = ENGINE_META[engine].countries;
  return !!iso && (!countries || ('only' in countries ? countries.only.includes(iso) : !countries.except.includes(iso)));
}
export function availableEngines(allowed: Engine[], location: number) {
  return allowed.filter((e) => !engineUnavailable(e, location));
}
