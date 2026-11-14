/**
 * Example AI bot days for a preview (lib/server/ai-bots.ts `seedPreview`) and the tests: deterministic, so two previews show
 * the same figures, and shaped like a real site's (bots of every purpose, a few errors, referrals only on a paid plan). The
 * connection that holds them is marked `preview` and the screen says it is example data.
 */
import { addDays, type BotDay } from './ai-bots.ts';

const BOTS: [id: string, weight: number][] = [
  ['gptbot', 14], ['oai-searchbot', 9], ['chatgpt-user', 4], ['claudebot', 7], ['claude-searchbot', 2], ['claude-user', 1],
  ['perplexitybot', 5], ['perplexity-user', 2], ['googlebot', 12], ['bingbot', 6], ['applebot', 2], ['meta-externalagent', 3],
  ['bytespider', 1], ['amazonbot', 1], ['ccbot', 1], ['other', 1],
];
const SITE = ['/', '/pricing', '/docs', '/blog', '/about', '/contact', '/blog/getting-started', '/blog/comparison-guide', '/features', '/customers'];
const HOSTS: [string, number][] = [['chatgpt.com', 9], ['perplexity.ai', 4], ['gemini.google.com', 2], ['claude.ai', 1], ['copilot.microsoft.com', 1]];

/** A small stable number from a text (FNV-1a), to vary the figures without randomness. */
const noise = (text: string) => {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967295;
};

/** `days` whole days ending the day before `today`, plus today's partial day; `paths` adds the project's own cited pages. */
export function exampleBotDays({ today, days = 60, paths = [], referrals }: { today: string; days?: number; paths?: string[]; referrals: boolean }): BotDay[] {
  const site = [...new Set([...SITE, ...paths])].slice(0, 30);
  const out: BotDay[] = [];
  for (let back = days; back >= 0; back--) {
    const day = addDays(today, -back);
    // Growth over the period and a weekly rhythm (fewer visits on weekends).
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const scale = (0.9 + (0.2 * (days - back)) / days) * (weekday === 0 || weekday === 6 ? 0.75 : 1) * (back === 0 ? 0.4 : 1);
    const hits: BotDay['hits'] = [];
    for (const [bot, weight] of BOTS)
      site.forEach((path, index) => {
        if (noise(`${bot}${path}`) > 0.75 && index > 2) return;
        const visits = Math.round(weight * scale * (6 + 10 * noise(`${day}${bot}${path}`)) / (1 + index * 0.35));
        if (!visits) return;
        const missing = noise(`${bot}${path}404`) > 0.93;
        hits.push([bot, path, missing ? 404 : 200, visits, visits * 42_000]);
        if (noise(`${day}${bot}${path}301`) > 0.8) hits.push([bot, path, 301, Math.max(1, Math.round(visits / 6)), 0]);
        if (bot === 'bytespider' && noise(`${day}${path}`) > 0.7) hits.push([bot, path, 403, Math.max(1, Math.round(visits / 3)), 0]);
        if (noise(`${day}${bot}${path}5xx`) > 0.985) hits.push([bot, path, 503, 1, 0]);
      });
    const requests = Math.round(hits.reduce((sum, row) => sum + row[3], 0) * (42 + 6 * noise(day)));
    // Each LLM's visits land on a few pages of the site, the home and the most cited first.
    const landings: NonNullable<BotDay['landings']> = [];
    const sent: [string, number][] = [];
    if (referrals)
      for (const [host, weight] of HOSTS) {
        let total = 0;
        site.slice(0, 8).forEach((path, index) => {
          if (index > 1 && noise(`${host}${path}`) > 0.6) return;
          const visits = Math.round((weight * scale * (1 + 2 * noise(`${day}${host}${path}`))) / (1 + index * 0.6));
          if (!visits) return;
          landings.push([host, path, visits]);
          total += visits;
        });
        if (total) sent.push([host, total]);
      }
    out.push({
      day,
      requests,
      complete: back > 0,
      hits,
      paths: site,
      referrals: referrals ? sent : null,
      landings: referrals ? landings : null,
    });
  }
  return out;
}
