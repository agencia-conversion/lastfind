# CTR curves: modeled clicks by Google position

Use these curves to turn a measured search volume and a measured position into modeled clicks. Every number they produce is modeled, not observed: label it "modeled" in tables and charts, and name the curve and its date next to it.

## Rules

1. Positions 1 to 10 only. Beyond position 10 the modeled CTR is 0.
2. No interpolation. A value the study did not publish stays unpublished; say so instead of filling it.
3. Volume "not measured" means clicks "not modeled". Never use 0 or a guess for the volume.
4. Real click data (for example Google Search Console) is out of reach in Lastfind. If the person has it, their numbers win over any curve; ask them to share them in the chat.
5. Choose the curve once per report and use the same one for every keyword and player in it.

## Which curve

1. Primary: FirstPageSage 2026 (clean SERP). Use it by default.
2. Sanity check: Backlinko December 2024. Mention it only to show the spread between studies.
3. Historical: Sistrix 2020. Comparisons only, never as the active curve.

When `search_results` shows an AI Overview for the keyword, apply the AI Overview delta to the primary curve (next section).

## Table (CTR in %)

| Position | Primary: FirstPageSage 2026 | Backlinko 2024 | Sistrix 2020 | AI Overview delta | Primary with AI Overview |
|---|---|---|---|---|---|
| 1 | 39.8 | 27.6 | 28.5 | −58.0% | 16.72 |
| 2 | 18.7 | 15.8 | 15.7 | −50.8% | 9.20 |
| 3 | 10.2 | 11.0 | 11.0 | −46.4% | 5.47 |
| 4 | 7.2 | 8.4 | 8.0 | −38.8% | 4.41 |
| 5 | 5.1 | 7.0 | 6.3 | −32.6% | 3.44 |
| 6 | 4.4 | 5.1 | 4.7 | band only | 4.4, not adjusted |
| 7 | 3.0 | 4.1 | 3.5 | band only | 3.0, not adjusted |
| 8 | 2.1 | 3.2 | 2.7 | band only | 2.1, not adjusted |
| 9 | 1.9 | 2.8 | 2.1 | band only | 1.9, not adjusted |
| 10 | 1.6 | 2.5 | 1.8 | band only | 1.6, not adjusted |

AI Overview adjustment: adjusted CTR = clean CTR × (1 + delta / 100), two decimals, never below 0. For positions 6 to 10 the study published only a band (−30.5% to −19.4%) without per-position values: keep the clean value, mark the row "not adjusted for AI Overview" and state the band.

## Formulas

**Modeled clicks per month** = volume × CTR(position) / 100.

**Uplift** from the current position p to a better position q = CTR(q) − CTR(p), in percentage points. Modeled extra clicks = volume × uplift / 100.

**Striking distance** (keywords where the project ranks 4 to 20, from `ranked_keywords` or `search_results`):
- uplift to first place = CTR(1) − CTR(position), with CTR = 0 beyond 10;
- opportunity = volume × uplift / 100 (modeled clicks per month);
- sort by opportunity, highest first. Keywords without measured volume are listed apart as "not scored".
- Group spelling variants of the same keyword (same intent) and keep the row with the best position, then the highest volume.

**Share of voice among compared players** (the brand and its Google competitors, positions from `ranked_keywords` per domain or from `search_results` per keyword):
- keep only keywords with measured volume; count the excluded ones and report that count;
- visibility(player, keyword) = volume × CTR(player's position) / 100, or 0 when the player is not in the top 10;
- share of voice(player) = sum of its visibility / sum of all compared players' visibility × 100;
- also report how many keywords each player has in the top 3 and in the top 20.
This is a share among the compared players, not of the whole market. Say so.

Cost note: `ranked_keywords` costs one paid call per domain. Plan the domains with the person before running more than three.

## Caveats to show with any modeled number

- FirstPageSage 2026: meta-analysis of several studies with no disclosed sample size; position 1 (39.8%) is optimistic. Clean SERP curve: AI Overview, featured snippet or local pack results diverge sharply. Mixed intent and device; branded searches behave differently.
- AI Overview delta: measured on informational queries; on commercial or transactional keywords it likely overstates the loss. The combined curve is an approximation.
- Backlinko 2024 and Sistrix 2020: measured before AI Overviews; not representative of current informational results.
- Clicks from being cited inside an AI Overview or an AI answer are not modeled by any curve. Use Lastfind's AI data (`list_sources`, `get_source`) to show those citations as a separate fact.

## Methodology attribution

| Curve | Publisher, date | Method | Sample |
|---|---|---|---|
| Primary | FirstPageSage, "Google CTR by ranking position", published 2025-05-28 | Meta-analysis of Backlinko, Sistrix, Wordstream, BrightLocal and FirstPageSage data into one clean-SERP curve | Not disclosed |
| AI Overview delta | Ahrefs, "AI Overviews reduce clicks" update, December 2025 | Year-on-year comparison of 300,000 keywords (half with AI Overview) from Google Search Console data, desktop, informational | 300,000 keywords |
| Sanity check | Backlinko, "Google CTR stats", December 2024 | Clickstream and scraping analysis | About 4 million results |
| Historical | Sistrix, CTR study, July 2020 | Anonymized Search Console aggregation by layout feature | About 80 million keywords |

## Worked example

Keyword volume 1,300 (measured), project at position 6, AI Overview present.
- Modeled clicks now: 1,300 × 4.4 / 100 = 57 per month (position 6 is not adjusted for AI Overview; say so).
- At position 3 with AI Overview: 1,300 × 5.47 / 100 = 71 per month. Modeled uplift: 14 clicks per month.
- Same move on a clean SERP: 1,300 × (10.2 − 4.4) / 100 = 75 extra clicks per month. Show both and say the AI Overview case applies here.
