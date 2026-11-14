// Computing an artifact's data blocks (lib/agent-blocks.ts) from the project's own reports: the MCP read tools run
// in-process as a viewer of the artifact's workspace, for the artifact's project only (never a project a block names), so
// a block reads no more than any member could, and never answer texts, settings, members, credits or costs (the MCP
// projection drops those, and each kind of data keeps only the names and numbers it draws). No model, no paid provider:
// these are the same reads the screens make, cached as theirs are.
import { ENGINE_LABELS, type Engine } from '@/lib/engines';
import { BlockError, LIVE_METRICS, isLive, mapLiveFences, readLiveBlock, reportRows, type LiveBlock, type LiveRow } from '@/lib/agent-blocks';
import { liveChart, readChart, readMetrics } from '@/lib/agent';
import { now } from './env';
import { accountCapabilities } from './capabilities';
import { actorToolContext } from './mcp';
import { projection, ToolError, TOOLS, type Json } from './mcp-tools';
import type { Actor } from './auth';

const round = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : null);
const text = (value: unknown, max = 200) => (typeof value === 'string' ? value.slice(0, max) : null);
/** The daily series' column of each metric (the Overview chart's). */
const DAILY: Record<string, string> = { visibility: 'brand', shareOfVoice: 'sov', mentionPosition: 'position' };

/** One read tool's answer, as the agent reads it; arguments it refuses, or a refusal of the route, are a BlockError. */
async function read(actor: Actor, name: string, input: Json) {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool || tool.write) throw new BlockError(`${name} is not a read tool.`);
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) throw new BlockError(`args of ${name}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0, 300)}`);
  try {
    return projection(await tool.run(parsed.data as Json, actorToolContext(actor, 'artifact'))) as Json;
  } catch (error) {
    throw error instanceof ToolError && (error.code === 'invalid_argument' || error.code === 'not_found') ? new BlockError(`${name}: ${error.message}`) : error;
  }
}

/** The figures a block shows now, read from the project's data (the rows its shape draws). */
export async function computeBlock(actor: Actor, projectId: string, block: LiveBlock): Promise<LiveRow[]> {
  const report: Json = { project: projectId, ...block.period };
  const limit = block.limit ?? 10;
  const metric = block.metric ?? 'visibility';
  const byMetric = (rows: LiveRow[]) => [...rows].sort((a, b) => Number(b[metric] ?? -1) - Number(a[metric] ?? -1));
  if (block.data === 'report') {
    const rows = reportRows(await read(actor, block.tool!, { ...block.args, ...report }), block);
    if (rows.length && ['line', 'bar', 'donut'].includes(block.shape) && !liveChart(block, rows, ''))
      throw new BlockError(`its ${rows.length} rows cannot be drawn as a ${block.shape} (a donut takes up to 12 shares of one whole; up to 8 series).`);
    return rows;
  }
  if (block.data === 'overview' && block.shape === 'line') {
    const overview = await read(actor, 'get_overview', { ...report, include_daily: true });
    const column = DAILY[metric] ?? 'brand';
    return ((overview.daily ?? []) as Json[]).map((day) => ({ x: text(day.date, 10), value: round(day[column]) }));
  }
  if (block.data === 'overview') {
    const overview = await read(actor, 'get_overview', report);
    const compared = Number(overview.samples?.previous) > 0;
    return LIVE_METRICS.map((key) => ({ key, value: round(overview.metrics?.[key]), delta: compared ? round(overview.comparison?.delta?.[key]) : null }));
  }
  if (block.data === 'models') {
    const overview = await read(actor, 'get_overview', report);
    return byMetric(
      ((overview.channels ?? []) as Json[]).map((channel) => ({
        x: ENGINE_LABELS[channel.engine as Engine] ?? text(channel.engine, 40),
        visibility: round(channel.visibility),
        shareOfVoice: round(channel.shareOfVoice),
        citationPresence: round(channel.citationPresence),
        mentionPosition: round(channel.mentionPosition),
      })),
    );
  }
  if (block.data === 'brands') {
    const brands = await read(actor, 'compare_brands', report);
    return byMetric(((brands.platforms ?? []) as Json[]).map((brand) => ({ x: text(brand.name, 80), visibility: round(brand.visibility), shareOfVoice: round(brand.shareOfVoice) }))).slice(0, limit);
  }
  if (block.data === 'prompts') {
    const prompts = await read(actor, 'list_prompts', report);
    return byMetric(
      ((prompts.prompts ?? []) as Json[])
        .filter((prompt) => prompt.metrics)
        .map((prompt) => ({ x: text(prompt.text), topic: text(prompt.topic, 80), visibility: round(prompt.metrics.visibility), shareOfVoice: round(prompt.metrics.shareOfVoice), mentionPosition: round(prompt.metrics.position) })),
    ).slice(0, limit);
  }
  if (block.data === 'sources') {
    const sources = await read(actor, 'list_sources', { ...report, group: 'domain', kind: 'cited' });
    return ((sources.sources ?? []) as Json[])
      .map((source) => ({ x: text(source.domain, 120), citations: round(source.citations), responses: round(source.responses), ownership: text(source.ownership, 20) }))
      .slice(0, limit);
  }
  const types = await read(actor, 'get_source_types', report);
  return ((types.types ?? []) as Json[]).map((type) => ({ x: text(type.type, 40), share: round(type.share), citations: round(type.citations) }));
}

/** A viewer of the owner's workspace: what a block reads with (reads only, nothing account-wide). */
export const blockReader = (workspaceId: string): Actor => ({ id: workspaceId, email: '', name: '', workspaceId, role: 'viewer' });

/**
 * The document with its blocks computed: `which` live ones (the artifact opens), or only the ones with no figures yet
 * (an artifact being saved). A block that cannot be computed keeps the figures it had. Nothing computes when the
 * workspace no longer has the agent: its blocks show their figures as they were.
 */
export async function refreshBlocks(workspaceId: string, projectId: string, content: string, options: { artifactLive: boolean; which: 'live' | 'missing'; failures?: string[] }) {
  if (!content.includes('```live')) return content;
  if (!(await accountCapabilities(workspaceId).catch(() => null))?.agent) return content;
  const reader = blockReader(workspaceId);
  return mapLiveFences(content, async (block) => {
    const due = options.which === 'live' ? isLive(block, options.artifactLive) : !block.snapshot;
    if (!due) return options.which === 'missing' ? block : null;
    try {
      return { ...block, snapshot: await computeBlock(reader, projectId, block), captured_at: now() };
    } catch (error) {
      if (error instanceof BlockError) options.failures?.push(`the data block "${block.title ?? block.tool ?? block.data}": ${error.message}`);
      else console.error('Lastfind artifact block failed:', block.data, error instanceof Error ? error.name : 'Unknown error');
      return null;
    }
  });
}

const CHART_RULE = 'type bar, line (x a YYYY-MM-DD day) or donut (rows {"x","value"}, up to 12); x on every row; 1 to 8 series with key and label; numbers as numbers';
/**
 * What the agent writes into an artifact, checked: its charts, key figures and data blocks are each one Lastfind can draw,
 * and its data blocks are computed. One it cannot draw comes back to the model as an error that names it and says why
 * (nothing is saved), never a block left in the artifact as raw text or without figures.
 */
export async function agentBlocks(workspaceId: string, projectId: string, content: string, artifactLive: boolean): Promise<{ content: string } | { error: string }> {
  const problems: string[] = [];
  let index = 0;
  for (const match of content.matchAll(/```(chart|metrics|live)[^\n]*\n([\s\S]*?)\n?```/g)) {
    index++;
    let value: unknown;
    try {
      value = JSON.parse(match[2]);
    } catch {
      problems.push(`block ${index} (${match[1]}) is not one JSON value`);
      continue;
    }
    if (match[1] === 'chart' && !readChart(value)) problems.push(`block ${index} (chart) cannot be drawn: ${CHART_RULE}`);
    if (match[1] === 'metrics' && !readMetrics(value)) problems.push(`block ${index} (metrics) needs 1 to 4 figures, each with label and value`);
    if (match[1] === 'live' && !readLiveBlock(value)) problems.push(`block ${index} (live) is not a data block: a data of its list, and for data report one of its tools, x and 1 to 8 series with key and label`);
  }
  const failures: string[] = [];
  const filled = problems.length ? content : await refreshBlocks(workspaceId, projectId, content, { artifactLive, which: 'missing', failures });
  const all = [...problems, ...failures];
  return all.length ? { error: `Nothing was saved. Fix and save again: ${all.join('; ')}.`.slice(0, 1500) } : { content: filled };
}
