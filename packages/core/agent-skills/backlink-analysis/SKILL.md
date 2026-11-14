---
name: backlink-analysis
description: When the person wants to understand their backlinks or a competitor's: referring domains, anchors, link quality and spam risk, link gaps and overlaps with competitors, and which domains cited in AI answers link to them or not.
license: MIT
---

# Backlink analysis

You produce one evidence-backed backlink profile for one target (the project's domain, a competitor's domain, or a single URL), optionally compared with 1 to 4 competitors. You describe what the data shows and what to investigate next. You never turn link data into outreach promises.

## When to use

- "How many backlinks do we have", "who links to us", "are our links risky", "who links to competitors but not to us", "compare our link profile with X".
- Off-page evidence for a competitive report (competitive-analysis shows only the summary and points here for depth).

Not for keyword or content gaps (competitive-analysis), technical page checks (technical-seo), or links inside the site (internal-links).

## Rules

- Backlink data comes only from the backlinks tool. Never substitute guesses, search results or a brand's reputation for counts.
- A metric the tool did not return is "not measured", never 0. A 0 the tool returned stays 0.
- Never invent backlink or referring-domain counts, rank, spam score, anchors, first-seen dates, gap or overlap rows, traffic or brand mentions.
- Competitors come from the person or from the project's tracked competitors (compare_brands). Never add a market set from memory. If a requested competitor could not be measured, mark its fields not measured and say so.
- Spam score, sitewide patterns, irrelevant directories and over-optimized anchors are risks to review, not proof of a penalty. Never recommend a disavow as a decision; recommend a review.
- Never promise links, rankings, authority or traffic. Next actions are investigation, qualification, cleanup review, content support or digital PR planning.
- Write in the person's language; keep brand names exactly as written, accents included.

## Modes

- single: one target, no competitors. Summary, top referring domains, top anchors, sample backlinks, quality and risk notes.
- multi-competitor: target plus 1 to 4 competitors of the same type (all domains or all URLs). Adds link gap, link overlap, anchor comparison, quality mix, and, for URLs, the page-level gap. Read references/multi-competitor.md with read_skill_resource before computing these.

The mode follows the input: one or more competitors means multi-competitor.

## Step 1. Define the job

Confirm the target (default: the project's domain from get_project), domain or URL, and the competitors. For multi-competitor without names, offer the project's competitors from compare_brands and ask the person to pick up to 4 and confirm their domains. Ask for one or two focus keywords only if the person wants exact-match anchor analysis; the brand names come from the project (get_project, compare_brands).

## Step 2. Plan paid calls

Each backlinks call costs credits. Default plan:

- Target: summary, referring_domains (limit 50), anchors (limit 50), backlinks (limit 20). Four calls.
- Each competitor: summary, referring_domains (limit 100), anchors (limit 50). Three calls. Raise the target's referring_domains to limit 100 in this mode so the lists compare like for like.

Tell the person the number of calls before running. Ask before going above 10. Never page through more rows to explore.

## Step 3. Collect free AI-search context

Before or alongside the paid calls, read Lastfind's own data (free):

- list_sources and get_source_types: the domains and pages AI answers cite for this project's prompts, and their types.
- get_source on the top cited sources when you need to know which brands a cited page mentions.

This lets you mark which referring domains are also cited by AI answers, and which AI-cited domains do not link to the target.

## Step 4. Normalize per player

Give every player the same row: backlinks, referring domains, rank, spam score, broken backlinks (from summary), top referring domains, top anchors, sample backlinks (target only). Fill only with returned values. List missing metrics per player as not measured. Rank is the backlinks tool's own rank value; call it "rank", not "domain authority".

## Step 5. Compute the comparisons (multi-competitor)

Follow references/multi-competitor.md exactly. Key limits to state in the report:

- Gap and overlap come from comparing each player's returned top referring domains (up to 100 each), not the full lists. "Not in the target's returned list" is not proof the domain never links to the target.
- New and lost links over time are not available. Do not estimate link velocity.

## Step 6. Assess quality and risk

Per player: spam score buckets, categories when returned, sitewide or directory patterns visible in the samples, and anchor mix. Each risk names the field that triggered it ("spam score 45 on 6 of the top 50 referring domains"). Compare against competitors before calling something unusual.

## Step 7. Deliver

In chat: the headline numbers, the two or three most useful findings, and what was not measured. Save with create_artifact (kind "report"). Sections, in order:

1. Executive summary: target, mode, competitors, the main finding in two or three sentences.
2. Key numbers: a metrics block for the target (backlinks, referring domains, rank, spam score, broken backlinks).
3. Comparison (multi-competitor): columns Player, Backlinks, Referring domains, Backlinks per referring domain, Rank, Spam score, Broken backlinks. A bar chart of referring domains per player fits here.
4. Top referring domains: columns Domain, Rank, Backlinks, Spam score, Cited in AI answers.
5. Anchors: top anchors and the bucket distribution per player.
6. Sample backlinks (target): columns Source page, Target page, Anchor, Follow or nofollow (when returned).
7. Link gap, link overlap, quality mix, page-level gap (multi-competitor), as defined in the reference.
8. AI-cited sources and links: AI-cited domains that link to the target, that link only to competitors, and that link to no measured player.
9. Risks: each with the field and value behind it.
10. Limitations: sample sizes (top N rows), not-measured metrics, unmeasured competitors, no velocity data.
11. Next actions: investigations and reviews only.

Chart shape:

```chart
{"type":"bar","title":"Referring domains by player","unit":"domains","series":[{"key":"rd","label":"Referring domains"}],"data":[{"x":"target.com","rd":0},{"x":"competitor.com","rd":0}]}
```

The values above are placeholders. Fill them only from summary results; leave a player out of the chart, and say so, when its count was not measured.

## Examples

Strong: "Multi-competitor, target example.com vs competitor-a.com and competitor-b.com. Referring domains: 120, 250, 95 (summary). Link gap among returned top 100 lists: 14 domains link to both competitors and not to the target; 3 of them are cited in AI answers for this project. Velocity not available."

Weak: "Competitor A has much stronger authority because it is a known brand; replicate its links and traffic will grow." This uses reputation instead of data and promises outcomes.

## Quality checklist before answering

- Every number traces to a backlinks result or a Lastfind source result.
- Not-measured fields are marked, never shown as 0.
- Gap and overlap carry the "returned top N" caveat.
- Risks cite the field behind them and are framed as review items.
- No promise of links, rankings, authority or traffic.
