# Lastfind app — design system

The logged-in app (`/app`) is a single product: `LiveAnalyticsApp` (`components/analytics/live-app.tsx`) on top of the edition's authentication gate. The public demo (`/demo`, Cloud) renders the same component with the fixture client; `/app/preview` no longer exists as a second copy. Its URLs redirect: Cloud sends them to `/demo` (keeping the section and period), selfhost, which has no public demo, sends them to the owner sign-in at `/app`.

The marketing site still renders a static illustration with the fixture helpers `demo-data.ts`, `workspace-data.ts`, `analytics-sidebar.tsx` and `overview.tsx` (`OverviewMetrics`, `BrandRanking`); those pieces use the same tokens and components but are not an app.

## Type scale and weights

One scale for every screen, dialog and sheet of the app. Tokens are in `app/globals.css` (`@theme static`); Tailwind's `text-xs` and `text-sm` are mapped onto the first two, so the vendored shadcn primitives follow the scale without being edited.

| Token | Size / line | Use |
| --- | --- | --- |
| `text-caption` (`text-xs`) | 12 / 16 | metadata, axis labels, badges, column headers, legends, footnotes |
| `text-body` (`text-sm`) | 14 / 21 | body, table cells, inputs, buttons, menus, descriptions |
| `text-section` | 16 / 24 | section and card titles, dialog and sheet titles |
| `text-title` | 24 / 32 | page title (`h1`) |
| `text-metric` | 24 / 32, tabular | metric value in `MetricCard` |

- Nothing below 12px, on desktop or on phones (badges and helper text stay at 12px on small screens).
- Weights: 400 for text and table cells, 500 for labels, controls, titles and metric values. The cap is medium (`--weight-strong`, the single place to change it). No 600/700, no `font-semibold`/`font-bold`; `b`/`strong` in the app render at 500 and inherit the cell weight inside tables.
- Inputs, selects and textareas are weight 400, also inside dialogs and sheets (portals).
- Numbers are `tabular-nums`. Font family stays Plus Jakarta Sans.
- In CSS use `var(--text-caption|body|section|title|metric)`; in TSX use the matching Tailwind class. `tests/app-typography.test.mjs` fails on a literal `font-size`, `text-[..px]`, a weight other than 400/500, `font-semibold`/`font-bold` or `text-base`+ in `components/analytics` and `components/lastfind`.
- Documented exceptions: inputs use `text-section` (16px) on phones to avoid iOS zooming on focus; the Semantic Branding radar draws in SVG units and scales the token with `--radar-unit` so it renders at a true 12/14px; vendored `components/ui` is not scanned (its `text-[0.8rem]` small button and calendar labels, and the browser's `small`, are pulled to `text-caption` by `overview-presentation.css` inside the app).

## Links

Links in the app have no underline at rest and underline on hover (`text-underline-offset: 3px`); keyboard focus keeps the global focus ring. Anchors drawn as buttons (`DrillLink plain`, `buttonVariants`) and menu items never underline. The rule lives in `overview-presentation.css` and also covers dialogs, sheets and popovers.

## Shared components

All in `components/lastfind/presentation/`, composed on the shadcn primitives (which stay untouched). `core` does not import Cloud, and each works the same in both editions.

| Component | Use |
| --- | --- |
| `SectionHeader`, `SectionCard` | the only section/card shell: title, optional description, action; `padded` insets text and lists, tables and charts go edge to edge |
| `MetricCard`, `MetricGrid` | metric label with a definition tooltip, 24px value, one-line explanation, change against the previous period. A missing value is `—` with an explanation, never `0` |
| `DataTable` | the only data table: 12px muted 500 headers, 14px 400 cells (domains, brands and names are never bold), numbers end-aligned and tabular, rows stacked as cards below 640px. Options: `mobile` (`hide`/`title`/`wide`/`check`/`actions`), `label`, `width` (renders a `colgroup`), `headerOnly` + `hideHeader` for a sticky header copy, `tableRef`, `rowState` |
| `TrendChart`, `SeriesLegend` | the only line chart. `series` arrives already ordered by `orderSeriesByTotal` (`lib/chart-series.ts`): largest total of the selected period first, ties keep their original order, series without data last, position (lower is better) ascending. Lines, tooltip and legend follow that one order; each brand keeps a fixed colour (`seriesColorVar`, one place to change) |
| `TagBadge` | the only badge/chip: 12px, 500; tones `neutral`, `primary`, `danger`, `quiet` (dashed, "not classified"), `muted`; the label always names the state |
| `EmptyState` (`analytics/shared.tsx`) | the only empty, unavailable and error state; `tone="error"` adds `role="alert"`; `bare` drops the frame inside a card |
| `PageHeading`, `AnalyticsSkeleton` | page title and loading state |

Removed variants: `.panel-title`, `.panel-heading`, `PanelHeading`, the per-screen metric cards and score cards, the hand-written tables and chart axes, `.st-chip`/`.st-badge`-style chips, and the dead `kpi-strip`, `brand-ranking-table`, `response-table`, `visibility-drilldown`, `status-badge`, `empty-state` and `data-toolbar` files.

## UI reference and scope

The public [Peec AI product preview](https://peec.ai/) informed the compact analytics layout. Its [performance documentation](https://docs.peec.ai/understanding-your-performance) informed visibility trends, brand rankings, source tables, recent responses and evidence drilldowns. Its [sidebar documentation](https://docs.peec.ai/sidebar-navigation) informed workspace navigation, search and source views. These references were reviewed on September 10, 2026.

The implemented navigation is Overview, Prompts, Brands, Sources, AI models, Chats, Semantic Branding and Settings, plus a guided project onboarding. This round covers Lastfind's core analytics workflow; shopping, crawler analytics and other Peec product areas are outside its scope. Lastfind retains its own identity, labels and explicit evidence semantics.

## Preserved Conversion theme

The existing [Conversion theme from TweakCN](https://tweakcn.com/themes/cmg2mgpqd000404jman9ofw2p) remains the token source. Light and dark values live in `app/globals.css`; the application defaults to light.

| Token             | Light value                                           | Purpose                                       |
| ----------------- | ----------------------------------------------------- | --------------------------------------------- |
| Primary / ring    | `#1649FF`                                             | Main actions and keyboard focus               |
| Foreground        | `#020817`                                             | Primary text                                  |
| Background / card | `#FFFFFF`                                             | Working surfaces                              |
| Sidebar           | `#F8FAFC`                                             | Navigation and table headings                 |
| Sidebar accent    | `#EEF2FF`                                             | Selected navigation                           |
| Muted foreground  | `#64748B`                                             | Secondary text                                |
| Border / input    | `#E2E8F0`                                             | Dividers and controls                         |
| Chart 1–5         | `#1649FF`, `#4F74FF`, `#8B9EFF`, `#0D2C99`, `#091D66` | Source distribution                           |
| Brand series      | Blue, teal, violet, amber, rose and slate             | Distinct players; own brand retains `#1649FF` |

Plus Jakarta Sans remains the heading and interface typeface, with monospace for code. The prototype uses a compact 13px application base, 11–12px table and control text, smaller supporting metadata, and prominent metric values. Spacing follows the existing 4px base and 8px theme radius. White panels, light dividers and restrained blue accents keep dense analytical content readable.

Compose the installed shadcn Base UI primitives at call sites; do not overwrite the vendored `components/ui` catalog. The new sidebar uses `SidebarProvider`, `SidebarInset`, `SidebarTrigger` and `SidebarRail`, supports icon collapse and mobile navigation, and retains the existing `sidebar_state` preference cookie. Shared product layout classes remain in `app/globals.css`, loaded for every edition through the `ApplicationStyles` client boundary.

## Frontend contracts

`components/analytics/`:

| File | Responsibility |
| --- | --- |
| `live-app.tsx` | the app: shell, navigation, filters, every screen (Overview, Prompts, Brands, Sources, AI models, Chats, Opportunities, Semantic Branding, Settings, project creation) and its detail views |
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

English is the default, with pt-BR interface copy through `useI18n` and `useCopy`. `useNumbers` formats every displayed metric using `en-US` or `pt-BR` (for example `1,120.5` and `1.120,5`). Fixture prompt text is sample content. AI model icons remain local assets; the current Lastfind telescope is `public/lastfind/brand/icon-3d.png`, with its canonical path in `lib/lastfind-brand.ts` and provenance in `public/brand/README.md`. Brands and sources use favicons. Dropdowns open below their trigger with a 6px gap and consistent 14px text (`text-body`), 6px popup padding and 36px option height, flipping only where the viewport requires it. Accessible labels, keyboard navigation, visible focus and reduced-motion behavior remain part of the interface contract. The decorative source donut does not receive focus; its text legend exposes categories and counts.

The sidebar project selector shows only the project name and favicon. The main trend chart fills the height of its panel alongside the ranking, with a minimum plotting height for stacked layouts. Settings tabs use two columns on narrow screens and four on larger screens, without horizontal scrolling. Interactive elements use a pointer cursor, while disabled controls and text fields retain their appropriate cursors.

The telescope fits its 32px button when the sidebar collapses; the brand link has no hover background and retains a visible keyboard focus ring. The date selector composes shadcn Popover and Calendar with presets, localized text inputs, two months on desktop and one on mobile. Changes stay in a draft until Apply; Cancel or dismissal preserves the applied range. Inputs accept slashes or eight digits, including from mobile numeric keyboards. Calendar day buttons forward their focus ref so arrow keys and Enter select the intended day.

Custom periods include both endpoints and compare against the immediately preceding interval of equal length. The daily chart and CSV exports use those dates. Ranges are limited to 366 days between 2000 and the latest demo date; the picker identifies the synthetic data coverage (July 16–September 9, 2026). Presets include yesterday, 7/14/28/30 days, this month and last month. Apply and Cancel remain visible while scrolling the mobile picker.

The loading indicator uses the same current telescope PNG as the public header and app, with a CSS transform animation. It does not load an animation library; reduced-motion preferences disable the movement while retaining the localized status text. The owner welcome screen also uses the current telescope identity.

## URL contract

Paths are language-independent. `{base}` is `/app`, behind the edition authentication gate. Every authenticated descendant checks authentication before resolving or rendering the destination. Successful login returns to the requested path and filters. App responses carry `no-store` and `nosniff`; route metadata discourages indexing.

| Destination        | Path after `{base}`                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Project analytics  | `/workspaces/{workspace}/projects/{project}/{overview,prompts,brands,sources,models,chats,semantic-branding}` |
| Prompt performance | `/workspaces/{workspace}/projects/{project}/prompts/{id}-{readable-title}`                                    |
| Brand details      | `/workspaces/{workspace}/projects/{project}/brands/{brand-id}`                                                |
| Source details     | `/workspaces/{workspace}/projects/{project}/sources/{domain}`                                                 |
| Answer details     | `/workspaces/{workspace}/projects/{project}/chats/{response-id}`                                              |
| Workspace settings | `/workspaces/{workspace}/settings/{workspace,members,projects}`                                               |
| User profile       | `/account/profile`                                                                                            |
| Guided setup       | `/onboarding`                                                                                                 |

Workspace and project slugs are unique in their respective scopes and stay fixed when names change. Prompt links resolve by stable ID, so an earlier title in a shared link still works. Internal entity IDs and existing backend API routes are unchanged. Unknown paths are rejected; missing or inaccessible entities show an explicit unavailable state without rendering another project's analytics.

The `days`, `models`, `country`, `topic` and `tag` query parameters preserve global analytics filters. Defaults are omitted; models use lowercase comma-separated names, or `none` for an empty selection. Navigation creates history entries; filter adjustments replace the current entry to keep multi-selection from flooding browser history. Back/forward restores context, filters and open details together. Existing `?tab=`, `?prompt=` and single `?model=` links redirect to the canonical structure. Table search, local sort and edit dialogs remain transient UI state.

Custom dates use `from=YYYY-MM-DD&to=YYYY-MM-DD` instead of `days`. Strict UTC parsing rejects impossible dates, reversed ranges and incomplete intervals; invalid links normalize to a supported preset or the default 28 days. Choosing a relative preset clears custom dates while retaining other filters.

For example: `/app/workspaces/conversion/projects/conversion/overview?days=14`. Account profile is independent of project context. Old `/app/preview…` links redirect (see the top of this document), keeping the section and `days`.

## Preview and validation

From the repository root:

```sh
npm ci
npm run dev -- --port 3001
```

Open `/app` (the edition authentication gate) or, in Cloud, `/demo` for the public demo with real study data. Pull-request previews and the logged-in QA flow are described in `docs/preview.md`.

```sh
npm run typecheck
npm run lint
npm test
npm run build:selfhost
```

Use `npm run verify` for the full repository verification, including isolated backend integration checks. The installer and existing backend continue to follow the root README and architecture documentation.

## Semantic Branding

Semantic Branding reports coverage, canonical share of voice, cited/consulted source evidence and model comparisons over the same filtered responses. Its score weights are disclosed in the report; it is not a competitor's proprietary metric or a validated prediction. Source co-occurrence in an answer does not prove that the page mentions the brand. The report uses `MetricGrid`, `DataTable` and `SectionCard` like every other screen; the radar and heatmap are the only bespoke graphics and follow the same token scale.

## Initial interface refinement — September 11, 2026

The following contracts supersede the compact typography and advanced Semantic UI descriptions above. Source data and advanced research helpers are preserved for their separate integration phase.

- Typography of the app is defined by the type scale at the top of this document (supersedes the 14px/500 base of September 11). Public prose remains 16px or larger. Vendored shadcn primitives remain intact.
- Public/auth CTAs use 52px; header 40px; app/filter actions 38px and 44px on touch layouts. Primary hover/focus uses the shared blue/violet `--action-glow`, without movement; menus/filter triggers retain surface feedback.
- Country/topic/tag accept multiple values: OR within dimensions, AND between. Tags support any/all. Prompts rows honor these dimensions. Repeated query parameters preserve multiple values; old singleton links remain supported. `countryEmpty=1`, `topicEmpty=1`, `tagEmpty=1` distinguish empty from an ordinary label such as none. `tagMode=all` matches every chosen tag. Snapshots clone full arrays.
- Overview has three metrics: visibility, share of voice and average position. No initial route exposes sentiment. Trends fit all brands with rounded padded bounds and retain scale during legend toggles; position is reversed. Source frequency uses one horizontal row per source on a 0–100% response denominator, without synthetic source categories.
- Settings list contains full 44px tab height; active underline uses bottom 0 at its boundary instead of the primitive -5px offset.
- The latest Semantic Branding decision restores the complete frontend report on its primary route: Summary, Score, Radar, Top attributes, Heatmap and Explanations, with internal section navigation, accessible radar tooltips and full-cell heatmap colors. Attribute settings use a dedicated page with validated, context-scoped persistence within the browser tab. Existing research tabs, snapshots and exports preserve their filter scope. This supersedes the earlier simplified Semantic surface; it does not change the evidence-only scope of Overview, Brands or Sources. Cooccurrence does not prove a cited page discusses the brand, and frontend report data does not imply live provider collection.
- The home hero fits its copy to the viewport and reveals approximately the first 110–150px of the preview. Cosmos starts below the actions, retains its native curved horizon, and covers the entire preview stage and caption at the image’s original aspect ratio, without a solid-color tail or end fade. A square Semantic stage uses the feature artwork and four labels on a matching ellipse; reduced-motion fixes distinct positions. Footer uses the generated dark navy/blue/violet gradient without stars. Conversion on dark backgrounds uses the unmodified official monochrome SVG. The footer attribution follows the public header’s visual baseline. Public CTA arrows point right at 16px; metric delta arrows retain their meaning.

## Source types, section navigation and header actions

- Source types use a fixed hue per type (`SOURCE_TYPE_COLORS`: You `#1649FF`, Competitor `#E5484D`, Corporate `#6E56CF`, Editorial `#12A594`, Institutional `#F5A524`, UGC `#D6409F`, Reference `#30A46C`, Other `#8B95A5`, Not classified `#CBD5E1`). Color never carries meaning alone: the chip, legend row and table cell always name the type, and the donut center states the citation total. A legend row is a button that opens Sources filtered by that type. Not classified is a neutral dashed chip with an explanation, never `0%`.
- `SectionSidebar` is the only section navigation (Prompts topics, Brands views, Settings sections): 200px list with 36px ghost buttons, `bg-primary/7 text-primary` for the active item, counts on the right; below 900px a single 44px menu trigger. `filter` lists expose `aria-pressed`, `navigation` lists `aria-current="page"`.
- Export is an icon button with a tooltip and accessible name in the header, next to Help, on every project screen. Page-level calls to action stay in the page heading.
- Forms in dialogs (`PromptDialog`) use `Field`, `FieldLabel`, `FieldDescription` and `FieldError`: label above, help text below, errors after first blur or submit, counters for length limits, a footer with the secondary action first (last on narrow screens) and a primary action that shows progress.
