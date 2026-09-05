import { developmentSettings } from '../../scripts/development-settings.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export function configuration({ root, testing, port, production }) {
  const path = resolve(root, 'wrangler.selfhost.json');
  if (production && existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  return {
    name: 'lastfind-personal-local', compatibility_date: '2026-09-05', compatibility_flags: ['nodejs_compat'],
    d1_databases: [{ binding: 'DB', database_name: 'lastfind-local', database_id: '00000000-0000-4000-8000-000000000000' }],
    r2_buckets: [{ binding: 'RAW_RESPONSES', bucket_name: 'lastfind-local-raw' }],
    durable_objects: { bindings: [{ name: 'PROJECT_STORES', class_name: 'ProjectStore' }] },
    exports: { ProjectStore: { type: 'durable-object', storage: 'sqlite' } },
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
    ['node', '--experimental-strip-types', './packages/core/tests/monitoring-storage-integration.mjs'],
    ['python3', './packages/core/tests/monitor-client.py'],
  ],
  http: [['node', '--experimental-strip-types', './apps/selfhost/tests/selfhost-integration.mjs']],
};
