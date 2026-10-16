/**
 * SQL for the domain or URL of one cited source (`alias` is its json_each row).
 * A source stored without a domain falls back to the host of its URL; with no
 * host either it is '' (an unknown domain, never NULL). The project store
 * rejects the keyword REPLACE in read queries, so the host is cut by position.
 */
export function sourceKey(alias: string, group: string) {
  if (group !== 'domain') return `json_extract(${alias}.value,'$.${group}')`;
  const end = ['/', '?', '#', ':']
    .map((mark) => `COALESCE(NULLIF(instr(r,'${mark}'),0),1000000000)`)
    .join(',');
  const host = `(SELECT lower(substr(r,1,min(${end},length(r)+1)-1)) FROM (SELECT CASE WHEN instr(u,'://')>0 THEN substr(u,instr(u,'://')+3) ELSE u END r FROM (SELECT json_extract(${alias}.value,'$.url') u)))`;
  return `COALESCE(NULLIF(json_extract(${alias}.value,'$.domain'),''),(SELECT CASE WHEN h LIKE '%_._%' THEN CASE WHEN h LIKE 'www.%' THEN substr(h,5) ELSE h END END FROM (SELECT ${host} h)),'')`;
}
