// The Brain wizard's generation (lib/brain-wizard.ts): the project's site read for free on the guarded path, then one OpenRouter call,
// kept as a `brand_research_jobs` row so it is reserved before it is sent, counted in the account ceilings and in the project's monthly
// ceiling for the Brain, and settled at its cost (the attribute wizard's pattern, lib/server/semantic-attributes.ts).
import {
  BRAIN_HOME_CHARS,
  BRAIN_MONTHLY_MAX_USD,
  BRAIN_PAGE_CHARS,
  BRAIN_RESERVE_MAX_USD,
  BRAIN_WIZARD_CONTEXT,
  BRAIN_WIZARD_MODEL,
  brainPages,
  brainRequest,
  brainTemplate,
  parseBrainFiles,
} from '@/lib/brain-wizard';
import { homeText } from '@/lib/semantic-attributes';
import { openRouterReserve } from '@/lib/semantic-panel-provider';
import { faviconHost, readHome } from './favicon';
import { db, now } from './env';
import { ApiError } from './http';
import { postChat } from './decisions-api';
import { DecisionProviderError, claimDecisionJob, completeDecisionJob, failDecisionJob, hash, markStaleUnknown, requestDecisions } from './decision-jobs';
import { classifierModels } from './classifier-models';
import { ownedProject } from './workspace';
import { modelKeyConfigured } from './model-routes';

/** A generation with web search and thinking takes a while; past this it is given up (and kept as uncertain, never resent). */
const CALL_TIMEOUT_MS = 150_000;
/** A busy provider (408, 429, 5xx: no completion, nothing billed) is asked once more after this, within the same time budget. */
const RETRY_WAIT_MS = 2_000;
/** The second try is sent only with at least this much of the budget left; a generation rarely finishes sooner. */
const RETRY_MIN_MS = 45_000;
const busy = (status: number) => status === 408 || status === 429 || status >= 500;

/** The chat completion, asked once more when the provider answered busy and the budget still has room for a generation. */
async function postWithRetry(payload: unknown, timeoutMs: number) {
  const started = Date.now();
  const first = await postChat(payload, timeoutMs, 'brain_wizard');
  if (!busy(first.status)) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_WAIT_MS));
  const left = timeoutMs - (Date.now() - started);
  if (left < RETRY_MIN_MS) return first;
  // The refusal's body is let go so its connection is free for the second call.
  await first.body?.cancel();
  console.warn(`Brain wizard: OpenRouter returned HTTP ${first.status}; asking once more.`);
  return postChat(payload, left, 'brain_wizard');
}

/** The first day of next month (UTC), when the project's monthly ceiling for the Brain starts again. */
const nextMonth = (stamp: string) => {
  const day = new Date(`${stamp.slice(0, 7)}-01T00:00:00.000Z`);
  day.setUTCMonth(day.getUTCMonth() + 1);
  return day.toISOString().slice(0, 10);
};

/**
 * The Brain's files as the site and the web describe the brand (nothing is saved): `{ files, site, language, pages, model }`, each file
 * `{ key, title, content, found }`. `site` and `language` default to the project's. 503 without OpenRouter; 429 when a ceiling is reached.
 */
export async function generateBrain(projectId: string, workspaceId: string, input: { site?: unknown; language?: unknown } = {}, options: { detail?: boolean } = {}) {
  if (!modelKeyConfigured()) throw new ApiError(503, 'Generating the Brain needs the model key: an admin adds it in Admin > Providers. You can still write the files by hand.');
  const project = await ownedProject(projectId, workspaceId);
  const site = faviconHost(typeof input.site === 'string' && input.site.trim() ? input.site : String(project.domain ?? ''));
  if (!site) throw new ApiError(400, 'Enter the site, such as example.com.');
  const language = input.language === 'pt' || input.language === 'en' ? input.language : String(project.language_code ?? 'en').startsWith('pt') ? 'pt' : 'en';
  const { model, fallback } = classifierModels('brain_wizard', BRAIN_WIZARD_MODEL);
  // What the site says about itself: its home page and the pages it links to about the brand, its offer, prices and contact, read at
  // once (free; a page that does not answer is left out, and with no page the model searches the web only).
  const read = (path: string, max: number) => readHome(site, fetch, path).then((html) => ({ html: html ?? '', text: homeText(html ?? '', max) }), () => ({ html: '', text: '' }));
  const home = await read('/', BRAIN_HOME_CHARS);
  const paths = brainPages(home.html, site);
  const pages = [
    { url: `https://${site}/`, text: home.text },
    ...(await Promise.all(paths.map(async (path) => ({ url: `https://${site}${path}`, text: (await read(path, BRAIN_PAGE_CHARS)).text })))),
  ].filter((page) => page.text);
  const files = brainTemplate(language === 'pt');
  const request = (chosen: string) => brainRequest(chosen, { name: String(project.name), site, language, files, pages });
  const reserve = openRouterReserve(request(model), true);
  if (reserve > BRAIN_RESERVE_MAX_USD) throw new ApiError(503, 'The model chosen for the Brain costs more than one generation may spend. An admin changes it in Admin > Classifiers.');
  await markStaleUnknown(BRAIN_WIZARD_CONTEXT, reserve);
  const jobId = await claimDecisionJob({
    projectId,
    workspaceId,
    contextKey: BRAIN_WIZARD_CONTEXT,
    provider: 'brain-wizard',
    model,
    // Each generation is its own request: asking again is the point.
    inputKey: await hash(`${BRAIN_WIZARD_CONTEXT}:${model}:${crypto.randomUUID()}`),
    reserveUsd: reserve,
    inputJson: JSON.stringify({ site, language, pages: pages.map((page) => page.url) }),
    retryAfterMs: 0,
    cap: {
      sql: '(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs WHERE project_id=? AND context_key=? AND requested_at>=?)+?<=?',
      params: [projectId, BRAIN_WIZARD_CONTEXT, `${now().slice(0, 7)}-01T00:00:00.000Z`, reserve, BRAIN_MONTHLY_MAX_USD],
    },
  });
  if (!jobId) {
    // The project's month for the Brain, or the platform's shared ceilings (daily and monthly, across every project).
    const month = `${now().slice(0, 7)}-01T00:00:00.000Z`;
    const row = await db()
      .prepare('SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) spent FROM brand_research_jobs WHERE project_id=? AND context_key=? AND requested_at>=?')
      .bind(projectId, BRAIN_WIZARD_CONTEXT, month)
      .first<{ spent: number }>();
    if (Number(row?.spent ?? 0) + reserve > BRAIN_MONTHLY_MAX_USD)
      throw new ApiError(429, `The spending limit for generating the Brain was reached this month. It resets on ${nextMonth(month)}. You can still write the files by hand.`);
    throw new ApiError(429, 'The AI spending limit was reached for now. Try again later. You can still write the files by hand.');
  }
  try {
    const result = await requestDecisions(model, fallback, {
      label: 'Brain wizard',
      post: postWithRetry,
      timeoutMs: CALL_TIMEOUT_MS,
      payload: request,
      parse: (raw) => parseBrainFiles(raw, files),
    });
    await completeDecisionJob(jobId, result, JSON.stringify({ files: result.files.map((file) => file.key).filter((_, index) => result.files[index].found) }), reserve, now()).run();
    return { files: result.files, site, language, pages: pages.map((page) => page.url), model: result.model };
  } catch (error) {
    await failDecisionJob(jobId, error, reserve, 'Brain wizard');
    if (!options.detail || !(error instanceof Error)) {
      // A busy provider (after the second try) or a call that ran out of time: nothing to fix but to wait a little.
      if (error instanceof DecisionProviderError && (busy(error.status) || (!error.status && /timeout|timed out/i.test(error.message))))
        throw new ApiError(503, 'The AI is busy right now. Try again in a minute. You can still write the files by hand.');
      throw new ApiError(502, 'The AI did not return a usable Brain. Try again.');
    }
    // A platform admin (Admin > Algorithms) sees why: the provider's or the reader's message, never the content.
    throw new ApiError(502, `The AI did not return a usable Brain: ${error.message.slice(0, 200)}`);
  }
}

/** One line in the admin audit (`brain-wizard:<project>`): who generated or applied a Brain for a project from Admin. */
export const auditBrain = (actor: string, action: 'generate' | 'apply', projectId: string) =>
  db().prepare('INSERT INTO admin_audit_log(at,actor,action,key) VALUES(?,?,?,?)').bind(now(), actor, action, `brain-wizard:${projectId}`).run();
