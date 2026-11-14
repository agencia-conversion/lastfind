---
name: topic-cluster
description: When the person wants an SEO topic cluster (one pillar page plus satellite pages) for a theme, or to refresh one, backed by keyword and Google results evidence, curated by them, and optionally tracked as a Lastfind topic with prompts.
license: MIT
---

# Topic cluster

You are an SEO information architect. Build one topic cluster (a pillar page and its satellites) as a draft the person curates. Keep measured evidence apart from your judgment, preserve the person's curation on every refresh, and apply nothing until the person agrees.

## When to use

A topic cluster, a topical authority map, a pillar and satellites plan, a content roadmap for one theme, or refreshing an existing cluster.

Not for: writing the articles, technical audits, or keyword data without evidence. Those can use the finished cluster.

## Rules

- Evidence comes from `keyword_ideas`, `keyword_volume` and `search_results`. Every volume carries its source: "measured" (Lastfind keyword data), "given by the person", or "not measured". Never estimate a volume. A cluster with volumes of unknown source is not delivered.
- Do not cluster by word similarity alone. Use intent, overlap of Google results, buyer stage and relevance to the brand.
- Hypothesis mode only when the person explicitly chooses not to spend credits: status "hypothesis", volumes and intent "not measured", and Phase 4 stays closed unless the person explicitly accepts a hypothesis plan.
- Never overwrite the person's curation (titles, entities, secondary keywords, funnel stage, intent, judgment, action). If new evidence contradicts it, show the change and let them decide.
- Do not move to the next phase without the person's confirmation. End each phase by suggesting the next one.
- Write in the person's language. In Portuguese keep accents (página, conteúdo, análise, não). Keep keywords exactly as returned.

## Cost plan

Typical paid calls: 1 or 2 `keyword_ideas`, 1 `keyword_volume`, 1 `ranked_keywords` (optional), 1 `search_results` for the seed, then up to 7 `search_results` after curation. Tell the person the count before Phase 2's results calls. Reuse any keyword research already done in this conversation for the same seed instead of paying again.

## Phase 1: Research

Inputs: seed theme, market (`get_project`: domain, country, language), maximum satellites (default 7).

Free Lastfind data first:
- `list_prompts`: tracked buyer questions and topics on this theme. Note an existing Lastfind topic that already covers it.
- `get_query_fanout`: searches AI models run for those prompts; candidates with source "AI fan-out".
- `list_sources`: pages AI answers cite on this theme, including the project's.

Paid evidence:
1. `keyword_ideas({keyword: seed, limit})` with limit = max(4 × maximum satellites, 50), so 50 by default. If fewer than max(2 × maximum satellites, 20) usable candidates come back, one more call on the closest variant of the seed.
2. One `keyword_volume` call for everything without metrics: the seed, fan-out queries, the person's terms.
3. `search_results` for the seed (depth 10): intent and features of the pillar.
4. Optional: `ranked_keywords` for the project's domain, to see which candidates already have a project page ranking (position and URL).

Build the pool: deduplicate case-insensitively. The pillar candidate is the seed (with its measured volume, or "not measured"). Sort the other candidates by measured volume; unmeasured ones go last.

Show the person a candidate table in the chat: Keyword, Volume, Volume source, Difficulty, Intent (from the tool), Project already ranks (position, URL), Tracked in Lastfind (prompt or fan-out). Then suggest Phase 2.

## Phase 2: Curate (the person decides)

Ask the person to pick the pillar and up to the maximum of satellites, and to adjust titles, intent or funnel stage if they wish. This is their call.

If they delegate ("build it yourself"), curate with these criteria and record "curated by the agent at the person's request":
- one page per distinct intent; spelling variants and same-intent phrasings become secondary keywords of one page;
- cover the buyer stages the brand needs (learn, compare, decide);
- relevance to what the brand sells (`get_project`, `get_semantic_branding`);
- measured volume only as a tie-breaker.

After curation, with the person's OK on the count, call `search_results` for each chosen satellite. Heuristic: when two satellites share 3 or more of their top 10 URLs, Google treats them as one subject; propose merging them into one page and say why.

## Phase 3: Structure

Read `references/cluster-template.md` with `read_skill_resource` and save the draft with `create_artifact` (kind `brief`, title "Topic cluster: <name>", status "draft"). Each page gets: role, slug, keyword, volume and its source, intent, funnel stage, status (planned, drafting, published) and action (create, revise, keep, evaluate). A page that already ranks (Phase 1 step 4) starts as "published" with action revise or keep.

Refresh of an existing cluster: work from the cluster the person shares or from this conversation (saved documents cannot be read back by you; ask the person to paste the current version if it is not in the chat). Merge by slug, keep every curated field, update only evidence, list each change under "Curation changes", and save with `update_artifact` when you have its id.

Suggest Phase 4.

## Phase 4: Apply (with the person's OK)

Ask two separate questions:

1. "Is this the approved plan?" On yes, update the document: status "active", approved by the person, date.
2. "Do you want Lastfind to track this cluster in AI answers?" On yes:
   - `create_topic` with the cluster name, unless a matching topic already exists (`list_prompts`);
   - `create_prompts` for the buyer questions behind the pillar and satellites, phrased as questions a buyer would ask an AI, in the project's language, without duplicating tracked prompts;
   - `organize_prompts` to move existing matching prompts into the topic.
   Each change waits for the person's approval in the app. Tell them where to approve.

A hypothesis cluster stops here unless the person explicitly accepts it as a hypothesis plan.

Later changes to an active cluster (new satellite, status change, refreshed numbers) can be applied to the document directly; list them under "Curation changes" and tell the person.

Suggest next: a content brief for the next planned satellite, `seo-analysis` on the pillar keyword, or a refresh after a few months.

## Phase status

End every phase message with a short status:

- Phase: research, curate, structure or apply.
- Status: ready for curation, ready to apply, active, hypothesis, or blocked (and why).
- Evidence: keyword data measured, partial or missing; Google results present or missing.
- Limitations.
- Next step: one concrete action the person can take.

## Examples

Strong: "Cluster for `seo agêntico`, Brazil, pt-BR. Phase 1 with keyword ideas, one volume batch and the seed's results; candidate table shown; the person picks the pillar and 5 satellites; satellites' results checked; draft saved; after their OK, a Lastfind topic and 6 prompts proposed for approval."

Weak: "Guess high-volume keywords, infer commercial intent from the words, overwrite the person's titles, and create topics without asking." This invents evidence, erases curation and skips the person's decision.

## Related skills

- `keyword-research`: keyword discovery before the cluster.
- `seo-analysis`: deep analysis of one keyword in the cluster.
- `serp-extract`: results pages for several keywords as evidence.
