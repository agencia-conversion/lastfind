// The New project wizard's AI suggestions (lib/new-project-ai.ts): the site's home page read for free on the guarded path, then one
// chat completion through the model providers in Admin's order (Cloud's keys, or the ones the owner configured in the independent
// edition), on the model Admin > Classifiers names for the wizard (lib/model-providers.ts maps it per provider). Before the project exists, so each call is a `wizard_jobs` row of the workspace: reserved before
// it is sent (the platform's brake, a preview's lifetime total, the workspace's monthly cap for the wizard and, in Cloud, its AI credits),
// settled at the cost the reply reports, never resent when its outcome is uncertain (the decision jobs' rule, ./decision-jobs.ts).
import { ATTRIBUTE_MODEL, HOME_CHARS, HOME_PAGES, homeText } from '@/lib/semantic-attributes';
import { openRouterReserve } from '@/lib/semantic-panel-provider';
import { shuffled } from '@/lib/semantic-panel';
import { isCountryCode } from '@/lib/countries';
import {
  TOPIC_MAX_CHARS,
  WIZARD_HOME_CHARS,
  WIZARD_MODEL,
  WIZARD_MONTHLY_MAX_USD,
  WIZARD_RESERVE_MAX_USD,
  WIZARD_STEPS,
  wizardSearches,
  parseWizard,
  wizardAttributeRequest,
  wizardRequest,
  type WizardInput,
  type WizardStep,
} from '@/lib/new-project-ai';
import { faviconHost, readHome } from './favicon';
import { db, now } from './env';
import { ApiError } from './http';
import { postChat } from './decisions-api';
import { DecisionProviderError, requestDecisions } from './decision-jobs';
import { researchBudgetCondition } from './brand-research';
import { agentBudgetCondition } from './capabilities';
import { classifierModels } from './classifier-models';
import { modelKeyConfigured } from './model-routes';

/** Competitors search the web; the other steps answer from the home page. Past this a call is given up, kept as uncertain. */
const CALL_TIMEOUT_MS = 90_000;
/**
 * Attributes: Settings > Semantic Branding's generation (lib/server/semantic-attributes.ts), with its model, web search and thinking,
 * so its time and its reservation are that one's too.
 */
const ATTRIBUTE_TIMEOUT_MS = 150_000;
const ATTRIBUTE_RESERVE_MAX_USD = 0.6;
/** A row still `submitting` after this was cut off (the Worker stopped mid-call): uncertain, its reserve kept for its own month. */
const STALE_MS = 5 * 60_000;

/** What the person reads when a step could not be suggested: the old wizard's words, the reason only in the log. */
export const UNAVAILABLE: Record<WizardStep, string> = {
  competitors: "We couldn't generate reliable competitors right now. Try again, or add them by hand.",
  topics: "We couldn't generate reliable topics right now. Try again, or add them by hand.",
  prompts: "We couldn't generate reliable prompts right now. Try again, or write them by hand.",
  comparison: "We couldn't generate products to compare right now. Try again, skip this step, or add them later in Comparison.",
  attributes: "We couldn't generate attributes right now. Try again, write them by hand, or set up Semantic Branding later.",
};
export const NO_MODEL_KEY = 'AI suggestions need the model key: an admin adds it in Admin > Providers. You can still fill in the wizard by hand.';
export const TOO_DEAR = 'The model chosen for the New project wizard costs more than one suggestion may spend. An admin changes it in Admin > Classifiers.';
export const SPENDING_LIMIT = 'The AI spending limit for suggestions was reached for now. You can still fill in the wizard by hand.';

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** The request's fields, checked (the wizard's own rules: lib/new-project.ts and new-project-wizard.tsx). */
export function wizardInput(data: Record<string, unknown>): { step: WizardStep; input: WizardInput } {
  const step = WIZARD_STEPS.find((item) => item === data.step);
  if (!step) throw new ApiError(400, 'Choose a wizard step.');
  const brand = text(data.brand, 80);
  const domain = faviconHost(text(data.domain, 253));
  if (brand.length < 2) throw new ApiError(400, 'Enter the brand, with at least two letters or numbers.');
  if (!domain) throw new ApiError(400, 'Enter a valid domain, such as your-brand.com.');
  if (!isCountryCode(data.location)) throw new ApiError(400, 'Invalid market.');
  const language = data.language === 'pt' ? 'pt' : 'en';
  const competitors = (Array.isArray(data.competitors) ? data.competitors : []).map((name) => text(name, 80)).filter(Boolean).slice(0, 10);
  const topics = (Array.isArray(data.topics) ? data.topics : [])
    .map((topic) => (topic && typeof topic === 'object' ? (topic as Record<string, unknown>) : {}))
    .map((topic) => ({ name: text(topic.name, TOPIC_MAX_CHARS), keyword: text(topic.keyword, 120) || null, seed: text(topic.seed, 240) || null }))
    .filter((topic) => topic.name);
  if (step === 'prompts' && (!topics.length || topics.length > 10)) throw new ApiError(400, 'Select from 1 to 10 topics.');
  // Attributes: the competitors' names and sites (their home pages are read too).
  const sites = (Array.isArray(data.sites) ? data.sites : [])
    .map((site) => (site && typeof site === 'object' ? (site as Record<string, unknown>) : {}))
    .map((site) => ({ name: text(site.name, 80), domain: faviconHost(text(site.domain, 253)) ?? '' }))
    .filter((site) => site.name.length >= 2)
    .slice(0, 10);
  return {
    step,
    input: { brand, domain, location: data.location, language, competitors, topics, ...(step === 'competitors' && data.quick === true ? { quick: true } : {}), ...(step === 'attributes' ? { sites } : {}) },
  };
}

/** How long a home page read for the wizard is kept: the steps of one wizard (asked at once, or a few minutes apart) read it once. */
const HOME_TTL_MS = 10 * 60_000;
const HOME_KEPT = 50;
const homes = new Map<string, { at: number; text: Promise<string | null> }>();
/**
 * The home page's text, read once for the wizard's parallel and later calls of the same domain in this isolate (the shared root of
 * the steps; a read in flight is joined, not repeated). An isolate that never saw it reads it again: nothing is stored elsewhere.
 */
export function wizardHome(domain: string, read: (domain: string) => Promise<string | null> = readHome, clock = Date.now()) {
  const kept = homes.get(domain);
  if (kept && clock - kept.at < HOME_TTL_MS) return kept.text;
  const text = read(domain).then((html) => (html ? homeText(html, WIZARD_HOME_CHARS) : null), () => null);
  homes.delete(domain);
  homes.set(domain, { at: clock, text });
  // ponytail: oldest-first eviction of a small Map, enough for the wizards one isolate serves at once.
  while (homes.size > HOME_KEPT) homes.delete(homes.keys().next().value!);
  return text;
}

/**
 * The step's suggestions (nothing is saved: the wizard keeps the ones the person selects and creates them with the project).
 * 503 without the model key; 429 when a limit is reached; 502 when the model gives nothing usable (no template stands in for it).
 */
export async function suggestForWizard(workspaceId: string, step: WizardStep, input: WizardInput, timing: Record<string, number> = {}) {
  if (!modelKeyConfigured()) throw new ApiError(503, NO_MODEL_KEY);
  const attributes = step === 'attributes';
  const kind = attributes ? 'semantic_attributes' : 'project_wizard';
  const { model, fallback } = classifierModels(kind, attributes ? ATTRIBUTE_MODEL : WIZARD_MODEL);
  // What the site says about itself (free; a site that does not answer leaves the model with the brand, domain and market).
  let started = Date.now();
  const asked: WizardInput = { ...input, home: await wizardHome(input.domain) };
  // Attributes read the first competitors' home pages too, as Settings does, and list every brand in a shuffled order.
  if (attributes) {
    const sites = input.sites ?? [];
    const homes = await Promise.all(sites.slice(0, HOME_PAGES - 1).map((site) => (site.domain ? wizardHome(site.domain) : null)));
    asked.sites = shuffled([{ name: input.brand, domain: input.domain, home: asked.home }, ...sites.map((site, index) => ({ ...site, home: homes[index] ?? null }))])
      .map((site) => ({ ...site, home: site.home?.slice(0, HOME_CHARS) ?? null }));
  }
  timing.home = Date.now() - started;
  const request = (chosen: string) => (step === 'attributes' ? wizardAttributeRequest(chosen, asked) : wizardRequest(chosen, step, asked));
  const reserve = openRouterReserve(request(model), wizardSearches(step, asked));
  if (reserve > (attributes ? ATTRIBUTE_RESERVE_MAX_USD : WIZARD_RESERVE_MAX_USD)) throw new ApiError(503, TOO_DEAR);
  const database = db();
  const stamp = now();
  const month = `${stamp.slice(0, 7)}-01T00:00:00.000Z`;
  await database
    .prepare(`UPDATE wizard_jobs SET status='unknown',completed_at=?,error='Submission outcome is unknown; it is not resent.' WHERE workspace_id=? AND status='submitting' AND requested_at<?`)
    .bind(stamp, workspaceId, new Date(Date.parse(stamp) - STALE_MS).toISOString())
    .run();
  const platform = researchBudgetCondition(reserve, null);
  const credits = agentBudgetCondition(workspaceId, month, reserve);
  const id = crypto.randomUUID();
  const claimed = await database
    .prepare(
      `INSERT INTO wizard_jobs(id,workspace_id,step,model,status,reserved_usd,requested_at) SELECT ?,?,?,?,'submitting',?,?
       WHERE ${platform.sql} AND (${credits.sql})
       AND (SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM wizard_jobs WHERE workspace_id=? AND requested_at>=?)+?<=?`,
    )
    .bind(id, workspaceId, step, model, reserve, stamp, ...platform.params, ...credits.params, workspaceId, month, reserve, WIZARD_MONTHLY_MAX_USD)
    .run();
  if (!claimed.meta.changes) throw new ApiError(429, SPENDING_LIMIT);
  try {
    started = Date.now();
    const result = await requestDecisions(model, fallback, {
      label: 'New project wizard',
      // The providers in Admin's order (OpenAI, Anthropic, OpenRouter by default), each with the wizard's model of its own.
      post: (payload, timeoutMs) => postChat(payload, timeoutMs, kind),
      timeoutMs: attributes ? ATTRIBUTE_TIMEOUT_MS : CALL_TIMEOUT_MS,
      payload: request,
      parse: (raw) => parseWizard(step, raw, asked),
    });
    timing.model = Date.now() - started;
    await database
      .prepare("UPDATE wizard_jobs SET status=?,cost_usd=?,reserved_usd=?,completed_at=?,error=?,model=? WHERE id=? AND status='submitting'")
      .bind(result.cost === null ? 'unsettled' : 'completed', result.cost ?? 0, result.cost ?? reserve, now(), result.cost === null ? 'Usage cost is unavailable; the reservation is kept.' : null, result.model, id)
      .run();
    // The operator's trace (never the content): which model answered and what it cost.
    console.info(`New project wizard (${step}): ${result.model}, cost ${result.cost ?? 'unreported'}.`);
    return result.suggestions;
  } catch (error) {
    const provider = error instanceof DecisionProviderError ? error : null;
    await database
      .prepare("UPDATE wizard_jobs SET status=?,reserved_usd=?,cost_usd=?,completed_at=?,error=? WHERE id=? AND status='submitting'")
      .bind(provider?.unknown ? 'unknown' : 'failed', provider?.unknown ? reserve : (provider?.cost ?? 0), provider?.cost ?? 0, now(), error instanceof Error ? error.message.slice(0, 200) : 'New project wizard request failed.', id)
      .run();
    console.warn(`New project wizard (${step}): ${error instanceof Error ? error.message : 'failed'}`);
    throw new ApiError(502, UNAVAILABLE[step]);
  }
}
