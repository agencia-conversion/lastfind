'use client';
import type { ReactNode } from 'react';
import type { ChainedCommands, Editor } from '@tiptap/core';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { useCopy } from './shared';

type T = (en: string, pt: string) => string;

// ---------------------------------------------------------------- the commands (formatting bar and "/")

export type EditorCommand = { key: string; label: [string, string]; icon: LucideIcon; words: string; run: (chain: ChainedCommands) => ChainedCommands; active?: (editor: Editor) => boolean; keys?: string };

/** Kinds of block, in the order the menus list them. */
export const BLOCKS: EditorCommand[] = [
  { key: 'paragraph', label: ['Text', 'Texto'], icon: Pilcrow, words: 'text paragraph texto paragrafo normal', run: (chain) => chain.setParagraph(), active: (editor) => editor.isActive('paragraph') },
  { key: 'h1', label: ['Heading 1', 'Título 1'], icon: Heading1, words: 'h1 heading title titulo', run: (chain) => chain.toggleHeading({ level: 1 }), active: (editor) => editor.isActive('heading', { level: 1 }) },
  { key: 'h2', label: ['Heading 2', 'Título 2'], icon: Heading2, words: 'h2 heading subtitle titulo subtitulo', run: (chain) => chain.toggleHeading({ level: 2 }), active: (editor) => editor.isActive('heading', { level: 2 }) },
  { key: 'h3', label: ['Heading 3', 'Título 3'], icon: Heading3, words: 'h3 heading titulo', run: (chain) => chain.toggleHeading({ level: 3 }), active: (editor) => editor.isActive('heading', { level: 3 }) },
  { key: 'bullet', label: ['Bulleted list', 'Lista com marcadores'], icon: List, words: 'list bullet lista marcadores', run: (chain) => chain.toggleBulletList(), active: (editor) => editor.isActive('bulletList') },
  { key: 'ordered', label: ['Numbered list', 'Lista numerada'], icon: ListOrdered, words: 'list numbered ordered lista numerada', run: (chain) => chain.toggleOrderedList(), active: (editor) => editor.isActive('orderedList') },
  { key: 'quote', label: ['Quote', 'Citação'], icon: Quote, words: 'quote blockquote citacao', run: (chain) => chain.toggleBlockquote(), active: (editor) => editor.isActive('blockquote') },
  { key: 'code', label: ['Code', 'Código'], icon: Code, words: 'code codigo', run: (chain) => chain.toggleCodeBlock(), active: (editor) => editor.isActive('codeBlock') },
];
/** What goes in a document besides text. */
export const INSERTS: EditorCommand[] = [
  { key: 'table', label: ['Table', 'Tabela'], icon: Table2, words: 'table tabela', run: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { key: 'divider', label: ['Divider', 'Divisória'], icon: Minus, words: 'divider rule line divisoria linha', run: (chain) => chain.setHorizontalRule() },
];
/** Marks on the selected text. */
export const MARKS: EditorCommand[] = [
  { key: 'bold', label: ['Bold', 'Negrito'], icon: Bold, words: 'bold negrito', run: (chain) => chain.toggleBold(), active: (editor) => editor.isActive('bold'), keys: 'B' },
  { key: 'italic', label: ['Italic', 'Itálico'], icon: Italic, words: 'italic italico', run: (chain) => chain.toggleItalic(), active: (editor) => editor.isActive('italic'), keys: 'I' },
  { key: 'strike', label: ['Strikethrough', 'Tachado'], icon: Strikethrough, words: 'strike tachado', run: (chain) => chain.toggleStrike(), active: (editor) => editor.isActive('strike'), keys: 'Shift+S' },
];

/**
 * The formatting bar's layout, one for the editor and for its place while a document loads (docs/design/shell.md section 4,
 * persistent shell): headings, marks and the link, lists and blocks, inserts, Data, then undo and redo.
 */
export function EditorToolbarFrame({ toggle, button, link, data, history, placeholder, t }: { toggle: (command: EditorCommand) => ReactNode; button: (command: EditorCommand) => ReactNode; link: ReactNode; data: ReactNode; history: ReactNode; placeholder?: boolean; t: T }) {
  return (
    <div className="agent-editor-toolbar" role="toolbar" aria-label={t('Formatting', 'Formatação')} aria-disabled={placeholder || undefined} data-placeholder={placeholder || undefined}>
      <ButtonGroup>{BLOCKS.slice(1, 4).map(toggle)}</ButtonGroup>
      <ButtonGroup>
        {MARKS.map(toggle)}
        {link}
      </ButtonGroup>
      <ButtonGroup>{BLOCKS.slice(4).map(toggle)}</ButtonGroup>
      <ButtonGroup>{INSERTS.map(button)}</ButtonGroup>
      {data}
      <ButtonGroup className="ml-auto">{history}</ButtonGroup>
    </div>
  );
}

/**
 * The formatting bar while the document (or the editor's code) loads, or while the agent writes it: the same controls, disabled,
 * so switching files in the Brain or opening a content never takes the bar away; only the text below shows its skeleton. Where
 * the editor puts its own bar in the same place, this one hides (agent.css).
 */
export function EditorToolbarPlaceholder() {
  const t = useCopy();
  const off = (command: EditorCommand) => (
    <Toggle key={command.key} size="sm" disabled aria-label={t(...command.label)}>
      <command.icon />
    </Toggle>
  );
  return (
    <EditorToolbarFrame
      placeholder
      t={t}
      toggle={off}
      button={(command) => (
        <Button key={command.key} variant="ghost" size="icon" disabled aria-label={t(...command.label)}>
          <command.icon />
        </Button>
      )}
      link={off({ key: 'link', label: ['Link', 'Link'], icon: Link2, words: '', run: (chain) => chain })}
      data={
        <Button variant="ghost" disabled>
          {t('Data', 'Dados')}
        </Button>
      }
      history={
        <>
          <Button variant="ghost" size="icon" disabled aria-label={t('Undo', 'Desfazer')}>
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon" disabled aria-label={t('Redo', 'Refazer')}>
            <Redo2 />
          </Button>
        </>
      }
    />
  );
}
