# Project storage and recovery

The final native runtime uses **control D1 + private SQLite per project + private R2** in both Cloud and personal installations. `PROJECT_STORES` and `RAW_RESPONSES` are required deployment bindings. Project isolation is implemented in the core, not an optional adapter or a future design. Production data transfer remains a separately verified operation; see [VALIDATION.md](VALIDATION.md).

The user explicitly requested no legacy paths while the product is an MVP. There is no analytical D1 fallback, dual-read, shadow mode, opt-in flag or storage bridge. Existing data and infrastructure identities must still be preserved during a verified operator transfer.

## Data ownership

| Layer | Contents | Responsibility |
| --- | --- | --- |
| General D1 | Accounts, identities, sessions, ownership, subscriptions, credits, canonical prompts/topics, compact jobs, leases, project registry and temporary outbox | Enforce account-wide constraints atomically and locate project data |
| Project SQLite | Prompt projection, normalized answers, model, brand snapshots, cited/consulted evidence, response availability, historical records and local indexes | Query each project's analytics beside its data |
| Private R2 | Original provider JSON, exact bytes, SHA-256 and ownership metadata | Preserve evidence for downloads and future reprocessing without another provider query |

Canonical prompts and credit reservations remain in the control database so an eleventh Free prompt cannot evade account-wide constraints by choosing another project. The D1 job record retains scheduling, provider task IDs, accounting and raw archive references; it does not retain answer bodies and evidence lists as analytical columns. A normalized payload in the outbox is temporary and removed after acknowledgement.

## Namespace and queries

The Worker exports `ProjectStore`, bound once through `PROJECT_STORES`. The registry creates an immutable project/generation identity; Cloudflare resolves it to a SQLite-backed Durable Object. New projects initialize automatically. No per-project binding, deployment or management API credential is needed in the request path.

The object records owner, project, generation and schema version and checks that identity on every operation. Unknown or uninitialized stores do not answer queries with empty data. The application verifies the owner before resolving the object; predictable object names are routing, not authentication.

Reports, history and evidence use the same project-local query adapter. Requests have bounded statement/row/byte limits. Indexes support project dates, prompts, statuses and topics; source JSON is queried only when the relevant report is requested. A read may publish one bounded pending batch first. Large publication backlogs remain visible through the registry's source/applied revisions; they are not redirected to D1 reports.

SQLite Durable Objects provide private, transactional storage beside executing code and can be selected from one namespace on demand. This avoids provisioning and rebinding a separate D1 database for each project. D1 still supplies the shared transactional control layer. [Cloudflare storage comparison](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), [D1 query methods](https://developers.cloudflare.com/d1/best-practices/query-d1/).

## Durable publication

There is no transaction spanning the provider, D1, SQLite and R2. The implemented path separates paid collection from project publication:

1. Reserve credits and the unique daily job atomically in control D1.
2. Submit the provider task and persist its accepted ID. An uncertain submission is never blindly repeated.
3. Collect the result and attempt the original-response R2 write, recording archive status, checksum and size honestly.
4. In one D1 transaction, stage normalized `data_json` in `project_store_outbox`, advance the project revision and update compact job/cost state.
5. Under a per-project lease, read up to 100 pending records within the byte budget and apply them to the selected SQLite generation.
6. The object writes data and per-entity revision in one local transaction. A duplicate or older revision cannot overwrite a newer record.
7. Acknowledge the exact published revision in D1 and delete its temporary payload. When no pending entries remain, advance `applied_revision` to `source_revision`.

A timeout after SQLite commit but before D1 acknowledgement causes an idempotent publication retry, never another paid submission. Prompt/job metadata changes use the same revisioned outbox. A failed object call leaves publication pending with an error for subsequent bounded processing.

An R2 write is not part of the database transaction. A raw archive failure is recorded separately from a normalized answer; the UI must not claim that unavailable original bytes were captured. Capturing an old record requires the original response to remain available; normalized evidence cannot reconstruct it. Objects written before an interrupted database commit may be orphaned. No automatic cleanup deletes them on transient errors.

## Export and restore

Authenticated `GET /api/projects/:id/storage` reports configuration and registry status. The same route with `?format=export` streams NDJSON for the authorized owner. Application operations initialize/synchronize normal publication and prepare/verify restoration; there is no old-D1 activation or rollback operation.

An export requires publication to be caught up. It fixes a generation/revision, checks that checkpoint while scanning, emits deterministic chunks of at most 100 rows, and finishes with a manifest containing identity, counts and chained SHA-256 digests. A concurrent project change aborts the stream. Prompts and runs each contribute a digest, including empty entities.

The personal CLI validates the complete stream before atomically publishing a private `0600` file. It rejects malformed UTF-8, excessive records, missing footers, wrong owners/projects and checksum mismatches. It never overwrites an earlier backup. Export includes R2 keys/checksums as references, not the raw object bodies.

Restore verifies the complete local file, creates an isolated generation for the same existing project/owner, and uploads its original chunks. `restore-commit` scans that generation in bounded batches and compares counts/digests with the manifest. A guarded registry update switches only after verification and only if the project has not changed during restoration. Failed or incomplete candidates leave the active generation intact. Retrying a completed commit is idempotent.

A project restore does not recreate an account, rewrite budget state, restore canonical control settings, start monitoring or move records across owners. Complete installation recovery also needs the control-D1 backup and private R2 objects under their original keys. There is no cross-store point-in-time atomic recovery promise. Commands, retry behavior and backup scope are documented in [SELF_HOST_STORAGE.md](SELF_HOST_STORAGE.md).

## Provisioning, retention and limits

The runtime health check requires reachable control D1 and present DO/R2 bindings. Missing bindings produce 503 and block monitoring/provider I/O; a later object-store write failure remains an explicit archive error.

Personal setup verifies R2 availability before creating D1 or publishing a Worker. Cloudflare error 10042 stops setup with instructions for the account holder to activate R2. Setup does not activate billing or change subscriptions. It verifies existing archives rather than silently replacing them, checkpoints database identity before later calls, and provisions the namespace with declarative SQLite exports. Future deployments preserve the namespace/class identity.

Application schema and object schema are versioned. Preserve control-D1 backups, project snapshots, raw objects and private configuration before operational schema changes. A one-time transfer of pre-existing production data belongs in private operator tooling; it is not a permanent runtime branch. Removing legacy code does not authorize source-data deletion.

No automatic retention or account/project erasure policy is implemented. Archiving prompts/projects stops future work and access as applicable; it is not physical data erasure. A future erasure operation must cover canonical metadata, jobs, every retained generation and the exact R2 ownership prefix through a resumable process.

A project is physically isolated but still subject to per-object SQLite size, execution and query limits. D1 remains a shared control bottleneck. A paid D1 account supports up to 50,000 databases, but this topology uses one control binding instead of one D1 per project. D1 database size is 500 MB on Free or 10 GB on Paid. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## Storage economics

Official prices were checked on September 5, 2026. SQLite Durable Objects meter requests, active execution, SQL rows and stored data. Paid SQLite storage includes 5 GB-month, then US$0.20/GB-month; read/write allowances and rates are documented separately. No permanent timer, socket or provider wait keeps project objects active. Retained inactive data still incurs storage charges. [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

R2 Standard costs US$0.015/GB-month, plus operations, beyond its included allocation. Its monthly free tier includes 10 GB-month, one million Class A operations and ten million Class B operations, with free Internet egress. Standard avoids retrieval charges and a minimum retention period. These platform allowances do not guarantee a zero-cost Lastfind deployment. [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

For illustration, 100,000 responses averaging 100 KB produce about 10 GB of raw JSON. This excludes normalized SQLite data, indexes, metadata, retained generations and other services. Actual UTF-8 bytes and archive sizes are measured; compression or retention should be introduced only with byte-integrity and recovery tests. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
