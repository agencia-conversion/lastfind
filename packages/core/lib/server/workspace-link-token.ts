// A `?workspace=` app link is followed only with this signature, minted by our own emails: an HMAC (SESSION_SECRET)
// over the recipient account, the workspace owner and an expiry. A plain or forged link cannot move anyone.
// An invitation goes to someone who may have no account yet: it names the account `inviteLinkAccount(email)`,
// the verified address they must sign in with.
const encoder = new TextEncoder();
const LINK_DAYS = 30;
async function signature(secret: string, account: string, owner: string, expires: number) {
  if (encoder.encode(secret).length < 32) throw new Error('Workspace links are not configured.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(`lastfind-workspace-link-v1\n${account}\n${owner}\n${expires}`));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export const inviteLinkAccount = (email: string) => `email:${email.trim().toLowerCase()}`;
/** `<owner>.<expires>.<signature>`: the value of `?workspace=` for this account's email. */
export async function workspaceLinkToken(secret: string, account: string, owner: string, now = Date.now()) {
  const expires = Math.floor(now / 1000) + LINK_DAYS * 86400;
  return `${owner}.${expires}.${await signature(secret, account, owner, expires)}`;
}
/** The owner id a valid, unexpired token names for this account, else null. */
export async function readWorkspaceLinkToken(secret: string, account: string, token: string, now = Date.now()) {
  const match = /^([\w:-]{1,128})\.(\d{1,12})\.([\w-]{43})$/.exec(token);
  if (!match || Number(match[2]) * 1000 <= now) return null;
  const expected = await signature(secret, account, match[1], Number(match[2]));
  let difference = expected.length ^ match[3].length;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ match[3].charCodeAt(index);
  return difference ? null : match[1];
}
