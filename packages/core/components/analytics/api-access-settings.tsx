'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Hint } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupCopy, InputGroupInput, InputGroupTextarea } from '@/components/ui/input-group';
import { SelectField } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast';
import { DataTable, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { mcpSnippets, useOrigin } from '@/components/lastfind/mcp-docs';
import { useI18n } from '@/lib/i18n';
import type { requestJson } from '@/lib/client';
import type { WorkspaceChoice, WorkspaceRole } from '@/lib/types';
import type { AccessOverview, AuditRow as ApiAuditRow, CredentialView, ScopeValue } from '@/lib/server/api-access';
import { EmptyState } from './shared';

type Translate = (en: string, pt: string) => string;

// `/api/tokens` answers `AccessOverview`; only types cross into the browser.
type ApiCredential = CredentialView;
const READ_ONLY: ScopeValue = 'lastfind:read';
const READ_WRITE: ScopeValue = 'lastfind:read lastfind:write';

const canWrite = (role: WorkspaceRole | undefined) => role === 'owner' || role === 'admin' || role === 'member';
const writes = (scope: string) => scope.split(/\s+/).includes('lastfind:write');

export function PermissionBadge({ scope, t }: { scope: string; t: Translate }) {
  return writes(scope)
    ? <TagBadge tone="warning" title={t('Reads reports and can change prompts, topics and brand decisions.', 'Lê relatórios e pode alterar prompts, tópicos e decisões de marca.')}>{t('Read and write', 'Leitura e escrita')}</TagBadge>
    : <TagBadge tone="neutral" title={t('Reads reports only. Changes nothing.', 'Só lê relatórios. Não altera nada.')}>{t('Read only', 'Só leitura')}</TagBadge>;
}

const TOOL_LABELS: Record<string, [string, string]> = {
  create_prompts: ['Created prompts', 'Criou prompts'],
  update_prompt: ['Edited a prompt', 'Editou um prompt'],
  set_prompt_status: ['Changed prompt status', 'Mudou o status de prompts'],
  organize_prompts: ['Organized prompts', 'Organizou prompts'],
  create_topic: ['Created a topic', 'Criou um tópico'],
  update_topic: ['Edited a topic', 'Editou um tópico'],
  delete_topic: ['Deleted a topic', 'Excluiu um tópico'],
  decide_brand: ['Decided on a brand', 'Decidiu sobre uma marca'],
};

/** A copyable read-only field: a token, the server address or a config snippet. A long one line ends in an ellipsis (never cut
 * mid-word at the edge on a phone); focus selects it whole and Copy takes it all. */
export function CopyField({ id, label, value, multiline = false, t }: { id: string; label: string; value: string; multiline?: boolean; t: Translate }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup className={multiline ? undefined : 'max-sm:h-10'}>
        {multiline
          ? <InputGroupTextarea id={id} readOnly value={value} rows={Math.min(value.split('\n').length, 9)} className="font-mono text-caption" onFocus={(event) => event.currentTarget.select()} />
          : <InputGroupInput id={id} readOnly value={value} className="font-mono text-ellipsis" onFocus={(event) => event.currentTarget.select()} />}
        <InputGroupAddon align={multiline ? 'block-end' : 'inline-end'} className={multiline ? 'justify-end' : undefined}>
          <InputGroupCopy value={value} label={t('Copy', 'Copiar')} copiedLabel={t('Copied', 'Copiado')} aria-describedby={id} />
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}

/** Where to paste the address (and the token, when there is one), per app. */
export function McpSetupTabs({ url, token, t }: { url: string; token?: string; t: Translate }) {
  const id = useId();
  const snippets = mcpSnippets(url, t, token);
  const [tab, setTab] = useState(snippets[0].id);
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
      <TabsList variant="line" aria-label={t('Setup by app', 'Configuração por app')}>
        {snippets.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
      </TabsList>
      {snippets.map((item) => (
        <TabsContent key={item.id} value={item.id} className="pt-3">
          <CopyField id={`${id}-${item.id}`} label={item.where} value={item.code} multiline t={t} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

type Draft = { name: string; workspace: string; write: boolean; days: '30' | '90' | '365' };

/** New personal access token: the form, then the token shown once with the address and the setup per app. */
export function NewTokenDialog({
  open,
  onOpenChange,
  workspaces,
  role,
  onCreate,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Cloud: the account's workspaces (the field is hidden in the independent installation, which has one). */
  workspaces?: WorkspaceChoice[];
  role?: WorkspaceRole;
  onCreate: (body: { name: string; workspace_id: string | null; scope: ScopeValue; days: number }) => Promise<{ token: string } | string>;
  t: Translate;
}) {
  const id = useId();
  const origin = useOrigin();
  const current = workspaces?.find((item) => item.current) ?? workspaces?.[0];
  // Mounted per opening (the caller renders it while open), so every token starts from a clean form.
  const [draft, setDraft] = useState<Draft>({ name: '', workspace: current?.id ?? '', write: false, days: '90' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const chosenRole = !workspaces ? role : draft.workspace ? workspaces.find((item) => item.id === draft.workspace)?.role : workspaces.some((item) => canWrite(item.role)) ? 'member' : 'viewer';
  const writable = canWrite(chosenRole);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return setError(t('Name the token, for example the app that will use it.', 'Dê um nome ao token, por exemplo o app que vai usá-lo.'));
    setBusy(true);
    const result = await onCreate({ name, workspace_id: workspaces ? draft.workspace || null : null, scope: draft.write && writable ? READ_WRITE : READ_ONLY, days: Number(draft.days) }).finally(() => setBusy(false));
    if (typeof result === 'string') setError(result);
    else setToken(result.token);
  };
  const url = `${origin}/mcp`;
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{token ? t('Copy your token', 'Copie seu token') : t('New personal access token', 'Novo token de acesso pessoal')}</DialogTitle>
          <DialogDescription>
            {token
              ? t('Paste it in the app with the server address below.', 'Cole no app junto com o endereço do servidor abaixo.')
              : t('For apps that cannot sign in to Lastfind on their own. It acts as you, within the permission you choose.', 'Para apps que não conseguem entrar no Lastfind sozinhos. Ele age como você, dentro da permissão que você escolher.')}
          </DialogDescription>
        </DialogHeader>
        {token ? (
          <FieldGroup className="gap-5">
            <Note icon={<KeyRound size={16} />} className="px-0 py-0">
              {t('This is the only time the token is shown. Store it like a password; anyone with it reads your reports.', 'Esta é a única vez que o token aparece. Guarde como uma senha; quem tiver o token lê seus relatórios.')}
            </Note>
            <CopyField id={`${id}-token`} label={t('Token', 'Token')} value={token} t={t} />
            <CopyField id={`${id}-url`} label={t('Server address', 'Endereço do servidor')} value={url} t={t} />
            <McpSetupTabs url={url} token={token} t={t} />
          </FieldGroup>
        ) : (
          <form id={`${id}-form`} onSubmit={(event) => void submit(event)} noValidate>
            <FieldGroup className="gap-5">
              <Field data-invalid={Boolean(error) || undefined}>
                <FieldLabel htmlFor={`${id}-name`}>{t('Name', 'Nome')}</FieldLabel>
                <Input
                  id={`${id}-name`}
                  value={draft.name}
                  maxLength={100}
                  autoComplete="off"
                  disabled={busy}
                  placeholder={t('Cursor on my laptop', 'Cursor no meu notebook')}
                  aria-invalid={Boolean(error) || undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setError(''); }}
                />
                {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
              </Field>
              {workspaces && (
                <Field>
                  <FieldLabel htmlFor={`${id}-workspace`}>{t('Workspace', 'Workspace')}</FieldLabel>
                  <SelectField id={`${id}-workspace`} value={draft.workspace} disabled={busy} onValueChange={(workspace) => setDraft({ ...draft, workspace })} options={[...workspaces.map((item) => ({ value: item.id, label: item.name })), { value: '', label: t('All my workspaces', 'Todos os meus workspaces') }]} />
                  <FieldDescription>{t('The token reads only the projects of this workspace.', 'O token lê só os projetos deste workspace.')}</FieldDescription>
                </Field>
              )}
              <Field orientation="horizontal" data-disabled={!writable || undefined}>
                <Checkbox id={`${id}-write`} checked={draft.write && writable} disabled={busy || !writable} onCheckedChange={(checked) => setDraft({ ...draft, write: Boolean(checked) })} />
                <FieldContent>
                  <FieldLabel htmlFor={`${id}-write`}>{t('Allow changes', 'Permitir alterações')}</FieldLabel>
                  <FieldDescription>
                    {writable
                      ? t('Create, edit, pause and archive prompts and topics, and confirm or reject brands. Reading is always allowed.', 'Criar, editar, pausar e arquivar prompts e tópicos, e confirmar ou recusar marcas. Ler é sempre permitido.')
                      : t('Viewers can only read. Ask an admin to make you a member to allow changes.', 'Leitores só podem ler. Peça a um admin para torná-lo membro para permitir alterações.')}
                  </FieldDescription>
                </FieldContent>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-days`}>{t('Expires in', 'Expira em')}</FieldLabel>
                <SelectField<Draft['days']>
                  id={`${id}-days`}
                  value={draft.days}
                  disabled={busy}
                  onValueChange={(days) => setDraft({ ...draft, days })}
                  options={[
                    { value: '30', label: t('30 days', '30 dias') },
                    { value: '90', label: t('90 days', '90 dias') },
                    { value: '365', label: t('1 year', '1 ano') },
                  ]}
                />
              </Field>
            </FieldGroup>
          </form>
        )}
        <DialogFooter>
          {token ? (
            <Button type="button" onClick={() => onOpenChange(false)}>{t('Done', 'Concluir')}</Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t('Cancel', 'Cancelar')}</Button>
              <Button type="submit" form={`${id}-form`} pending={busy} pendingLabel={t('Creating…', 'Criando…')}>{t('Create token', 'Criar token')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings > AI apps: the apps connected through OAuth, personal access tokens and the changes they made. */
export function ApiAccessSettings({
  request,
  t,
  workspaces,
  role,
}: {
  request: typeof requestJson;
  t: Translate;
  workspaces?: WorkspaceChoice[];
  role?: WorkspaceRole;
}) {
  const { locale } = useI18n();
  const id = useId();
  const origin = useOrigin();
  const [data, setData] = useState<AccessOverview | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<ApiCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const load = () => setGeneration((value) => value + 1);
  useEffect(() => {
    let live = true;
    request<AccessOverview>('/api/tokens').then(
      (next) => { if (live) { setData(next); setError(''); } },
      (cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); },
    );
    return () => { live = false; };
  }, [request, generation]);

  const date = (value: string | null, time = false) =>
    value ? new Intl.DateTimeFormat(locale, time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value)) : null;
  const workspaceName = (item: ApiCredential) => item.workspace?.name ?? (workspaces ? t('All my workspaces', 'Todos os meus workspaces') : t('This installation', 'Esta instalação'));
  const lastUsed = (item: ApiCredential) => date(item.last_used_at, true) ?? <span className="text-muted-foreground">{t('Never used', 'Nunca usado')}</span>;
  const apps = data?.credentials.filter((item) => item.kind === 'oauth') ?? [];
  const tokens = data?.credentials.filter((item) => item.kind === 'pat') ?? [];
  const limit = data?.limit ?? 20;
  const full = tokens.length >= limit;

  const remove = async (item: ApiCredential) => {
    setBusy(true);
    try {
      await request('/api/tokens', 'DELETE', { id: item.id });
      toast.add({ title: item.kind === 'pat' ? t(`Token “${item.name}” was revoked.`, `O token “${item.name}” foi revogado.`) : t(`${item.client?.name ?? item.name} was disconnected.`, `${item.client?.name ?? item.name} foi desconectado.`), type: 'success' });
      load();
    } catch (cause) {
      toast.add({ title: cause instanceof Error ? cause.message : String(cause), type: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const create = async (body: { name: string; workspace_id: string | null; scope: ScopeValue; days: number }) => {
    try {
      const result = await request<{ token: string }>('/api/tokens', 'POST', body);
      load();
      return { token: result.token };
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };

  const actionColumn: DataColumn<ApiCredential> = {
    key: 'actions',
    header: <span className="sr-only">{t('Actions', 'Ações')}</span>,
    align: 'end',
    mobile: 'actions',
    cell: (item) => (
      <Button variant="outline" disabled={busy} onClick={() => setRemoving(item)} aria-label={`${item.kind === 'pat' ? t('Revoke', 'Revogar') : t('Disconnect', 'Desconectar')} ${item.client?.name ?? item.name}`}>
        {item.kind === 'pat' ? t('Revoke', 'Revogar') : t('Disconnect', 'Desconectar')}
      </Button>
    ),
  };
  const shared: DataColumn<ApiCredential>[] = [
    { key: 'workspace', header: t('Workspace', 'Workspace'), label: t('Workspace', 'Workspace'), cell: workspaceName },
    { key: 'scope', header: t('Permission', 'Permissão'), label: t('Permission', 'Permissão'), cell: (item) => <PermissionBadge scope={item.scope} t={t} /> },
  ];
  const appColumns: DataColumn<ApiCredential>[] = [
    {
      key: 'app',
      header: t('App', 'App'),
      mobile: 'title',
      cell: (item) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{item.client?.name ?? item.name}</span>
          {item.client?.verifiedHost
            ? <TagBadge tone="success" title={t('The app published its details on this domain.', 'O app publicou seus dados neste domínio.')}>{item.client.verifiedHost}</TagBadge>
            : <TagBadge tone="quiet" title={t('The app registered itself; its name was not checked against a domain.', 'O app se registrou sozinho; o nome não foi conferido com um domínio.')}>{t('Unverified app', 'App não verificado')}</TagBadge>}
        </span>
      ),
    },
    ...shared,
    { key: 'created', header: t('Connected on', 'Conectado em'), label: t('Connected on', 'Conectado em'), cell: (item) => date(item.created_at), sortValue: (item) => item.created_at },
    { key: 'used', header: t('Last used', 'Último uso'), label: t('Last used', 'Último uso'), cell: lastUsed, sortValue: (item) => item.last_used_at },
    actionColumn,
  ];
  const tokenColumns: DataColumn<ApiCredential>[] = [
    {
      key: 'name',
      header: t('Name', 'Nome'),
      mobile: 'title',
      cell: (item) => (
        <span className="block min-w-0 truncate">
          {item.name}
          {item.hint && <span className="text-muted-foreground"> {t(`ends in ${item.hint}`, `termina em ${item.hint}`)}</span>}
        </span>
      ),
    },
    ...shared,
    {
      key: 'expires',
      header: t('Expires', 'Expira'),
      label: t('Expires', 'Expira'),
      sortValue: (item) => item.expires_at,
      cell: (item) => item.expires_at && Date.parse(item.expires_at) <= Date.now() ? <TagBadge tone="danger">{t('Expired', 'Expirado')}</TagBadge> : date(item.expires_at),
    },
    { key: 'used', header: t('Last used', 'Último uso'), label: t('Last used', 'Último uso'), cell: lastUsed, sortValue: (item) => item.last_used_at },
    actionColumn,
  ];
  const auditColumns: DataColumn<ApiAuditRow>[] = [
    { key: 'at', header: t('When', 'Quando'), mobile: 'title', cell: (row) => date(row.at, true) },
    { key: 'credential', header: t('App or token', 'App ou token'), label: t('App or token', 'App ou token'), cell: (row) => row.credential_name ?? <span className="text-muted-foreground">{t('Removed', 'Removido')}</span> },
    { key: 'tool', header: t('Action', 'Ação'), label: t('Action', 'Ação'), cell: (row) => (TOOL_LABELS[row.tool] ? t(...TOOL_LABELS[row.tool]) : row.tool) },
    {
      key: 'outcome',
      header: t('Result', 'Resultado'),
      label: t('Result', 'Resultado'),
      cell: (row) => row.outcome === 'ok'
        ? <TagBadge tone="success">{t('Done', 'Feito')}</TagBadge>
        : row.outcome === 'denied'
        ? <TagBadge tone="warning" title={t('The permission or role did not allow it.', 'A permissão ou o papel não permitia.')}>{t('Refused', 'Recusado')}</TagBadge>
        : <TagBadge tone="danger">{t('Failed', 'Falhou')}</TagBadge>,
    },
  ];

  if (error && !data) {
    return (
      <SectionCard>
        <EmptyState frame="bare" tone="error" title={t('Could not load your AI apps and tokens.', 'Não foi possível carregar seus apps de IA e tokens.')} description={error} onRetry={() => { setError(''); load(); }} />
      </SectionCard>
    );
  }
  return (
    <div className="min-w-0 space-y-6">
      <SectionCard
        title={t('Connected apps', 'Apps conectados')}
        description={t('Claude, ChatGPT, Cursor and other apps you approved. Each one acts as you, within the permission you gave it.', 'Claude, ChatGPT, Cursor e outros apps que você aprovou. Cada um age como você, dentro da permissão que você deu.')}
      >
        <div className="px-5 pb-4">
          <CopyField id={`${id}-url`} label={t('Server address', 'Endereço do servidor')} value={origin ? `${origin}/mcp` : ''} t={t} />
        </div>
        {data && !apps.length ? (
          <EmptyState
            frame="bare"
            title={t('No app connected yet.', 'Nenhum app conectado ainda.')}
            description={t('Add the server address to Claude, ChatGPT or Cursor. The app opens Lastfind so you can approve it, and it appears here.', 'Adicione o endereço do servidor ao Claude, ChatGPT ou Cursor. O app abre o Lastfind para você aprovar, e ele aparece aqui.')}
            action={<Button variant="outline" nativeButton={false} render={<a href="/docs/ai-apps" aria-label={t('How to connect', 'Como conectar')} />}>{t('How to connect', 'Como conectar')}</Button>}
          />
        ) : (
          <div className="live-table-scroll">
            <DataTable singleLine ariaLabel={t('Connected apps', 'Apps conectados')} loading={!data ? 2 : undefined} rows={apps} rowKey={(item) => item.id} columns={appColumns} />
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t('Personal access tokens', 'Tokens de acesso pessoal')}
        description={t(`For apps that do not sign in on their own. Up to ${limit} at a time; each one expires.`, `Para apps que não entram sozinhos. Até ${limit} ao mesmo tempo; cada um expira.`)}
        action={
          <Hint text={full ? t('Revoke a token to create another.', 'Revogue um token para criar outro.') : undefined}><span className="inline-flex">
            <Button disabled={!data || full} onClick={() => setCreating(true)}>{t('New token', 'Novo token')}</Button>
          </span></Hint>
        }
      >
        {data && !tokens.length ? (
          <EmptyState frame="bare" title={t('No personal access tokens.', 'Nenhum token de acesso pessoal.')} description={t('Most apps sign in with your Lastfind account. Create a token only for one that asks for it.', 'A maioria dos apps entra com sua conta do Lastfind. Crie um token só para um app que peça.')} />
        ) : (
          <div className="live-table-scroll">
            <DataTable singleLine ariaLabel={t('Personal access tokens', 'Tokens de acesso pessoal')} loading={!data ? 2 : undefined} rows={tokens} rowKey={(item) => item.id} columns={tokenColumns} />
          </div>
        )}
      </SectionCard>

      <SectionCard title={t('Recent actions', 'Ações recentes')} description={t('The last 20 changes made through your apps and tokens. Reading is not listed.', 'As últimas 20 alterações feitas pelos seus apps e tokens. Leituras não aparecem.')}>
        {data && !data.audit.length ? (
          <EmptyState frame="bare" title={t('No changes made through AI apps yet.', 'Nenhuma alteração feita por apps de IA ainda.')} />
        ) : (
          <div className="live-table-scroll">
            <DataTable singleLine ariaLabel={t('Recent actions', 'Ações recentes')} loading={!data ? 3 : undefined} rows={data?.audit ?? []} rowKey={(row) => String(row.id)} columns={auditColumns} />
          </div>
        )}
      </SectionCard>

      {creating && <NewTokenDialog open onOpenChange={setCreating} workspaces={workspaces} role={role} onCreate={create} t={t} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={removing?.kind === 'pat' ? t('Revoke this token?', 'Revogar este token?') : t(`Disconnect ${removing?.client?.name ?? removing?.name ?? ''}?`, `Desconectar ${removing?.client?.name ?? removing?.name ?? ''}?`)}
        description={removing?.kind === 'pat'
          ? t(`Apps using “${removing?.name ?? ''}” lose access right away. This cannot be undone.`, `Apps que usam “${removing?.name ?? ''}” perdem o acesso na hora. Não dá para desfazer.`)
          : t('The app loses access right away. You can connect it again later.', 'O app perde o acesso na hora. Você pode conectar de novo depois.')}
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={removing?.kind === 'pat' ? t('Revoke', 'Revogar') : t('Disconnect', 'Desconectar')}
        destructive
        onConfirm={() => { const item = removing; setRemoving(null); if (item) void remove(item); }}
      />
    </div>
  );
}
