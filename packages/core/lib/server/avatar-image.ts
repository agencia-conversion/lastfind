/** Gravatar is queried only from the server. The browser never receives an email hash. */
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

export async function avatarResponse(
  readUser: () => Promise<{ email: string } | null>,
  fetcher: typeof fetch = fetch,
) {
  const headers = {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
  };
  try {
    const user = await readUser();
    if (!user) return new Response(null, { status: 401, headers });
    const avatar = await avatarImage(user.email, fetcher);
    if (!avatar) return new Response(null, { status: 404, headers });
    return new Response(avatar.image as BodyInit, {
      headers: { ...headers, 'Content-Type': avatar.type },
    });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
