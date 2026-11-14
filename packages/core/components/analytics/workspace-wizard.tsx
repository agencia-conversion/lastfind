'use client';
// The workspace wizard (13/11/2026): a new account names its workspace and its address, then may invite people, before its
// first project (the New project wizard follows). Two steps, in the New project wizard's layout and catalog pieces. The same
// wizard creates another workspace (the switcher's New workspace, `create`): its first step creates it, behind the one-free-
// workspace gate, whose message it shows instead when the gate is closed. Cloud only: the independent edition has one
// workspace, named by its setup.
import { useCallback, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeading } from '@/components/lastfind/presentation/page-heading';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { Note } from '@/components/lastfind/presentation/note';
import { WizardSteps } from '@/components/lastfind/presentation/wizard-steps';
import { slugBase } from './app-routes';
import { SlugField, checkWorkspaceSlug, type SlugStatus } from './address-settings';
import { MembersSettings } from './members-settings';
import { setRequestWorkspace, type requestJson } from '@/lib/client';
import type { NewWorkspaceGate } from '@/lib/types';
import './new-project-wizard.css';
type Copy = (en: string, pt: string) => string;

const STEPS: [string, string][] = [['Workspace', 'Workspace'], ['Members', 'Membros']];

export function WorkspaceWizard({
  name: initialName,
  slug: initialSlug,
  selfEmail,
  request,
  check = checkWorkspaceSlug,
  onDone,
  create,
  t,
}: {
  /** The workspace's name and slug as they are now (the company in the profile, else the owner's name). */
  name: string;
  slug: string;
  selfEmail: string;
  request: typeof requestJson;
  /** The server's live answer for a slug (the catalog passes a fixture). */
  check?: typeof checkWorkspaceSlug;
  /** Named, and the members step done or skipped: the New project wizard opens (a created workspace's, by its slug). */
  onDone: (slug: string) => void;
  /** A new workspace (the switcher's New workspace): whether the person may create one, and the way back. */
  create?: { gate: NewWorkspaceGate; onCancel: () => void };
  t: Copy;
}) {
  const id = useId();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  // The slug follows the name as it is typed, until it is edited by hand.
  const [slugEdited, setSlugEdited] = useState(false);
  const [status, setStatus] = useState<SlugStatus>({ state: 'done', problem: null });
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // A created workspace's slug: from then on the wizard edits it, like a workspace that already existed.
  const [created, setCreated] = useState<string | null>(null);
  // A new workspace's slug is checked against every workspace (one stable function: SlugField checks again when it changes).
  const checkNew = useCallback((value: string) => check(value, true), [check]);
  const nameOk = name.replace(/\s+/g, ' ').trim().length >= 2;
  const slugOk = status.state === 'error' || (status.state === 'done' && !status.problem);
  const save = async () => {
    setAttempted(true);
    if (!nameOk || !slugOk) return;
    setSaving(true);
    setError('');
    try {
      if (create && !created) {
        const made = await request<{ slug: string }>('/api/workspaces', 'POST', { name: name.trim(), slug });
        setCreated(made.slug);
        // The members step and every request after it act in the new workspace.
        setRequestWorkspace(made.slug);
      } else {
        const saved = await request<{ slug: string }>('/api/workspace/slug', 'PATCH', { name: name.trim(), slug });
        // A new address: the next requests name it (the old one no longer opens the workspace).
        setRequestWorkspace(saved.slug);
        if (created) setCreated(saved.slug);
      }
      setStep(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  if (create && !created && !create.gate.allowed) return <FreeWorkspaceLimit gate={create.gate} request={request} onCancel={create.onCancel} t={t} />;
  const done = () => onDone(created ?? slug);
  return (
    <div className="new-project-wizard">
      <WizardSteps variant="progress" steps={STEPS.map((label) => t(...label))} current={step} label={t('Steps', 'Passos')} />
      {step === 0 ? (
        <>
          <PageHeading
            title={create ? t('Create a workspace', 'Crie um workspace') : t('Create your workspace', 'Crie seu workspace')}
            description={create
              ? t('Where your projects and your team live. Choose its name and its address. It starts on Free.', 'Onde ficam seus projetos e sua equipe. Escolha o nome e o endereço. Ele começa no Free.')
              : t('Where your projects and your team live. Choose its name and its address.', 'Onde ficam seus projetos e sua equipe. Escolha o nome e o endereço.')}
          />
          <SectionCard inset="padded" className="pt-5">
            <div className="grid gap-5">
              <Field>
                <FieldLabel htmlFor={`${id}-name`}>{t('Workspace name', 'Nome do workspace')}</FieldLabel>
                <Input
                  id={`${id}-name`}
                  maxLength={80}
                  autoComplete="organization"
                  placeholder={t('Your company or team', 'Sua empresa ou equipe')}
                  value={name}
                  aria-invalid={attempted && !nameOk ? true : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (!slugEdited) setSlug(slugBase(event.target.value, ''));
                  }}
                />
                <FieldDescription>{t('How the workspace appears to you and the people you invite.', 'Como o workspace aparece para você e para quem você convidar.')}</FieldDescription>
              </Field>
              <SlugField
                id={`${id}-slug`}
                base="/app/"
                value={slug}
                onChange={(next) => {
                  setSlugEdited(true);
                  setSlug(next);
                }}
                check={create && !created ? checkNew : check}
                onStatus={setStatus}
                unchanged={created ?? initialSlug}
                t={t}
              />
            </div>
          </SectionCard>
          {error && <Note tone="danger" className="px-0">{error}</Note>}
          <div className="new-project-nav">
            {create && !created ? <Button variant="ghost" onClick={create.onCancel}>{t('Cancel', 'Cancelar')}</Button> : <span />}
            <Button pending={saving} pendingLabel={t('Saving…', 'Salvando…')} disabled={status.state === 'checking'} onClick={() => void save()}>{t('Next', 'Avançar')}</Button>
          </div>
        </>
      ) : (
        <>
          <PageHeading
            title={t('Invite your team', 'Convide sua equipe')}
            description={t('Optional. They get an email and see this workspace once they accept. You can invite people later in Settings > Members.', 'Opcional. As pessoas recebem um email e veem este workspace quando aceitarem. Dá para convidar depois em Configurações > Membros.')}
          />
          <MembersSettings request={request} t={t} selfEmail={selfEmail} />
          <div className="new-project-nav">
            <Button variant="ghost" onClick={() => setStep(0)}>{t('Back', 'Voltar')}</Button>
            <span className="flex items-center gap-2">
              <Button variant="outline" onClick={done}>{t('Skip', 'Pular')}</Button>
              <Button onClick={done}>{t('Next', 'Avançar')}</Button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The one-free-workspace limit, said plainly where New workspace leads (never a dead end): which workspace is the free one, why
 * another needs a paid plan, and the next step. While payments are off the owner asks Lastfind for a paid plan (Admin >
 * Workspaces grants it); once they are on, the same message leads to subscribing that workspace.
 */
export function FreeWorkspaceLimit({
  gate,
  request,
  onCancel,
  t,
}: {
  gate: Extract<NewWorkspaceGate, { allowed: false }>;
  request: typeof requestJson;
  onCancel: () => void;
  t: Copy;
}) {
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState('');
  const name = gate.free.name;
  const ask = async () => {
    setAsking(true);
    setError('');
    try {
      await request('/api/workspaces', 'POST', { upgrade: gate.free.id });
      setAsked(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAsking(false);
    }
  };
  return (
    <div className="new-project-wizard">
      <PageHeading
        title={t('One free workspace per person', 'Um workspace grátis por pessoa')}
        description={t(
          `A new workspace starts on Free, so you can create one only while none of the workspaces you own is on Free. ${name} is on Free.`,
          `Um workspace novo começa no Free, então você só pode criar um enquanto nenhum dos workspaces de que você é dono estiver no Free. ${name} está no Free.`,
        )}
      />
      <SectionCard inset="padded" className="grid gap-4 pt-5">
        <p>
          {gate.upgrade === 'subscribe'
            ? t(`Subscribe ${name} to a paid plan, then come back here to create the new workspace.`, `Assine um plano pago para ${name} e depois volte aqui para criar o novo workspace.`)
            : t(
                `Paid plans are not on sale yet. Ask the Lastfind team and they move ${name} to a paid plan; then come back here to create the new workspace.`,
                `Os planos pagos ainda não estão à venda. Peça ao time do Lastfind e ele passa ${name} para um plano pago; depois volte aqui para criar o novo workspace.`,
              )}
        </p>
        {asked && (
          <Note>
            {t(`Request sent. Once ${name} is on a paid plan, New workspace opens this wizard.`, `Pedido enviado. Quando ${name} estiver num plano pago, Novo workspace abre este assistente.`)}
          </Note>
        )}
        {error && <Note tone="danger" className="px-0">{error}</Note>}
      </SectionCard>
      <div className="new-project-nav">
        <Button variant="ghost" onClick={onCancel}>{t('Back', 'Voltar')}</Button>
        {gate.upgrade === 'subscribe' ? (
          <Button nativeButton={false} render={<a href={`/app/${encodeURIComponent(gate.free.slug)}/settings/projects`} aria-label={t(`Subscribe ${name}`, `Assinar ${name}`)} />}>{t(`Subscribe ${name}`, `Assinar ${name}`)}</Button>
        ) : (
          <Button pending={asking} pendingLabel={t('Sending…', 'Enviando…')} disabled={asked} onClick={() => void ask()}>
            {asked ? t('Paid plan requested', 'Plano pago pedido') : t('Ask for a paid plan', 'Pedir plano pago')}
          </Button>
        )}
      </div>
    </div>
  );
}
