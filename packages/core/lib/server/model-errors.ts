import type { LanguageModelMiddleware } from 'ai';
import { localizeApiError, type ApiLocale } from './errors-i18n';

/** What a person reads when the AI service fails (no credit, down, slow): never the service's name, status or reply. */
export const AI_UNAVAILABLE = 'The AI service is unavailable right now. Try again in a few minutes.';

type StreamPart = Awaited<ReturnType<Parameters<NonNullable<LanguageModelMiddleware['wrapStream']>>[0]['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never;
/** Stream parts that carry no answer yet: a failure after only these is retried. */
const SILENT = new Set(['stream-start', 'response-metadata', 'raw']);
// A stream's error part is the service's plain JSON (`{ message, code }`), not an Error.
const detail = (error: unknown) => (error instanceof Error ? error.message : (JSON.stringify(error) ?? String(error))).slice(0, 300);

/**
 * The agent's model, with every failure of the service (an HTTP refusal, a dropped connection, an error inside the stream)
 * turned into AI_UNAVAILABLE in the person's language; the detail goes to the Worker's log only. A stop by the person
 * (AbortError) passes as it is.
 */
export function neutralModelErrors(locale: ApiLocale): LanguageModelMiddleware {
  const neutral = (error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') return error;
    console.error('Lastfind model call failed:', detail(error));
    return new Error(localizeApiError(AI_UNAVAILABLE, locale));
  };
  return {
    specificationVersion: 'v4',
    wrapGenerate: async ({ doGenerate }) => {
      try {
        return await doGenerate();
      } catch (error) {
        throw neutral(error);
      }
    },
    wrapStream: async ({ doStream }) => {
      for (let attempt = 0; ; attempt++) {
        let result: Awaited<ReturnType<typeof doStream>>;
        try {
          result = await doStream();
        } catch (error) {
          throw neutral(error);
        }
        // Read up to the first part that answers. A failure before it (the service erring mid-answer before writing
        // anything, 9/11/2026) is asked once more, unseen; after it, the person already reads the answer.
        const reader = result.stream.getReader();
        const head: StreamPart[] = [];
        let done = false;
        while (!done) {
          const next = await reader.read();
          if (next.done) done = true;
          else {
            head.push(next.value);
            if (!SILENT.has(next.value.type)) break;
          }
        }
        const last = head.at(-1);
        if (last?.type === 'error' && attempt === 0) {
          console.error('Lastfind model call failed before answering, asking again:', detail(last.error));
          await reader.cancel().catch(() => {});
          continue;
        }
        const map = (part: StreamPart): StreamPart => (part.type === 'error' ? { ...part, error: neutral(part.error) } : part);
        return {
          ...result,
          stream: new ReadableStream<StreamPart>({
            start(out) {
              for (const part of head) out.enqueue(map(part));
              if (done) out.close();
            },
            async pull(out) {
              const next = await reader.read();
              if (next.done) out.close();
              else out.enqueue(map(next.value));
            },
            cancel: (reason) => reader.cancel(reason),
          }),
        };
      }
    },
  };
}
