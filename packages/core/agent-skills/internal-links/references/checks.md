# Internal link checks, matching rules and record format

## URL normalization (apply before every comparison)

1. Lowercase the host.
2. Remove the #fragment.
3. Remove tracking parameters: utm_*, gclid, fbclid, mc_cid, mc_eid.
4. Treat a trailing slash and no trailing slash as the same path.
5. Use the final URL after redirects when page_audit shows a redirect.
6. Same site means the same host as the project's domain after normalization. www and the bare domain count as the same site. Other subdomains count only if the person says so.

## Deterministic checks (all must pass)

| Check | Pass rule | How to measure |
|---|---|---|
| source_status_2xx | Source returns 2xx | page_audit status |
| target_status_2xx | Target returns 2xx | page_audit status |
| source_html | Source is an HTML page, not a file, image or PDF | page_audit result and URL extension |
| target_html | Target is an HTML page | page_audit result and URL extension |
| target_indexable | Target is not noindex | page_audit, only when measured; otherwise "not measured" |
| same_site | Source and target on the same site | normalized hosts |
| not_self_link | Source and target differ after normalization | normalized URLs |
| no_existing_link | Source does not already link to the target | only if read_page shows links; otherwise "not verified" |
| no_duplicate_recommendation | The source-target pair appears once in the set | the set itself |
| non_generic_anchor | Anchor is not on the blocklist | blocklist below |
| exact_before_after | Before is verbatim from read_page; After equals Before plus exactly one link | compare the two texts |
| link_removed_test | The sentence still reads correctly with the link removed | read the After text without the link |
| body_context | The paragraph is body text, not navigation, footer, sidebar, author box, tag list or related-post list | position in read_page output; text repeated across pages is boilerplate |

## Generic anchor blocklist

Case-insensitive, whole anchor: click here, read more, learn more, here, link, this link, website, site, more, clique aqui, saiba mais, leia mais, aqui, neste link, veja mais, confira. Add the equivalents in the page's language.

## Blocked reasons

Use exactly one per blocked candidate: http_error (4xx or 5xx), redirect_unresolved, non_html, noindex_target, cross_site, self_link, already_links_to_target, duplicate, weak_context, generic_anchor, fetch_failed, boilerplate_only.

## Matching a source to the topic

1. Terms: the full topic phrase; each topic word with 4 or more letters; each word with 4 or more letters from the target URL slug (split on / and -).
2. A source is worth reading when its title, headings or discovery snippet contain a term.
3. After read_page, the source qualifies when a body paragraph contains the full topic phrase or a natural variant of it (plural, inflection, word order). A single generic word from the term list alone ("guide", "tools") is weak context: block it, or keep it as needs_review with low confidence only when the paragraph clearly discusses the target's subject.
4. Before text: the whole paragraph or list item containing the match, verbatim. If the paragraph is very long, take the sentence with the match plus one sentence on each side, verbatim, and say it is an excerpt.
5. After text: the same block with the matched phrase turned into a Markdown link to the normalized target URL.

## Outbound direction

The source is fixed. Candidate targets are same-site pages whose topic appears in a source paragraph. Validate each target with page_audit (2xx, HTML, indexable when measured). Apply the same checks; at most one new link per target from this source.

## Judgment scale (separate from checks)

- semantic_fit: high when the paragraph introduces or relies on the concept the target explains; medium when related but not central; low when only a word overlaps.
- reader_value: high when a reader at that sentence would want the target next; low when the link would distract.
- confidence: the lower of the two above, lowered one step if no_existing_link is not verified.

## Record per recommendation

ID (il-01, il-02...), direction, source URL (normalized), target URL (normalized), section or heading where the paragraph sits, anchor, before, after, checks (each pass, fail, not verified or not measured), judgment (fit, reader value, confidence) with a one-sentence reason, discovery method, status (needs_review, selected, rejected, applied), recommended action in one sentence.
