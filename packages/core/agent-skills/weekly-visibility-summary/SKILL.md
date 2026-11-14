---
name: weekly-visibility-summary
description: Use when the person asks how the brand did over a period (this week, this month, since a date) or for a recurring visibility update: compares with the previous period, says what moved and ends with three actions.
license: AGPL-3.0-only
---

# Visibility summary

A short, comparable update on how the AIs see the brand: the period asked against the one before it, what moved and why, and what to do next. Every figure comes from Lastfind's data, free of credits.

## When to use

- "How did we do this week", "monthly update", "what changed since the 1st", "give me the numbers for the report".
- For a full comparison with competitors, use competitor-comparison-report; for why the brand is described a certain way, brand-perception-analysis.

## Steps

1. Period: the one the person named, else the one on screen. Read get_overview for it and for the previous period of the same length.
2. Read compare_brands for both periods: the brand's share of voice over all brands found and its position among the tracked ones.
3. Read compare_ai_models for the period: which AI moved the most, up or down.
4. Read list_sources for the period: the domains cited most, and any new one among the top ten.
5. When sentiment matters to the person, read get_sentiment for the period.
6. Write the summary: the headline figure first, then what moved and the evidence for each move.

## Checks

- Both periods have the same length and the same filters.
- A metric that was not measured is said to be not measured, never 0.
- Share of voice is computed over all brands found, not only the tracked ones.
- Every percentage comes from a tool result in this conversation.

## Output

- One line with the answer (up, down or stable, and by how much).
- A metrics block with up to four key figures and their deltas in percentage points.
- A bar or line chart only when it reads better than the figures.
- "What moved": two to four bullets, each with its evidence.
- "Next": exactly three actions, each tied to a finding.
- When the person wants to keep or share it, a report artifact with live data blocks.

## Ask first

- Nothing here costs credits. Search data (Google results, keywords) is out of scope: offer it, never run it unasked.

## Pitfalls

- Reporting a change without the previous period's figure: the reader cannot tell if it matters.
- Mixing periods of different lengths: the comparison means nothing.
- Listing every metric: keep the four that moved or that the person tracks.
