# Lastfind Conversion — analytics frontend prototype

This round rebuilds the application shell with shadcn/ui and synthetic data. The previous connected shell has been removed from the frontend. `/app` retains the edition authentication gate (Cloud email session or personal owner session), then renders the new prototype; `/app/preview` exposes the same prototype without signing in. The public preview contains only fixed synthetic fixtures, never private project records.

Backend, provider integrations, authenticated APIs, storage, scheduling, installation and Apache-2.0 licensing remain in the repository. This frontend does not call monitoring or provider APIs. A later round will decide whether the engine and backend should be refactored and define the integration contract.

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

The new UI lives in `components/analytics/`:

| File                          | Responsibility                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `analytics-app.tsx`           | Shell, navigation, global filters, in-memory prompt state, search and detail sheets                       |
| `routes.ts`                   | Canonical path builders, parsers, stable slugs and filter serialization                                   |
| `navigation-state.ts`         | URL resolution against the current session, entity scope and unavailable states                           |
| `use-analytics-navigation.ts` | Browser history synchronization and navigation transitions                                                |
| `demo-data.ts`                | Deterministic fixtures, typed prompts/responses, filter selection, derived metrics and browser CSV export |
| `overview.tsx`                | Overview panels, trend charts and brand ranking                                                           |
| `prompts-view.tsx`            | Prompt tables, topics, status tabs, local edits, batch actions and CSV import                             |
| `detail-views.tsx`            | Sources, model comparison and response table                                                              |
| `workspace-data.ts`           | Mock users, memberships, workspaces and scoped project prompt state                                       |
| `workspace-settings.tsx`      | Workspace, project, member, role and profile management                                                   |
| `user-avatar.tsx`             | Local avatar upload, framing and shared user thumbnails                                                   |
| `shared.tsx`                  | Locale-aware copy/numbers, filter controls, favicons and shared panel components                          |

Views receive filtered demo responses and callbacks. Metrics must derive from those responses, so counts, trends and drilldowns remain consistent. Keep production data access out of this folder during the prototype round. The only external image requests are public site favicons from Google's favicon service, with initials as an error fallback. The edition route wrappers control access and render `AnalyticsApp`; authenticated `/app` access does not switch the UI to live data.

## State, evidence and language

All analytics data and generated response text are illustrative. Prompt edits, imported CSV rows, workspaces, projects, profile edits and invitations share in-memory session state and reset after a reload. Prompts are scoped to projects; new projects and workspaces start without collected responses. The seeded Conversion project has the synthetic analytics dataset. Model filters allow any subset, including no models. Overview and Brands CSV exports download the filtered mock brand report in the browser; Prompts also offers a CSV import template. The existing language and sidebar preference cookies are the only persisted UI preferences.

The footer user menu switches between demo users and links to profile, workspaces and members. Workspace access requires an active mock membership. Owners/admins manage settings; members can edit prompts; viewers cannot mutate them. Owners and the acting user's access are protected against accidental removal. Invitations are simulated state only and never send messages. These UI rules prepare the future multi-user contract; they do not replace the existing backend authorization or implement real multi-user authentication.

Keep cited source IDs and consulted source IDs distinct. `consultedSourceIds: null` means consulted evidence was not provided; it must never be presented as zero consultations. Domain counts deduplicate within each response. Rates state their denominator, and sample source links do not imply verified provider output or a live crawl.

English is the default, with pt-BR interface copy through `useI18n` and `useCopy`. `useNumbers` formats every displayed metric using `en-US` or `pt-BR` (for example `1,120.5` and `1.120,5`). Fixture prompt text is sample content. AI model icons remain local assets; the current Lastfind telescope is `public/lastfind/brand/icon-3d.png`, with its canonical path in `lib/lastfind-brand.ts` and provenance in `public/brand/README.md`. Brands and sources use favicons. Dropdowns open below their trigger with a 6px gap and consistent 12px text, 6px popup padding and 36px option height, flipping only where the viewport requires it. Accessible labels, keyboard navigation, visible focus and reduced-motion behavior remain part of the interface contract. The decorative source donut does not receive focus; its text legend exposes categories and counts.

Profile photos accept JPG, PNG or WebP up to 5 MB. Users can adjust zoom and position, save, cancel, remove or reedit the original normalized image. Photos stay in the mock user session and follow that user across workspaces, with no upload to a server. Saved thumbnails are 256px; local source images are limited to a 1600px longest edge. Reloading clears mock avatars along with other session changes.

The sidebar project selector shows only the project name and favicon. The main trend chart fills the height of its panel alongside the ranking, with a minimum plotting height for stacked layouts. Settings tabs use two columns on narrow screens and four on larger screens, without horizontal scrolling. Interactive elements use a pointer cursor, while disabled controls and text fields retain their appropriate cursors.

The telescope fits its 32px button when the sidebar collapses; the brand link has no hover background and retains a visible keyboard focus ring. The date selector composes shadcn Popover and Calendar with presets, localized text inputs, two months on desktop and one on mobile. Changes stay in a draft until Apply; Cancel or dismissal preserves the applied range. Inputs accept slashes or eight digits, including from mobile numeric keyboards. Calendar day buttons forward their focus ref so arrow keys and Enter select the intended day.

Custom periods include both endpoints and compare against the immediately preceding interval of equal length. The daily chart and CSV exports use those dates. Ranges are limited to 366 days between 2000 and the latest demo date; the picker identifies the synthetic data coverage (July 16–September 9, 2026). Presets include yesterday, 7/14/28/30 days, this month and last month. Apply and Cancel remain visible while scrolling the mobile picker.

The loading indicator uses the same current telescope PNG as the public header and app, with a CSS transform animation. It does not load an animation library; reduced-motion preferences disable the movement while retaining the localized status text. The owner welcome screen also uses the current telescope identity.

## URL contract

Paths are language-independent. `{base}` is `/app` behind the existing edition authentication gate or `/app/preview` for public synthetic data. Every authenticated descendant checks authentication before resolving or rendering the destination. Successful login returns to the requested path and filters. App responses carry `no-store` and `nosniff`; route metadata discourages indexing.

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

For example: `/app/preview/workspaces/conversion/projects/conversion/overview?days=14&models=chatgpt,claude`. Seeded fixtures work across reloads and shared links. Session-created entities and unsaved mock edits are not persisted: opening their links in another session shows the unavailable state. Account profile is independent of project context and opens the recipient's current demo user.

## Preview and validation

From the repository root:

```sh
npm ci
npm run dev -- --port 3001
```

Open [the public frontend preview](http://localhost:3001/app/preview), or `/app` to exercise the existing edition authentication gate. No provider credentials are needed to interact with the mock UI. Development still starts the repository's native local runtime; `/app/preview` is a fixture-backed route, not a separate static-export build.

```sh
npm run typecheck
npm run lint
npm test
npm run build:selfhost
```

Use `npm run verify` for the full repository verification, including isolated backend integration checks. The installer and existing backend continue to follow the root README and architecture documentation.

## Guided setup and Semantic Branding

Onboarding separates discovery, comparison, purchase intent and explicitly
branded perception. Suggested prompts are editable templates, not a scraped
site analysis. Completion creates a distinct session project, retains selected
models/market/competitors and never attaches another project's answers.

Semantic Branding uses the same filtered response IDs for coverage, canonical
share of voice, cited/consulted source evidence and model comparisons. Attribute
labels and confidence values are illustrative annotations. Its own disclosed
score weights coverage (35%), associations (30%), sentiment (20%) and source
diversity (15%); it is not a competitor's proprietary metric or a validated
prediction. Local brand merges preserve raw identities and support split/undo.
Source co-occurrence in an answer does not prove that the page mentions the brand.
Report snapshots and opportunity planning remain in session memory; no report
wizard triggers provider tasks or notifications.

## Initial interface refinement — September 11, 2026

The following contracts supersede the compact typography and advanced Semantic UI descriptions above. Source data and advanced research helpers are preserved for their separate integration phase.

- Plus Jakarta Sans uses 14px/21px for body, navigation, primary controls and tables, weight 500; headings 600/700. Public prose remains 16px or larger. The product preview uses the same readable scale. Vendored shadcn primitives remain intact.
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
