# E-E-A-T deliverable template

Save the assessment with create_artifact (kind report) and revise it with update_artifact (whole new content). Write it in the conversation's language with correct diacritics; pt-BR headings are in parentheses. Use friendly names for states, gates and issue types, never raw ids or JSON. A value you did not measure says "not measured" ("não medido").

Four sections are required every time: Executive summary, Score by pillar, Prioritized gaps, Limitations. The others appear when they have content.

## Title

`E-E-A-T report: <domain or URL>` (pt-BR: `Relatório E-E-A-T: <domínio ou URL>`).

## Key numbers

Open with a metrics block. Use delta only when comparing with an earlier assessment from this conversation; never invent one.

```metrics
[
  {"label": "E-E-A-T score", "value": "64.6/100", "note": "Page quality: Medium"},
  {"label": "Page type", "value": "Homepage"},
  {"label": "YMYL", "value": "No"},
  {"label": "Pages read", "value": "7"},
  {"label": "Issues", "value": "5"}
]
```

## 1. Executive summary (Resumo executivo)

Two to four sentences: what was assessed, the score and page quality, the strongest and weakest pillar, the signals raised, and the single most important fix.

## 2. Score by pillar (Score por pilar)

A table with all four pillars, always in this order, followed by a chart.

| Pillar | Score | Rating |
| --- | --- | --- |
| Experience | 55.6 | Medium |
| Expertise | 70.0 | High |
| Authoritativeness | 40.0 | Medium |
| Trust | 80.0 | High |

```chart
{"type": "bar", "title": "Score by pillar", "unit": "points", "series": [{"key": "score", "label": "Score"}], "data": [{"x": "Experience", "score": 55.6}, {"x": "Expertise", "score": 70.0}, {"x": "Authoritativeness", "score": 40.0}, {"x": "Trust", "score": 80.0}]}
```

pt-BR pillar names: Experiência, Especialização, Autoridade, Confiança. A pillar that is not applicable or not measured shows that text in the table and is left out of the chart.

Below the chart, list the signals raised (trust gate, reputation only self-published, YMYL floor, passes disagree) with their friendly names and one line on what each means.

## 3. Prioritized gaps (Lacunas priorizadas)

| Gap | Pillar | Impact | Recommended action |
| --- | --- | --- | --- |
| No author or reviewer on articles | Expertise | High | Add a byline linking to an author page with role and credentials |

Sort by severity, then by agreement across passes. Impact is high, medium or low. Each action says what to change and where.

## 4. Analysis (Análise)

One to three paragraphs in a single voice: what the evidence shows per pillar, how the pillars interact, and what would move the score most. No per-pass commentary.

## 5. How AI answers describe the brand (Como as respostas de IA descrevem a marca)

From get_semantic_branding, get_sentiment and list_responses: the attributes and tone AI answers use for the brand, next to what the site proves. Point out mismatches: attributes AIs give competitors that the brand claims but does not prove, and claims the site makes that AIs never repeat. This section is perception, not evidence; say so in one line.

## 6. Evidence by pillar (Evidência por pilar)

One table per pillar, or one table with a pillar column:

| Criterion | Applicability | State | Score | Evidence |
| --- | --- | --- | --- | --- |
| Direct involvement | Expected | Present | 100 | "We have run paid search for 140 retailers since 2014" (acme.com/about, section "Our story") |
| Own assets | Optional | Absent | 0 | No original data, screenshots or tools on the pages read |

Criterion score is 100 for present, 50 for partial, 0 for absent or unclear, and "not applicable" for excluded criteria. Quotes stay in their original language.

## 7. Reputation research (Pesquisa de reputação)

| Source | Stance | What it says |
| --- | --- | --- |
| URL of the third-party page | Positive, negative or neutral | One-line summary of the claim |

Only pages you read, or that search_results returned with a clear snippet. If none was found, say so and point to the reputation signal.

## 8. Proof you can use (Provas que podem ser usadas)

Claims content may state, each with its source URL and whether it is external or self-published. This list feeds content-seo.

## 9. Do not claim (Não afirmar)

Claims that must stay out of public copy until evidence exists: awards, clients, certifications, years, results or reputation that no source confirms. Next to each, the evidence that would unlock it.

## 10. Limitations (Limitações)

Method (single review, or three passes of one reviewer), pages that could not be read or found, criteria left unclear for that reason, data not measured, and anything the person asked to skip.
