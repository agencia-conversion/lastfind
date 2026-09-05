# Lastfind Conversion — design system v3

The frontend uses shadcn/ui with the existing Base UI primitives and the exact [Conversion theme from TweakCN](https://tweakcn.com/themes/cmg2mgpqd000404jman9ofw2p), selected by the user. This replaces the earlier monochrome direction.

| Token | Light value | Purpose |
|---|---|---|
| Primary / ring | `#1649FF` | Main actions and focus |
| Foreground | `#020817` | Primary text |
| Background / card | `#FFFFFF` | Working surfaces |
| Sidebar | `#F8FAFC` | Navigation and outer canvas |
| Sidebar accent | `#EEF2FF` | Selected navigation |
| Muted foreground | `#64748B` | Secondary text |
| Border / input | `#E2E8F0` | Dividers and controls |

The shared light and dark values are in `app/globals.css`; the application defaults to light. Plus Jakarta Sans is loaded through the framework font pipeline for headings and interface text. Code retains a monospace stack. Body text is 16px, ordinary controls 14px, and supporting metadata 12–13px. Spacing follows a 4px base; the theme radius is 8px, with derived 12px cards. Blue focuses attention on actions and the primary data series.

## Sidebar-07

The workspace composes the official [sidebar-07 block](https://ui.shadcn.com/blocks/sidebar) with existing Lastfind behavior. `components/lastfind/app-sidebar.tsx` owns the brand, project switcher, navigation groups, plan usage and account menu. The shell uses `SidebarProvider`, `SidebarInset`, `SidebarTrigger` and `SidebarRail`, with `collapsible="icon"`.

All seven application sections remain available as icons with accessible labels and tooltips when collapsed. Project and account dropdowns remain usable in that state. The desktop trigger and Cmd+B / Ctrl+B toggle the sidebar; on mobile the primitive uses a Sheet, and choosing navigation closes it. The existing `sidebar_state` preference cookie is read during server rendering, preventing a different initial expanded/collapsed state on hydration.

Compose the installed primitives at call sites; do not overwrite the vendored UI catalog. Cards, Buttons, Tables, Tabs, Dialogs, Sheets, Selects, Switches, Checkboxes, Progress, Skeletons, Tooltip, Avatar, Breadcrumb and DropdownMenu share the theme. Custom CSS remains responsible for product layouts and evidence presentation.

## Data and identity

Charts use `chart-1` through `chart-5`: `#1649FF`, `#4F74FF`, `#8B9EFF`, `#0D2C99`, `#091D66`. Competitor lines retain distinct dash patterns. Labels accompany status color. Reduced-motion preferences are respected.

Local Lobe Icons identify AI platforms; favicons identify competitors and sources, with text fallbacks. Preserve the original logo colors. Topics, tags, batch actions, prompt history, source drilldown and plan limits retain their existing behavior. Personal installation settings expose only the owner’s configuration.

Voice: clear, brief Portuguese. Demonstration data is labeled, original evidence is accessible, and unavailable consulted-source data is stated explicitly. The component reference is available at `/design-system`.
