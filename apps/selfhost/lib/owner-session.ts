import { SignJWT, jwtVerify } from 'jose';
export const OWNER_SESSION_COOKIE = '__Host-lastfind-session';
export async function accessKeyHash(key: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)),
  );
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function createOwnerSession(
  secret: string,
  credentialHash: string,
  origin: string,
) {
  if (secret.length < 32) throw new Error('Session secret is not configured');
  return new SignJWT({ credential: credentialHash })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('owner:local')
    .setIssuer(origin)
    .setAudience('lastfind-owner')
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}
export async function verifyOwnerSession(
  token: string,
  secret: string,
  credentialHash: string,
  origin: string,
) {
  if (secret.length < 32 || !/^[a-f0-9]{64}$/.test(credentialHash))
    return false;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { algorithms: ['HS256'], issuer: origin, audience: 'lastfind-owner' },
    );
    return (
      payload.sub === 'owner:local' && payload.credential === credentialHash
    );
  } catch {
    return false;
  }
}
