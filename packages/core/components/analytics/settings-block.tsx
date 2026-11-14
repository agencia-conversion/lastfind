'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, skeletonColumns } from '@/components/lastfind/presentation/data-table';
type Copy = (en: string, pt: string) => string;
export function SettingsBlock({
  title,
  description,
  children,
  save,
  onDirty,
  busy,
  t,
  dirty: controlledDirty,
  onCancel,
  action,
  className = '',
}: {
  title: string;
  description?: string;
  dirty?: boolean;
  onCancel?: () => void;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  save: (values: FormData) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
  busy: boolean;
  t: Copy;
}) {
  const form = useRef<HTMLFormElement>(null);
  const baseline = useRef('');
  const [formDirty, setDirty] = useState(false);
  const dirty = controlledDirty ?? formDirty;
  const dirtyCallback = useRef(onDirty);
  useEffect(() => {
    dirtyCallback.current = onDirty;
  }, [onDirty]);
  useEffect(() => {
    dirtyCallback.current(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyCallback.current(false), []);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const values = () => new FormData(form.current!);
  const snapshot = () => JSON.stringify([...values()]);
  useEffect(() => {
    baseline.current = snapshot();
  }, []);
  const changed = (next: boolean) => {
    setDirty(next);
  };
  return (
    <SectionCard
      className="settings-form-block"
      title={title}
      description={description}
      action={action}
      inset="padded"
    >
      <form
        ref={form}
        className={`live-form live-settings-form ${className}`}
        // Native input also fires when React's change tracker still holds a cancelled value.
        onInput={() => {
          changed(snapshot() !== baseline.current);
          setState('idle');
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          setState('saving');
          const submitted = values();
          let saved = false;
          try {
            saved = await save(submitted);
          } catch {
            /* Preserve the draft and allow an explicit retry. */
          }
          if (saved) {
            baseline.current = JSON.stringify([...submitted]);
            changed(false);
            setState('saved');
          } else setState('error');
        }}
      >
        <fieldset disabled={busy || state === 'saving'} className="contents">
          {children}
        </fieldset>
        <div className="settings-block-footer">
          <output>
            {state === 'saving'
              ? t('Saving…', 'Salvando…')
              : state === 'saved' && !dirty
                ? t('Saved', 'Salvo')
                : state === 'error'
                  ? t(
                      'Could not save. Your changes are preserved. Try again.',
                      'Não foi possível salvar. Suas alterações foram preservadas. Tente novamente.',
                    )
                  : dirty
                    ? t('Unsaved changes', 'Alterações não salvas')
                    : ''}
          </output>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || busy || state === 'saving'}
              onClick={() => {
                form.current!.reset();
                onCancel?.();
                changed(false);
                setState('idle');
              }}
            >
              {t('Cancel', 'Cancelar')}
            </Button>
            <Button
              type="submit"
              disabled={!dirty || busy || state === 'saving'}
            >
              {state === 'saving'
                ? t('Saving…', 'Salvando…')
                : t('Save changes', 'Salvar alterações')}
            </Button>
          </div>
        </div>
      </form>
    </SectionCard>
  );
}

/** The cards of each Settings section, in its loaded order: a form card (`lines` fields) or a table card (`columns`). */
const SETTINGS_CARDS: Record<string, ({ lines: number } | { columns: number })[]> = {
  workspace: [{ lines: 6 }],
  competitors: [{ columns: 3 }],
  monitoring: [{ lines: 4 }, { columns: 5 }, { columns: 4 }],
  semantic: [{ lines: 4 }, { lines: 3 }],
  agent: [{ lines: 4 }],
  data: [{ columns: 4 }, { lines: 2 }, { lines: 2 }],
  members: [{ columns: 4 }],
  projects: [{ columns: 4 }],
  connections: [{ columns: 4 }, { columns: 4 }, { columns: 3 }],
  profile: [{ lines: 3 }, { lines: 2 }],
};

function LoadingCards({ cards, label }: { cards: ({ lines: number } | { columns: number })[]; label: string }) {
  return (
    <div className="live-settings-content section-content min-w-0 space-y-6" aria-busy="true" aria-label={label} data-screen-skeleton="">
      {cards.map((card, index) =>
        'lines' in card ? (
          <SectionCard key={index} loading lines={card.lines} />
        ) : (
          <SectionCard key={index} title={<Skeleton inline className="h-lh w-40 max-w-full align-top" />}>
            <DataTable singleLine loading={4} ariaLabel={label} rows={[]} rowKey={String} columns={skeletonColumns(card.columns)} />
          </SectionCard>
        ),
      )}
    </div>
  );
}

/**
 * A Settings section while the workspace loads (docs/design/shell.md section 9): its cards in their loaded frames, under the
 * page heading live-app keeps. `section` is the Settings section id; an unknown one draws one form card.
 */
export function SettingsSkeleton({ section, label }: { section: string; label: string }) {
  return <LoadingCards cards={SETTINGS_CARDS[section] ?? [{ lines: 4 }]} label={label} />;
}

/** An Admin page while the workspace loads: the summary card and the table card most Admin pages open with. */
export function AdminSkeleton({ label }: { label: string }) {
  return <LoadingCards cards={[{ lines: 2 }, { columns: 5 }]} label={label} />;
}
