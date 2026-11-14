import { env } from 'cloudflare:workers';
import { collectingServerTiming, timed } from './server-timing';
import { storedSetting } from './stored-settings';
/** The Worker's own variable or secret (`vars`, `wrangler secret put`, `npm run setup`), never a value saved in Admin. */
export function workerSetting(key: string): string {
  const value = (env as unknown as Record<string, unknown>)[key];
  if (typeof value === 'string') return value;
  // `process` is not present in a Worker without the Node compatibility flag.
  // Keep the local-process fallback without making an absent binding a 500.
  const processEnv =
    typeof process === 'undefined' ? undefined : process.env;
  return processEnv?.[key] ?? '';
}
/**
 * The value in effect: a provider credential saved in Admin (`platform-settings.ts`) wins, so Admin can replace a
 * credential the Worker also has; without one, the Worker's own variable or secret.
 */
export function setting(key: string): string {
  return storedSetting(key) || workerSetting(key);
}
const rawStatements = new WeakMap<object, D1PreparedStatement>();
/** The D1 binding that adds each query's time to the request's Server-Timing (`d1`); statements stay the real ones for `batch`. */
function timedD1(database: D1Database): D1Database {
  const statement = (raw: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(raw, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (property === 'bind') return (...params: unknown[]) => statement(target.bind(...params));
        if (property === 'first' || property === 'all' || property === 'run' || property === 'raw')
          return (...args: unknown[]) => timed('d1', async () => value.apply(target, args));
        return value.bind(target);
      },
    });
    rawStatements.set(wrapped, raw);
    return wrapped;
  };
  return new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property === 'prepare') return (query: string) => statement(target.prepare(query));
      if (property === 'batch')
        return (statements: D1PreparedStatement[]) =>
          timed('d1', async () => target.batch(statements.map((item) => rawStatements.get(item) ?? item)));
      return value.bind(target);
    },
  });
}
// One wrapper per binding, so code that remembers a database by identity (the catalog fold) still recognizes it.
const timedBindings = new WeakMap<D1Database, D1Database>();
export function db(): D1Database {
  if (!env.DB) throw new Error('Database binding DB is unavailable');
  if (!collectingServerTiming()) return env.DB;
  let wrapped = timedBindings.get(env.DB);
  if (!wrapped) timedBindings.set(env.DB, (wrapped = timedD1(env.DB)));
  return wrapped;
}
/** D1 refusals Cloudflare says to try again: the database busy (a scheduler tick), reset (a deploy) or a lost connection. */
const TRANSIENT_D1 = /D1 DB is overloaded|Network connection lost|storage caused object to be reset|reset because its code was updated|internal error/i;
/**
 * A read that a busy moment of the database must not turn into an error page (the session a page opens with): tried again
 * after each wait while D1 answers a transient refusal. Only for reads: a write may have happened before the refusal.
 */
export async function retryRead<T>(read: () => Promise<T>, waits: readonly number[] = [250, 1000, 2000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= waits.length || !(error instanceof Error && TRANSIENT_D1.test(error.message))) throw error;
      await new Promise((done) => setTimeout(done, waits[attempt]));
    }
  }
}
export const now = () => new Date().toISOString();
/** The deployed version (Cloudflare's version metadata binding); none locally. */
export const workerVersion = () => (env as { WORKER_VERSION?: { id?: string } }).WORKER_VERSION?.id;
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
