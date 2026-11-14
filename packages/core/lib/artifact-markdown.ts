// What the artifact editor knows of Markdown (components/analytics/artifact-editor.tsx), kept free of React so a test can
// read and write a document without a page: the formatting the toolbar makes (headings, bold, italic, strike, lists,
// links, quotes, code, rules, tables) and the app's data blocks (```chart, ```metrics, ```live), which stay fenced JSON
// in the Markdown, as the agent writes them and the reader draws them (lib/agent.ts `splitBlocks`).
import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import { TableKit } from '@tiptap/extension-table';

export const DATA_LANGS = ['chart', 'metrics', 'live'] as const;

/** A data block: one node the editor moves (by its handle) and deletes whole, written back as the fence it came from. */
export const DataBlock = Node.create({
  name: 'dataBlock',
  group: 'block',
  atom: true,
  selectable: true,
  // Moved by its handle (artifact-editor.tsx), not by the browser's drag.
  draggable: false,
  addAttributes() {
    return { lang: { default: 'chart' }, json: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-agent-block]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-agent-block': '' })];
  },
  renderMarkdown: (node) => `\`\`\`${String(node.attrs?.lang ?? 'chart')}\n${String(node.attrs?.json ?? '').trim()}\n\`\`\``,
});

/** Code blocks, except the data ones, which become a DataBlock. */
const Code = CodeBlock.extend({
  parseMarkdown(token, helpers) {
    if ((DATA_LANGS as readonly string[]).includes(String(token.lang))) return helpers.createNode('dataBlock', { lang: token.lang, json: String(token.text ?? '') });
    return this.parent?.(token, helpers) ?? [];
  },
});

/** The editor's extensions, without the views (the editor adds them to DataBlock). */
export function artifactExtensions(dataBlock: typeof DataBlock = DataBlock) {
  return [StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true }, dropcursor: { color: false, width: 3, class: 'agent-editor-dropcursor' } }), Code, TableKit.configure({ table: { resizable: false } }), dataBlock];
}
