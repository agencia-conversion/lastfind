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
  const policyMessage = policyError(message);
  if (policyMessage) return response(policyMessage, 403);
  if (message.includes('UNIQUE constraint failed: topics'))
    return response('Já existe um tópico com esse nome.', 409);
  console.error(
    'Lastfind request failed:',
    error instanceof Error ? error.name : 'Unknown error',
  );
  return response('Could not complete this operation. Please try again.', 500);
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json'))
    throw new ApiError(415, 'Envie JSON.');
  if (Number(request.headers.get('content-length')) > 100000)
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
      if (bytes > 100000) {
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
