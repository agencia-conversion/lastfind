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
  return result;
}
