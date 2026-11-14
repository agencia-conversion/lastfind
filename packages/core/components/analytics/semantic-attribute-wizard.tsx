'use client';
// The attribute wizard of Semantic Branding (31/10/2026): the brands that will be compared, then attributes suggested by one AI
// with web search (or written by hand), each a name and a neutral definition of 100 to 200 characters, then a review before saving,
// on a page of its own in the main content (the way back returns to Settings).
// lib/semantic-attributes.ts holds the rule, which the server checks again. The attributes' table (`SemanticAttributesCard`, 13/11/2026)
// is the one editor of Semantic Branding's attributes: this wizard's and the New project wizard's Semantic Branding step.
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/tooltip';
import { LiveLabel } from '@/components/ui/live-label';
import { DetailBody, DetailHeader, DetailPage } from '@/components/lastfind/presentation/detail-page';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { ArrowLeft } from 'lucide-react';
import { ATTRIBUTE_MAX, ATTRIBUTE_MIN, DEFINITION_MAX, DEFINITION_MIN, NAME_MAX, attributeIssueText, attributeIssues, type SuggestedAttribute } from '@/lib/semantic-attributes';
import type { requestJson } from '@/lib/client';
import { EmptyState } from './shared';
import { LOADING_ROWS, line, oneLine, removeColumn, selectColumn } from './wizard-cells';

type Copy = (en: string, pt: string) => string;
type Attribute = { id: string; name: string; description?: string };
export type WizardConfiguration = { revision: number; enabled: boolean; attributes: Attribute[] };
/** An attribute being edited. `id`: a saved one's; `ai`: a suggestion the person has not edited (a new suggestion may replace it). */
export type AttributeRow = { key: string; id?: string; name: string; description: string; selected: boolean; ai?: boolean };

const rowsOf = (attributes: Attribute[]): AttributeRow[] =>
  attributes.map((attribute) => ({ key: attribute.id, id: attribute.id, name: attribute.name, description: attribute.description ?? '', selected: true }));
const fold = (value: string) => value.trim().toLowerCase();

/** The first thing that stops the selected attributes, in the person's words (null: they can be saved). */
export function attributeProblem(rows: readonly AttributeRow[], brands: readonly string[], t: Copy): string | null {
  const selected = rows.filter((row) => row.selected);
  const [issue] = attributeIssues(selected, brands);
  if (!issue) return null;
  if (issue.kind === 'count') return t(`Select ${ATTRIBUTE_MIN} to ${ATTRIBUTE_MAX} attributes.`, `Selecione de ${ATTRIBUTE_MIN} a ${ATTRIBUTE_MAX} atributos.`);
  return `${selected[issue.index]?.name.trim() || t('An attribute', 'Um atributo')}: ${attributeIssueText(issue, t)}`;
}

/**
 * Semantic Branding's attributes as an editable table (shell.md section 8, Editable cells): select 3 to 10, edit a name or a definition
 * in its cell, add one, remove one, ask suggestions again. `showIssues`: the cells the rule refuses are marked (after a first try).
 */
export function SemanticAttributesCard({
  rows,
  onChange,
  onSuggest,
  suggesting,
  brands,
  showIssues,
  t,
}: {
  rows: AttributeRow[];
  onChange: (rows: AttributeRow[]) => void;
  onSuggest: () => void;
  suggesting: boolean;
  /** The project's brands: no attribute may name one. */
  brands: readonly string[];
  showIssues: boolean;
  t: Copy;
}) {
  const selected = rows.filter((row) => row.selected);
  const issues = showIssues ? attributeIssues(selected, brands) : [];
  const flagged = (row: AttributeRow, part: 'name' | 'definition') =>
    issues.some((issue) => issue.kind !== 'count' && selected[issue.index]?.key === row.key && (part === 'definition' ? issue.kind === 'definition' : issue.kind !== 'definition')) || undefined;
  // An edited suggestion is the person's from then on: a new suggestion never replaces it.
  const patch = (key: string, change: Partial<AttributeRow>) => onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  let table: ReactNode;
  if (rows.length || suggesting)
    table = (
      <DataTable
        singleLine="wide"
        minWidth={0}
        loading={suggesting && !rows.length ? LOADING_ROWS : undefined}
        ariaLabel={t('Semantic Branding attributes', 'Atributos do Semantic Branding')}
        rows={rows}
        rowKey={(row) => row.key}
        columns={[
          selectColumn<AttributeRow>(<span className="sr-only">{t('Selected', 'Selecionado')}</span>, (row, index) => (
            <Checkbox aria-label={t(`Select attribute ${row.name || index + 1}`, `Selecionar atributo ${row.name || index + 1}`)} checked={row.selected} onCheckedChange={(checked) => patch(row.key, { selected: checked })} />
          )),
          {
            key: 'name',
            header: t('Attribute', 'Atributo'),
            mobile: 'title',
            width: '12rem',
            cell: (row, index) => (
              <Textarea {...oneLine} aria-label={t(`Attribute ${index + 1}`, `Atributo ${index + 1}`)} placeholder={t('Name, e.g. Price', 'Nome, ex.: Preço')} maxLength={NAME_MAX} value={row.name} aria-invalid={flagged(row, 'name')} onChange={(event) => patch(row.key, { name: line(event.target.value), ai: false })} />
            ),
          },
          {
            key: 'definition',
            header: t('Definition', 'Definição'),
            label: t('Definition', 'Definição'),
            mobile: 'wide',
            cell: (row, index) => (
              <Textarea {...oneLine} aria-label={t(`Definition of attribute ${row.name || index + 1}`, `Definição do atributo ${row.name || index + 1}`)} placeholder={t('What is evaluated, in 100 to 200 characters, naming no brand', 'O que se avalia, em 100 a 200 caracteres, sem citar marcas')} maxLength={DEFINITION_MAX + 40} value={row.description} aria-invalid={flagged(row, 'definition')} onChange={(event) => patch(row.key, { description: line(event.target.value), ai: false })} />
            ),
          },
          removeColumn<AttributeRow>(t('Remove', 'Remover'), (row, index) => t(`Remove attribute ${row.name || index + 1}`, `Remover atributo ${row.name || index + 1}`), (index) => onChange(rows.filter((_, at) => at !== index))),
        ]}
      />
    );
  else
    table = (
      <EmptyState
        frame="bare"
        title={t('No attributes yet.', 'Nenhum atributo ainda.')}
        description={t('Use “Suggest attributes”, or add the ones the AIs should judge each brand on: 3 to 10, each with a neutral definition.', 'Use “Sugerir atributos”, ou adicione aqueles em que as IAs devem avaliar cada marca: de 3 a 10, cada um com uma definição neutra.')}
      />
    );
  return (
    <SectionCard
      title={t('Attributes', 'Atributos')}
      info={t(
        `Every brand is scored on the same attributes, with none marked as yours. Choose ${ATTRIBUTE_MIN} to ${ATTRIBUTE_MAX}, each with a neutral definition of ${DEFINITION_MIN} to ${DEFINITION_MAX} characters that says what is evaluated and names no brand: the AIs read it with the attribute.`,
        `Todas as marcas recebem nota nos mesmos atributos, sem nenhuma marcada como sua. Escolha de ${ATTRIBUTE_MIN} a ${ATTRIBUTE_MAX}, cada um com uma definição neutra de ${DEFINITION_MIN} a ${DEFINITION_MAX} caracteres que diga o que se avalia e não cite marcas: as IAs a leem junto com o atributo.`,
      )}
      description={suggesting && rows.length ? <LiveLabel>{t('Suggesting attributes…', 'Sugerindo atributos…')}</LiveLabel> : undefined}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-muted-foreground tabular-nums">{t(`${selected.length} of ${ATTRIBUTE_MAX}`, `${selected.length} de ${ATTRIBUTE_MAX}`)}</span>
          <Button variant="outline" pending={suggesting} onClick={onSuggest}>{t('Suggest attributes', 'Sugerir atributos')}</Button>
          <Button variant="outline" disabled={rows.length >= ATTRIBUTE_MAX * 2} onClick={() => onChange([...rows, { key: crypto.randomUUID(), name: '', description: '', selected: true }])}>
            {t('Add attribute', 'Adicionar atributo')}
          </Button>
        </div>
      }
    >
      {table}
    </SectionCard>
  );
}

export function SemanticAttributeWizard({
  onClose,
  configuration,
  brands,
  brandsLink,
  path,
  request,
  onSaved,
  t,
}: {
  onClose: () => void;
  configuration: WizardConfiguration;
  brands: { name: string; domain: string }[];
  brandsLink: { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
  /** The project's `/semantic` endpoint: PATCH saves, `/attributes` suggests. */
  path: string;
  request: typeof requestJson;
  onSaved: (configuration: WizardConfiguration) => void;
  t: Copy;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [items, setItems] = useState<AttributeRow[]>(() => rowsOf(configuration.attributes));
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const names = brands.map((brand) => brand.name);
  const selected = items.filter((item) => item.selected);
  const problem = attributeProblem(items, names, t);
  const unchanged =
    JSON.stringify(selected.map((item) => [item.id ?? null, item.name.trim(), item.description.trim()])) ===
    JSON.stringify(configuration.attributes.map((attribute) => [attribute.id, attribute.name, attribute.description ?? '']));

  const reset = () => {
    setStep(1);
    setItems(rowsOf(configuration.attributes));
    setNotice('');
    setError('');
  };
  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const suggest = async () => {
    setGenerating(true);
    setNotice('');
    try {
      const { attributes } = await request<{ attributes: SuggestedAttribute[] }>(`${path}/attributes`, 'POST', {});
      setItems((list) => {
        // New suggestions replace the ones not chosen; the chosen ones and the ones written by hand stay.
        const kept = list.filter((item) => item.selected || !item.ai);
        const fresh = attributes
          .filter((attribute) => !kept.some((item) => fold(item.name) === fold(attribute.name)))
          .map((attribute) => ({ key: crypto.randomUUID(), name: attribute.name, description: attribute.description, selected: false, ai: true }));
        return [...kept, ...fresh];
      });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setGenerating(false);
    }
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await request<WizardConfiguration>(path, 'PATCH', {
        enabled: configuration.enabled,
        attributes: selected.map((item) => ({ ...(item.id ? { id: item.id } : {}), name: item.name.trim(), description: item.description.trim() })),
        expectedRevision: configuration.revision,
      });
      onSaved({ revision: saved.revision, enabled: saved.enabled, attributes: saved.attributes });
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const title = step === 1 ? t('Brands compared', 'Marcas comparadas') : step === 2 ? t('Attributes', 'Atributos') : t('Review and save', 'Revisar e salvar');
  return (
    <DetailPage className="semantic-wizard">
      <DetailHeader
        leading={
          <Hint text={t('Back to Semantic Branding', 'Voltar ao Semantic Branding')}>
            <Button variant="ghost" size="icon" aria-label={t('Back to Semantic Branding', 'Voltar ao Semantic Branding')} disabled={saving} onClick={close}>
              <ArrowLeft />
            </Button>
          </Hint>
        }
        title={<h1>{title}</h1>}
        meta={t(`Step ${step} of 3`, `Passo ${step} de 3`)}
        actions={
          <div className="flex items-center gap-2">
          {step > 1 && (
              <Button type="button" variant="outline" disabled={generating || saving} onClick={() => setStep(step === 3 ? 2 : 1)}>
                {t('Back', 'Voltar')}
              </Button>
            )}
            {step === 1 && (
              <Button type="button" onClick={() => setStep(2)}>
                {t('Continue', 'Continuar')}
              </Button>
            )}
            {step === 2 && (
              <Button type="button" disabled={generating || !!problem} onClick={() => setStep(3)}>
                {t('Review', 'Revisar')}
              </Button>
            )}
            {step === 3 && (
              <Button type="button" disabled={saving || unchanged} onClick={save}>
                {saving && <Spinner />}
                {t('Save attributes', 'Salvar atributos')}
              </Button>
            )}
          </div>
        }
      />
      <DetailBody className="grid gap-6">
        {step === 1 && (
          <div className="grid gap-4">
            <p className="text-body text-muted-foreground">
              {t(
                'Every brand is scored on the same attributes, with none marked as yours. The AI suggests attributes for the segment of these brands.',
                'Todas as marcas recebem nota nos mesmos atributos, sem nenhuma marcada como sua. A IA sugere atributos do segmento destas marcas.',
              )}
            </p>
            <ul className="grid gap-2">
              {brands.map((brand) => (
                <li key={brand.name} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 text-body">
                  <span className="font-(--weight-label)">{brand.name}</span>
                  <span className="text-caption text-muted-foreground">{brand.domain}</span>
                </li>
              ))}
            </ul>
            <a
              className="text-body underline underline-offset-4"
              href={brandsLink.href}
              onClick={(event) => {
                close();
                brandsLink.onClick(event);
              }}
            >
              {t('Edit the brands', 'Editar as marcas')}
            </a>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3">
            <SemanticAttributesCard rows={items} onChange={setItems} onSuggest={() => void suggest()} suggesting={generating} brands={names} showIssues t={t} />
            {notice ? <Note tone="danger" className="px-0">{notice}</Note> : problem && <Note className="px-0">{problem}</Note>}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4">
            <dl className="grid gap-3">
              {selected.map((item) => (
                <div key={item.key} className="border-b border-border pb-3">
                  <dt className="text-body font-(--weight-label)">{item.name.trim()}</dt>
                  <dd className="mt-1 text-body text-muted-foreground">{item.description.trim()}</dd>
                </div>
              ))}
            </dl>
            <p className="text-body text-muted-foreground">
              {unchanged
                ? t('Nothing changed.', 'Nada mudou.')
                : t(
                    'From the next collection on, the AIs are asked about these attributes and a new series starts. The history stays visible with the previous attributes.',
                    'A partir da próxima coleta, as IAs são perguntadas sobre estes atributos e começa uma série nova. O histórico continua visível com os atributos anteriores.',
                  )}
            </p>
            {error && <p role="alert" className="text-body text-destructive">{error}</p>}
          </div>
        )}

      </DetailBody>
    </DetailPage>
  );
}
