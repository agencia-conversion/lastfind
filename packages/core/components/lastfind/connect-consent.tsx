'use client';
import { useId, useState, type FormEvent } from 'react';
import { MonitorSmartphone, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { SelectField } from '@/components/ui/select';
import { EmptyState } from '@/components/analytics/shared';
import { LastfindLogo } from '@/components/lastfind/lastfind-logo';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { requestJson } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { LanguageMenu } from '@/components/lastfind/public-menu';
import type { WorkspaceChoice, WorkspaceRole } from '@/lib/types';
import type { AuthorizationView } from '@/lib/server/api-access';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Where the browser goes after the decision, as a person reads it: the host, or the app's own scheme. */
export function redirectTarget(uri: string): { label: string; loopback: boolean } {
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:' || url.protocol === 'http:') return { label: url.host, loopback: LOOPBACK.has(url.hostname) };
    return { label: `${url.protocol}//${url.host}`, loopback: false };
  } catch {
    return { label: uri, loopback: false };
  }
}
const canWrite = (role: WorkspaceRole | undefined) => role === 'owner' || role === 'admin' || role === 'member';

export function ConnectConsent({
  request,
  workspaces,
  role,
  email,
}: {
  request: AuthorizationView;
  /** Cloud: the account's workspaces. Null in the independent installation, which has one. */
  workspaces: WorkspaceChoice[] | null;
  role: WorkspaceRole;
  email: string;
}) {
  const { locale, setLocale } = useI18n();
  const l = (en: string, pt: string) => (locale === 'en' ? en : pt);
  const id = useId();
  const current = workspaces?.find((item) => item.current) ?? workspaces?.[0];
  const [workspace, setWorkspace] = useState(current?.id ?? '');
  const [write, setWrite] = useState(request.ok && request.scope.split(' ').includes('lastfind:write'));
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState('');
  const chosenRole = !workspaces ? role : workspace ? workspaces.find((item) => item.id === workspace)?.role : workspaces.some((item) => canWrite(item.role)) ? 'member' : 'viewer';
  const writable = canWrite(chosenRole);

  const decide = async (decision: 'approve' | 'deny', event?: FormEvent) => {
    event?.preventDefault();
    if (!request.ok || busy) return;
    setBusy(decision);
    setError('');
    try {
      const { redirect } = await requestJson<{ redirect: string }>('/oauth/authorize', 'POST', {
        ...request.params,
        decision,
        scope: write && writable ? 'lastfind:read lastfind:write' : 'lastfind:read',
        workspace_id: workspaces ? workspace || null : null,
      });
      window.location.assign(redirect);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  };

  const target = request.ok ? redirectTarget(request.redirectUri) : null;
  return (
    <main className="mx-auto grid w-full max-w-xl gap-6 px-5 py-10 text-body">
      <div className="flex items-center justify-between gap-4">
        <a href="/app" aria-label={l('Lastfind, open the app', 'Lastfind, abrir o app')}>
          <LastfindLogo style={{ height: 36, width: 114 }} />
        </a>
        <LanguageMenu locale={locale} instance="page" onSelect={setLocale} />
      </div>
      {!request.ok ? (
        <SectionCard>
          <EmptyState
            frame="bare"
            tone="error"
            title={l('This connection request cannot be used.', 'Este pedido de conexão não pode ser usado.')}
            description={`${request.message} ${l('Nothing was shared. Go back to the app and connect again.', 'Nada foi compartilhado. Volte ao app e conecte de novo.')}`}
            action={<Button variant="outline" nativeButton={false} render={<a href="/docs/ai-apps" aria-label={l('How to connect', 'Como conectar')} />}>{l('How to connect', 'Como conectar')}</Button>}
          />
        </SectionCard>
      ) : (
        <SectionCard
          titleId={`${id}-title`}
          title={l(`${request.client.name} wants to access your Lastfind`, `${request.client.name} quer acessar seu Lastfind`)}
          description={l(`Signed in as ${email}. The app acts as you, within what you allow here.`, `Você entrou como ${email}. O app age como você, dentro do que você permitir aqui.`)}
        >
          <form id={`${id}-form`} className="grid gap-5 px-5 pb-5" onSubmit={(event) => void decide('approve', event)}>
            <div className="flex flex-wrap items-center gap-2">
              {request.client.verifiedHost
                ? <TagBadge tone="success" title={l('The app published its details on this domain.', 'O app publicou seus dados neste domínio.')}>{l(`Verified: ${request.client.verifiedHost}`, `Verificado: ${request.client.verifiedHost}`)}</TagBadge>
                : <TagBadge tone="quiet">{l('Unverified app', 'App não verificado')}</TagBadge>}
              <span className="text-muted-foreground [overflow-wrap:anywhere]">{l(`Returns to ${target?.label}`, `Volta para ${target?.label}`)}</span>
            </div>
            {!request.client.verifiedHost && (
              <Note icon={<ShieldAlert size={16} />} className="px-0 py-0">
                {l('Lastfind could not check who made this app; its name is what it says about itself. Continue only if you started this connection.', 'O Lastfind não conseguiu conferir quem fez este app; o nome é o que ele diz de si mesmo. Continue só se foi você quem iniciou esta conexão.')}
              </Note>
            )}
            {target?.loopback && (
              <Note icon={<MonitorSmartphone size={16} />} className="px-0 py-0">
                {l('This app runs on your own computer (localhost). Approve only if you just started it yourself.', 'Este app roda no seu próprio computador (localhost). Aprove só se você acabou de iniciá-lo.')}
              </Note>
            )}
            <FieldGroup className="gap-5">
              {workspaces && (
                <Field>
                  <FieldLabel htmlFor={`${id}-workspace`}>{l('Workspace', 'Workspace')}</FieldLabel>
                  <SelectField id={`${id}-workspace`} value={workspace} disabled={!!busy} onValueChange={setWorkspace} options={[...workspaces.map((item) => ({ value: item.id, label: item.name })), { value: '', label: l('All my workspaces', 'Todos os meus workspaces') }]} />
                  <FieldDescription>{l('The app sees only the projects of this workspace.', 'O app vê só os projetos deste workspace.')}</FieldDescription>
                </Field>
              )}
              <FieldSet>
                <FieldLegend variant="label">{l('Permissions', 'Permissões')}</FieldLegend>
                <Field orientation="horizontal" data-disabled>
                  <Checkbox id={`${id}-read`} checked disabled />
                  <FieldContent>
                    <FieldLabel htmlFor={`${id}-read`}>{l('Read your reports', 'Ler seus relatórios')}</FieldLabel>
                    <FieldDescription>{l('Projects, prompts, answers, brands, sources and Semantic Branding. Always included.', 'Projetos, prompts, respostas, marcas, fontes e Semantic Branding. Sempre incluído.')}</FieldDescription>
                  </FieldContent>
                </Field>
                <Field orientation="horizontal" data-disabled={!writable || undefined}>
                  <Checkbox id={`${id}-write`} checked={write && writable} disabled={!!busy || !writable} onCheckedChange={(checked) => setWrite(Boolean(checked))} />
                  <FieldContent>
                    <FieldLabel htmlFor={`${id}-write`}>{l('Allow changes', 'Permitir alterações')}</FieldLabel>
                    <FieldDescription>
                      {writable
                        ? l('Create, edit, pause and archive prompts and topics, and confirm or reject brands. New prompts are monitored like the ones you add in the app.', 'Criar, editar, pausar e arquivar prompts e tópicos, e confirmar ou recusar marcas. Prompts novos são monitorados como os que você adiciona no app.')
                        : l('Viewers can only read in this workspace.', 'Leitores só podem ler neste workspace.')}
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldSet>
            </FieldGroup>
            <p className="text-muted-foreground">
              {l('Never: billing, members, project settings or administration. You can disconnect it any time in Settings > AI apps.', 'Nunca: cobrança, membros, configurações do projeto ou administração. Você pode desconectar quando quiser em Configurações > Apps de IA.')}
            </p>
            {error && <Note tone="danger" className="px-0 py-0">{error}</Note>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" disabled={!!busy} pending={busy === 'deny'} pendingLabel={l('Denying…', 'Recusando…')} onClick={() => void decide('deny')}>{l('Deny', 'Recusar')}</Button>
              <Button type="submit" disabled={!!busy} pending={busy === 'approve'} pendingLabel={l('Approving…', 'Aprovando…')}>{l('Approve', 'Aprovar')}</Button>
            </div>
          </form>
        </SectionCard>
      )}
    </main>
  );
}
