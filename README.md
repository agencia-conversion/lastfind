# Lastfind — by Conversion

Open-source AI visibility analytics, powered by DataForSEO. Track prompts across supported AI engines, compare competitors and explore cited and consulted sources. Apache-2.0 licensed.

## Personal installation

Install Node.js 22.13 or newer, clone this repository and run:

```sh
npm ci
cp .env.example .env
```

Add your DataForSEO login and password to `.env`, then run `npm run setup`.

The guided setup connects your Cloudflare account, checks that R2 is available, provisions the control D1 database, project SQLite storage and private raw-response bucket, reads your DataForSEO credentials from the private `.env` file and deploys the application. It never activates a paid Cloudflare subscription for you. Save the generated owner key securely; it opens your personal installation.

The native Worker monitors prompts daily at 04:00 Brasília and completes provider work asynchronously. DataForSEO and Cloudflare usage belong to your own accounts. Configurable budget limits help control spending. Original responses remain private in R2; normalized evidence and reports live in project SQLite.

For local development use `npm run dev`; check changes with `npm run verify` and `npm run build:selfhost`. See [ARCHITECTURE.md](ARCHITECTURE.md), [REQUIREMENTS.md](REQUIREMENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

For local development, run `npm ci` and `npm run dev`. Use the owner key in `.lastfind/development/selfhost-access-key.txt`; the session and SQLite state are isolated to this checkout. Provider credentials for local use belong in `.env.dev.selfhost`. Production credentials in `.env` are only used by the installer.

## Updating an existing installation

Keep the old checkout until the update is verified. Clone this repository into a new directory, run `npm ci`, and copy your private `.env`, `wrangler.selfhost.json`, and `.lastfind/secrets.json` plus `.lastfind/access-key.txt` from the existing installation. Do not commit these files. Run `npm run deploy:selfhost`: it retains your Worker, D1, project namespace, R2 bucket, owner identity and access key. The independent baseline preserves existing records and can be reapplied safely. Verify `/api/health` and your projects before retiring the old checkout.
