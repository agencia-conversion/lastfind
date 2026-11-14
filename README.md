# Lastfind by Conversion

Open-source AI visibility analytics, powered by DataForSEO. Track prompts across supported AI engines, compare competitors and explore cited and consulted sources. AGPL-3.0-only licensed.

## Install it yourself

Lastfind runs on your own Cloudflare account, using your own DataForSEO account to collect AI answers and, optionally, OpenRouter, OpenAI or Anthropic (in the order you choose) for brand sentiment, Semantic Branding and the Agent. You pay those providers directly; Lastfind adds no fee.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/agencia-conversion/lastfind)

**One click, no terminal:** the button copies this repository to your GitHub or GitLab account, creates the database, project storage and private bucket on your Cloudflare account, builds and deploys. It asks for five values (your address, your email, the key you will sign in with and two random secrets; each field says how to make it). Then open your address, sign in and the setup wizard asks for your provider keys, testing each one for free, and your defaults. See [One-click install](docs/install.md#one-click-install-deploy-to-cloudflare).

**Follow the step-by-step guide: [docs/install.md](docs/install.md)** ([Português (Brasil)](docs/install.pt-BR.md)). It covers creating each account and key, what everything costs, installing, your first project, updating, backup, removal and troubleshooting. The short version, with Node.js 22.13 or newer installed:

```sh
git clone https://github.com/agencia-conversion/lastfind.git
cd lastfind
npm ci
npm run setup
```

The guided setup asks for what is missing in plain language, checks your DataForSEO and OpenRouter keys before creating anything, connects your Cloudflare account, provisions the control D1 database, project SQLite storage and private raw-response bucket, deploys the application and prints your address and where your owner key is saved. It can be run again safely and never activates a paid Cloudflare subscription for you. `npm run setup -- --check-only` only verifies your keys. The first visit opens the **setup wizard**: the admin account (on an installation with no key yet, after its one-time setup token: the `SETUP_TOKEN` secret, or the one printed once to the Worker log), the provider keys, each tested for free, the defaults, then your first project. It runs once; keys change later in **Admin → Providers**. See [The setup wizard](docs/install.md#the-setup-wizard). Vercel and other hosts are not supported (see the guide).

The native Worker monitors prompts daily or weekly, on the day and time you choose in Settings > Monitoring, in the time zone you pick there (04:00, and Monday for a weekly collection, by default) and completes provider work asynchronously; a newly added prompt is collected right away. Original responses remain private in R2; normalized evidence and reports live in project SQLite.

## Developing

For local development, run `npm run dev` and use the owner key in `.lastfind/development/selfhost-access-key.txt`; the session and SQLite state are isolated to this checkout. Provider credentials for local use belong in `.env.dev.selfhost`. Production credentials in `.env` are only used by the installer. Check changes with `npm run verify` and `npm run build:selfhost`. See [ARCHITECTURE.md](ARCHITECTURE.md), [REQUIREMENTS.md](REQUIREMENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

### Interface

`/app` requires the owner session and reads persisted projects, prompts and collected reports: Overview, Agent, Prompts, Semantic Branding, Brands, Sources, Comparison, Traffic, Shopping and AI models.

Semantic Branding scoring runs here too. When you enable it in a monitored project's settings, a scoring round runs daily by default and asks every AI the project monitors about your brands the same way the collection asks it (ChatGPT, Gemini, Google AI Mode and AI Overviews as people see them, Claude as the model alone, Perplexity with its own search), all through DataForSEO, so it spends that balance. A round reserves at most US$ 5, inside the project's monthly budget. To switch it off for the whole installation, set `SEMANTIC_PANEL_ENABLED=false` under `vars` in `wrangler.selfhost.json`, then run `npm run deploy:selfhost`.

The Agent (with an OpenRouter key) answers questions about a project from its own data, writes artifacts with live charts, and contents that start from the project's Brain and what your site already published on the topic, compared with the top Google results, and keeps a per-project Brain with a Memory and workspace skills. It improves them from your feedback and learns a new skill only when the same kind of work succeeds in several conversations; a change learned after reading third-party content waits for your approval. Every change it makes to itself is shown in the chat and can be undone from its history.

### Spending

Every paid call is reserved before it is sent and settled at its real cost. Each project has one monthly budget for everything it spends (US$ 50 for a new project, in Settings > Monitoring > Budget); collection is also capped per month and per day, and Admin > Usage and costs shows where the money goes and can set a brake for the whole installation. See [Spending limits](docs/install.md#spending-limits).

## License

Lastfind is licensed under [GNU AGPL-3.0-only](LICENSE). You can study, modify, distribute and use it commercially under that license. If you offer a modified version to others, including over a network, you must make its corresponding source available under AGPL-3.0. Preserve license and copyright notices.

For use without these AGPL obligations, Conversion offers a [commercial license](COMMERCIAL-LICENSE.md). Versions published before this license change remain Apache-2.0 for those who already have them. Third-party dependencies retain their own licenses.
