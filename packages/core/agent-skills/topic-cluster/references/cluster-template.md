# Topic cluster document

Save the cluster with `create_artifact` (kind `brief`) and refresh it with `update_artifact`. Headings in the person's language. Empty values read "not measured" (pt: "não medido"), never 0 or a guess. Never paste raw tool output.

## Field values

| Field | Allowed values |
|---|---|
| Status of the cluster | draft, active, retired, hypothesis |
| Role | pillar, satellite |
| Page status | planned, drafting, published |
| Action | create, revise, keep, evaluate |
| Intent | informational, comparative, commercial, navigational, not measured |
| Volume source | measured, given by the person, not measured |
| Funnel stage | learn, compare, decide (or the person's own labels) |

Slug: the keyword in lowercase, accents removed, every other character replaced by a hyphen (`seo agêntico` becomes `seo-agentico`). The slug is the page's stable identity: merge refreshes by slug.

Curated fields (never overwrite without showing the change): title, entity, secondary keywords, funnel stage, intent, judgment, action.

## Structure

```markdown
# Topic cluster: <name>

Status: draft. Market: <country>, <language>. Updated on <date>.

## Executive summary
2 to 4 lines: the theme, the pillar, how many satellites, what the evidence says, what the person must decide next.

(fenced metrics block: satellites, keywords with measured volume, pages already published)

## Thesis
2 or 3 lines: why this cluster matters for the brand and its buyers.

## Pillar
| Role | Page (slug) | Title | Keyword | Volume | Volume source | Intent | Funnel stage | Status | Action |
|---|---|---|---|---|---|---|---|---|---|
| pillar | seo-agentico | ... | seo agêntico | 320 | measured | informational | learn | planned | create |

## Satellites
| Role | Page (slug) | Title | Keyword | Secondary keywords | Volume | Volume source | Intent | Funnel stage | Status | Action | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|
(at least 3 rows, except in a hypothesis cluster)

## Stats
Total keywords in the pool, pages published, pages planned.

## AI search coverage (Lastfind)
- Lastfind topic for this theme: name, or "none yet".
- Tracked prompts on this theme: count and examples.
- AI fan-out searches that match cluster pages.
- Pages AI answers cite on this theme, and whether the project's pages are among them.

## Completeness gaps
Subjects buyers ask about (People also ask, fan-out searches, prompts) that no page in the cluster covers.

## Open questions
Decisions that belong to the person.

## Curation changes
Dated list: what changed, old value, new value, why, who decided.

## Limitations
Unmeasured volumes, keywords without results checks, merged pages, hypothesis mode, market caveats.

## Appendix: provenance
Tools used and date of each call, market, pool size, candidates shown, keywords with results checked, curated by (the person, or the agent at the person's request), approved by and date.
```

## Hypothesis cluster

Same structure, status "hypothesis", every volume and intent "not measured", and a first line under the title: "Hypothesis plan: no keyword or Google results evidence was collected at the person's request." It is not applied to Lastfind (Phase 4) unless the person explicitly accepts it as a hypothesis plan.
