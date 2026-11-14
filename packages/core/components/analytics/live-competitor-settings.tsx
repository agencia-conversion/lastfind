'use client';
import { useId, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { BrandTarget, Project } from '@/lib/types';
import { MAX_COMPETITORS } from '@/lib/brand-decisions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagInput } from '@/components/ui/tag-input';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { competitorIdentity } from '@/lib/competitor-identity';
import { normalizeDomain } from '@/lib/metrics';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BrandName } from './shared';
import { SettingsBlock } from './settings-block';
import { DataTable } from '@/components/lastfind/presentation/data-table';

const domainOf = (value: string) => {
  try {
    return normalizeDomain(value);
  } catch {
    return null;
  }
};
const aliasOf = (value: string) => (value.trim().length >= 2 && competitorIdentity(value) ? value.trim().slice(0, 80) : null);
/** A competitor's domains, the main one first (BrandTarget keeps `domains` only when there are others). */
const domainsOf = (target: BrandTarget) => target.domains?.length ? target.domains : target.domain ? [target.domain] : [];
/** The target with these domains: the first is the main one, `domains` kept only with others. */
const withDomains = (target: BrandTarget, domains: string[]): BrandTarget => {
  const { domains: _, ...rest } = target;
  return { ...rest, domain: domains[0] ?? '', ...(domains.length > 1 ? { domains } : {}) };
};

type Props = {
  project: Project;
  busy: boolean;
  onDirty: (dirty: boolean) => void;
  mutationError: string;
  clearMutationError: () => void;
  t: (en: string, pt: string) => string;
  save: (path: string, method: string, value: unknown) => Promise<unknown>;
};
export function LiveCompetitorSettings({
  project,
  onDirty,
  busy,
  t,
  save,
  mutationError,
  clearMutationError,
}: Props) {
  const [editor, setEditor] = useState<{
    index: number;
    target: BrandTarget;
  } | null>(null);
  const fieldId = useId();
  const [remove, setRemove] = useState<number | null>(null);
  const [removeName, setRemoveName] = useState('');
  const [draft, setDraft] = useState<{
    baseline: BrandTarget[];
    value: BrandTarget[];
  } | null>(null);
  const competitors = draft?.value ?? project.competitors;
  const setCompetitors = (next: BrandTarget[]) =>
    setDraft(
      JSON.stringify(next) === JSON.stringify(project.competitors)
        ? null
        : { baseline: draft?.baseline ?? project.competitors, value: next },
    );
  const listDirty = draft !== null;
  const editorDirty =
    editor !== null &&
    JSON.stringify(editor.target) !==
      JSON.stringify(
        editor.index < 0 ? { name: '', domain: '' } : competitors[editor.index],
      );
  return (
    <>
      <SettingsBlock
        t={t}
        busy={busy}
        onDirty={onDirty}
        dirty={listDirty || editorDirty}
        onCancel={() => {
          setDraft(null);
          clearMutationError();
        }}
        save={async () => {
          // A suggestion or another refresh must not be overwritten by an older draft.
          if (
            JSON.stringify(draft?.baseline ?? project.competitors) !==
            JSON.stringify(project.competitors)
          )
            return false;
          const saved = await save(
            `/api/projects/${encodeURIComponent(project.id)}`,
            'PATCH',
            { competitors },
          );
          if (saved) setDraft(null);
          return Boolean(saved);
        }}
        title={t('Competitor list', 'Lista de concorrentes')}
        description={t(
          `Compare your brand with up to ${MAX_COMPETITORS} competitors in collected answers.`,
          `Compare sua marca com até ${MAX_COMPETITORS} concorrentes nas respostas coletadas.`,
        )}
        action={
          <Button
            disabled={busy || competitors.length >= MAX_COMPETITORS}
            onClick={() => {
              clearMutationError();
              setEditor({ index: -1, target: { name: '', domain: '' } });
            }}
          >
            {t('Add competitor', 'Adicionar concorrente')}
          </Button>
        }
      >
        <div className="mt-5">
          {competitors.length ? (
            <DataTable
              singleLine
              rows={competitors}
              rowKey={(target) => target.domain}
              columns={[
                {
                  key: 'brand',
                  header: t('Brand', 'Marca'),
                  sortValue: (target) => target.name,
                  mobile: 'title',
                  cell: (target) => (
                    <BrandName name={target.name} domain={target.domain} own={false} />
                  ),
                },
                {
                  key: 'domain',
                  header: t('Domains', 'Domínios'),
                  sortValue: (target) => target.domain,
                  label: t('Domains', 'Domínios'),
                  cell: (target) => (
                    <span className="flex flex-wrap gap-1">
                      {domainsOf(target).map((domain) => <TagBadge key={domain}>{domain}</TagBadge>)}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: t('Actions', 'Ações'),
                  align: 'end',
                  // On a phone the buttons sit at the end of the name's line, so a long domain never runs under them.
                  mobile: 'actions',
                  cell: (target) => (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${t('Edit', 'Editar')} ${target.name}`}
                        disabled={busy}
                        onClick={() => {
                          clearMutationError();
                          setEditor({ index: competitors.indexOf(target), target: { ...target } });
                        }}
                      >
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${t('Remove', 'Remover')} ${target.name}`}
                        disabled={busy}
                        onClick={() => {
                          clearMutationError();
                          setRemoveName('');
                          setRemove(competitors.indexOf(target));
                        }}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          ) : (
            <p className="px-4 py-8 text-center text-body text-muted-foreground">
              {t(
                'No competitors yet. Add a brand to start comparing.',
                'Ainda não há concorrentes. Adicione uma marca para começar a comparar.',
              )}
            </p>
          )}
        </div>
      </SettingsBlock>
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent className="live-settings-dialog">
          <DialogHeader>
            <DialogTitle>
              {editor?.index === -1
                ? t('Add competitor', 'Adicionar concorrente')
                : t('Edit competitor', 'Editar concorrente')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'Apply the name, its domains (the main one first) and its aliases, then save the competitor list.',
                'Aplique o nome, os domínios (o principal primeiro) e os apelidos, depois salve a lista de concorrentes.',
              )}
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <form
              className="live-form"
              onSubmit={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const next = [...competitors];
                if (editor.index < 0) next.push(editor.target);
                else next[editor.index] = editor.target;
                setCompetitors(next);
                setEditor(null);
              }}
            >
              <label>
                {t('Brand name', 'Nome da marca')}
                <Input
                  required
                  maxLength={80}
                  value={editor.target.name}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      target: { ...editor.target, name: event.target.value },
                    })
                  }
                />
              </label>
              {/* A label around the badges would also press their first remove button: it names the field by its id. */}
              <div className="grid gap-1">
                <label htmlFor={`${fieldId}-domains`}>{t('Domains', 'Domínios')}</label>
                <TagInput
                  id={`${fieldId}-domains`}
                  spaces
                  inputMode="url"
                  value={domainsOf(editor.target)}
                  normalize={domainOf}
                  placeholder="example.com"
                  removeLabel={(tag) => `${t('Remove', 'Remover')} ${tag}`}
                  onChange={(domains) => setEditor({ ...editor, target: withDomains(editor.target, domains) })}
                />
              </div>
              <div className="grid gap-1">
                <label htmlFor={`${fieldId}-aliases`}>{t('Aliases', 'Apelidos')}</label>
                <TagInput
                  id={`${fieldId}-aliases`}
                  value={editor.target.aliases ?? []}
                  normalize={aliasOf}
                  placeholder={t('None', 'Nenhum')}
                  removeLabel={(tag) => `${t('Remove', 'Remover')} ${tag}`}
                  onChange={(aliases) => {
                    const { aliases: _, ...rest } = editor.target;
                    setEditor({ ...editor, target: aliases.length ? { ...rest, aliases } : rest });
                  }}
                />
              </div>
              {mutationError && (
                <p role="alert" className="text-body text-destructive">
                  {mutationError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditor(null)}
                >
                  {t('Cancel', 'Cancelar')}
                </Button>
                <Button type="submit" disabled={busy || !editorDirty || !editor.target.domain}>
                  {t('Apply competitor', 'Aplicar concorrente')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
      >
        <DialogContent className="live-settings-dialog">
          <DialogHeader>
            <DialogTitle>
              {t('Remove competitor', 'Remover concorrente')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'Remove this brand from the comparison? Existing collected answers remain saved.',
                'Remover esta marca da comparação? As respostas já coletadas continuam salvas.',
              )}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2">
            {t(
              'Type the brand name to remove it',
              'Digite o nome da marca para removê-la',
            )}
            <Input
              value={removeName}
              onChange={(event) => setRemoveName(event.target.value)}
              placeholder={remove !== null ? competitors[remove]?.name : ''}
            />
          </label>
          {mutationError && (
            <p role="alert" className="text-body text-destructive">
              {mutationError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemove(null)}>
              {t('Cancel', 'Cancelar')}
            </Button>
            <Button
              disabled={
                busy ||
                remove === null ||
                removeName !== competitors[remove]?.name
              }
              onClick={async () => {
                setCompetitors(
                  competitors.filter((_, index) => index !== remove),
                );
                setRemove(null);
              }}
            >
              {t('Remove competitor', 'Remover concorrente')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
