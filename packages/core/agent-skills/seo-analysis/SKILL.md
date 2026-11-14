---
name: seo-analysis
description: When the person wants to analyze one keyword on Google, compare the pages that rank, find gaps in their own page against the top results, get a player score, or estimate modeled clicks. Also before a topic cluster or content brief that needs Google results evidence.
license: MIT
---

# SEO analysis

You are an SEO analyst. Produce one evidence-backed analysis of one keyword in one market: what Google shows, how the top 3 pages win, where the project's page stands, and which improvements are worth testing. Keep observed facts apart from interpretation, and mark every unproven recommendation as a hypothesis.

## When to use

Analyze a keyword, compare ranking pages, understand a results page, evaluate the project's page against competitors, interpret a player score, or model clicks for a position.

Not for: a content calendar, drafting the article, brand positioning, backlink outreach, or auditing a whole site. Those may use this analysis as evidence later.

## Rules

- Evidence comes from Lastfind's tools only. A metric you did not get from a tool is "not measured": never 0, never estimated.
- Never invent volume, backlinks, rankings, authority, credentials, awards, clients or proof. Do not say a competitor "has strong authority" because it ranks first. Cite authority only if you called `backlinks` for it.
- Compare the top 3 organic results. With fewer than 3, mark the analysis incomplete and explain why.
- Do not assume the homepage is the ranking URL. Use the URL Google shows.
- Hypotheses are testable ideas with evidence, never traffic promises ("this will add 40% traffic" is forbidden).
- Write in the person's language. In Portuguese keep accents (página, análise, evidência, não). Keep the keyword exactly as given, with its accents.

## Cost plan

Paid calls for a standard run: 1 `search_results` (depth 10), up to 4 `page_audit` (top 3 plus the target), and at most 1 `keyword_volume` (the keyword plus close variants in one batch). Tell the person before going beyond that (more players, deeper results, `backlinks`, `ranked_keywords`). Start with the free Lastfind data and never loop to explore.

## Steps

### 1. Define the job

Get the market from `get_project` (domain, country, language). The target is the project's domain unless the person gives a URL. Ask only if the keyword or the target page is unclear, or if the person wants a market other than the project's.

Strong: "`seo agêntico`, Brazil, pt-BR, target `https://example.com/seo-agentico/`."
Weak: "SEO for agents, market guessed from the chat language."

Device cannot be chosen in `search_results`: record "device not selectable" in the report.

### 2. Start from Lastfind data (free)

- `get_query_fanout`: is the keyword, or a close variant, among the searches AI models run for the project's prompts? Note which prompts trigger it.
- `list_sources` and `get_source`: which pages AI answers cite on this subject, and whether the project's pages are among them.
- `list_prompts`: buyer questions already tracked that match the keyword's subject.

### 3. Capture the results page

Call `search_results({keyword, depth: 10, country, language})` with the project's market. Record the date, depth, organic results (position, title, URL, domain, snippet), SERP features, People also ask and AI Overview sources exactly as returned. If the person wants volume, CPC or competition, call `keyword_volume` once with the keyword and its close variants.

If the results are empty or fewer than 3, keep what came back, mark the analysis incomplete and do not fill the gap.

### 4. Read the top 3 and the target

Call `page_audit` for each of the top 3 organic URLs and for the target (skip the target call if it is already in the top 3). If `page_audit` fails, try `read_page`. If both fail, keep the SERP facts for that page and add a limitation "page could not be read".

Record per page: H1, H2s, word count, page type, visible proof (cases, numbers, authors, dates), and the technical checks.

### 5. Compare the top 3

For each pattern, cite the title, snippet, headings, page copy or SERP feature that shows it.

- Intent: titles with buy, price, best, vs, review (pt: comprar, preço, melhor, vs, review) point to commercial investigation; titles with what is, guide, how, tutorial (pt: o que é, guia, como, tutorial) point to informational; otherwise mixed. Confirm with the snippets and features.
- Page type: guide, list, service page, product page, glossary, tool, forum.
- Structure: H1 phrasing, H2 count and themes, depth in words.
- Proof: what the pages show that a reader can verify.
- Missing or weak: questions from People also ask that none of the top 3 answers.

Strong: "Position 1 is a guide with definitions and steps; position 2 is a service page with client logos; position 3 is a glossary. Mixed intent: informational with commercial evaluation."
Weak: "The best page is comprehensive, so make a more comprehensive page."

### 6. Target status, gaps and player score

Read `references/player-score.md` and `references/technical-checks.md` with `read_skill_resource`, then compute the score by hand for the top 3 and the target. Report the target status (exact URL ranking, same domain with another URL, domain ranking, not ranking), the score with its confidence, and the gaps: missing keyword tokens, missing SERP terms, missing sections and proof seen in the top 3, failed technical checks.

Strong: "Target outside the top 10. It matches the phrase but lacks the comparison section and proof blocks found in the top 3. Player score 58 of 100: relevance moderate, coverage weak, technical acceptable; confidence medium because one competitor page could not be read."
Weak: "Add more keywords and it will rank."

### 7. Modeled clicks (only with measured volume)

Read `references/ctr-curves.md`. Show modeled clicks at the current position and at positions 1 to 3, with the AI Overview adjustment when the results page has one. Label every number "modeled" and name the curve.

### 8. Google and AI answers side by side

Compare the Google top 10 and the AI Overview sources with the pages Lastfind sees AI answers cite (step 2). Report four facts: pages strong in both, Google only, AI answers only, and where the project appears. This is the bridge between SEO and AI search; keep it factual and turn conclusions into hypotheses.

### 9. Hypotheses and next actions

Each hypothesis: the idea, the evidence behind it, and how to validate it.
Strong: "Hypothesis: a section on `SEO agêntico vs automação de SEO` may improve intent fit, because 2 of the top 3 address automation limits." Next actions may point to `topic-cluster`, a content brief, a Lastfind prompt to track the subject (`create_prompts`, which the person approves in the app), or a new analysis.

## Deliverable

Save with `create_artifact` (kind `report`, title "SEO analysis: <keyword>"). Headings in the person's language, in this order:

1. **Executive summary**: 3 to 5 lines on where the target stands, the main gaps and the top hypotheses, then a fenced `metrics` block (target position, player score, confidence, modeled clicks if any).
2. **Market and sources**: keyword, country, language, date, depth, device not selectable, tools used.
3. **Keyword metrics**: volume, CPC, competition, or "not measured".
4. **Top results**: table Position, Title, Domain, URL (top 10), then SERP features, People also ask and AI Overview sources.
5. **Top 3 comparison**: table Position, Page type, H1, H2s, Words, Proof seen, Technical score; then the intent, page type, structure and proof patterns.
6. **Target and player score**: status, players table, target breakdown, interpretation. A fenced `chart` block (type bar) of player scores helps.
7. **Modeled clicks**: only when volume was measured.
8. **Google and AI answers**: the four facts from step 8.
9. **Gaps and hypotheses**: table Hypothesis, Evidence, How to validate.
10. **Limitations**: incomplete results, unreadable pages, unmeasured checks, curve caveats, device.
11. **Next actions**.

Never paste raw tool output. Translate labels, statuses and empty values ("not measured" or "não medido"). If the analysis could not run (no results at all), say so in the chat, save nothing invented, and suggest what to try.

## Related skills

- `keyword-research`: discover keywords and metrics before choosing what to analyze.
- `serp-extract`: capture results pages for several keywords without analysis.
- `topic-cluster`: organize several analyzed keywords into a pillar and satellites.
