import { withModelRoles } from './brand-roles';
import { countryName } from '@/lib/countries';
import {
  DOMAIN_PROJECT_SPEND_SQL,
  domainSpendSince,
  DOMAIN_BATCH,
  DOMAIN_DECISION_RESERVE_USD,
  DOMAIN_MAX_ATTEMPTS,
  DOMAIN_SEARCH_RESERVE_USD,
  SITE_CHECK_BATCH,
  siteCheckWork,
  brandDomainCandidates,
  brandDomainDecisionRequest,
  domainFitsBrand,
  aggregatorFor,
  DOMAIN_DECISION_RUBRIC,
  DOMAIN_RULE_CONFIDENCE,
  ruledDomain,
  siteCheckFresh,
  parseBrandDomainResponse,
  type DomainCandidate,
  type DomainDecisionInput,
  type DomainLookup,
  type SiteCheck,
} from '@/lib/brand-domain';
import { deriveRows, deriveState, type BrandRow, type Suggestion } from '@/lib/brand-decisions';
import { RESEARCH_MODELS } from '@/lib/brand-research-provider';
import type { Project } from '@/lib/types';
import { db, now } from './env';
import { classifierModels } from './classifier-models';
import { postDecisions } from './decisions-api';
import { ProviderError } from './dataforseo';
import { projectReadDatabase } from './project-store-read';
import { googleOrganicTop10 } from './serp-organic';
import { loadDecisionEvents } from './brand-decision-events';
import { competitorAnalysisStatus } from './competitor-analysis';
import { researchBudgetCondition } from './brand-research';
import * as edition from './capabilities';
// Read through the namespace: a module standing in for the edition without it (a test's) has no plan counts.
const planCountCondition = edition.planCountCondition ?? (() => ({ sql: '1=1', params: [] as (string | number)[] }));
import { dollarBlock, recordBlocked } from './spend-guards';
import {
  domainDiscoveryConfig,
  domainWork,
  loadDomainLookups,
  lookupCandidates,
  lookupSearch,
  lookupView,
  monthStart,
  projectDomainSpend,
  saveSiteCheck,
  withSiteChecks,
  loadSiteChecks,
  type LookupRow,
} from './brand-domain-lookups';

const hash = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
import { probeSite } from './favicon';
import { rawResponsesBucket } from './raw-responses';
import { ownedProject, projectFromRow } from './workspace';
import { questionRolesAuthorization } from './brand-backfill';

/** Confidence given to the one exact-name domain the answers themselves named. */
const ANSWERS_CONFIDENCE = 0.9;
/** Confidence of a lone partial match (`netflixbrasil.com` for Netflix): shown, but left to review. */
const PARTIAL_CONFIDENCE = 0.5;
const EVIDENCE_RUNS = 6;

const key = (project: Project, row: { key: string }, workspaceId: string) => [workspaceId, row.key, project.location_code] as const;
const WHERE = 'workspace_id=? AND brand_key=? AND location_code=?';

/** A Decisions call that failed. `unknown`: the request left and no cost came back, so it is never resent. */
class DomainDecisionError extends Error {
  constructor(message: string, readonly unknown: boolean, readonly cost: number | null) {
    super(message);
  }
}

async function requestOnce(input: DomainDecisionInput, model: string) {
  let sent = false,
    cost: number | null = null;
  try {
    const payload = brandDomainDecisionRequest(input, model);
    sent = true;
    const response = await postDecisions(payload);
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 408) sent = false;
      throw new Error(`OpenRouter returned HTTP ${response.status}.`);
    }
    const raw = (await response.json()) as { usage?: { cost?: unknown } };
    if (typeof raw.usage?.cost === 'number' && Number.isFinite(raw.usage.cost) && raw.usage.cost >= 0) cost = raw.usage.cost;
    const result = parseBrandDomainResponse(raw, input, model);
    cost = result.cost;
    return { ...result, model };
  } catch (error) {
    throw new DomainDecisionError(
      error instanceof Error ? error.message.slice(0, 200) : 'Domain decision failed.',
      sent && cost === null,
      cost,
    );
  }
}

/** One Decisions call; a failed configured model repeats once on the default model, never more. */
async function requestDecision(input: DomainDecisionInput) {
  const { model, fallback } = classifierModels('brand_domain', RESEARCH_MODELS.liquid);
  try {
    return await requestOnce(input, model);
  } catch (error) {
    if (!fallback || !(error instanceof DomainDecisionError)) throw error;
    const spent = error.unknown ? null : (error.cost ?? 0);
    try {
      const result = await requestOnce(input, fallback);
      return { ...result, cost: result.cost === null || spent === null ? null : result.cost + spent };
    } catch (second) {
      if (!(second instanceof DomainDecisionError)) throw second;
      throw new DomainDecisionError(second.message, second.unknown || spent === null, (second.cost ?? 0) + (spent ?? 0));
    }
  }
}

/** Step 1 (free): the domains the brand's own saved answers name, with the exact-name one as the suggestion. */
async function fromAnswers(project: Project, workspaceId: string, row: BrandRow) {
  const ids = row.evidence.map((item) => item.runId).slice(0, EVIDENCE_RUNS);
  const texts: string[] = [];
  const urls: string[] = [];
  if (ids.length) {
    const database = await projectReadDatabase(project.id, workspaceId);
    const { results } = await database
      .prepare(`SELECT answer,sources_json,consulted_sources_json FROM runs WHERE project_id=? AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(project.id, ...ids)
      .all<{ answer: string | null; sources_json: string | null; consulted_sources_json: string | null }>();
    for (const result of results) {
      if (result.answer) texts.push(result.answer);
      for (const list of [result.sources_json, result.consulted_sources_json])
        try {
          for (const item of list ? (JSON.parse(list) as { url?: unknown }[]) : [])
            if (typeof item?.url === 'string') urls.push(item.url);
        } catch {
          /* a malformed list adds nothing */
        }
    }
  }
  const merged = new Map<string, DomainCandidate>();
  for (const name of [row.name, ...row.aliases])
    for (const found of brandDomainCandidates(name, { texts, urls })) {
      const known = merged.get(found.domain);
      merged.set(found.domain, known ? { ...known, hits: Math.max(known.hits, found.hits) } : found);
    }
  const candidates = [...merged.values()]
    .filter((item) => domainFitsBrand(row.name, item.domain, project.domain))
    .sort((a, b) => Number(b.strong) - Number(a.strong) || b.hits - a.hits || a.domain.localeCompare(b.domain));
  const strong = candidates.filter((item) => item.strong);
  const picked = strong.length === 1 ? strong[0]! : !strong.length && candidates.length === 1 ? candidates[0]! : null;
  return { candidates, picked, confidence: picked?.strong ? ANSWERS_CONFIDENCE : PARTIAL_CONFIDENCE };
}

async function createLookup(project: Project, workspaceId: string, row: BrandRow) {
  const found = await fromAnswers(project, workspaceId, row);
  const stamp = now();
  await db()
    .prepare(
      `INSERT INTO brand_domain_lookups(workspace_id,brand_key,location_code,project_id,brand_name,candidates_json,domain,confidence,source,requested_at,decided_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,brand_key,location_code) DO NOTHING`,
    )
    .bind(
      ...key(project, row, workspaceId),
      project.id,
      row.name,
      JSON.stringify(found.candidates),
      found.picked?.domain ?? null,
      found.picked ? found.confidence : null,
      found.picked ? 'answers' : null,
      stamp,
      found.picked ? stamp : null,
    )
    .run();
}

/**
 * Claims a paid step in one statement, so two requests cannot both pass: the row's step must not have been taken, the
 * `reserveUsd` still to hold must fit the project's month under its ceiling and the account ceilings shared with
 * collection, and the cost is charged to this project (`payer`: `paid_project_id` for the search, `decision_project_id` for
 * the decision), whoever created the row. `step.set` is the step's own assignments; with nothing new to hold, only the claim is made.
 */
async function claim(
  project: Project,
  workspaceId: string,
  row: { key: string },
  reserveUsd: number,
  maxUsd: number,
  payer: 'paid_project_id' | 'decision_project_id',
  step: { set: string; params: (string | number)[]; where: string; whereParams?: (string | number | null)[] },
) {
  const stamp = now();
  const month = monthStart(stamp);
  // The project's budget (Settings > Monitoring > Budget) and the platform's brake, on top of the module's own monthly limit.
  const budget = researchBudgetCondition(reserveUsd, project.id);
  // A new paid lookup (its search step) within the plan's monthly lookups of the whole workspace, archived projects too (8/11/2026).
  const count = payer === 'paid_project_id'
    ? planCountCondition(workspaceId, 'domains', { sql: 'SELECT COUNT(*) FROM brand_domain_lookups WHERE paid_project_id IN (SELECT id FROM projects WHERE workspace_id=?) AND spent_at>=?', params: [workspaceId, month] })
    : { sql: '1=1', params: [] as (string | number)[] };
  const result = await db()
    .prepare(
      `UPDATE brand_domain_lookups SET ${step.set},${payer}=?,spent_at=?
       WHERE ${WHERE} AND ${step.where}${
         reserveUsd > 0
           ? ` AND (SELECT COALESCE(SUM(${DOMAIN_PROJECT_SPEND_SQL}),0) FROM brand_domain_lookups WHERE (paid_project_id=? OR decision_project_id=?) AND ${domainSpendSince('?')})+?<=?
       AND (${budget.sql}) AND ${count.sql}`
           : ''
       }`,
    )
    .bind(
      ...step.params,
      project.id,
      stamp,
      ...key(project, row, workspaceId),
      ...(step.whereParams ?? []),
      ...(reserveUsd > 0 ? [project.id, project.id, project.id, project.id, month, reserveUsd, maxUsd, ...budget.params, ...count.params] : []),
    )
    .run();
  const claimed = Number(result.meta.changes) > 0;
  if (!claimed && reserveUsd > 0) {
    // When the budget or the brake has no room for a due step, say so.
    const block = await dollarBlock(project.id, reserveUsd).catch(() => null);
    if (block) await recordBlocked(project.id, 'domains', block);
  }
  return claimed;
}

/** Writes a step's outcome; `guard` keeps a stale request from overwriting a row another one has settled. */
const settle = (project: Project, workspaceId: string, row: { key: string }, set: string, params: (string | number | null)[], guard = '1=1') =>
  db()
    .prepare(`UPDATE brand_domain_lookups SET ${set} WHERE ${WHERE} AND ${guard}`)
    .bind(...params, ...key(project, row, workspaceId))
    .run();

/** Step 2 (paid): one Google search per brand and country, ever. Any outcome but a failure that cannot have been billed is kept. */
async function search(project: Project, workspaceId: string, row: BrandRow, maxUsd: number) {
  const query = `${row.name} ${project.category.slice(0, 80)}`.trim();
  // A public fact: the same search (brand, category, country and language) another account already paid for is reused, free,
  // so a brand is searched once for the platform. Only the results are copied (public Google results); the decision stays this
  // account's own (it weighs this account's answers), and nothing counts against this project.
  const shared = await db()
    .prepare(
      `SELECT d.search_json FROM brand_domain_lookups d JOIN projects p ON p.id=d.paid_project_id
       WHERE d.brand_key=? AND d.location_code=? AND d.search_status='done' AND d.search_json IS NOT NULL AND lower(d.query)=lower(?) AND p.language_code=? LIMIT 1`,
    )
    .bind(row.key, project.location_code, query, project.language_code)
    .first<{ search_json: string }>();
  if (shared) {
    const copied = await settle(
      project, workspaceId, row,
      "search_status='done',search_json=?,search_cost_usd=0,search_reserved_usd=0,query=?,error=NULL",
      [shared.search_json, query],
      `search_status IS NULL AND search_attempts<${DOMAIN_MAX_ATTEMPTS}`,
    );
    return Number(copied.meta.changes) > 0;
  }
  // The worst case of the whole brand is held up front: the decision's reserve is released when it settles or is not needed.
  const claimed = await claim(project, workspaceId, row, DOMAIN_SEARCH_RESERVE_USD + DOMAIN_DECISION_RESERVE_USD, maxUsd, 'paid_project_id', {
    set: "search_status='submitting',search_attempts=search_attempts+1,search_reserved_usd=?,decision_reserved_usd=?,query=?,error=NULL",
    params: [DOMAIN_SEARCH_RESERVE_USD, DOMAIN_DECISION_RESERVE_USD, query],
    where: `search_status IS NULL AND search_attempts<${DOMAIN_MAX_ATTEMPTS}`,
  });
  if (!claimed) return false;
  const guard = "search_status='submitting'";
  try {
    const { results, cost } = await googleOrganicTop10(query, project.location_code, project.language_code);
    await settle(
      project, workspaceId, row,
      'search_status=?,search_json=?,search_cost_usd=?,search_reserved_usd=?',
      // A reply without a cost keeps the search's own reserve instead of being trusted as free.
      ['done', JSON.stringify(results), cost ?? 0, cost === null ? DOMAIN_SEARCH_RESERVE_USD : 0],
      guard,
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Search failed.').slice(0, 200);
    if (error instanceof ProviderError && error.ambiguous)
      // The request may have been billed: keep it as spent and never send it again.
      await settle(project, workspaceId, row, "search_status='unknown',decision_reserved_usd=0,error=?", [message], guard);
    else await settle(project, workspaceId, row, 'search_status=NULL,search_reserved_usd=0,decision_reserved_usd=0,error=?', [message], guard);
    return false;
  }
  return true;
}

/** What the model may choose from: the search and the answers, minus hubs that list businesses (aggregatorFor) and domains that do not look like the brand. */
function decisionCandidates(project: Project, row: { name: string }, found: LookupRow) {
  const named = new Set(lookupCandidates(found));
  const merged = new Map<string, DomainDecisionInput['candidates'][number]>();
  for (const item of lookupSearch(found)) merged.set(item.domain, { domain: item.domain, title: item.title, rank: item.rank, seenInAnswers: named.has(item.domain) });
  for (const domain of named) if (!merged.has(domain)) merged.set(domain, { domain, seenInAnswers: true });
  return [...merged.values()].filter((item) => domainFitsBrand(row.name, item.domain, project.domain) && !aggregatorFor(row.name, item.domain));
}

/**
 * The key a domain decision is shared under, across accounts: the shared search's (brand, country, language, query) plus the
 * category's digest, the rubric and the model, and the candidates themselves. Only for a decision over public facts: null when
 * any candidate came from this account's answers (`seenInAnswers`), which is never shared.
 */
async function sharedDecisionKey(project: Project, row: { key: string }, found: LookupRow, input: DomainDecisionInput, model: string) {
  if (input.candidates.some((item) => item.seenInAnswers)) return null;
  return hash(
    JSON.stringify([DOMAIN_DECISION_RUBRIC, model, row.key, project.location_code, project.language_code, (found.query ?? '').toLowerCase(), await hash(input.category), input.candidates]),
  );
}

/** Step 3: the model picks the official site among what the answers and the search named. */
async function decide(project: Project, workspaceId: string, row: BrandRow, found: LookupRow, maxUsd: number) {
  const serp = lookupSearch(found);
  const candidates = decisionCandidates(project, row, found);
  const open = "search_status='done' AND model IS NULL AND decision_status IS NULL";
  if (!candidates.length) {
    // Nothing to choose from: the search found no site and the answers named none. Only the decision's reserve goes;
    // what the search cost, or its own reserve when no cost came back, stays.
    await settle(project, workspaceId, row, "model='none',decision_reserved_usd=0,domain=NULL,confidence=NULL,source=NULL", [], open);
    return true;
  }
  const input: DomainDecisionInput = {
    brand: row.name,
    category: project.category.slice(0, 200),
    country: countryName(project.location_code),
    candidates,
  };
  const sharedKey = await sharedDecisionKey(project, row, found, input, classifierModels('brand_domain', RESEARCH_MODELS.liquid).model);
  // Decision roots, free: one fitting candidate whose home page names the brand is its site (its page read now if never read)...
  if (candidates.length === 1) {
    const host = candidates[0]!.domain;
    let sites = await loadSiteChecks([host]).catch(() => ({}) as Awaited<ReturnType<typeof loadSiteChecks>>);
    if (!siteCheckFresh(sites[host], Date.now()) && (await checkSites([host]))) sites = await loadSiteChecks([host]).catch(() => sites);
    const ruled = ruledDomain(row.name, candidates, sites);
    if (ruled) {
      const done = await settle(
        project, workspaceId, row,
        "domain=?,confidence=?,source=?,model='rules',decision_reserved_usd=0,decided_at=?,decision_key=?,error=NULL",
        [ruled, DOMAIN_RULE_CONFIDENCE, serp.some((item) => item.domain === ruled) ? 'search' : 'answers', now(), sharedKey],
        open,
      );
      return Number(done.meta.changes) > 0;
    }
  }
  // ...then the same decision over the same public facts, taken before for any account: copied as this account's own, today,
  // free, without saying it was (a domain is a public fact; nothing of another account's answers is in that key).
  if (sharedKey) {
    const shared = await db()
      .prepare('SELECT domain,confidence,model FROM brand_domain_lookups WHERE decision_key=? AND model IS NOT NULL AND decision_status IS NULL LIMIT 1')
      .bind(sharedKey)
      .first<{ domain: string | null; confidence: number | null; model: string }>();
    if (shared) {
      const picked = shared.domain && candidates.some((item) => item.domain === shared.domain) ? shared.domain : null;
      const done = await settle(
        project, workspaceId, row,
        'domain=?,confidence=?,source=?,model=?,decision_reserved_usd=0,decided_at=?,decision_key=?,error=NULL',
        [picked, picked ? shared.confidence : null, picked ? 'search' : null, shared.model, picked ? now() : null, sharedKey],
        open,
      );
      return Number(done.meta.changes) > 0;
    }
  }
  // Claim the decision durably before it leaves: a second request, or a retry after a crash, finds it taken and never resends.
  // A project taking it over from another holds the whole reserve, which then leaves the previous payer's meter.
  const payer = found.decision_project_id ?? found.paid_project_id;
  const hold = payer === project.id ? Math.max(0, DOMAIN_DECISION_RESERVE_USD - found.decision_reserved_usd) : DOMAIN_DECISION_RESERVE_USD;
  const claimed = await claim(project, workspaceId, row, hold, maxUsd, 'decision_project_id', {
    set: "decision_status='submitting',decision_attempts=decision_attempts+1,decision_reserved_usd=?",
    where: `${open} AND COALESCE(decision_project_id,paid_project_id) IS ? AND decision_attempts<${DOMAIN_MAX_ATTEMPTS}`,
    params: [DOMAIN_DECISION_RESERVE_USD],
    whereParams: [payer],
  });
  if (!claimed) return false;
  const guard = "decision_status='submitting'";
  try {
    const decision = await requestDecision(input);
    const picked = decision.domain && domainFitsBrand(row.name, decision.domain, project.domain) ? decision.domain : null;
    await settle(
      project, workspaceId, row,
      'domain=?,confidence=?,source=?,model=?,decision_cost_usd=?,decision_reserved_usd=?,decision_status=NULL,decided_at=?,decision_key=?,error=NULL',
      [
        picked,
        picked ? decision.confidence : null,
        picked ? (serp.some((item) => item.domain === picked) ? 'search' : 'answers') : null,
        decision.model,
        decision.cost ?? 0,
        // A reply without a cost keeps the reserve instead of being trusted as free.
        decision.cost === null ? DOMAIN_DECISION_RESERVE_USD : 0,
        picked ? now() : null,
        // Shared only when the model that answered is the one the key names (a fallback's decision stays this account's).
        decision.model === classifierModels('brand_domain', RESEARCH_MODELS.liquid).model ? sharedKey : null,
      ],
      guard,
    );
  } catch (error) {
    const failure = error instanceof DomainDecisionError ? error : new DomainDecisionError('Domain decision failed.', true, null);
    if (failure.unknown)
      // It may have been billed and cost is unknown: no automatic second call, the reserve stays.
      await settle(project, workspaceId, row, "decision_status='unknown',decision_attempts=?,error=?", [DOMAIN_MAX_ATTEMPTS, failure.message], guard);
    else
      await settle(
        project, workspaceId, row,
        'decision_status=NULL,decision_cost_usd=decision_cost_usd+?,decision_reserved_usd=0,error=?',
        [failure.cost ?? 0, failure.message],
        guard,
      );
    return false;
  }
  return true;
}

/**
 * The project's brand rows, only once its analysis is finished: while it restarts the list is the one saved before, and nothing
 * is spent on it. `derive` builds the whole list as the screen shows it, with stored lookups and site reads.
 */
async function discoveredRows(project: Project, workspaceId: string) {
  const [events, status] = await Promise.all([loadDecisionEvents(project.id), competitorAnalysisStatus(project.id, workspaceId)]);
  if (status.status !== 'complete' || status.publicationPending) return null;
  const all = await withModelRoles(project.id, status.suggestions as Suggestion[]);
  const state = deriveState(events);
  // Only names the free detector or the decision model settled: a name still in review costs nothing.
  const rows = deriveRows(project.competitors, all.filter((suggestion) => !suggestion.ambiguous), state, {}, project.domain);
  const derive = (lookups: Record<string, DomainLookup>, sites: Record<string, SiteCheck>) =>
    deriveRows(project.competitors, all, state, lookups, project.domain, { sites, locationCode: project.location_code });
  return { rows, derive };
}

/** The sites still to read for the project's most mentioned discovered brands (the same rule as the overview's counter). */
async function sitesOwed(project: Project, workspaceId: string, found: NonNullable<Awaited<ReturnType<typeof discoveredRows>>>) {
  const lookups = await loadDomainLookups(workspaceId, project.location_code, found.rows.map((row) => row.key));
  const views = Object.fromEntries([...lookups].map(([key, row]) => [key, lookupView(row)]));
  const { rows, sites } = await withSiteChecks((sites) => found.derive(views, sites), project.location_code);
  return siteCheckWork(rows, sites, Date.now(), project.location_code);
}

/**
 * Free: reads the home page of a few brands' sites, side by side, to confirm the suggested domain exists and is the brand's (or
 * that the brand's name as a `.com` is), and keeps the site's icon in the bucket on the way, so the first screen draws it at once.
 */
async function checkSites(hosts: string[]) {
  const store = rawResponsesBucket() ?? null;
  const done = await Promise.all(
    hosts.map(async (host) => {
      try {
        const read = await probeSite(host, fetch, Date.now(), store);
        if (!read) return 0;
        await saveSiteCheck(host, { reachable: read.site.reachable, host: read.site.host, title: read.site.title, siteName: read.site.siteName, checkedAt: now() });
        return 1;
      } catch (error) {
        console.warn(`Site check for ${host}: ${error instanceof Error ? error.message : 'failed'}`);
        return 0;
      }
    }),
  );
  return done.reduce<number>((sum, value) => sum + value, 0);
}

/**
 * Finds the official domain of the project's discovered brands that have none, a few brands per call.
 * Free first (the brand's own saved answers); Google and the decision model only when those are on, the
 * project is under its monthly ceiling and the brand has no stored result. Never reads or writes a user's decision.
 */
export async function discoverBrandDomains(projectId: string, workspaceId: string) {
  const project = projectFromRow(await ownedProject(projectId, workspaceId));
  const config = domainDiscoveryConfig();
  const found = await discoveredRows(project, workspaceId);
  if (!found) return { processed: 0, pending: 0, sites: 0, paid: config.paid };
  const { rows } = found;
  const owed = async () => {
    const lookups = await loadDomainLookups(workspaceId, project.location_code, rows.map((row) => row.key));
    const spent = config.paid ? await projectDomainSpend(projectId, monthStart(now())) : 0;
    return { lookups, ...domainWork(projectId, rows, lookups, config, spent) };
  };
  let processed = 0;
  for (const item of (await owed()).work.slice(0, DOMAIN_BATCH)) {
    const row = rows.find((candidate) => candidate.key === item.key)!;
    try {
      if (item.stage === 'answers') {
        await createLookup(project, workspaceId, row);
        processed++;
      }
      if (!config.paid) continue;
      // The same pass goes on to the paid steps for a brand the answers could not settle.
      const lookups = await loadDomainLookups(workspaceId, project.location_code, [row.key]);
      const { work } = domainWork(projectId, [row], lookups, config, await projectDomainSpend(projectId, monthStart(now())));
      let step = work[0]?.stage;
      if (step === 'search' && (await search(project, workspaceId, row, config.maxUsd))) {
        processed++;
        step = 'decide';
      }
      if (step === 'decide') {
        const found = (await loadDomainLookups(workspaceId, project.location_code, [row.key])).get(row.key);
        if (found && (await decide(project, workspaceId, row, found, config.maxUsd))) processed++;
      }
    } catch (error) {
      // One brand's failure (a busy store, an unconfigured provider) must not stop the others or the page.
      console.warn(`Brand domain discovery for ${row.key}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }
  // Then, free, the sites of the most mentioned brands (what the steps above just found included).
  processed += await checkSites((await sitesOwed(project, workspaceId, found).catch(() => [])).slice(0, SITE_CHECK_BATCH));
  const sites = (await sitesOwed(project, workspaceId, found).catch(() => [])).length;
  return { processed, pending: (await owed()).work.length, sites, paid: config.paid };
}

/** Real cost of one search and one decision, for the dry-run's estimate; the ceiling itself is held with the larger reserves. */
const SEARCH_USD = 0.002;
const DECISION_USD = 0.0004;

/**
 * Applies the rule that a domain must look like the brand to what is already stored, without waiting for a new collection. For the
 * discovered brands of one project: a stored domain the rule rejects (google.com for DuckTales) is cleared; a brand
 * without a domain gets the free answers step again, which the wider rule may now settle; and a search already
 * paid for is decided again over the candidates that fit, once. Never reads or writes a user's decision and
 * never calls a provider: what is left owed (the paid steps) goes through `discoverBrandDomains`, under the same ceiling.
 * `apply: false` only simulates (the dry-run); running it twice changes nothing the second time.
 */
export async function backfillBrandDomains(projectId: string, workspaceId: string, apply: boolean) {
  const project = projectFromRow(await ownedProject(projectId, workspaceId));
  const config = domainDiscoveryConfig();
  const rows = (await discoveredRows(project, workspaceId))?.rows.filter((row) => row.status === 'discovered') ?? [];
  const lookups = await loadDomainLookups(workspaceId, project.location_code, rows.map((row) => row.key));
  const simulated = new Map(lookups);
  const counts = { discovered: rows.length, withoutDomain: 0, rejected: 0, freePicks: 0, reopened: 0 };
  for (const row of rows) {
    const found = lookups.get(row.key);
    const rejected = !!found?.domain && !domainFitsBrand(row.name, found.domain, project.domain);
    if (!row.domain && (!found?.domain || rejected)) counts.withoutDomain++;
    if (!found || (found.domain && !rejected)) continue;
    if (rejected) counts.rejected++;
    let next: LookupRow = rejected ? { ...found, domain: null, confidence: null, source: null, decided_at: null } : found;
    const fromAnswer = await fromAnswers(project, workspaceId, row);
    const candidates = JSON.stringify(fromAnswer.candidates);
    if (fromAnswer.picked) {
      counts.freePicks++;
      next = { ...next, candidates_json: candidates, domain: fromAnswer.picked.domain, confidence: fromAnswer.confidence, source: 'answers', decided_at: now() };
    } else if (candidates !== found.candidates_json) next = { ...next, candidates_json: candidates };
    // The decision already taken over candidates the rule would not offer (a rejected pick, or "none" before the wider rule) is open once more.
    const reopen =
      !next.domain && found.search_status === 'done' && found.decision_status === null && found.model !== null &&
      (rejected || found.model === 'none') && decisionCandidates(project, row, next).length > 0;
    if (reopen) {
      counts.reopened++;
      next = { ...next, model: null, decision_attempts: 0 };
    }
    simulated.set(row.key, next);
    if (!apply || next === found) continue;
    // `domain IS ?` keeps a request that lost the race from overwriting what another one settled.
    await db()
      .prepare(
        `UPDATE brand_domain_lookups SET candidates_json=?,domain=?,confidence=?,source=?,decided_at=?${reopen ? ',model=NULL,decision_attempts=0' : ''}
         WHERE ${WHERE} AND domain IS ? AND decision_status IS NULL`,
      )
      .bind(next.candidates_json, next.domain, next.confidence, next.source, next.decided_at, ...key(project, row, workspaceId), found.domain)
      .run();
  }
  const spent = config.paid ? await projectDomainSpend(projectId, monthStart(now())) : 0;
  const { work, capped } = domainWork(projectId, rows, simulated, config, spent);
  const stage = (name: string) => work.filter((item) => item.stage === name).length;
  const paidBrands = { search: stage('search'), decide: stage('decide') };
  return {
    ...counts,
    // `answers`: brands with no lookup yet; the free step runs first and may settle them, so the paid counts are an upper bound.
    owed: { answers: stage('answers'), ...paidBrands },
    paid: config.paid,
    capped: capped && config.paid,
    estimatedUsd: Number((paidBrands.search * (SEARCH_USD + DECISION_USD) + paidBrands.decide * DECISION_USD).toFixed(4)),
    worstCaseUsd: Number((paidBrands.search * (DOMAIN_SEARCH_RESERVE_USD + DOMAIN_DECISION_RESERVE_USD) + paidBrands.decide * DOMAIN_DECISION_RESERVE_USD).toFixed(4)),
  };
}

/** A project's domains are looked for again no sooner than this; a few projects per tick, for at most TICK_BUDGET_MS. */
const DOMAINS_EVERY_MS = 4 * 60_000;
const DOMAIN_PROJECTS_PER_TICK = 5;
/** A batch already started is always finished; the roles step (120 s) and this one stay inside the 270 s lease. */
const DOMAIN_TICK_BUDGET_MS = 60_000;

/** Batch after batch while the project still owes work and the batch moved (a capped or failing one stops), until `deadline`. */
async function domainPass(projectId: string, workspaceId: string, deadline: number) {
  let result = { processed: 0, pending: 1, sites: 0 };
  let processed = 0;
  do {
    result = await discoverBrandDomains(projectId, workspaceId);
    processed += result.processed;
  } while (result.processed > 0 && result.pending + result.sites > 0 && Date.now() <= deadline);
  return { ...result, processed };
}

/**
 * Brands' pass over the discovered brands without a domain, when the screen opens with some owed: one request per visit (the
 * screen does not wait for it; it reads the list again when it ends), batch after batch for DOMAIN_TICK_BUDGET_MS at most.
 * Not more than once per project every DOMAINS_EVERY_MS, whoever asks (another visit, another tab, the scheduler's step, which
 * shares the mark): a visit inside that interval answers at once (`later`). Before, every visit sent up to 20 batches of
 * 20 to 40 s each from the browser.
 */
export async function discoverBrandDomainsOnVisit(projectId: string, workspaceId: string) {
  await ownedProject(projectId, workspaceId);
  const claimed = await db()
    .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE system_state.value<?')
    .bind(`brand-domains-checked:${projectId}`, now(), new Date(Date.now() - DOMAINS_EVERY_MS).toISOString())
    .run();
  if (!claimed.meta.changes) return { processed: 0, pending: 0, sites: 0, later: true };
  return domainPass(projectId, workspaceId, Date.now() + DOMAIN_TICK_BUDGET_MS);
}

/**
 * Scheduler step of the brand backfill: once an operator authorized it (`brand-roles-enable`), the projects'
 * discovered brands get their domain without anyone opening Brands, DOMAIN_BATCH brands per project and visit, through
 * the same `discoverBrandDomains` (free step first; paid steps only with BRAND_DOMAIN_MAX_USD, under its monthly
 * ceiling). `brand_domain_lookups` is the memory: a brand tried once (searched, decided or left without a site) is never
 * tried again, so the backfill only ever does what is left.
 */
export async function processBrandDomains(projectIds?: readonly string[]) {
  if (!(await questionRolesAuthorization())) return 0;
  const database = db();
  const due = (
    await database
      .prepare(
        `SELECT p.id id,p.workspace_id workspace_id FROM projects p
         JOIN project_stores s ON s.project_id=p.id AND s.workspace_id=p.workspace_id AND s.initialized=1
         LEFT JOIN system_state c ON c.key='brand-domains-checked:'||p.id
         WHERE p.archived=0 AND COALESCE(c.value,'')<?${projectIds ? ' AND p.id IN (SELECT value FROM json_each(?))' : ''} ORDER BY COALESCE(c.value,'') LIMIT ?`,
      )
      .bind(new Date(Date.now() - DOMAINS_EVERY_MS).toISOString(), ...(projectIds ? [JSON.stringify(projectIds)] : []), DOMAIN_PROJECTS_PER_TICK)
      .all<{ id: string; workspace_id: string }>()
  ).results;
  let processed = 0;
  const deadline = Date.now() + DOMAIN_TICK_BUDGET_MS;
  for (const item of due) {
    if (Date.now() > deadline) break;
    await database
      .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(`brand-domains-checked:${item.id}`, now())
      .run();
    try {
      processed += (await domainPass(item.id, item.workspace_id, deadline)).processed;
    } catch (error) {
      console.warn(`Brand domain backfill: ${error instanceof Error ? error.message : 'failed'}.`);
    }
  }
  return processed;
}
