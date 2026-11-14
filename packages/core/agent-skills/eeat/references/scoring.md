# E-E-A-T scoring and consensus

Apply these rules exactly. Show the arithmetic in your reasoning and round every score to one decimal. Never adjust a score by feel.

## 1. Pillar score

For each pillar, over the criteria that apply (not_applicable excluded):

pillar score = 100 × Σ(state value × applicability weight) ÷ Σ(applicability weight)

State values: present 1.0, partial 0.5, absent 0, unclear 0.
Applicability weights: required 1.25, expected 1, optional 0.5.

Worked example, page type article, Experience:

| Id | Applicability | Weight | State | Value × weight |
| --- | --- | --- | --- | --- |
| ex1 | expected | 1 | present | 1.0 |
| ex2 | expected | 1 | partial | 0.5 |
| ex3 | optional | 0.5 | absent | 0 |
| ex4 | expected | 1 | unclear | 0 |
| ex5 | expected | 1 | present | 1.0 |

Sum 2.5 ÷ total weight 4.5 = 0.556, so Experience = 55.6.

Reputation cap: when you found no external reputation source at all (no third-party page that mentions the brand), Authoritativeness is capped at 50 and the signal "reputation only self-published" is raised.

Pillar with nothing to rate: if every criterion of a pillar is not_applicable for the page type (Experience on contact and policy pages), show the pillar as not applicable and divide the remaining weights by their sum in the total.

Not measured: if you could not read any page that bears on a pillar, report that pillar as not measured, do not publish a total score, and give the partial view with the reason in Limitations.

## 2. Total score

total = 0.35 × Trust + 0.25 × Expertise + 0.20 × Experience + 0.20 × Authoritativeness

Example: Experience 55.6, Expertise 70.0, Authoritativeness 40.0, Trust 80.0 gives 11.12 + 17.5 + 8.0 + 28.0 = 64.6.

## 3. Gates

Apply after the total, in this order:

1. YMYL floor: if the topic is YMYL and any pillar is below 40, subtract 15 points from the total (minimum 0) and raise "YMYL topic with a pillar below 40".
2. Trust gate: if Trust is below 20, page quality is Lowest whatever the total, and raise "trust below the floor".
3. Reputation: if no external reputation source was found, raise "reputation only self-published" (the cap in section 1 already applied).

## 4. Bands

The same bands give each pillar's rating and the page quality from the total:

| Score | Rating | pt-BR |
| --- | --- | --- |
| 85 to 100 | Highest | Muito alta |
| 65 to 84.9 | High | Alta |
| 40 to 64.9 | Medium | Média |
| 20 to 39.9 | Low | Baixa |
| 0 to 19.9 | Lowest | Muito baixa |

The example total of 64.6 is Medium, not High.

## 5. Consensus across three passes (full audit)

A full audit rates all 20 criteria three times from the same evidence, each pass with a different lens: strict auditor, typical buyer, search quality rater. Score each pass with sections 1 to 3, then merge:

- Total score: the median of the three pass totals.
- Each pillar score: the median of the three pass scores for that pillar.
- YMYL: yes when at least two passes say yes.
- Page quality: the label at least two passes agree on; if all three differ, take the band of the median total.
- Gates: recompute on the merged pillar scores (Trust below 20, YMYL with any pillar below 40, no external reputation source). Do not apply the YMYL penalty a second time; the pass totals already include it.
- Each criterion: the state at least two passes agree on; if all three differ, unclear. Record the agreement (3, 2 or 1 of 3) and keep up to three quotes.
- Divergence: raise "passes disagree" when any pillar's spread (highest pass minus lowest) is above 25 points, or when more than 30% of the rated criteria have agreement 1 of 3.
- Issues: merge issues with the same severity, type, criterion and recommendation; count how many passes raised each; sort by severity, then by that count.
- Remediation: merge actions with the same priority that share a criterion id or say the same thing in other words; keep the most complete wording; sort by priority, then by how many passes proposed it.
- Reputation sources: the union of all passes, one entry per URL.

The report speaks in one voice. Do not show per-pass chatter unless the person asks. Say in Limitations that the three passes are lenses of the same reviewer, not independent raters.

A quick check uses one pass; write "single review" in Limitations.

## 6. Issue types

Use only these types. Show the friendly name in the report, never the raw id.

| Type | English | pt-BR |
| --- | --- | --- |
| missing_expected_author | Missing author where one is expected | Autor ausente onde é esperado |
| unsupported_material_claim | Material claim without proof | Afirmação relevante sem prova |
| verification_needed | Needs verification | Precisa de verificação |
| insufficient_reputation_evidence | Not enough external reputation | Reputação externa insuficiente |
| missing_business_contact | Missing business contact | Contato da empresa ausente |
| missing_required_policy | Missing required policy | Política obrigatória ausente |
| outdated_or_undated_editorial_content | Outdated or undated content | Conteúdo desatualizado ou sem data |
| missing_responsible_entity | Unclear who is responsible | Responsável não identificado |
| deceptive_or_unsafe_experience | Deceptive or unsafe experience | Experiência enganosa ou insegura |

Each issue has: severity (high, medium, low), criterion id, page type, why it applies, short evidence, recommendation.

Severity guidance: high for a required criterion absent or unclear, an unsupported material claim on a commercial or YMYL page, any deceptive pattern, or a triggered gate; medium for an expected criterion absent or partial; low for optional criteria and polish.

## 7. Signals (friendly names)

| Signal | English | pt-BR |
| --- | --- | --- |
| trust gate | Trust below the floor: page quality set to Lowest | Confiança abaixo do mínimo: qualidade rebaixada para Muito baixa |
| reputation only self-published | Reputation only self-published: Authoritativeness capped at 50 | Reputação só autodeclarada: Autoridade limitada a 50 |
| YMYL floor | YMYL topic with a pillar below 40: 15 points subtracted | Tema YMYL com pilar abaixo de 40: 15 pontos descontados |
| passes disagree | The review passes disagree; confidence is lower | As leituras divergem; a confiança é menor |

## 8. Remediation

Each action has priority (high, medium, low), what to do, why, and the criterion ids it moves. Split actions into three groups: immediate fixes on the site, evidence to collect, and claims not to make. Never recommend publishing proof that does not exist. Estimate the effect of an action only in points of this score ("on a homepage, tr2 from absent to present adds about 17 points to Trust and 6 to the total"), never in traffic or revenue.
