---
name: visibility-opportunities
description: Use when the person asks where the brand could gain AI visibility: the prompts and search intents where it is missing, the sites the AIs cite for competitors but not for it, turned into a prioritized plan or outreach list.
license: AGPL-3.0-only
---

# Visibility opportunities

Where the AIs answer the brand's market without the brand, and what to do about it: content to make and sites to be on, in priority order.

## When to use

- "Where can we grow", "what should we write next", "which sites should cite us", "why are we absent from these answers".

## Steps

1. Read list_opportunities for the period: the search intents and prompts where competitors appear and the brand does not.
2. For the top intents, read get_query_fanout: the searches the AIs run behind them.
3. Read list_sources: the domains cited when competitors appear and the brand does not.
4. For the two or three domains that matter most, read get_source: what it is and how often it is cited.
5. Rank the opportunities by how often they appear and how close the brand is, then write the plan.

## Checks

- Each opportunity has its evidence: the prompts, the intents or the citations behind it.
- A domain that cites the brand already is not an outreach target.
- Figures come from the tools in this conversation.

## Output

- A short ranked list in the chat: the opportunity, why, and the action (content or outreach).
- When the person wants to keep it, a table artifact (create_artifact, kind table) with one row per opportunity: type, evidence, action, priority.

## Ask first

- Search data (keyword volumes, Google results) costs credits: offer it to size an opportunity, never run it unasked.
- Writing the content is a separate task: offer it, one piece at a time.

## Pitfalls

- A long list without priority: the person needs the top three first.
- Recommending outreach to a site without saying why it matters (how often the AIs cite it).
