import { env } from 'cloudflare:workers';
export function setting(key: string): string {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : (process.env[key] ?? '');
}
export function db(): D1Database {
  if (!env.DB) throw new Error('Database binding DB is unavailable');
  return env.DB;
}
export const now = () => new Date().toISOString();
export function appOrigin() {
  const value = setting('APP_URL');
  if (!value) throw new Error('APP_URL is not configured');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)
    )
  )
    throw new Error('APP_URL must use HTTPS');
  return url.origin;
}
