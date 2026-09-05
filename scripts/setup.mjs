import { mkdirSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { writePrivateFile, writePrivateJson } from './private-files.mjs';
import {
  assertRawStorageAvailable,
  provisionRawStorage,
} from './raw-storage.mjs';
import { configureProjectStorage } from './project-storage-config.mjs';
import {
  currentAccounts,
  readJson,
  run,
  assertWorkerAvailable,
} from './cloudflare-cli.mjs';

const { values } = parseArgs({
  options: {
    yes: { type: 'boolean', default: false },
    name: { type: 'string' },
    account: { type: 'string' },
    email: { type: 'string' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'npm run setup -- [--name lastfind] [--account ACCOUNT_ID] [--email owner@example.com] [--yes]\nSupply DataForSEO credentials in .env. --yes requires authenticated Wrangler and explicit values when multiple accounts exist.',
  );
  process.exit(0);
}
if (existsSync('.env')) process.loadEnvFile('.env');
const rl =
  !values.yes && process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
async function ask(label, fallback = '') {
  return rl
    ? (
        await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)
      ).trim() || fallback
    : fallback;
}
try {
  let identity;
  try {
    identity = currentAccounts();
  } catch {
    if (!rl) throw new Error('Run npx wrangler login first.');
    spawnSync(
      process.execPath,
      ['node_modules/wrangler/bin/wrangler.js', 'login'],
      { stdio: 'inherit' },
    );
    identity = currentAccounts();
  }
  const accounts = identity.accounts || [];
  let account = values.account || process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account && accounts.length === 1) account = accounts[0].id;
  if (!account && rl) {
    console.log(accounts.map((a, i) => `${i + 1}. ${a.name}`).join('\n'));
    const index = Number(await ask('Cloudflare account (number)')) - 1;
    account = accounts[index]?.id;
  }
  if (!account || !accounts.some((a) => a.id === account))
    throw new Error('Select an accessible account with --account ACCOUNT_ID.');
  const existing = readJson('wrangler.selfhost.json', {});
  const name = await ask(
    'Installation name',
    values.name || existing.name || 'lastfind',
  );
  if (!/^[a-z0-9][a-z0-9-]{2,50}$/.test(name))
    throw new Error(
      'Use 3–51 lowercase letters, numbers or hyphens for the name.',
    );
  const email = await ask(
    'Your email',
    values.email || existing.vars?.OWNER_EMAIL || '',
  );
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Provide an email with --email.');
  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD)
    throw new Error(
      'Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in .env before setup.',
    );
  if (existing.account_id && existing.account_id !== account)
    throw new Error(
      'This checkout is configured for another account. Use a fresh clone for a separate installation.',
    );
  if (
    existing.name &&
    existing.d1_databases?.[0]?.database_id &&
    !existing.d1_databases[0].database_id.startsWith('00000000') &&
    existing.name !== name
  )
    throw new Error(
      'This checkout already has an installation. Use a fresh clone for another name.',
    );
  let config = {
    ...existing,
    $schema: 'node_modules/wrangler/config-schema.json',
    name,
    account_id: account,
    main: 'packages/core/worker/index.ts',
    compatibility_date: '2026-05-22',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: true,
    placement: { mode: 'smart' },
    observability: { enabled: true, head_sampling_rate: 0.1 },
    vars: {
      ...existing.vars,
      SELF_HOST_MONTHLY_LIMIT: existing.vars?.SELF_HOST_MONTHLY_LIMIT || '1500',
      GLOBAL_DAILY_RUN_LIMIT: existing.vars?.GLOBAL_DAILY_RUN_LIMIT || '1000',
      OWNER_EMAIL: email,
      ENABLE_PROVIDER_CALLBACKS: 'true',
    },
    d1_databases: [],
    triggers: { crons: ['*/5 * * * *'] },
    ...(existing.r2_buckets ? { r2_buckets: existing.r2_buckets } : {}),
  };
  config = configureProjectStorage(config);
  // Reject unavailable R2 before creating D1 or publishing a Worker.
  assertRawStorageAvailable(config);
  const databases = JSON.parse(
    run(['d1', 'list', '--json'], {
      quiet: true,
      env: { CLOUDFLARE_ACCOUNT_ID: account },
    }),
  );
  const existingId = existing.d1_databases?.[0]?.database_id;
  let database = databases.find((d) => d.uuid === existingId);
  if (!database) {
    assertWorkerAvailable(name, account);
    if (databases.some((d) => d.name === name))
      throw new Error(
        `A D1 database named ${name} already exists. Refusing to bind unrelated data. Use another name or explicitly configure wrangler.selfhost.json.`,
      );
    run(['d1', 'create', name, '--location', 'enam', '--update-config=false'], {
      env: { CLOUDFLARE_ACCOUNT_ID: account },
    });
    database = JSON.parse(
      run(['d1', 'list', '--json'], {
        quiet: true,
        env: { CLOUDFLARE_ACCOUNT_ID: account },
      }),
    ).find((d) => d.name === name);
  }
  if (!database?.uuid)
    throw new Error(
      'Database creation was not confirmed. Re-run setup after checking Cloudflare.',
    );
  config.d1_databases = [
    {
      binding: 'DB',
      database_name: database.name,
      database_id: database.uuid,
      migrations_dir: 'apps/selfhost/drizzle',
    },
  ];
  // Checkpoint identity before archive creation: retrying a failed R2 step
  // must reuse this database, never mistake it for an unrelated installation.
  writePrivateJson('wrangler.selfhost.json', config);
  config = provisionRawStorage(config);
  writePrivateJson('wrangler.selfhost.json', config);
  mkdirSync('.lastfind', { recursive: true, mode: 0o700 });
  chmodSync('.lastfind', 0o700);
  const secrets = readJson('.lastfind/secrets.json', {});
  Object.assign(secrets, {
    DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN,
    DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD,
    SESSION_SECRET: secrets.SESSION_SECRET || randomBytes(32).toString('hex'),
  });
  {
    const accessFile = '.lastfind/access-key.txt';
    const accessKey = existsSync(accessFile)
      ? readFileSync(accessFile, 'utf8').trim()
      : randomBytes(32).toString('base64url');
    writePrivateFile(accessFile, accessKey + '\n');
    secrets.OWNER_ACCESS_KEY_HASH = createHash('sha256')
      .update(accessKey)
      .digest('hex');
  }
  writePrivateJson('.lastfind/secrets.json', secrets);
  const deployed = spawnSync(
    process.execPath,
    ['scripts/deploy-selfhost.mjs'],
    { stdio: 'inherit' },
  );
  if (deployed.status !== 0) process.exitCode = deployed.status || 1;
  else
    console.log(
      `Ready. Your access key is in .lastfind/access-key.txt. Store it in your password manager. Project SQLite: configured; each project gets its own database automatically. Raw JSON: private R2 configured.`,
    );
} finally {
  rl?.close();
}
