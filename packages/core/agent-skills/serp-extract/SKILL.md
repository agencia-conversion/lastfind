---
name: serp-extract
description: When the person wants a snapshot of Google results for specific keywords (ranking URLs, competitor pages, SERP features, People also ask, AI Overview sources) captured as evidence, without SEO analysis or recommendations.
license: MIT
---

# SERP extract

You capture Google results pages as evidence. Record what `search_results` returned for each keyword, in the order the person gave, with the market and date, and nothing more. Interpretation belongs to `seo-analysis`.

## When to use

Results page snapshots, ranking URLs, competitor URLs for a keyword, organic results, SERP features, People also ask, AI Overview sources, or a before/after record of who ranks.

Not for: inferring intent, recommending content, comparing the project's page with competitors, judging authority, or estimating volume. Hand the evidence to `seo-analysis`, `keyword-research` or `topic-cluster`.

## Rules

- Capture only. No intent, opportunity, authority, backlinks, content gaps, volume or strategy beyond what the results show.
- Keep the input keyword order everywhere: tables, summary, next steps. Do not sort by volume, alphabet or importance.
- Record for every keyword: country, language, depth, date and time of capture. `search_results` has no device option: record "device not selectable".
- Use the project's country and language (`get_project`) unless the person names another market. Never fall back silently to global English results.
- Normalize results as observed. Deduplicate identical URLs within a keyword, keep the first position, and list what was removed.
- An empty result is valid evidence: show an empty table and a limitation. Never reuse results from a similar keyword.
- Data the person pastes is labeled "given by the person" with its source and date; it is not a current snapshot.
- Write in the person's language. In Portuguese keep accents (página, análise, evidência, não). Keep keywords exactly as given.

## Cost plan

`search_results` is paid, one call per keyword. Default depth 10. Use 20, 50 or 100 only when the person asks for deeper positions. With more than 5 keywords, tell the person the number of calls before running. Never re-run a keyword in the same conversation unless the person asks for a fresh snapshot.

## Steps

### 1. Define the job

Exact keywords in order, market, depth.

Strong: "`seo agêntico`, then `seo com agentes`, Brazil, pt-BR, depth 10."
Weak: "Agentic SEO results worldwide, keyword translated to English because it looks similar."

### 2. Capture

Call `search_results({keyword, depth, country, language})` once per keyword, in order.

### 3. Normalize what came back

Per keyword:

- Organic results: position, title, URL, domain, snippet, breadcrumb or displayed URL when present. Fields not returned stay empty with "not returned".
- SERP features: type and position, and their items, only when returned (featured snippet, local pack, videos, images, shopping, top stories and so on).
- People also ask: the questions as returned.
- AI Overview: whether it appeared, and its sources (title, URL, domain).
- Deduplication: removed duplicate URLs, if any.

Strong: "Result 1: position, title, URL, domain, snippet. Features: People also ask, only because it was returned."
Weak: "The top 3 prove informational intent and readers want implementation guides."

### 4. Factual cross-references (free, optional)

These are facts, not analysis, and help the person read the snapshot:

- Mark rows whose domain is the project's domain (from `get_project`).
- Mark rows whose domain belongs to a brand Lastfind tracks for the project (`compare_brands` or `list_discovered_brands`), using the brand name only when the match is certain.
- Mark rows whose URL or domain is also cited by AI answers in Lastfind (`list_sources`): "cited by AI answers", "not cited", or "not checked".

### 5. Deliver

Save with `create_artifact` (kind `table`, title "Google results: <first keyword> (+N)"). Headings in the person's language:

1. **Summary**: facts only. Per keyword: organic results captured, features present, AI Overview yes or no, the project's best position or "not in the top <depth>".
2. **Capture details**: country, language, depth, device not selectable, date and time, tool used.
3. One section per keyword, in input order:
   - **Organic results**: table Position, Title, Domain, URL (add Snippet and the cross-reference columns when useful).
   - **SERP features**: table Feature, Position, Details; or "none returned".
   - **People also ask**: list; or "none returned".
   - **AI Overview sources**: table Title, Domain, URL; or "no AI Overview".
   - Deduplication and limitations for that keyword.
4. **Limitations**: empty results, missing fields, device, pasted data.
5. **Next steps**: for example `seo-analysis` on a keyword, or `keyword-research` for volumes. Suggestions only.

A fenced `metrics` block in the summary may show keywords captured, total organic results and keywords with AI Overview. Never paste raw tool output.

If a call fails, say so in the chat, keep the keywords that worked, and list the failed ones as limitations. If every call fails, deliver nothing invented.

## Examples

Strong: "Capture `seo agêntico` and `seo com agentes` for Brazil, pt-BR. Two calls, input order kept, organic results and observed features recorded, the project's domain marked at position 7 for the first keyword, an empty table and a limitation for the second because nothing was returned."

Weak: "Search manually, summarize the top pages as informational, estimate demand, and recommend content." This mixes evidence with analysis and invents metrics.

## Related skills

- `seo-analysis`: intent patterns, competitor comparison, target page gaps and player score from this evidence.
- `keyword-research`: volumes and keyword ideas.
- `topic-cluster`: uses results pages to group keywords into pages.
