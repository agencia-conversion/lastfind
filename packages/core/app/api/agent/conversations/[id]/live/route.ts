import { requireActor } from '@/lib/server/auth';
import { agentTicketCookie, openConversation } from '@/lib/server/agent';
import { fail, json, sameOrigin } from '@/lib/server/http';

// POST → { expires, messages, ratings, changes }: lets this page open one live connection to the conversation's agent
// (/agent-live/<id>) in the next two minutes, with the messages its agent keeps and the author's ratings. The ticket
// itself goes in an HttpOnly cookie for that path only (lib/server/agent.ts), never in the body or a URL.
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const id = (await params).id;
    const { ticket, ...opened } = await openConversation(await requireActor(), id);
    const response = json(opened);
    response.headers.append('Set-Cookie', agentTicketCookie(id, ticket));
    return response;
  } catch (error) {
    return fail(error);
  }
}
