'use client';
// The New project wizard's Comparison step (13/11/2026): the suggested products, their attributes and the personas, each editable in place
// as the other steps' tables (wizard-cells.tsx): rename a cell, add a row, remove one, select what goes with the project. Each product keeps
// its attributes as chips (pressed: compared on it); the attributes and the personas' "for …" are edited in their own tables. A suggestion
// asked again replaces only the rows the person has not touched. What is selected becomes the project's Comparison (draftConfig).
import type { ReactNode } from 'react';
import { COMPARISON_LIMITS, EMPTY_COMPARISON, withSuggestions, type ComparisonConfig, type ComparisonOption, type ComparisonSuggestions } from '@/lib/comparison';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Hint } from '@/components/ui/tooltip';
import { LiveLabel } from '@/components/ui/live-label';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { EmptyState } from './shared';
import { LOADING_ROWS, line, oneLine, removeColumn, selectColumn } from './wizard-cells';

type Copy = (en: string, pt: string) => string;
/** `ai`: a suggestion the person has not edited (a new suggestion replaces it; an edited or added row stays). */
export type DraftAttribute = { key: string; name: string; description: string; group: string; ai?: boolean };
/** `attributes`: the keys of the attributes it is compared on. */
export type DraftProduct = { key: string; name: string; attributes: string[]; selected: boolean; ai?: boolean };
export type DraftPersona = { key: string; name: string; description: string; selected: boolean; ai?: boolean };
export type ComparisonDraft = { products: DraftProduct[]; attributes: DraftAttribute[]; personas: DraftPersona[] };

const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const key = () => crypto.randomUUID();

/**
 * A suggestion as the step's rows, over what the person already has (`current`): their own rows stay, the rows still as suggested are
 * replaced, and an attribute already there by name is reused. The first products start selected, within the plan's room (`limit`, at most
 * three), every persona selected.
 */
export function draftOf(suggestions: ComparisonSuggestions, limit: number, current: ComparisonDraft | null = null): ComparisonDraft {
  const products = current?.products.filter((item) => !item.ai) ?? [];
  const personas = current?.personas.filter((item) => !item.ai) ?? [];
  const kept = new Set(products.flatMap((item) => item.attributes));
  const attributes = current?.attributes.filter((item) => !item.ai || kept.has(item.key)) ?? [];
  for (const item of suggestions.attributes)
    if (!attributes.some((known) => fold(known.name) === fold(item.name))) attributes.push({ key: key(), name: item.name, description: item.description, group: item.group, ai: true });
  const keyOf = (name: string) => attributes.find((item) => fold(item.name) === fold(name))?.key;
  let room = Math.max(0, Math.min(3, limit) - products.filter((item) => item.selected).length);
  for (const item of suggestions.products) {
    if (products.some((known) => fold(known.name) === fold(item.name))) continue;
    products.push({ key: key(), name: item.name, attributes: item.attributes.flatMap((name) => keyOf(name) ?? []), selected: room-- > 0, ai: true });
  }
  for (const item of suggestions.personas)
    if (!personas.some((known) => fold(known.name) === fold(item.name))) personas.push({ key: key(), name: item.name, description: item.description, selected: true, ai: true });
  return { products, attributes, personas };
}

/** What is selected, named: the products and personas that go with the project. */
export const draftPicked = (draft: ComparisonDraft | null) => ({
  products: draft?.products.filter((item) => item.selected) ?? [],
  personas: draft?.personas.filter((item) => item.selected) ?? [],
});

/** What stops the step, in the person's words (null: it can go on; nothing selected also goes on, as a skip). */
export function draftProblem(draft: ComparisonDraft | null, t: Copy): string | null {
  const { products, personas } = draftPicked(draft);
  if (!draft || !products.length) return null;
  const used = draft.attributes.filter((item) => products.some((product) => product.attributes.includes(item.key)));
  const short = [...products, ...personas, ...used].find((item) => item.name.trim().length < 2);
  if (short) return t('Name every selected product, attribute and persona, with at least 2 characters.', 'Dê nome a cada produto, atributo e persona selecionados, com pelo menos 2 caracteres.');
  const repeated = (names: string[]) => new Set(names.map(fold)).size !== names.length;
  if (repeated(products.map((item) => item.name)) || repeated(draft.attributes.filter((item) => item.name.trim()).map((item) => item.name)) || repeated(personas.map((item) => item.name)))
    return t('Do not repeat a product, an attribute or a persona.', 'Não repita um produto, um atributo ou uma persona.');
  const bare = products.find((item) => !item.attributes.length);
  if (bare) return t(`Choose at least one attribute for ${bare.name.trim()}.`, `Escolha pelo menos um atributo para ${bare.name.trim()}.`);
  const many = products.find((item) => item.attributes.length > COMPARISON_LIMITS.productAttributes);
  if (many) return t(`${many.name.trim()}: choose up to ${COMPARISON_LIMITS.productAttributes} attributes.`, `${many.name.trim()}: escolha até ${COMPARISON_LIMITS.productAttributes} atributos.`);
  if (!personas.length) return t('Select at least one persona, or skip this step.', 'Selecione pelo menos uma persona, ou pule esta etapa.');
  return null;
}

/** The project's Comparison from what is selected, each product compared with `competitors`; null when nothing is. */
export function draftConfig(draft: ComparisonDraft | null, competitors: ComparisonOption[]): ComparisonConfig | null {
  const { products, personas } = draftPicked(draft);
  if (!draft || !products.length || !competitors.length) return null;
  const byKey = new Map(draft.attributes.map((item) => [item.key, item]));
  const used = new Set(products.flatMap((item) => item.attributes));
  return withSuggestions(EMPTY_COMPARISON, {
    products: products.map((item) => ({ name: item.name.trim(), attributes: item.attributes.flatMap((at) => byKey.get(at)?.name.trim() ?? []) })),
    attributes: draft.attributes.filter((item) => used.has(item.key)).map((item) => ({ name: item.name.trim(), description: item.description.trim(), group: item.group })),
    personas: personas.map((item) => ({ name: item.name.trim(), description: item.description.trim() })),
  }, competitors.slice(0, COMPARISON_LIMITS.competitors));
}

export function WizardComparisonStep({ draft, onChange, onSuggest, limit, loading, failure, noCompetitors, attempted, t }: {
  draft: ComparisonDraft | null;
  onChange: (next: ComparisonDraft) => void;
  /** Asks the suggestions again (a paid call): rows the person edited stay. */
  onSuggest: () => void;
  /** The plan's room for products. */
  limit: number;
  loading: boolean;
  failure: ReactNode;
  noCompetitors: boolean;
  attempted: boolean;
  t: Copy;
}) {
  const current = draft ?? { products: [], attributes: [], personas: [] };
  const { products: picked } = draftPicked(draft);
  const set = <K extends keyof ComparisonDraft>(part: K, rows: ComparisonDraft[K]) => onChange({ ...current, [part]: rows });
  // An edited row is the person's from then on: a new suggestion never replaces it.
  const patch = <K extends keyof ComparisonDraft>(part: K, at: string, change: Partial<ComparisonDraft[K][number]>) =>
    set(part, (current[part] as { key: string }[]).map((item) => (item.key === at ? { ...item, ...change, ai: false } : item)) as ComparisonDraft[K]);
  const remove = <K extends keyof ComparisonDraft>(part: K, index: number) => {
    const gone = current[part][index]?.key;
    // An attribute removed leaves every product that used it.
    if (part === 'attributes') return onChange({ ...current, attributes: current.attributes.filter((item) => item.key !== gone), products: current.products.map((item) => ({ ...item, attributes: item.attributes.filter((at) => at !== gone) })) });
    set(part, (current[part] as { key: string }[]).filter((item) => item.key !== gone) as ComparisonDraft[K]);
  };
  const invalid = (value: string, selected = true) => (attempted && selected && value.trim().length < 2 ? true : undefined);
  const full = picked.length >= limit;
  const busyTable = loading && !draft;
  const label = (en: string, pt: string) => t(en, pt);
  return (
    <>
      {failure}
      {noCompetitors && (
        <Note className="px-0 py-0">{t('Comparison compares your products with your competitors’: add competitors in their step, or skip this one and set it up later.', 'A Comparação compara os seus produtos com os dos concorrentes: adicione concorrentes na etapa deles, ou pule esta e configure depois.')}</Note>
      )}
      <SectionCard
        title={t('Products', 'Produtos')}
        description={loading && draft ? <LiveLabel>{t('Generating products to compare with AI…', 'Gerando produtos para comparar com IA…')}</LiveLabel> : undefined}
        info={t(`Up to ${limit} products, each compared with your competitors on its attributes. Click a cell to edit it; press a chip to compare on that attribute.`, `Até ${limit} produtos, cada um comparado com os seus concorrentes nos atributos dele. Clique numa célula para editar; pressione um chip para comparar nesse atributo.`)}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-muted-foreground tabular-nums">{t(`${picked.length} of ${limit}`, `${picked.length} de ${limit}`)}</span>
            <Button variant="outline" pending={loading} onClick={onSuggest}>{t('Suggest products', 'Sugerir produtos')}</Button>
            <Button variant="outline" disabled={current.products.length >= COMPARISON_LIMITS.products} onClick={() => set('products', [...current.products, { key: key(), name: '', attributes: [], selected: !full }])}>
              {t('Add product', 'Adicionar produto')}
            </Button>
          </div>
        }
      >
        {current.products.length || busyTable ? (
          <DataTable
            singleLine="wide"
            minWidth={0}
            loading={busyTable ? LOADING_ROWS : undefined}
            ariaLabel={t('Products', 'Produtos')}
            rows={current.products}
            rowKey={(row) => row.key}
            columns={[
              selectColumn<DraftProduct>(<span className="sr-only">{t('Selected', 'Selecionado')}</span>, (row, index) => (
                <Checkbox aria-label={t(`Select product ${row.name || index + 1}`, `Selecionar produto ${row.name || index + 1}`)} checked={row.selected} disabled={!row.selected && full} onCheckedChange={(checked) => patch('products', row.key, { selected: checked })} />
              )),
              {
                key: 'product',
                header: t('Product', 'Produto'),
                mobile: 'title',
                width: '16rem',
                cell: (row, index) => (
                  <Textarea {...oneLine} aria-label={t(`Product ${index + 1}`, `Produto ${index + 1}`)} placeholder={t('E.g. running shoes', 'Ex.: tênis de corrida')} maxLength={COMPARISON_LIMITS.name} value={row.name} aria-invalid={invalid(row.name, row.selected)} onChange={(event) => patch('products', row.key, { name: line(event.target.value) })} />
                ),
              },
              {
                key: 'attributes',
                header: t('Attributes', 'Atributos'),
                label: t('Attributes', 'Atributos'),
                mobile: 'wide',
                cell: (row) => current.attributes.length ? (
                  // One compact row per product: the attributes as chips (pressed: compared on it), each definition in its balloon.
                  <ToggleGroup
                    multiple
                    variant="outline"
                    size="sm"
                    className="flex-wrap py-1"
                    aria-label={t(`Attributes of ${row.name || 'the product'}`, `Atributos de ${row.name || 'o produto'}`)}
                    value={row.attributes}
                    onValueChange={(value) => patch('products', row.key, { attributes: current.attributes.map((item) => item.key).filter((at) => value.includes(at)).slice(0, COMPARISON_LIMITS.productAttributes) })}
                  >
                    {current.attributes.map((item) => {
                      const chip = <ToggleGroupItem key={item.key} value={item.key}>{item.name.trim() || t('Unnamed', 'Sem nome')}</ToggleGroupItem>;
                      return item.description ? <Hint key={item.key} text={item.description}>{chip}</Hint> : chip;
                    })}
                  </ToggleGroup>
                ) : <span className="text-muted-foreground">{t('Add an attribute below', 'Adicione um atributo abaixo')}</span>,
              },
              removeColumn<DraftProduct>(label('Remove', 'Remover'), (row, index) => t(`Remove product ${row.name || index + 1}`, `Remover produto ${row.name || index + 1}`), (index) => remove('products', index)),
            ]}
          />
        ) : (
          <EmptyState frame="bare" title={t('No products yet.', 'Nenhum produto ainda.')} description={t('Use “Suggest products”, add one, or skip this step: you can set up Comparison later on its own screen.', 'Use “Sugerir produtos”, adicione um, ou pule esta etapa: dá para configurar a Comparação depois na tela dela.')} />
        )}
      </SectionCard>
      <SectionCard
        title={t('Attributes', 'Atributos')}
        info={t('What buyers compare the options on, shared by the products. The AIs score every option on each attribute of a product, with a fact.', 'O que os compradores comparam nas opções, compartilhado pelos produtos. As IAs dão nota a cada opção em cada atributo de um produto, com um fato.')}
        action={
          <Button variant="outline" disabled={current.attributes.length >= COMPARISON_LIMITS.attributes} onClick={() => set('attributes', [...current.attributes, { key: key(), name: '', description: '', group: '' }])}>
            {t('Add attribute', 'Adicionar atributo')}
          </Button>
        }
      >
        {current.attributes.length || busyTable ? (
          <DataTable
            singleLine="wide"
            minWidth={0}
            loading={busyTable ? LOADING_ROWS : undefined}
            ariaLabel={t('Attributes', 'Atributos')}
            rows={current.attributes}
            rowKey={(row) => row.key}
            columns={[
              {
                key: 'attribute',
                header: t('Attribute', 'Atributo'),
                mobile: 'title',
                width: '16rem',
                cell: (row, index) => (
                  <Textarea {...oneLine} aria-label={t(`Attribute ${index + 1}`, `Atributo ${index + 1}`)} placeholder={t('E.g. price', 'Ex.: preço')} maxLength={COMPARISON_LIMITS.name} value={row.name} aria-invalid={invalid(row.name, picked.some((product) => product.attributes.includes(row.key)))} onChange={(event) => patch('attributes', row.key, { name: line(event.target.value) })} />
                ),
              },
              {
                key: 'description',
                header: t('Definition', 'Definição'),
                label: t('Definition', 'Definição'),
                mobile: 'wide',
                cell: (row, index) => (
                  <Textarea variant="cell" rows={1} aria-label={t(`Definition of attribute ${index + 1}`, `Definição do atributo ${index + 1}`)} placeholder={t('Optional, a neutral definition', 'Opcional, uma definição neutra')} maxLength={COMPARISON_LIMITS.description} value={row.description} onChange={(event) => patch('attributes', row.key, { description: line(event.target.value) })} />
                ),
              },
              removeColumn<DraftAttribute>(label('Remove', 'Remover'), (row, index) => t(`Remove attribute ${row.name || index + 1}`, `Remover atributo ${row.name || index + 1}`), (index) => remove('attributes', index)),
            ]}
          />
        ) : (
          <EmptyState frame="bare" title={t('No attributes yet.', 'Nenhum atributo ainda.')} description={t('Attributes are what buyers compare: price, delivery time, support.', 'Atributos são o que os compradores comparam: preço, prazo, suporte.')} />
        )}
      </SectionCard>
      <SectionCard
        title={t('Personas', 'Personas')}
        info={t('Who buys: each product is asked once per persona, as “Which … is best for …?”.', 'Quem compra: cada produto é perguntado uma vez por persona, como “Qual … é melhor para …?”.')}
        action={
          <Button variant="outline" disabled={current.personas.length >= COMPARISON_LIMITS.personas} onClick={() => set('personas', [...current.personas, { key: key(), name: '', description: '', selected: true }])}>
            {t('Add persona', 'Adicionar persona')}
          </Button>
        }
      >
        {current.personas.length || busyTable ? (
          <DataTable
            singleLine="wide"
            minWidth={0}
            loading={busyTable ? LOADING_ROWS : undefined}
            ariaLabel={t('Personas', 'Personas')}
            rows={current.personas}
            rowKey={(row) => row.key}
            columns={[
              selectColumn<DraftPersona>(<span className="sr-only">{t('Selected', 'Selecionado')}</span>, (row, index) => (
                <Checkbox aria-label={t(`Select persona ${row.name || index + 1}`, `Selecionar persona ${row.name || index + 1}`)} checked={row.selected} onCheckedChange={(checked) => patch('personas', row.key, { selected: checked })} />
              )),
              {
                key: 'persona',
                header: t('Persona', 'Persona'),
                mobile: 'title',
                width: '16rem',
                cell: (row, index) => (
                  <Textarea {...oneLine} aria-label={t(`Persona ${index + 1}`, `Persona ${index + 1}`)} placeholder={t('E.g. Small business owner', 'Ex.: Dono de pequena empresa')} maxLength={COMPARISON_LIMITS.name} value={row.name} aria-invalid={invalid(row.name, row.selected)} onChange={(event) => patch('personas', row.key, { name: line(event.target.value) })} />
                ),
              },
              {
                key: 'description',
                header: t('For …', 'Para …'),
                label: t('For …', 'Para …'),
                mobile: 'wide',
                cell: (row, index) => (
                  <Textarea variant="cell" rows={1} aria-label={t(`Who persona ${index + 1} is, completing “for …”`, `Quem é a persona ${index + 1}, completando “para …”`)} placeholder={t('a small business owner who wants to sell more online', 'um dono de pequena empresa que quer vender mais pela internet')} maxLength={COMPARISON_LIMITS.description} value={row.description} onChange={(event) => patch('personas', row.key, { description: line(event.target.value) })} />
                ),
              },
              removeColumn<DraftPersona>(label('Remove', 'Remover'), (row, index) => t(`Remove persona ${row.name || index + 1}`, `Remover persona ${row.name || index + 1}`), (index) => remove('personas', index)),
            ]}
          />
        ) : (
          <EmptyState frame="bare" title={t('No personas yet.', 'Nenhuma persona ainda.')} description={t('Personas are who buys: every product is asked about for each of them.', 'Personas são quem compra: cada produto é perguntado para cada uma delas.')} />
        )}
      </SectionCard>
    </>
  );
}
