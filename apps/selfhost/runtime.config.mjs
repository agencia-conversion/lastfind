import { developmentSettings } from '../../scripts/development-settings.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export function configuration({ root, testing, port, production }) {
  // A production build reads the installer's configuration (`npm run setup`) or, in a copy made by the Deploy to
  // Cloudflare button, the root wrangler.json the button provisioned (its D1, R2 and Durable Objects).
  const path = ['wrangler.selfhost.json', 'wrangler.json'].map((name) => resolve(root, name)).find((file) => existsSync(file));
  if (production && path) return JSON.parse(readFileSync(path, 'utf8'));
  return {
    name: 'lastfind-personal-local', compatibility_date: '2026-09-05', compatibility_flags: ['nodejs_compat'],
    version_metadata: { binding: 'WORKER_VERSION' },
    d1_databases: [{ binding: 'DB', database_name: 'lastfind-local', database_id: '00000000-0000-4000-8000-000000000000' }],
    r2_buckets: [{ binding: 'RAW_RESPONSES', bucket_name: 'lastfind-local-raw' }],
    durable_objects: { bindings: [{ name: 'PROJECT_STORES', class_name: 'ProjectStore' }, { name: 'LASTFIND_AGENT', class_name: 'LastfindAgent' }] },
    exports: { ProjectStore: { type: 'durable-object', storage: 'sqlite' }, LastfindAgent: { type: 'durable-object', storage: 'sqlite' } },
    triggers: { crons: ['*/5 * * * *'] },
    vars: { APP_URL: `http://localhost:${port}`, OWNER_EMAIL: 'owner@example.test', ...(testing ? {
      SESSION_SECRET: 'isolated-personal-test-secret-not-for-production', OWNER_ACCESS_KEY_HASH: createHash('sha256').update('isolated-owner-test-key-only-not-for-production').digest('hex'),
      DATAFORSEO_LOGIN: 'not-a-real-login', DATAFORSEO_PASSWORD: 'not-a-real-password', CRON_SECRET: 'lastfind-isolated-test-secret-not-for-production',
    } : (!production ? developmentSettings(root, 'selfhost', true) : {})) },
  };
}
export const integration = {
  port: 3092,
  preflight: [
    ['node', '--experimental-strip-types', './packages/core/tests/project-store-integration.mjs'],
    ['node', '--experimental-strip-types', './packages/core/tests/analysis-extend-integration.mjs'],
    ['node', '--experimental-strip-types', './packages/core/tests/products-store-integration.mjs'],
    ['node', '--experimental-strip-types', './packages/core/tests/ai-bots-store-integration.mjs'],
    ['node', '--experimental-strip-types', './packages/core/tests/monitoring-storage-integration.mjs'],
  ],
  http: [
    ['node', '--experimental-strip-types', './apps/selfhost/tests/selfhost-integration.mjs'],
    ['node', './apps/selfhost/tests/oauth-integration.mjs'],
    ['node', '--experimental-strip-types', './apps/selfhost/tests/mcp-integration.mjs'],
  ],
};
