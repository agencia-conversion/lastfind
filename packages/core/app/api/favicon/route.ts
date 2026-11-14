import { waitUntil } from 'cloudflare:workers';
import { currentUser } from '@/lib/server/auth';
import { faviconResponse } from '@/lib/server/favicon';
import { rawResponsesBucket } from '@/lib/server/raw-responses';

export async function GET(request: Request) {
  return faviconResponse(currentUser, new URL(request.url).searchParams.get('domain') ?? '', fetch, {
    store: rawResponsesBucket(),
    defer: waitUntil,
  });
}
