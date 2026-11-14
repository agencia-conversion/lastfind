'use client';
// The artifact's editor (members): rich text over the artifact's Markdown, as in Claude's artifacts and Google Docs.
// Headings, bold, italic, strike, lists, links, quotes, code, rules and tables from the formatting bar, a "/" typed in the
// text or Markdown typed as you go ("## ", "- ", "**"); the project's charts and figures from a searchable picker (the
// bar's Data and "/"); the app's data blocks drawn as in the reader, moved by their handle or deleted whole. One list of
// commands feeds the bar and "/". It hands Markdown back on every change
// (lib/artifact-markdown.ts reads and writes it); saving is the caller's. Loaded only when a member opens an artifact
// (React.lazy in agent-screen.tsx).
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Extension, type Range } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type Editor, type NodeViewProps } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';
import {
  ChartColumnBig,
  GripVertical,
  Link2,
  Redo2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Hint } from '@/components/ui/tooltip';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { requestJson } from '@/lib/client';
import { LIVE_PRESETS, blockId, liveFence, readLiveBlock, type LiveBlock } from '@/lib/agent-blocks';
import { DataBlock, artifactExtensions } from '@/lib/artifact-markdown';
import { AgentMarkdown, LiveBlockView } from './agent-blocks';
import { BLOCKS, EditorToolbarFrame, INSERTS, MARKS, type EditorCommand } from './editor-toolbar';

type T = (en: string, pt: string) => string;
type Preset = (typeof LIVE_PRESETS)[number];

/** The artifact being edited: a data block switched to update by itself is computed again at once. */
const ArtifactIdContext = createContext('');

/** A block's figures computed now, for the artifact's project (POST …/blocks). */
const computed = (artifactId: string, block: LiveBlock) =>
  requestJson<{ block: LiveBlock }>(`/api/agent/artifacts/${encodeURIComponent(artifactId)}/blocks`, 'POST', { block }).then((data) => data.block);

// ---------------------------------------------------------------- the commands (formatting bar and "/")

const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Inserts the project's data (a preset) after what is selected: a block just inserted stays selected, the next goes below it. */
function useInsertData(editor: Editor | null, artifactId: string, t: T) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const insert = async (preset: Preset) => {
    if (!editor || !artifactId) return;
    setBusy(true);
    setFailure(null);
    try {
      // A report's chart is titled as the picker names it, in the editor's language.
      const block = await computed(artifactId, { ...preset.block, id: blockId(), period: { days: 28 }, ...(preset.block.data === 'report' ? { title: t(...preset.label) } : {}) });
      editor.chain().focus().insertContentAt(editor.state.selection.to, liveFence(block), { contentType: 'markdown' }).run();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return { insert, busy, failure };
}

// ---------------------------------------------------------------- data blocks

/**
 * A data block as the reader draws it, with room around it: selected, it shows a soft edge (Delete removes it); its
 * handle on the left moves it. A block bound to the project's data also switches between updating by itself and
 * keeping its figures.
 */
function DataBlockView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const artifactId = useContext(ArtifactIdContext);
  const t = useContext(CopyContext);
  const lang = String(node.attrs.lang);
  const json = String(node.attrs.json);
  let live: LiveBlock | null = null;
  if (lang === 'live')
    try {
      live = readLiveBlock(JSON.parse(json));
    } catch {
      // Drawn as written.
    }
  const setMode = (mode: 'live' | 'frozen') => {
    if (!live) return;
    const next = { ...live, mode };
    updateAttributes({ json: JSON.stringify(next) });
    if (mode === 'live' && artifactId) void computed(artifactId, next).then((block) => updateAttributes({ json: JSON.stringify(block) }), () => {});
  };
  return (
    <NodeViewWrapper className="agent-editor-block" data-selected={selected || undefined} contentEditable={false}>
      {editor.isEditable && (
        <button
          type="button"
          className="agent-editor-handle"
          aria-label={t('Move: drag, or use the up and down arrows', 'Mover: arraste, ou use as setas para cima e para baixo')}
          onPointerDown={(event) => dragBlock(editor, getPos, event)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            stepBlock(editor, getPos, event.key === 'ArrowUp' ? -1 : 1);
          }}
        >
          <GripVertical aria-hidden="true" />
        </button>
      )}
      {live ? <LiveBlockView block={live} onMode={editor.isEditable ? setMode : undefined} /> : <AgentMarkdown text={`\`\`\`${lang}\n${json}\n\`\`\``} />}
    </NodeViewWrapper>
  );
}
const CopyContext = createContext<T>((en) => en);

/** Moves a block one place up (-1) or down (1), past its neighbour: the handle's arrow keys. */
function stepBlock(editor: Editor, getPos: () => number | undefined, step: -1 | 1) {
  const from = getPos();
  const { view } = editor;
  const node = typeof from === 'number' ? view.state.doc.nodeAt(from) : null;
  if (typeof from !== 'number' || !node) return;
  const $from = view.state.doc.resolve(from);
  const index = $from.index(0);
  const neighbour = view.state.doc.maybeChild(index + step);
  if (!neighbour) return;
  const target = step < 0 ? from - neighbour.nodeSize : from + node.nodeSize + neighbour.nodeSize;
  const tr = view.state.tr.delete(from, from + node.nodeSize);
  const at = tr.mapping.map(target, step < 0 ? -1 : 1);
  tr.insert(at, node).setSelection(NodeSelection.create(tr.doc, at));
  view.dispatch(tr.scrollIntoView());
}

/**
 * Moves a block by its handle, with the pointer (the browser's own drag drags a picture of the block and the text around
 * it): a line shows where it lands, between the document's blocks; letting go moves it there, and it stays selected.
 */
function dragBlock(editor: Editor, getPos: () => number | undefined, start: React.PointerEvent) {
  const from = getPos();
  if (typeof from !== 'number' || start.button !== 0) return;
  start.preventDefault();
  const { view } = editor;
  const line = document.createElement('div');
  line.className = 'agent-editor-dropline';
  document.body.appendChild(line);
  document.documentElement.dataset.dragging = 'block';
  let target: number | null = null;
  const move = (event: PointerEvent) => {
    // Near the top or the bottom of the window, the page scrolls on.
    if (event.clientY < 96) window.scrollBy(0, -12);
    else if (event.clientY > window.innerHeight - 48) window.scrollBy(0, 12);
    const page = view.dom.getBoundingClientRect();
    let best: { at: number; y: number } | null = null;
    view.state.doc.forEach((child, offset) => {
      const dom = view.nodeDOM(offset);
      if (!(dom instanceof HTMLElement)) return;
      const box = dom.getBoundingClientRect();
      for (const edge of [
        { at: offset, y: box.top },
        { at: offset + child.nodeSize, y: box.bottom },
      ])
        if (!best || Math.abs(edge.y - event.clientY) < Math.abs(best.y - event.clientY)) best = edge;
    });
    const found = best as { at: number; y: number } | null;
    target = found?.at ?? null;
    if (!found) return;
    Object.assign(line.style, { top: `${found.y - 1}px`, left: `${page.left}px`, width: `${page.width}px` });
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    line.remove();
    delete document.documentElement.dataset.dragging;
    const node = view.state.doc.nodeAt(from);
    if (target === null || !node || (target >= from && target <= from + node.nodeSize)) return;
    const tr = view.state.tr.delete(from, from + node.nodeSize);
    const at = tr.mapping.map(target);
    tr.insert(at, node).setSelection(NodeSelection.create(tr.doc, at));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
const EditableDataBlock = DataBlock.extend({ addNodeView: () => ReactNodeViewRenderer(DataBlockView) });

/** The document as Markdown, with no run of more than one blank line. */
export const markdownOf = (editor: Editor) => editor.getMarkdown().replace(/\n{3,}/g, '\n\n').trim();

// ---------------------------------------------------------------- "/" in the text

type SlashItem = { key: string; label: string; group: string; icon: LucideIcon; run: (editor: Editor, range: Range) => void };
type SlashState = { items: SlashItem[]; pick: (item: SlashItem) => void; host: HTMLElement };
type SlashHandlers = { items: (query: string) => SlashItem[]; show: (state: SlashState | null) => void; key: (event: KeyboardEvent) => boolean };

/** Each editor's current "/" handlers, which its component hands over after every render. */
const SLASH_HANDLERS = new WeakMap<Editor, SlashHandlers>();
const NO_SLASH: SlashHandlers = { items: () => [], show: () => {}, key: () => false };

/** "/" opens the commands at the caret (after a space or at the start of a line); typing filters them. */
const SlashCommands = Extension.create({
  name: 'slashCommands',
  addProseMirrorPlugins() {
    const editor = this.editor;
    const storage = { get handlers() { return SLASH_HANDLERS.get(editor) ?? NO_SLASH; } };
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        items: ({ query }) => storage.handlers.items(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let host: HTMLElement | null = null;
          let unmount: (() => void) | undefined;
          const show = (props: SuggestionProps<SlashItem, SlashItem>) => host && storage.handlers.show({ items: props.items, pick: props.command, host });
          return {
            onStart: (props) => {
              host = document.createElement('div');
              host.className = 'agent-slash-host';
              unmount = props.mount(host);
              show(props);
            },
            onUpdate: show,
            onKeyDown: ({ event }) => storage.handlers.key(event),
            onExit: () => {
              storage.handlers.show(null);
              unmount?.();
              host = null;
            },
          };
        },
      }),
    ];
  },
});

function SlashMenu({ state, active, onActive, t }: { state: SlashState; active: number; onActive: (index: number) => void; t: T }) {
  const groups = [...new Set(state.items.map((item) => item.group))];
  return createPortal(
    <Command className="agent-slash shadow-md ring-1 ring-foreground/10" shouldFilter={false} value={state.items[active]?.key ?? ''} onValueChange={(key) => onActive(state.items.findIndex((item) => item.key === key))} label={t('Commands', 'Comandos')}>
      <CommandList>
        <CommandEmpty>{t('No command found', 'Nenhum comando encontrado')}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group} heading={group}>
            {state.items
              .filter((item) => item.group === group)
              .map((item) => (
                <CommandItem key={item.key} value={item.key} onMouseDown={(event) => event.preventDefault()} onSelect={() => state.pick(item)}>
                  <item.icon aria-hidden="true" />
                  {item.label}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>,
    state.host,
  );
}

// ---------------------------------------------------------------- the bars

function LinkButton({ editor, t }: { editor: Editor; t: T }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const apply = () => {
    const href = url.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!href) chain.unsetLink().run();
    else chain.setLink({ href: /^(https?:|mailto:|\/)/i.test(href) ? href : `https://${href}` }).run();
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setUrl(String(editor.getAttributes('link').href ?? ''));
        setOpen(next);
      }}
    >
      <Hint text={t('Link', 'Link')}>
        <PopoverTrigger render={<Toggle size="sm" pressed={editor.isActive('link')} aria-label={t('Link', 'Link')} />}>
          <Link2 />
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="start" className="agent-editor-link">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <InputGroup>
            <InputGroupInput value={url} placeholder="https://" aria-label={t('Link address', 'Endereço do link')} onChange={(event) => setUrl(event.target.value)} />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit">{url.trim() ? t('Apply', 'Aplicar') : t('Remove', 'Remover')}</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Which marks and blocks the selection has, and what undo and redo can do: the bars follow it. */
function useActive(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      ...Object.fromEntries([...BLOCKS, ...MARKS].map((command) => [command.key, !!command.active?.(current)])),
      undo: current.can().undo(),
      redo: current.can().redo(),
    }),
  });
}

type InsertData = ReturnType<typeof useInsertData>;

/**
 * The project's charts and figures, searchable: every shape each kind of data has (lib/agent-blocks.ts), grouped as the
 * screens are. Opened from the formatting bar's Data and from "/"; the chosen one is computed now and inserted.
 */
function ChartPicker({ open, onOpenChange, data, t }: { open: boolean; onOpenChange: (open: boolean) => void; data: InsertData; t: T }) {
  const groups = [...new Map(LIVE_PRESETS.map((preset) => [preset.group[0], preset.group])).values()];
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('Insert a chart or figure', 'Inserir gráfico ou número')} description={t('From this project, last 28 days', 'Deste projeto, últimos 28 dias')}>
      <Command>
        <CommandInput placeholder={t('Search charts and figures', 'Buscar gráficos e números')} />
        <CommandList className="agent-chart-picker">
          <CommandEmpty>{t('No chart matches', 'Nenhum gráfico encontrado')}</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group[0]} heading={t(...group)}>
              {LIVE_PRESETS.filter((preset) => preset.group[0] === group[0]).map((preset) => (
                <CommandItem
                  key={preset.key}
                  value={`${t(...preset.label)} ${preset.label[0]} ${t(...group)}`}
                  onSelect={() => {
                    onOpenChange(false);
                    void data.insert(preset);
                  }}
                >
                  <ChartColumnBig aria-hidden="true" />
                  {t(...preset.label)}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function Toolbar({ editor, data, onCharts, t }: { editor: Editor; data: InsertData | null; onCharts: () => void; t: T }) {
  const state = useActive(editor);
  const toggle = (command: EditorCommand) => (
    <Hint key={command.key} text={t(...command.label)}>
      <Toggle size="sm" pressed={!!state[command.key as keyof typeof state]} aria-label={t(...command.label)} onPressedChange={() => command.run(editor.chain().focus()).run()}>
        <command.icon />
      </Toggle>
    </Hint>
  );
  const button = (command: EditorCommand) => (
    <Hint key={command.key} text={t(...command.label)}>
      <Button variant="ghost" size="icon" aria-label={t(`Insert ${command.label[0].toLowerCase()}`, `Inserir ${command.label[1].toLowerCase()}`)} onClick={() => command.run(editor.chain().focus()).run()}>
        <command.icon />
      </Button>
    </Hint>
  );
  return (
    <EditorToolbarFrame
      t={t}
      toggle={toggle}
      button={button}
      link={<LinkButton editor={editor} t={t} />}
      data={
        data && (
          <Hint text={data.failure ?? t('Insert a chart or figure from this project', 'Inserir gráfico ou número deste projeto')}>
            <Button variant="ghost" pending={data.busy} pendingLabel={t('Computing…', 'Calculando…')} aria-invalid={data.failure ? true : undefined} onClick={onCharts}>
              {t('Data', 'Dados')}
            </Button>
          </Hint>
        )
      }
      history={
        <>
          <Hint text={t('Undo', 'Desfazer')}>
            <Button variant="ghost" size="icon" disabled={!state.undo} aria-label={t('Undo', 'Desfazer')} onClick={() => editor.chain().focus().undo().run()}>
              <Undo2 />
            </Button>
          </Hint>
          <Hint text={t('Redo', 'Refazer')}>
            <Button variant="ghost" size="icon" disabled={!state.redo} aria-label={t('Redo', 'Refazer')} onClick={() => editor.chain().focus().redo().run()}>
              <Redo2 />
            </Button>
          </Hint>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------- the editor

export default function ArtifactEditor({
  artifactId,
  markdown,
  editable,
  onChange,
  onSelection,
  bars,
  label,
  t,
}: {
  artifactId: string;
  markdown: string;
  /** Off while the agent writes this artifact: the person sees its edit arrive, then goes on. */
  editable: boolean;
  onChange: (markdown: string) => void;
  /** The selected text (up to 2,000 characters), for the chat beside: what "this" means in a message. */
  onSelection?: (text: string) => void;
  /** Where the formatting bar goes (the page's second header); absent, it sits on top of the document. */
  bars?: HTMLElement | null;
  label: string;
  t: T;
}) {
  const changed = useRef(onChange);
  const selected = useRef(onSelection);
  // The document as the editor first wrote it back: opening (and the editor's own tidying) is not a change.
  const baseline = useRef<string | null>(null);
  useEffect(() => {
    changed.current = onChange;
    selected.current = onSelection;
  });
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [active, setActive] = useState(0);
  const slashRef = useRef({ slash, active });
  useEffect(() => {
    slashRef.current = { slash, active };
  });
  const [charts, setCharts] = useState(false);
  const openChartsRef = useRef(() => {});
  const slashHandlers: SlashHandlers = {
    items: (query) => {
      const wanted = plain(query);
      const commands = [...BLOCKS, ...INSERTS].map((command) => ({
        key: command.key,
        label: t(...command.label),
        group: t('Format', 'Formatar'),
        icon: command.icon,
        words: `${command.words} ${plain(t(...command.label))}`,
        run: (editor: Editor, range: Range) => command.run(editor.chain().focus().deleteRange(range)).run(),
      }));
      const charts = {
        key: 'charts',
        label: t('Chart or figure…', 'Gráfico ou número…'),
        group: t('Data from this project', 'Dados deste projeto'),
        icon: ChartColumnBig,
        words: `chart graph figure data report dados grafico numero relatorio ${plain(t('Chart or figure', 'Gráfico ou número'))}`,
        run: (editor: Editor, range: Range) => {
          editor.chain().focus().deleteRange(range).run();
          openChartsRef.current();
        },
      };
      // The project's charts first: the reason to type "/" in a report.
      return [...(artifactId ? [charts] : []), ...commands].filter((item) => !wanted || item.words.includes(wanted)).map(({ words: _words, ...item }) => item);
    },
    show: (state) => {
      setSlash(state);
      setActive(0);
    },
    key: (event) => {
      const { slash: open, active: index } = slashRef.current;
      if (!open?.items.length) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((index + step + open.items.length) % open.items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        open.pick(open.items[index] ?? open.items[0]);
        return true;
      }
      return false;
    },
  };
  const editor = useEditor({
    // Drawn in the first render (it never renders on the server: the artifact loads in the browser), so the text is never
    // a blank editor for a frame between the reader and the editor.
    immediatelyRender: true,
    extensions: [
      ...artifactExtensions(EditableDataBlock),
      Markdown,
      Placeholder.configure({ placeholder: t('Start writing, type / for commands, or ask the agent.', 'Comece a escrever, digite / para comandos, ou peça ao agente.') }),
      SlashCommands,
    ],
    content: markdown,
    contentType: 'markdown',
    editable,
    editorProps: { attributes: { class: 'agent-editor-content live-answer', 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' } },
    onCreate: ({ editor: current }) => {
      baseline.current = markdownOf(current);
    },
    onUpdate: ({ editor: current }) => {
      const next = markdownOf(current);
      // The editor's own first passes (before it says it is ready) only set the baseline.
      if (baseline.current === null) baseline.current = next;
      if (next === baseline.current) return;
      baseline.current = next;
      changed.current(next);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      const text = from === to ? '' : current.state.doc.textBetween(from, to, '\n').slice(0, 2000);
      selected.current?.(text.trim() ? text : '');
    },
  });
  const data = useInsertData(editor, artifactId, t);
  useEffect(() => {
    openChartsRef.current = () => setCharts(true);
    if (editor) SLASH_HANDLERS.set(editor, slashHandlers);
  });
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  // A new version from outside (the agent wrote it, or the person took it in a conflict) replaces the text on screen,
  // out of the undo history.
  const applied = useRef(markdown);
  useEffect(() => {
    if (!editor || markdown === applied.current) return;
    applied.current = markdown;
    if (markdown === markdownOf(editor)) return;
    editor.chain().setMeta('addToHistory', false).setContent(markdown, { contentType: 'markdown', emitUpdate: false }).run();
    baseline.current = markdownOf(editor);
  }, [editor, markdown]);
  const insertData = artifactId ? data : null;
  const controls = editor && <Toolbar editor={editor} data={insertData} onCharts={() => setCharts(true)} t={t} />;
  return (
    <ArtifactIdContext.Provider value={artifactId}>
      <CopyContext.Provider value={t}>
        <div className="agent-editor agent-markdown" data-document data-editable={editable || undefined}>
          {editor && editable && (bars === undefined ? controls : bars && createPortal(controls, bars))}
          <EditorContent editor={editor} />
          {slash && <SlashMenu state={slash} active={active} onActive={(index) => index >= 0 && setActive(index)} t={t} />}
          {insertData && <ChartPicker open={charts} onOpenChange={setCharts} data={insertData} t={t} />}
        </div>
      </CopyContext.Provider>
    </ArtifactIdContext.Provider>
  );
}
