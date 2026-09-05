import handler from 'vinext/server/fetch-handler';
import { withRequestContext } from '@edition/server/request-context';
import { tick } from '../lib/server/monitor';
import { setting } from '../lib/server/env';
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
    const response = await withRequestContext(request, () =>
      handler.fetch(request, env, ctx),
    );
    if (
      new URL(request.url).pathname === '/app' ||
      new URL(request.url).pathname.startsWith('/api/')
    ) {
      const secured = new Response(response.body, response);
      secured.headers.set('Cache-Control', 'private, no-store');
      secured.headers.set('X-Content-Type-Options', 'nosniff');
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
