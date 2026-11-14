import { requireActor } from '@/lib/server/auth';
import { agentTicketCookie, createConversation, createLiveConversation, listConversations, requireAgent } from '@/lib/server/agent';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// Agent > Chat, the signed-in account's own conversations in a project (paid plans and the independent edition):
// GET  ?project=<id>[&artifact=<id>] → { conversations: ConversationSummary[], usage: { used, limit } }  (pinned first, then
//      newest; with artifact, the chats beside that artifact, otherwise those of Agent > Chat)
// POST { project, id?, artifact?, live? } → 201 ConversationSummary  (an empty conversation, with the page's id if it chose
//      one, beside that artifact if one is named; its first message names it). With live, also { expires } and its first
//      live-connection ticket in its cookie, as POST …/:id/live gives (the page connects without another request).
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const query = new URL(request.url).searchParams;
    const [, list] = await Promise.all([requireAgent(actor), listConversations(actor, query.get('project'), query.get('artifact'))]);
    return json(list);
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    const data = await body(request);
    if (!data.live) return json(await createConversation(actor, data.project, data.id, data.artifact), 201);
    const { ticket, ...created } = await createLiveConversation(actor, data.project, data.id, data.artifact);
    const response = json(created, 201);
    response.headers.append('Set-Cookie', agentTicketCookie(created.id, ticket));
    return response;
  } catch (error) {
    return fail(error);
  }
}
