'use client';
// Agent > Brain > Generate with AI (31/10/2026): the site and the language (the project's by default), then one AI with web search
// reads the site and writes each file of the Brain from what it says and what the web says about the brand, then a review where each
// proposed file is edited, kept or discarded before it is saved with history (lib/brain-wizard.ts, lib/server/brain-wizard.ts). On a
// page of its own, with the Contents wizard's steps; the way back returns to the Brain. Only catalog components.
import { useState } from 'react';
import { WizardSteps } from '@/components/lastfind/presentation/wizard-steps';
import { ArrowLeft } from 'lucide-react';
import { requestJson } from '@/lib/client';
import { sameBrainFile, type BrainDraft } from '@/lib/brain-wizard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/tooltip';
import { DetailBody, DetailHeader, DetailPage } from '@/components/lastfind/presentation/detail-page';
import { Note } from '@/components/lastfind/presentation/note';
import { EmptyState, useCopy } from './shared';

type Draft = BrainDraft & { keep: boolean };
type Generated = { files: BrainDraft[]; pages: string[] };

export function BrainWizard({
  projectId,
  site: initialSite,
  language: initialLanguage,
  files,
  onClose,
  onSaved,
}: {
  projectId: string;
  site: string;
  language: string;
  /** The Brain's files now: which ones a kept file replaces, and whether someone wrote them. */
  files: { title: string; blank?: boolean }[];
  onClose: () => void;
  /** The files were saved: the first one kept, to open. */
  onSaved: (title: string) => void;
}) {
  const t = useCopy();
  const [step, setStep] = useState(0);
  const [site, setSite] = useState(initialSite);
  const [language, setLanguage] = useState(initialLanguage.startsWith('pt') ? 'pt' : 'en');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pages, setPages] = useState<string[]>([]);
  const [failure, setFailure] = useState('');
  /** A spending limit (429): trying again now changes nothing, the message says when it can. */
  const [limited, setLimited] = useState(false);
  const [saving, setSaving] = useState(false);
  const kept = drafts.filter((draft) => draft.keep);
  const steps: [string, string][] = [
    ['Site', 'Site'],
    ['Generate', 'Gerar'],
    ['Review', 'Revisar'],
  ];
  const update = (key: string, patch: Partial<Draft>) => setDrafts((list) => list.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  const generate = async () => {
    setStep(1);
    setFailure('');
    try {
      const result = await requestJson<Generated>('/api/agent/brain/wizard', 'POST', { project: projectId, site: site.trim(), language });
      // A file with nothing found is offered unkept: saving its hint would erase what the team wrote there.
      setDrafts(result.files.map((file) => ({ ...file, keep: file.found })));
      setPages(result.pages);
      setStep(2);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      setLimited((cause as { status?: number }).status === 429);
    }
  };
  const save = async () => {
    setSaving(true);
    setFailure('');
    try {
      await requestJson('/api/agent/brain', 'PUT', { project: projectId, files: kept.map(({ title, content }) => ({ title, content })) });
      onSaved(kept[0]!.title);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  const status = (draft: Draft) => {
    const current = files.find((file) => sameBrainFile(file.title, draft.title));
    if (!draft.found) return t('Nothing found on the site or the web: the file stays as it is.', 'Nada encontrado no site nem na web: o arquivo fica como está.');
    if (!current) return t('A new file in the Brain.', 'Um arquivo novo no Cérebro.');
    return current.blank ? t('Fills the empty file.', 'Preenche o arquivo vazio.') : t('Replaces what is written in this file. The current text stays in its history.', 'Substitui o que está escrito neste arquivo. O texto atual fica no histórico.');
  };

  return (
    <DetailPage className="agent-wizard brain-wizard">
      <DetailHeader
        leading={
          <>
            <SidebarTrigger className="md:hidden" aria-label={t('Toggle navigation', 'Alternar navegação')} />
            <Hint text={t('Back to the Brain', 'Voltar ao Cérebro')}>
              <Button variant="ghost" size="icon" aria-label={t('Back to the Brain', 'Voltar ao Cérebro')} disabled={saving} onClick={onClose}>
                <ArrowLeft />
              </Button>
            </Hint>
          </>
        }
        title={<h1>{t('Generate the Brain with AI', 'Gerar o Cérebro com IA')}</h1>}
        meta={t(`Step ${step + 1} of ${steps.length}: ${steps[step][0]}`, `Passo ${step + 1} de ${steps.length}: ${steps[step][1]}`)}
      />
      <DetailBody>
        <form
          className="agent-wizard-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 0) void generate();
            else if (step === 2 && kept.length) void save();
          }}
        >
          <WizardSteps steps={steps.map((name) => t(...name))} current={step} label={t('Steps', 'Passos')} />

          {step === 0 && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="brain-site">{t('Site', 'Site')}</FieldLabel>
                <Input id="brain-site" required maxLength={253} autoComplete="url" inputMode="url" placeholder="example.com" value={site} onChange={(event) => setSite(event.target.value)} />
                <FieldDescription>
                  {t(
                    'The AI reads its home page and up to four pages linked from it (about, products or services, pricing, contact), then searches the web for what is said about the brand. It writes only what it finds.',
                    'A IA lê a página inicial e até quatro páginas ligadas a ela (sobre, produtos ou serviços, preços, contato) e pesquisa na web o que se diz da marca. Escreve só o que encontrar.',
                  )}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="brain-language">{t('Language of the files', 'Idioma dos arquivos')}</FieldLabel>
                <SelectField id="brain-language" value={language} onValueChange={setLanguage} options={[{ value: 'en', label: 'English' }, { value: 'pt', label: 'Português' }]} />
                <FieldDescription>{t("The project's language, unless you choose another.", 'O idioma do projeto, a não ser que você escolha outro.')}</FieldDescription>
              </Field>
              <Note>{t('Nothing is saved until you review each file.', 'Nada é salvo antes de você revisar cada arquivo.')}</Note>
            </FieldGroup>
          )}

          {step === 1 &&
            (failure ? (
              <EmptyState
                frame="bare"
                tone="error"
                title={t('Could not generate the Brain', 'Não foi possível gerar o Cérebro')}
                description={failure}
                action={
                  <Button type="button" variant="outline" onClick={() => setStep(0)}>
                    {t('Back', 'Voltar')}
                  </Button>
                }
                onRetry={limited ? undefined : () => void generate()}
              />
            ) : (
              <div className="grid gap-4" aria-busy="true">
                <Note status icon={<Spinner />}>
                  {t(`Reading ${site.trim()} and searching the web. It can take up to two minutes.`, `Lendo ${site.trim()} e pesquisando na web. Pode levar até dois minutos.`)}
                </Note>
                {/* The review it is writing: each file's box, title, line and text. */}
                <ul className="grid gap-4" aria-hidden="true">
                  {['w-1/3', 'w-1/4', 'w-2/5', 'w-1/4', 'w-1/3', 'w-1/5'].map((width, index) => (
                    <li key={index} className="grid gap-3 border-t border-border pt-4">
                      <div className="flex items-start gap-3">
                        <Skeleton className="size-4 shrink-0 rounded-sm" />
                        <div className="grid flex-1 gap-1.5">
                          <Skeleton className={`h-4 ${width}`} />
                          <Skeleton className="h-3 w-2/3" />
                        </div>
                      </div>
                      <Skeleton className="h-24 w-full" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}

          {step === 2 && (
            <div className="grid gap-6">
              <p className="text-body text-muted-foreground">
                {pages.length
                  ? t(`Read on the site: ${pages.join(', ')}. Keep the files you approve; you can edit them first.`, `Lido no site: ${pages.join(', ')}. Fique com os arquivos que aprovar; dá para editar antes.`)
                  : t('The site did not answer: the AI searched the web only. Keep the files you approve; you can edit them first.', 'O site não respondeu: a IA pesquisou só na web. Fique com os arquivos que aprovar; dá para editar antes.')}
              </p>
              <ul className="grid gap-4">
                {drafts.map((draft) => (
                  <li key={draft.key} className="grid gap-3 border-t border-border pt-4">
                    <Field orientation="horizontal">
                      <Checkbox id={`brain-keep-${draft.key}`} checked={draft.keep} disabled={saving} onCheckedChange={(checked) => update(draft.key, { keep: checked === true })} />
                      <FieldLabel htmlFor={`brain-keep-${draft.key}`} className="flex-col items-start gap-0.5">
                        <span className="text-body">{draft.title}</span>
                        <span className="text-caption text-muted-foreground">{status(draft)}</span>
                      </FieldLabel>
                    </Field>
                    {draft.keep ? (
                      <Textarea
                        aria-label={t(`Text of ${draft.title}`, `Texto de ${draft.title}`)}
                        rows={Math.min(10, Math.max(4, draft.content.split('\n').length + 1))}
                        maxLength={4000}
                        disabled={saving}
                        value={draft.content}
                        onChange={(event) => update(draft.key, { content: event.target.value })}
                      />
                    ) : (
                      <p className="whitespace-pre-line text-body text-muted-foreground">{draft.found ? draft.content : <em>{draft.content.replace(/^_|_$/g, '')}</em>}</p>
                    )}
                  </li>
                ))}
              </ul>
              {failure && <Note tone="danger">{failure}</Note>}
            </div>
          )}

          {step !== 1 && (
            <div className="agent-wizard-actions">
              <Button type="button" variant="outline" disabled={saving} onClick={() => (step ? setStep(0) : onClose())}>
                {step ? t('Back', 'Voltar') : t('Cancel', 'Cancelar')}
              </Button>
              {step === 0 ? (
                <Button type="submit" disabled={!site.trim()}>
                  {t('Generate', 'Gerar')}
                </Button>
              ) : (
                <Button type="submit" disabled={!kept.length} pending={saving} pendingLabel={t('Saving…', 'Salvando…')}>
                  {kept.length === 1 ? t('Save 1 file', 'Salvar 1 arquivo') : t(`Save ${kept.length} files`, `Salvar ${kept.length} arquivos`)}
                </Button>
              )}
            </div>
          )}
        </form>
      </DetailBody>
    </DetailPage>
  );
}
