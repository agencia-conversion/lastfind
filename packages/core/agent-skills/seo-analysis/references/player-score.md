# Player score (model player-score-v1), by hand

The player score rates every page competing for one keyword (a "player"), including the project's own page (the target), on 100 points:

- 70 deterministic points, computed from observed data with the formulas below.
- 30 judgment points, computed with fixed rules that must cite observed evidence.
- Confidence (0–100) is reported next to the score, never mixed into it.

The score describes how well a page matches what Google shows today. It is not a ranking forecast. Never present it as one.

## 1. Inputs

| Input | Where it comes from |
|---|---|
| Keyword | The person, or a Lastfind prompt or fan-out query |
| Market | `get_project` (country, language) |
| Results | `search_results`, depth 10: position, title, URL, snippet, features |
| N (players limit) | 10. Positions are always compared on the first page |
| Page evidence per player | `page_audit` (headings, word count, technical checks); if it fails, `read_page` (headings, paragraphs) |

Players to score, by default: the top 3 organic results plus the target (at most 4 `page_audit` calls). Score more players only when the person asks; each one is another paid call.

Deduplicate players by URL key: lowercase host without `www.`, path without trailing slash, no query or fragment. Keep the first (best) position.

## 2. Target and target status

- URL mode: the person gives a URL. Domain mode: no URL given, use the project's domain.
- A host matches the target when it equals the target host or ends with `.` plus the target host (subdomains count).

| Mode | Status | Rule |
|---|---|---|
| URL | `exact_url_ranking` | The target URL key is in the top N |
| URL | `same_domain_wrong_url` | Another URL of the target host is in the top N |
| URL | `not_ranking` | No URL of the target host is in the top N |
| Domain | `domain_ranking` | Any URL of the domain is in the top N (the best one is the target player) |
| Domain | `not_ranking` | None is |

When the target is not in the top N, still add it as a player with position "not ranking". In domain mode with no ranking URL, ask the person which page should compete for the keyword. If they do not know, audit the homepage and label it a stand-in, never "the ranking URL".

## 3. Tokens (used by query relevance and term coverage)

1. Lowercase and remove accents (`análise` becomes `analise`, `ç` becomes `c`).
2. Replace every character that is not a letter or digit with a space, then split.
3. Drop tokens of 2 characters or fewer and stopwords.

Stopwords from the model: a, ao, aos, as, ate, com, como, da, das, de, do, dos, e, em, esse, esta, este, mais, mas, na, nas, no, nos, o, os, ou, para, por, que, se, sem, sua, suas, seu, seus, um, uma, sobre, guia, melhor, melhores.

For English keywords (Lastfind adaptation), also drop: the, and, for, with, from, how, what, your, you, are, this, that, best, guide, top.

### SERP terms

Count every token occurrence in the title and snippet of every result in the top 10 (each occurrence adds 2) and in all headings of every scored player (each occurrence adds 1). Sort by count, ties alphabetical. Report the top 12. The top 10 are the "evaluated terms".

## 4. Deterministic components (70 points)

Points = component score (0–100) × weight / 100, rounded to one decimal.

| Component | Weight | Score 0–100 |
|---|---|---|
| SERP visibility | 25 | max(0, (N − position + 1) / N × 100). Not ranking = 0 |
| Query relevance | 15 | matched keyword tokens / keyword tokens × 100, searched in SERP title + snippet + URL path words + H1 |
| Term and structure coverage | 15 | matched evaluated terms / evaluated terms (10, or fewer if fewer exist) × 100, searched in SERP title + snippet + H1 + all H2s |
| Technical SEO | 15 | Technical score from `references/technical-checks.md` |

If the keyword has no tokens left after filtering, query relevance and intent fit are "not measured"; say why.

A target that is not in the results has no SERP title or snippet: search only its URL path words and H1 (coverage: H1 and H2s). That gap is real evidence that it is absent from the page, not a missing measurement.

SERP visibility with N = 10:

| Position | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | not ranking |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Score | 100 | 90 | 80 | 70 | 60 | 50 | 40 | 30 | 20 | 10 | 0 |
| Points (of 25) | 25 | 22.5 | 20 | 17.5 | 15 | 12.5 | 10 | 7.5 | 5 | 2.5 | 0 |

Not being in the top 10 is a measured fact and scores 0. A page that could not be read is a missing measurement and is handled in section 6.

## 5. Judgment components (30 points)

| Component | Weight | Score 0–100 | Evidence to cite |
|---|---|---|---|
| Intent fit | 10 | Same value as query relevance | SERP title, snippet, URL, H1 |
| Content quality and proof | 10 | ((min(words, 1200) / 1200 × 6) + min(H2 count, 4)) × 10, capped at 100 | Word count, H2 count. Never credit proof you did not see on the page |
| Competitive threat or opportunity | 10 | (base + 2 if any critical or error technical check fails + 2 if this player is the target and status is not `exact_url_ranking`) × 10, capped 0–100 | Position, failed checks, target status |

Base = 10 − round(position / 2), rounding .5 up; not ranking uses position 11.

| Position | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | not ranking |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Base | 9 | 9 | 8 | 8 | 7 | 7 | 6 | 6 | 5 | 5 | 4 |

Content quality examples: 600 words and 2 H2s gives (3 + 2) × 10 = 50. 1,500 words and 6 H2s gives (6 + 4) × 10 = 100.

## 6. Totals and missing measurements

- Overall = deterministic points + judgment points (max 100).
- Deterministic score = deterministic points / 70 × 100. Judgment score = judgment points / 30 × 100.
- If a component could not be measured (page unreadable, no technical audit, no word count), leave it blank. Report the player as "X of Y measured points" instead of a score out of 100. Never fill a gap with 0 and never estimate it.
- Compare players directly only when the same components were measured; otherwise say so next to the table.

## 7. Confidence (0–100)

Start at 100 for each player and subtract:

| Condition | Penalty |
|---|---|
| Fewer than 5 organic results in the SERP | −20 |
| Page could not be read (`page_audit` and `read_page` both failed) | −30 |
| No technical audit for this page | −20 |

Floor at 0. Label (Lastfind convention): 80 or more high, 50 to 79 medium, below 50 low. Always list the reasons.

## 8. Worked example

Keyword `seo agêntico`, target `https://example.com/seo-agentico/` at position 7. Keyword tokens: `seo`, `agentico`, both in the SERP title. 6 of the 10 evaluated terms appear in title, snippet, H1 or H2s. Technical score 78, no critical or error failure. 900 words, 3 H2s. Status `exact_url_ranking`.

| Component | Score | Points |
|---|---|---|
| SERP visibility | 40 | 10.0 |
| Query relevance | 100 | 15.0 |
| Term and structure coverage | 60 | 9.0 |
| Technical SEO | 78 | 11.7 |
| Deterministic total | 65.3 | 45.7 of 70 |
| Intent fit | 100 | 10.0 |
| Content quality and proof | ((900 / 1200 × 6) + 3) × 10 = 75 | 7.5 |
| Competitive threat or opportunity | (10 − 4) × 10 = 60 | 6.0 |
| Judgment total | 78.3 | 23.5 of 30 |
| Overall | | 69.2 of 100 |

Confidence: 10 results, page read, audit present, so 100 (high).

## 9. How to report it

1. Players table: Position, Domain, URL, Player score, Deterministic (of 70), Judgment (of 30), Confidence.
2. Target breakdown: one row per component with score, points and the evidence used (matched and missing tokens, missing terms, failed checks).
3. Two or three lines of interpretation: which components pull the target down compared with the top 3 average, and what evidence supports that. Missing terms and failed checks become hypotheses, not promises.
