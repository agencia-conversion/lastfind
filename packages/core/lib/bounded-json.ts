export class JsonBodyError extends Error {
  readonly kind: 'too_large' | 'invalid_json';
  constructor(kind: 'too_large' | 'invalid_json') {
    super(kind);
    this.kind = kind;
  }
}

/** Bound the network stream before buffering or decoding any oversized input. */
export async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('Invalid body limit');
  if (Number(request.headers.get('content-length')) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new JsonBodyError('too_large');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new JsonBodyError('invalid_json');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0,
    text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JsonBodyError('too_large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof JsonBodyError) throw error;
    await reader.cancel().catch(() => undefined);
    throw new JsonBodyError('invalid_json');
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const text = await readBoundedText(request, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new JsonBodyError('invalid_json');
  }
}
