import { currentUser, requireUser } from '@/lib/server/auth';
import { AVATAR_MAX_BYTES, avatarKey, avatarResponse, avatarType } from '@/lib/server/avatar-image';
import { rawResponsesBucket } from '@/lib/server/raw-responses';
import { ApiError, fail, json, sameOrigin } from '@/lib/server/http';

// The account photo (Settings > My profile): GET draws it (uploaded, else Gravatar, else 204 for the initials), PUT keeps
// the app's 256px crop in the private bucket, DELETE removes it. Only the signed-in person's own photo, never another's.
async function uploaded(userId: string) {
  const object = await rawResponsesBucket()?.get(avatarKey(userId));
  if (!object) return null;
  const image = new Uint8Array(await object.arrayBuffer());
  const type = avatarType(image);
  return type ? { image, type } : null;
}

export function GET() {
  return avatarResponse(currentUser, fetch, uploaded);
}

function bucket() {
  const found = rawResponsesBucket();
  if (!found) throw new ApiError(503, 'Profile photos are not available in this installation.');
  return found;
}

const TOO_LARGE = 'The photo must be smaller than 500 KB.';
const WRONG_TYPE = 'Choose a JPG, PNG or WebP image.';

/** The request's bytes, refused past `limit` before or while reading. */
async function bytesOf(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new ApiError(413, TOO_LARGE);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, WRONG_TYPE);
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError(413, TOO_LARGE);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const target = bucket();
    const image = await bytesOf(request, AVATAR_MAX_BYTES);
    const type = avatarType(image);
    if (!type) throw new ApiError(415, WRONG_TYPE);
    await target.put(avatarKey(user.id), image, { httpMetadata: { contentType: type } });
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await bucket().delete(avatarKey(user.id));
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
