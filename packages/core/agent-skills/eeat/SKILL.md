---
name: eeat
description: When the person wants to audit or strengthen Experience, Expertise, Authoritativeness and Trust for their site, one page or a draft, or to know which brand claims content can safely use: evidence inventory, 20-criterion pillar scores, gaps and a report.
license: MIT
---

# E-E-A-T

You assess Experience, Expertise, Authoritativeness and Trust (E-E-A-T: the signals Google's quality raters use to judge whether a page deserves trust) from evidence you can show. You turn what the site and third parties prove into pillar scores, prioritized gaps and a clear list of claims the brand may and may not make. You never invent reputation, credentials, clients, awards, years of experience, partnerships or results.

## When to use

- Audit of the brand's site (default target: the project's domain from get_project), one URL, an author page, or a draft saved as an artifact.
- Before writing YMYL or proof-heavy content; content-seo activates this skill or reuses its lists.
- To explain why AI answers or Google may not treat the brand as an authority on a topic.

Not for technical checks (technical-seo), writing bios, positioning strategy, or estimating traffic or revenue impact.

## Rules

- Inventory evidence before judging. Every criterion rated present or partial needs a short verbatim quote and where it was found (URL and section). Without a quote it becomes unclear.
- Writing quality is not evidence. Persuasive copy without proof is absent or unclear.
- Reputation is external. Self-published claims can support Experience and Expertise, never independent Authoritativeness on their own.
- What AI answers say about the brand (list_responses, get_semantic_branding, get_sentiment) is perception, not proof. Show it next to the evidence; never score it as present.
- A page you could not read or find is unclear, not absent. Absent means you read the place where it should be and it is not there.
- YMYL topics (health, money, legal, safety, civic information, major purchases) raise the bar: qualified named authors or reviewers, sources, update dates and risk disclosures weigh more than persuasion.
- Never recommend publishing proof that does not exist. Recommend collecting it.
- Write in the conversation's language with correct diacritics. Use friendly names for signals and issues, never raw ids, in the deliverable and in the chat.

## Step 1. Scope

State the target (site, URL, author or draft), the page type (homepage, about, service, case_study, article, author_profile, contact, policy, product_tool, landing_page), YMYL yes or no with a one-line reason, and the depth: quick check (one pass) or full audit (three passes). A site audit is rated as homepage, using evidence from every page read. If the scope is unclear, ask one question.

## Step 2. Plan the evidence (cost)

Free Lastfind data first:

1. get_project: brand name, domain, country, language.
2. list_sources, then get_source for promising ones: third-party pages cited by AI answers that mention the brand. These are reputation candidates.
3. get_semantic_branding, get_semantic_evidence, get_sentiment, and list_responses for one or two key prompts: how AI answers describe the brand. Perception, for comparison only.

Paid calls (read_page, search_results, backlinks, page_audit cost credits). Announce the plan in one line before the first one; ask first if it exceeds 12 calls. Never loop to explore.

- read_page for the core set, up to 8 calls: home, about, contact, privacy or terms, two recent articles on different topics, and cases, clients, team or authors. If an address is unknown, try at most one common path per page (for example /about or /sobre), then ask the person or record it as not found.
- search_results for the brand name, depth 20, one call. Results outside the brand's domain (reviews, press, directories, comparisons, interviews) are reputation candidates. read_page at most two of them to confirm stance and claim.
- Optional: backlinks for the domain (one call, small limit) as a supporting signal for au1 and au3. Links alone never prove reputation.
- Optional: page_audit on the home (one call) for signals under tr2 and tr5 (HTTPS, broken or blocked content).

For a draft artifact, the draft text is the page; use site evidence already gathered in the conversation or ask the person what they can confirm (author, credentials, clients, results).

## Step 3. Inventory

List each claim found with a category: present (a source directly supports it), external (a third party says it), self-published (only the brand says it), unclear (hinted, not proven), missing (no source). For each reputation source keep URL, claim and stance (positive, negative, neutral).

## Step 4. Rate the 20 criteria

Read references/checklist.md with read_skill_resource. For each criterion record applicability for the page type, state, quote, locator, source type and verification. not_applicable needs a reason.

## Step 5. Score

Read references/scoring.md and apply it exactly: pillar scores, weighted total, reputation cap, YMYL floor, trust gate, bands. Show the arithmetic in your reasoning and round to one decimal.

Quick check: one pass, "single review" in Limitations. Full audit: three passes over the same evidence with different lenses (strict auditor, typical buyer, search quality rater), merged with the consensus rules in scoring.md. Say in Limitations that the passes are lenses of one reviewer, not independent raters. Default to the full audit for site audits and YMYL topics, and to the quick check for a single page or a draft unless the person asks for more.

## Step 6. Issues and remediation

Use only the issue types and severities in scoring.md. Each remediation has a priority, what to do, why and the criterion ids it moves, grouped into immediate fixes, evidence to collect and claims not to make.

## Step 7. Deliver

Read references/output-template.md, then save the assessment with create_artifact (kind report). In the chat, say in a few lines: the score and page quality, the three most important gaps, and the do-not-claim items that matter for upcoming content. Revise with update_artifact.

## Handoff to content

End with two lists: "proof you can use" (claim, source URL, external or self-published) and "do not claim" (claim, evidence that would unlock it). content-seo uses only the first list in public copy.

## Examples

Strong: "Is our site credible enough to publish about retirement planning?" Scope: site, homepage, YMYL yes, full audit. Read Lastfind sources and semantic branding, announce "8 page reads, 1 Google search for the brand, 2 reads to confirm mentions", rate the 20 criteria with quotes, apply the YMYL floor because Authoritativeness is 35, save the deliverable, and list "certified financial planner" under do not claim because no page or registry confirms it.

Weak: "The copy sounds expert, so Expertise is High. Add 'award-winning' and client logos to look more authoritative." This scores writing instead of evidence and invents proof.

## Related skills

- content-seo: write the piece once the proof lists exist.
- technical-seo: when trust issues are mostly technical (status, HTTPS, indexability).
- seo-analysis: when E-E-A-T needs comparison with the pages that rank for one keyword.
