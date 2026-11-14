// Free, read-only endpoints (the same ones `npm run setup` checks): confirming a credential never creates a paid
// task. The answer names the outcome, never the credential.
const DATAFORSEO_USER = 'https://api.dataforseo.com/v3/appendix/user_data';
const OPENROUTER_KEY = 'https://openrouter.ai/api/v1/key';
const OPENAI_MODELS = 'https://api.openai.com/v1/models';
const ANTHROPIC_MODELS = 'https://api.anthropic.com/v1/models?limit=1';
export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

export type ProviderCheck =
  | { ok: true; balance: number | null }
  | { ok: false; reason: 'invalid' | 'unreachable' | 'unexpected' | 'permission'; status?: number };

async function request(fetchImpl: typeof fetch, url: string, authorization: string) {
  try {
    const response = await fetchImpl(url, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(15000) });
    let body: Record<string, unknown> | null = null;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      /* A non-JSON answer is reported by status only. */
    }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

export async function checkDataForSeo(login: string, password: string, fetchImpl: typeof fetch = fetch): Promise<ProviderCheck> {
  const { status, body } = await request(fetchImpl, DATAFORSEO_USER, `Basic ${btoa(`${login}:${password}`)}`);
  if (status === 0) return { ok: false, reason: 'unreachable' };
  if (status === 401 || status === 403 || body?.status_code === 40100) return { ok: false, reason: 'invalid' };
  if (status !== 200 || body?.status_code !== 20000) return { ok: false, reason: 'unexpected', status };
  const tasks = body.tasks as { result?: { money?: { balance?: unknown } }[] }[] | undefined;
  const balance = tasks?.[0]?.result?.[0]?.money?.balance;
  return { ok: true, balance: typeof balance === 'number' ? balance : null };
}

/** `balance` is what is left of the key's spending limit, when it has one. */
export async function checkOpenRouter(key: string, fetchImpl: typeof fetch = fetch): Promise<ProviderCheck> {
  const { status, body } = await request(fetchImpl, OPENROUTER_KEY, `Bearer ${key}`);
  if (status === 0) return { ok: false, reason: 'unreachable' };
  if (status === 401 || status === 403) return { ok: false, reason: 'invalid' };
  const data = body?.data as { limit_remaining?: unknown } | undefined;
  if (status !== 200 || !data) return { ok: false, reason: 'unexpected', status };
  return { ok: true, balance: typeof data.limit_remaining === 'number' ? data.limit_remaining : null };
}

/** OpenAI and Anthropic list their models for free: a key that lists them is accepted (no balance is exposed there). */
async function checkModelList(fetchImpl: typeof fetch, url: string, headers: Record<string, string>): Promise<ProviderCheck> {
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'invalid' };
    if (response.status !== 200) return { ok: false, reason: 'unexpected', status: response.status };
    return { ok: true, balance: null };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
export const checkOpenAI = (key: string, fetchImpl: typeof fetch = fetch) => checkModelList(fetchImpl, OPENAI_MODELS, { Authorization: `Bearer ${key}` });
export const checkAnthropic = (key: string, fetchImpl: typeof fetch = fetch) =>
  checkModelList(fetchImpl, ANTHROPIC_MODELS, { 'x-api-key': key, 'anthropic-version': '2023-06-01' });

/**
 * The token is live (a user token, or one the account owns), then it reads one day of Workers requests on the account:
 * that needs Account Analytics: Read on this account, the only permission the usage reader uses. `permission`: the token
 * is valid but cannot read this account's analytics.
 */
export async function checkCloudflare(token: string, account: string, fetchImpl: typeof fetch = fetch): Promise<ProviderCheck> {
  const bearer = `Bearer ${token}`;
  const user = await request(fetchImpl, `${CLOUDFLARE_API}/user/tokens/verify`, bearer);
  const verify = user.status === 200 ? user : await request(fetchImpl, `${CLOUDFLARE_API}/accounts/${encodeURIComponent(account)}/tokens/verify`, bearer);
  if (verify.status === 0) return { ok: false, reason: 'unreachable' };
  if ([400, 401, 403, 404].includes(verify.status)) return { ok: false, reason: 'invalid' };
  const result = verify.body?.result as { status?: unknown } | undefined;
  if (verify.status !== 200 || verify.body?.success !== true) return { ok: false, reason: 'unexpected', status: verify.status };
  if (result?.status !== 'active') return { ok: false, reason: 'invalid' };
  const day = new Date().toISOString().slice(0, 10);
  type Answer = { data?: { viewer?: { accounts?: unknown[] } } | null; errors?: unknown[] | null } | null;
  const answer = await fetchImpl(`${CLOUDFLARE_API}/graphql`, {
    method: 'POST',
    headers: { Authorization: bearer, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'query($account: string!, $day: Date!) { viewer { accounts(filter: { accountTag: $account }) { workersInvocationsAdaptive(limit: 1, filter: { date_geq: $day, date_leq: $day }) { sum { requests } } } } }',
      variables: { account, day },
    }),
    signal: AbortSignal.timeout(15000),
  }).then(
    async (response) => ({ status: response.status, body: (await response.json().catch(() => null)) as Answer }),
    () => null,
  );
  if (!answer) return { ok: false, reason: 'unreachable' };
  const { status, body } = answer;
  if (body?.errors?.length || (status === 200 && !body?.data?.viewer?.accounts?.length)) return { ok: false, reason: 'permission' };
  if (status !== 200) return { ok: false, reason: 'unexpected', status };
  return { ok: true, balance: null };
}
