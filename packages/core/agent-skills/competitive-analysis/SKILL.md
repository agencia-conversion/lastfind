---
name: competitive-analysis
description: When the person wants to compare their brand or pages with competitors across AI answers and Google: share of voice, organic footprint, keyword gaps, content coverage, head-to-head pages, link summary and positioning, in one evidence-backed report.
license: MIT
---

# Competitive analysis

You produce one evidence-backed competitive report for the project's brand and 1 to 4 competitors. It starts from Lastfind's AI-answer data (free) and adds search modules only where they answer the person's question. You report observations, gaps and next investigations, never invented data or promised outcomes.

## When to use

- "How do we compare with X", "who is winning in our market", "what are competitors ranking for that we are not", "compare our page with theirs", "how do they position themselves".

For depth on one surface, use the dedicated skill: backlinks (backlink-analysis), one page's technical health (technical-seo), links inside the site (internal-links).

## Rules

- Competitors come from the project's tracked competitors (compare_brands) or from the person. Never invent a market set. Organic competitors from competing_domains or brands from list_discovered_brands are suggestions: show the evidence row (shared keywords, mentions) and include them only if the person agrees. Adding a discovered brand to the project goes through decide_brand, which the person approves in the app.
- Missing metric = not measured, never 0. A 0 a tool returned stays 0. Never invent rankings, positions, traffic, volumes, share of voice, link counts, dates or brand claims.
- Two kinds of share of voice, never mixed: AI share of voice is observed in Lastfind's daily AI answers; organic share of voice is modeled from rankings, search volume and a CTR curve. Tag every number Observed or Modeled.
- Estimated traffic is shown as the tool returns it, labeled estimated. Never turn it into market share.
- Do not promise rankings, traffic, links, mentions or revenue. Next actions are investigations.
- Write in the person's language. In pt-BR keep accents.

## Modules

| ID | Module | Main tools | Cost |
|---|---|---|---|
| M0 | AI answer visibility | get_overview, compare_brands, compare_ai_models, get_sentiment, list_sources, get_source_types, get_semantic_branding | free |
| M1 | Organic footprint | competing_domains, ranked_keywords | paid, 1 + 1 per player |
| M2 | Organic share of voice and SERP features | search_results per keyword, keyword_volume | paid, 1 per keyword |
| M3 | Keyword gap and striking distance | M1 results reused, get_query_fanout | free after M1 |
| M4 | Link summary | backlinks summary per player | paid, 1 per player |
| M5 | Content footprint and topic coverage | M1 URLs, Lastfind topics, list_sources, read_page sample | paid, read_page only |
| M6 | Head-to-head pages | page_audit, read_page, list_sources, optional search_results | paid, 2 per URL |
| M7 | Positioning and conversion surface | read_page, get_semantic_branding, get_semantic_evidence | paid, read_page only |

Compute rules, table columns, edge cases and anti-patterns per module are in references/modules.md. The CTR curve and the share-of-voice, gap and striking-distance formulas are in references/share-of-voice-model.md. Read each with read_skill_resource before running the modules that need it.

## Presets

- ai (default for a loose "how do we compare"): M0 only. Free. Then offer the search modules.
- quick: M0, M1, M3.
- domain-full: M0, M1, M2, M3, M4, M5, M7.
- url-headtohead: M6 and M7 for the given URLs, plus M4 on the URLs if the person wants links.
- content-only: M0, M5, M2.
- brand-only: M0 and M7.

The person can also name modules directly.

## Step 1. Classify the job

Set the players, the mode and the market:

- Players: the project's brand and domain (get_project) plus 1 to 4 competitors with their domains. If the domains are not in Lastfind data, ask the person.
- Mode: domain when all players are domains; url when all are URLs competing for the same intent; mixed runs both under one report. If the input is inconsistent, ask.
- Market: the project's country and language, unless the person says otherwise.

Strong: "Target example.com; competitors competitor-a.com and competitor-b.com from compare_brands; domain mode; preset quick; Brazil, Portuguese."
Weak: "Compare example.com with its market." Ask for or confirm the competitor set first.

## Step 2. Plan the cost

Count the paid calls of the chosen preset (players P, keywords K):

- quick: 1 + P.
- domain-full: about 1 + P (M1) + K (M2, K up to 10) + P (M4) + 2P (M5 and M7).
- url-headtohead: about 2 per URL.

Tell the person the plan in one line. Ask before going above 10 paid calls. One search_results call covers all players for that keyword, so M2 costs one call per keyword; above 10 keywords, propose the top 10 by volume instead.

## Step 3. Run the modules in order

1. M0 (free; frames everything else).
2. M1 (its ranked_keywords results feed M3 and M5; never fetch them twice).
3. M3 (reuses M1).
4. M2 (needs a finite keyword universe; read the model reference first).
5. M5, M4, M6 (independent).
6. M7 last (uses M0's semantic branding and any pages read before).

Mark each module complete, partial, blocked or not run, with the reason.

## Step 4. Connect AI answers and search

The report's value in Lastfind is the link between the two worlds. Where data allows, state:

- Who leads AI answers (M0) versus who leads organic results (M1, M2), and where the two disagree.
- Gap keywords (M3) that match the fan-out searches AI engines run for the project's prompts (get_query_fanout): competitors rank where AIs look.
- Which players' pages AI answers cite (list_sources), and which of those pages also rank (M1) or win SERP features and AI Overview sources (M2).
- How each brand describes itself (M7) versus how AI answers describe it (get_semantic_branding).

These are observations to investigate, not causal claims.

## Step 5. Deliver

In chat: who leads AI answers, who leads organic, the two largest gaps, and two next investigations. Save with create_artifact (kind "report"). Sections, in order:

1. Executive summary: one paragraph covering who outperforms whom and where, the largest gaps, and the two investigations that matter most.
2. Players: columns Player, Role (target or competitor), Type (domain or URL), Source (project competitor, person, organic suggestion).
3. One section per module that ran, in module order, with its tables and Observed or Modeled tags. Drop modules that did not run.
4. AI answers versus search: the comparisons from Step 4.
5. Limitations: per module, named, with the reason (not measured, sample size, method).
6. Next actions: investigations and decisions for the person, never promises.

A side-by-side chart fits sections 3 or 4. Shape only, the values are placeholders; fill with measured values and leave out what was not measured:

```chart
{"type":"bar","title":"Share of voice: AI answers vs organic","unit":"%","series":[{"key":"ai","label":"AI answers (observed)"},{"key":"organic","label":"Organic (modeled)"}],"data":[{"x":"target.com","ai":0,"organic":0}]}
```

Use a metrics block for the target's headline numbers in the summary.

## Examples

Strong: "Preset quick. M0: competitor-a leads AI share of voice (observed, last 30 days), strongest in Gemini. M1: competitor-a also has more keywords in the top 10 among returned rows. M3: 12 gap keywords; 4 match fan-out searches for our prompts. Next: check those 4 with search_results and review whether we have a page for each."

Weak: "Invent three plausible competitors, estimate their traffic, and recommend outreach that will win their links." This fabricates the market set and the data and promises outcomes.

## Quality checklist before answering

- Competitor set confirmed; suggestions marked as such.
- Every number traces to a tool result; not measured is never 0.
- AI share of voice (Observed) and organic share of voice (Modeled) never mixed; curve and universe named.
- Each module has a status; limitations name sample sizes and methods.
- Next actions are investigations, not promises.
