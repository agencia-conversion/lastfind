/**
 * The one way every decision-model call leaves (sentiment, source types, roles, brand domains, the checks' scripts):
 * OpenRouter's typed Decisions endpoint, with the sampling asked to be deterministic. No network of its own beyond the
 * caller's key; dependency-free so scripts use it too.
 */
export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
/** Waits before resending a 429, unless the provider asks for another (capped at 10 s). */
export const RATE_LIMIT_WAITS_MS = [2_000, 5_000];
/**
 * Asked on every call: the same input should get the same answer. The typed Decisions contract documents no
 * sampling parameter, so a provider may ignore these; one that refuses them (HTTP 400 naming them) is asked again without
 * them, once, and they are no longer sent from this isolate.
 */
export const DECISION_SAMPLING = { temperature: 0, seed: 20261029 } as const;
let samplingRefused = false;

export async function sendDecisions(
  payload: unknown,
  { key, title = 'Lastfind', timeoutMs = 30_000, waits = RATE_LIMIT_WAITS_MS }: { key: string; title?: string; timeoutMs?: number; waits?: number[] },
) {
  const post = (body: unknown) =>
    fetch(DECISIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': title },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  for (let attempt = 0; ; attempt++) {
    const sampling = !samplingRefused && !!payload && typeof payload === 'object' && !Array.isArray(payload);
    let response = await post(sampling ? { ...(payload as object), ...DECISION_SAMPLING } : payload);
    // A 400 that names them is a validation refusal of the sampling fields, before any work and not billed: the request
    // goes again without them. Any other 400 is returned as it is.
    if (sampling && response.status === 400 && /temperature|seed/iu.test(await response.clone().text().catch(() => ''))) {
      await response.body?.cancel();
      response = await post(payload);
      samplingRefused = true;
    }
    if (response.status !== 429 || attempt >= waits.length) return response;
    const asked = Number(response.headers.get('retry-after')) * 1000;
    await response.body?.cancel();
    await new Promise((done) => setTimeout(done, Math.min(asked > 0 ? asked : waits[attempt]!, 10_000)));
  }
}
