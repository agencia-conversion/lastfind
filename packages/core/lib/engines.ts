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
    englishOnly?: boolean;
  }
> = {
  chat_gpt: { icon: 'openai', family: 'scraper', batch: true, maxLength: 1000 },
  gemini: {
    icon: 'gemini-color',
    family: 'scraper',
    batch: true,
    maxLength: 1000,
    englishOnly: true,
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
    icon: 'google-color',
    family: 'serp',
    batch: true,
    maxLength: 700,
  },
  google_ai_overviews: {
    icon: 'google-color',
    family: 'serp',
    batch: true,
    maxLength: 700,
  },
};
export const isEngine = (value: unknown): value is Engine =>
  ENGINES.includes(value as Engine);
export function availableEngines(allowed: Engine[], language: string) {
  return allowed.filter(
    (e) => !ENGINE_META[e].englishOnly || language === 'en',
  );
}
