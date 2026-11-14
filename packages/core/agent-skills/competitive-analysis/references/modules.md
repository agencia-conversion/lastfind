# Competitive analysis modules

Each module: what it answers, tools, compute rules, table columns, edge cases, anti-patterns. Players = the target plus 1 to 4 competitors.

## M0. AI answer visibility (free)

Answers: who AI engines mention and cite for the project's buyer questions.

Tools: get_overview (project totals and period), compare_brands (share of voice and mentions per brand), compare_ai_models (per engine), get_sentiment (per brand), list_sources and get_source_types (cited pages and their types), get_semantic_branding (how AI describes each brand).

Compute:

- One row per player with the values as returned, for the period Lastfind reports. Tag Observed and state the period.
- Best and weakest engine per player from compare_ai_models.
- Cited pages per player: list_sources rows whose domain is that player's domain.
- Source types: the mix of cited source types for the project (own site, competitors, editorial, user-generated and so on, as returned).

Columns: Player, AI share of voice % [Observed], Mentions, Sentiment, Strongest engine, Weakest engine, Pages cited in AI answers.

Edge cases: a competitor that is not a tracked brand in the project has no AI data; mark it not measured and suggest adding it (decide_brand, approved by the person). Few answers in the period: say the sample is small.

Anti-patterns: mixing AI share of voice with organic share of voice; reading sentiment as quality of the product.

## M1. Organic footprint

Answers: how large each player's Google organic presence is.

Tools: competing_domains({domain: target, limit 50}), one call; ranked_keywords({domain, limit 100}) per player.

Compute:

- From competing_domains, take each competitor's row: shared keywords, average position, traffic. A competitor absent from the rows is "not among returned organic competitors", not 0.
- Rows in competing_domains that are not in the player set are suggestions. Show the top 3 with their shared keywords; include only if the person agrees.
- From ranked_keywords, position buckets over the returned rows: 1 to 3, 4 to 10, 11 to 20, 21 to 50, 51 to 100. Label "among the top 100 returned keywords".
- Traffic: use the returned traffic fields only, labeled estimated. A sum over returned rows is "estimated traffic of returned keywords", not the domain total.

Columns: Player, Shared keywords with target, Average position, Estimated traffic, Top 1 to 3, Top 4 to 10, Top 11 to 20, Top 21 to 100.

Edge cases: a player with 0 ranked keywords keeps its row (0 as returned) plus a limitation naming country and language; a new domain with no data is "new or thin presence", never "low authority"; subdomains: state whether results include them.

Anti-patterns: inferring traffic from rank; turning estimated traffic into market share.

## M2. Organic share of voice and SERP features

Answers: who captures modeled clicks over a named keyword set, and who owns SERP features.

Follow references/share-of-voice-model.md (curve, universe, formulas, SERP feature counts). Tag Modeled.

Edge cases: all keywords without volume, share of voice not measured; a position above 100 counts as no visibility.

## M3. Keyword gap and striking distance

Answers: where competitors rank and the target does not, and where the target is close to page one.

Tools: the M1 ranked_keywords results (never fetched again); get_query_fanout (free).

Compute: gap and striking distance as in references/share-of-voice-model.md. Then compare gap keywords with the fan-out searches AI engines ran for the project's prompts: mark exact or near-exact matches "Matches AI fan-out". These are where competitors rank for the searches AIs use to build answers. Offer to check up to 5 of them with search_results (paid) to see positions and AI Overview sources.

Edge cases: a keyword with no volume stays in the gap list with volume not measured, sorted last; several competitors on one keyword make one row.

Anti-patterns: treating striking distance as a guarantee; adding up "missed clicks" without the formula and the Modeled tag.

## M4. Link summary

Answers: the size and risk headline of each player's link profile.

Tools: backlinks({target: domain, view: "summary"}) per player.

Columns: Player, Backlinks, Referring domains, Backlinks per referring domain, Rank, Spam score, Broken backlinks.

For link gap, overlap, anchors and quality mix, activate backlink-analysis in multi-competitor mode; do not recompute them here. Keep this module to one screen.

## M5. Content footprint and topic coverage

Answers: which subtopics each player covers, and how deeply.

There is no sitemap or crawl. Method: the ranking URLs from M1, plus a small read_page sample. Name the method in the report.

Compute:

- Footprint: per player, count returned ranking URLs by first path segment (/blog/, /guides/, /product/ ...). Label "among returned ranking URLs".
- Subtopics: the project's Lastfind topics (from list_prompts and their topics), or the person's list. Never invent subtopics from competitor URLs.
- Coverage per subtopic and player:
  - absent: no returned URL has the subtopic in its slug or ranking keyword.
  - tangential: the subtopic appears inside a broader URL that is about something else.
  - dedicated: a URL with the subtopic in slug or H1 and at least 600 words (word count from read_page or page_audit).
  - hub: at least 3 URLs covering different angles of the subtopic. Links between them are not verifiable; write "hub (cross-linking not verified)".
- Confirm dedicated and hub calls with read_page on at most 1 or 2 URLs per player.
- Formats seen in sampled pages: question headings (FAQ), comparison headings, glossary, step lists, a visible date. Video, tables and schema are not reliably visible in text; mark them not measured.
- Freshness: a visible published or updated date in the text only. Never from a date in the URL.
- AI citations: per player, how many of its pages list_sources shows as cited.

Columns: Subtopic, then one column per player with absent, tangential, dedicated or hub plus a sample URL.

Anti-patterns: inferring intent from the slug alone; calling word count quality; mixing subdomains without saying so.

## M6. Head-to-head pages

Answers: how the target page compares with competitor pages for the same intent.

Tools: page_audit and read_page per URL; list_sources (free) for AI citations; optionally one search_results call for the shared query.

Compute: one comparison per target URL and competitor URL pair, grouped by intent.

Columns: Signal, Target, Competitor, Difference. Signals: status, title and length, meta description length, H1, H2 count, word count, internal links, external links, images, first byte, load time, page audit score, cited in AI answers, SERP features owned for the query. Schema types are not measured.

Edge cases: a page that fails to load (4xx, 5xx, blocked) drops its pair, with a limitation naming the URL and status; two H1 headings: keep both and note it; more than 10000 words: keep and flag as an outlier.

Anti-patterns: running a full technical audit here (use technical-seo); concluding "better content" from word count.

## M7. Positioning and conversion surface

Answers: how each player presents itself, and how AI answers describe it.

Tools: read_page on each player's homepage and at most one key page (pricing, product or about); get_semantic_branding and get_semantic_evidence for the AI view.

Rule: every observation row records a literal excerpt (200 characters at most) and its place in the page text before any label. Place uses the read_page order: first heading (hero headline), first paragraph after it (subhead), early (first five blocks), later. Visual position and link destinations are not measured.

Rows to extract per player:

- Headline and subhead.
- Declared differentiation ("the only", "unlike", "first").
- Calls to action visible as text ("Book a demo", "Start free") with their place.
- Proof: customer names, testimonials with name and role, awards, certifications, numbers with an adjacent source. A number without an adjacent source goes to Unverified claims, never to proof. A logo is proof only if the text names the customer.
- Pricing visibility: shown (a price appears), from (a starting price), on request (contact for price), not found on sampled pages.

AI view: from get_semantic_branding, the attributes AI answers associate with each brand, with get_semantic_evidence excerpts. Compare declared positioning (site) with perceived positioning (AI answers): matches, gaps, attributes AI gives a competitor that the target claims.

Columns: Player, Headline, Subhead, Declared differentiation, Main call to action, Proof items, Unverified claims, Pricing, How AI describes it.

Stay descriptive: no "amateur", "weak", "aggressive" without the excerpt that supports it. Positioning decisions belong to the person: list them as questions in Next actions; never change project data on your own.

## Module status

Each module ends as complete, partial (some players or rows not measured), blocked (missing input, for example no competitor domains) or not run. Show a short table of modules and status at the end of Limitations.
