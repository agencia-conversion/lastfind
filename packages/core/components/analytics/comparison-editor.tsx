'use client';

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { EllipsisVertical, X } from 'lucide-react';
import { requestJson } from '@/lib/client';
import { attributeId } from '@/lib/semantic-attributes';
import {
  COMPARISON_LIMITS,
  withSuggestions,
  type ComparisonAttribute,
  type ComparisonConfig,
  type ComparisonOption,
  type ComparisonPersona,
  type ComparisonProduct,
  type ComparisonSuggestions,
} from '@/lib/comparison';
import type { ComparisonReport } from '@/lib/server/comparison';
import { DataTable, DataTableScreen, DataTableToolbar, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { InfoHint } from '@/components/lastfind/presentation/info-hint';
import { Note } from '@/components/lastfind/presentation/note';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { EmptyState, SearchField, SiteFavicon, useCopy, useNumbers } from './shared';
import { Missing, detailPage, type ComparisonSection, type ComparisonSettings } from './comparison-view';
import { DrillLink, type Linker } from './drill-link';

type Translate = (en: string, pt: string) => string;
type Save = (config: ComparisonConfig) => Promise<void>;
type Dialogs =
  | { kind: 'product'; id?: string }
  | { kind: 'attribute'; id?: string }
  | { kind: 'persona'; id?: string }
  | { kind: 'suggest'; personasOnly: boolean }
  | null;
type Deleting = { kind: 'product' | 'attribute' | 'persona'; id: string; name: string } | null;

const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** A new item's id, unique among every product, attribute and persona (so a save never renames an existing one). */
const newId = (config: ComparisonConfig, name: string) => attributeId(name, new Set([...config.products, ...config.attributes, ...config.personas].map((item) => item.id)));
const byName = <T extends { name: string }>(items: T[]) => [...items].sort((a, b) => a.name.localeCompare(b.name));

/** The ⋮ menu of a row: Edit and Delete. */
function RowMenu({ name, onEdit, onDelete }: { name: string; onEdit: () => void; onDelete: () => void }) {
  const t = useCopy();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={`${t('Actions', 'Ações')} ${name}`} />}>
        <EllipsisVertical size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>{t('Edit', 'Editar')}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>{t('Delete', 'Excluir')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
const actionsColumn = <T,>(t: Translate, cell: (row: T) => ReactNode): DataColumn<T> => ({
  key: 'actions',
  width: 48,
  header: <span className="sr-only">{t('Actions', 'Ações')}</span>,
  mobile: 'actions',
  align: 'end',
  cell,
});

/**
 * Comparison's editing pages (products, the attribute library, personas): one table each, their dialogs and confirmations.
 * Every change saves the whole configuration as a new revision (`onSave`); viewers see the tables without the actions.
 */
export function ComparisonPage({
  view,
  settings,
  report,
  canEdit,
  onSave,
  projectId,
  link,
}: {
  view: Exclude<ComparisonSection, 'overview'>;
  settings: ComparisonSettings;
  report: ComparisonReport | null;
  canEdit: boolean;
  onSave: Save;
  projectId: string;
  link: Linker;
}) {
  const t = useCopy();
  const { number, percent } = useNumbers();
  const config = settings.config;
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [deleting, setDeleting] = useState<Deleting>(null);
  const [busy, setBusy] = useState(false);
  // The list's search, as Brands': the rows whose texts hold it (the page's own; a new page starts empty).
  const [search, setSearch] = useState('');
  const needle = fold(search);
  const found = <T,>(rows: T[], texts: (row: T) => string[]) => (needle ? rows.filter((row) => texts(row).some((text) => fold(text).includes(needle))) : rows);
  const searchField = (placeholder: string) => <SearchField value={search} onChange={setSearch} placeholder={placeholder} />;
  const noMatch = <EmptyState title={t('Nothing matches this search', 'Nada corresponde a esta busca')} description={t('Try another search.', 'Tente outra busca.')} />;
  const run = async (next: ComparisonConfig, done?: string) => {
    setBusy(true);
    try {
      await onSave(next);
      if (done) toast.add({ title: done, type: 'success' });
      return true;
    } catch (error) {
      toast.add({ title: message(error), type: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!deleting) return;
    const { kind, id } = deleting;
    const next: ComparisonConfig =
      kind === 'product'
        ? { ...config, products: config.products.filter((item) => item.id !== id) }
        : kind === 'persona'
          ? { ...config, personas: config.personas.filter((item) => item.id !== id) }
          : { ...config, attributes: config.attributes.filter((item) => item.id !== id), products: config.products.map((item) => ({ ...item, attributes: item.attributes.filter((attribute) => attribute !== id) })) };
    if (await run(next)) setDeleting(null);
  };
  const full = settings.productLimit != null && config.products.length >= settings.productLimit;
  const usedBy = (id: string) => config.products.filter((item) => item.attributes.includes(id)).length;
  const attributeName = new Map(config.attributes.map((item) => [item.id, item.name]));
  const dialogs = (
    <>
      {dialog?.kind === 'product' && <ProductDialog settings={settings} id={dialog.id} onClose={() => setDialog(null)} onSave={onSave} />}
      {dialog?.kind === 'attribute' && <AttributeDialog config={config} id={dialog.id} onClose={() => setDialog(null)} onSave={onSave} />}
      {dialog?.kind === 'persona' && <PersonaDialog config={config} id={dialog.id} onClose={() => setDialog(null)} onSave={onSave} />}
      {dialog?.kind === 'suggest' && <SuggestDialog settings={settings} projectId={projectId} personasOnly={dialog.personasOnly} onClose={() => setDialog(null)} onSave={onSave} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && !busy && setDeleting(null)}
        destructive
        pending={busy}
        title={deleting ? t(`Delete ${deleting.name}?`, `Excluir ${deleting.name}?`) : ''}
        description={
          deleting?.kind === 'attribute'
            ? t(`It leaves the library and the ${number(usedBy(deleting.id))} products that use it. Answers already read keep it.`, `Ele sai da biblioteca e dos ${number(usedBy(deleting.id))} produtos que o usam. As respostas já lidas o mantêm.`)
            : t('It is no longer asked from the next collection. Answers already read stay in the report.', 'Deixa de ser perguntado a partir da próxima coleta. As respostas já lidas continuam no relatório.')
        }
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={t('Delete', 'Excluir')}
        onConfirm={() => void remove()}
      />
    </>
  );

  if (view === 'products') {
    const stat = (id: string) => report?.products.find((item) => item.id === id);
    const noAnswers = t('No answer read for it in this period yet', 'Nenhuma resposta lida para ele neste período ainda');
    const columns: DataColumn<ComparisonProduct>[] = [
      // The name opens the product's page: its scores against each competitor, their evolution and the facts behind them.
      { key: 'product', header: t('Product', 'Produto'), mobile: 'title', width: '28rem', shrinkTo: '12rem', sortValue: (row) => row.name, cell: (row) => <DrillLink link={link} to={detailPage('products', row.id)} className="min-w-0 truncate">{row.name}</DrillLink> },
      {
        key: 'competitors',
        header: t('Competitors', 'Concorrentes'),
        label: t('Competitors', 'Concorrentes'),
        maxWidth: '20rem',
        // A list of names: its own full line on a phone, never beside another value.
        mobile: 'wide',
        hint: (row) => row.competitors.map((item) => item.name).join(', '),
        cell: (row) => row.competitors.map((item) => item.name).join(', '),
      },
      {
        key: 'attributes',
        header: t('Attributes', 'Atributos'),
        label: t('Attributes', 'Atributos'),
        maxWidth: '20rem',
        // A list of names: its own full line on a phone, never beside another value.
        mobile: 'wide',
        hint: (row) => row.attributes.map((id) => attributeName.get(id) ?? id).join(', '),
        cell: (row) => row.attributes.map((id) => attributeName.get(id) ?? id).join(', '),
      },
      {
        key: 'score',
        sortValue: (row: ComparisonProduct) => stat(row.id)?.score ?? null,
        header: t('Score', 'Nota'),
        label: t('Score', 'Nota'),
        info: t('Your brand’s overall score from 0 to 100 in this product, in the header’s period and AIs.', 'A nota geral da sua marca de 0 a 100 neste produto, no período e nas IAs do cabeçalho.'),
        align: 'end',
        width: '6rem',
        cell: (row) => {
          const value = stat(row.id)?.score;
          return value == null ? <Missing reason={noAnswers} label={row.name} /> : number(value, 0);
        },
      },
      {
        key: 'winRate',
        sortValue: (row: ComparisonProduct) => stat(row.id)?.winRate ?? null,
        header: t('Win rate', 'Taxa de vitória'),
        label: t('Win rate', 'Taxa de vitória'),
        info: t('Your brand’s win rate in this product, in the header’s period and AIs.', 'A taxa de vitória da sua marca neste produto, no período e nas IAs do cabeçalho.'),
        align: 'end',
        width: '8rem',
        cell: (row) => {
          const value = stat(row.id)?.winRate;
          return value == null ? <Missing reason={noAnswers} label={row.name} /> : percent(value * 100, 0);
        },
      },
      {
        key: 'answers',
        sortValue: (row: ComparisonProduct) => stat(row.id)?.answers ?? null,
        header: t('Answers', 'Respostas'),
        label: t('Answers', 'Respostas'),
        align: 'end',
        width: '7rem',
        cell: (row) => {
          const value = stat(row.id)?.answers;
          return value == null ? <Missing reason={noAnswers} label={row.name} /> : number(value);
        },
      },
      ...(canEdit ? [actionsColumn<ComparisonProduct>(t, (row) => <RowMenu name={row.name} onEdit={() => setDialog({ kind: 'product', id: row.id })} onDelete={() => setDeleting({ kind: 'product', id: row.id, name: row.name })} />)] : []),
    ];
    const shownProducts = found(config.products, (row) => [row.name, ...row.competitors.map((item) => item.name), ...row.attributes.map((id) => attributeName.get(id) ?? id)]);
    return (
      <DataTableScreen>
        <DataTableToolbar
          label={t('Product filters', 'Filtros de produtos')}
          actions={
            <>
              {settings.productLimit != null && <InfoHint text={t(`Your plan compares up to ${settings.productLimit} products.`, `Seu plano compara até ${settings.productLimit} produtos.`)} />}
              {canEdit && <Button variant="outline" disabled={full} onClick={() => setDialog({ kind: 'product' })}>{t('Add product', 'Adicionar produto')}</Button>}
              {canEdit && <Button disabled={full} onClick={() => setDialog({ kind: 'suggest', personasOnly: false })}>{t('Generate products and attributes', 'Gerar produtos e atributos')}</Button>}
            </>
          }
        >
          {searchField(t('Search products, competitors or attributes', 'Buscar produtos, concorrentes ou atributos'))}
        </DataTableToolbar>
        {!config.products.length ? (
          <EmptyState
            title={t('No products yet', 'Nenhum produto ainda')}
            description={canEdit
              ? t('Generate the products you sell, with the attributes buyers compare them on, from your site; or add them one by one.', 'Gere os produtos que você vende, com os atributos que os compradores comparam, a partir do seu site; ou adicione um a um.')
              : t('An editor of this workspace sets up the products to compare.', 'Um editor deste workspace configura os produtos a comparar.')}
          />
        ) : shownProducts.length ? (
          <DataTable fill singleLine="wide" ariaLabel={t('Products', 'Produtos')} rows={shownProducts} rowKey={(row) => row.id} columns={columns} />
        ) : noMatch}
        {dialogs}
      </DataTableScreen>
    );
  }

  if (view === 'attributes') {
    const importSemantic = async () => {
      setBusy(true);
      try {
        const data = await requestJson<{ configuration?: { attributes?: { name?: unknown; description?: unknown }[] }; attributes?: { name?: unknown; description?: unknown }[] }>(`/api/projects/${encodeURIComponent(projectId)}/semantic`);
        const known = new Set(config.attributes.map((item) => fold(item.name)));
        let next = config;
        for (const item of data.configuration?.attributes ?? data.attributes ?? []) {
          const name = typeof item.name === 'string' ? item.name.trim() : '';
          if (!name || known.has(fold(name)) || next.attributes.length >= COMPARISON_LIMITS.attributes) continue;
          known.add(fold(name));
          next = { ...next, attributes: [...next.attributes, { id: newId(next, name), name, description: typeof item.description === 'string' ? item.description : '', group: 'Semantic Branding' }] };
        }
        const added = next.attributes.length - config.attributes.length;
        if (!added) toast.add({ title: t('No new attribute to import from Semantic Branding.', 'Nenhum atributo novo para importar do Semantic Branding.'), type: 'info' });
        else await run(next, t(`${number(added)} attributes imported.`, `${number(added)} atributos importados.`));
      } catch (error) {
        toast.add({ title: message(error), type: 'error' });
      } finally {
        setBusy(false);
      }
    };
    const columns: DataColumn<ComparisonAttribute>[] = [
      // The name opens the attribute's page: the brands' scores on it in each product, their evolution and the facts behind them.
      { key: 'attribute', header: t('Attribute', 'Atributo'), mobile: 'title', width: '20rem', shrinkTo: '12rem', sortValue: (row) => row.name, cell: (row) => <DrillLink link={link} to={detailPage('attributes', row.id)} className="min-w-0 truncate">{row.name}</DrillLink> },
      { key: 'group', header: t('Group', 'Grupo'), sortValue: (row) => row.group, label: t('Group', 'Grupo'), maxWidth: '14rem', hint: (row) => row.group || undefined, cell: (row) => row.group || <span className="text-muted-foreground">{t('No group', 'Sem grupo')}</span> },
      { key: 'description', header: t('Description', 'Descrição'), label: t('Description', 'Descrição'), maxWidth: '20rem', mobile: 'wide', hint: (row) => row.description || undefined, cell: (row) => row.description || <span className="text-muted-foreground">{t('No description', 'Sem descrição')}</span> },
      { key: 'products', header: t('Products', 'Produtos'), sortValue: (row) => usedBy(row.id), label: t('Products', 'Produtos'), info: t('How many products compare on it.', 'Quantos produtos são comparados nele.'), align: 'end', width: '7rem', cell: (row) => number(usedBy(row.id)) },
      ...(canEdit ? [actionsColumn<ComparisonAttribute>(t, (row) => <RowMenu name={row.name} onEdit={() => setDialog({ kind: 'attribute', id: row.id })} onDelete={() => setDeleting({ kind: 'attribute', id: row.id, name: row.name })} />)] : []),
    ];
    const shownAttributes = found([...config.attributes].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)), (row) => [row.name, row.group, row.description]);
    return (
      <DataTableScreen>
        <DataTableToolbar
          label={t('Attribute filters', 'Filtros de atributos')}
          actions={
            <>
              <InfoHint text={t('The library of attributes the products are compared on, reused by every product that shares them. Groups keep related ones together.', 'A biblioteca de atributos em que os produtos são comparados, reaproveitados por todo produto que os compartilha. Os grupos mantêm juntos os relacionados.')} />
              {canEdit && <Button disabled={config.attributes.length >= COMPARISON_LIMITS.attributes} onClick={() => setDialog({ kind: 'attribute' })}>{t('Add attribute', 'Adicionar atributo')}</Button>}
              {/* The import is optional, never the default: in the ⋮ menu after the main action (shell.md section 6). */}
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button size="icon" variant="ghost" aria-label={t('More actions', 'Mais ações')} disabled={busy} />}>
                    <EllipsisVertical size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={busy || config.attributes.length >= COMPARISON_LIMITS.attributes} onClick={() => void importSemantic()}>
                      {t('Import from Semantic Branding', 'Importar do Semantic Branding')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          }
        >
          {searchField(t('Search attributes or groups', 'Buscar atributos ou grupos'))}
        </DataTableToolbar>
        {!config.attributes.length ? (
          <EmptyState
            title={t('No attributes yet', 'Nenhum atributo ainda')}
            description={t('Attributes are what buyers compare: price, delivery time, support. Products generated on the Products page bring theirs.', 'Atributos são o que os compradores comparam: preço, prazo, suporte. Os produtos gerados na página Produtos trazem os seus.')}
          />
        ) : shownAttributes.length ? (
          <DataTable fill singleLine="wide" ariaLabel={t('Attributes', 'Atributos')} rows={shownAttributes} rowKey={(row) => row.id} columns={columns} />
        ) : noMatch}
        {dialogs}
      </DataTableScreen>
    );
  }

  const columns: DataColumn<ComparisonPersona>[] = [
    // The name opens the persona's page: the brands' scores for it on each attribute, their evolution and the facts behind them.
    { key: 'persona', header: t('Persona', 'Persona'), mobile: 'title', width: '20rem', shrinkTo: '12rem', sortValue: (row) => row.name, cell: (row) => <DrillLink link={link} to={detailPage('personas', row.id)} className="min-w-0 truncate">{row.name}</DrillLink> },
    {
      key: 'description',
      header: t('For', 'Para'),
      label: t('For', 'Para'),
      mobile: 'wide',
      info: t('The phrase that completes “for …” in the question the AIs are asked.', 'A frase que completa “para …” na pergunta feita às IAs.'),
      hint: (row) => row.description || undefined,
      cell: (row) => row.description || <span className="text-muted-foreground">{t('No description: the name is used', 'Sem descrição: o nome é usado')}</span>,
    },
    ...(canEdit ? [actionsColumn<ComparisonPersona>(t, (row) => <RowMenu name={row.name} onEdit={() => setDialog({ kind: 'persona', id: row.id })} onDelete={() => setDeleting({ kind: 'persona', id: row.id, name: row.name })} />)] : []),
  ];
  const personasFull = config.personas.length >= COMPARISON_LIMITS.personas;
  const shownPersonas = found(config.personas, (row) => [row.name, row.description]);
  return (
    <DataTableScreen>
      <DataTableToolbar
        label={t('Persona filters', 'Filtros de personas')}
        actions={
          <>
            <InfoHint text={t('Who buys: each product is asked once per persona, as “Which … is best … for <persona>?”.', 'Quem compra: cada produto é perguntado uma vez por persona, como “Qual … é melhor … para <persona>?”.')} />
            {canEdit && <Button variant="outline" disabled={personasFull} onClick={() => setDialog({ kind: 'suggest', personasOnly: true })}>{t('Suggest personas', 'Sugerir personas')}</Button>}
            {canEdit && <Button disabled={personasFull} onClick={() => setDialog({ kind: 'persona' })}>{t('Add persona', 'Adicionar persona')}</Button>}
          </>
        }
      >
        {searchField(t('Search personas', 'Buscar personas'))}
      </DataTableToolbar>
      {!config.personas.length ? (
        <EmptyState
          title={t('No personas yet', 'Nenhuma persona ainda')}
          description={t('Personas are who buys: every product is asked about for each of them.', 'Personas são quem compra: cada produto é perguntado para cada uma delas.')}
        />
      ) : shownPersonas.length ? (
        <DataTable fill singleLine="wide" ariaLabel={t('Personas', 'Personas')} rows={shownPersonas} rowKey={(row) => row.id} columns={columns} />
      ) : noMatch}
      {dialogs}
    </DataTableScreen>
  );
}

/** A dialog's frame: title, description, the form, and Cancel and the primary action in the footer. */
function FormDialog({ title, description, submit, pending, disabled, error, onClose, onSubmit, children }: {
  title: string;
  description?: string;
  submit: string;
  pending: boolean;
  disabled?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const t = useCopy();
  const id = useId();
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form id={id} noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(); }}>
          <FieldGroup className="gap-5">{children}</FieldGroup>
        </form>
        {error && <FieldError>{error}</FieldError>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>{t('Cancel', 'Cancelar')}</Button>
          <Button type="submit" form={id} pending={pending} disabled={disabled}>{submit}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Saves from a dialog: the error stays in it, success closes it. */
function useDialogSave(onSave: Save, onClose: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const save = async (config: ComparisonConfig) => {
    setPending(true);
    setError('');
    try {
      await onSave(config);
      onClose();
    } catch (cause) {
      setError(message(cause));
      setPending(false);
    }
  };
  return { pending, error, setError, save };
}

/** A checkbox with its label and an optional line under it. */
function Check({ id, label, description, checked, disabled, onChange }: { id: string; label: ReactNode; description?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
    </Field>
  );
}

function ProductDialog({ settings, id, onClose, onSave }: { settings: ComparisonSettings; id?: string; onClose: () => void; onSave: Save }) {
  const t = useCopy();
  const formId = useId();
  const config = settings.config;
  const editing = config.products.find((item) => item.id === id);
  const [name, setName] = useState(editing?.name ?? '');
  const [competitors, setCompetitors] = useState<ComparisonOption[]>(editing?.competitors ?? []);
  const [attributes, setAttributes] = useState<string[]>(editing?.attributes ?? []);
  // Attributes written here join the library when the product is saved.
  const [library, setLibrary] = useState<ComparisonAttribute[]>(config.attributes);
  const [newAttribute, setNewAttribute] = useState('');
  const [attempted, setAttempted] = useState(false);
  const { pending, error, save } = useDialogSave(onSave, onClose);
  const project = settings.competitors.map(({ name: brand, domain }) => ({ name: brand, domain }));
  const isProject = (option: ComparisonOption) => project.some((item) => fold(item.name) === fold(option.name));
  const custom = competitors.map((option, at) => ({ option, at })).filter(({ option }) => !isProject(option));
  const chosen = competitors.filter((option) => option.name.trim());
  const maxCompetitors = COMPARISON_LIMITS.competitors;
  const maxAttributes = COMPARISON_LIMITS.productAttributes;
  const problem = name.trim().length < 2
    ? t('Name the product, with at least 2 characters.', 'Dê um nome ao produto, com pelo menos 2 caracteres.')
    : !chosen.length
      ? t('Choose at least one competitor.', 'Escolha pelo menos um concorrente.')
      : !attributes.length
        ? t('Choose at least one attribute.', 'Escolha pelo menos um atributo.')
        : null;
  const groups = [...new Set(library.map((item) => item.group))].sort((a, b) => (a && b ? a.localeCompare(b) : a ? -1 : 1));
  const toggleAttribute = (attribute: string, on: boolean) => setAttributes((list) => (on ? [...new Set([...list, attribute])].slice(0, maxAttributes) : list.filter((item) => item !== attribute)));
  const addAttribute = () => {
    const text = newAttribute.trim();
    if (text.length < 2) return;
    const known = library.find((item) => fold(item.name) === fold(text));
    if (known) toggleAttribute(known.id, true);
    else {
      const attribute = { id: newId({ ...config, attributes: library }, text), name: text, description: '', group: '' };
      setLibrary((list) => [...list, attribute]);
      toggleAttribute(attribute.id, true);
    }
    setNewAttribute('');
  };
  const submit = () => {
    setAttempted(true);
    if (problem) return;
    const product = { id: editing?.id ?? newId({ ...config, attributes: library }, name.trim()), name: name.trim(), competitors: chosen.map((option) => ({ name: option.name.trim(), domain: option.domain.trim() })), attributes };
    void save({
      ...config,
      attributes: library,
      products: editing ? config.products.map((item) => (item.id === editing.id ? product : item)) : [...config.products, product],
    });
  };
  return (
    <FormDialog
      title={editing ? t(`Edit ${editing.name}`, `Editar ${editing.name}`) : t('Add product', 'Adicionar produto')}
      description={t('A product or service you sell, the competitors it is compared with and the attributes buyers compare.', 'Um produto ou serviço que você vende, os concorrentes com que é comparado e os atributos que os compradores comparam.')}
      submit={editing ? t('Save', 'Salvar') : t('Add product', 'Adicionar produto')}
      pending={pending}
      error={(attempted && problem) || error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field>
        <FieldLabel htmlFor={`${formId}-name`}>{t('Product', 'Produto')}</FieldLabel>
        <Input id={`${formId}-name`} value={name} maxLength={COMPARISON_LIMITS.name} placeholder={t('E.g. running shoes', 'Ex.: tênis de corrida')} aria-invalid={attempted && name.trim().length < 2 ? true : undefined} onChange={(event) => setName(event.target.value)} />
        <FieldDescription>{t('A category a buyer asks the AI about, not your product’s brand name.', 'Uma categoria que um comprador pergunta à IA, não o nome comercial do seu produto.')}</FieldDescription>
      </Field>
      <FieldSet>
        <FieldLegend variant="label">{t(`Competitors (${chosen.length} of up to ${maxCompetitors})`, `Concorrentes (${chosen.length} de até ${maxCompetitors})`)}</FieldLegend>
        {project.map((option) => {
          const on = competitors.some((item) => fold(item.name) === fold(option.name));
          return (
            <Check
              key={option.name}
              id={`${formId}-c-${option.name}`}
              label={<span className="flex items-center gap-2"><SiteFavicon domain={option.domain} name={option.name} />{option.name}</span>}
              checked={on}
              disabled={!on && competitors.length >= maxCompetitors}
              onChange={(checked) => setCompetitors((list) => (checked ? [...list, option] : list.filter((item) => fold(item.name) !== fold(option.name))))}
            />
          );
        })}
        {custom.map(({ option, at }) => (
          <div key={at} className="flex items-center gap-2">
            <Input aria-label={t('Competitor name', 'Nome do concorrente')} placeholder={t('Name', 'Nome')} maxLength={COMPARISON_LIMITS.name} value={option.name} onChange={(event) => setCompetitors((list) => list.map((item, index) => (index === at ? { ...item, name: event.target.value } : item)))} />
            <Input aria-label={t('Competitor site', 'Site do concorrente')} placeholder={t('site.com', 'site.com.br')} inputMode="url" maxLength={253} value={option.domain} onChange={(event) => setCompetitors((list) => list.map((item, index) => (index === at ? { ...item, domain: event.target.value } : item)))} />
            <Button type="button" variant="ghost" size="icon" aria-label={t(`Remove ${option.name || 'competitor'}`, `Remover ${option.name || 'concorrente'}`)} onClick={() => setCompetitors((list) => list.filter((_, index) => index !== at))}>
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" disabled={competitors.length >= maxCompetitors} onClick={() => setCompetitors((list) => [...list, { name: '', domain: '' }])}>{t('Add another competitor', 'Adicionar outro concorrente')}</Button>
        </div>
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label">{t(`Attributes (${attributes.length} of up to ${maxAttributes})`, `Atributos (${attributes.length} de até ${maxAttributes})`)}</FieldLegend>
        {groups.map((group) => {
          const items = byName(library.filter((item) => item.group === group));
          const missing = items.filter((item) => !attributes.includes(item.id));
          return (
            <div key={group || '-'} className="grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-caption text-muted-foreground">{group || t('No group', 'Sem grupo')}</span>
                {group && missing.length > 0 && (
                  <Button type="button" variant="ghost" disabled={attributes.length + missing.length > maxAttributes} onClick={() => setAttributes((list) => [...list, ...missing.map((item) => item.id)])}>
                    {t('Add the whole group', 'Adicionar o grupo todo')}
                  </Button>
                )}
              </div>
              {items.map((item) => {
                const on = attributes.includes(item.id);
                return <Check key={item.id} id={`${formId}-a-${item.id}`} label={item.name} description={item.description || undefined} checked={on} disabled={!on && attributes.length >= maxAttributes} onChange={(checked) => toggleAttribute(item.id, checked)} />;
              })}
            </div>
          );
        })}
        <div className="flex items-center gap-2">
          <Input aria-label={t('New attribute', 'Novo atributo')} placeholder={t('New attribute, e.g. price', 'Novo atributo, ex.: preço')} maxLength={COMPARISON_LIMITS.name} value={newAttribute} onChange={(event) => setNewAttribute(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addAttribute(); } }} />
          <Button type="button" variant="outline" disabled={newAttribute.trim().length < 2 || attributes.length >= maxAttributes || library.length >= COMPARISON_LIMITS.attributes} onClick={addAttribute}>{t('Add', 'Adicionar')}</Button>
        </div>
      </FieldSet>
    </FormDialog>
  );
}

function AttributeDialog({ config, id, onClose, onSave }: { config: ComparisonConfig; id?: string; onClose: () => void; onSave: Save }) {
  const t = useCopy();
  const formId = useId();
  const editing = config.attributes.find((item) => item.id === id);
  const [name, setName] = useState(editing?.name ?? '');
  const [group, setGroup] = useState(editing?.group ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [attempted, setAttempted] = useState(false);
  const { pending, error, save } = useDialogSave(onSave, onClose);
  const invalid = name.trim().length < 2;
  const groups = [...new Set(config.attributes.map((item) => item.group).filter(Boolean))].sort();
  const submit = () => {
    setAttempted(true);
    if (invalid) return;
    const attribute = { id: editing?.id ?? newId(config, name.trim()), name: name.trim(), group: group.trim(), description: description.trim() };
    void save({ ...config, attributes: editing ? config.attributes.map((item) => (item.id === editing.id ? attribute : item)) : [...config.attributes, attribute] });
  };
  return (
    <FormDialog
      title={editing ? t(`Edit ${editing.name}`, `Editar ${editing.name}`) : t('Add attribute', 'Adicionar atributo')}
      description={t('Something buyers compare the options on. The AIs score every option on each attribute of a product, with a fact.', 'Algo em que os compradores comparam as opções. As IAs dão nota a cada opção em cada atributo de um produto, com um fato.')}
      submit={editing ? t('Save', 'Salvar') : t('Add attribute', 'Adicionar atributo')}
      pending={pending}
      error={(attempted && invalid && t('Name the attribute, with at least 2 characters.', 'Dê um nome ao atributo, com pelo menos 2 caracteres.')) || error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field>
        <FieldLabel htmlFor={`${formId}-name`}>{t('Attribute', 'Atributo')}</FieldLabel>
        <Input id={`${formId}-name`} value={name} maxLength={COMPARISON_LIMITS.name} placeholder={t('E.g. price', 'Ex.: preço')} aria-invalid={attempted && invalid ? true : undefined} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${formId}-group`}>{t('Group', 'Grupo')}</FieldLabel>
        <Input id={`${formId}-group`} list={`${formId}-groups`} value={group} maxLength={COMPARISON_LIMITS.group} placeholder={t('E.g. Price and value', 'Ex.: Preço e valor')} onChange={(event) => setGroup(event.target.value)} />
        <datalist id={`${formId}-groups`}>{groups.map((item) => <option key={item} value={item}>{item}</option>)}</datalist>
        <FieldDescription>{t('Optional. Related attributes share a group, so a product can take the whole group at once.', 'Opcional. Atributos relacionados compartilham um grupo, para um produto receber o grupo todo de uma vez.')}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${formId}-description`}>{t('Description', 'Descrição')}</FieldLabel>
        <Textarea id={`${formId}-description`} rows={2} value={description} maxLength={COMPARISON_LIMITS.description} onChange={(event) => setDescription(event.target.value)} />
        <FieldDescription>{t('Optional. A neutral definition, for whoever reads the report.', 'Opcional. Uma definição neutra, para quem lê o relatório.')}</FieldDescription>
      </Field>
    </FormDialog>
  );
}

function PersonaDialog({ config, id, onClose, onSave }: { config: ComparisonConfig; id?: string; onClose: () => void; onSave: Save }) {
  const t = useCopy();
  const formId = useId();
  const editing = config.personas.find((item) => item.id === id);
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [attempted, setAttempted] = useState(false);
  const { pending, error, save } = useDialogSave(onSave, onClose);
  const invalid = name.trim().length < 2;
  const submit = () => {
    setAttempted(true);
    if (invalid) return;
    const persona = { id: editing?.id ?? newId(config, name.trim()), name: name.trim(), description: description.trim() };
    void save({ ...config, personas: editing ? config.personas.map((item) => (item.id === editing.id ? persona : item)) : [...config.personas, persona] });
  };
  return (
    <FormDialog
      title={editing ? t(`Edit ${editing.name}`, `Editar ${editing.name}`) : t('Add persona', 'Adicionar persona')}
      description={t('Who buys. Each product is asked about once for each persona.', 'Quem compra. Cada produto é perguntado uma vez para cada persona.')}
      submit={editing ? t('Save', 'Salvar') : t('Add persona', 'Adicionar persona')}
      pending={pending}
      error={(attempted && invalid && t('Name the persona, with at least 2 characters.', 'Dê um nome à persona, com pelo menos 2 caracteres.')) || error}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field>
        <FieldLabel htmlFor={`${formId}-name`}>{t('Persona', 'Persona')}</FieldLabel>
        <Input id={`${formId}-name`} value={name} maxLength={COMPARISON_LIMITS.name} placeholder={t('E.g. Small business owner', 'Ex.: Dono de pequena empresa')} aria-invalid={attempted && invalid ? true : undefined} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${formId}-description`}>{t('For …', 'Para …')}</FieldLabel>
        <Textarea id={`${formId}-description`} rows={2} value={description} maxLength={COMPARISON_LIMITS.description} placeholder={t('a small business owner who wants to sell more online on a small budget', 'um dono de pequena empresa que quer vender mais pela internet com pouco orçamento')} onChange={(event) => setDescription(event.target.value)} />
        <FieldDescription>{t('Completes “Which … is best for …?” in the question. Empty: the name is used.', 'Completa “Qual … é melhor para …?” na pergunta. Vazio: o nome é usado.')}</FieldDescription>
      </Field>
    </FormDialog>
  );
}

/**
 * The AI's suggestions (POST suggest, nothing saved until confirmed): products with their attributes and personas, or only the
 * personas. New products start checked up to the plan's room, every persona checked; what is picked joins the configuration
 * (withSuggestions), each new product compared with the project's competitors until edited.
 */
function SuggestDialog({ settings, projectId, personasOnly, onClose, onSave }: { settings: ComparisonSettings; projectId: string; personasOnly: boolean; onClose: () => void; onSave: Save }) {
  const t = useCopy();
  const formId = useId();
  const config = settings.config;
  const [state, setState] = useState<{ data: ComparisonSuggestions | null; error: string }>({ data: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const [products, setProducts] = useState<Record<string, string[] | null>>({});
  const [personas, setPersonas] = useState<string[]>([]);
  const { pending, error, save } = useDialogSave(onSave, onClose);
  const limit = Math.min(COMPARISON_LIMITS.products, settings.productLimit ?? Infinity);
  const room = Math.max(0, limit - config.products.length);
  const personaRoom = Math.max(0, COMPARISON_LIMITS.personas - config.personas.length);
  const competitors = settings.competitors.slice(0, COMPARISON_LIMITS.competitors).map(({ name, domain }) => ({ name, domain }));
  // Asked once per open (and per retry), against the configuration open now: a save elsewhere never asks again (a paid call).
  const [opened] = useState(() => ({ config, room, personaRoom }));
  useEffect(() => {
    let active = true;
    requestJson<ComparisonSuggestions>(`/api/projects/${encodeURIComponent(projectId)}/comparison`, 'POST', { action: 'suggest' })
      .then((data) => {
        if (!active) return;
        const fresh = data.products.filter((item) => !opened.config.products.some((known) => fold(known.name) === fold(item.name)));
        setProducts(Object.fromEntries(fresh.map((item, at) => [item.name, at < opened.room ? item.attributes : null])));
        setPersonas(data.personas.filter((item) => !opened.config.personas.some((known) => fold(known.name) === fold(item.name))).slice(0, opened.personaRoom).map((item) => item.name));
        setState({ data, error: '' });
      })
      .catch((cause) => active && setState({ data: null, error: message(cause) }));
    return () => {
      active = false;
    };
  }, [projectId, attempt, opened]);
  const data = state.data;
  const freshProducts = data?.products.filter((item) => item.name in products) ?? [];
  const freshPersonas = data?.personas.filter((item) => !config.personas.some((known) => fold(known.name) === fold(item.name))) ?? [];
  const pickedProducts = personasOnly ? [] : freshProducts.filter((item) => products[item.name]?.length);
  const pickedPersonas = freshPersonas.filter((item) => personas.includes(item.name));
  const noCompetitors = pickedProducts.length > 0 && !competitors.length;
  const submit = () => {
    if (!data || noCompetitors) return;
    const picked = pickedProducts.map((item) => ({ name: item.name, attributes: products[item.name]! }));
    const names = new Set(picked.flatMap((item) => item.attributes.map(fold)));
    void save(withSuggestions(config, { products: picked, attributes: data.attributes.filter((item) => names.has(fold(item.name))), personas: pickedPersonas }, competitors));
  };
  const description = (name: string) => data?.attributes.find((item) => fold(item.name) === fold(name))?.description;
  return (
    <FormDialog
      title={personasOnly ? t('Suggest personas', 'Sugerir personas') : t('Generate products and attributes', 'Gerar produtos e atributos')}
      description={personasOnly
        ? t('Personas who buy what your brand sells, read from your site. Pick the ones to ask about.', 'Personas que compram o que a sua marca vende, lidas do seu site. Escolha as que serão perguntadas.')
        : t('What your brand sells, the attributes buyers compare and who buys, read from your site. Pick what to compare; you can edit everything after.', 'O que a sua marca vende, os atributos que os compradores comparam e quem compra, lidos do seu site. Escolha o que comparar; dá para editar tudo depois.')}
      submit={t('Add selected', 'Adicionar selecionados')}
      pending={pending}
      disabled={!data || noCompetitors || (!pickedProducts.length && !pickedPersonas.length)}
      error={error}
      onClose={onClose}
      onSubmit={submit}
    >
      {!data ? (
        state.error ? (
          <EmptyState frame="inline" tone="error" title={state.error} onRetry={() => { setState({ data: null, error: '' }); setAttempt((value) => value + 1); }} />
        ) : (
          <EmptyState frame="inline" tone="progress" title={t('Reading your site and market…', 'Lendo o seu site e o mercado…')} description={t('This takes up to a minute.', 'Isto leva até um minuto.')} />
        )
      ) : (
        <>
          {!personasOnly && (
            <FieldSet>
              <FieldLegend variant="label">
                {settings.productLimit != null
                  ? t(`Products (your plan compares up to ${settings.productLimit}; ${room} left)`, `Produtos (seu plano compara até ${settings.productLimit}; restam ${room})`)
                  : t('Products', 'Produtos')}
              </FieldLegend>
              {freshProducts.length ? freshProducts.map((item) => {
                const chosen = products[item.name];
                const on = !!chosen?.length;
                return (
                  <div key={item.name} className="grid gap-3">
                    <Check
                      id={`${formId}-p-${item.name}`}
                      label={item.name}
                      checked={on}
                      disabled={!on && pickedProducts.length >= room}
                      onChange={(checked) => setProducts((map) => ({ ...map, [item.name]: checked ? item.attributes : null }))}
                    />
                    {on && (
                      <div className="grid gap-3 pl-6">
                        {item.attributes.map((attribute) => (
                          <Check
                            key={attribute}
                            id={`${formId}-p-${item.name}-${attribute}`}
                            label={attribute}
                            description={description(attribute)}
                            checked={chosen!.includes(attribute)}
                            onChange={(checked) => setProducts((map) => ({ ...map, [item.name]: checked ? [...map[item.name]!, attribute] : map[item.name]!.filter((name) => name !== attribute) }))}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              }) : <FieldDescription>{t('No new product: the ones suggested are already here.', 'Nenhum produto novo: os sugeridos já estão aqui.')}</FieldDescription>}
              {noCompetitors && <Note tone="danger" className="px-0">{t('This project has no competitors yet: add them in Settings first, as each product is compared with them.', 'Este projeto ainda não tem concorrentes: adicione-os em Configurações primeiro, pois cada produto é comparado com eles.')}</Note>}
            </FieldSet>
          )}
          <FieldSet>
            <FieldLegend variant="label">{t('Personas', 'Personas')}</FieldLegend>
            {freshPersonas.length ? freshPersonas.map((item) => {
              const on = personas.includes(item.name);
              return (
                <Check
                  key={item.name}
                  id={`${formId}-r-${item.name}`}
                  label={item.name}
                  description={item.description ? t(`For ${item.description}`, `Para ${item.description}`) : undefined}
                  checked={on}
                  disabled={!on && personas.length >= personaRoom}
                  onChange={(checked) => setPersonas((list) => (checked ? [...list, item.name] : list.filter((name) => name !== item.name)))}
                />
              );
            }) : <FieldDescription>{t('No new persona: the ones suggested are already here.', 'Nenhuma persona nova: as sugeridas já estão aqui.')}</FieldDescription>}
          </FieldSet>
        </>
      )}
    </FormDialog>
  );
}
