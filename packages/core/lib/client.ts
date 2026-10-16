export const responseCacheExpiry = new WeakMap<object, number>();

function clientMessage(en: string, pt: string) {
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

export async function requestJson<T = Record<string, unknown>>(
  path: string,
  method = 'GET',
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method,
      signal,
      cache: 'no-store',
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw connectionError();
  }
  let result: T & { error?: string };
  try {
    result = await r.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw connectionError();
  }
  if (!r.ok)
    throw new Error(
      typeof result?.error === 'string' && result.error.trim()
        ? result.error
        : clientMessage(
            'Could not complete this operation. Please try again.',
            'Não foi possível concluir. Tente novamente.',
          ),
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
