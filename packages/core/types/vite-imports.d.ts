// Vite resolves any `?raw` import to the file's contents as a string, and `import.meta.glob` to the matching modules, but
// the generated per-edition tsconfig (scripts/runtime.mjs) does not pull in `vite/client`'s ambient types, so declare
// the shapes used here: the blog's Markdown imports and the agent's bundled skills.
declare module '*.md?raw' {
  const content: string;
  export default content;
}
interface ImportMeta {
  glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
}
