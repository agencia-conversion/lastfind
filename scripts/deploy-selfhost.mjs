import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writePrivateJson } from './private-files.mjs';
import { provisionRawStorage } from './raw-storage.mjs';
import { configureProjectStorage } from './project-storage-config.mjs';
import {
  readJson,
  run,
  deploymentURL,
  waitForHealth,
  waitForAssets,
} from './cloudflare-cli.mjs';
let config = readJson('wrangler.selfhost.json');
if (
  !config ||
  !config.account_id ||
  JSON.stringify(config).includes('YOUR-') ||
  config.d1_databases?.[0]?.database_id.startsWith('00000000')
)
  throw new Error('Run npm run setup before deploying.');
const secrets = readJson('.lastfind/secrets.json');
// Without an owner key the first visit opens the setup wizard, which creates the admin; sessions always need their secret.
if (!secrets?.SESSION_SECRET)
  throw new Error(
    'Owner authentication secrets are missing. Run npm run setup.',
  );
// An installation set up before CREDENTIALS_KEY existed gets it here, as setup would; keys already saved stay readable under SESSION_SECRET.
secrets.CREDENTIALS_KEY ||= randomBytes(32).toString('hex');
config.main = 'packages/core/worker/index.ts';
config.d1_databases = config.d1_databases.map((database) => ({
  ...database,
  migrations_dir: 'apps/selfhost/drizzle',
}));
// Retain the same namespace identity on every deployment.
config = configureProjectStorage(config);
config = provisionRawStorage(config);
writePrivateJson('wrangler.selfhost.json', config);
const build = spawnSync('npm', ['run', 'build:selfhost'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
run([
  'd1',
  'migrations',
  'apply',
  'DB',
  '--remote',
  '--config',
  'wrangler.selfhost.json',
]);
const output = run([
  'deploy',
  '--config',
  '.runtime/selfhost/dist/server/wrangler.json',
]);
// An installation on its own domain (a `custom_domain` route) is served there; otherwise at its workers.dev address.
const domain = config.routes?.find((route) => route.custom_domain)?.pattern;
const url = domain ? `https://${domain}` : deploymentURL(output);
if (secrets) {
  secrets.APP_URL = url;
  // APP_URL is secret-backed so a subsequent build cannot retain a preview URL.
  run(
    [
      'secret',
      'bulk',
      '--config',
      '.runtime/selfhost/dist/server/wrangler.json',
    ],
    {
      input: JSON.stringify(secrets),
    },
  );
  writePrivateJson('.lastfind/secrets.json', secrets);
}
// Apply scheduling to the final secret-backed deployment as well as its code.
run([
  'triggers',
  'deploy',
  '--config',
  '.runtime/selfhost/dist/server/wrangler.json',
]);
// A new custom domain needs its certificate and DNS first: up to fifteen minutes.
await waitForHealth(url, domain ? 180 : 12);
await waitForAssets(url, '.runtime/selfhost/dist/client');
console.log(`Lastfind: ${url}/app`);
