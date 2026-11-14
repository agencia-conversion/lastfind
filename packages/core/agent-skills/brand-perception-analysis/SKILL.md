---
name: brand-perception-analysis
description: Use when the person asks how the AIs describe or perceive the brand: its sentiment from 0 to 100, the attributes it is associated with, quoted evidence from the answers and what drives each impression.
license: AGPL-3.0-only
---

# Brand perception analysis

How the AIs talk about the brand: the sentiment score, the attributes that stick, the words they use, and what drives them, with quotes from the answers.

## When to use

- "How do the AIs see us", "what do they say about our brand", "why is our sentiment low", "what are we known for".

## Steps

1. Read get_sentiment for the period: the score from 0 to 100, how many answers it rests on, and its trend.
2. Read get_semantic_branding: the attributes the brand is associated with and how strongly, against competitors.
3. For the two or three attributes that matter most, read get_semantic_evidence for quotes.
4. When a negative impression stands out, read list_responses for the answers behind it.
5. Write the analysis: the overall impression, the attributes that carry it, the evidence, then what could change it.

## Checks

- A score with few answers behind it is said to be tentative, with the count.
- Missing data is never zero: an attribute not measured is said to be not measured.
- Every quote is copied from a tool result, never paraphrased into a quote.

## Output

- The overall impression in one line, with the score.
- A table of attributes (strength, against the main competitor) or a bar block.
- Two to four quotes, each with the AI it came from.
- "What drives it" and "What could change it", two or three bullets each.

## Ask first

- Nothing here costs credits.

## Pitfalls

- Reading a single answer as the AI's opinion: say how many answers agree.
- Presenting the AIs' words as facts about the brand: they are what the AIs say.
