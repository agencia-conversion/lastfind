import { sharedArtifact } from '@/lib/server/agent';
import { fail, json } from '@/lib/server/http';

// A shared artifact, for anyone with its link (no sign-in): GET → { title, kind, content, updated_at }.
type Context = { params: Promise<{ token: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    return json(await sharedArtifact((await params).token));
  } catch (error) {
    return fail(error);
  }
}
