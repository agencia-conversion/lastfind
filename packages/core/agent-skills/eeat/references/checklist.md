# E-E-A-T checklist

Twenty fixed criteria, five per pillar. Rate every criterion, every time, with the same ids, so audits stay comparable. Use the pt-BR label in pt-BR reports.

## Criteria

### Experience (Experiência)

| Id | Label | pt-BR label | What to look for |
| --- | --- | --- | --- |
| ex1 | Direct involvement | Envolvimento direto | The page shows operating, using, testing, doing or living the topic first-hand. |
| ex2 | Real work | Trabalho real | Cases, examples, clients, projects or concrete proof of having done the work. |
| ex3 | Own assets | Ativos próprios | Original data, artifacts, images, screenshots, tools, processes or materials. |
| ex4 | Scope and context | Escopo e contexto | Experience claims carry period, scope, sample, context, limits or conditions. |
| ex5 | Specific practice | Prática específica | The content separates real practice from generic advice or passive summary. |

### Expertise (Especialização)

| Id | Label | pt-BR label | What to look for |
| --- | --- | --- | --- |
| eq1 | Appropriate responsible party | Responsável adequado | The entity, team, author or reviewer responsible is identifiable where the page type expects it. |
| eq2 | Matching qualification | Qualificação compatível | Roles, credentials, history, specialization or qualifications fit the topic. |
| eq3 | Technical depth | Profundidade técnica | Reasoning, method, technical distinctions or command of the subject. |
| eq4 | Sources and data | Fontes e dados | Where the topic demands it: sources, standards, data, methodology or primary references. |
| eq5 | Currency and accuracy | Atualidade e precisão | Current enough for the topic; no misleading simplifications. |

### Authoritativeness (Autoridade)

| Id | Label | pt-BR label | What to look for |
| --- | --- | --- | --- |
| au1 | External reputation | Reputação externa | Independent mentions, reviews, press, rankings or relevant external sources. |
| au2 | Verifiable proof | Provas verificáveis | Clients, partners, certifications, awards or affiliations that can be verified. |
| au3 | Niche recognition | Reconhecimento no nicho | The entity or creator is recognized on the topic by its market or community. |
| au4 | Authority assets | Ativos de autoridade | Cases, publications, studies, courses, talks, tools or intellectual property. |
| au5 | Separation of proof | Separação de prova | The page distinguishes external evidence, own evidence and promotional claims. |

### Trust (Confiança)

| Id | Label | pt-BR label | What to look for |
| --- | --- | --- | --- |
| tr1 | Entity identity | Identidade da entidade | It is clear who is responsible for the site, business, product or content. |
| tr2 | Contact paths and policies | Caminhos de contato e políticas | Contact, support, privacy, terms or the expected legal paths are reachable. |
| tr3 | Substantiated claims | Claims substanciados | Commercial claims, guarantees, numbers and superlatives have proportional evidence. |
| tr4 | Commercial transparency | Transparência comercial | Sponsorship, affiliation, conflicts, price, data capture or commercial purpose are clear when relevant. |
| tr5 | Safe and honest experience | Experiência segura e honesta | No deceptive UX, blocked content, malware, phishing, exaggeration or spam signals. |

## Page types

homepage, about, service, case_study, article, author_profile, contact, policy, product_tool, landing_page. A site audit is rated as homepage using evidence from every page read. When unsure, use homepage.

## Applicability by page type

R = required (weight 1.25), E = expected (weight 1), O = optional (weight 0.5), NA = not applicable (excluded from the score; give a one-line reason).

| Id | homepage | about | service | case_study | article | author_profile | contact | policy | product_tool | landing_page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ex1 | E | E | E | E | E | O | NA | NA | E | E |
| ex2 | E | E | E | E | E | O | NA | NA | E | E |
| ex3 | O | O | O | E | O | E | NA | NA | E | E |
| ex4 | E | O | E | E | E | O | NA | NA | E | E |
| ex5 | E | E | E | E | E | E | NA | NA | E | E |
| eq1 | E | R | E | E | R | R | NA | E | E | E |
| eq2 | O | E | E | E | E | R | NA | O | E | E |
| eq3 | E | E | E | E | E | E | NA | O | E | E |
| eq4 | O | O | O | E | E | O | NA | O | E | E |
| eq5 | E | E | E | E | E | E | O | E | E | E |
| au1 | E | E | E | E | E | E | O | O | E | E |
| au2 | E | E | E | E | E | E | O | O | E | E |
| au3 | E | E | E | E | E | E | O | O | E | E |
| au4 | E | E | E | E | E | E | O | O | E | E |
| au5 | E | E | E | E | O | O | O | O | E | E |
| tr1 | R | R | E | E | E | E | R | R | R | E |
| tr2 | E | E | E | O | O | O | R | R | E | E |
| tr3 | R | E | R | R | E | O | O | E | R | R |
| tr4 | E | O | E | E | E | O | O | R | E | E |
| tr5 | R | E | E | E | E | E | E | E | R | R |

You may mark an E or O criterion NA when it clearly does not apply to this specific page, with a reason. Never mark an R criterion NA.

## States

| State | Value | Use when |
| --- | --- | --- |
| present | 1.0 | A short verbatim quote shows the criterion is met. |
| partial | 0.5 | A quote shows it is partly met (claim without scope, author without credentials). |
| absent | 0 | You read the place where it should be and it is not there. Write a one-line absence statement. |
| unclear | 0 | Hinted but not proven, or the relevant page could not be read or found. |
| not_applicable | excluded | Does not apply to this page type or page; reason required. |

A present or partial rating without a quote becomes unclear.

## Evidence fields per criterion

- quote: short verbatim excerpt (up to about 200 characters), in the original language with its accents;
- locator: URL plus the heading or section where it appears;
- source type: same page, same site, external, or not found;
- verification: verified (an independent source confirms it), self-published (only the brand says it), needs verification, or not applicable.

## How to judge each pillar

- Experience counts only first-hand signals. A well-written summary of other people's advice is ex5 absent.
- Expertise needs a person or entity responsible for the content and signals that they know the topic. Credentials must match the topic.
- Authoritativeness is external. au1 and au3 need third-party sources; au2 needs proof someone could check (a client's own case page, a certifier's directory). Self-published logos and testimonials alone are partial at most.
- Trust is the most important pillar. Unsupported superlatives, hidden commercial intent, missing contact or policies, and deceptive patterns weigh most here.
- What AI answers say about the brand is never evidence for any criterion. Third-party pages they cite can be, once you have read them.
