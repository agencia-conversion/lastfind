import { mcpPost } from '@/lib/server/mcp';

// The MCP endpoint for AI apps (lib/server/mcp.ts). Stateless: no stream to open (GET) and no session to end (DELETE).
export const POST = (request: Request) => mcpPost(request);
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
export const GET = notAllowed;
export const DELETE = notAllowed;
