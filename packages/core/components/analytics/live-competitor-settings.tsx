'use client';
import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { BrandTarget, Project } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SiteFavicon } from './shared';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable } from '@/components/lastfind/presentation/data-table';

type Props = {
  project: Project;
  busy: boolean;
  mutationError: string;
  clearMutationError: () => void;
  t: (en: string, pt: string) => string;
  save: (path: string, method: string, value: unknown) => Promise<unknown>;
};
export function LiveCompetitorSettings({
  project,
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
  const [remove, setRemove] = useState<number | null>(null);
  const persist = (competitors: BrandTarget[]) =>
    save(`/api/projects/${encodeURIComponent(project.id)}`, 'PATCH', {
      competitors,
    });
  return (
    <SectionCard
      className="live-settings-panel"
      title={t('Competitors', 'Concorrentes')}
      description={t(
        'Compare your brand with up to five competitors in collected answers.',
        'Compare sua marca com até cinco concorrentes nas respostas coletadas.',
      )}
      action={<Button
          disabled={busy || project.competitors.length >= 5}
          onClick={() => {
            clearMutationError();
            setEditor({ index: -1, target: { name: '', domain: '' } });
          }}
        >
          <Plus size={15} />
          {t('Add competitor', 'Adicionar concorrente')}
        </Button>}
    >
      <div className="live-settings-table">
        {project.competitors.length ? (
          <DataTable
            rows={project.competitors}
            rowKey={(target) => target.domain}
            columns={[
              {
                key: 'brand',
                header: t('Brand', 'Marca'),
                mobile: 'title',
                cell: (target) => (
                  <span className="flex items-center gap-2">
                    <SiteFavicon domain={target.domain} name={target.name} />
                    {target.name}
                  </span>
                ),
              },
              {
                key: 'domain',
                header: t('Domain', 'Domínio'),
                label: t('Domain', 'Domínio'),
                cell: (target) => target.domain,
              },
              {
                key: 'actions',
                header: t('Actions', 'Ações'),
                align: 'end',
                cell: (target, index) => (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${t('Edit', 'Editar')} ${target.name}`}
                      disabled={busy}
                      onClick={() => {
                        clearMutationError();
                        setEditor({ index, target: { ...target } });
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
                        setRemove(index);
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
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent className="live-settings-dialog">
          <DialogHeader>
            <DialogTitle className="text-section leading-6 font-medium">
              {editor?.index === -1
                ? t('Add competitor', 'Adicionar concorrente')
                : t('Edit competitor', 'Editar concorrente')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'Use the brand name and its main website domain.',
                'Use o nome da marca e o domínio principal do site.',
              )}
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <form
              className="live-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const competitors = [...project.competitors];
                if (editor.index < 0) competitors.push(editor.target);
                else competitors[editor.index] = editor.target;
                if (await persist(competitors)) setEditor(null);
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
              <label>
                {t('Domain', 'Domínio')}
                <Input
                  required
                  value={editor.target.domain}
                  placeholder="example.com"
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      target: { ...editor.target, domain: event.target.value },
                    })
                  }
                />
              </label>
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
                <Button type="submit" disabled={busy}>
                  {t('Save competitor', 'Salvar concorrente')}
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
            <DialogTitle className="text-section leading-6 font-medium">
              {t('Remove competitor', 'Remover concorrente')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'Remove this brand from the comparison? Existing collected answers remain saved.',
                'Remover esta marca da comparação? As respostas já coletadas continuam salvas.',
              )}
            </DialogDescription>
          </DialogHeader>
          <p>{remove !== null && project.competitors[remove]?.name}</p>
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
              disabled={busy}
              onClick={async () => {
                if (
                  await persist(
                    project.competitors.filter((_, index) => index !== remove),
                  )
                )
                  setRemove(null);
              }}
            >
              {t('Remove competitor', 'Remover concorrente')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
