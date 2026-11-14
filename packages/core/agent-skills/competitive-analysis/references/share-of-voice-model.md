# Organic share of voice model

Everything here is Modeled. Tag every number from these formulas "Modeled" and name the curve ("reference CTR curve, clean results page") and whether the AI Overview adjustment was applied.

## Reference CTR curve (page one, clean results page)

Public industry averages of organic click-through rate by position, captured May 2026. Positions 11 and beyond count as 0: the curve covers page one only.

| Position | CTR % | CTR % with AI Overview present |
|---|---|---|
| 1 | 39.8 | 16.72 |
| 2 | 18.7 | 9.20 |
| 3 | 10.2 | 5.47 |
| 4 | 7.2 | 4.41 |
| 5 | 5.1 | 3.44 |
| 6 | 4.4 | not adjusted |
| 7 | 3.0 | not adjusted |
| 8 | 2.1 | not adjusted |
| 9 | 1.9 | not adjusted |
| 10 | 1.6 | not adjusted |

The adjusted column applies published average CTR losses when an AI Overview appears (position 1: minus 58.0%, 2: minus 50.8%, 3: minus 46.4%, 4: minus 38.8%, 5: minus 32.6%). For positions 6 to 10 only a band was published (minus 19.4% to minus 30.5%), so they stay unadjusted; say so instead of interpolating.

Caveats to state once in the report:

- Clean-page averages; results with featured snippets or local packs diverge.
- Position 1 is optimistic.
- The AI Overview losses were measured on informational queries; on commercial or transactional keywords they likely overstate the loss.
- The combination is an approximation, not an observation of clicks.

## When to apply the AI Overview adjustment

Count the keywords in the universe whose search_results show an AI Overview. If that is at least 10% of the universe, use the adjusted column for those keywords only. Below 10%, use the clean curve everywhere and note the decision.

## Keyword universe

The universe must be finite and named. In order of preference:

1. The person's keyword list.
2. Keywords built from the project's Lastfind topics and prompts, confirmed by the person, with volumes from keyword_volume (one call for up to 100 keywords).
3. The union of the players' ranked_keywords results from M1 (no extra calls). Approximate: a player's position is known only for keywords in its own returned list (top 100). Count unknown positions as no visibility and label the result "approximate, from returned ranked keywords".

Positions for options 1 and 2 come from search_results (one call per keyword, depth 20, covers every player at once). Cap at 10 keywords unless the person agrees to more. Deduplicate exact strings. If deduplication removed more than 5% of the list, say so.

## Formulas

Let K be the universe, vol(k) the search volume, pos(p, k) the position of player p for keyword k.

- visibility(p, k) = CTR(pos(p, k)) / 100 when pos is 1 to 10, else 0.
- Keywords with no volume are excluded from the weights and listed as "keywords without volume".
- Modeled clicks(p) = sum over k of vol(k) × visibility(p, k).
- Share of voice(p) = modeled clicks(p) / sum over all compared players of modeled clicks, in percent. This is a share among the compared players, not of the whole market; say so.
- If no keyword has volume, share of voice is not measured (never divide by 0).

Also report per player: keywords in the top 3, keywords in the top 10, among the universe.

Columns: Player, Keywords in top 3, Keywords in top 10, Modeled clicks [Modeled], Share of voice % [Modeled].

## SERP features (from search_results)

For each feature (AI Overview sources, featured snippet, People also ask, video, images, local pack, shopping, sitelinks), count the keywords where a player's domain appears inside that feature. Columns: Feature, then one column per player, plus up to 3 sample keywords. AI Overview sources here are a Google search observation; compare them with Lastfind's AI Overviews and AI Mode data in M0 rather than merging the two.

## Keyword gap

From the M1 ranked_keywords results (never fetched twice):

- Gap: a keyword where at least one competitor is in the top 20 and the target is not in its returned list (or ranks below 100).
- Sort by volume (high first), then by the number of competitors in the top 20, then alphabetical.
- Intent: only when the tool returns it or the SERP features make it unambiguous; otherwise unknown.
- Merge spelling variants with the same intent into one row and show "(+N variants)".

Columns: Keyword, Volume, Target position (or not in returned list), Competitors and their positions, Intent, Matches AI fan-out (yes or no).

Universe note: the union of every player's returned top-20 keywords. Show its size and how many rows survive the gap filter.

## Striking distance

- Keywords where the target ranks 4 to 20.
- CTR uplift (points) = CTR(1) minus CTR(current position), with CTR 0 beyond 10. Uses the same curve and adjustment as above.
- Opportunity score = volume × uplift / 100.
- Sort by opportunity score, high first. Tag Modeled. If the target already holds the top 3 for most keywords, a short list is the right answer; do not pad it.

Columns: Keyword, Volume, Current position, CTR uplift [Modeled], Opportunity score [Modeled].

## Anti-patterns

- Presenting modeled clicks as observed clicks.
- Share of voice over an unbounded "whole market".
- Applying the AI Overview loss to commercial keywords without the caveat.
- Reading a missing position as position 0 or as "ranks nowhere" without the returned-list caveat.
