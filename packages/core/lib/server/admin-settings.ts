import { isDecisionModel, MODEL } from '@/lib/classifier-models';
import { chatModelFor, decisionModelFor, MODEL_PROVIDERS, PROVIDER_ORDER_SETTING, type ModelProvider } from '@/lib/model-providers';
import { decisionKeyConfigured, modelProviderOrder, modelRoutes, providerKey } from './model-routes';
import { RESEARCH_MODELS } from '@/lib/brand-research-provider';
import { classifierFunctionStatus } from './classifier-models';
import { googleSignIn } from './capabilities';
import { appOrigin, db, now, workerSetting } from './env';
import { ApiError } from './http';
import {
  CLASSIFIER_SETTING_PREFIX,
  loadPlatformSettings,
  PlatformSettingError,
  PROVIDER_SECRETS,
  providerSecret,
  recentAdminAudit,
  savePlatformSetting,
  type ProviderSecret,
} from './platform-settings';
import { checkAnthropic, checkCloudflare, checkDataForSeo, checkOpenAI, checkOpenRouter, type ProviderCheck } from './provider-check';
import { storedSetting, storedSettingUnreadable } from './stored-settings';

export type SettingSource = 'env' | 'stored' | 'unreadable' | null;
/**
 * Where the provider credential in effect comes from (`stored`: saved in Admin; `env`: the Worker's own), with a hint
 * that identifies it without revealing it. `worker` hints at the Worker's own value whenever it has one, also behind a
 * stored value (removing the stored one goes back to it); `unreadable` flags a sealed value no current credentials key (CREDENTIALS_KEY, SESSION_SECRET)
 * can open, even while the Worker's value covers it.
 */
export function providerSecretStatus(key: ProviderSecret) {
  const worker = workerSetting(key);
  const stored = storedSetting(key);
  const unreadable = storedSettingUnreadable(key);
  const value = stored || worker;
  const source: SettingSource = stored ? 'stored' : worker ? 'env' : unreadable ? 'unreadable' : null;
  return { key, set: !!value, source, hint: value ? hint(key, value) : null, worker: worker ? hint(key, worker) : null, unreadable };
}
function hint(key: ProviderSecret, value: string) {
  if (key === 'CLOUDFLARE_ACCOUNT_ID') return value;
  if (key === 'DATAFORSEO_LOGIN') {
    const at = value.indexOf('@');
    return at > 0 ? `${value[0]}***${value.slice(at)}` : `${value[0]}***`;
  }
  return value.length > 8 ? `****${value.slice(-4)}` : '****';
}

const GOOGLE_KEYS: ProviderSecret[] = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
/** Google has no free check; the format of an OAuth web client is validated instead. */
const GOOGLE_FORMAT: Record<string, RegExp> = {
  GOOGLE_CLIENT_ID: /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
  GOOGLE_CLIENT_SECRET: /^GOCSPX-[A-Za-z0-9_-]{20,}$/,
};

/** Admin > Providers: each credential's state (never its value), which providers this edition has, and the latest changes. */
export async function adminProviders() {
  // Read the database again: another isolate may have saved or removed a value in the last minute.
  await loadPlatformSettings(true);
  const secrets = PROVIDER_SECRETS.filter((key) => googleSignIn || !GOOGLE_KEYS.includes(key));
  let origin: string | null = null;
  try {
    origin = appOrigin();
  } catch {
    /* Without APP_URL only the production redirect is listed. */
  }
  // When each value saved here was last written (a Worker secret has no date here).
  const { results: saved } = await db()
    .prepare(`SELECT key,updated_at FROM platform_settings WHERE key IN (${secrets.map(() => '?').join(',')})`)
    .bind(...secrets)
    .all<{ key: string; updated_at: string }>();
  return {
    providers: ['dataforseo', 'openai', 'anthropic', 'openrouter', ...(googleSignIn ? ['google'] : []), 'cloudflare'],
    models: await modelProvidersState(),
    secrets: secrets.map(providerSecretStatus),
    updatedAt: Object.fromEntries(saved.map((row) => [row.key, row.updated_at])) as Partial<Record<ProviderSecret, string>>,
    // The OAuth client must list every origin that signs in: production and, on a preview or locally, this one.
    redirectUris: googleSignIn ? [...new Set([googleSignIn.productionOrigin, origin].filter((value): value is string => !!value))].map((value) => `${value}/api/auth/google/callback`) : [],
    audit: await recentAdminAudit(),
  };
}

type TallyRow = { provider: string; task: string; calls: number; failovers: number; cost_usd: number; unpriced: number; last_at: string | null; last_model: string | null; last_error: string | null; last_error_at: string | null };
/**
 * Admin > Providers, model providers: the order in effect, which have a key, today's tally per provider (calls served,
 * failovers and their last reason, cost) and, per function of Admin > Classifiers, the model each provider runs and the
 * one that answers now. Read only by Admin.
 */
export async function modelProvidersState() {
  const today = now().slice(0, 10);
  const rows = await db()
    .prepare('SELECT provider,task,calls,failovers,cost_usd,unpriced,last_at,last_model,last_error,last_error_at FROM llm_provider_usage WHERE day=?')
    .bind(today)
    .all<TallyRow>()
    .then((read) => read.results, () => [] as TallyRow[]);
  const later = (a: string | null, b: string | null) => ((a ?? '') > (b ?? '') ? a : b);
  const tally = MODEL_PROVIDERS.map((provider) => {
    const mine = rows.filter((row) => row.provider === provider);
    const lastCall = mine.reduce<TallyRow | null>((best, row) => (row.last_at && row.last_at === later(row.last_at, best?.last_at ?? null) ? row : best), null);
    const lastError = mine.reduce<TallyRow | null>((best, row) => (row.last_error_at && row.last_error_at === later(row.last_error_at, best?.last_error_at ?? null) ? row : best), null);
    return {
      provider,
      calls: mine.reduce((sum, row) => sum + Number(row.calls), 0),
      failovers: mine.reduce((sum, row) => sum + Number(row.failovers), 0),
      costUsd: mine.reduce((sum, row) => sum + Number(row.cost_usd), 0),
      unpriced: mine.reduce((sum, row) => sum + Number(row.unpriced), 0),
      lastAt: lastCall?.last_at ?? null,
      lastTask: lastCall?.task ?? null,
      lastModel: lastCall?.last_model ?? null,
      lastError: lastError?.last_error ?? null,
      lastErrorAt: lastError?.last_error_at ?? null,
      lastErrorTask: lastError?.task ?? null,
    };
  });
  const functions = classifierFunctionStatus()
    // A model without a provider prefix is the search data provider's reader, not one of these providers.
    .filter((fn) => fn.effective.includes('/'))
    .map((fn) => {
      const decisions = isDecisionModel(fn.effective);
      const on = (provider: ModelProvider) => (decisions ? decisionModelFor(provider, fn.effective) : chatModelFor(provider, fn.effective, fn.id));
      return {
        id: fn.id,
        label: fn.label,
        model: fn.effective,
        decisions,
        models: Object.fromEntries(MODEL_PROVIDERS.map((provider) => [provider, on(provider)])) as Record<ModelProvider, string | null>,
        servedBy: modelRoutes(fn.effective, { task: fn.id, decisions })[0]?.provider ?? null,
      };
    });
  return {
    order: modelProviderOrder(),
    saved: !!storedSetting(PROVIDER_ORDER_SETTING),
    configured: Object.fromEntries(MODEL_PROVIDERS.map((provider) => [provider, !!providerKey(provider)])) as Record<ModelProvider, boolean>,
    today: tally,
    functions,
  };
}

const isSecret = (key: unknown): key is ProviderSecret => (PROVIDER_SECRETS as readonly unknown[]).includes(key);
async function save(key: string, value: unknown, actor: string) {
  if (typeof value !== 'string') throw new ApiError(400, 'Invalid value.');
  try {
    await savePlatformSetting(key, value, actor);
  } catch (error) {
    if (error instanceof PlatformSettingError) throw new ApiError(error.status, error.message);
    throw error;
  }
}

/**
 * `{ action: 'save', values: { KEY: value, ... } }` stores the credentials of one provider (an empty value removes the
 * saved one, and the Worker's own value, if any, is in effect again). Every value is checked before anything is written,
 * so a pair is never half saved. A saved credential wins over the Worker's. `{ action: 'check', provider, ...typed }`
 * asks the provider's free endpoint whether the typed credential, or the one in effect when nothing is typed, is
 * accepted: no paid task is created.
 */
export async function saveAdminProvider(body: Record<string, unknown>, actor: string, fetchImpl: typeof fetch = fetch) {
  if (body.action === 'check') return check(body, fetchImpl);
  // `{ action: 'order', order: ['openai','anthropic','openrouter'] }`: every model provider once, first to last.
  if (body.action === 'order') {
    const order = Array.isArray(body.order) ? body.order : [];
    if (order.length !== MODEL_PROVIDERS.length || new Set(order).size !== order.length || !order.every((id) => (MODEL_PROVIDERS as readonly unknown[]).includes(id)))
      throw new ApiError(400, 'List every model provider once.');
    await save(PROVIDER_ORDER_SETTING, order.join(','), actor);
    return null;
  }
  const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? Object.entries(body.values) : [];
  if (!values.length) throw new ApiError(400, 'Unknown setting.');
  for (const [key, value] of values) {
    if (!isSecret(key) || (!googleSignIn && GOOGLE_KEYS.includes(key))) throw new ApiError(400, 'Unknown setting.');
    if (typeof value !== 'string') throw new ApiError(400, 'Invalid value.');
    const format = GOOGLE_FORMAT[key];
    if (format && value.trim() && !format.test(value.trim()))
      throw new ApiError(400, 'This does not look like a Google OAuth web client value.');
    // The account the deployment names (`CLOUDFLARE_ACCOUNT_ID` in the Worker's vars) is not replaced from Admin.
    if (key === 'CLOUDFLARE_ACCOUNT_ID' && value.trim()) {
      if (workerSetting(key)) throw new ApiError(400, 'The account ID is set by the deployment.');
      if (!/^[0-9a-f]{32}$/.test(value.trim())) throw new ApiError(400, 'An account ID has 32 characters, 0-9 and a-f.');
    }
  }
  for (const [key, value] of values) await save(key, value, actor);
  return null;
}
async function check(body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<{ check: ProviderCheck }> {
  const typed = (key: ProviderSecret) => {
    const value = body[key];
    return typeof value === 'string' && value.trim() ? value.trim() : providerSecret(key);
  };
  if (body.provider === 'dataforseo') {
    const login = typed('DATAFORSEO_LOGIN'),
      password = typed('DATAFORSEO_PASSWORD');
    if (!login || !password) throw new ApiError(400, 'Enter the login and the password.');
    return { check: await checkDataForSeo(login, password, fetchImpl) };
  }
  if (body.provider === 'openrouter') {
    const key = typed('OPENROUTER_API_KEY');
    if (!key) throw new ApiError(400, 'Enter the key.');
    return { check: await checkOpenRouter(key, fetchImpl) };
  }
  if (body.provider === 'openai' || body.provider === 'anthropic') {
    const key = typed(body.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');
    if (!key) throw new ApiError(400, 'Enter the key.');
    return { check: await (body.provider === 'openai' ? checkOpenAI : checkAnthropic)(key, fetchImpl) };
  }
  if (body.provider === 'cloudflare') {
    const token = typed('CLOUDFLARE_ANALYTICS_TOKEN'),
      account = typed('CLOUDFLARE_ACCOUNT_ID');
    if (!token || !account) throw new ApiError(400, 'Enter the token and the account ID.');
    return { check: await checkCloudflare(token, account, fetchImpl) };
  }
  throw new ApiError(400, 'Unknown provider.');
}

type LegacyRow = { project_id: string; name: string; domain: string | null; sentiment: string; source: string; automatic: number; revision: number };
/**
 * Projects that chose their own evaluator before the global setting existed (a sentiment evaluator other than Liquid,
 * a source-type evaluator other than Jev). They run those models only while no global model is saved for the function.
 */
export async function legacyEvaluators() {
  const { results } = await db()
    .prepare(
      `SELECT c.project_id,p.name,p.domain,COALESCE(c.sentiment_provider,c.provider) sentiment,c.provider source,c.automatic,c.revision
         FROM brand_research_configurations c JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id
         WHERE p.archived=0 AND (COALESCE(c.sentiment_provider,c.provider)<>'liquid' OR c.provider<>'jev') ORDER BY p.name`,
    )
    .all<LegacyRow>();
  return results.map((row) => ({
    projectId: row.project_id,
    name: row.name,
    domain: row.domain,
    sentiment: RESEARCH_MODELS[row.sentiment as keyof typeof RESEARCH_MODELS] ?? row.sentiment,
    sourceTypes: RESEARCH_MODELS[row.source as keyof typeof RESEARCH_MODELS] ?? row.source,
    automatic: !!row.automatic,
    revision: row.revision,
  }));
}

/** Admin > Classifiers: the model each function runs and where it comes from, plus the projects with a choice of their own. */
export async function adminClassifiers() {
  const [legacy, audit] = await Promise.all([legacyEvaluators(), recentAdminAudit()]);
  return {
    functions: classifierFunctionStatus(),
    legacy,
    audit,
    learningDisabled: workerSetting('AGENT_LEARNING_DISABLED') === 'true' || storedSetting('AGENT_LEARNING_DISABLED') === 'true',
    // Without the key, names that are also common words count as the text matcher finds them (Admin says so).
    decisionModelKey: decisionKeyConfigured(),
  };
}
/**
 * `{ id, model }` saves the model of a function; an empty model goes back to the server setting or the code default.
 * `{ action: 'reset-evaluators', projectId, expectedRevision }` returns one project to the default evaluators (Liquid
 * for sentiment, Jev for source types) in one conditional batch: the row moves to revision+1 only from the expected
 * revision, and only then are the project's pending jobs of a replaced evaluator cancelled. Sentiment readings made by
 * the old evaluator count as out of date until evaluated again; catalog rows (source types) are untouched. Audited.
 */
export async function saveAdminClassifier(body: Record<string, unknown>, actor: string) {
  if (body.action === 'reset-evaluators') return resetEvaluators(body, actor);
  // The agent's learning (agent-curator.ts) on or off for every project, at once: nothing paid runs while it is off.
  if (body.action === 'learning') return save('AGENT_LEARNING_DISABLED', body.disabled === true ? 'true' : '', actor).then(() => null);
  const { id, model } = body;
  if (typeof id !== 'string' || !classifierFunctionStatus().some((fn) => fn.id === id)) throw new ApiError(400, 'Unknown classifier.');
  if (classifierFunctionStatus().some((fn) => fn.id === id && fn.source === 'fixed')) throw new ApiError(400, 'The model of this function is fixed.');
  if (typeof model !== 'string' || (model.trim() && !MODEL.test(model.trim()))) throw new ApiError(400, 'Enter a model name such as provider/model.');
  await save(`${CLASSIFIER_SETTING_PREFIX}${id}`, model, actor);
  return null;
}
async function resetEvaluators(body: Record<string, unknown>, actor: string) {
  const { projectId, expectedRevision } = body;
  if (typeof projectId !== 'string' || !projectId || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision))
    throw new ApiError(400, 'Choose a project.');
  const stamp = now();
  const database = db();
  const atNew = `EXISTS(SELECT 1 FROM brand_research_configurations c WHERE c.project_id=brand_research_jobs.project_id
    AND c.workspace_id=brand_research_jobs.workspace_id AND c.revision=? AND COALESCE(c.sentiment_provider,c.provider)='liquid' AND c.provider='jev')`;
  const cancel = `UPDATE brand_research_jobs SET status='cancelled',reserved_usd=0,completed_at=?,error='Brand research configuration changed.'
    WHERE project_id=? AND status='pending' AND ${atNew}`;
  const [update] = await database.batch([
    database
      .prepare("UPDATE brand_research_configurations SET sentiment_provider='liquid',provider='jev',revision=revision+1,updated_at=? WHERE project_id=? AND revision=?")
      .bind(stamp, projectId, expectedRevision),
    database.prepare(`${cancel} AND context_key NOT LIKE 'source-types:%' AND provider<>'liquid'`).bind(stamp, projectId, expectedRevision + 1),
    database.prepare(`${cancel} AND context_key LIKE 'source-types:%' AND provider<>'jev'`).bind(stamp, projectId, expectedRevision + 1),
  ]);
  if (!update.meta.changes) throw new ApiError(409, 'Brand research settings changed. Reload before saving.');
  await database.prepare('INSERT INTO admin_audit_log(at,actor,action,key) VALUES(?,?,?,?)').bind(stamp, actor, 'set', `evaluators:${projectId}`).run();
  return null;
}
