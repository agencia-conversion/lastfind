import { validateSemanticConfiguration, type SemanticConfiguration } from '@/lib/semantic-evaluation';
import { db, now } from './env';
import { ApiError } from './http';
import { ownedProject } from './workspace';
import { projectReadDatabase } from './project-store-read';
import { parseReportFilter } from './reports';

type ConfigRow = { revision: number; configuration_json: string; created_at: string };

export async function semanticConfiguration(projectId: string, ownerId: string, revision?: number) {
  await ownedProject(projectId, ownerId);
  const row = await db().prepare(`SELECT revision,configuration_json,created_at
    FROM semantic_configurations WHERE project_id=? AND owner_id=?${revision ? ' AND revision=?' : ''}
    ORDER BY revision DESC LIMIT 1`).bind(projectId, ownerId, ...(revision ? [revision] : [])).first<ConfigRow>();
  if (revision && !row) throw new ApiError(404, 'Semantic configuration not found.');
  return row ? { revision: row.revision, ...validateSemanticConfiguration(JSON.parse(row.configuration_json)), createdAt: row.created_at }
    : { revision: 0, enabled: false, attributes: [], createdAt: null };
}

export async function saveSemanticConfiguration(projectId: string, ownerId: string, value: unknown, expectedRevision: unknown) {
  await ownedProject(projectId, ownerId);
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new ApiError(400, 'Invalid semantic revision.');
  let config: SemanticConfiguration;
  try { config = validateSemanticConfiguration(value); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Invalid semantic configuration.'); }
  const result = await db().prepare(`INSERT INTO semantic_configurations(project_id,owner_id,revision,configuration_json,created_at)
    SELECT p.id,p.owner_id,?, ?, ? FROM projects p
    WHERE p.id=? AND p.owner_id=? AND p.archived=0
      AND (SELECT COALESCE(MAX(revision),0) FROM semantic_configurations WHERE project_id=p.id)=?`)
    .bind(expectedRevision + 1, JSON.stringify(config), now(), projectId, ownerId, expectedRevision).run();
  if (!result.meta.changes) throw new ApiError(409, 'Semantic settings changed. Reload before saving.');
  return semanticConfiguration(projectId, ownerId);
}

export async function semanticReport(projectId: string, ownerId: string, q: URLSearchParams) {
  const requestedRevision = q.get('revision');
  const revision = requestedRevision ? Number(requestedRevision) : undefined;
  if (requestedRevision && (!Number.isSafeInteger(revision) || Number(revision) < 1))
    throw new ApiError(400,'Invalid semantic revision.');
  const configuration = await semanticConfiguration(projectId,ownerId,revision);
  const filter = parseReportFilter(q);
  const engine = q.get('engine') || 'all';
  const topic = q.get('topic') || '';
  const prompt = q.get('prompt') || '';
  const brand = q.get('brand') || '';
  const tags = [...new Set((q.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean))];
  if (topic.length > 100 || prompt.length > 100 || brand.length > 100)
    throw new ApiError(400,'Invalid semantic filter.');
  if (tags.length > 8 || tags.some((tag) => tag.length > 100))
    throw new ApiError(400,'Invalid tag filter.');
  const analytics = await projectReadDatabase(projectId,ownerId);
  const clauses = [`e.project_id=?`,`e.owner_id=?`,`e.config_revision=?`,`r.created_at>=?`,`r.created_at<?`];
  const bindings: (string | number)[] = [projectId,ownerId,configuration.revision,filter.cutoff,filter.end];
  if (engine !== 'all') {
    const engines = [...new Set(engine.split(','))];
    clauses.push(`r.engine IN (${engines.map(() => '?').join(',')})`);
    bindings.push(...engines);
  }
  if (topic) { clauses.push('p.tag=?'); bindings.push(topic); }
  if (prompt) { clauses.push('r.prompt_id=?'); bindings.push(prompt); }
  if (tags.length) {
    clauses.push(`EXISTS(SELECT 1 FROM json_each(p.tags_json) tag WHERE tag.value IN (${tags.map(() => '?').join(',')}))`);
    bindings.push(...tags);
  }
  if (brand) {
    clauses.push(`EXISTS(SELECT 1 FROM json_each(e.assessment_json,'$.readings') x WHERE json_extract(x.value,'$.brand')=?)`);
    bindings.push(brand);
  }
  const where = clauses.join(' AND ');
  const from = `FROM semantic_evaluations e JOIN runs r ON r.id=e.run_id AND r.project_id=e.project_id
    JOIN prompts p ON p.id=r.prompt_id AND p.project_id=e.project_id`;
  const eligibleClauses = [`r.project_id=?`,`r.owner_id=?`,`r.status='complete'`,`r.response_available=1`,`r.answer IS NOT NULL`,`r.created_at>=?`,`r.created_at<?`];
  const eligibleBindings: (string | number)[] = [projectId,ownerId,filter.cutoff,filter.end];
  if (engine !== 'all') {
    const engines = [...new Set(engine.split(','))];
    eligibleClauses.push(`r.engine IN (${engines.map(() => '?').join(',')})`);
    eligibleBindings.push(...engines);
  }
  if (topic) { eligibleClauses.push('p.tag=?'); eligibleBindings.push(topic); }
  if (prompt) { eligibleClauses.push('r.prompt_id=?'); eligibleBindings.push(prompt); }
  if (tags.length) {
    eligibleClauses.push(`EXISTS(SELECT 1 FROM json_each(p.tags_json) tag WHERE tag.value IN (${tags.map(() => '?').join(',')}))`);
    eligibleBindings.push(...tags);
  }
  const eligible = await analytics.prepare(`SELECT COUNT(*) count FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id WHERE ${eligibleClauses.join(' AND ')}`)
    .bind(...eligibleBindings).first<{ count: number }>();
  const evaluated = await analytics.prepare(`SELECT COUNT(*) count ${from} WHERE ${where}`)
    .bind(...bindings).first<{ count: number }>();
  const summary = (await analytics.prepare(`SELECT json_extract(x.value,'$.brand') brand,
      json_extract(x.value,'$.attribute') attribute,
      AVG(CASE WHEN json_extract(x.value,'$.state')='assessed' THEN json_extract(x.value,'$.score') END) score,
      SUM(json_extract(x.value,'$.state')='assessed') samples,
      COUNT(*) observations ${from},json_each(e.assessment_json,'$.readings') x
      WHERE ${where}${brand ? ` AND json_extract(x.value,'$.brand')=?` : ''}
      GROUP BY brand,attribute ORDER BY brand,attribute`)
    .bind(...bindings,...(brand ? [brand] : [])).all<Record<string,unknown>>()).results;
  const cursor = q.get('cursor');
  let cursorValues: string[] = [];
  if (cursor) {
    if (cursor.length > 500) throw new ApiError(400,'Invalid semantic cursor.');
    try { cursorValues = JSON.parse(atob(cursor)) as string[]; }
    catch { throw new ApiError(400,'Invalid semantic cursor.'); }
    if (cursorValues.length !== 2 || cursorValues.some((v) => typeof v !== 'string' || v.length > 200))
      throw new ApiError(400,'Invalid semantic cursor.');
  }
  const page = (await analytics.prepare(`SELECT e.id,e.run_id,e.config_revision,e.assessment_json,e.answer_sha256,
      e.rubric,e.model,e.coverage,e.cost_usd,e.created_at,r.engine,r.prompt_id,r.prompt_text,r.created_at run_created_at
      ${from} WHERE ${where}${cursor ? ' AND (e.created_at<? OR (e.created_at=? AND e.id<?))' : ''}
      ORDER BY e.created_at DESC,e.id DESC LIMIT 21`)
    .bind(...bindings,...(cursor ? [cursorValues[0],cursorValues[0],cursorValues[1]] : []))
    .all<Record<string,unknown>>()).results;
  const assessments = page.slice(0,20).map(({ assessment_json, ...row }) => ({
    ...row, readings: (JSON.parse(String(assessment_json)).readings as Array<{ brand: string }>).filter((reading) => !brand || reading.brand === brand),
  }));
  const last = page.length > 20 ? page[19] : null;
  return {
    configuration,
    coverage: { eligible: Number(eligible?.count || 0), evaluated: Number(evaluated?.count || 0), unassessed: Math.max(0,Number(eligible?.count || 0)-Number(evaluated?.count || 0)) },
    summary,
    assessments,
    nextCursor: last ? btoa(JSON.stringify([last.created_at,last.id])) : null,
  };
}
