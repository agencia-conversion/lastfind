// The attribute wizard's generation (lib/semantic-attributes.ts): one OpenRouter call, kept as a `brand_research_jobs` row so it is
// reserved before it is sent, counted in the account ceilings and in the project's monthly ceiling for attributes, and settled at its cost.
import { ATTRIBUTE_CONTEXT, ATTRIBUTE_MODEL, ATTRIBUTE_MONTHLY_MAX_USD, HOME_PAGES, attributeRequest, homeText, parseAttributeSuggestions, projectBrands } from '@/lib/semantic-attributes';
import { readHome } from './favicon';
import { openRouterReserve } from '@/lib/semantic-panel-provider';
import { shuffled } from '@/lib/semantic-panel';
import { countryName } from '@/lib/countries';
import { db, now } from './env';
import { ApiError } from './http';
import { postChat } from './decisions-api';
import { claimDecisionJob, completeDecisionJob, failDecisionJob, hash, markStaleUnknown, requestDecisions } from './decision-jobs';
import { classifierModels } from './classifier-models';
import { ownedProject } from './workspace';
import { modelKeyConfigured } from './model-routes';

/** A generation with web search and thinking takes a while; past this it is given up (and kept as uncertain, never resent). */
const CALL_TIMEOUT_MS = 150_000;

/** Ten suggested attributes for a project (nothing is saved). 503 without OpenRouter; 429 when a ceiling is reached. */
export async function suggestAttributes(projectId: string, workspaceId: string) {
  if (!modelKeyConfigured()) throw new ApiError(503, 'Generating attributes needs the model key: an admin adds it in Admin > Providers. You can still write attributes by hand.');
  const project = await ownedProject(projectId, workspaceId);
  const brands = projectBrands(project);
  const { model, fallback } = classifierModels('semantic_attributes', ATTRIBUTE_MODEL);
  const language = String(project.language_code ?? 'en');
  // What the brands say about themselves: the home pages of the project's brand and its first competitors, read at once (free; a site
  // that does not answer is left out), in the order of the shuffled list so none stands first.
  const order = shuffled(brands);
  const read = new Set(brands.slice(0, HOME_PAGES).map((brand) => brand.name));
  const homes = await Promise.all(
    order.filter((brand) => read.has(brand.name)).map(async (brand) => {
      try {
        return { ...brand, text: homeText((await readHome(brand.domain)) ?? '') };
      } catch {
        return { ...brand, text: '' };
      }
    }),
  );
  const request = (chosen: string) => attributeRequest(chosen, {
    brands: order,
    homes,
    category: String(project.category ?? ''),
    country: countryName(Number(project.location_code), language.startsWith('pt') ? 'pt-BR' : 'en'),
    language,
  });
  const reserve = openRouterReserve(request(model), true);
  await markStaleUnknown(ATTRIBUTE_CONTEXT, reserve);
  const jobId = await claimDecisionJob({
    projectId,
    workspaceId,
    contextKey: ATTRIBUTE_CONTEXT,
    provider: 'semantic-attributes',
    model,
    // Each generation is its own request: asking for new suggestions is the point.
    inputKey: await hash(`${ATTRIBUTE_CONTEXT}:${model}:${crypto.randomUUID()}`),
    reserveUsd: reserve,
    inputJson: JSON.stringify({ brands: brands.map((brand) => brand.name) }),
    retryAfterMs: 0,
    cap: {
      sql: '(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs WHERE project_id=? AND context_key=? AND requested_at>=?)+?<=?',
      params: [projectId, ATTRIBUTE_CONTEXT, `${now().slice(0, 7)}-01T00:00:00.000Z`, reserve, ATTRIBUTE_MONTHLY_MAX_USD],
    },
  });
  if (!jobId) throw new ApiError(429, 'The spending limit for generating attributes was reached this month. You can still write attributes by hand.');
  const names = brands.map((brand) => brand.name);
  try {
    const result = await requestDecisions(model, fallback, {
      label: 'Semantic attributes',
      post: (payload, timeoutMs) => postChat(payload, timeoutMs, 'semantic_attributes'),
      timeoutMs: CALL_TIMEOUT_MS,
      payload: request,
      parse: (raw) => parseAttributeSuggestions(raw, names),
    });
    await completeDecisionJob(jobId, result, JSON.stringify({ attributes: result.attributes }), reserve, now()).run();
    return { attributes: result.attributes, model: result.model };
  } catch (error) {
    await failDecisionJob(jobId, error, reserve, 'Semantic attributes');
    throw new ApiError(502, 'The AI did not return usable attributes. Try again.');
  }
}

/** One line in the admin audit (`semantic-attributes:<project>`): who generated or applied attributes for a project. */
export const auditAttributes = (actor: string, action: 'suggest' | 'apply' | 'reset', projectId: string) =>
  db().prepare('INSERT INTO admin_audit_log(at,actor,action,key) VALUES(?,?,?,?)').bind(now(), actor, action, `semantic-attributes:${projectId}`).run();
