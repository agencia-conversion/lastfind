import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The artifact editor reads and writes Markdown (lib/artifact-markdown.ts): what the toolbar makes and the app's data
// blocks come back as they went in, so opening and saving an artifact never changes what the agent wrote.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  absWorkingDir: root,
  stdin: { contents: `export { artifactExtensions } from './packages/core/lib/artifact-markdown.ts'; export { MarkdownManager } from '@tiptap/markdown';`, resolveDir: root, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const { artifactExtensions, MarkdownManager } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const markdown = new MarkdownManager({ extensions: artifactExtensions() });

test('a document with the formatting the toolbar makes and a data block comes back as it went in', () => {
  const doc = [
    '# Brief',
    'Intro with **bold**, *italic*, ~~gone~~ and [a link](https://x.example).',
    '## Audience',
    '- one\n- two',
    '1. first\n2. second',
    '> a quote',
    '| Brand | Visibility |\n| --- | --- |\n| Netflix | 42,5% |\n| Max | 30% |',
    '```chart\n{"type":"bar","title":"T","unit":"%","series":[{"key":"k1","label":"V"}],"data":[{"x":"A","k1":1}]}\n```',
    '```js\nconst a = 1;\n```',
    '---',
    'End.',
  ].join('\n\n');
  const parsed = markdown.parse(doc);
  assert.equal(parsed.content.filter((node) => node.type === 'dataBlock').length, 1);
  assert.equal(parsed.content.filter((node) => node.type === 'codeBlock').length, 1);
  // Tables come back padded into columns; everything else, as written. Writing again changes nothing more.
  const written = markdown.serialize(parsed).replace(/\n{3,}/g, '\n\n').trim();
  const unpadded = (text) => text.replace(/ *\| */g, '|').replace(/-{3,}/g, '---');
  assert.equal(unpadded(written), unpadded(doc));
  assert.equal(markdown.serialize(markdown.parse(written)).replace(/\n{3,}/g, '\n\n').trim(), written);
  assert.deepEqual(markdown.parse(written), parsed);
});
