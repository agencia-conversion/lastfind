# Backlink analysis: multi-competitor rules

Decision rules, edge cases and table formats for comparing the target with 1 to 4 competitors. Not needed in single mode.

## Inputs

- Target: domain or URL.
- Competitors: 1 to 4, same type as the target.
- Brand strings: the project brand (get_project) and each competitor brand (compare_brands), exactly as written. Never invent brand variants.
- Focus keywords: optional, only from the person.
- Lists used: each player's referring_domains result (limit 100) and anchors result (limit 50).

## Link gap

For each referring domain RD in any competitor's returned list:

strength(RD) = number of competitors whose returned list contains RD.

Emit a gap row when strength(RD) is at least 1 and RD is not in the target's returned list.

Sort: strength (high first), then cited in AI answers (yes first), then rank (stronger first, using the returned value), then alphabetical. Never sort by your own sense of a domain's authority.

Columns: Referring domain, Overlap strength, Linked competitors, Rank, Spam score, Cited in AI answers, First seen (when returned).

State in the section: "Compared within each player's returned top 100 referring domains. A domain missing from the target's list may still link to it further down."

## Link overlap

Emit an overlap row when RD is in the target's returned list and in every measured competitor's returned list.

Columns: Referring domain, Rank, Backlinks per player (when returned). If per-player anchors are not available for that domain, leave them out and note it.

## Anchor distribution comparison

Bucket every returned anchor per player. Case-insensitive, first match wins:

1. branded: contains that player's brand string.
2. exact_match: equals a focus keyword (only when the person gave one).
3. partial_match: contains a focus keyword or its main words (only when given).
4. naked: the anchor is a URL or a domain.
5. generic: click here, read more, learn more, here, link, website, site, clique aqui, saiba mais, leia mais, aqui, neste link, or the equivalent in the page language.
6. image_or_empty: empty anchor or image alt only.
7. other: everything else.

Without focus keywords, skip exact_match and partial_match and say so. Weight buckets by the backlink count per anchor when returned; otherwise count anchors, and say which.

Columns: Player, then one column per bucket in percent. Below the table, list anchors that appear only in competitors' lists (top 10 by backlinks).

An exact-match or commercial share far above every competitor's is a risk cue to review, not a penalty.

## Referring-domain quality mix

- Category: use the category the tool returns, mapped to editorial, news, directory, partner, ugc, sitewide, suspected spam network, irrelevant; otherwise unknown. Never guess a category from the domain name alone.
- Spam buckets from the returned spam score: 0 to 15, 16 to 30, 31 and above; no score goes to "no score".

Columns: Player, then counts or percent per category and per spam bucket, over the returned rows.

## Page-level link gap (URL mode)

Only when the target is a URL and at least one competitor URL is given. Same rule as the link gap, using the referring_domains results for the URLs.

Asset hint (study, dataset, tool, listicle, comparison) only when the anchor or the competitor page title clearly says so; otherwise unknown. Never infer it from the URL slug alone.

## AI-cited sources and links

From list_sources (free), take the cited domains for this project, excluding the target's and competitors' own domains. For each, record whether it appears in the target's returned list and in each competitor's returned list:

- Links to target: keep, and note it is also an AI source.
- Links only to competitors: a priority investigation for digital PR.
- Links to no measured player: possible PR or partnership investigation.

If get_source shows which brands the cited page mentions, add the column "Mentions competitor, not target". Never infer the page's sentiment toward a brand.

## Link velocity

Not available. Do not estimate new or lost links. If referring_domains returns first-seen dates, you may count how many returned domains were first seen in the last 90 or 180 days, labeled "recent among returned domains", not velocity.

## Edge cases

- A competitor's calls failed or returned nothing: keep its row with not measured, add a limitation, and exclude it from overlap (overlap needs every measured competitor).
- One competitor only: strength can only be 1; overlap still works.
- Domain and URL mixed in the input: ask which type to compare.
- Empty gap or overlap: show zero rows and a sentence saying so; do not pad.

## Anti-patterns

- Treating overlap strength as authority. It is structural overlap only.
- Reporting a gap as "they do not link to you" without the top-N caveat.
- Calling a spam score proof of a penalty, or recommending disavow without a review.
- Adding brand-mention rows without Lastfind source evidence.
