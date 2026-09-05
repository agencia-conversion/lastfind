# Personal installation: storage and recovery

Lastfind uses the same storage architecture in a personal installation and in Cloud: one control D1 database, a private SQLite Durable Object for each project, and a private R2 bucket for original provider responses. The installer configures the shared namespace once; creating a project does not require another deployment or manual database creation.

## Install

1. Clone the repository, run `npm ci`, copy `.env.example` to `.env`, and enter your DataForSEO credentials.
2. Open your Cloudflare account and activate R2 if it is not already available. Lastfind does not activate billing, change subscriptions or publish buckets. Cloudflare may require a payment method to activate R2.
3. Run `npm run setup` and follow the account, installation-name and email prompts.
4. Open the returned `/app` URL. Your private sign-in key is saved in `.lastfind/access-key.txt`; store it in a password manager.

Setup verifies R2 access before creating D1 or deploying the Worker. It then creates the control database, a private archive bucket, the project-store namespace, secrets and the native schedule. If an API call fails after D1 creation, its identity is already saved locally: re-running setup resumes with that database. Existing resources are never replaced to hide an error.

Keep `.lastfind/` and `wrangler.selfhost.json` private and backed up. They contain the installation identity, secrets and owner key. A separate installation should use a fresh clone and a different name. Do not copy one installation's database IDs into another account.

```sh
# Update your existing instance using its saved resource identities.
git pull
npm ci
npm run deploy:selfhost
```

There is one project storage path. No D1 analytical fallback, migration toggle or manual per-project activation is required. Missing or unavailable project storage produces an explicit error rather than an empty report.

## Inspect a project

The administrative CLI signs in with your personal installation key, uses an in-memory session and signs out when finished. It never prints the key or saves its cookie. Commands read the installation URL from `.lastfind/secrets.json`.

```sh
npm run storage -- list
npm run storage -- status --project PROJECT_ID
```

Status reports the registered project generation and publication progress. An interrupted result publication can resume from the durable outbox without submitting the provider query again. These commands do not collect new responses or spend DataForSEO credits.

For another personal instance, append `--url https://your-instance.example --key-file /private/path/access-key.txt`. Remote destinations must use HTTPS. The CLI uses personal owner authentication.

## Export a verified project snapshot

```sh
npm run storage -- export --project PROJECT_ID --output ./backups/project.ndjson
```

The export streams normalized prompts, answers, evidence and original-response references. It includes a manifest with project/owner identity, generation, revision, row counts and chained SHA-256 digests. The CLI verifies the complete stream before publishing the file, preserves UTF-8 bytes, uses owner-only file permissions and refuses to overwrite an existing file. A failed or interrupted download does not become a usable backup.

Keep the NDJSON intact. Changing the order or boundaries of its chunks changes its digest, even if a spreadsheet editor displays the same values. The format is for recovery; use the app's CSV export for analysis.

The NDJSON contains R2 object keys and checksums, **not copies of raw JSON objects**. A complete installation backup needs all three layers:

| Layer | Backup contents |
| --- | --- |
| Control D1 | Accounts, ownership, settings, credit ledger, monitoring jobs and project registry |
| Project SQLite | A verified NDJSON export for each project |
| Private R2 | A private copy of the original objects, preserving their exact keys and bytes |

Back up the control database with Cloudflare D1 export and copy private R2 objects using your authorized storage administration tools. Keep those backups encrypted or access restricted, along with the private installation configuration. The project CLI does not claim a simultaneous, atomic snapshot across these independent systems.

## Restore a project snapshot

Restore targets the same existing project and owner. It does not create accounts, move another owner's records, overwrite account settings, resume archived prompts or start paid monitoring. Restoring the control D1 database or moving an entire installation to another account is a separate operator procedure.

```sh
# Validate the complete file, then upload into a new isolated generation.
npm run storage -- restore --project PROJECT_ID --input ./backups/project.ndjson
```

The command prints a new generation ID and the next command to run. The current project remains active while the upload is prepared. If upload fails, retry `restore` with the original complete backup to create a fresh candidate; do not commit the incomplete generation.

```sh
# Verify bounded batches and publish only the completely verified generation.
npm run storage -- restore-commit --project PROJECT_ID --generation GENERATION_ID --batches 100
```

If the result is `done: false`, repeat the same `restore-commit` command. Each call performs bounded work; the server changes the active generation only after validating the uploaded snapshot. If it reports an error, inspect `status` and resolve the cause before retrying. A damaged backup cannot replace the active project.

Restored R2 references work only when the referenced private objects remain available under their original keys. Restoring normalized answers does not recreate missing provider JSON. Lastfind does not automatically delete prior generations or raw archives; define your retention policy only after testing recovery.

## Troubleshooting

- **R2 error 10042:** activate R2 in the selected Cloudflare dashboard, then re-run setup. The installer does not do this on your behalf.
- **Configured bucket not found:** verify the account, jurisdiction and access permissions. Setup refuses to create a replacement bucket with the same name and silently lose earlier archives.
- **ProjectStore namespace conflict:** verify the existing Worker and namespace identity. Do not rename the class or replace the binding to bypass the error.
- **Backup checksum mismatch:** use a fresh export or an intact original file. Editing a footer to silence the error does not recover data.
- **Storage unavailable:** inspect Worker logs and bindings. An unavailable project database is surfaced as an error; reports do not switch to an older data source.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [STORAGE_ARCHITECTURE.md](STORAGE_ARCHITECTURE.md) for data ownership and publication semantics.
