# Technical checks (technical SEO component of the player score)

Apply this checklist to what `page_audit` reports for each player. Using the same checklist for every page keeps players comparable, even when `page_audit` also lists its own problems (report those as given, in a separate list).

## Score

- Technical score = round(sum of weights of passed checks / sum of weights of measured checks × 100).
- Grade: A at 90 or more, B at 80 or more, C at 70 or more, D at 50 or more, F below 50.
- The page is "OK" when no critical or error check fails.
- A check whose evidence `page_audit` (or `read_page`) did not return is "not measured": leave it out of both sums, list it, and write the score as "on N measured checks". Never count it as failed or passed.

## Base checks (every page, total weight 73)

| Check | Passes when | Severity | Weight | Fix |
|---|---|---|---|---|
| HTTP status | Status is 2xx | critical | 8 | Return a stable 2xx response |
| Indexable | No `noindex` in meta robots or X-Robots-Tag | critical | 8 | Remove noindex from pages that should rank |
| Title present | A title tag exists | error | 7 | Add one descriptive title |
| Title length | 10 to 65 characters | warning | 4 | Keep the title roughly within that range |
| Meta description present | It exists | warning | 5 | Add a specific meta description |
| Meta description length | 50 to 170 characters | info | 3 | Keep it roughly within that range |
| Single H1 | Exactly one H1 | error | 7 | Use one H1 that states the page topic |
| Heading hierarchy | No skipped level (for example H1 straight to H3) | warning | 4 | Use headings in order |
| Absolute canonical | Canonical starts with `http://`, `https://` or `//` | warning | 5 | Add an absolute canonical URL |
| HTML lang | The lang attribute is declared | warning | 3 | Set it, for example `pt-BR` |
| Viewport | Viewport meta exists | warning | 3 | Add a responsive viewport meta tag |
| Image alt | Every image has alt text (empty alt is fine for decorative images) | warning | 5 | Add meaningful alt text |
| Valid JSON-LD | Every structured data block parses | error | 5 | Fix invalid JSON-LD |
| Internal links | At least 1 internal link | warning | 4 | Add contextual internal links |
| Open Graph | At least 2 Open Graph tags | info | 2 | Add og:title and og:description or og:image |

## Page-type checks (add the set that matches the page)

Decide the page type from visible evidence: home (the URL path is `/`), product in a store, service or offer page, blog post or article, about page. When unclear, use "unknown" and add no extra checks. Text signals are searched in the title, meta description, headings and visible text.

| Page type | Check | Passes when | Severity | Weight |
|---|---|---|---|---|
| Home | Home schema | Organization, WebSite or LocalBusiness schema | warning | 7 |
| Home | Navigation depth | At least 4 internal links | warning | 5 |
| Home | Content depth | At least 250 words | info | 4 |
| Store product | Product schema | Product schema | error | 8 |
| Store product | Commerce signals | Price, buy, stock or availability words (pt: preço, R$, comprar, estoque, disponível) | warning | 5 |
| Store product | Product image | At least 1 image | warning | 4 |
| Store product | Trust details | Review, warranty, shipping or returns words (pt: avaliação, garantia, entrega, troca) | info | 3 |
| Service | Service schema | Service, Product, LocalBusiness, ProfessionalService or Organization schema | warning | 7 |
| Service | Offer clarity | Service, solution, consulting, plan, quote or contact words (pt: serviço, solução, consultoria, plano, orçamento, contato) | warning | 5 |
| Service | Supporting links | At least 2 internal links | info | 3 |
| Blog | Article schema | Article, BlogPosting or NewsArticle schema | warning | 7 |
| Blog | Depth | At least 500 words | warning | 5 |
| Blog | H2 structure | At least 2 H2s | info | 3 |
| Blog | Author and date | Author, updated, published or date words (pt: autor, atualizado, publicado, data) | info | 3 |
| About | About schema | AboutPage, Organization, Person or LocalBusiness schema | warning | 7 |
| About | Identity | Team, history, mission, experience, founder or company words (pt: equipe, história, missão, experiência, fundador, empresa) | warning | 5 |
| About | Contact path | Contact, email, phone, address or LinkedIn (pt: contato, email, telefone, endereço, linkedin) | info | 3 |

## Findings and priorities

List failed checks ordered by severity (critical, error, warning, info), then by weight, highest first. The first 8 are the priorities, each with its evidence and fix.

Use only these findings as evidence. Do not invent metrics, backlinks, credentials, awards, clients or proof. Schema, lang, viewport, Open Graph and JSON-LD validity are often not in `page_audit` output; when they are not, they are "not measured", not failures.

## Worked example

A blog post with 17 checks measured (the 15 base checks minus JSON-LD, plus 4 blog checks minus Article schema, both not measured): measured weight 73 − 5 + 18 − 7 = 79. It fails Title length (4), Image alt (5) and Author and date (3): passed weight 79 − 12 = 67. Score round(67 / 79 × 100) = 85, grade B, OK (no critical or error failure). Write it as "85 (B) on 17 measured checks, 2 not measured".
