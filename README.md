# Lastfind — by Conversion

Open-source AI visibility analytics, powered by DataForSEO. Track prompts across supported AI engines, compare competitors and explore cited and consulted sources. Apache-2.0 licensed.

## Install it yourself

Lastfind runs on your own Cloudflare account, using your own DataForSEO account to collect AI answers and, optionally, OpenRouter for brand sentiment. You pay those providers directly; Lastfind adds no fee.

**Follow the step-by-step guide: [docs/install.md](docs/install.md)** ([Português (Brasil)](docs/install.pt-BR.md)). It covers creating each account and key, what everything costs, installing, your first project, updating, backup, removal and troubleshooting. The short version, with Node.js 22.13 or newer installed:

```sh
git clone https://github.com/agencia-conversion/lastfind.git
cd lastfind
npm ci
npm run setup
```

The guided setup asks for what is missing in plain language, checks your DataForSEO and OpenRouter keys before creating anything, connects your Cloudflare account, provisions the control D1 database, project SQLite storage and private raw-response bucket, deploys the application and prints your address and where your owner key is saved. It can be run again safely and never activates a paid Cloudflare subscription for you. `npm run setup -- --check-only` only verifies your keys. Vercel and other hosts are not supported (see the guide).

The native Worker monitors prompts daily at 04:00 Brasília and completes provider work asynchronously; a newly added prompt is collected right away. Original responses remain private in R2; normalized evidence and reports live in project SQLite.

## Developing

For local development, run `npm run dev` and use the owner key in `.lastfind/development/selfhost-access-key.txt`; the session and SQLite state are isolated to this checkout. Provider credentials for local use belong in `.env.dev.selfhost`. Production credentials in `.env` are only used by the installer. Check changes with `npm run verify` and `npm run build:selfhost`. See [ARCHITECTURE.md](ARCHITECTURE.md), [REQUIREMENTS.md](REQUIREMENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

### Interface

`/app` requires the owner session and reads persisted projects, prompts and collected reports. `/app/preview` is a public, noindex demonstration with deterministic sample data. Automatic Semantic Branding scoring is not available in the independent edition yet; its settings and report can be viewed, but enabling it will not create scores.
