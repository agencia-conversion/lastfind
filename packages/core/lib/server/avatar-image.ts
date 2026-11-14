/**
 * The account photo: the one the person uploaded (Settings > My profile, kept in the installation's private bucket), else
 * Gravatar, queried only from the server (the browser never receives an email hash), else the initials.
 */
const cache = new Map<
  string,
  { image: Uint8Array | null; type: string; expires: number }
>();
const MAX_ENTRIES = 128;
const MAX_BYTES = 256_000;

export async function avatarImage(
  email: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<{ image: Uint8Array; type: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  const key = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(normalized),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const saved = cache.get(key);
  if (saved && saved.expires > now)
    return saved.image ? { image: saved.image, type: saved.type } : null;

  let image: Uint8Array | null = null;
  let type = '';
  try {
    const response = await fetcher(
      `https://www.gravatar.com/avatar/${key}?s=80&r=g&d=404`,
      {
        signal: AbortSignal.timeout(3000),
        headers: { Accept: 'image/webp,image/png,image/jpeg,image/gif' },
      },
    );
    type = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
    if (
      response.ok &&
      ['image/webp', 'image/png', 'image/jpeg', 'image/gif'].includes(type) &&
      Number(response.headers.get('content-length') ?? 0) <= MAX_BYTES
    ) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 0 && bytes.length <= MAX_BYTES) image = bytes;
    }
  } catch {
    // Offline selfhost and upstream errors fall back to initials.
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, {
    image,
    type,
    expires: now + (image ? 24 * 60 * 60_000 : 60 * 60_000),
  });
  return image ? { image, type } : null;
}

export function resetAvatarImageCache() {
  cache.clear();
}

/** An uploaded photo's largest size: the app sends a 256px crop (about 20 KB in WebP, at most a few hundred in PNG). */
export const AVATAR_MAX_BYTES = 512_000;
/** Where a person's uploaded photo lives in the private bucket (both editions have it: RAW_RESPONSES). */
export const avatarKey = (userId: string) => `avatars/v1/${encodeURIComponent(userId)}`;
/** The image type read from the bytes themselves, never from the request: PNG, JPEG or WebP, else null (SVG, HTML, anything). */
export function avatarType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const starts = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (bytes.length >= 8 && starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (bytes.length >= 3 && starts(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (bytes.length >= 12 && starts(0, 0x52, 0x49, 0x46, 0x46) && starts(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

export async function avatarResponse(
  readUser: () => Promise<{ id?: string; email: string } | null>,
  fetcher: typeof fetch = fetch,
  /** The person's uploaded photo, when there is one (the route reads the bucket). */
  readUploaded: (userId: string) => Promise<{ image: Uint8Array; type: string } | null> = async () => null,
) {
  const headers = {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
  };
  try {
    const user = await readUser();
    if (!user) return new Response(null, { status: 401, headers });
    const own = user.id ? await readUploaded(user.id) : null;
    const avatar = own ?? (await avatarImage(user.email, fetcher));
    // No photo is the usual case, not an error: an empty answer lets the initials show without a 404 in the console.
    if (!avatar) return new Response(null, { status: 204, headers });
    // The profile reads where the photo came from: only an uploaded one can be removed there.
    return new Response(avatar.image as BodyInit, {
      headers: { ...headers, 'Content-Type': avatar.type, 'X-Avatar-Source': own ? 'upload' : 'gravatar' },
    });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
