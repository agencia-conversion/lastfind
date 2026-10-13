'use client';

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Folder,
  ListFilter,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  brandMetrics,
  defaultFilters,
  demoTopics,
  exportDemoCsv,
  selectResponses,
  promptMatchesFilters,
  type DemoPrompt,
  type DemoFilters,
  type DemoStatus,
} from './demo-data';
import {
  CollectionToolbar,
  EmptyState,
  FilterSelect,
  PrimaryMenuActions,
  SearchField,
  useCopy,
  useNumbers,
} from './shared';

type PromptDraft = Pick<DemoPrompt, 'text' | 'topic' | 'country'> & {
  tags: string;
};
const emptyDraft: PromptDraft = {
  text: '',
  topic: 'SEO agencies',
  tags: '',
  country: 'Brazil',
};
const statuses: DemoStatus[] = ['active', 'suggested', 'inactive', 'archived'];
const countries = ['Brazil', 'United States'];

// Small RFC-style parser for the local preview. Nothing is submitted to a provider.
export function parseDemoPromptImport(
  input: string,
): Omit<DemoPrompt, 'id' | 'status'>[] {
  const text = input.replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  if (text.length > 100_000) throw new Error('size');
  const firstLine = text.split(/\r?\n/)[0];
  const separator =
    firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || !field) quoted = !quoted;
      else field += char;
    } else if (!quoted && [separator, '\n', '\r'].includes(char)) {
      row.push(field.trim());
      field = '';
      if (char !== separator) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += char;
  }
  if (quoted) throw new Error('quotes');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  const header = rows.shift()?.map((value) => value.toLowerCase()) ?? [];
  const textIndex = header.findIndex((value) =>
    ['prompt', 'text', 'texto'].includes(value),
  );
  if (textIndex < 0) throw new Error('header');
  if (!rows.length || rows.length > 100) throw new Error('rows');
  const topicIndex = header.findIndex((value) =>
    ['topic', 'tema'].includes(value),
  );
  const tagsIndex = header.indexOf('tags');
  const countryIndex = header.findIndex((value) =>
    ['country', 'país', 'pais'].includes(value),
  );
  return rows.map((values) => {
    const prompt = values[textIndex] ?? '';
    const topic = values[topicIndex] || 'General';
    const country = values[countryIndex] || 'Brazil';
    if (prompt.length < 5 || prompt.length > 1000 || topic.length > 60)
      throw new Error('length');
    if (!countries.includes(country)) throw new Error('country');
    const tags = [
      ...new Set(
        (values[tagsIndex] || '')
          .split('|')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (tags.length > 10 || tags.some((value) => value.length > 40))
      throw new Error('tags');
    return { text: prompt, topic, country, tags };
  });
}

export function PromptsView({
  prompts,
  setPrompts,
  onOpenPrompt,
  addOpen,
  setAddOpen,
  readOnly = false,
  reportFilters = defaultFilters,
}: {
  prompts: DemoPrompt[];
  setPrompts: Dispatch<SetStateAction<DemoPrompt[]>>;
  onOpenPrompt: (prompt: DemoPrompt) => void;
  addOpen: boolean;
  setAddOpen: (value: boolean) => void;
  readOnly?: boolean;
  reportFilters?: DemoFilters;
}) {
  const copy = useCopy();
  const { number, percent } = useNumbers();
  const [status, setStatus] = useState<DemoStatus>('active');
  const [topic, setTopic] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<PromptDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [fileError, setFileError] = useState('');
  const [topbarHeight, setTopbarHeight] = useState(0);
  useEffect(() => {
    const topbar = document.querySelector('.analytics-topbar');
    if (!topbar) return;
    const updateHeight = () =>
      setTopbarHeight(topbar.getBoundingClientRect().height);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(topbar);
    return () => observer.disconnect();
  }, []);

  const topics = [
    ...new Set([...demoTopics, ...prompts.map((prompt) => prompt.topic)]),
  ];
  const scoped = prompts.filter(
    (prompt) =>
      promptMatchesFilters(prompt, reportFilters) &&
      (topic === 'all' || prompt.topic === topic) &&
      `${prompt.text} ${prompt.topic} ${prompt.tags.join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const visible = scoped.filter((prompt) => prompt.status === status);
  const selectedVisible = visible.filter((prompt) =>
    selected.includes(prompt.id),
  );
  const allSelected =
    visible.length > 0 && selectedVisible.length === visible.length;
  const metrics = useMemo(
    () =>
      Object.fromEntries(
        prompts.map((prompt) => {
          const responses = selectResponses(
            [{ ...prompt, status: 'active' }],
            reportFilters,
          );
          return [
            prompt.id,
            {
              ...brandMetrics(responses, 'conversion'),
              responses: responses.length,
            },
          ];
        }),
      ),
    [prompts, reportFilters],
  );
  const importPreview = useMemo(() => {
    try {
      return { rows: parseDemoPromptImport(importText), error: '' };
    } catch (reason) {
      return {
        rows: [],
        error: reason instanceof Error ? reason.message : 'header',
      };
    }
  }, [importText]);

  const statusLabels = {
    active: copy('Active', 'Ativos'),
    suggested: copy('Suggested', 'Sugeridos'),
    inactive: copy('Inactive', 'Inativos'),
    archived: copy('Archived', 'Arquivados'),
  };
  const countryLabel = (value: string) =>
    value === 'Brazil'
      ? copy('Brazil', 'Brasil')
      : copy('United States', 'Estados Unidos');
  const resetSelection = () => setSelected([]);
  const changeStatus = (ids: string[], next: DemoStatus) => {
    if (readOnly) return;
    setPrompts((current) =>
      current.map((prompt) =>
        ids.includes(prompt.id) ? { ...prompt, status: next } : prompt,
      ),
    );
    resetSelection();
    setNotice(
      `${number(ids.length)} ${copy('prompt(s) updated', 'prompt(s) atualizados')}`,
    );
  };
  const closeEditor = () => {
    setAddOpen(false);
    setEditingId(null);
    setDraft(emptyDraft);
    setError('');
  };
  const openEditor = (prompt?: DemoPrompt) => {
    if (readOnly) return;
    setEditingId(prompt?.id ?? null);
    setDraft(
      prompt
        ? {
            text: prompt.text,
            topic: prompt.topic,
            tags: prompt.tags.join(', '),
            country: prompt.country,
          }
        : { ...emptyDraft, topic: topic === 'all' ? demoTopics[0] : topic },
    );
    setError('');
    setAddOpen(true);
  };
  const savePrompt = () => {
    if (readOnly) return;
    const text = draft.text.trim(),
      draftTopic = draft.topic.trim();
    const tags = [
      ...new Set(
        draft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    if (text.length < 5 || text.length > 1000) {
      setError(
        copy(
          'Use between 5 and 1,000 characters for your prompt.',
          'Use entre 5 e 1.000 caracteres no prompt.',
        ),
      );
      return;
    }
    if (!draftTopic || draftTopic.length > 60) {
      setError(
        copy(
          'Add a topic with up to 60 characters.',
          'Adicione um tema com até 60 caracteres.',
        ),
      );
      return;
    }
    if (tags.length > 10 || tags.some((tag) => tag.length > 40)) {
      setError(
        copy(
          'Use up to 10 tags, with 40 characters each.',
          'Use até 10 tags com 40 caracteres cada.',
        ),
      );
      return;
    }
    if (
      prompts.some(
        (prompt) =>
          prompt.id !== editingId &&
          prompt.text.toLowerCase() === text.toLowerCase() &&
          prompt.country === draft.country,
      )
    ) {
      setError(
        copy(
          'This prompt already exists for this country.',
          'Este prompt já existe para este país.',
        ),
      );
      return;
    }
    const value = { text, topic: draftTopic, tags, country: draft.country };
    setPrompts((current) =>
      editingId
        ? current.map((prompt) =>
            prompt.id === editingId ? { ...prompt, ...value } : prompt,
          )
        : [
            ...current,
            { ...value, id: `p-${crypto.randomUUID()}`, status: 'active' },
          ],
    );
    if (!editingId) {
      setStatus('active');
      setTopic('all');
      setSearch('');
    }
    setNotice(
      editingId
        ? copy('Prompt updated', 'Prompt atualizado')
        : copy('Prompt added', 'Prompt adicionado'),
    );
    closeEditor();
  };
  const importErrors: Record<string, string> = {
    size: copy(
      'The CSV must be smaller than 100 KB.',
      'O CSV deve ter menos de 100 KB.',
    ),
    quotes: copy(
      'Close all quoted fields before importing.',
      'Feche todas as aspas antes de importar.',
    ),
    header: copy(
      'Include a prompt column in the first row.',
      'Inclua uma coluna prompt na primeira linha.',
    ),
    rows: copy(
      'Import between 1 and 100 prompts at a time.',
      'Importe entre 1 e 100 prompts por vez.',
    ),
    length: copy(
      'Prompts need 5–1,000 characters and topics up to 60.',
      'Prompts precisam de 5–1.000 caracteres e temas de até 60.',
    ),
    country: copy(
      'Use Brazil or United States in the country column.',
      'Use Brazil ou United States na coluna country.',
    ),
    tags: copy(
      'Use up to 10 tags per prompt, with 40 characters each.',
      'Use até 10 tags por prompt com 40 caracteres cada.',
    ),
  };
  const newImportRows = importPreview.rows.filter(
    (row, index, rows) =>
      !prompts.some(
        (prompt) =>
          prompt.text.toLowerCase() === row.text.toLowerCase() &&
          prompt.country === row.country,
      ) &&
      rows.findIndex(
        (other) =>
          other.text.toLowerCase() === row.text.toLowerCase() &&
          other.country === row.country,
      ) === index,
  );

  return (
    <>
      {readOnly && (
        <output className="mb-4 block rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {copy(
            'You have view-only access to this workspace. You can explore and export prompts; an editor or admin can make changes.',
            'Você tem acesso de leitura a este espaço. Pode consultar e exportar prompts; editores e administradores podem fazer alterações.',
          )}
        </output>
      )}
      <div
        className="prompts-layout grid items-start gap-5 lg:grid-cols-[180px_minmax(0,1fr)]"
        style={{ '--prompts-sticky-top': `${topbarHeight}px` } as CSSProperties}
      >
        <aside
          aria-label={copy('Prompt topics', 'Temas dos prompts')}
          className="prompts-topics space-y-1"
        >
          <div className="mb-3 flex items-center justify-between px-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{copy('Topics', 'Temas')}</span>
            <Folder size={13} />
          </div>
          <Button
            variant="ghost"
            className={`h-9 w-full justify-start text-sm ${topic === 'all' ? 'bg-primary/7 text-primary hover:bg-primary/10 hover:text-primary' : 'text-muted-foreground'}`}
            onClick={() => {
              setTopic('all');
              resetSelection();
            }}
            aria-pressed={topic === 'all'}
          >
            <ListFilter size={15} />
            <span>{copy('All prompts', 'Todos os prompts')}</span>
            <span className="ml-auto text-sm tabular-nums">
              {number(
                prompts.filter((prompt) => prompt.status === status).length,
              )}
            </span>
          </Button>
          {topics.map((value, index) => (
            <Button
              key={value}
              variant="ghost"
              className={`h-9 w-full justify-start text-sm ${topic === value ? 'bg-primary/7 text-primary hover:bg-primary/10 hover:text-primary' : 'text-muted-foreground'}`}
              onClick={() => {
                setTopic(value);
                resetSelection();
              }}
              aria-pressed={topic === value}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: `var(--chart-${(index % 5) + 1})` }}
              />
              <span className="truncate">{value}</span>
              <span className="ml-auto text-sm tabular-nums">
                {number(
                  prompts.filter(
                    (prompt) =>
                      prompt.topic === value && prompt.status === status,
                  ).length,
                )}
              </span>
            </Button>
          ))}
          <div className="mt-7 border-t pt-4">
            <div className="flex items-center gap-2 px-2 text-sm font-medium">
              <Sparkles size={14} className="text-primary" />
              {copy('Find your next prompt', 'Encontre seu próximo prompt')}
            </div>
            <p className="px-2 pt-2 text-sm leading-5 text-muted-foreground">
              {copy(
                'Explore questions your audience is asking AI.',
                'Explore as perguntas que seu público faz à IA.',
              )}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-sm text-primary"
              onClick={() => {
                setStatus('suggested');
                setTopic('all');
                setSearch('');
                resetSelection();
              }}
            >
              {copy('Explore suggestions', 'Explorar sugestões')}
              <ArrowUpRight size={13} />
            </Button>
          </div>
        </aside>

        <section className="analytics-panel prompts-panel collection-panel min-w-0">
          <Tabs
            value={status}
            onValueChange={(value) => {
              setStatus(value as DemoStatus);
              resetSelection();
            }}
            className="gap-0"
          >
            <CollectionToolbar
              className="prompts-status-bar"
              actions={
                <PrimaryMenuActions
                  label={copy('More prompt actions', 'Mais ações de prompts')}
                  action={
                    <Button
                      disabled={readOnly}
                      size="sm"
                      className="text-sm"
                      onClick={() => openEditor()}
                    >
                      <Plus size={14} />
                      {copy('Add prompt', 'Adicionar prompt')}
                    </Button>
                  }
                >
                  <DropdownMenuItem
                    disabled={readOnly}
                    onClick={() => {
                      setImportOpen(true);
                      setImportText('');
                      setFileError('');
                    }}
                  >
                    <Upload />
                    {copy('Import', 'Importar')}
                  </DropdownMenuItem>
                </PrimaryMenuActions>
              }
            >
              <TabsList
                variant="line"
                className="gap-3"
                aria-label={copy('Prompt status', 'Status dos prompts')}
              >
                {statuses.map((value) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="gap-2 px-0 text-sm after:bg-primary data-active:text-primary"
                  >
                    {statusLabels[value]}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-sm tabular-nums text-muted-foreground">
                      {number(
                        scoped.filter((prompt) => prompt.status === value)
                          .length,
                      )}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
              <SearchField
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  resetSelection();
                }}
                ariaLabel={copy('Search prompts', 'Buscar prompts')}
                placeholder={copy('Search prompts...', 'Buscar prompts...')}
              />
            </CollectionToolbar>
            <TabsContent value={status} className="m-0">
              {selectedVisible.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2 text-sm">
                  <span className="mr-2 font-medium text-primary">
                    {number(selectedVisible.length)}{' '}
                    {copy('selected', 'selecionados')}
                  </span>
                  {status === 'active' && (
                    <Button
                      disabled={readOnly}
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        changeStatus(
                          selectedVisible.map((prompt) => prompt.id),
                          'inactive',
                        )
                      }
                    >
                      <Pause />
                      {copy('Pause', 'Pausar')}
                    </Button>
                  )}
                  {(status === 'inactive' ||
                    status === 'archived' ||
                    status === 'suggested') && (
                    <Button
                      disabled={readOnly}
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        changeStatus(
                          selectedVisible.map((prompt) => prompt.id),
                          'active',
                        )
                      }
                    >
                      <Play />
                      {status === 'suggested'
                        ? copy('Track', 'Monitorar')
                        : copy('Restore', 'Restaurar')}
                    </Button>
                  )}
                  {status !== 'archived' && (
                    <Button
                      disabled={readOnly}
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        changeStatus(
                          selectedVisible.map((prompt) => prompt.id),
                          'archived',
                        )
                      }
                    >
                      <Archive />
                      {copy('Archive', 'Arquivar')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto"
                    aria-label={copy('Clear selection', 'Limpar seleção')}
                    onClick={resetSelection}
                  >
                    <X />
                  </Button>
                </div>
              )}
              {status === 'suggested' && (
                <div className="flex items-start gap-2 border-b bg-primary/3 px-4 py-3 text-sm leading-5 text-muted-foreground">
                  <Sparkles
                    size={15}
                    className="mt-0.5 shrink-0 text-primary"
                  />
                  <span>
                    {copy(
                      'Discover relevant questions for your brand. Track a suggestion to add it to your active prompts.',
                      'Descubra perguntas relevantes para sua marca. Monitore uma sugestão para adicioná-la aos prompts ativos.',
                    )}
                  </span>
                </div>
              )}
              {visible.length ? (
                <Table className="analytics-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 pl-4">
                        <Checkbox
                          disabled={readOnly}
                          aria-label={copy(
                            'Select all visible prompts',
                            'Selecionar todos os prompts visíveis',
                          )}
                          checked={allSelected}
                          indeterminate={
                            selectedVisible.length > 0 && !allSelected
                          }
                          onCheckedChange={(checked) =>
                            setSelected(
                              checked ? visible.map((prompt) => prompt.id) : [],
                            )
                          }
                        />
                      </TableHead>
                      <TableHead className="min-w-72">
                        {copy('Prompt', 'Prompt')}
                      </TableHead>
                      <TableHead>{copy('Tags', 'Tags')}</TableHead>
                      {status !== 'suggested' && (
                        <>
                          <TableHead className="text-right">
                            {copy('Visibility', 'Visibilidade')}
                          </TableHead>
                          <TableHead className="text-right">
                            {copy('Position', 'Posição')}
                          </TableHead>
                        </>
                      )}
                      <TableHead>{copy('Country', 'País')}</TableHead>
                      <TableHead className="w-20">
                        <span className="sr-only">
                          {copy('Actions', 'Ações')}
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((prompt) => {
                      const metric = metrics[prompt.id];
                      return (
                        <TableRow
                          key={prompt.id}
                          data-state={
                            selected.includes(prompt.id)
                              ? 'selected'
                              : undefined
                          }
                        >
                          <TableCell className="pl-4">
                            <Checkbox
                              disabled={readOnly}
                              aria-label={`${copy('Select', 'Selecionar')} ${prompt.text}`}
                              checked={selected.includes(prompt.id)}
                              onCheckedChange={(checked) =>
                                setSelected((current) =>
                                  checked
                                    ? [...current, prompt.id]
                                    : current.filter((id) => id !== prompt.id),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="max-w-[420px] whitespace-normal py-4">
                            <button
                              className="block text-left text-sm font-medium leading-5 text-foreground hover:text-primary focus-visible:outline-primary"
                              onClick={() => onOpenPrompt(prompt)}
                            >
                              {prompt.text}
                            </button>
                            <span className="mt-1 block text-sm text-muted-foreground">
                              {prompt.topic}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex max-w-40 flex-wrap gap-1">
                              {prompt.tags.length ? (
                                prompt.tags.map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant="outline"
                                    className="h-5 rounded px-1.5 text-sm font-normal text-muted-foreground"
                                  >
                                    {tag}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                          </TableCell>
                          {status !== 'suggested' && (
                            <>
                              <TableCell className="text-right text-sm tabular-nums">
                                {metric?.responses
                                  ? percent(metric.visibility)
                                  : '—'}
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                                {metric?.mentions
                                  ? `#${number(metric.position, 1)}`
                                  : '—'}
                              </TableCell>
                            </>
                          )}
                          <TableCell className="text-sm text-muted-foreground">
                            <span className="mr-1.5" aria-hidden="true">
                              {prompt.country === 'Brazil' ? '🇧🇷' : '🇺🇸'}
                            </span>
                            {countryLabel(prompt.country)}
                          </TableCell>
                          <TableCell className="pr-3">
                            <div className="flex items-center justify-end gap-0.5">
                              {status === 'suggested' ? (
                                <>
                                  <Button
                                    disabled={readOnly}
                                    size="xs"
                                    variant="outline"
                                    onClick={() =>
                                      changeStatus([prompt.id], 'active')
                                    }
                                  >
                                    <Plus />
                                    {copy('Track', 'Monitorar')}
                                  </Button>
                                  <Button
                                    disabled={readOnly}
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`${copy('Dismiss', 'Descartar')} ${prompt.text}`}
                                    title={copy(
                                      'Dismiss suggestion',
                                      'Descartar sugestão',
                                    )}
                                    onClick={() =>
                                      changeStatus([prompt.id], 'archived')
                                    }
                                  >
                                    <X />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    disabled={readOnly}
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`${copy('Edit', 'Editar')} ${prompt.text}`}
                                    title={copy('Edit prompt', 'Editar prompt')}
                                    onClick={() => openEditor(prompt)}
                                  >
                                    <Pencil />
                                  </Button>
                                  <Button
                                    disabled={readOnly}
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`${status === 'active' ? copy('Pause', 'Pausar') : copy('Restore', 'Restaurar')} ${prompt.text}`}
                                    title={
                                      status === 'active'
                                        ? copy('Pause prompt', 'Pausar prompt')
                                        : copy(
                                            'Restore prompt',
                                            'Restaurar prompt',
                                          )
                                    }
                                    onClick={() =>
                                      changeStatus(
                                        [prompt.id],
                                        status === 'active'
                                          ? 'inactive'
                                          : 'active',
                                      )
                                    }
                                  >
                                    {status === 'active' ? (
                                      <Pause />
                                    ) : (
                                      <RotateCcw />
                                    )}
                                  </Button>
                                  {status !== 'archived' && (
                                    <Button
                                      disabled={readOnly}
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={`${copy('Archive', 'Arquivar')} ${prompt.text}`}
                                      title={copy(
                                        'Archive prompt',
                                        'Arquivar prompt',
                                      )}
                                      onClick={() =>
                                        changeStatus([prompt.id], 'archived')
                                      }
                                    >
                                      <Archive />
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title={copy('No prompts here yet', 'Nenhum prompt por aqui')}
                  description={copy(
                    'Try another filter or add a new prompt to get started.',
                    'Experimente outro filtro ou adicione um novo prompt.',
                  )}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearch('');
                        setTopic('all');
                        resetSelection();
                      }}
                    >
                      {copy('Clear filters', 'Limpar filtros')}
                    </Button>
                  }
                />
              )}
              <div className="flex min-h-11 items-center justify-between gap-3 border-t px-4 text-sm text-muted-foreground">
                <span>
                  {copy('Showing', 'Mostrando')} {number(visible.length)}{' '}
                  {copy('of', 'de')}{' '}
                  {number(
                    prompts.filter((prompt) => prompt.status === status).length,
                  )}{' '}
                  {copy('prompts', 'prompts')}
                </span>
                <span>
                  {copy(
                    'Metrics follow the selected period and AI models',
                    'As métricas seguem o período e os modelos de IA selecionados',
                  )}
                </span>
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>
      {notice && (
        <output className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Check size={14} className="text-primary" />
          {notice}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={copy('Dismiss notification', 'Fechar notificação')}
            onClick={() => setNotice('')}
          >
            <X />
          </Button>
        </output>
      )}

      <Dialog
        open={addOpen && !readOnly}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? copy('Edit prompt', 'Editar prompt')
                : copy('Add a prompt', 'Adicionar um prompt')}
            </DialogTitle>
            <DialogDescription>
              {copy(
                'Follow the questions that matter to your brand.',
                'Acompanhe as perguntas que importam para sua marca.',
              )}
            </DialogDescription>
          </DialogHeader>
          <form
            id="prompt-editor"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              savePrompt();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="prompt-text">{copy('Prompt', 'Prompt')}</Label>
              <Textarea
                id="prompt-text"
                value={draft.text}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    text: event.target.value,
                  }))
                }
                placeholder={copy(
                  'What are the best SEO agencies in Brazil?',
                  'Quais são as melhores agências de SEO do Brasil?',
                )}
                className="min-h-24"
                maxLength={1000}
                aria-invalid={!!error}
                aria-describedby={error ? 'prompt-editor-error' : undefined}
              />
              <p className="text-right text-sm text-muted-foreground">
                {number(draft.text.length)} / {number(1000)}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="prompt-topic">{copy('Topic', 'Tema')}</Label>
                <Input
                  id="prompt-topic"
                  list="prompt-topics"
                  value={draft.topic}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      topic: event.target.value,
                    }))
                  }
                  placeholder={copy(
                    'Select or create a topic',
                    'Selecione ou crie um tema',
                  )}
                  maxLength={60}
                />
                <datalist id="prompt-topics">
                  {topics.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label>{copy('Country', 'País')}</Label>
                <FilterSelect
                  label={copy('Prompt country', 'País do prompt')}
                  value={draft.country}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, country: value }))
                  }
                  options={countries.map((value) => ({
                    value,
                    label: countryLabel(value),
                  }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prompt-tags">
                {copy('Tags', 'Tags')}
                <span className="ml-1 font-normal text-muted-foreground">
                  {copy('(optional)', '(opcional)')}
                </span>
              </Label>
              <Input
                id="prompt-tags"
                value={draft.tags}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    tags: event.target.value,
                  }))
                }
                placeholder={copy(
                  'Discovery, High intent',
                  'Descoberta, Alta intenção',
                )}
              />
              <p className="text-sm text-muted-foreground">
                {copy(
                  'Separate tags with commas.',
                  'Separe as tags com vírgulas.',
                )}
              </p>
            </div>
            {error && (
              <p
                id="prompt-editor-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={closeEditor}>
              {copy('Cancel', 'Cancelar')}
            </Button>
            <Button disabled={readOnly} type="submit" form="prompt-editor">
              {editingId
                ? copy('Save changes', 'Salvar alterações')
                : copy('Add prompt', 'Adicionar prompt')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen && !readOnly} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {copy('Import prompts', 'Importar prompts')}
            </DialogTitle>
            <DialogDescription>
              {copy(
                'Upload a CSV or paste its contents. Review your prompts before importing.',
                'Envie um CSV ou cole seu conteúdo. Revise os prompts antes de importar.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
              <Upload size={14} />
              {copy('Choose CSV file', 'Escolher arquivo CSV')}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 100_000) {
                    setFileError(importErrors.size);
                    return;
                  }
                  try {
                    setImportText(await file.text());
                    setFileError('');
                  } catch {
                    setFileError(
                      copy(
                        'Unable to read this file.',
                        'Não foi possível ler este arquivo.',
                      ),
                    );
                  }
                }}
              />
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                exportDemoCsv('lastfind-prompt-template.csv', [
                  ['prompt', 'topic', 'tags', 'country'],
                  [
                    'What are the best SEO agencies in Brazil?',
                    'SEO agencies',
                    'Discovery|High intent',
                    'Brazil',
                  ],
                ])
              }
            >
              <ArrowDownToLine size={13} />
              {copy('Download template', 'Baixar modelo')}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prompt-csv">
              {copy('CSV contents', 'Conteúdo do CSV')}
            </Label>
            <Textarea
              id="prompt-csv"
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                setFileError('');
              }}
              className="min-h-32 font-mono text-sm"
              placeholder={
                'prompt,topic,tags,country\n"Which agencies help with AI search?",AI search,Discovery,Brazil'
              }
            />
            <p className="text-sm text-muted-foreground">
              {copy(
                'Columns: prompt, topic, tags, country. Separate tags with |. Up to 100 prompts.',
                'Colunas: prompt, topic, tags, country. Separe tags com |. Até 100 prompts.',
              )}
            </p>
          </div>
          {(fileError || importPreview.error) && (
            <p role="alert" className="text-sm text-destructive">
              {fileError ||
                importErrors[importPreview.error] ||
                importErrors.header}
            </p>
          )}
          {importPreview.rows.length > 0 && (
            <div className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-sm font-medium">
                <span>{copy('Preview', 'Prévia')}</span>
                <span className="text-muted-foreground">
                  {number(newImportRows.length)}{' '}
                  {copy('new prompts', 'novos prompts')}
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto">
                {importPreview.rows.map((row, index) => (
                  <div key={index} className="border-t px-3 py-2 text-sm">
                    <span>{row.text}</span>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {row.topic} · {countryLabel(row.country)}
                    </p>
                  </div>
                ))}
              </div>
              {newImportRows.length < importPreview.rows.length && (
                <p className="border-t px-3 py-2 text-sm text-muted-foreground">
                  {number(importPreview.rows.length - newImportRows.length)}{' '}
                  {copy(
                    'duplicate prompt(s) will be skipped.',
                    'prompt(s) duplicados serão ignorados.',
                  )}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              {copy('Cancel', 'Cancelar')}
            </Button>
            <Button
              disabled={readOnly || !newImportRows.length || !!fileError}
              onClick={() => {
                if (readOnly) return;
                setPrompts((current) => [
                  ...current,
                  ...newImportRows.map((row) => ({
                    ...row,
                    id: `p-${crypto.randomUUID()}`,
                    status: 'active' as const,
                  })),
                ]);
                setNotice(
                  `${number(newImportRows.length)} ${copy('prompt(s) imported', 'prompt(s) importados')}`,
                );
                setImportOpen(false);
                setStatus('active');
                setTopic('all');
                setSearch('');
                resetSelection();
              }}
            >
              {copy('Import', 'Importar')}{' '}
              {newImportRows.length ? number(newImportRows.length) : ''}{' '}
              {copy('prompts', 'prompts')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
