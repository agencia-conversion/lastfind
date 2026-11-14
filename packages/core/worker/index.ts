import handler from 'vinext/server/fetch-handler';
import { withRequestContext } from '@edition/server/request-context';
import { OPERATIONS_CRON } from '../lib/server/leases';
import { operationsWithTick } from '../lib/server/capabilities';
import { submitQueued, tick } from '../lib/server/monitor';
import { operations } from '../lib/server/operations';
import { setting } from '../lib/server/env';
import { loadPlatformSettings } from '../lib/server/platform-settings';
import { collectNewPromptsImmediately } from '../lib/server/capabilities';
import { cachedBlogDocument, isBlogDocumentRequest } from '../lib/server/blog-edge-cache';
import { wellKnown } from '../lib/server/api-access';
import { getAgentByName } from 'agents';
import { env as workerEnv } from 'cloudflare:workers';
import { agentTicketOf, agentTicketValid } from '../lib/server/agent';

// Every response: no framing by another site (clickjacking), no plugin content, no `<base>` pointing elsewhere, forms
// that only post here, no full URL leaked as referrer, HTTPS only. A script policy (nonces, report-only first) is the
// next step.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};
function withSecurityHeaders(response: Response) {
  // A WebSocket upgrade cannot be rebuilt; nothing here serves one, but it would pass through untouched.
  if (response.status === 101) return response;
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    if (!copy.headers.has(name)) copy.headers.set(name, value);
  return copy;
}

// A new prompt in the independent edition is submitted right away: Cloudflare
// can take up to 15 minutes to start a first deployment's scheduled runs, and
// the owner should not have to guess whether anything is happening. Only the
// provider submission runs here (claims are atomic, so it is safe next to the
// scheduler); the scheduler keeps collection, evaluation and publication, whose
// long calls must not run under the short post-response limit. Cloud keeps its
// daily window.
const SUBMIT_AFTER = new Set(['/api/prompts', '/api/runs']);
// AI apps (MCP): the OAuth discovery documents, and the endpoints an app calls directly (from a browser too, so any
// origin may read them; none of them reads a cookie). The consent POST (/oauth/authorize) stays same-origin.
const WELL_KNOWN: Record<string, Parameters<typeof wellKnown>[0]> = {
  '/.well-known/oauth-protected-resource': 'oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp': 'oauth-protected-resource',
  '/.well-known/oauth-authorization-server': 'oauth-authorization-server',
};
const OPEN_CORS = new Set([...Object.keys(WELL_KNOWN), '/oauth/token', '/oauth/register', '/oauth/revoke']);
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};
// The agent chat's live connection (`/agent-live/<conversation>`, a WebSocket and the agent's own HTTP reads): only from
// this site and with a fresh ticket for that conversation, from its cookie (lib/server/agent.ts). The agent spends the
// ticket's nonce before the request reaches it, so a ticket opens one connection only.
const AGENT_LIVE = /^\/agent-live\/([0-9a-f-]{36})(?:\/[\w-]+)?$/;
async function agentLive(request: Request, env: Cloudflare.Env, id: string) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const forbidden = () => new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  await loadPlatformSettings();
  if (!env.LASTFIND_AGENT || (origin && origin !== url.origin)) return forbidden();
  const claim = await agentTicketValid(id, agentTicketOf(request));
  if (!claim) return forbidden();
  const agent = await getAgentByName(env.LASTFIND_AGENT, id);
  if (!(await agent.claimTicket(claim.nonce, claim.expires))) return forbidden();
  return agent.fetch(request);
}
const appPath = (pathname: string) =>
  pathname === '/app' || pathname === '/admin' || pathname === '/mcp' || ['/app/', '/api/', '/oauth/'].some((prefix) => pathname.startsWith(prefix));
const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    if (
      setting('MAINTENANCE_MODE') === 'true' &&
      !['/api/health', '/api/operations/project-storage'].includes(
        new URL(request.url).pathname,
      )
    ) {
      return Response.json(
        { error: 'Lastfind is briefly updating. Please try again shortly.' },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
        },
      );
    }
    const { pathname } = new URL(request.url);
    const live = AGENT_LIVE.exec(pathname);
    if (live) return agentLive(request, env, live[1]);
    if (OPEN_CORS.has(pathname)) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      const kind = WELL_KNOWN[pathname];
      if (!kind) await loadPlatformSettings();
      const response = kind
        ? Response.json(wellKnown(kind), { headers: { 'Cache-Control': 'public, max-age=300' } })
        : await withRequestContext(request, (contextRequest) => handler.fetch(contextRequest, env, ctx));
      const open = new Response(response.body, response);
      for (const [name, value] of Object.entries(CORS_HEADERS)) open.headers.set(name, value);
      if (!kind) open.headers.set('Cache-Control', 'no-store');
      open.headers.set('X-Content-Type-Options', 'nosniff');
      return open;
    }
    if (isBlogDocumentRequest(request)) {
      return cachedBlogDocument(
        request,
        (publicRequest) =>
          withRequestContext(publicRequest, (contextRequest) =>
            handler.fetch(contextRequest, env, ctx),
          ),
        (caches as CacheStorage & { default: Cache }).default,
        (promise) => ctx.waitUntil(promise),
        env.WORKER_VERSION?.id,
      );
    }
    // Credentials and models saved in Admin are read like Worker variables; they are loaded before the app, an API
    // route, the MCP endpoint or OAuth runs (once a minute per isolate). Marketing pages, the blog and assets never need them.
    if (appPath(pathname)) await loadPlatformSettings();
    const response = await withRequestContext(request, (contextRequest) =>
      handler.fetch(contextRequest, env, ctx),
    );
    if (pathname !== '/admin' && appPath(pathname)) {
      const secured = new Response(response.body, response);
      // The AI app consent screen is never shown inside another page (clickjacking an approval).
      if (pathname === '/app/connect') {
        secured.headers.set('X-Frame-Options', 'DENY');
        secured.headers.set('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
      }
      // The icon routes set their own max-age (the public demo's is public); no-store would refetch every icon on each screen.
      if (!['/api/favicon', '/api/demo/favicon'].includes(new URL(request.url).pathname)) secured.headers.set('Cache-Control', 'private, no-store');
      secured.headers.set('X-Content-Type-Options', 'nosniff');
      if (
        collectNewPromptsImmediately &&
        request.method === 'POST' &&
        response.ok &&
        SUBMIT_AFTER.has(new URL(request.url).pathname)
      )
        ctx.waitUntil(
          submitQueued().catch((error) =>
            console.error(
              'Immediate submission will retry on the next scheduled run.',
              error instanceof Error ? error.message : String(error),
            ),
          ),
        );
      return secured;
    }
    return response;
  },
  async scheduled(
    controller: ScheduledController,
    _env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    if (setting('MAINTENANCE_MODE') === 'true') return;
    // A second cron trigger (Cloud) runs the project operations in an invocation of their own; an edition with one trigger
    // (the independent edition) runs them right after the tick, each under its own lease.
    ctx.waitUntil(
      (async () => {
        await loadPlatformSettings();
        if (controller.cron === OPERATIONS_CRON) return operations();
        await tick();
        if (operationsWithTick) await operations();
      })(),
    );
  },
};

// Every path above (maintenance, blog cache, app, API, site) leaves through the security headers.
const respond = worker.fetch;
worker.fetch = async (request, env, ctx) => withSecurityHeaders(await respond(request, env, ctx));

export default worker;

import { setRestoreDriver } from './project-store';
import { restoreStep } from '../lib/server/project-restores';
import { setAgentTranscripts } from '../lib/server/agent-backup';
import { setLearning } from '../lib/server/project-runners';
import { setConversationEraser } from '../lib/server/project-erase';
import { curationProjects, processAgentCuration } from '../lib/server/agent-curator';
// Background restores run in a project store instance's alarm (Settings > Project data).
setRestoreDriver(restoreStep);
// Backups and exports carry the project's agent conversations, read from each conversation's agent.
setAgentTranscripts(async (id) => {
  if (!workerEnv.LASTFIND_AGENT) throw new Error('The agent is not configured.');
  return (await getAgentByName(workerEnv.LASTFIND_AGENT, id)).transcript();
});
// A deleted project's conversations are destroyed with their agents (lib/server/project-erase.ts).
setConversationEraser(async (id) => {
  if (workerEnv.LASTFIND_AGENT) await (await getAgentByName(workerEnv.LASTFIND_AGENT, id)).destroy();
});
// The agent's curator runs in the scheduler's last step and in the `learn` project runners.
setLearning({ projects: curationProjects, step: processAgentCuration });
export { ProjectStore } from './project-store';
export { ProjectRunner } from './project-runner';
export { LastfindAgent } from './agent';
