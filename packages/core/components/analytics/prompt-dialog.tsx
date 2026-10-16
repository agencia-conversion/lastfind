'use client';

import { useId, useState, type FormEvent } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { ENGINE_LABELS, ENGINE_META } from '@/lib/engines';
import { effectiveEngines } from '@/lib/prompt-units';
import type { Engine, Project, Prompt, Topic } from '@/lib/types';
import './prompt-dialog.css';

type Translate = (en: string, pt: string) => string;
export type PromptPayload = { text: string; engines: Engine[] | null; tag: string; tags: string[] };

const MIN_TEXT = 5;
const MAX_TAGS = 8;
const MAX_TAG = 30;

/**
 * Add or edit a monitored question. Fields carry a label, help text and inline
 * validation; the primary action lives in the footer and shows progress while the
 * request runs. The same form serves narrow screens: the body scrolls, the footer stays.
 */
export function PromptDialog({
  open,
  onOpenChange,
  editing,
  project,
  topics,
  engines,
  atLimit,
  demo,
  busy,
  serverError,
  t,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Prompt | null;
  project: Project;
  topics: Topic[];
  /** Models this plan and language can use. */
  engines: Engine[];
  /** Free plan with all prompt slots used: new prompts are blocked with an explanation. */
  atLimit: boolean;
  demo: boolean;
  busy: boolean;
  serverError: string;
  t: Translate;
  onSubmit: (payload: PromptPayload) => Promise<boolean>;
}) {
  const id = useId();
  const [text, setText] = useState(editing?.text ?? '');
  const [topic, setTopic] = useState(editing?.tag ?? topics[0]?.name ?? 'Geral');
  const [tags, setTags] = useState(editing?.tags.join(', ') ?? '');
  const [custom, setCustom] = useState<Engine[] | null>(editing?.engines_override ?? null);
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState({ text: false, tags: false });
  const topicEngines = topics.find((item) => item.name === topic)?.engines_override;
  const active = effectiveEngines(project.engines ?? ['chat_gpt'], topicEngines, custom);
  const maxLength = Math.min(...active.map((engine) => ENGINE_META[engine].maxLength));
  const tagList = tags.split(',').map((value) => value.trim()).filter(Boolean);
  const errors = {
    text:
      text.trim().length < MIN_TEXT
        ? t(`Write at least ${MIN_TEXT} characters.`, `Escreva ao menos ${MIN_TEXT} caracteres.`)
        : text.trim().length > maxLength
          ? t(`Shorten the question to ${maxLength} characters for the selected models.`, `Reduza a pergunta para ${maxLength} caracteres nos modelos selecionados.`)
          : '',
    tags:
      tagList.length > MAX_TAGS
        ? t(`Use up to ${MAX_TAGS} tags.`, `Use até ${MAX_TAGS} tags.`)
        : tagList.some((tag) => tag.length > MAX_TAG)
          ? t(`Each tag can have up to ${MAX_TAG} characters.`, `Cada tag pode ter até ${MAX_TAG} caracteres.`)
          : '',
    engines: custom?.length === 0 ? t('Choose at least one model, or use the defaults.', 'Escolha ao menos um modelo ou use os padrões.') : '',
  };
  const invalid = Boolean(errors.text || errors.tags || errors.engines);
  const show = (field: 'text' | 'tags') => (submitted || touched[field]) && errors[field];
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (invalid || busy || (!editing && atLimit)) return;
    await onSubmit({ text: text.trim(), engines: custom, tag: topic, tags: tagList });
  };
  const title = editing ? t('Edit prompt', 'Editar prompt') : t('Add a prompt', 'Adicionar um prompt');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pd-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {demo
              ? t('Changes are temporary and reset on reload.', 'Alterações temporárias somem ao recarregar.')
              : t('A prompt is a question we ask AI models on a schedule to see how your brand appears.', 'Um prompt é uma pergunta que fazemos aos modelos de IA periodicamente para ver como sua marca aparece.')}
          </DialogDescription>
        </DialogHeader>
        <form className="pd-form" onSubmit={submit} noValidate id={`${id}-form`}>
          <div className="pd-body">
            <FieldGroup className="gap-5">
              <Field data-invalid={Boolean(show('text')) || undefined}>
                <FieldLabel htmlFor={`${id}-text`}>{t('Question to monitor', 'Pergunta para monitorar')}</FieldLabel>
                <Textarea
                  id={`${id}-text`}
                  rows={3}
                  value={text}
                  maxLength={maxLength + 200}
                  aria-invalid={Boolean(show('text')) || undefined}
                  aria-describedby={`${id}-text-help${show('text') ? ` ${id}-text-error` : ''}`}
                  placeholder={t('What is the best project management tool for small teams?', 'Qual a melhor ferramenta de gestão de projetos para equipes pequenas?')}
                  onChange={(event) => setText(event.target.value)}
                  onBlur={() => setTouched((current) => ({ ...current, text: true }))}
                  disabled={busy}
                />
                <div className="pd-help-row">
                  <FieldDescription id={`${id}-text-help`}>
                    {t('Write it the way a customer would ask an AI assistant.', 'Escreva como um cliente perguntaria a um assistente de IA.')}
                  </FieldDescription>
                  <span className={text.trim().length > maxLength ? 'pd-count pd-count-over' : 'pd-count'} aria-live="polite">
                    {text.trim().length}/{maxLength}
                  </span>
                </div>
                {show('text') && <FieldError id={`${id}-text-error`}>{errors.text}</FieldError>}
              </Field>
              <div className="pd-pair">
                <Field>
                  <FieldLabel htmlFor={`${id}-topic`}>{t('Topic', 'Tópico')}</FieldLabel>
                  <NativeSelect id={`${id}-topic`} value={topic} onChange={(event) => setTopic(event.target.value)} disabled={busy} className="w-full" aria-describedby={`${id}-topic-help`}>
                    {!topics.length && <NativeSelectOption value="Geral">{t('General', 'Geral')}</NativeSelectOption>}
                    {topics.map((item) => (
                      <NativeSelectOption key={item.id} value={item.name}>
                        {item.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldDescription id={`${id}-topic-help`}>{t('Groups related prompts in reports.', 'Agrupa prompts relacionados nos relatórios.')}</FieldDescription>
                </Field>
                <Field data-invalid={Boolean(show('tags')) || undefined}>
                  <FieldLabel htmlFor={`${id}-tags`}>
                    {t('Tags', 'Tags')} <span className="pd-optional">{t('(optional)', '(opcional)')}</span>
                  </FieldLabel>
                  <Input
                    id={`${id}-tags`}
                    value={tags}
                    disabled={busy}
                    placeholder={t('pricing, comparison', 'preços, comparação')}
                    aria-invalid={Boolean(show('tags')) || undefined}
                    aria-describedby={`${id}-tags-help`}
                    onChange={(event) => setTags(event.target.value)}
                    onBlur={() => setTouched((current) => ({ ...current, tags: true }))}
                  />
                  <FieldDescription id={`${id}-tags-help`}>{t('Separate with commas.', 'Separe com vírgulas.')}</FieldDescription>
                  {show('tags') && <FieldError>{errors.tags}</FieldError>}
                </Field>
              </div>
              <FieldSet className="pd-models" data-invalid={Boolean(errors.engines) || undefined}>
                <FieldLegend variant="label">{t('AI models', 'Modelos de IA')}</FieldLegend>
                <FieldDescription>{t('Which models answer this question each time it runs.', 'Quais modelos respondem a esta pergunta a cada execução.')}</FieldDescription>
                <label className="pd-option">
                  <Checkbox
                    checked={custom === null}
                    disabled={busy}
                    onCheckedChange={(inherit) => setCustom(inherit ? null : [...effectiveEngines(project.engines ?? ['chat_gpt'], topicEngines, null)])}
                  />
                  {t('Use topic or project defaults', 'Usar padrões do tópico ou projeto')}
                </label>
                <div className="pd-options">
                  {engines.map((engine) => (
                    <label key={engine} className="pd-option">
                      <Checkbox
                        checked={active.includes(engine)}
                        disabled={custom === null || busy}
                        onCheckedChange={(checked) => setCustom((selected) => (checked ? [...new Set([...(selected ?? []), engine])] : (selected ?? []).filter((value) => value !== engine)))}
                      />
                      <EngineIcon engine={engine} />
                      {ENGINE_LABELS[engine]}
                    </label>
                  ))}
                </div>
                {errors.engines && <FieldError>{errors.engines}</FieldError>}
              </FieldSet>
              {!editing && atLimit && (
                <p className="pd-notice pd-notice-warn" role="alert">
                  <Info size={14} aria-hidden="true" />
                  {t('Your plan has no free prompt slots. Archive a prompt to add another.', 'Seu plano não tem vagas livres de prompt. Arquive um prompt para adicionar outro.')}
                </p>
              )}
              {!demo && !editing && !atLimit && (
                <p className="pd-notice">
                  <Info size={14} aria-hidden="true" />
                  {t('Adding a prompt starts monitoring and may use provider credits.', 'Adicionar um prompt inicia a coleta e pode usar créditos do provedor.')}
                </p>
              )}
              {serverError && (
                <p role="alert" className="pd-error">
                  {serverError}
                </p>
              )}
            </FieldGroup>
          </div>
          <DialogFooter className="pd-footer">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {t('Cancel', 'Cancelar')}
            </Button>
            <Button type="submit" disabled={busy || (!editing && atLimit)}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {busy ? (editing ? t('Saving…', 'Salvando…') : t('Adding…', 'Adicionando…')) : editing ? t('Save changes', 'Salvar alterações') : t('Add prompt', 'Adicionar prompt')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
