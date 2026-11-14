# Lastfind requirements

- AGPL-3.0-only reusable analytics core and simple personal installation.
- DataForSEO runs only on the server; never expose credentials.
- Personal owner authentication with a securely generated key and private sessions.
- One native Cloudflare Worker serves UI, API and monitoring; control D1, private SQLite Durable Object per project and private R2 raw responses are required.
- Daily or weekly collection per project, on the day and time the owner chooses in the workspace's time zone (04:00, and Monday for a weekly collection, by default); prefer standard/batch at normal priority where supported. Represent Live-only providers honestly.
- Preserve cited sources and consulted sources separately, including explicit absence of consulted evidence.
- Prompts support topics, tags, filters, bulk actions, CSV import, pause, archive, restore and history.
- English first and pt-BR ready; Plus Jakarta Sans headings, accessible compact shadcn interface and complete sidebar navigation, following docs/design/shell.md.
- Preserve ownership, project data, immutable raw evidence and verified backup/restore. Do not delete original data as part of cleanup.
- All channels selected by default for reports, with advanced filters and evidence drilldowns.
- Keep a single native architecture, bounded queries, durable jobs, leases and safe recovery after uncertain provider submissions.
- Reserve every paid call before sending it. Each project has one monthly budget for everything it spends; the owner may add an installation-wide brake. When a limit stops work, the screen says which one. A definitive provider refusal costs nothing.
- Backups and exports include the owner's Agent conversations; restore never changes them.
- Tests use isolated storage and mock provider tasks. Setup never automatically activates a paid infrastructure subscription.
