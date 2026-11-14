// The agent's search data tools (both editions): Google results, keyword volumes and ideas, ranked keywords, competing
// domains, backlinks and the content and checks of a public page, read live from Lastfind's search data account (the same
// one monitoring uses) and named as Lastfind's own: neither the tools, their errors nor their results name the supplier.
// Each call reserves its worst case in the turn before it is sent and counts what the reply says it cost; a reply that
// never came counts at the reserve and is never sent again. Results are cut to the fields an analysis reads.
import { tool, type ToolSet } from 'ai';
import * as z from 'zod';
import { COUNTRY_CODES, countryIso } from '@/lib/countries';
import { dataForSeo, SendError } from '@/lib/semantic-panel-provider';
import { wordCount } from '@/lib/content-overview';
import { publicAddress } from '@/lib/cited-sources';
import { setting } from './env';
import { holdTurn, spendTurn, type AgentTurn } from './agent';
import { keepSearchData, storedSearchData } from './cited-sources';
import type { Json } from './mcp-tools';

type Result = Record<string, unknown>;
/** A field deep in a reply (`at(item, 'keyword_info', 'search_volume')`), or undefined. */
const at = (value: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Result)[key] : undefined), value);
const list = (value: unknown): Result[] => (Array.isArray(value) ? value.filter((item): item is Result => !!item && typeof item === 'object') : []);

const country = z.string().regex(/^[A-Za-z]{2}$/).optional().describe("ISO country code (BR, US); the project's country when left out.");
const language = z.string().regex(/^[a-z]{2}$/).optional().describe("Language code (pt, en); the project's language when left out.");

/** The supplier's name never reaches the model or the screen. */
const plain = (text: unknown) => String(text ?? '').replace(/data\s*for\s*seo/gi, 'Lastfind').slice(0, 200);

function place(turn: AgentTurn, input: { country?: string; language?: string }) {
  const iso = input.country?.toUpperCase();
  const location = (iso && COUNTRY_CODES.find((code) => countryIso(code) === iso)) || Number(turn.project.location_code) || 2840;
  return { location_code: location, language_code: input.language ?? (String(turn.project.language_code || 'en').slice(0, 2) || 'en') };
}

/** The account lacks this kind of data (as opposed to a read that failed). */
const NOT_AVAILABLE = 'This kind of search data is not available in this installation.';

/**
 * One paid read: holds `reserve` in the turn, sends the task and counts its cost; `pick` cuts the first result (or all
 * of them) to what the model needs. A refusal comes back as `{ error }` for the model to explain.
 */
export async function paidRead(
  current: () => Promise<AgentTurn>,
  reserve: number,
  path: string,
  payload: Json | ((turn: AgentTurn) => Json),
  pick: (result: Result, all: Result[]) => Json,
  send = sender(),
): Promise<Json> {
  const turn = await current();
  if (!send) return { error: { code: 'unavailable', message: 'Search data is not set up in this installation.' } };
  const request = typeof payload === 'function' ? payload(turn) : payload;
  // The same request this workspace read lately is answered from its store: free, with the day it was read. Per workspace only:
  // a hit shared across workspaces would tell one what another searched.
  const workspace = String(turn.actor?.workspaceId ?? '');
  const stored = await storedSearchData(workspace, path, request);
  if (stored) return { ...(stored.result as Json), read_at: stored.readAt.slice(0, 10) };
  if (!(await holdTurn(turn, reserve))) {
    turn.stopped = 'spend';
    return { error: { code: 'limit', message: 'This answer has no credits left for search data.' } };
  }
  let tasks: Result[];
  try {
    tasks = await send(path, [request]);
  } catch (error) {
    await spendTurn(turn, error instanceof SendError && !error.ambiguous ? 0 : reserve);
    return { error: { code: 'unavailable', message: 'Lastfind could not read search data now. Try again later.' } };
  }
  await spendTurn(turn, tasks.reduce((sum, task) => sum + (Number(at(task, 'cost')) || 0), 0));
  const task = tasks[0];
  if (at(task, 'status_code') === 40204) return { error: { code: 'unavailable', message: NOT_AVAILABLE } };
  if (at(task, 'status_code') !== 20000) {
    // The supplier's own words go to the log only: the model and the screen get a fixed sentence.
    console.warn(`Agent search data refused (${String(at(task, 'status_code'))}): ${String(at(task, 'status_message') ?? '').slice(0, 200)}`);
    return { error: { code: 'invalid_argument', message: 'The search data request was refused. Check the keyword, address, country and language.' } };
  }
  const results = list(at(task, 'result'));
  const picked = pick(results[0] ?? {}, results);
  if (!('error' in picked)) await keepSearchData(workspace, path, request, picked);
  return picked;
}

function sender() {
  const login = setting('DATAFORSEO_LOGIN');
  const password = setting('DATAFORSEO_PASSWORD');
  return login && password ? dataForSeo(login, password, 100_000) : null;
}

/** A refusal names what it was for (the keyword searched, the page read), so the conversation's reads know it was tried. */
const naming = (echo: Json) => (result: Json): Json => ('error' in result ? { ...echo, ...result } : result);
/** An address publicAddress refuses (an IP, localhost, a local name, a port, credentials): not a public page. */
const NOT_PUBLIC = { code: 'invalid', message: 'Only a public http(s) page can be read.' };

const items = (result: Result, limit: number) => list(at(result, 'items')).slice(0, limit);
const round = (value: unknown, digits = 2) => (typeof value === 'number' ? Math.round(value * 10 ** digits) / 10 ** digits : null);
/** The keyword and domain data's list price (8/11/2026): US$ 0.012 a request and 0.00012 a row returned. */
const labs = (rows: number) => 0.012 + 0.00012 * rows;
/** Keywords as one request: trimmed, lower case, each once and sorted, so the same list is the same request. */
const keywordList = (keywords: string[]) => [...new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean))].sort();
const month = (item: unknown) => ({ month: `${at(item, 'year')}-${String(at(item, 'month')).padStart(2, '0')}`, volume: at(item, 'search_volume') ?? null });

/** The tools, for the turn they run in (`current()`). */
export function agentDataTools(current: () => Promise<AgentTurn>): ToolSet {
  return {
    search_results: tool({
      description:
        "Google's organic results for one keyword now: position, title, URL, domain and snippet, with the SERP features present (AI Overview, featured snippet, People also ask). Use it to see who ranks for a keyword and how the page looks; the keyword may use Google operators (site:example.com topic, for what one site published on a topic). Costs credits.",
      inputSchema: z.object({ keyword: z.string().min(1).max(200), depth: z.union([z.literal(10), z.literal(20), z.literal(50), z.literal(100)]).optional().describe('How many results (10 by default).'), country, language }),
      execute: ({ keyword, depth = 10, ...where }) =>
        paidRead(current, 0.002 * (depth / 10) + 0.004, 'serp/google/organic/live/advanced', (turn) => ({ keyword, depth, ...place(turn, where) }), (result) => {
          const all = list(at(result, 'items'));
          return {
            keyword,
            results_count: at(result, 'se_results_count') ?? null,
            features: [...new Set(all.map((item) => at(item, 'type')).filter((type) => type !== 'organic'))],
            organic: all.filter((item) => at(item, 'type') === 'organic').map((item) => ({ position: at(item, 'rank_group'), title: at(item, 'title'), url: at(item, 'url'), domain: at(item, 'domain'), snippet: plain(at(item, 'description')).slice(0, 200) })),
            people_also_ask: all.filter((item) => at(item, 'type') === 'people_also_ask').flatMap((item) => list(at(item, 'items')).map((question) => at(question, 'title'))).slice(0, 8),
            ai_overview_sources: all.filter((item) => at(item, 'type') === 'ai_overview').flatMap((item) => list(at(item, 'references')).map((reference) => at(reference, 'url'))).slice(0, 10),
          };
        }).then(naming({ keyword })),
    }),
    keyword_volume: tool({
      description: 'Monthly Google search volume, CPC (US$) and competition for up to 100 keywords, with the last 12 months. Costs credits; ask once for all keywords.',
      inputSchema: z.object({ keywords: z.array(z.string().min(1).max(80)).min(1).max(100), country, language }),
      execute: async ({ keywords, ...where }) => {
        const asked = keywordList(keywords);
        // The keyword data's overview first (US$ 0.012 plus 0.00012 a keyword, against 0.09 a request for the ads planner's): the same
        // volume, CPC, competition level and months. A keyword it has no data for comes back without a volume (absent, never 0).
        const overview = await paidRead(current, labs(asked.length), 'dataforseo_labs/google/keyword_overview/live', (turn) => ({ keywords: asked, ...place(turn, where) }), (result) => {
          const found = new Map(items(result, 1000).map((item) => [String(at(item, 'keyword') ?? '').toLowerCase(), item]));
          return {
            keywords: asked.map((keyword) => {
              const info = at(found.get(keyword), 'keyword_info');
              return {
                keyword,
                volume: at(info, 'search_volume') ?? null,
                cpc: round(at(info, 'cpc')),
                competition: at(info, 'competition_level') ?? null,
                months: list(at(info, 'monthly_searches')).slice(0, 12).map(month),
              };
            }),
          };
        });
        // A country or language the overview does not cover is refused, and an account may lack it: the ads planner's volumes then
        // (its own reserve, its price). A read that failed or hit the limit is not sent again.
        const refused = overview.error as { code?: string; message?: string } | undefined;
        if (refused?.code !== 'invalid_argument' && refused?.message !== NOT_AVAILABLE) return overview;
        return paidRead(current, 0.09, 'keywords_data/google_ads/search_volume/live', (turn) => ({ keywords: asked, ...place(turn, where) }), (_, all) => ({
          keywords: all.map((item) => ({
            keyword: at(item, 'keyword'),
            volume: at(item, 'search_volume') ?? null,
            cpc: round(at(item, 'cpc')),
            competition: at(item, 'competition') ?? null,
            months: list(at(item, 'monthly_searches')).slice(0, 12).map(month),
          })),
        }));
      },
    }),
    keyword_ideas: tool({
      description: 'Keyword ideas around a seed keyword (long tail included), with search volume, CPC, difficulty (0 to 100) and intent. Costs credits.',
      inputSchema: z.object({ keyword: z.string().min(1).max(80), limit: z.number().int().min(1).max(100).optional(), country, language }),
      execute: ({ keyword, limit = 50, ...where }) =>
        paidRead(current, labs(limit + 1), 'dataforseo_labs/google/keyword_suggestions/live', (turn) => ({ keyword, limit, include_seed_keyword: true, ...place(turn, where) }), (result) => ({
          seed: keyword,
          ideas: [...list([at(result, 'seed_keyword_data')]), ...items(result, limit)].map((item) => ({
            keyword: at(item, 'keyword'),
            volume: at(item, 'keyword_info', 'search_volume') ?? null,
            cpc: round(at(item, 'keyword_info', 'cpc')),
            difficulty: at(item, 'keyword_properties', 'keyword_difficulty') ?? null,
            intent: at(item, 'search_intent_info', 'main_intent') ?? null,
          })),
        })),
    }),
    ranked_keywords: tool({
      description: "The Google keywords a domain ranks for, by search volume: position, URL and estimated monthly traffic. Use it for a site's or a competitor's SEO footprint. Costs credits.",
      inputSchema: z.object({ domain: z.string().min(3).max(200), limit: z.number().int().min(1).max(100).optional(), country, language }),
      execute: ({ domain, limit = 50, ...where }) =>
        paidRead(current, labs(limit), 'dataforseo_labs/google/ranked_keywords/live', (turn) => ({ target: domain, limit, order_by: ['keyword_data.keyword_info.search_volume,desc'], ...place(turn, where) }), (result) => ({
          domain,
          total: at(result, 'total_count') ?? null,
          keywords: items(result, limit).map((item) => ({
            keyword: at(item, 'keyword_data', 'keyword'),
            volume: at(item, 'keyword_data', 'keyword_info', 'search_volume') ?? null,
            position: at(item, 'ranked_serp_element', 'serp_item', 'rank_group') ?? null,
            url: at(item, 'ranked_serp_element', 'serp_item', 'url') ?? null,
            traffic: round(at(item, 'ranked_serp_element', 'serp_item', 'etv'), 0),
          })),
        })),
    }),
    competing_domains: tool({
      description: 'The domains that compete with a domain in Google organic results: shared keywords, average position and estimated traffic. Costs credits.',
      inputSchema: z.object({ domain: z.string().min(3).max(200), limit: z.number().int().min(1).max(50).optional(), country, language }),
      execute: ({ domain, limit = 20, ...where }) =>
        paidRead(current, labs(limit), 'dataforseo_labs/google/competitors_domain/live', (turn) => ({ target: domain, limit, ...place(turn, where) }), (result) => ({
          domain,
          competitors: items(result, limit).map((item) => ({
            domain: at(item, 'domain'),
            shared_keywords: at(item, 'intersections') ?? null,
            average_position: round(at(item, 'avg_position'), 1),
            keywords: at(item, 'full_domain_metrics', 'organic', 'count') ?? null,
            traffic: round(at(item, 'full_domain_metrics', 'organic', 'etv'), 0),
          })),
        })),
    }),
    backlinks: tool({
      description: "A domain's or URL's backlink profile: a summary (backlinks, referring domains, rank, spam score) or its top referring domains, anchors or backlinks. Costs credits.",
      inputSchema: z.object({ target: z.string().min(3).max(300), view: z.enum(['summary', 'referring_domains', 'anchors', 'backlinks']).optional(), limit: z.number().int().min(1).max(100).optional() }),
      execute: ({ target, view = 'summary', limit = 20 }) =>
        paidRead(current, 0.03 + 0.0002 * limit, `backlinks/${view}/live`, view === 'summary' ? { target } : { target, limit, order_by: ['rank,desc'] }, (result) =>
          view === 'summary'
            ? { target, backlinks: at(result, 'backlinks') ?? null, referring_domains: at(result, 'referring_domains') ?? null, rank: at(result, 'rank') ?? null, spam_score: at(result, 'backlinks_spam_score') ?? null, broken_backlinks: at(result, 'broken_backlinks') ?? null }
            : {
                target,
                view,
                total: at(result, 'total_count') ?? null,
                rows: items(result, limit).map((item) =>
                  view === 'referring_domains'
                    ? { domain: at(item, 'domain'), rank: at(item, 'rank'), backlinks: at(item, 'backlinks'), first_seen: String(at(item, 'first_seen') ?? '').slice(0, 10) || null }
                    : view === 'anchors'
                      ? { anchor: at(item, 'anchor'), backlinks: at(item, 'backlinks'), referring_domains: at(item, 'referring_domains') }
                      : { from: at(item, 'url_from'), to: at(item, 'url_to'), anchor: at(item, 'anchor'), rank: at(item, 'rank'), dofollow: at(item, 'dofollow'), first_seen: String(at(item, 'first_seen') ?? '').slice(0, 10) || null },
                ),
              },
        ),
    }),
    read_page: tool({
      description: "A public page's content as text: title, headings and paragraphs in order, and its words counted (running text and in all). Use it to review, compare or rewrite a page. A page this workspace read in the last weeks comes from its store, free, with the date it was read; otherwise it costs credits.",
      inputSchema: z.object({ url: z.string().url().max(500) }),
      // Kept per workspace like the other search data (paidRead): never a page another account read, nor when it read it.
      // The address normalized (no fragment), so the same page is the same request.
      execute: async ({ url }) => {
        // The same rule as every page the product reads (publicAddress): a refused address is never sent, nor paid for.
        const address = publicAddress(url);
        if (!address) return { url, error: NOT_PUBLIC };
        return paidRead(current, 0.005, 'on_page/content_parsing/live', { url: address.href }, (result) => {
          const page = at(items(result, 1)[0], 'page_content');
          const lines: string[] = [];
          const section = (part: unknown) => {
            for (const block of list(at(part, 'primary_content'))) if (at(block, 'text')) lines.push(String(at(block, 'text')));
          };
          section(at(page, 'header'));
          for (const topic of [...list(at(page, 'main_topic')), ...list(at(page, 'secondary_topic'))]) {
            if (at(topic, 'h_title')) lines.push(`${'#'.repeat(Math.min(Number(at(topic, 'level')) || 2, 6))} ${at(topic, 'h_title')}`);
            section(topic);
          }
          const text = lines.join('\n\n');
          // A page that gave no text (blocked, or only scripts) was not read: never a page of 0 words.
          if (!text.trim()) return { error: { code: 'unavailable', message: 'This page could not be read: it returned no text.' } };
          // Counted here, on the whole page: the Overview of a content compares these figures, never the model's.
          return { url, words: wordCount(text), text: text.slice(0, 20_000), truncated: text.length > 20_000 };
        }).then(naming({ url }));
      },
    }),
    page_audit: tool({
      description: "Technical SEO checks of one public page: status, title, meta description, canonical, headings, links, images, word count, load timing and the problems found. Costs credits.",
      inputSchema: z.object({ url: z.string().url().max(500) }),
      execute: async ({ url }) => {
        const address = publicAddress(url);
        if (!address) return { url, error: NOT_PUBLIC };
        return paidRead(current, 0.005, 'on_page/instant_pages', { url: address.href }, (result) => {
          const page = (items(result, 1)[0] ?? {}) as Result;
          const meta = (at(page, 'meta') ?? {}) as Result;
          return {
            url,
            status: at(page, 'status_code') ?? null,
            score: round(at(page, 'onpage_score'), 1),
            title: at(meta, 'title') ?? null,
            description: at(meta, 'description') ?? null,
            canonical: at(meta, 'canonical') ?? null,
            headings: { h1: at(meta, 'htags', 'h1') ?? [], h2: (Array.isArray(at(meta, 'htags', 'h2')) ? (at(meta, 'htags', 'h2') as unknown[]) : []).slice(0, 20) },
            links: { internal: at(meta, 'internal_links_count') ?? null, external: at(meta, 'external_links_count') ?? null },
            images: at(meta, 'images_count') ?? null,
            words: at(meta, 'content', 'plain_text_word_count') ?? null,
            first_byte_ms: at(page, 'page_timing', 'waiting_time') ?? null,
            load_ms: at(page, 'page_timing', 'duration_time') ?? null,
            problems: Object.entries((at(page, 'checks') ?? {}) as Record<string, boolean>).filter(([name, value]) => value === true && !/^(is_https|has_html_doctype|canonical|seo_friendly_url|is_www|is_http|has_render_blocking_resources)$/.test(name)).map(([name]) => name),
          };
        });
      },
    }),
  };
}
