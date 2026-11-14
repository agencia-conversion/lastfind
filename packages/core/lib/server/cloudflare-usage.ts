import { readCloudflareUsage, type CloudflareUsage } from '@/lib/cloudflare-usage';
import { ApiError } from './http';
import { setting } from './env';
import { loadPlatformSettings } from './platform-settings';

/** Cloudflare's numbers settle within the hour: one read per isolate an hour is enough, and keeps the API's rate limit far. */
const TTL_MS = 60 * 60 * 1000;
type Shown = Omit<CloudflareUsage, 'failed'> & { failed: { id: string }[] };
let kept: { key: string; at: number; value: Shown } | null = null;

/**
 * Admin only (the route checks it): this Cloudflare account's usage and estimated cost. It needs an API token
 * `CLOUDFLARE_ANALYTICS_TOKEN` (Account Analytics: Read, on this account only) and the account `CLOUDFLARE_ACCOUNT_ID`:
 * saved in Admin > Providers first, the Worker's secret or variable otherwise. Without them the answer names what is
 * missing and nothing is asked of Cloudflare. The kept reading is keyed by account and token, so saving a new token
 * reads again at once.
 */
export async function adminCloudflareUsage(fetchImpl: typeof fetch = fetch, now = Date.now()) {
  // Another isolate may have saved the token in the last minute.
  await loadPlatformSettings(true);
  const token = setting('CLOUDFLARE_ANALYTICS_TOKEN');
  const account = setting('CLOUDFLARE_ACCOUNT_ID');
  if (!token || !account) return { configured: false as const, missing: [!token && 'CLOUDFLARE_ANALYTICS_TOKEN', !account && 'CLOUDFLARE_ACCOUNT_ID'].filter(Boolean) as string[] };
  const key = `${account}:${token}`;
  if (kept?.key === key && now - kept.at < TTL_MS) return kept.value;
  const read = await readCloudflareUsage({ account, token, today: new Date(now), fetchImpl });
  // Cloudflare's own words stay in the Worker log; the screen names only which measure is missing.
  for (const item of read.failed) console.warn(`Cloudflare usage: ${item.id} not read: ${item.message}`);
  const value = { ...read, failed: read.failed.map(({ id }) => ({ id })) };
  kept = { key, at: now, value };
  return value;
}

export async function saveAdminCloudflareUsage(): Promise<never> {
  throw new ApiError(404, 'Not found.');
}
