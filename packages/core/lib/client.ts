import { WORKSPACE_HEADER } from './workspace-link.ts';
export const responseCacheExpiry = new WeakMap<object, number>();

export function clientMessage(en: string, pt: string) {
  const portuguese =
    typeof document !== 'undefined' &&
    document.cookie
      .split(';')
      .some((cookie) => cookie.trim() === 'lastfind_locale=pt-BR');
  return portuguese ? pt : en;
}

function connectionError() {
  return new Error(
    clientMessage(
      'The server did not respond. Please try again.',
      'O servidor não respondeu. Tente novamente.',
    ),
  );
}

// A cold project store can answer 503 while it publishes; the data is intact and
// the next read succeeds. Reads wait and retry, so a screen never ends on it.
const UNAVAILABLE_RETRY_MS = [2000, 4000, 6000, 8000];
/**
 * The longest a read waits for its answer, retries included: one the server never answers ends in the screen's error state
 * (with its retry), not a placeholder forever. The slowest reads (a report computed after new data) take well under it.
 */
export const READ_TIMEOUT_MS = 60_000;
/** A timed-out read fails like a lost connection; the caller's own abort stays an AbortError (a screen ignores it). */
const timedOut = (error: unknown) => error instanceof Error && error.name === 'TimeoutError';

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(timedOut(signal?.reason) ? connectionError() : new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * The workspace (its slug) the open address names (Cloud): every request carries it, so the server acts in the workspace this
 * tab shows even when another tab opened another one. Set by the app once it knows its address.
 */
let requestWorkspace: string | null = null;
export function setRequestWorkspace(slug: string | null) {
  requestWorkspace = slug;
}
/** The headers an app request sends (a JSON body's type, the open workspace). */
export function requestHeaders(json = false): Record<string, string> {
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(requestWorkspace ? { [WORKSPACE_HEADER]: requestWorkspace } : {}) };
}

export async function requestJson<T = Record<string, unknown>>(
  path: string,
  method = 'GET',
  data?: unknown,
  caller?: AbortSignal,
): Promise<T> {
  const timeout = method === 'GET' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(READ_TIMEOUT_MS) : undefined;
  const signal = !timeout ? caller : !caller ? timeout : typeof AbortSignal.any === 'function' ? AbortSignal.any([caller, timeout]) : caller;
  let r: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await fetch(path, {
        method,
        signal,
        cache: 'no-store',
        headers: requestHeaders(!!data),
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw connectionError();
    }
    if (r.status !== 503 || method !== 'GET' || attempt >= UNAVAILABLE_RETRY_MS.length)
      break;
    await pause(UNAVAILABLE_RETRY_MS[attempt], signal);
  }
  let result: T & { error?: string };
  try {
    result = await r.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw connectionError();
  }
  // The status rides on the error, for callers that tell a conflict (409) or a signed-out session (401) apart.
  if (!r.ok)
    throw Object.assign(
      new Error(
        typeof result?.error === 'string' && result.error.trim()
          ? result.error
          : clientMessage(
              'Could not complete this operation. Please try again.',
              'Não foi possível concluir. Tente novamente.',
            ),
      ),
      { status: r.status },
    );
  const expires = Number(r.headers.get('X-Lastfind-Cache-Expires'));
  if (
    result &&
    typeof result === 'object' &&
    Number.isFinite(expires) &&
    expires > 0
  )
    responseCacheExpiry.set(result, expires);
  return result;
}

/** The signed-in person's name or details changed in this tab (Settings > My profile): the app reads its workspace again. */
export const ACCOUNT_CHANGED_EVENT = 'lastfind:account-changed';

// Session notifications contain only a nonce. Receivers revalidate with the
// server; this transport never carries identity, credentials or permissions.
export const PUBLIC_SESSION_CHANNEL = 'lastfind-public-session';
export const PUBLIC_SESSION_CHANGE_KEY = 'lastfind.session.changed';
export function announceSessionChange() {
  if (typeof window === 'undefined') return;
  let nonce: string;
  try {
    nonce = window.crypto.randomUUID();
  } catch {
    return;
  }
  try {
    window.localStorage.setItem(PUBLIC_SESSION_CHANGE_KEY, nonce);
  } catch {
    // Restricted storage still permits channel or foreground revalidation.
  }
  try {
    const channel = new BroadcastChannel(PUBLIC_SESSION_CHANNEL);
    channel.postMessage(nonce);
    channel.close();
  } catch {
    // Storage and foreground revalidation remain independent fallbacks.
  }
}

const RELOAD_KEY = 'lastfind:reloaded-for-new-version';
/** A part of the app that a tab opened before a deploy can no longer load (its file was replaced by the new version's). */
export const isStaleChunk = (error: unknown) =>
  error instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically|Unable to preload CSS/i.test(error.message);
/**
 * Each deploy replaces the app's hashed files, so a tab opened before it may ask for one that is gone: one reload takes the new
 * version. At most once a minute per tab, so a real failure still shows. True when it reloads.
 */
export function reloadForNewVersion() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
