---
name: internal-links
description: When the person wants internal link suggestions for their own site: which existing pages should link to a page (or where a page should link out), with exact anchors and before/after paragraphs, checked before they review and apply them.
license: MIT
---

# Internal links

You find same-site contextual link opportunities and present them as review-ready edits: source page, target page, anchor text, the exact paragraph before, and the same paragraph with one link added. You cannot edit the site. The person applies approved edits in their CMS.

## When to use

- "Which pages should link to this page", "add internal links to this article", "improve our anchors", "help this page get found".
- Strengthening a page that answers a buyer question Lastfind tracks.

Not for writing new pages, technical audits (technical-seo), backlinks from other sites (backlink-analysis) or competitor research (competitive-analysis).

## Rules

- Every recommendation passes the deterministic checks in references/checks.md (read it with read_skill_resource before validating). A candidate that fails any check goes to Blocked candidates with its reason.
- Same-site only, no self-links, no duplicate source-target pair, no generic anchors, exact before and after text, the link-removed test.
- The existing-link check is limited: read_page returns text, not the page's link list, and page_audit returns only link counts. When you cannot see whether the source already links to the target, mark that check "not verified" on the recommendation and say so. Never mark it passed.
- Checks and judgment stay apart. Judgment (semantic fit, reader value, confidence) never overrides a failed check.
- Never invent search volume, traffic, backlinks, authority or business priority. Do not promise rankings, traffic or conversions.
- Keep the source page's language. In pt-BR keep accents in anchors and text (página, conteúdo, análise, não).

## Step 1. Scope and direction

Confirm the site (the project's domain from get_project), the target page and the direction:

- Inbound: find source pages that should link to the target.
- Outbound: find target pages a given source page should link to.
- If the direction is missing, do both and label each recommendation.

Default limit: 10 recommendations. The topic is the target page's main subject: its H1 from read_page, or the person's words.

If the person has no target in mind, propose candidates from Lastfind data and let them choose:

- The project's own pages that AI answers cite (list_sources, free), which are already working for them.
- The page that should answer a tracked prompt where the brand is missing or weak (list_prompts, get_prompt). The fan-out searches for that prompt (get_query_fanout) show how AI engines phrase the topic, which helps pick the target and judge topical fit, but anchors still come from the source page's own wording.

## Step 2. Discover candidates

Go cheapest first and record the discovery method for every candidate:

1. URLs the person gives.
2. Project-domain pages in list_sources (free).
3. read_page of the homepage, a blog index or a hub page, whose headings and text name sections and articles (paid, one call).
4. ranked_keywords({domain: project domain, limit 100}): pages ranking for keywords close to the topic are candidate sources; the page ranking for the topic itself is the natural target (paid, one call).
5. search_results({keyword: "site:<domain> <topic>", depth 10}). If any result is off the domain, the operator was not applied; discard those results (paid).

Discovery only nominates candidates. A candidate becomes a recommendation only after validation, context review and the checks.

## Step 3. Validate with a funnel

Spend credits only on candidates that can still pass:

1. page_audit the target once. It must be 2xx and indexable when measured. If it redirects, use the final URL. If its canonical points to another URL, link to the canonical URL instead.
2. read_page each candidate source (default up to 8). Find paragraphs that mention the topic (matching rules in references/checks.md). No match: block as weak_context. Fetch failed: block as fetch_failed.
3. page_audit only the sources you are about to recommend, to confirm 2xx HTML.

Before starting, tell the person the plan and the number of paid calls. Ask before going above 15. Stop once you have enough strong recommendations.

## Step 4. Choose context and anchor

- Use the smallest exact block that gives enough context, usually one paragraph or list item, copied verbatim from read_page.
- Prefer existing wording as the anchor. If a minimal edit is needed for a natural anchor, change as little as possible and keep spelling, punctuation, capitalization and diacritics.
- The anchor must describe the target and make sense out of context. When several sources link to the same target, vary anchors where the text allows; do not force the same keyword everywhere.
- Body text only. Skip navigation, footer, sidebar, author box, tag lists and related-post lists (lines that repeat across pages are usually these), unless the person asks for structural links.
- If the source already links to the target with a generic anchor and you can see it, propose an anchor improvement instead of a new link.
- If the best target does not exist yet, list it under Missing pages with the topic and the reason (for example, a tracked prompt no page answers). Never link to a page that does not exist.

## Step 5. Judge

For each recommendation rate semantic fit, reader value and confidence as high, medium or low, with one sentence of reason ("the paragraph introduces the concept the target explains"). Low confidence stays in the list with status needs_review and the reason.

## Step 6. Deliver

In chat: number of recommendations, the top 3, number blocked, and the existing-link caveat if it applies. Save with create_artifact (kind "table" for the review list alone, "report" when it includes discovery and limitations). Sections:

1. Executive summary: site, target, direction, discovery methods, recommendations, blocked candidates.
2. Recommendations: columns ID, Source, Target, Anchor, Before, After, Checks, Fit, Status, Action. Before is the verbatim paragraph; After is the same paragraph with the link as Markdown [anchor](url). Checks lists failures and any "not verified". Status starts as needs_review.
3. Blocked candidates: columns Source, Target, Reason, Evidence.
4. Missing pages: topic, why it would help, what links to it once it exists.
5. Limitations: discovery was a sample, not a crawl; existing links not verified where applicable; pages not fetched.
6. Next actions: review, apply in the CMS, then confirm.

Review loop: when the person approves or rejects IDs in the chat, update the artifact with update_artifact, setting status to selected or rejected. Set applied only when the person says the edit is live. You may then read_page the source to confirm the anchor text is present.

## Examples

Strong: "Target /seo-agentico/ (200, indexable). Source /blog/ia-para-seo/ (200) has the paragraph 'Com SEO agêntico, a equipe automatiza a pesquisa...'. After: 'Com [SEO agêntico](https://example.com/seo-agentico/), a equipe automatiza a pesquisa...'. Existing link: not verified. Fit high. Status needs_review."

Weak: "Add 'Leia mais: SEO agentico' at the end of five posts, including /blog/post-antigo/." This uses a generic anchor, drops the accent, appends text instead of using context and includes a page that returns 404.

## Quality checklist before answering

- Every recommendation has verbatim before text and an after text that differs only by one link.
- Source and target status confirmed with page_audit; failures moved to Blocked with a reason.
- No self-link, no duplicate pair, no generic anchor, no cross-site target.
- Existing-link check shown as passed only when you could see the links.
- Accents and wording of the source language preserved.
