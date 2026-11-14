# Install Lastfind on your own Cloudflare account

[Português (Brasil)](install.pt-BR.md)

This guide takes you from nothing to a working, private Lastfind of your own. You do not need to be a developer, but you will type a few commands in a terminal. Plan for about 30 minutes the first time, most of it creating accounts.

**What you get:** a private website at an address like `https://my-lastfind.your-name.workers.dev` where you track how AI assistants (ChatGPT, Gemini, Claude, Perplexity, Google AI Mode and AI Overviews) talk about your brand. Only you can sign in, with a key the installer creates for you.

## What it costs

You pay each provider directly. Lastfind itself is free (AGPL-3.0-only) and adds no fee.

| Service | What it does | Cost |
| --- | --- | --- |
| [Cloudflare](https://www.cloudflare.com) | Runs the website and stores your data | Free allowances cover a small installation. Cloudflare may ask for a payment method to turn on R2 (file storage); it only charges above its free allowance. If you see "exceeded CPU" or timeout errors with many prompts, upgrade to Workers Paid (about US$ 5 a month). |
| [DataForSEO](https://dataforseo.com) | Collects the AI answers | Prepaid; the minimum top-up is US$ 50 (confirm on their [pricing page](https://dataforseo.com/pricing)). Each answer collected costs about US$ 0.0012 for ChatGPT, Gemini, Google AI Mode and AI Overviews, about US$ 0.006 for Perplexity and about US$ 0.018 for Claude (measured in a real run in October 2026; DataForSEO can change its prices). |
| [OpenRouter](https://openrouter.ai) (optional) | Reviews how favourably answers talk about your brand (sentiment) | Prepaid credit; a fraction of a cent per reviewed answer. You can skip it. |
| [OpenAI](https://platform.openai.com/api-keys) or [Anthropic](https://platform.claude.com/settings/keys) (optional) | Run the Agent, the wizards and the search intents with their own models (and OpenAI's decision model) before OpenRouter, in the order you set in Admin, Providers. A ChatGPT or Claude plan with monthly API credits pays these calls when the key comes from the organization linked to it | Pay as you go, or your plan's API credits. You can skip them. |

**Worked example.** 20 prompts on ChatGPT only, collected once a day: 600 answers a month, about US$ 0.72. The same 20 prompts on all six assistants cost roughly US$ 17 a month, mostly Claude and Perplexity. Start with ChatGPT only and add models when you see value.

### Spending limits

Every paid call (an answer collected, a sentiment review, a Semantic Branding round, an Agent reply) is reserved before it is sent and settled at its real cost afterwards. Three limits keep a mistake from draining your balances. When one stops work, nothing more is sent and the project's Overview says which limit it was.

- **Each project's monthly budget.** One amount in US$ a month covers everything the project spends. A new project starts at US$ 50 a month. Change it in **Settings → Monitoring → Budget**: another amount, **No budget**, an empty field for the default (US$ 50), or 0 to stop the project's paid work. The same card shows the month so far by module and warns past 80% or when the month's pace would pass the budget.
- **Collections a month and a day.** Setup caps collection at 1,500 answers a month (`SELF_HOST_MONTHLY_LIMIT`) and 1,000 a day (`GLOBAL_DAILY_RUN_LIMIT`). To change them, edit them under `vars` in `wrangler.selfhost.json`, then run `npm run deploy:selfhost`. The daily number can also be set in the app (next item), which wins over the file.
- **Installation brake (optional).** **Admin → Usage and costs** can set a ceiling for all projects together: US$ a month, US$ a day and collections a day. None is set by default; an empty field goes back to the default. The same page shows where the money goes, by project, module, AI and day, with each project's budget.

## Commercial license

The free software is licensed under AGPL-3.0-only. If you offer a modified version to others, including as a web service, you must make its corresponding source available under AGPL-3.0. To use it without these obligations, Conversion offers a [commercial license](../COMMERCIAL-LICENSE.md): [comercial@conversion.com.br](mailto:comercial@conversion.com.br).

## One-click install (Deploy to Cloudflare)

No terminal needed. You need a Cloudflare account (Step 3 explains it; R2 must be turned on, which may ask for a payment method), a GitHub or GitLab account and, for collecting, a DataForSEO account (Step 2).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/agencia-conversion/lastfind)

1. Press the button and sign in to Cloudflare. Choose a name for the Worker (for example `my-lastfind`) and keep the suggested database, bucket and project storage: Cloudflare creates them in your account.
2. Fill in the five values it asks for. Each field explains itself:
   - `APP_URL`: the address the Worker will have, `https://<worker name>.<your subdomain>.workers.dev`. Your subdomain is under **Workers & Pages → Account details**.
   - `OWNER_EMAIL`: your email, to name you on screen.
   - `OWNER_ACCESS_KEY`: the key you will sign in with, at least 32 characters (`openssl rand -base64 32`, or a long password from your password manager). Save it there.
   - `SESSION_SECRET` and `CREDENTIALS_KEY`: two different random values (`openssl rand -hex 32`). Keep `CREDENTIALS_KEY` in your password manager: it seals the keys you save in the app.
3. Press **Deploy**. Cloudflare copies the repository to your Git account, installs, builds (`npm run build`), applies the database migrations and publishes (`npm run deploy`). It takes a few minutes.
4. Open your address with `/app` at the end, paste your access key and sign in. The [setup wizard](#the-setup-wizard) opens: the provider keys (each tested for free on the provider's endpoint and saved sealed), the defaults, then your first project.
5. Continue with [Step 7](#step-7-your-first-project-and-prompts).

**Updating a one-click install.** Your copy of the repository is yours: to update, bring in the new public version (GitHub's **Sync fork**, or pull it into your copy) and Cloudflare builds and deploys every push to its main branch. Your data, keys and owner key stay. A one-click install does not use `npm run setup`; use one way or the other for an installation, not both.

## The setup wizard

The first time you open your installation (`/app`), the setup wizard opens before anything else. It runs once: after you finish, it never opens again, and everything it asks for changes later in the app.

1. **Admin account.** An installation with no owner key yet (deployed without `OWNER_ACCESS_KEY`) asks for its **setup token**, your email, and makes a random access key: the key is shown once and only its hash is kept, so copy it into your password manager. The setup token proves you are the one who deployed it, so nobody who finds the address first can take the installation:
   - set it yourself as a Worker secret before the first visit: `npx wrangler secret put SETUP_TOKEN` (any long random value, for example `openssl rand -base64 32`); or
   - leave it unset: on the first visit the installation makes one and prints it once to the Worker's log. Run `npx wrangler tail <your worker name>` before opening the address and copy the line `Lastfind setup token, shown once`. Missed it? Set `SETUP_TOKEN` as above; it takes precedence.

   Wrong tokens are refused, and after 5 from one address in 15 minutes that address waits. An installation made with `npm run setup` or the Deploy button already has its owner key: sign in with it and the wizard starts at the next step, with no token.
2. **Providers.** DataForSEO first (it collects the AI answers; recommended now, otherwise collection waits), then the model providers in the order calls use them: OpenAI, Anthropic, OpenRouter (recommended: OpenRouter, the only one with the classifiers' decision models). Each card tests the key on the provider's free endpoint before you save it; saved keys are sealed with `CREDENTIALS_KEY`. Keys your Worker already has as secrets show as in effect.
3. **Defaults.** The interface language, the time zone collections follow, and a monthly cap for the whole installation (recommended: US$ 100 to start; paid work pauses when the month reaches it). Change them in **Settings → Monitoring** and **Admin → Usage and costs**.
4. **Start.** What is set, and **Create your first project**, which opens the project wizard ([Step 7](#step-7-your-first-project-and-prompts)).

Keys change later in **Admin → Providers**.

## Step 1. Prepare your computer

You need:

- A Mac, a Linux computer, or Windows with [WSL](https://learn.microsoft.com/windows/wsl/install) (open an Ubuntu terminal and work there).
- **Node.js 22.13 or newer.** Download it from [nodejs.org](https://nodejs.org). Check with `node --version`.
- **Git**, or the ability to download a ZIP. Check with `git --version`.

Open a terminal (Mac: Terminal; Windows: Ubuntu; Linux: your terminal).

## Step 2. Create your DataForSEO account

1. Sign up at [dataforseo.com](https://dataforseo.com) and confirm your email.
2. Add funds (see the cost table). Without a balance, collection fails.
3. Open **API Access** in the dashboard. Note your **API login** (your account email) and **API password**. This API password is generated by DataForSEO and is **not** the password you use to sign in to the website. It is shown for the first 24 hours after registration; later, use "Send by e-mail" on that page to receive it again.

## Step 3. Create your Cloudflare account and choose how to connect

1. Sign up at [cloudflare.com](https://dash.cloudflare.com/sign-up) and confirm your email.
2. In the dashboard open **R2 Object Storage** and activate it if asked. Lastfind keeps the original answers there. The installer stops with a clear message if R2 is not active.
3. Choose **one** way to connect:
   - **On your own computer (easiest):** do nothing now. During setup a browser window opens; sign in and press *Allow*.
   - **On a server, or if no browser window opens:** create an API token. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → *Create Token* → *Create Custom Token*, with *Account* permissions **Workers Scripts: Edit**, **D1: Edit** and **Workers R2 Storage: Edit** (and *Account Settings: Read*), for your account. Copy the token and, before running setup, set it in the terminal:

     ```sh
     export CLOUDFLARE_API_TOKEN="paste-the-token-here"
     export CLOUDFLARE_ACCOUNT_ID="paste-your-account-id-here"   # shown on the dashboard home, right side
     ```

## Step 4. OpenRouter (optional)

Skip this step if you only want visibility tracking. For sentiment, create an account at [openrouter.ai](https://openrouter.ai), add a few dollars of credit and create a key at [openrouter.ai/keys](https://openrouter.ai/keys). It starts with `sk-or-`. You can add it later by running `npm run setup` again.

Advanced: to review with a different model, choose it in **Admin → Classifiers** after you sign in (one model per function, for every project). A Worker variable `LASTFIND_CLASSIFIER_MODELS` in `wrangler.selfhost.json` (under `vars`), for example `{"source_types":"liquid/d1-ultra"}`, does the same from the file; a model chosen in Admin wins over it. If the chosen model fails, that review repeats once on the standard model.

## Step 5. Download and install

```sh
git clone https://github.com/agencia-conversion/lastfind.git
cd lastfind
npm ci
npm run setup
```

(No Git? Download the repository as a ZIP from GitHub, unzip it, open a terminal inside the folder and run the last two commands.)

`npm ci` downloads the dependencies (a minute or two; warnings about "audit" or "install-scripts" are normal). `npm run setup` then:

1. Asks for your DataForSEO login and password (the password is hidden as you type) and **checks them right away**. A wrong value is reported in plain words, and you can retype it.
2. Optionally asks for the OpenRouter key and checks it.
3. Connects to Cloudflare, asks for a name for your installation (for example `my-lastfind`) and your email.
4. Creates the database, project storage and the private answer archive, publishes the site and prints its address.

Your keys are saved only in the files `.env` and `.lastfind/` in this folder and as secrets of your own Worker. They are never uploaded anywhere else. Setup never charges you and never changes your Cloudflare plan. What setup puts on your Worker is listed in [Keys, secrets and limits](#keys-secrets-and-limits).

Setup can run again at any time: it reuses what already exists and loses nothing. To check your keys without installing anything, run `npm run setup -- --check-only`. For Portuguese messages, add `--lang pt-BR`.

> **Back up these files.** `wrangler.selfhost.json`, `.env` and the `.lastfind/` folder are the only link between this folder and your installation, and `.lastfind/access-key.txt` is your only sign-in key. Copy them to a safe place (a password manager for the key). Never share or publish them.

## Step 6. Sign in

At the end, setup prints your address (ending in `/app`) and where the key is. To show your owner key:

```sh
cat .lastfind/access-key.txt        # Mac, Linux, WSL
```

Open the address, paste the key and press **Sign in to my installation**: the [setup wizard](#the-setup-wizard) opens first. Save the key in your password manager. If you lose it, run `npm run setup` again: it re-publishes with the same key stored in `.lastfind/access-key.txt` (if that file is gone, setup creates a new key).

## Step 7. Your first project and prompts

1. After signing in, fill in **Brand** (for example *Conversion*), **Domain** (`conversion.com.br`), language and country, then **Create project**. The form starts with *United States* and English: search the country list (any country), for a Brazilian brand pick *Brazil* and the language switches to Portuguese. Prompts and answers are in English or Portuguese; an AI that does not collect in the chosen country is named under the field. Every AI answers in both languages.
2. Open **Prompts** → **Add prompt**. A prompt is a question your customers might ask an AI, for example *What are the best conversion rate optimisation agencies in Brazil?* Pick the AI models (ChatGPT is selected by default) and save. You can paste up to 100 prompts at once.
3. **When data appears.** Adding a prompt starts its first collection right away (this spends DataForSEO balance). Answers arrive as the AI models finish, not all at once: Google AI Overviews and AI Mode in about a minute, ChatGPT, Gemini and Perplexity usually in a few minutes, Claude in about 30 minutes. In our two test rounds of 17 prompts, DataForSEO's queue made ChatGPT, Perplexity or Gemini take up to 45 minutes once and Gemini about two hours once. Open **Prompts → Responses**: each answer appears there as its model finishes, and the reports fill in as they arrive. From then on each prompt is collected every day at about 04:00 in your time zone (your browser's when you created the first project); **Settings → Monitoring** changes the time and the time zone, or makes the project weekly on the day you choose (Monday by default).
4. Empty screens mean "no data yet", never "zero". If no answer arrives within 15 minutes, see Troubleshooting.

**Sentiment (needs OpenRouter).** With an OpenRouter key, the new answers of every project are evaluated automatically: the scheduler reviews them in the background after each collection, inside the project's monthly budget (**Settings → Monitoring → Budget**), and types the sources they cite the same way. Results appear in the **Sentiment** column of **Brands**, the Overview's **Sentiment index** card and each brand's page; the first ones follow the first collection within minutes (Cloudflare can take up to 15 minutes to start the scheduler of a brand-new installation). To stop it for one project, untick **Enable evaluation** in **Settings → Competitors → Brand discovery and sentiment** and **Save changes**. Without an OpenRouter key nothing is evaluated; add one in **Admin → Providers**.

## Update

Your data stays in your Cloudflare account, so updating only replaces the code.

```sh
cd lastfind
git pull
npm ci
npm run deploy:selfhost
```

If you used a ZIP, download the new ZIP, unzip it into a **new** folder, run `npm ci`, copy `.env`, `wrangler.selfhost.json` and the `.lastfind/` folder from the old folder into it, then run `npm run deploy:selfhost`. Deployment keeps your Worker, database, projects, storage and owner key. Check `https://your-address/api/health` shows `"ok":true` and your projects are still there.

## Backup

A complete backup has three parts, plus the private files of Step 5.

- **Project data.** In the app, **Settings → Project data** makes a backup in the background (kept in your R2 bucket, the 3 newest for 30 days), downloads it and restores it. From a terminal, `npm run storage -- list` shows your projects and `npm run storage -- export --project PROJECT_ID --output backup-PROJECT_ID.ndjson` saves one; `npm run storage -- --help` describes restore. A project file also carries your Agent conversations, as a copy for the record: a restore checks them and skips them, and never changes a conversation. Details: [SELF_HOST_STORAGE.md](../packages/core/SELF_HOST_STORAGE.md).
- **Control database.** `npx wrangler d1 export YOUR-DB-NAME --remote --config wrangler.selfhost.json --output control-backup.sql` (the database has the same name as your installation). It holds settings, budgets, brand decisions, Semantic Branding, the Agent's artifacts, Brain and skills, and the keys saved in Admin, which stay sealed and open only with the `CREDENTIALS_KEY` kept in `.lastfind/secrets.json`.
- **Original answers.** Exports reference the private R2 archive but do not copy it. Back it up with Cloudflare's [R2 tools](https://developers.cloudflare.com/r2/) if you need the raw answers.

## Keys, secrets and limits

Setup writes these secrets to your Worker and keeps a copy in `.lastfind/secrets.json`. Each is random and has one job:

| Secret | What it does |
| --- | --- |
| `OWNER_ACCESS_KEY_HASH` | Checks your owner key (the key itself stays only in `.lastfind/access-key.txt`) |
| `SESSION_SECRET` | Signs your sign-in session |
| `CREDENTIALS_KEY` | Seals the provider keys you save in **Admin → Providers** |
| `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `OPENROUTER_API_KEY` | The provider keys you typed during setup |

A one-click install has `OWNER_ACCESS_KEY` (the key itself, which you typed) instead of `OWNER_ACCESS_KEY_HASH`, plus `APP_URL` and `OWNER_EMAIL`, and no provider keys until you save them in the app.

- **Provider keys in the app.** The [setup wizard](#the-setup-wizard) asks for them once; **Admin → Providers** shows which keys are in effect (never their values), tests them for free and lets you replace one. A key saved there wins over the one setup stored; removing it goes back to setup's.
- **Cloudflare usage (optional).** **Admin → Usage and costs** can show what your Cloudflare account used this month (Workers, D1, Durable Objects, R2) and its estimated cost. Create an API token in the Cloudflare dashboard (**My Profile → API Tokens → Create Token → Custom token**) with one permission, **Account → Account Analytics → Read**, limited to your account, then save it with your account ID in **Admin → Providers**, Cloudflare card (it is sealed and tested for free there). The Worker secret `CLOUDFLARE_ANALYTICS_TOKEN` and the variable `CLOUDFLARE_ACCOUNT_ID` still work as the fallback. Without them the section says it is not configured.
- **Limits the app applies by itself.** An AI app connection (Settings → AI apps) makes at most 60 calls a minute. New AI app registrations are limited per address and in total each hour. Sign-in accepts at most ten key tries a minute from one address (the key `npm run setup` makes is 256 random bits; a one-click install's typed key is bounded by that limit). No Cloudflare rate limiting rule is needed; if you put your own domain in front, you can add rules in the Cloudflare dashboard.

## Remove your installation

This deletes your data. Export a backup first. In the Cloudflare dashboard:

1. **Workers & Pages** → your Worker → *Settings* → *Delete* (this also removes the project storage).
2. **D1** → your database → *Delete*.
3. **R2 Object Storage** → your `…-raw-…` bucket → empty it, then delete it.

Then delete the folder, and revoke your DataForSEO/OpenRouter keys and Cloudflare token if you no longer need them.

## Troubleshooting

| What you see | What it means and what to do |
| --- | --- |
| `Node.js … is too old` | Install Node.js 22.13 or newer from [nodejs.org](https://nodejs.org), open a **new** terminal and run `npm ci` again. |
| `DataForSEO did not accept this login and password` | Use the **API login** (account email) and **API password** from the dashboard's *API Access* page, not your website password. Run `npm run setup -- --check-only` to test again. |
| `DataForSEO: login accepted, but the balance is zero` | Add funds in DataForSEO. Collections fail until you do. |
| `OpenRouter did not accept this key` | Copy the key again from [openrouter.ai/keys](https://openrouter.ai/keys). Or skip OpenRouter by pressing Enter at that question. |
| `Not signed in to Cloudflare` | Run `npm run setup` in a normal terminal (a browser opens), or set `CLOUDFLARE_API_TOKEN` as in Step 3. |
| `Cloudflare refused access` | Your token lacks permissions. Recreate it with Workers Scripts, D1 and Workers R2 Storage *Edit* for the right account, and set `CLOUDFLARE_ACCOUNT_ID`. |
| `R2 is required … Activate R2` | Open **R2 Object Storage** in the Cloudflare dashboard, activate it (Cloudflare may ask for a payment method), then run `npm run setup` again. |
| `Worker … already exists` / `A database named … already exists` | That name is taken in your account by something else. Run setup again with another name: `npm run setup -- --name my-other-name`. |
| Published, but the address does not open | New `workers.dev` addresses can take a minute or two. If you never chose a `workers.dev` subdomain, open **Workers & Pages** in the dashboard once to create it, then run `npm run deploy:selfhost`. |
| `This folder already has the installation …` | One folder holds one installation. Use that name to update it, or unzip/clone a fresh copy for another one. |
| Sign-in says the key is invalid | Paste the whole line from `.lastfind/access-key.txt` without spaces. |
| The page stays on "Loading your workspace…" right after installing or updating | Wait a minute and refresh the page (Ctrl/Cmd+Shift+R). Cloudflare takes a moment to serve the new files everywhere. |
| No answers after 15 minutes | Check DataForSEO balance, then `https://your-address/api/health`. The scheduler runs every 5 minutes; a first answer can take up to 15 minutes, and a few answers (Gemini in one of our tests) took about two hours, so a model still missing from **Responses** for a while is normal. |
| "Monitoring is off: this installation has no DataForSEO credentials" | Save them in **Admin → Providers**, or run `npm run setup` again. |
| "Monitoring is temporarily unavailable" | The Worker is missing its project storage or answer archive. Run `npm run deploy:selfhost` (or `npm run setup`) again. |
| Many prompts time out or "exceeded CPU" | Free Cloudflare limits. Upgrade to Workers Paid (about US$ 5 a month) or track fewer prompts. |
| Collections stopped mid-month, or the Overview says "Collection paused" | A spending limit was reached; the Overview names which (see [Spending limits](#spending-limits)). Raise the project's budget in Settings → Monitoring → Budget, the installation brake in Admin → Usage and costs, or the collection limits in `wrangler.selfhost.json` (then run `npm run deploy:selfhost`). |

## Vercel, Netlify and other hosts

Lastfind is **not** available on Vercel (or Netlify and similar hosts). It depends on Cloudflare-only services: D1 for the control database, Durable Objects with SQLite for each project, R2 for the original answers and Cron Triggers for daily collection. These have no drop-in equivalent there, so no instructions are offered. Cloudflare is the supported place to run it.

## Getting help

Open an issue in the project's repository. Never paste keys, passwords or the contents of `.env` or `.lastfind/` in an issue.
