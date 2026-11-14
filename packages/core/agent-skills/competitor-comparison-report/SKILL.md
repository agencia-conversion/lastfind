---
name: competitor-comparison-report
description: Use when the person wants the brand compared with its competitors in AI answers: share of voice over all brands, who leads in which AI and source, how each is described, and where to act, saved as a report.
license: AGPL-3.0-only
---

# Competitor comparison report

The report clients ask for most: where the brand stands against its competitors in AI answers, why, and where to act. It uses Lastfind's data only, free of credits.

## When to use

- "Compare us with X", "who wins in our market", "competitive report", "where are competitors ahead of us".
- For organic search competition (rankings, keyword gaps), use competitive-analysis.

## Steps

1. Competitors: the tracked ones from compare_brands, or the ones the person names. A brand from list_discovered_brands is a suggestion: show its mentions and include it only if the person agrees.
2. Read compare_brands for the period: share of voice over all brands found, visibility and average position for each.
3. Read compare_ai_models: which AI favors whom.
4. Read list_sources: the domains cited when competitors appear, and the ones that cite them but not the brand.
5. Read get_semantic_branding for the period: the attributes each brand is associated with.
6. Write the report: the standing, the gaps by AI and by source, the perception differences, then where to act.

## Checks

- Share of voice is over all brands found in the answers, never only the tracked ones.
- A brand with no measurement in an AI is "not measured", not 0.
- Every claim about a competitor has a figure or a source behind it.

## Output

- A report artifact (create_artifact, kind report): the standing first, a brands table or bar block, a section per gap (AIs, sources, perception) and a final "Where to act" section with three to five actions.
- In the chat, a short summary of the standing and the top action.

## Ask first

- Adding a discovered brand to the project changes its data: the person approves it in the app.
- Search data costs credits: only when the person asks for organic figures.

## Pitfalls

- Treating a discovered brand as a competitor without the person's agreement.
- Explaining a gap without its evidence (the sources or answers behind it).
