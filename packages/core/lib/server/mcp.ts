// The MCP endpoint (`POST /mcp`, both editions): AI apps (Claude, ChatGPT, Cursor) read a workspace and make the safe
// changes of mcp-tools.ts with a token (api-access.ts). Stateless: protocol 2026-07-28 and 2025 clients without a session.
// Each tool calls the app's own route in-process, as the token's account in the project's workspace (withTokenActor), so
// it answers exactly what the screen shows and is refused exactly where the screen is.
import { createMcpHandler, McpServer, requireScopes, type CallToolResult } from '@modelcontextprotocol/server';
import { appOrigin } from './env';
import { withTokenActor, type Actor } from './auth';
import { accessActors, audit, bearerChallenge, mcpResource, projectActor, SCOPES, verifyBearer, WRITE_SCOPE, type AuditOutcome, type TokenAccess } from './api-access';
import { INSTRUCTIONS, projection, routeOf, ToolError, toolErrorCode, toolsFor, TOOLS, type Json, type Method, type RouteFile, type ToolContext, type ToolDefinition } from './mcp-tools';
import * as reports from '@/app/api/reports/route';
import * as workspace from '@/app/api/workspace/route';
import * as runs from '@/app/api/runs/[id]/route';
import * as brands from '@/app/api/projects/[id]/brands/route';
import * as research from '@/app/api/projects/[id]/brand-research/route';
import * as panel from '@/app/api/projects/[id]/semantic/panel/route';
import * as evidence from '@/app/api/projects/[id]/semantic/panel/evidence/route';
import * as aiBots from '@/app/api/projects/[id]/ai-bots/route';
import * as comparison from '@/app/api/projects/[id]/comparison/route';
import * as prompts from '@/app/api/prompts/route';
import * as bulk from '@/app/api/prompts/bulk/route';
import * as prompt from '@/app/api/prompts/[id]/route';
import * as topics from '@/app/api/topics/route';

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Response | Promise<Response>;
const MODULES = { 'api/reports': reports, 'api/workspace': workspace, 'api/runs/[id]': runs, 'api/projects/[id]/brands': brands, 'api/projects/[id]/brand-research': research, 'api/projects/[id]/semantic/panel': panel, 'api/projects/[id]/semantic/panel/evidence': evidence, 'api/projects/[id]/ai-bots': aiBots, 'api/projects/[id]/comparison': comparison, 'api/prompts': prompts, 'api/prompts/bulk': bulk, 'api/prompts/[id]': prompt, 'api/topics': topics } as unknown as Record<RouteFile, Partial<Record<Method, Handler>>>;
const WRITE_TOOLS = new Set(TOOLS.filter((tool) => tool.write).map((tool) => tool.name));

/** One app route, in-process, as `actor`: a change carries the app's own origin, as the screens send it (sameOrigin). */
async function routeCall(access: TokenAccess, actor: Actor, method: Method, path: string, body?: unknown) {
  const url = new URL(path, appOrigin());
  const route = routeOf(url.pathname);
  const handler = route && MODULES[route.file][method];
  if (!handler) throw new Error(`No route for ${method} ${url.pathname}`);
  const request = new Request(url, method === 'GET' ? undefined : { method, headers: { Origin: url.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const response = await withTokenActor({ actor, scopes: access.credential.scopes, credentialId: access.credential.id }, () =>
    handler(request, { params: Promise.resolve<Record<string, string>>(route.id === undefined ? {} : { id: route.id }) }),
  );
  const data = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok) throw new ToolError(toolErrorCode(response.status, String(data.error ?? '')), String(data.error ?? `The request failed (${response.status}).`));
  return data;
}

/**
 * The tools' context for the in-app agent (agent.ts): the same routes in-process, as the signed-in account in its
 * workspace, so its role caps every change exactly as it caps an AI app's token.
 */
export function actorToolContext(actor: Actor, credentialId: string): ToolContext {
  const access: TokenAccess = { user: actor, credential: { id: credentialId, kind: 'pat', scopes: [...SCOPES], workspaceId: actor.workspaceId, clientId: null } };
  return {
    call: (method, path, body) => routeCall(access, actor, method, path, body),
    everyWorkspace: async (path) => [{ workspaceId: actor.workspaceId, role: actor.role, data: await routeCall(access, actor, 'GET', path) }],
  };
}

function answer(value: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown>, ...(isError ? { isError } : {}) };
}

/** The audit row of a change (ids only). */
function record(access: TokenAccess, actor: Actor, tool: ToolDefinition, args: Json, result: Json, outcome: AuditOutcome) {
  const target = (tool.target?.(args, result) ?? [args.project]).filter(Boolean);
  return audit({ credentialId: access.credential.id, workspaceId: actor.workspaceId, tool: tool.name, target, outcome }).catch((error) =>
    console.error('Lastfind MCP audit failed:', tool.name, error instanceof Error ? error.name : 'Unknown error'),
  );
}

async function runTool(tool: ToolDefinition, args: Json, access: TokenAccess): Promise<CallToolResult> {
  let actor: Actor | null = null;
  try {
    if (args.project !== undefined) {
      actor = await projectActor(access, args.project);
      if (!actor) throw new ToolError('not_found', 'Project not found.');
    }
    const context: ToolContext = {
      call: (method, path, body) => routeCall(access, actor!, method, path, body),
      everyWorkspace: async (path) =>
        Promise.all((await accessActors(access)).map(async (each) => ({ workspaceId: each.workspaceId, role: each.role, data: await routeCall(access, each, 'GET', path) }))),
    };
    const result = await tool.run(args, context);
    // The change is made: a failed audit row is logged, never reported as a failed change (the app would repeat it).
    if (tool.write && actor) await record(access, actor, tool, args, result, 'ok');
    return answer(projection(result, tool.textLimit));
  } catch (error) {
    const failure = error instanceof ToolError ? error : new ToolError('unavailable', 'Lastfind could not complete this request. Try again.');
    if (!(error instanceof ToolError)) console.error('Lastfind MCP tool failed:', tool.name, error instanceof Error ? error.name : 'Unknown error');
    if (tool.write && actor) await record(access, actor, tool, args, {}, failure.code === 'permission_denied' ? 'denied' : 'error');
    return answer({ error: { code: failure.code, message: failure.message } }, true);
  }
}

/** A server with the tools these scopes allow, for one request. */
function server(access: TokenAccess) {
  const write = access.credential.scopes.includes(WRITE_SCOPE);
  const mcp = new McpServer({ name: 'lastfind', title: 'Lastfind', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  for (const tool of toolsFor(write))
    mcp.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: tool.output,
        annotations: tool.write
          ? { title: tool.title, readOnlyHint: false, destructiveHint: tool.destructive ?? true, idempotentHint: tool.idempotent ?? false, openWorldHint: false }
          : { title: tool.title, readOnlyHint: true, openWorldHint: false },
        ...(tool.write ? { scopeChallenge: requireScopes(WRITE_SCOPE) } : {}),
      },
      ((args: Json) => runTool(tool, args, access)) as never,
    );
  return mcp;
}

const refusal = (status: number, error: string, headers: Record<string, string> = {}) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

/** Whether a body calls a write tool (a read token is challenged for the write scope before anything runs). */
async function callsWriteTool(request: Request) {
  const body = await request.clone().json().catch(() => null);
  return (Array.isArray(body) ? body : [body]).some((message) => message?.method === 'tools/call' && WRITE_TOOLS.has(message.params?.name));
}

export async function mcpPost(request: Request) {
  // A browser page of another site must not drive the endpoint with a token it holds; clients send no Origin.
  const origin = request.headers.get('origin');
  if (origin && origin !== appOrigin()) return refusal(403, 'Origin not allowed.');
  const verified = await verifyBearer(request);
  if (!verified.ok)
    return refusal(verified.status, verified.status === 429 ? 'rate_limited' : 'invalid_token', {
      'WWW-Authenticate': verified.wwwAuthenticate,
      ...(verified.retryAfter ? { 'Retry-After': String(verified.retryAfter) } : {}),
    });
  const { access } = verified;
  if (!access.credential.scopes.includes(WRITE_SCOPE) && (await callsWriteTool(request)))
    return refusal(403, 'insufficient_scope', { 'WWW-Authenticate': bearerChallenge('insufficient_scope') });
  const authInfo = {
    token: '',
    clientId: access.credential.clientId ?? access.credential.id,
    scopes: [...access.credential.scopes],
    resource: new URL(mcpResource()),
    resourceMetadataUrl: `${appOrigin()}/.well-known/oauth-protected-resource/mcp`,
  };
  return createMcpHandler(() => server(access), { legacy: 'stateless' }).fetch(request, { authInfo });
}
