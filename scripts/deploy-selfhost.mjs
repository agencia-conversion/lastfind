import { spawnSync } from 'node:child_process';
import { writePrivateJson } from './private-files.mjs';
import { provisionRawStorage } from './raw-storage.mjs';
import { configureProjectStorage } from './project-storage-config.mjs';
import {
  readJson,
  run,
  deploymentURL,
  waitForHealth,
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
if (!secrets?.OWNER_ACCESS_KEY_HASH || !secrets.SESSION_SECRET)
  throw new Error(
    'Owner authentication secrets are missing. Run npm run setup.',
  );
config.main = 'packages/core/worker/index.ts';
config.d1_databases = config.d1_databases.map(database => ({ ...database, migrations_dir: 'apps/selfhost/drizzle' }));
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
const output = run(['deploy', '--config', '.runtime/selfhost/dist/server/wrangler.json']);
const url = deploymentURL(output);
if (secrets) {
  secrets.APP_URL = url;
  // APP_URL is secret-backed so a subsequent build cannot retain a preview URL.
  run(['secret', 'bulk', '--config', '.runtime/selfhost/dist/server/wrangler.json'], {
    input: JSON.stringify(secrets),
  });
  writePrivateJson('.lastfind/secrets.json', secrets);
}
// Apply scheduling to the final secret-backed deployment as well as its code.
run(['triggers', 'deploy', '--config', '.runtime/selfhost/dist/server/wrangler.json']);
await waitForHealth(url);
console.log(`Lastfind: ${url}/app`);
