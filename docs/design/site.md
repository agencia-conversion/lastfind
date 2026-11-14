# Lastfind site design (apps/site)

Scope: home, features, pricing, legal pages, the 404, the public header and footer, the sign-in page (`auth.css`), the blog chrome and the documentation page (`/docs`, both editions: `packages/core/components/lastfind/docs/`, on the site's type steps, tokens only, light and dark).
The site and the app are one brand. They share the same family, blues, grays, CTA blue, focus rule and tokens (`packages/core/app/tokens.css`). The site's type is larger, but follows fixed steps.
This is the one source of the visual rules for every page outside the app; the app follows [shell.md](shell.md). Keep this file updated in the PR that changes it (guard `tests/design-docs.test.mjs`).

## 1. Principles
1. **One brand blue** (`--primary`), for actions and links only, never for paragraphs.
2. **Tokens only.** No hex in site CSS. Artwork-bound colours (the hero gradient's end, the night under the cosmos fallbacks, Google's sign-in button, the browser bar's `theme-color`) are allowlisted in `tests/design-rules.test.mjs` (`HEX_ALLOWED`) with their reason. A new value goes into `tokens.css` with a light and a dark pair.
3. **A pattern used twice is one class or one Astro component.**
4. **Readability.** Nothing below 12px, paragraphs at 16px or larger, links and buttons at 14px or larger.
5. **English and pt-BR, 390px to 1440px+.** `prefers-reduced-motion` stops films and shader motion.
6. **Separators.** No `·`, `•`, `|` or ` — ` used as separators. Arrows are always `CtaArrow` (Astro; the Cloud's React pages use lucide `ArrowRight` and `ArrowLeft` at 16px, the same glyph); a path's separator is a chevron icon, never a typed "/" or "›".
7. **Copy.** No provider names in customer copy (search data, the AI service, hosting, email, the bot check), except where the independent installation's guide must name the key it asks for and the legal pages (guard `tests/no-provider-name.test.mjs`); never an internal name, a ticket or a batch number.

## 2. Tokens
- **Surfaces.**
  - `--background`
  - `--surface-subtle` (gray band)
  - `--primary-tint` (spotlight card)
  - `--primary-wash` (hover of light buttons)
  - `--site-ink`, `--site-ink-foreground`, `--site-ink-muted` (dark footer; also the sign-in card's text)
- **Text.**
  - Headings: `--foreground`
  - Paragraphs: `--text-subtle`
  - Notes, captions, legal meta: `--muted-foreground`
  - Eyebrow: `--text-secondary`
  - Disabled: `--text-disabled`
  - Blue text on the pages that follow a dark theme (docs, blog chrome, 404): `--link`, the brand blue on light and a lighter blue (AA) on the dark canvas.
- **Lines.**
  - `--border` (cards)
  - `--border-strong` (controls)
  - `--primary-soft-border` (blue decoration)
- **Action.**
  - `--primary`, `--primary-hover`, `--primary-foreground`
  - `--action-height` (52px)
  - `--action-glow`
- **Focus.** `--ring`, `--primary-focus-surface`.
- **Sign-in** (`auth.css`, always the night card over the cosmos, in every theme): `--auth-canvas`, `--auth-surface`, `--auth-line`, `--auth-label`, `--auth-link`, `--auth-link-strong`, `--auth-accent`, `--auth-focus` (also the page's `--ring`), `--auth-field`, `--auth-field-border`, `--auth-field-focus`, `--auth-placeholder`, `--auth-segment`, `--auth-segment-active`, `--auth-error`, `--auth-error-text`, `--auth-error-surface`, `--auth-error-foreground`. Text is `--site-ink-foreground` and `--site-ink-muted`.
- **Layout.**
  - `--site-content-width: 1120px`
  - `--site-gutter: 24px` (20px under 768px). A full-width band pads its content with `max(var(--site-gutter), calc((100% - var(--site-content-width)) / 2))`.
  - `--radius-3xl: calc(var(--radius) + 16px)` = 24px
- **Type** (in `tokens.css`, read by the site and the shared components):
  - `--text-caption|body|section|title|metric` with `--line-height` pairs, `--weight-*`.
  - The site steps: `--text-display`, `--text-h1`, `--text-h2`, `--text-h3`, `--text-h4`, `--text-lead`.

## 3. Type scale (Plus Jakarta Sans Variable)
| Role | Token | Desktop | Under 768px | Weight | Tracking |
|---|---|---|---|---|---|
| display (home hero h1, closing h2) | `--text-display` | 64/76 | 40/48 | 600 | -1.6px / -1px |
| h1 (page hero) | `--text-h1` | 56/66 | 40/48 | 600 | -1.5px / -1px |
| h2 (section) | `--text-h2` | 40/48 | 32/40 | 600 | -1px / -0.8px |
| h3 (card title) | `--text-h3` | 24/32 | 24/32 | 600 | -0.5px |
| h4 (small card, FAQ question) | `--text-h4` | 18/28 | 16/26 | 600 | 0 |
| lead | `--text-lead` | 18/28 | 16/26 | 500 | 0 |
| body | `--text-section` (16/24) | 16/26 on the site | 16/26 | 500 | 0 |
| ui (nav, links, badges, table) | `--text-body` | 14/21 | 14/21 | 500 | 0 |
| button | `--text-body` | 14/21 | 14/21 | 600 | 0 |
| caption (notes, legal meta) | `--text-caption` | 12/16 | 12/16 | 500 | 0 |
| eyebrow | `--text-caption` | 12/16 | 12/16 | 600, uppercase | 0.08em |

- **Medium rule.** Body, lead, nav and ui text are 500. Buttons, eyebrows and headings are 600. The header nav and its menus are 500; GitHub (the one bold link, in `--foreground`) and the header CTA are 600.
- **No other sizes** (guard `tests/site-design.test.mjs`): no rem or clamp sizes, the legal pages included.
- **Headline emphasis.** The gradient is only in the home hero h1. A hero heading may carry one accent line in `--primary` (the pricing hero and its open-source band, `pricing.css`); the documentation index's h1 takes its second line (`em`) in `--muted-foreground`; everywhere else, `em` is plain (not italic, not blue).

## 4. CTAs
- **Primary.** `.btn.btn-primary`.
  - Pill (`border-radius: 999px`), `height: var(--action-height)`, `padding: 0 20px`, 14/600.
  - `background: var(--primary)`, `color: var(--primary-foreground)`.
  - Hover and `:focus-visible`: `background: var(--primary-hover)`, `box-shadow: var(--action-glow)`, no movement.
  - Trailing `CtaArrow` when it leads onward. One primary per section.
- **Header primary.** `.lf-public-cta`: the same colours and hover, 40px tall, one element whose label follows the session. The header's right side is one component on every page that shows it (home, features, pricing, blog, docs, legal, 404), in two states:
  - **Signed out (conversion).** The language menu, the round button (user icon) that signs in, and the blue CTA **Start for free / Começar grátis** to sign-up (`/app?signup`: the sign-in page opened on Create account; every Start for free and Create a free account on the site, blog and 404 links there, while Sign in and Open app stay on `/app`). Open app never shows signed out.
  - **Signed in.** The language menu, the avatar (photo or initials) that opens the account menu (name and email, Open app, Settings, Sign out), and the CTA **Open app / Abrir app**.
  - The static HTML and the session check render the signed-out pair with the round button as a placeholder, so the page stays cacheable and carries no identity; the session is read in the browser (`/api/auth/session`). The CTA keeps its 144px, so the header never changes shape.
  - **Under 1180px** (where the menu button replaces the nav) the header is the logo and the menu button alone, never a CTA beside it. The menu opens with the session as two catalog buttons side by side at `--action-height`, above the links and set apart by a `--border` line: **Sign in / Entrar** (`.btn-light`) and **Start for free / Começar grátis** (`.btn-primary`), or, signed in, the avatar's account menu and **Open app / Abrir app**. The links follow, then the language menu. Esc closes it, focus returns to the menu button and the page behind does not scroll.
- **Divider.** On desktop, where the nav shows (from 1180px), a straight vertical line sets the right side apart from the nav: the catalog `Separator` (`orientation="vertical"`, `.lf-public-divider`), 1px by 20px in `--border`, just left of the language menu. It hides with the nav and is the same on the site, docs, blog and 404 (one header). No other separator in the header.
- **Language menu.** One component, `packages/core/components/lastfind/public-menu.tsx` (`LanguageMenu`), in the header and on every page outside the app (sign-in, profile, AI app consent, the independent installation's sign-in and docs): the flag emoji, the code (PT, EN) and the chevron beside them, opening on hover or focus. Its menu is just its content (`max-content`, 4px frame, 8px rows at least 40px tall), never a fixed column: each row is the flag and the language alone (Português, English; the flag says the country), with a check on the current one. On the site each language is a link to the page in that language; elsewhere it switches in place. The app's account menus keep the language submenu (`LanguageSwitcher submenu`).
- **Secondary.** `.btn-light`: `--background` fill, `1px solid var(--border)`, hover `--primary-wash`.
- **GitHub.** In the header and the mobile menu GitHub is a plain nav link after Demo (`.lf-public-github-link`): the GitHub mark (16px, filled, `GithubMark`) and the word GitHub in bold (600, `--foreground`), no box, border or count. `.btn-github` (hero) and the stars button `.lf-public-github` (`github-stars.css`, only in the home's open-source section): white `--background` fill (the public surfaces keep their light tokens in dark mode), `--border-strong`, `--secondary` on hover; it sits beside a primary button, so it is that button's pill at `--action-height`, with the live star count.
- **Text link.** `.text-link`: 14/600, `--primary`, `CtaArrow`, underline on hover or focus. It is 14px everywhere, card links included.
- **Sign-in submit.** The catalog `Button` with `btn btn-primary` (the same rules in `packages/core/app/globals.css` for the Cloud pages: sign-in, blog, errors), at `--action-height`; Google's button beside it is as tall. `auth.css` only turns the email submit into the outlined second path when Google is offered.
- **App parity.** The app's `Button variant="default"` uses the same `--primary` / `--primary-hover` / `--action-glow`.

## 5. Focus
```css
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
:focus:not(:focus-visible) { outline: none; }
```
This is declared once, in `apps/site/src/styles/base.css` (the Cloud pages use the same rule in `globals.css`; the sign-in page only sets its `--ring` to `--auth-focus`). FAQ summaries (`.faq summary`, in `base.css`) and menu rows may add `background: var(--primary-focus-surface)` and use `outline-offset: -2px`. There are no other focus rules.

## 6. Radius, cards, shadows
- **Radius.**
  - Controls: 8px (`--radius`).
  - Buttons and pills: 999px.
  - Small cards (price, how-it-works, related, terminal, preview): 16px (`--radius-2xl`).
  - Large cards and bands (feature grid, spotlight, catalog, open-source band): 24px (`--radius-3xl`).
  - Nothing else.
- **Cards.** Padding 24px (32px for large cards on desktop), `1px solid var(--border)`, no shadow. Only the product preview and the terminal have a shadow, `--shadow-preview`.

## 7. Sections
- **Rhythm.** Main sections have 96px vertical padding on desktop and 64px under 768px. Gray bands have 64px and 48px.
- **Width.** Content is `--site-content-width` (1120px) with `--site-gutter`. The public header's inner width is the same 1120px plus its gutters (`public-header.css`), so the logo lines up with the content's left edge. The home preview is 1120px.
- **Allowed blocks** (one implementation each):
  1. Hero: the photographed Milky Way under the horizon (section 8).
  2. Engine strip.
  3. `.section-intro`: eyebrow, h2, lead; centred, max 760px. This is the only section heading. `.section-intro-start` is the same block aligned left, where it sits beside or above its content (pricing's comparison, the FAQs, related features); a `.text-link` in it goes to the end of the row.
  4. Card grid: 3 columns, 2 on tablet, 1 on mobile, gap 24px.
  5. Spotlight: 2 columns on `--primary-tint`.
  6. Band: full width on `--surface-subtle`.
  7. Pricing.
  8. FAQ: one pattern, `.faq`: a `.section-intro-start` on the left, `details` with a `+`/`−` in `--primary`, h4 question, body answer, `border-bottom: 1px solid var(--border)`. Feature pages and pricing.
  9. Closing: `.closing`, telescope, eyebrow, display h2, an optional lead line, primary CTA. Home, pricing and the features index.
  10. Dark footer on `--site-ink`: one stylesheet, `site-footer.css` beside the public header, with the brand lockup, read by the Astro site and by the Cloud's blog, docs and catalog (`brand.tsx`).
- **Screen-reader text.** One `.sr-only` in `base.css`.
- **404.** `not-found-page.tsx` (Cloud): the site header and footer around one centred block, eyebrow 404, h1, lead, the primary CTA beside Back to home (`.btn-light`), then links to the docs, blog, features and pricing. The CTA follows the header's session state (`NotFoundCta`): Start for free / Começar grátis signed out, Open app / Abrir app signed in, Start for free to `/app?signup`, Open app to `/app`. Its language is the address's (`/pt-br/...`), then the reader's cookie; title "Page not found: Lastfind" / "Página não encontrada: Lastfind", `noindex`, status 404. A missing blog article shows the same block inside the blog layout, with Back to the blog.

## 8. Imagery
- **3D glass illustrations.** webp, 240px in cards, 400px in a feature hero (260px under 768px), 120px in the catalog, `mix-blend-mode: multiply` on white.
- **The cosmos.** One photographed Milky Way (`cosmos-auth*`, `design/cosmos/README.md`) is the night of the home hero and of the sign-in pages; nowhere else. On the home the horizon (CSS gradient, then the shader's glow and drifting stars) sits under it and the photo is screened over it, faded in on the horizon's ellipse; under 768px a soft `--site-ink` ellipse keeps the caption AA over the portrait's Milky Way. No drawn Milky Way, galaxy or star rays.
- **Loading.** An image above the fold (the hero sky) is AVIF with a WebP fallback, chosen per media query and preloaded for that media query with `fetchpriority="high"`, only on the page that shows it. Everything below the fold is `loading="lazy"` (films `preload="none"`); a CSS background loads with the page wherever it is, so one below the fold is a light AVIF/WebP (the closing band's is 7 KB). Fixed boxes or reserved space only, no layout shift (CLS 0). Measure the home's LCP at 390 (slow 4G, 4x CPU) and 1280 before and after a change to the hero.
- **Higgsfield films.** They play once over their first frame and are skipped under reduced motion.
- **Engine logos.** 22px, full colour.
- **Telescope.** 192px on desktop, 144px on mobile.
- **Decorative images.** `alt=""` and `aria-hidden`. No stock photos, emoji or sparkles.
- **Feature illustrations.** Each feature page has its own 3D glass illustration (800px square webp with transparency, under 120 KB), never another feature's or a home card's.
- **Feature illustrations, new ones.** Generated with GPT Image (Higgsfield `gpt_image_2_5`, transparent background) from three of the set as references (prompt monitoring, competitor analysis, source intelligence): the same two-tone glass, deep `--primary`-like blue parts with pale frosted ones, in a three-quarter view. Compare it beside its neighbours before keeping it.
- **Docs screenshots.** The public demo project (never a customer's), light theme, a 1280x800 window, webp, one per language, with alt text that says what the screen shows; shown full width in the reading column with `--border` and `--radius-2xl`, and a link to the full-size image.

## 9. The home product preview
It renders the real shell components (`OverviewPreview.tsx`) at the shell's sizes (`preview.css` reads the type utilities from `tokens.css`), scaled as a whole if it needs to fit: from 1200px it is a 1280px app with `zoom: 0.875` (1120px), on a phone a 400px app at `0.875` (`0.8` under 390px), on a small tablet (768 to 1023px) a 1024px app at `0.7`, so its screens keep their tables whole, and from 1024 to 1199px it is drawn at its real width. A sidebar item without a screen of its own but with a feature page (AI bots) opens that page. It does not restyle them (no 13px base, 20px titles or 12.5px buttons in `preview.css`). When the shell changes, the preview follows.
Every sidebar item has its screen (`PreviewScreens.tsx`), on the demo fixture only. Semantic Branding shows the app's radar (`SemanticRadarChart`) beside the brand ranking (`BarList`) on one row, as the Overview's Semantic Branding row; they stack when the preview is narrow (`.preview-pair`).

## 10. Documentation
- One URL per page and language: the index (`/docs`, `/pt-br/docs`) and a page per section (`/docs/<id>`, `/pt-br/docs/<id>`, the same slug in both). Links from a page go to its language's docs (`publicDocs(locale, section?)`); a feature page links to its docs page with a `.text-link` under its context paragraphs.
- **Layout.** The header's content box (1120px plus gutters): the sidebar (220px) lines up with the logo, "On this page" (180px, from 1280px) with the header's CTA, and the reading column takes the rest (about 640px, 16/26 text). The page's title sits at the top of the reading column, so the sidebar starts right under the header.
- The title block opens with the catalog `Breadcrumb` (Home > Documentation, then the section), not an eyebrow. One h1 at the h2 step (40/48): the index's title, or the section's title with its description as the lead. A section's parts are h2 (`DocsH2`); the index lists each group (h2) as a `dl` of its pages (the link, then what it covers).
- **Sidebar.** Sticky, the documentation home link, then one disclosure per group (`details name="docs-groups"`: label 14/600 `--foreground` and a chevron that turns). Only one group is open at a time: the current page's (the first on the index), so the menu fits a 700px-tall window without a scroll bar of its own; it scrolls only on shorter screens. The current page is marked (`--primary`, 2px left rule). Under 900px it collapses behind one button that names the current page, with the same groups inside. Pattern taken from the Vercel and Mintlify docs (collapsible groups, current group open); Tailwind's always-open list is what made ours scroll.
- "On this page" lists the page's parts (the index's groups) and marks the one being read.
- A section page ends with **Related** links (`.docs-related`: the eyebrow label, then 14/600 `--primary` links), then the previous/next pager.

## 11. Titles
Document titles follow the separator rule too: no `|`, ` — ` or `·`. A page names itself, with Lastfind after a colon where it helps ("Metrics: Lastfind documentation", "AI prompt monitoring for brand visibility: Lastfind", "Lastfind: your brand in the answer, by Conversion"); blog articles keep their headline. There is no title template (guard: `tests/no-middot.test.mjs`).

## 12. Do / Don't
- **Do.** Reuse `Eyebrow`, `CtaArrow`, `Brand`, `.btn*`, `.text-link`, `.section-intro`, the FAQ, `.closing`. Check 390px and 1280px+ in English and pt-BR.
- **Don't.**
  - New hex, sizes or radii.
  - A second FAQ, closing or heading block.
  - A typed arrow.
  - Links below 14px.
  - Buttons of different shape or height side by side.
  - Restyling app components in the preview.
