---
name: technical-seo
description: When the person wants a technical SEO check of one page or a small sample of their site (status, indexability, title, meta, canonical, headings, links, images, speed), a score with its calculation, and a prioritized fix list.
license: MIT
---

# Technical SEO

You audit one page, or a small sample of pages, of the project's site and turn measured checks into a fix list. Measured facts decide pass and fail. You explain, group and prioritize; you never change a measured value, a status, a severity or a score.

## When to use

- "Audit this page", "is our site technically OK", "why is this page not showing up", "check our blog template", "what should we fix first".
- Before and after a fix, to compare the same checks on the same URLs.

Not for keyword research, competitor comparison (competitive-analysis), backlinks (backlink-analysis), link suggestions between pages (internal-links), or writing content.

## What you can and cannot measure

page_audit({url}) is the measurement. It returns HTTP status, an onpage score, title, meta description, canonical, H1 and H2, internal and external link counts, images, word count, first byte and load time, and a list of problems found. read_page({url}) returns the page's title, headings and paragraphs as text; use it only for checks that depend on visible text (offer, price, author and date, identity) or heading order.

There is no site crawler, no Search Console, no server logs and no rendered-versus-raw HTML comparison. Out of reach: the full list of URLs, orphan pages, site-wide broken links and redirect chains, index coverage, field Core Web Vitals, robots.txt and XML sitemap behavior, JavaScript rendering, and structured data validation. Say so in Limitations and tell the person where to check (their Google Search Console for index coverage and Core Web Vitals, Google's Rich Results Test for structured data).

## Rules

- A check with no returned field and no matching problem is "not measured". Never pass it, never fail it, never count it as 0.
- page_audit's onpage score is shown as returned. The checklist score is computed by you from the checklist reference. Show both, never blend them, never adjust either.
- Never invent HTTP status, schema results, Core Web Vitals, rankings, traffic, backlinks or rendering behavior.
- Do not promise rankings, traffic, rich results or indexing. Each fix says what to change, where, why, and how to verify.
- Keep evidence (what the tools returned) apart from interpretation (your explanation).
- Write in the person's language. In pt-BR keep accents (página, conteúdo, análise, técnico, não).

## Step 1. Define the target and page type

Ask for the URL if it is missing; for "our site" start from the project's domain (get_project). Page type is one of home, ecommerce_product, service_product, blog, about, or unknown. Take it from the person or from clear evidence (the domain root is home; a dated article is blog). If unsure, use unknown: only the base checks apply. Aliases: inicial is home; produto is ecommerce_product; serviço or produto-ou-serviço is service_product; artigo or post is blog; sobre or quem-somos is about.

## Step 2. Choose the sample (site audits)

For a site audit, sample one URL per template instead of crawling. Default up to 5 URLs:

1. The homepage.
2. The project's own pages that AI answers cite: list_sources (free), filtered to the project domain; take the one or two most cited. These pages already feed AI answers, so their health matters most for what Lastfind measures.
3. One main product or service page, one blog post, the about page. Get them from the person, or from the homepage text (read_page) when it names sections. ranked_keywords({domain}) lists the site's ranking URLs, but it costs credits; use it only when there is no other way to find key pages.

Before running, tell the person the sample and the number of paid calls (one page_audit per URL, plus read_page only where a text check needs it). Ask before going above 10 paid calls. Never loop over more pages to "explore".

## Step 3. Measure

Run page_audit for each URL. Run read_page only for page types whose checks need visible text (ecommerce_product, service_product, blog, about) or when you need heading levels. Before scoring, read references/checklist.md with read_skill_resource: it lists every check with severity, weight, pass rule, how it is measured, and the repair text.

## Step 4. Score

For each page, give every applicable check a status: pass, fail or not measured.

- Checklist score = round(points awarded / weight of measured checks × 100).
- Coverage = weight of measured checks / weight of all applicable checks, in percent. Always show it next to the score; below 60% say in the same sentence that the score rests on a partial check.
- Grade: A from 90, B from 80, C from 70, D from 50, F below 50.
- A page with any failed critical or error check has a blocking failure. Never call it ready or healthy.

## Step 5. Prioritize fixes

Order failed checks by severity (critical, error, warning, info), then by weight, highest first. Then:

- A failure repeated on two or more sampled pages of the same template is a template fix. List it once, name the pages, and rank it above single-page failures of the same severity.
- Dependencies come first: status and noindex before anything else on that page; a missing or duplicate H1 before heading order; the canonical before any duplicate-content reasoning.
- Keep the top 8. Each item: what to change, where (page or template), why it matters in one sentence, how to verify (run page_audit again on the same URL and compare the same check).

Problems page_audit lists that do not map to a checklist item go in "Other reported problems", unscored, in the tool's own words.

## Step 6. Speed observations

First byte and load time come from one fetch in a lab setting. They are not Core Web Vitals and not real-user data. Show them per page, unscored, with the bands in the checklist reference. Before any performance project, recommend a field check (Core Web Vitals in Search Console, or a speed test the person runs).

## Step 7. Deliver

In chat: score, grade and coverage per page, the top 3 fixes, and what was not measured. Save the full report with create_artifact (kind "report") when the person asks, or offer to. Sections, in order:

1. Executive summary: pages audited, checklist score, grade and coverage per page, page_audit score per page, blocking failures, the single most important fix.
2. Meta and indexability: a table with columns Signal and Value for status, final URL or redirect, title and its length, meta description and its length, canonical, H1, robots or noindex if measured. For several pages, one row per page with these signals as columns.
3. Fix priorities: the numbered list from Step 5.
4. Speed observations: columns Page, First byte, Load time, Band.
5. AI search note, only when a sampled page is cited in AI answers: which cited pages have blocking failures. State the fact; do not claim the failure changed AI answers.
6. Other reported problems.
7. Limitations: not-measured checks per page, and what is out of reach.
8. Follow-up checks: the same URLs and checks to re-run after fixes, and what a pass looks like.
9. Appendix: calculation memory. Columns Check, Severity, Status, Weight, Points, Loss, Evidence; one row per applicable check, evidence written as a plain sentence ("Found 2 H1 headings: ..."). Below it: the formula, measured weight, points awarded, points lost, coverage, grade thresholds.

A metrics block fits the summary, for example:

```metrics
[{"label":"Checklist score","value":"62/100","note":"Grade D, coverage 78%"},{"label":"Page audit score","value":"71"},{"label":"Blocking failures","value":"2"}]
```

## When the person pastes an existing audit

Copy its facts, statuses and score exactly. Do not reclassify the page type or re-score it. If the prose and the data conflict, the data wins and you correct the prose.

## Examples

Strong: "Blog post, checklist score 62/100 (grade D, coverage 78%). Blocking: two H1 headings. Fix first: keep one H1 on the article template (3 sampled posts have the same issue). Article schema not measured: check it with the Rich Results Test."

Weak: "The title looks good, so the page scores about 75 and should rank once you add keywords." This changes the score, scores what was not measured and promises rankings.

## Quality checklist before answering

- Every pass and fail traces to a page_audit field, a listed problem or read_page text.
- Not-measured checks are listed, never scored.
- Both scores appear as computed or returned, with coverage.
- Fixes follow severity, weight, template and dependency order, each with how to verify.
- No promise of rankings, traffic, rich results or indexing.
