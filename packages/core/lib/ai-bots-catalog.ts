/**
 * The AI bots the AI bots report recognizes: data only, read by `lib/ai-bots.ts`. Each bot names the user-agent tokens it
 * declares (matched case-insensitively, the longest token first, so "Applebot-Extended" is not read as "Applebot"), its
 * operator and what it fetches for:
 *
 * - `training`: collects pages to train models;
 * - `search`: builds the index an AI search or assistant answers from;
 * - `user`: fetches a page because a person asked an assistant something right now.
 *
 * A user agent is what the client says it is, so a bot can be spoofed: the screen says so. To add a bot, add a row here;
 * nothing else changes. `OTHER_AI_TOKENS` are AI crawlers without a row of their own: they count as "Other AI bots".
 * `AI_REFERRERS` are the hosts of AI answers that send people to a site (the visits from AIs).
 */
export type BotPurpose = 'training' | 'search' | 'user';
export type CatalogBot = { id: string; name: string; operator: string; purpose: BotPurpose; tokens: string[] };

export const AI_BOTS: CatalogBot[] = [
  { id: 'gptbot', name: 'GPTBot', operator: 'OpenAI', purpose: 'training', tokens: ['GPTBot'] },
  { id: 'oai-searchbot', name: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'search', tokens: ['OAI-SearchBot'] },
  { id: 'chatgpt-user', name: 'ChatGPT-User', operator: 'OpenAI', purpose: 'user', tokens: ['ChatGPT-User'] },
  { id: 'claudebot', name: 'ClaudeBot', operator: 'Anthropic', purpose: 'training', tokens: ['ClaudeBot', 'anthropic-ai'] },
  { id: 'claude-searchbot', name: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'search', tokens: ['Claude-SearchBot'] },
  { id: 'claude-user', name: 'Claude-User', operator: 'Anthropic', purpose: 'user', tokens: ['Claude-User', 'Claude-Web'] },
  { id: 'perplexitybot', name: 'PerplexityBot', operator: 'Perplexity', purpose: 'search', tokens: ['PerplexityBot'] },
  { id: 'perplexity-user', name: 'Perplexity-User', operator: 'Perplexity', purpose: 'user', tokens: ['Perplexity-User'] },
  { id: 'googlebot', name: 'Googlebot', operator: 'Google', purpose: 'search', tokens: ['Googlebot'] },
  { id: 'google-cloudvertexbot', name: 'Google-CloudVertexBot', operator: 'Google', purpose: 'user', tokens: ['Google-CloudVertexBot'] },
  { id: 'gemini', name: 'Gemini', operator: 'Google', purpose: 'user', tokens: ['Gemini-Deep-Research', 'Google-Gemini'] },
  { id: 'bingbot', name: 'Bingbot', operator: 'Microsoft', purpose: 'search', tokens: ['bingbot'] },
  { id: 'applebot', name: 'Applebot', operator: 'Apple', purpose: 'search', tokens: ['Applebot'] },
  { id: 'applebot-extended', name: 'Applebot-Extended', operator: 'Apple', purpose: 'training', tokens: ['Applebot-Extended'] },
  { id: 'meta-externalagent', name: 'Meta-ExternalAgent', operator: 'Meta', purpose: 'training', tokens: ['meta-externalagent'] },
  { id: 'meta-externalfetcher', name: 'Meta-ExternalFetcher', operator: 'Meta', purpose: 'user', tokens: ['meta-externalfetcher'] },
  { id: 'bytespider', name: 'Bytespider', operator: 'ByteDance', purpose: 'training', tokens: ['Bytespider'] },
  { id: 'amazonbot', name: 'Amazonbot', operator: 'Amazon', purpose: 'training', tokens: ['Amazonbot'] },
  { id: 'ccbot', name: 'CCBot', operator: 'Common Crawl', purpose: 'training', tokens: ['CCBot'] },
  { id: 'duckassistbot', name: 'DuckAssistBot', operator: 'DuckDuckGo', purpose: 'search', tokens: ['DuckAssistBot'] },
  { id: 'mistralai-user', name: 'MistralAI-User', operator: 'Mistral', purpose: 'user', tokens: ['MistralAI-User'] },
  { id: 'cohere-ai', name: 'cohere-ai', operator: 'Cohere', purpose: 'user', tokens: ['cohere-ai', 'cohere-training-data-crawler'] },
  { id: 'youbot', name: 'YouBot', operator: 'You.com', purpose: 'search', tokens: ['YouBot'] },
];

/** AI crawlers without a row of their own: "Other AI bots", training by default (what most of them collect for). */
export const OTHER_AI_TOKENS = ['AI2Bot', 'Diffbot', 'Timpibot', 'ImagesiftBot', 'img2dataset', 'omgili', 'PanguBot', 'Kangaroo Bot', 'iaskspider', 'FacebookBot'];
export const OTHER_BOT: CatalogBot = { id: 'other', name: 'Other AI bots', operator: 'Other', purpose: 'training', tokens: [] };

/**
 * The LLMs whose answers send visitors to a site, by the host a visit comes from (`www.` is dropped before matching): the
 * classifier of AI Traffic. `id` groups the hosts of one LLM (chatgpt.com and chat.openai.com are both ChatGPT). To add an
 * LLM or a host, add a row here; the collection asks Cloudflare for every host listed, and nothing else changes.
 */
export type AiReferrer = { host: string; id: string; name: string; operator: string };
export const AI_REFERRERS: AiReferrer[] = [
  { host: 'chatgpt.com', id: 'chatgpt', name: 'ChatGPT', operator: 'OpenAI' },
  { host: 'chat.openai.com', id: 'chatgpt', name: 'ChatGPT', operator: 'OpenAI' },
  { host: 'perplexity.ai', id: 'perplexity', name: 'Perplexity', operator: 'Perplexity' },
  { host: 'claude.ai', id: 'claude', name: 'Claude', operator: 'Anthropic' },
  { host: 'gemini.google.com', id: 'gemini', name: 'Gemini', operator: 'Google' },
  { host: 'copilot.microsoft.com', id: 'copilot', name: 'Copilot', operator: 'Microsoft' },
  { host: 'you.com', id: 'you', name: 'You.com', operator: 'You.com' },
  { host: 'chat.mistral.ai', id: 'le-chat', name: 'Le Chat', operator: 'Mistral' },
  { host: 'meta.ai', id: 'meta-ai', name: 'Meta AI', operator: 'Meta' },
  { host: 'grok.com', id: 'grok', name: 'Grok', operator: 'xAI' },
  { host: 'chat.deepseek.com', id: 'deepseek', name: 'DeepSeek', operator: 'DeepSeek' },
  { host: 'chat.qwen.ai', id: 'qwen', name: 'Qwen', operator: 'Alibaba' },
  { host: 'poe.com', id: 'poe', name: 'Poe', operator: 'Quora' },
  { host: 'phind.com', id: 'phind', name: 'Phind', operator: 'Phind' },
];
