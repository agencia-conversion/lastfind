import type { Run } from '@/lib/types';
import type { RawArchiveRecord } from '@/lib/raw-responses';
export function runFromRow(r: Record<string, unknown>): Run {
  return {
    id: String(r.id),
    project_id: String(r.project_id),
    prompt_id: String(r.prompt_id),
    prompt_text: String(r.prompt_text),
    engine: r.engine as Run['engine'],
    status: r.status as Run['status'],
    mentions: JSON.parse(String(r.mentions_json)),
    brand_name: JSON.parse(String(r.targets_json))[0].name,
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
      ? { answer: r.answer as string, model: r.model as string }
      : {}),
  };
}

export const RUN_SUMMARY_COLUMNS = `r.id,r.project_id,r.prompt_id,r.prompt_text,r.engine,r.status,r.targets_json,r.mentions_json,r.response_available,r.cost,r.error,r.created_at,r.completed_at,
  json_array_length(r.sources_json) AS source_count, CASE WHEN r.consulted_sources_json IS NULL THEN NULL ELSE json_array_length(r.consulted_sources_json) END AS consulted_source_count`;
export function runSummary(row: Record<string, unknown>) {
  return {
    ...runFromRow({ ...row, sources_json: '[]' }),
    source_count: Number(row.source_count ?? 0),
    consulted_source_count:
      row.consulted_source_count == null
        ? null
        : Number(row.consulted_source_count),
    evidence_loaded: false,
  };
}
