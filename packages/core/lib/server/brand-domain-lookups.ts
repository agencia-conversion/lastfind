import {
  DOMAIN_CONFIDENCE_HIGH,
  DOMAIN_PROJECT_SPEND_SQL,
  domainSpendSince,
  DOMAIN_DECISION_RESERVE_USD,
  DOMAIN_MAX_ATTEMPTS,
  DOMAIN_PAID_MIN_RESPONSES,
  DOMAIN_SEARCH_RESERVE_USD,
  type DomainLookup,
  type SerpDomain,
  type SiteCheck,
} from '@/lib/brand-domain';
import { siteHosts } from '@/lib/brand-domain';
import type { BrandRow } from '@/lib/brand-decisions';
import { db, setting } from './env';
import { decisionKeyConfigured } from './model-routes';

export type LookupRow = {
  brand_key: string;
  brand_name: string;
  candidates_json: string;
  query: string | null;
  search_status: 'submitting' | 'done' | 'unknown' | null;
  search_json: string | null;
  search_attempts: number;
  search_cost_usd: number;
  search_reserved_usd: number;
  decision_status: 'submitting' | 'unknown' | null;
  decision_attempts: number;
  decision_cost_usd: number;
  decision_reserved_usd: number;
  /** The project whose ceiling the search is charged to (project_id only says who created the free result). */
  paid_project_id: string | null;
  /** The project the decision is charged to; null while it is still the search's payer. */
  decision_project_id: string | null;
  domain: string | null;
  confidence: number | null;
  source: 'answers' | 'search' | null;
  model: string | null;
  error: string | null;
  decided_at: string | null;
};

/**
 * The paid steps (Google search + Decisions) run only with a monthly limit per project (`BRAND_DOMAIN_MAX_USD`, the operator's
 * module limit) and both providers' credentials. Without them discovery stays on the free step, and nothing errors. The
 * project's budget (Settings > Monitoring > Budget) also holds them, in the same reservation.
 */
export function domainDiscoveryConfig() {
  const value = Number(setting('BRAND_DOMAIN_MAX_USD'));
  const maxUsd = Number.isFinite(value) && value > 0 ? value : 0;
  const credentials = !!setting('DATAFORSEO_LOGIN') && !!setting('DATAFORSEO_PASSWORD') && !!decisionKeyConfigured();
  return { maxUsd, paid: maxUsd > 0 && credentials };
}

const json = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
};
export const lookupCandidates = (row: LookupRow) =>
  json<{ domain: string }[]>(row.candidates_json, []).map((item) => item.domain);
export const lookupSearch = (row: LookupRow) => json<SerpDomain[]>(row.search_json, []);

/** The stored lookups of these brands (an account holds one row per brand it ever looked up, in every project). */
export async function loadDomainLookups(workspaceId: string, locationCode: number, keys: string[]) {
  if (!keys.length) return new Map<string, LookupRow>();
  const { results } = await db()
    .prepare('SELECT * FROM brand_domain_lookups WHERE workspace_id=? AND location_code=? AND brand_key IN (SELECT value FROM json_each(?))')
    .bind(workspaceId, locationCode, JSON.stringify([...new Set(keys)]))
    .all<LookupRow>();
  return new Map(results.map((row) => [row.brand_key, row]));
}

/** What the brand rows read: the domain and its confidence, and the other domains considered. */
export function lookupView(row: LookupRow): DomainLookup {
  const candidates = [...new Set([...lookupCandidates(row), ...lookupSearch(row).map((item) => item.domain)])];
  return {
    domain: row.domain,
    confidence: row.confidence,
    source: row.source,
    candidates: candidates.filter((domain) => domain !== row.domain).slice(0, 6),
  };
}

/** Real cost plus the reserve of each unpriced step, of the paid steps this project pays for in the month (the ceiling's meter). */
export async function projectDomainSpend(projectId: string, monthStart: string) {
  const row = await db()
    .prepare(
      `SELECT COALESCE(SUM(${DOMAIN_PROJECT_SPEND_SQL}),0) AS spent FROM brand_domain_lookups
       WHERE (paid_project_id=? OR decision_project_id=?) AND ${domainSpendSince('?')}`,
    )
    .bind(projectId, projectId, projectId, projectId, monthStart)
    .first<{ spent: number }>();
  return Number(row?.spent ?? 0);
}

export const monthStart = (stamp: string) => `${stamp.slice(0, 7)}-01T00:00:00.000Z`;

export type DomainStage = 'answers' | 'search' | 'decide';
/**
 * The brands still owed discovery work, with the next step each needs. Only discovered brands with
 * no domain, or only a guess, qualify (a confirmed, rejected or confident domain, a monitored brand and a
 * stored result never reach a provider), and only a brand named by DOMAIN_PAID_MIN_RESPONSES answers is paid for. The one rule the overview's counter and the request share.
 */
export function domainWork(
  projectId: string,
  rows: Pick<BrandRow, 'key' | 'status' | 'domain' | 'domainConfidence' | 'responses'>[],
  lookups: Map<string, LookupRow>,
  config: { paid: boolean; maxUsd: number },
  spent: number,
) {
  // The worst case of one brand (search + decision), as the reservation will ask for it.
  const capped = spent + DOMAIN_SEARCH_RESERVE_USD + DOMAIN_DECISION_RESERVE_USD > config.maxUsd;
  const work: { key: string; stage: DomainStage }[] = [];
  for (const row of rows) {
    // A guessed domain (low confidence) is still owed a better one; a confident or decided domain is never searched.
    if (row.status !== 'discovered' || (row.domain && row.domainConfidence !== 'low')) continue;
    const found = lookups.get(row.key);
    if (!found) work.push({ key: row.key, stage: 'answers' });
    else if (!config.paid || capped || (row.responses ?? 0) < DOMAIN_PAID_MIN_RESPONSES) continue;
    else if (
      found.search_status === null &&
      found.search_attempts < DOMAIN_MAX_ATTEMPTS &&
      !((found.confidence ?? 0) >= DOMAIN_CONFIDENCE_HIGH && found.source === 'answers')
    )
      work.push({ key: row.key, stage: 'search' });
    // One in flight or lost is never sent again. A decision surely not billed is open to any project of the account, so the
    // payer's absence cannot strand it; one that already cost something stays with whoever paid it.
    else if (
      found.search_status === 'done' &&
      found.model === null &&
      found.decision_status === null &&
      (found.decision_cost_usd === 0 || (found.decision_project_id ?? found.paid_project_id) === projectId) &&
      found.decision_attempts < DOMAIN_MAX_ATTEMPTS
    )
      work.push({ key: row.key, stage: 'decide' });
  }
  return { work, capped };
}

/** The stored reads of these sites' home pages, by host (public facts, shared by every account). */
export async function loadSiteChecks(hosts: string[]): Promise<Record<string, SiteCheck>> {
  if (!hosts.length) return {};
  const { results } = await db()
    .prepare('SELECT host,reachable,final_host,title,site_name,checked_at FROM site_checks WHERE host IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify([...new Set(hosts)]))
    .all<{ host: string; reachable: number; final_host: string | null; title: string | null; site_name: string | null; checked_at: string }>();
  return Object.fromEntries(
    results.map((row) => [
      row.host,
      { reachable: row.reachable === 1, host: row.final_host, title: row.title, siteName: row.site_name, checkedAt: row.checked_at },
    ]),
  );
}

export function saveSiteCheck(host: string, check: SiteCheck) {
  return db()
    .prepare(
      `INSERT INTO site_checks(host,reachable,final_host,title,site_name,checked_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(host) DO UPDATE SET reachable=excluded.reachable,final_host=excluded.final_host,title=excluded.title,site_name=excluded.site_name,checked_at=excluded.checked_at`,
    )
    .bind(host, check.reachable ? 1 : 0, check.host, check.title, check.siteName, check.checkedAt)
    .run();
}

/**
 * The brand rows with the stored reads of their sites applied: `derive` builds them for a set of reads; the reads are those of
 * the domains (or guesses) the rows have without them. A failed read of the table only leaves the rows unconfirmed.
 */
export async function withSiteChecks(derive: (sites: Record<string, SiteCheck>) => BrandRow[], locationCode: number) {
  const hosts = derive({}).filter((row) => row.status === 'discovered').flatMap((row) => siteHosts(row, locationCode));
  const sites = await loadSiteChecks(hosts).catch(() => ({}) as Record<string, SiteCheck>);
  return { rows: derive(sites), sites };
}
