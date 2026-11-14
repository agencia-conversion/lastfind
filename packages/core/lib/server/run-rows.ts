import type { Run } from '@/lib/types';
import type { RawArchiveRecord } from '@/lib/raw-responses';
import { POSITIONS_BASIS_SUFFIX } from '../run-positions.ts';
export function runFromRow(r: Record<string, unknown>): Run {
  const targetsJson = String(r.effective_targets_json ?? r.targets_json);
  const mentionsJson = String(r.effective_mentions_json ?? r.mentions_json);
  return {
    id: String(r.id),
    project_id: String(r.project_id),
    prompt_id: String(r.prompt_id),
    prompt_text: String(r.prompt_text),
    engine: r.engine as Run['engine'],
    status: r.status as Run['status'],
    mentions: JSON.parse(mentionsJson),
    brand_name: JSON.parse(targetsJson)[0].name,
    sources: JSON.parse(String(r.sources_json)),
    consulted_sources:
      typeof r.consulted_sources_json === 'string'
        ? JSON.parse(r.consulted_sources_json)
        : null,
    search_queries: JSON.parse(
      typeof r.search_queries_json === 'string' ? r.search_queries_json : '[]',
    ),
    response_available: r.response_available !== 0,
    cost: Number(r.cost),
    created_at: String(r.created_at),
    completed_at: r.completed_at as string | null,
    error: r.error as string | null,
    ...('raw_response_status' in r
      ? {
          raw_response: {
            status: String(r.raw_response_status) as RawArchiveRecord['status'],
            sha256: r.raw_response_sha256 as string | null,
            bytes:
              r.raw_response_bytes == null
                ? null
                : Number(r.raw_response_bytes),
            stored_at: r.raw_response_stored_at as string | null,
            error: r.raw_response_error as string | null,
          },
        }
      : {}),
    ...('answer' in r
      ? {
          answer: r.answer as string,
          model: r.model as string,
          targets: JSON.parse(targetsJson),
        }
      : {}),
  };
}

export const EFFECTIVE_TARGETS_SQL = `CASE WHEN r.analysis_revision=(SELECT value FROM store_meta WHERE key='analysis_revision') THEN r.analysis_targets_json ELSE r.targets_json END`;
export const EFFECTIVE_MENTIONS_SQL = `CASE WHEN r.analysis_revision=(SELECT value FROM store_meta WHERE key='analysis_revision') THEN r.analysis_mentions_json ELSE r.mentions_json END`;
/**
 * The discoveries share of voice and position count, as reports read them: the brand keys of the settled competitors that
 * are not rejected (syncCountedBrands), and, apart and small, the ones merged into another brand (`{key: group key}`), so
 * a group counts once per answer. Membership is an `IN` list SQLite builds once per statement; a join with the whole map
 * scanned it for every discovery of every answer (a project with a thousand competitors timed out). The store keeps the
 * results of reads that use them: a change starts a new data epoch.
 */
export const BRAND_COUNTED_SQL = "(SELECT value FROM store_meta WHERE key='brand_counted')";
export const BRAND_MERGED_SQL = "(SELECT value FROM store_meta WHERE key='brand_merged')";
/**
 * The discoveries the active brand analysis found in the answer, `{brand key: where it is first named}`, counted or not
 * (the Brands list measures them all); none under another analysis.
 */
export const ANSWER_DISCOVERY_KEYS_SQL = `CASE WHEN r.analysis_revision=(SELECT value FROM store_meta WHERE key='analysis_revision') THEN r.analysis_brands_json END`;
/**
 * Whether the answer's discoveries are known: the active brand analysis read it (an answer it did not read has unknown ones,
 * not none). Before a project's first analysis no discovery is known anywhere (none counts), so every answer reads the same way.
 */
export const ANSWER_ANALYSED_SQL = `(r.analysis_revision=(SELECT value FROM store_meta WHERE key='analysis_revision') OR (SELECT value FROM store_meta WHERE key='analysis_revision') IS NULL)`;
export const ANSWER_DISCOVERIES_SQL = `json_each(${ANSWER_DISCOVERY_KEYS_SQL})`;
/** The group a discovery counts in: the brand it was merged into, else itself (`found` is the discovery). */
export const DISCOVERY_GROUP_SQL = `COALESCE(json_extract(${BRAND_MERGED_SQL},'$."'||found.key||'"'),found.key)`;
/** Whether share of voice and position count the discovery. */
export const DISCOVERY_COUNTED_SQL = `found.key IN (SELECT value FROM json_each(${BRAND_COUNTED_SQL}))`;
/** The answer's counted discoveries, once per group; `where` narrows them (`found` is the discovery: key and offset). */
export const countedDiscoveriesSql = (where = '') =>
  `(SELECT COUNT(DISTINCT ${DISCOVERY_GROUP_SQL}) FROM ${ANSWER_DISCOVERIES_SQL} found WHERE ${DISCOVERY_COUNTED_SQL}${where ? ` AND ${where}` : ''})`;
/**
 * Brands an answer names (share of voice is over every identified brand): the monitored ones it mentions plus its
 * counted discoveries.
 */
export const ANSWER_BRANDS_SQL = `((SELECT COUNT(*) FROM json_each(${EFFECTIVE_MENTIONS_SQL}) WHERE value=1)+${countedDiscoveriesSql()})`;
/**
 * The one rule of every measure that counts discoveries (share of voice, position among the identified brands, a discovered
 * brand's visibility), 10/11/2026: only over the answers the active brand analysis read. An answer it did not read (newer
 * than its last pass, or past its cap) has unknown discoveries, not none: counted, it inflated the monitored brands' share
 * (Netflix 19% to 30% overnight). `voiceSql` keeps an expression's value only for such an answer; VOICE_BRANDS_SQL is the
 * share of voice denominator.
 */
export const voiceSql = (expression: string) => `(CASE WHEN ${ANSWER_ANALYSED_SQL} THEN (${expression}) ELSE 0 END)`;
export const VOICE_BRANDS_SQL = voiceSql(ANSWER_BRANDS_SQL);
/** The answer's counted discoveries as a JSON list of group keys (Responses names them beside the monitored ones). */
export const ANSWER_DISCOVERED_SQL = `(SELECT json_group_array(DISTINCT ${DISCOVERY_GROUP_SQL}) FROM ${ANSWER_DISCOVERIES_SQL} found WHERE ${DISCOVERY_COUNTED_SQL})`;

/** Which reading of the answer `run_positions` was made under: the active overlay's revision and the mentions it found, or '' for the collection snapshot. The revision only digests the targets, so the mentions have to be part of it. */
export const EFFECTIVE_POSITIONS_BASIS_SQL = `CASE WHEN r.analysis_revision=(SELECT value FROM store_meta WHERE key='analysis_revision') THEN r.analysis_revision||':'||COALESCE(r.analysis_mentions_json,'')||'${POSITIONS_BASIS_SUFFIX}' ELSE '${POSITIONS_BASIS_SUFFIX}' END`;

export const RUN_SUMMARY_COLUMNS = `r.id,r.project_id,r.prompt_id,r.prompt_text,r.engine,r.status,${EFFECTIVE_TARGETS_SQL} AS targets_json,${EFFECTIVE_MENTIONS_SQL} AS mentions_json,r.response_available,r.cost,r.error,r.created_at,r.completed_at,
  ${ANSWER_DISCOVERED_SQL} AS discovered_json,
  json_array_length(r.sources_json) AS source_count, CASE WHEN r.consulted_sources_json IS NULL THEN NULL ELSE json_array_length(r.consulted_sources_json) END AS consulted_source_count`;
export function runSummary(row: Record<string, unknown>) {
  // A list item carries neither the provider cost nor the internal error text: no screen shows them.
  const { cost: _cost, error: _error, ...run } = runFromRow({ ...row, sources_json: '[]' });
  return {
    ...run,
    source_count: Number(row.source_count ?? 0),
    discovered: typeof row.discovered_json === 'string' ? (JSON.parse(row.discovered_json) as string[]) : [],
    consulted_source_count:
      row.consulted_source_count == null
        ? null
        : Number(row.consulted_source_count),
    evidence_loaded: false,
  };
}
