# On-page SEO and AI answer optimization

Guidance for planning and drafting. The pass or fail list for the final check is in review-checklist.md.

## On-page SEO

Title tag
- About 60 characters, primary keyword near the start, unique, matches the intent (a guide says guide, a comparison names the options).
- If the brand name fits, join it with a comma or a colon. Never a vertical bar, a middle dot, a bullet or a dash.
- Keep pt-BR accents in titles.

Meta description
- About 155 characters, answers the search in one sentence, includes the keyword naturally, ends with a reason to click. No promises the page does not keep.

H1 and headings
- One H1, close to the title tag but written for the reader.
- H2 and H3 follow the outline without skipping levels. A heading never follows another heading directly.
- Use the real question wording from People also ask and fan-out searches as headings where it reads naturally.

Slug
- Short, lowercase, hyphens, ASCII only (no accents), keyword words only. On a refresh, keep the existing URL.

Keyword use
- Primary keyword in the title tag, H1, first 100 words, at least one H2 and the meta description. Variations where they fit. No stuffing: if a sentence exists only to repeat the keyword, cut it.

Introduction
- The first paragraph answers the search: what it is, for whom, why it matters. No warm-up.

Links
- Internal: three to five links to related brand pages, using URLs confirmed by read_page, ranked_keywords, search_results, list_sources or the person. Never invent a URL; list unconfirmed ones as link opportunities in the publishing notes.
- External: link the original public source of each number or quote, with descriptive anchor text. Never link competitor pages you only studied.

Images
- Suggest images that carry information (a diagram, a screenshot of a real process, a comparison chart), each with alt text describing the content in the page's language.

Structured data (suggest; the person implements)
- Article or BlogPosting with author and dates for articles; Organization for the publisher; Person for the author when a profile exists; FAQPage only when the questions and answers are visible on the page; Product or Service for landing pages; BreadcrumbList when the site uses breadcrumbs.

Trust signals on the page
- Named author with real credentials (or an open item), publish date and "updated on" date, first-hand experience, sources for claims, a way to contact the brand. See the eeat skill for the full criteria.

## AI answer engines (GEO)

AI answers (ChatGPT, Gemini, Claude, Perplexity, Google AI Mode, AI Overviews) run searches, read pages and quote the passages that answer the question cleanly. Lastfind shows which prompts, sources and attributes matter for this brand. Use it.

Plan from Lastfind data
- Fan-out searches (get_query_fanout) are the sub-questions AIs research. Cover them, ideally as headings with a direct answer.
- Cited sources and source types (list_sources, get_source_types) show what AIs trust on this topic. Match the depth and format of the cited pages, and beat them on clarity and specificity.
- Semantic branding (get_semantic_branding) shows attributes AIs tie to competitors but not to the brand. Cover an attribute only when the brand can back it; otherwise flag it in the brief as a gap.
- AI answers for the closest prompts (list_responses) show how the brand is described now. If the description is wrong or thin, the piece should state the correct facts plainly.

Write passages that can be quoted
- Answer first: under each question heading, a self-contained answer of one to three sentences (about 40 to 60 words) that makes sense out of context, then the detail.
- Entity clarity: name the brand, the category, the audience and the country explicitly. Use the same brand and product names every time.
- Specific, checkable facts: definitions, numbers with their source, dates, prices only when confirmed, steps in order, named criteria. Vague praise is never quoted.
- Comparisons as tables with clear column names; criteria the buyer actually uses.
- Freshness: a visible updated date, and the current year only when the content is really current.
- One idea per paragraph, so a passage lifted alone stays accurate.

What a page alone cannot fix
- When AI answers mostly cite review sites, marketplaces, forums or third-party lists, the brand needs presence there too. Say so in the brief instead of promising the article will change it.
- Never write for machines: no hidden text, no keyword lists, no claims made only to be quoted.

Measure after publication
- Propose create_prompts for the buyer questions the piece answers, so Lastfind tracks whether AI answers start mentioning and citing the brand. The person approves them in the app.

## Landing-page copy

- Hero: headline states the outcome for a named audience; subheadline says how; one primary call to action.
- Benefits each tied to proof the brand can show; features explained by what they let the buyer do.
- Social proof only from confirmed sources (named customers, reviews, numbers with their source). If none exists, leave it out and list it as an open item.
- Objections and FAQ from People also ask and AI answers, answered plainly.
- One goal per page; every call to action points to it.
- Bullets are fine on landing pages; keep them short and parallel.

## Refreshing an existing page

1. read_page and page_audit on the URL (two paid calls). Optionally ranked_keywords for the domain to see which keywords the URL already ranks for.
2. search_results for its main keyword and read_page on the Top 3 (same budget as a new brief).
3. In the brief, list what to keep (sections that answer the intent), what to add (missing questions, fan-out topics, proof, unique value), what to cut (outdated, filler, duplicated) and technical fixes from page_audit.
4. Keep the URL, H1 intent and the parts that already rank. Change the updated date only when the content changes materially.
5. Save the revised copy as a content artifact, with a short "What changed" list in the publishing notes.
