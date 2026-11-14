# Technical checklist: checks, weights and measurement

Apply this by hand to each page_audit result. Do not change a weight or a severity to make a page look better or worse.

## How a check gets a status

1. Field: page_audit returns a field that answers the check. Compute pass or fail from it.
2. Problem: page_audit's problem list contains a problem that clearly means this check failed (match by meaning: a problem about images without alt text fails "Images have alt text"). That is a fail, even if no field exists.
3. Text: checks marked "read_page" use the page's visible title, headings and paragraphs.
4. None of the above: not measured. Absence of a problem alone is not a pass when page_audit returns no field for that check.

Record the evidence for every status: the field value, the problem text, or the excerpt and term found.

## Base checks (every page type)

| ID | Check | Severity | Weight | Pass rule | Measured by | Repair |
|---|---|---|---|---|---|---|
| http_status_2xx | HTTP status permits indexing | critical | 8 | Status 200 to 299 for the audited URL | page_audit status | Return a stable 2xx for this URL. If it redirects, link and canonicalize to the final URL. |
| indexable_robots | Robots directives allow indexing | critical | 8 | No noindex in meta robots or X-Robots-Tag | robots field if returned, or a noindex problem | Remove noindex from pages that should appear in search. |
| title_present | Title tag exists | error | 7 | Title not empty | title | Add one descriptive title tag. |
| title_length | Title length is controlled | warning | 4 | 10 to 65 characters | title (count characters) | Keep the title roughly between 10 and 65 characters. |
| meta_description_present | Meta description exists | warning | 5 | Not empty | meta description | Add a specific meta description for search snippets. |
| meta_description_length | Meta description length is controlled | info | 3 | 50 to 170 characters | meta description (count characters) | Keep it roughly between 50 and 170 characters. |
| single_h1 | Exactly one H1 | error | 7 | H1 count is 1 | H1 | Use exactly one H1 that states the page topic. |
| heading_hierarchy | Heading order does not skip levels | warning | 4 | Going down, no jump of more than one level (H1 then H3 fails) | read_page headings, only when levels are visible | Use headings in order, without jumping from H1 to H3 or H4. |
| canonical_absolute | Canonical URL is absolute | warning | 5 | Canonical present and starting with http://, https:// or // | canonical | Add an absolute canonical URL. |
| html_lang | HTML language is declared | warning | 3 | lang attribute present | lang field or a matching problem | Set the html lang attribute, for example pt-BR or en. |
| viewport | Viewport meta exists | warning | 3 | Viewport meta present | viewport field or a matching problem | Add a responsive viewport meta tag. |
| image_alt | Images have alt text | warning | 5 | Every image has alt text, or empty alt when decorative | images field or a missing-alt problem | Add meaningful alt text, or alt="" for decorative images. |
| jsonld_valid | Structured data parses | error | 5 | Every JSON-LD block parses | structured data field or a matching problem | Fix invalid JSON-LD so parsers can read it. |
| internal_links | Internal links are present | warning | 4 | Internal link count at least 1 | internal link count | Add contextual internal links to relevant pages. |
| open_graph | Open Graph metadata is present | info | 2 | At least 2 og: tags | Open Graph field or a matching problem | Add og:title and og:description or og:image for social previews. |

Base total weight: 73.

## Page-type checks

Text-signal checks pass when at least one signal term, in the page's language, appears in the title, meta description, headings or the opening paragraphs (read_page). Example terms are listed; use their equivalents in the page language. Evidence is the term plus a short excerpt.

### home

| ID | Check | Severity | Weight | Pass rule | Measured by | Repair |
|---|---|---|---|---|---|---|
| home_schema | Organization or WebSite schema | warning | 7 | Schema types include Organization, WebSite or LocalBusiness | structured data field or matching problem | Add Organization and WebSite structured data. |
| home_navigation_depth | Home links to core sections | warning | 5 | Internal link count at least 4 | internal link count | Link from home to products or services, content, about and contact. |
| home_content_depth | Home has enough crawlable copy | info | 4 | Word count at least 250 | word count | Add concise copy on the offer, audience, proof and next step. |

### ecommerce_product

| ID | Check | Severity | Weight | Pass rule | Measured by | Repair |
|---|---|---|---|---|---|---|
| product_schema | Product schema exists | error | 8 | Schema types include Product | structured data field or matching problem | Add Product schema with name, image, offers and availability. |
| product_commerce_signals | Commerce signals are visible | warning | 5 | Terms such as price, buy, in stock, availability, preço, comprar, estoque, disponível, a currency sign | read_page | Show price, availability or a buying action in crawlable text. |
| product_image | Product image exists | warning | 4 | Image count at least 1 | images | Include at least one product image with alt text. |
| product_trust | Trust details are present | info | 3 | Terms such as review, warranty, shipping, returns, avaliação, garantia, entrega, troca | read_page | Add review, warranty, shipping or return details when true. |

### service_product

| ID | Check | Severity | Weight | Pass rule | Measured by | Repair |
|---|---|---|---|---|---|---|
| service_schema | Service or Product schema exists | warning | 7 | Schema types include Service, Product, LocalBusiness, ProfessionalService or Organization | structured data field or matching problem | Add the schema type that matches the offer. |
| service_offer_clarity | Offer and next step are clear | warning | 5 | Terms such as service, solution, consulting, plan, quote, contact, serviço, solução, consultoria, plano, orçamento, contato | read_page | Make the offer, audience and next step visible in crawlable text. |
| service_supporting_links | Links to supporting content | info | 3 | Internal link count at least 2 | internal link count | Link to proof, cases, about, contact, FAQ or related content. |

### blog

| ID | Check | Severity | Weight | Pass rule | Measured by | Repair |
|---|---|---|---|---|---|---|
| article_schema | Article schema exists | warning | 7 | Schema types include Article, BlogPosting or NewsArticle | structured data field or matching problem | Add Article or BlogPosting schema with headline, author and dates. |
| blog_depth | Content has depth | warning | 5 | Word count at least 500 | word count | Expand thin articles with original explanation, examples and answers. |
| blog_h2_structure | Uses section H2s | info | 3 | H2 count at least 2 | H2 | Use H2 sections that map to the reader's questions. |
| blog_author_date_signals | Author and date are visible | info | 3 | Terms such as author, published, updated, autor, publicado, atualizado, or a visible date | read_page | Show author and publish or update dates in text and schema. |

### about

| ID | Check | Severity | Weight | Pass rule | Measured by | Repair |
|---|---|---|---|---|---|---|
| about_schema | About page schema exists | warning | 7 | Schema types include AboutPage, Organization, Person or LocalBusiness | structured data field or matching problem | Add AboutPage plus Organization or Person schema. |
| about_identity | Identity signals are visible | warning | 5 | Terms such as team, history, mission, experience, founder, company, equipe, história, missão, fundador, empresa | read_page | State who is behind the business, its history, team and expertise, when true. |
| about_contact_trust | Contact path is visible | info | 3 | Terms such as contact, email, phone, address, LinkedIn, contato, telefone, endereço | read_page | Add a clear contact or verification path. |

### unknown

Base checks only.

## Score and grade

- Points awarded per check: its full weight on pass, 0 on fail, excluded on not measured.
- Checklist score = round(sum of points awarded / sum of weights of measured checks × 100).
- Coverage = sum of weights of measured checks / sum of weights of all applicable checks × 100.
- Grade: A at 90 or more, B at 80 or more, C at 70 or more, D at 50 or more, F below 50.
- Blocking failure: any failed check with severity critical or error.

Example of calculation memory for a blog page: applicable weight 91 (73 base + 18 blog); not measured: html_lang, viewport, jsonld_valid, open_graph, article_schema (weight 20); measured weight 71; awarded 44; lost 27; score round(44 / 71 × 100) = 62; coverage round(71 / 91 × 100) = 78%; grade D.

## Fix order

1. Severity rank: critical, error, warning, info.
2. Within a severity: higher weight first.
3. Same failure on two or more sampled pages of one template: one template fix, ranked above single-page fixes of the same severity.
4. Dependencies: http_status_2xx and indexable_robots before everything on that page; single_h1 before heading_hierarchy; canonical_absolute before any duplicate-content work.
5. Keep the top 8.

## Speed bands (unscored)

- First byte: good up to 0.8 s, needs improvement up to 1.8 s, poor above 1.8 s.
- Load time: no fixed band. Report the value and mark a page "slowest in sample" when it takes more than twice the sample median. One lab fetch is not a Core Web Vitals result.

## Verification after fixes

Run page_audit on the same URL. Compare the same check IDs, the checklist score with its coverage, and page_audit's score. A fix is verified only when its check moves from fail to pass on the new result.
