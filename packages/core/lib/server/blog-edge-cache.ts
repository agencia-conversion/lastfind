// Blog pages contain only released, build-time content. The public header reads
// the visitor's session separately in the browser, so the document can be shared.
const BLOG_PATH = /^\/(?:pt-br\/)?blog(?:\/[^/]+)?\/?$/;
export const BLOG_EDGE_TTL_SECONDS = 60;

export function isBlogDocumentRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    request.method === 'GET' &&
    BLOG_PATH.test(url.pathname) &&
    !request.headers.has('RSC') &&
    !request.headers.has('Next-Router-State-Tree') &&
    !url.searchParams.has('_rsc')
  );
}

export async function cachedBlogDocument(
  request: Request,
  render: (request: Request) => Promise<Response>,
  cache: Pick<Cache, 'match' | 'put'>,
  waitUntil: (promise: Promise<unknown>) => void,
  versionId?: string,
): Promise<Response> {
  // Existing selfhost configs may not yet declare the binding. Serve normally
  // until upgraded, rather than caching a document across deployments.
  if (!versionId) return render(request);
  // Ignore tracking query strings and all visitor headers. Neither locale nor
  // article text varies within a URL, and no identity reaches the renderer.
  const keyUrl = new URL(request.url);
  keyUrl.search = '';
  // Worker Cache survives deployments. A new Worker version must never receive
  // HTML pointing at static asset hashes from the previous build.
  keyUrl.searchParams.set('__lastfind_worker_version', versionId);
  const key = new Request(keyUrl, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set('X-Blog-Cache', 'HIT');
    return response;
  }

  const publicRequest = new Request(request);
  publicRequest.headers.delete('Cookie');
  publicRequest.headers.delete('Authorization');
  const rendered = await render(publicRequest);
  const contentType = rendered.headers.get('Content-Type') ?? '';
  if (
    rendered.status !== 200 ||
    !contentType.includes('text/html') ||
    rendered.headers.has('Set-Cookie') ||
    rendered.headers.get('Vary')?.trim() === '*'
  ) return rendered;

  const response = new Response(rendered.body, rendered);
  response.headers.set('Cache-Control', `public, max-age=0, s-maxage=${BLOG_EDGE_TTL_SECONDS}`);
  response.headers.set('X-Blog-Cache', 'MISS');
  waitUntil(cache.put(key, response.clone()));
  return response;
}
