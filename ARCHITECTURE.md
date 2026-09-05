# Personal Lastfind architecture

The personal application in `apps/selfhost` composes the shared source in `packages/core`. Vinext renders React/shadcn in a native Cloudflare Worker that also owns API routes and scheduled monitoring. Shared code has one source; application-specific owner authentication is composed at the edition boundary.

Control D1 holds the owner, project registry, canonical prompt configuration, durable jobs, leases and temporary publication outbox. Every project owns an isolated SQLite Durable Object containing normalized answers, cited and consulted evidence and report indexes. Original provider responses are stored separately in a private R2 bucket with checksums and ownership metadata.

The generated owner key authenticates the personal instance. Sessions bind the configured origin and key. All data routes enforce ownership; missing required storage fails closed. The installer provisions required resources and validates R2 availability before changes, without activating paid infrastructure subscriptions.

A native five-minute scheduled handler targets 04:00 America/Sao_Paulo each day. Durable reservations, leases and conservative budget holds prevent duplicate submissions after uncertain provider outcomes. Providers with standard endpoints use normal-priority batch; Live-only endpoints retain their actual behavior. Results are archived, normalized, staged through a temporary outbox and published idempotently into project SQLite. The browser never starts monitoring on page refresh.

Reports query bounded server-side views; response bodies, source details and history load on demand. Private authenticated APIs are not cached publicly. Export streams bounded pages. Backup/restore validates identity, row counts and checksums in an isolated generation before switching; raw R2 objects require their own backup.

`npm run setup` guides configuration and initial deployment. `npm run deploy:selfhost` publishes subsequent updates. Each development worktree has isolated generated runtime and local Wrangler state. Keep secrets and generated configuration outside version control.
