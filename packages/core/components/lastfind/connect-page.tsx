import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { currentUser, requireActor, workspaceChoices } from '@/lib/server/auth';
import { describeAuthorization } from '@/lib/server/api-access';
import { errorLocale, knownApiMessage, localizeApiError } from '@/lib/server/errors-i18n';
import { ConnectConsent } from './connect-consent';

export const connectMetadata = {
  title: 'Connect an AI app',
  robots: { index: false, follow: false },
};

export type ConnectSearchParams = Record<string, string | string[] | undefined>;

/** The query string as the client sent it (repeated parameters kept, so the validation can refuse them). */
export function connectQuery(query: ConnectSearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) for (const item of [value].flat()) if (item !== undefined) params.append(key, item);
  return params;
}

/**
 * `GET /app/connect`: the OAuth consent screen (the authorization endpoint the well-known metadata names). Signed out,
 * it shows the edition's own sign-in, which returns here with the same query. The request is validated before anything
 * is shown; an invalid one is an error page, never a redirect.
 */
export async function ConnectPage({ query, signIn }: { query: URLSearchParams; signIn: ReactNode }) {
  if (!(await currentUser())) return signIn;
  const [request, actor, cookie] = await Promise.all([
    describeAuthorization(query),
    requireActor(),
    headers().then((list) => list.get('cookie')),
  ]);
  // The validation's reasons are written to be shown: translated when the catalog has them, never swapped for a generic line.
  const view = request.ok || !knownApiMessage(request.message) ? request : { ...request, message: localizeApiError(request.message, errorLocale(cookie)) };
  return <ConnectConsent request={view} workspaces={(await workspaceChoices(actor)) ?? null} role={actor.role} email={actor.email} />;
}
