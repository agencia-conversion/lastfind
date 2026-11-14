# Lastfind app design system

The logged-in app (`/app`) is a single product: `LiveAnalyticsApp` (`components/analytics/live-app.tsx`) on top of the edition's authentication gate. The public demo (`/demo`, Cloud) renders the same component with the fixture client; `/app/preview` no longer exists as a second copy. Its URLs redirect: Cloud sends them to `/demo` (keeping the section and period), selfhost, which has no public demo, sends them to the owner sign-in at `/app`.

The marketing site still renders a static illustration with the fixture helpers `demo-data.ts`, `workspace-data.ts`, `analytics-sidebar.tsx` and `overview.tsx` (`OverviewMetrics`, `BrandRanking`); those pieces use the same tokens and components but are not an app.

## Visual rules

Every visual rule of the app lives in one file, [docs/design/shell.md](../../docs/design/shell.md): type and weights, heights, the header, sidebars, menus, filters and the date range, cards, charts and legends, tables, states, focus, colour, links, icons, the agent's workspace and the "which component for what" table. The site, the docs pages, the sign-in page and the 404 follow [docs/design/site.md](../../docs/design/site.md). Read the matching one before UI work. This file only maps the code: what each component is for, where each screen lives, the URL contract and what the data means; it repeats no visual rule.

Colour, radius, layout, type and weight tokens live in `app/tokens.css` (the single source, `:root` and `.dark`, imported by `app/globals.css` and the marketing site); `app/globals.css` maps them onto Tailwind (`text-caption`, `text-body`, `text-section`, `text-title`, `text-metric`; `text-xs` and `text-sm` follow the first two, so the vendored shadcn primitives follow the scale). `tests/app-typography.test.mjs` and `tests/design-docs.test.mjs` keep the tokens, the docs and the screens in step.

## Shared components

All in `components/lastfind/presentation/`, composed on the shadcn primitives (which stay untouched). `core` does not import Cloud, and each works the same in both editions.

| Component | Use |
| --- | --- |
| `SectionHeader`, `SectionCard` | the only section/card shell: title, optional `info` (conceptual explanation in a tooltip, instead of a legend line), description, action (a "View all" is `ViewAllAction`); `inset="padded"` insets text and lists, tables and charts go edge to edge (`inset="none"`). Never a card inside a card; `loading` is the same card with placeholders while its data loads. A card never repeats the page title above it (Settings and Admin: the shell prints the page title and description, the cards name their own content) |
| `MetricCard`, `MetricGrid` | metric label with an info icon (`InfoHint`) holding the conceptual definition, 24px value and `delta` beside it (just the figure, e.g. `+6.6 pp`; no statistics line such as "n = …" or "versus previous period…"). `description`/`change` are the optional text lines of screens not migrated yet. `MetricGrid columns` is how many fit on one line; `mobilePairs` shows two per row on phones. A missing value is `—` with an explanation, never `0` |
| `DataTable` | the only data table (Notion-style): white header with the same 14px font and row height as cells, hairline row/column borders, numbers end-aligned and tabular, rows stacked as cards below 640px (`singleLine` keeps a real table that scrolls sideways instead). Columns with `sortValue` sort on a click on the header (arrow = direction, `aria-sort`; empty values last); `defaultSort` / `sortRows` set order. `rowLink` makes the whole row the link (pointer, hover, focus ring, Enter, Ctrl/⌘-click opens a tab); cells never hold blue links. Options: `mobile` (`hide`/`title`/`wide`/`check`/`actions`), `label`, `width` (renders a `colgroup`), `fill` (scroll inside; sticky header + summary), `summary` / `summaryAside` (compact pager), `tableRef`, `rowState` |
| `TrendChart`, `ChartLegend`, `TrendCard` | the only line chart. `series` arrives already ordered by `orderSeriesByTotal` (`lib/chart-series.ts`): largest total of the selected period first, ties keep their original order, series without data last, position (lower is better) ascending. Lines, tooltip and legend follow that one order; each brand keeps a fixed colour (`seriesColorVar`, one place to change). `ChartLegend` (`interactive` toggles series; the brands past the first ten wait behind a final "+N", `folded`) is the only legend; `TrendCard` is a `SectionCard` with the chart, its legend and its `loading` and `empty` states |
| `TagBadge` | the only badge/chip, discreet: light fill of the tone and text a little darker, no border, 500, caption size; tones `neutral`, `primary`, `danger`, `success`, `warning`, `quiet` (dashed, "not classified"), `muted`, `outline` (the catalog `Badge` `tone` variant); the label always names the state |
| `UrlCell` (`analytics/url-cell.tsx`) | the only cell for a listed URL: the click opens the URL's page in the app (`DrillTarget` `entity: {kind: 'url'}`) labelled by the page title when known (else the URL, never empty; the URL is the tooltip, `secondary` also prints it under the title), and the icon beside it opens the original in a new tab. No loose `<a target="_blank">` for a URL |
| `Note` | the only note/legend line under a table, chart or list: the card's own inset (`px-5 py-3`), optional icon and action; `tone="danger"` announces a failed read, `status` renders an `output` for progress |
| `InfoHint` | the only information icon: tooltip with the conceptual text, also the button's accessible name |
| `EmptyState` (`analytics/shared.tsx`) | the only empty, unavailable, error and in-progress state, on `ui/empty`: `frame` (`card`, `bare`, `inline`), `tone` (`empty`, `error` with `role="alert"`, `progress`), `onRetry` draws the one retry button |
| `BarList` | the only horizontal bar list (topic coverage, Semantic Branding bars): one 0 to 100 scale, a figure per row (a missing value says why, never a zero), optional `badge` beside the label (a position such as "2nd") and `mark`, a tick at a rival's value named in its balloon |
| `PageHeading`, `DetailHeader`, `DetailBodySkeleton` | page title, the header of a full-page detail (`density="compact"` without the way back; the second row only when it has something) and its body while it loads; a screen's skeleton is the screen's own components with `loading` |

## Navigation and scope

The sidebar (`navigation` in `analytics-sidebar.tsx`) lists Overview, Agent (with Chat, Contents, Artifacts, Opportunities, Brain and Skills under it), Prompts, Semantic Branding, Brands, Sources, Products (with Overview, Brands and Products pages), AI models and Settings, plus project creation; platform admins also see Admin below Settings. Each destination takes its icon from `nav-icons.ts` and no two destinations share one (`tests/nav-icons.test.ts`). The project row shows only the project name and favicon; the switcher menu lists the workspaces and marks the open one.

Settings and Admin swap the main sidebar for their own sections. The Agent's second sidebars (Conversations and Brain on the left) are `SectionSidebar`, their bar a `DetailHeader`; a content's parts are a `SectionSidebar` floating over the page's right edge on a wide screen ([shell.md](../../docs/design/shell.md), sections 4 and 5). The Brain and the artifacts carry no icons; clicking Artifacts in the sidebar always opens the list.

## Theme

The Conversion theme from TweakCN is the token source; light and dark values live in `app/tokens.css`, and the application defaults to light. Compose the installed shadcn Base UI primitives at call sites and extend a catalog component with a variant rather than writing a parallel one. The sidebar uses `SidebarProvider`, `SidebarInset`, `SidebarTrigger` and `SidebarRail`, supports icon collapse and mobile navigation, and keeps the `sidebar_state` preference cookie. Shared product layout classes stay in `app/globals.css`, loaded for every edition through the `ApplicationStyles` client boundary.

## Frontend contracts

`components/analytics/`:

| File | Responsibility |
| --- | --- |
| `live-app.tsx` | the app: shell, navigation, filters and most screens (Overview, Prompts, Brands, Sources, AI models, responses, Opportunities, Semantic Branding, Settings, project creation) and their detail views |
| `app-routes.ts` | the short app address (`/app/<project slug>-<project code>/<screen>/<detail>`): `expandAppPath` reads it, `compactAppPath` writes it; older addresses are rewritten |
| `agent-screen.tsx`, `agent-blocks.tsx`, `artifact-editor.tsx`, `agent-contents.tsx`, `agent-content-overview.tsx`, `agent-step-detail.tsx`, `agent-skills.tsx`, `agent-learning.tsx`, `brain-wizard.tsx` | the Agent: chat, artifacts and their data blocks, content artifacts (Overview tab with the comparison table and the publication block), step details, workspace skills, change notes with Undo and history, Brain wizard |
| `products-view.tsx`, `product-page.tsx` | Products (overview, brands, products) and a product's page |
| `ai-bots-view.tsx` | AI Bots: its three pages (Overview, AI Bots, AI Traffic) with their drill downs, and the Cloudflare connection in Settings (connect, choose zone, replace, disconnect) |
| `brands-filter.tsx`, `overview-topics.tsx`, `overview-sentiment-card.tsx`, `overview-kpis.tsx` | header Brands filter and Overview pieces |
| `route-page.tsx` | edition-agnostic route wrappers (authentication gate, `/app/preview` redirects) |
| `routes.ts` | canonical path builders, parsers, slugs and filter serialization for `/app` |
| `source-entity-page.tsx`, `source-types-ui.tsx` | source and URL details, source types, top sources |
| `semantic-association-report.tsx` | Semantic Branding report (summary, score, radar, ranking, heatmap, explanations) |
| `brand-research-panel.tsx`, `brand-sentiment-analysis.tsx`, `live-competitor-settings.tsx`, `live-monitoring-settings.tsx`, `prompt-dialog.tsx` | brand research, competitor and monitoring settings, prompt form |
| `shared.tsx` | locale-aware copy and numbers, filter controls, favicons, `EmptyState` |
| `demo-data.ts`, `workspace-data.ts`, `analytics-sidebar.tsx`, `overview.tsx` | fixtures and pieces the marketing site still renders |

Screens receive data from the report endpoints (or the demo client) and compose the shared components above; none declares its own sizes, weights, borders or header spacing.

## State, evidence and language

Keep cited source IDs and consulted source IDs distinct. `consultedSourceIds: null` means consulted evidence was not provided; it must never be presented as zero consultations. Domain counts deduplicate within each response. Rates state their denominator, and sample source links do not imply verified provider output or a live crawl.

English is the default, with pt-BR interface copy through `useI18n` and `useCopy`. `useNumbers` formats every displayed metric using `en-US` or `pt-BR` (for example `1,120.5` and `1.120,5`). Fixture prompt text is sample content. AI model icons remain local assets; the current Lastfind telescope is `public/lastfind/brand/icon-3d.png`, with its canonical path in `lib/lastfind-brand.ts` and provenance in `public/brand/README.md`. Brands and sources use favicons. The decorative source donut does not receive focus; its text legend exposes categories and counts.

Periods: custom periods include both endpoints, and "Compare with" sets what every report compares the period with (the previous period of the same length, a custom period or none); the daily chart and CSV exports use those dates. The demo's synthetic data covers July 16 to September 9, 2026 (`DEMO_LAST_DATE` in `analytics/date-range.ts`). Calendar day buttons forward their focus ref so arrow keys and Enter select the intended day.

## URL contract

Paths are language-independent and live under `/app`, behind the edition authentication gate. Every authenticated descendant checks authentication before resolving or rendering the destination; successful login returns to the requested path and filters. App responses carry `no-store` and `nosniff`; route metadata discourages indexing.

The address names the workspace and the project by their slugs: `/app/<workspace>/<project>[/<screen>[/<detail>]]` in Cloud (`/app/<project>/...` in the independent edition), for example `brands/<brand key>`, `prompts/<prompt key>`, `sources/<domain>`; `packages/core/components/analytics/app-routes.ts` builds every address (ARCHITECTURE, App addresses).

Only filters that differ from the default are written (`period=7d`, `start`/`end`, `model=chatgpt,ai-mode`, repeated `topic` and `tag`, `q`). Country, topic and tag accept several values: OR within a dimension, AND between dimensions; tags support any or all. Navigation creates history entries; filter adjustments replace the current entry. Back and forward restore context, filters and open details together. Table search, local sort and edit dialogs remain transient UI state. Strict UTC parsing rejects impossible dates, reversed ranges and incomplete intervals; invalid links fall back to the default period.

## Preview and validation

Run the app with `npm run dev` and open `/app` (the edition's sign-in) or, in the hosted edition, `/demo`. `npm run verify` and `npm run build:selfhost` are the checks; the root README and CONTRIBUTING.md list them.

## Overview and Semantic Branding

The Overview leads with share of voice, average position, visibility and citations, each broken down by AI and each opening the responses it is measured on; sentiment has its own card. The Semantic Branding row puts the bars and the radar side by side: the bars set the row height (room for at least five brands) and the radar shrinks to fit, keeping its proportion. The radar is given every brand of the project and draws the first ten (your brand, then by score); the others wait behind the legend's "+N" (`CHART_SERIES_COUNT`, `lib/chart-series.ts`). Topic coverage uses `BarList`: a badge with the brand's position in the topic and a tick at the leader's value (the runner-up's when the brand leads); a brand not cited in a topic has no position.

Semantic Branding reports coverage, share of voice, source evidence and model comparisons over the same filtered responses. Its score weights are disclosed in the report; it is not a validated prediction, and source co-occurrence in an answer does not prove that the page mentions the brand. The radar and heatmap are its only bespoke graphics.

## Trends

Trends fit the drawn brands with rounded padded bounds and keep their scale during legend toggles; position is reversed (lower is better).
