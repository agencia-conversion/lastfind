'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupCopy, InputGroupInput, InputGroupText } from '@/components/ui/input-group';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { useOrigin } from '@/components/lastfind/mcp-docs';
import { SLUG_MAX, slugProblem } from './app-routes';
import { requestHeaders } from '@/lib/client';
import { SettingsBlock } from './settings-block';
type Copy = (en: string, pt: string) => string;

/** What a slug check answers (the server's `GET /api/workspace/slug`, or the format alone): null when the slug can be used. */
export type SlugProblem = 'format' | 'reserved' | 'taken' | null;
/** The live state of a slug field: checking, failed to check, or the answer. */
export type SlugStatus = { state: 'checking' } | { state: 'error' } | { state: 'done'; problem: SlugProblem };
const STATUS_TEXT: Record<Exclude<SlugProblem, null> | 'available' | 'checking' | 'error', [string, string]> = {
  format: ['Use lowercase letters, numbers and single hyphens, up to 48 characters.', 'Use letras minúsculas, números e hífens simples, até 48 caracteres.'],
  reserved: ['This address is reserved. Choose another.', 'Este endereço é reservado. Escolha outro.'],
  taken: ['Another workspace already uses this address.', 'Outro workspace já usa este endereço.'],
  available: ['Available.', 'Disponível.'],
  checking: ['Checking…', 'Verificando…'],
  error: ['Could not check this address now. It is checked again when you save.', 'Não foi possível verificar este endereço agora. Ele é verificado de novo ao salvar.'],
};

/**
 * The workspace's slug as it is typed, against the server (Cloud): its format, the reserved words and the other workspaces (every
 * one, for a workspace being created: `created`).
 */
export const checkWorkspaceSlug = async (slug: string, created = false): Promise<SlugProblem> => {
  const response = await fetch(`/api/workspace/slug?${new URLSearchParams({ slug, ...(created ? { new: '1' } : {}) })}`, { headers: { Accept: 'application/json', ...requestHeaders() } });
  if (!response.ok) throw new Error(String(response.status));
  return ((await response.json()) as { problem: SlugProblem }).problem;
};

/**
 * A slug field (a workspace's or a project's segment in the app's addresses, app-routes.ts): the address before it, the
 * field, and what it says as it is typed. The format is checked here; `check` (the server) says whether another uses it,
 * after a short pause. `onStatus` tells the form whether it can go on. `link`: the full address it opens today, copied by the
 * field's own Copy link button (Settings; one field, never a second one repeating it). `readOnly`: someone who cannot change it.
 */
export function SlugField({
  id,
  base,
  value,
  onChange,
  check,
  onStatus,
  unchanged,
  link,
  readOnly = false,
  t,
}: {
  id: string;
  base: string;
  value: string;
  onChange: (slug: string) => void;
  check?: (slug: string) => Promise<SlugProblem>;
  onStatus?: (status: SlugStatus) => void;
  /** The slug already saved: nothing to check or say. */
  unchanged?: string;
  link?: string;
  readOnly?: boolean;
  t: Copy;
}) {
  const origin = useOrigin();
  const host = origin.replace(/^https?:\/\//, '');
  const local = slugProblem(value);
  const [status, setStatus] = useState<SlugStatus>({ state: 'done', problem: null });
  // The caller's setter, read when an answer lands: a new one each render never checks again.
  const report = useRef(onStatus);
  useEffect(() => {
    report.current = onStatus;
  }, [onStatus]);
  useEffect(() => {
    let live = true;
    const settle = (next: SlugStatus) => {
      if (!live) return;
      setStatus(next);
      report.current?.(next);
    };
    if (local || !check || value === unchanged) {
      queueMicrotask(() => settle({ state: 'done', problem: local }));
      return () => { live = false; };
    }
    queueMicrotask(() => settle({ state: 'checking' }));
    const timer = window.setTimeout(() => {
      check(value).then((problem) => settle({ state: 'done', problem }), () => settle({ state: 'error' }));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [value, local, check, unchanged]);
  const said = !value || value === unchanged ? null : status.state === 'done' ? (status.problem ?? (check ? 'available' : null)) : status.state;
  const invalid = status.state === 'done' && !!status.problem && value !== unchanged;
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{t('Address', 'Endereço')}</FieldLabel>
      <InputGroup className="max-sm:h-10">
        <InputGroupAddon align="inline-start" className="max-sm:hidden">
          <InputGroupText className="font-mono">{`${host}${base}`}</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          name="slug"
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          required
          maxLength={SLUG_MAX}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly={readOnly}
          className="font-mono"
          aria-invalid={invalid || undefined}
          aria-describedby={readOnly ? undefined : `${id}-help ${id}-status`}
        />
        {link && (
          <InputGroupAddon align="inline-end">
            <InputGroupCopy value={link} label={t('Copy link', 'Copiar link')} copiedLabel={t('Copied', 'Copiado')} />
          </InputGroupAddon>
        )}
      </InputGroup>
      {!readOnly && (
        <>
          <FieldDescription id={`${id}-help`}>
            {unchanged ? t('Lowercase letters, numbers and hyphens. Changing it stops the current link from working.', 'Letras minúsculas, números e hífens. Ao trocar, o link atual deixa de funcionar.') : t('Lowercase letters, numbers and hyphens.', 'Letras minúsculas, números e hífens.')}
          </FieldDescription>
          <output id={`${id}-status`} aria-live="polite" className={`block text-caption ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
            {said ? t(...STATUS_TEXT[said]) : null}
          </output>
        </>
      )}
    </Field>
  );
}

/**
 * A workspace's or a project's slug in Settings: `base` is the address before it (`/app/`, `/app/<workspace>/`). An admin
 * edits it (`check`: the server's live answer, when there is one; the save checks again); everyone else reads it. Both copy the
 * link of the saved address from the field.
 */
export function AddressSettings({
  title,
  description,
  base,
  slug,
  canEdit,
  check,
  save,
  onDirty,
  onCancel,
  error,
  busy,
  t,
}: {
  title: string;
  description: string;
  base: string;
  slug: string;
  canEdit: boolean;
  check?: (slug: string) => Promise<SlugProblem>;
  save: (slug: string) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
  onCancel?: () => void;
  /** The server's reason when the last save failed (taken, reserved, malformed). */
  error?: string;
  busy: boolean;
  t: Copy;
}) {
  const id = useId();
  const origin = useOrigin();
  const [value, setValue] = useState(slug);
  const [saved, setSaved] = useState(slug);
  if (saved !== slug) {
    setSaved(slug);
    setValue(slug);
  }
  const link = `${origin}${base}${slug}`;
  if (!canEdit)
    return (
      <SectionCard title={title} info={description} inset="padded">
        <SlugField id={`${id}-slug`} base={base} value={slug} onChange={() => undefined} unchanged={slug} link={link} readOnly t={t} />
      </SectionCard>
    );
  return (
    <SettingsBlock
      title={title}
      description={description}
      t={t}
      busy={busy}
      onDirty={onDirty}
      onCancel={() => {
        setValue(slug);
        onCancel?.();
      }}
      save={(data) => save(String(data.get('slug') ?? '').trim().toLowerCase())}
    >
      <SlugField id={`${id}-slug`} base={base} value={value} onChange={setValue} check={check} unchanged={slug} link={link} t={t} />
      {error && <p role="alert" className="col-span-full text-body text-destructive">{error}</p>}
    </SettingsBlock>
  );
}
