'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { toast } from '@/components/ui/toast';
import { DataTable, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { EmptyState } from './shared';
import type { requestJson } from '@/lib/client';
import type { WorkspaceRole } from '@/lib/types';
import { WORKSPACE_COOKIE } from '@/lib/workspace-link';

type Translate = (en: string, pt: string) => string;
type MemberRole = Exclude<WorkspaceRole, 'owner'>;
type Person = { email: string; role: WorkspaceRole; status: 'active' | 'invited' | 'declined' | 'expired'; name?: string };
/** An invitation waiting for the signed-in person's answer (GET /api/invitations, Cloud). */
export type Invitation = { workspace: string; name: string; role: MemberRole; inviter: string };
type Members = { role: WorkspaceRole; limit: number; owner: { email: string; name: string }; members: Person[] };

export const roleLabel = (role: WorkspaceRole, t: Translate) =>
  ({ owner: t('Owner', 'Responsável'), admin: t('Admin', 'Admin'), member: t('Member', 'Membro'), viewer: t('Viewer', 'Leitor') })[role];
const roleHelp = (role: MemberRole, t: Translate) =>
  ({
    admin: t('Everything a member does, plus inviting and removing members and viewers.', 'Tudo o que um membro faz, mais convidar e remover membros e leitores.'),
    member: t('Edits prompts, settings and brand decisions and refreshes analyses.', 'Edita prompts, configurações e decisões de marca e atualiza análises.'),
    viewer: t('Reads reports and exports CSV. Cannot change anything.', 'Lê relatórios e exporta CSV. Não altera nada.'),
  })[role];
/** Same rule as the server: the owner manages everyone; an admin, only members and viewers. */
export const assignableRoles = (actor: WorkspaceRole, current?: WorkspaceRole): MemberRole[] =>
  actor === 'owner' ? ['admin', 'member', 'viewer'] : actor === 'admin' && current !== 'admin' && current !== 'owner' ? ['member', 'viewer'] : [];

/** The invitation form. Presentational: the caller sends it (Settings > Members, or the catalog sample). */
export function InviteMemberDialog({
  open,
  onOpenChange,
  roles,
  onSubmit,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: MemberRole[];
  onSubmit: (email: string, role: MemberRole) => Promise<string | null>;
  t: Translate;
}) {
  const id = useId();
  const [email, setEmail] = useState('');
  // Mounted per opening (the caller renders it while open), so every invitation starts empty.
  const [role, setRole] = useState<MemberRole>(roles.includes('member') ? 'member' : (roles[0] ?? 'viewer'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t('Enter a valid email address.', 'Digite um endereço de email válido.'));
    setBusy(true);
    const failure = await onSubmit(email.trim(), role).finally(() => setBusy(false));
    if (failure) setError(failure);
    else onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Invite member', 'Convidar membro')}</DialogTitle>
          <DialogDescription>
            {t('They sign in with this email address; no password or link token is needed.', 'A pessoa entra com este endereço de email; não é preciso senha nem link especial.')}
          </DialogDescription>
        </DialogHeader>
        <form id={`${id}-form`} onSubmit={(event) => void submit(event)} noValidate>
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(error) || undefined}>
              <FieldLabel htmlFor={`${id}-email`}>{t('Email', 'Email')}</FieldLabel>
              <Input
                id={`${id}-email`}
                type="email"
                autoComplete="off"
                value={email}
                maxLength={254}
                disabled={busy}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                placeholder={t('name@company.com', 'nome@empresa.com.br')}
                onChange={(event) => { setEmail(event.target.value); setError(''); }}
              />
              {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-role`}>{t('Role', 'Papel')}</FieldLabel>
              <SelectField<MemberRole> id={`${id}-role`} value={role} disabled={busy} aria-describedby={`${id}-role-help`} onValueChange={setRole} options={roles.map((item) => ({ value: item, label: roleLabel(item, t) }))} />
              <FieldDescription id={`${id}-role-help`}>{roleHelp(role, t)}</FieldDescription>
            </Field>
            <Note>{t('Members see the project answers, sources and reports, and can export them as CSV.', 'Membros veem as respostas, fontes e relatórios do projeto e podem exportá-los em CSV.')}</Note>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{t('Cancel', 'Cancelar')}</Button>
          <Button type="submit" form={`${id}-form`} pending={busy} pendingLabel={t('Inviting…', 'Convidando…')}>{t('Send invitation', 'Enviar convite')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MembersSettings({ request, t, selfEmail }: { request: typeof requestJson; t: Translate; selfEmail: string }) {
  const [data, setData] = useState<Members | null>(null);
  const [error, setError] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const load = () => setGeneration((value) => value + 1);
  useEffect(() => {
    let live = true;
    request<Members>('/api/members').then(
      (next) => { if (live) { setData(next); setError(''); } },
      (cause) => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); },
    );
    return () => { live = false; };
  }, [request, generation]);

  const change = async (method: 'PATCH' | 'DELETE', payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      await request('/api/members', method, payload);
      toast.add({ title: done, type: 'success' });
      load();
    } catch (cause) {
      toast.add({ title: cause instanceof Error ? cause.message : String(cause), type: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const invite = async (email: string, role: MemberRole) => {
    try {
      const result = await request<{ emailSent: boolean; emailSkipped?: 'preview' | 'recent' }>('/api/members', 'POST', { email, role });
      toast.add(result.emailSent
        ? { title: t(`Invitation sent to ${email}.`, `Convite enviado para ${email}.`), type: 'success' }
        : result.emailSkipped === 'recent'
        ? { title: t(`${email} was already invited in the last 24 hours. The invitation is updated; the email is sent again only after that.`, `${email} já foi convidado nas últimas 24 horas. O convite foi atualizado; o email só é enviado de novo depois disso.`), type: 'info', timeout: 12_000 }
        : result.emailSkipped === 'preview'
        ? { title: t(`${email} was added. Test environment: invitations only go to the test addresses. In production, the email is sent normally.`, `${email} foi adicionado. Ambiente de teste: convites só vão para os endereços de teste. Em produção, o email é enviado normalmente.`), type: 'info', timeout: 12_000 }
        : { title: t(`${email} was added, but the invitation email could not be sent. Ask them to sign in with this address.`, `${email} foi adicionado, mas não foi possível enviar o email de convite. Peça para a pessoa entrar com este endereço.`), type: 'warning', timeout: 12_000 });
      load();
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };

  const role = data?.role ?? 'viewer';
  const people: Person[] = data ? [{ email: data.owner.email, name: data.owner.name, role: 'owner', status: 'active' }, ...data.members] : [];
  const canInvite = assignableRoles(role).length > 0;
  // A declined or expired invitation frees its place (the server counts the same way).
  const full = !!data && data.members.filter((person) => person.status === 'active' || person.status === 'invited').length >= data.limit;
  const columns: DataColumn<Person>[] = [
    {
      key: 'email',
      header: t('Email', 'Email'),
      mobile: 'title',
      cell: (person) => (
        <span className="block min-w-0 truncate">
          {person.email}
          {person.email === selfEmail.toLowerCase() && <span className="text-muted-foreground"> {t('(you)', '(você)')}</span>}
        </span>
      ),
    },
    { key: 'role', header: t('Role', 'Papel'), label: t('Role', 'Papel'), cell: (person) => roleLabel(person.role, t) },
    {
      key: 'status',
      header: t('Status', 'Status'),
      label: t('Status', 'Status'),
      cell: (person) => ({
        active: <TagBadge tone="success">{t('Active', 'Ativo')}</TagBadge>,
        invited: <TagBadge tone="warning" title={t('Has not accepted yet: no access and no emails until then', 'Ainda não aceitou: sem acesso nem emails até lá')}>{t('Invited', 'Convidado')}</TagBadge>,
        declined: <TagBadge tone="danger" title={t('Declined the invitation. You can invite them again.', 'Recusou o convite. Você pode convidar de novo.')}>{t('Declined', 'Recusou')}</TagBadge>,
        expired: <TagBadge tone="muted" title={t('Did not answer in 30 days. You can invite them again.', 'Não respondeu em 30 dias. Você pode convidar de novo.')}>{t('Expired', 'Expirado')}</TagBadge>,
      })[person.status],
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('Actions', 'Ações')}</span>,
      align: 'end',
      mobile: 'actions',
      cell: (person) => {
        const roles = person.role === 'owner' ? [] : assignableRoles(role, person.role).filter((item) => item !== person.role);
        if (person.role === 'owner' || !assignableRoles(role, person.role).length) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" disabled={busy} aria-label={`${t('Actions for', 'Ações para')} ${person.email}`} />}>
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="analytics-menu">
              {roles.map((next) => (
                <DropdownMenuItem key={next} onClick={() => void change('PATCH', { email: person.email, role: next }, t(`${person.email} is now ${roleLabel(next, t).toLowerCase()}.`, `${person.email} agora é ${roleLabel(next, t).toLowerCase()}.`))}>
                  {t(`Make ${roleLabel(next, t).toLowerCase()}`, `Tornar ${roleLabel(next, t).toLowerCase()}`)}
                </DropdownMenuItem>
              ))}
              {roles.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" onClick={() => setRemoving(person)}>{t('Remove from workspace', 'Remover do workspace')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <SectionCard
      title={t('Members and permissions', 'Membros e permissões')}
      description={canInvite
        ? t(`Invite up to ${data?.limit ?? 20} people to this workspace. Billing stays with the owner.`, `Convide até ${data?.limit ?? 20} pessoas para este workspace. A cobrança continua com o responsável.`)
        : t('Only the owner and admins can invite or remove people.', 'Só o responsável e os admins podem convidar ou remover pessoas.')}
      action={canInvite ? (
        // A disabled button takes no pointer: the balloon sits on its wrapper.
        <Hint text={full ? t('This workspace is full.', 'Este workspace está completo.') : undefined}><span className="inline-flex">
        <Button disabled={!data || full} onClick={() => setInviting(true)}>
          {t('Invite member', 'Convidar membro')}
        </Button>
        </span></Hint>
      ) : undefined}
    >
      {error && !data ? (
        <EmptyState frame="bare" tone="error" title={t('Could not load the members.', 'Não foi possível carregar os membros.')} description={error} onRetry={() => { setError(''); setData(null); load(); }} />
      ) : (
        <div className="live-table-scroll">
          <DataTable singleLine ariaLabel={t('Workspace members', 'Membros do workspace')} loading={!data ? 3 : undefined} rows={people} rowKey={(person) => person.email} columns={columns} />
        </div>
      )}
      {inviting && <InviteMemberDialog open onOpenChange={setInviting} roles={assignableRoles(role)} onSubmit={invite} t={t} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={t('Remove this person?', 'Remover esta pessoa?')}
        description={t(`${removing?.email ?? ''} loses access to this workspace right away. You can invite them again later.`, `${removing?.email ?? ''} perde o acesso a este workspace na hora. Você pode convidar de novo depois.`)}
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={t('Remove', 'Remover')}
        destructive
        onConfirm={() => { const person = removing; setRemoving(null); if (person) void change('DELETE', { email: person.email }, t(`${person.email} was removed.`, `${person.email} foi removido.`)); }}
      />
    </SectionCard>
  );
}

/**
 * The invitations waiting for the signed-in person, each with Accept and Decline. Presentational: the caller answers them
 * (PendingInvitations below, or the catalog sample). `busy` is the workspace being answered.
 */
export function InvitationsDialog({
  open,
  onOpenChange,
  invitations,
  busy,
  onAnswer,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invitations: Invitation[];
  busy: string | null;
  onAnswer: (invitation: Invitation, answer: 'accept' | 'decline') => void;
  t: Translate;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{invitations.length > 1 ? t('Workspace invitations', 'Convites para workspaces') : t('Workspace invitation', 'Convite para workspace')}</DialogTitle>
          <DialogDescription>
            {t('Accept to open the workspace. Until then you have no access to it and get no emails from it.', 'Aceite para abrir o workspace. Até lá você não tem acesso a ele nem recebe emails dele.')}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3" aria-label={t('Invitations', 'Convites')}>
          {invitations.map((invitation) => (
            <Item key={invitation.workspace} render={<li />} variant="outline">
              {/* Stacked at every width: the inviter's whole email shows, the actions sit under it. */}
              <ItemContent className="min-w-0 basis-full">
                <ItemTitle className="line-clamp-none wrap-anywhere">{invitation.name}</ItemTitle>
                <ItemDescription className="line-clamp-none wrap-anywhere">
                  {t(`${invitation.inviter} invited you as ${roleLabel(invitation.role, t).toLowerCase()}.`, `${invitation.inviter} convidou você como ${roleLabel(invitation.role, t).toLowerCase()}.`)}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto">
                <Button variant="outline" disabled={!!busy} onClick={() => onAnswer(invitation, 'decline')} aria-label={`${t('Decline', 'Recusar')}: ${invitation.name}`}>
                  {t('Decline', 'Recusar')}
                </Button>
                <Button disabled={!!busy && busy !== invitation.workspace} pending={busy === invitation.workspace} pendingLabel={t('Opening…', 'Abrindo…')} onClick={() => onAnswer(invitation, 'accept')} aria-label={`${t('Accept', 'Aceitar')}: ${invitation.name}`}>
                  {t('Accept', 'Aceitar')}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" disabled={!!busy} onClick={() => onOpenChange(false)}>{t('Later', 'Depois')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Asks the signed-in person about their pending invitations when the app opens (Cloud; the invitation email's link
 * lands here). Accept opens that workspace; Decline closes the invitation; Later (or closing it) hides those invitations for
 * the rest of this browser session (sessionStorage), and the next session asks again. A new invitation still shows.
 */
const LATER_KEY = 'lastfind:invitations-later';
const laterIds = (): string[] => {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(LATER_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};
const saveLater = (ids: string[]) => {
  try {
    window.sessionStorage.setItem(LATER_KEY, JSON.stringify([...new Set([...laterIds(), ...ids])]));
  } catch {
    // Storage off (private mode): the dialog only closes, and asks again on the next page load.
  }
};

export function PendingInvitations({ request, t, base }: { request: typeof requestJson; t: Translate; base: string }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // A failed read only skips the question this time: the invitation waits for the next visit.
    request<{ invitations: Invitation[] }>('/api/invitations').then(
      (next) => {
        const later = new Set(laterIds());
        const waiting = next.invitations.filter((invitation) => !later.has(invitation.workspace));
        if (live && waiting.length) { setInvitations(waiting); setOpen(true); }
      },
      () => undefined,
    );
    return () => { live = false; };
  }, [request]);
  const answer = async (invitation: Invitation, choice: 'accept' | 'decline') => {
    setBusy(invitation.workspace);
    try {
      await request('/api/invitations', 'POST', { workspace: invitation.workspace, answer: choice });
    } catch (cause) {
      setBusy(null);
      return toast.add({ title: cause instanceof Error ? cause.message : String(cause), type: 'error' });
    }
    if (choice === 'accept') return openWorkspace(invitation.workspace, base);
    toast.add({ title: t(`Invitation to ${invitation.name} declined.`, `Convite para ${invitation.name} recusado.`), type: 'success' });
    const rest = invitations.filter((item) => item.workspace !== invitation.workspace);
    setInvitations(rest);
    if (!rest.length) setOpen(false);
    setBusy(null);
  };
  if (!invitations.length) return null;
  const close = (next: boolean) => {
    if (!next) saveLater(invitations.map((invitation) => invitation.workspace));
    setOpen(next);
  };
  return <InvitationsDialog open={open} onOpenChange={close} invitations={invitations} busy={busy} onAnswer={(invitation, choice) => void answer(invitation, choice)} t={t} />;
}

/** Opens another workspace: the cookie only names it (the server checks membership on every request), then a full reload. */
export function openWorkspace(id: string, base: string) {
  const value = /^[\w:.-]+$/.test(id) ? id : encodeURIComponent(id);
  document.cookie = `${WORKSPACE_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
  window.location.assign(base);
}
