import { editionError } from '@edition/server/errors';
import { policyError } from './capabilities';
import { headers } from 'next/headers';
import { errorLocale, localizeApiError, type ApiLocale } from './errors-i18n';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function fail(error: unknown) {
  let locale: ApiLocale = 'en';
  try {
    locale = errorLocale((await headers()).get('cookie'));
  } catch {
    /* Default outside a request context. */
  }
  const response = (message: string, status: number) =>
    json(
      {
        error:
          editionError(message, locale) ?? localizeApiError(message, locale),
      },
      status,
    );
  if (error instanceof ApiError) return response(error.message, error.status);
  const message = error instanceof Error ? error.message : '';
  if (message.includes('PROMPT_CHANGED')) return response('This question changed. Refresh and try again.', 409);
  const policyMessage = policyError(message);
  if (policyMessage) return response(policyMessage, 403);
  if (message.includes('UNIQUE constraint failed: prompts')) return response('This question already exists.', 409);
  if (message.includes('UNIQUE constraint failed: projects.workspace_id, projects.slug')) return response('Another project in this workspace already uses this address.', 409);
  if (message.includes('UNIQUE constraint failed: topics'))
    return response('Já existe um tópico com esse nome.', 409);
  // The cause goes to the Worker log only (message, stack, cause), never to the client: "Error" alone told nothing (12/11/2026).
  console.error(
    'Lastfind request failed:',
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack?.split('\n').slice(0, 8).join('\n'), cause: error.cause instanceof Error ? `${error.cause.name}: ${error.cause.message}` : error.cause }
      : String(error),
  );
  return response('Could not complete this operation. Please try again.', 500);
}
/** A JSON object body of at most `limit` bytes (100 KB; a route that takes images passes its own). */
export async function body(request: Request, limit = 100000): Promise<Record<string, unknown>> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json'))
    throw new ApiError(415, 'Envie JSON.');
  if (Number(request.headers.get('content-length')) > limit)
    throw new ApiError(413, 'Conteúdo muito grande.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Envie um conteúdo JSON.');
  let bytes = 0,
    raw = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new ApiError(413, 'Conteúdo muito grande.');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0;
    return data;
  } catch {
    throw new ApiError(400, 'JSON inválido.');
  }
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin)
    throw new ApiError(403, 'Origem da solicitação inválida.');
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new ApiError(403, 'Solicitação externa bloqueada.');
}
export function textField(
  value: unknown,
  label: string,
  min = 1,
  max = 100,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new ApiError(400, `${label}: use entre ${min} e ${max} caracteres.`);
  return value.trim();
}
