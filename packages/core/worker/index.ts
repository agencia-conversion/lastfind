import handler from 'vinext/server/fetch-handler';
import { withRequestContext } from '@edition/server/request-context';
import { submitQueued, tick } from '../lib/server/monitor';
import { setting } from '../lib/server/env';
import { collectNewPromptsImmediately } from '../lib/server/capabilities';
import { cachedBlogDocument, isBlogDocumentRequest } from '../lib/server/blog-edge-cache';

// A new prompt in the independent edition is submitted right away: Cloudflare
// can take up to 15 minutes to start a first deployment's scheduled runs, and
// the owner should not have to guess whether anything is happening. Only the
// provider submission runs here (claims are atomic, so it is safe next to the
// scheduler); the scheduler keeps collection, evaluation and publication, whose
// long calls must not run under the short post-response limit. Cloud keeps its
// daily window.
const SUBMIT_AFTER = new Set(['/api/prompts', '/api/runs']);
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
    const response = await withRequestContext(request, (contextRequest) =>
      handler.fetch(contextRequest, env, ctx),
    );
    if (
      new URL(request.url).pathname === '/app' ||
      new URL(request.url).pathname.startsWith('/app/') ||
      new URL(request.url).pathname.startsWith('/api/')
    ) {
      const secured = new Response(response.body, response);
      secured.headers.set('Cache-Control', 'private, no-store');
      secured.headers.set('X-Content-Type-Options', 'nosniff');
      if (
        collectNewPromptsImmediately &&
        request.method === 'POST' &&
        response.ok &&
        SUBMIT_AFTER.has(new URL(request.url).pathname)
      )
        ctx.waitUntil(
          submitQueued().catch(() =>
            console.error(
              'Immediate submission will retry on the next scheduled run.',
            ),
          ),
        );
      return secured;
    }
    return response;
  },
  async scheduled(
    _controller: ScheduledController,
    _env: Cloudflare.Env,
    ctx: ExecutionContext,
  ) {
    if (setting('MAINTENANCE_MODE') === 'true') return;
    ctx.waitUntil(tick());
  },
};

export default worker;

export { ProjectStore } from './project-store';
