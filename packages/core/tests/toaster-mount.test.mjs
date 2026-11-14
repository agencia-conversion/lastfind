import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../../../', import.meta.url));

void test('root layout mounts Toaster for every edition shell', () => {
  const source = readFileSync(root + 'packages/core/components/root-layout.tsx', 'utf8');
  assert.match(source, /import \{ Toaster \} from '@\/components\/ui\/toast'/);
  assert.match(source, /<Toaster>/);
  assert.match(source, /<\/Toaster>/);
  assert.match(
    readFileSync(root + 'apps/selfhost/app/layout.tsx', 'utf8'),
    /from '@\/components\/root-layout'/,
  );
});

const bundle = await build({
  stdin: {
    contents: `import React from 'react';
      import {Toaster, toast} from './components/ui/toast';
      export {Toaster, toast};`,
    resolveDir: root + 'packages/core',
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'lucide-react'],
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'fixtures',
      setup(builder) {
        builder.onResolve({ filter: /^@base-ui\/react\/toast$/ }, () => ({
          path: '@base-ui/react/toast',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `import React from 'react';
            let toasts = [];
            const listeners = new Set();
            const createToastManager = () => ({
              add(item) {
                const id = 't' + (toasts.length + 1);
                toasts = [...toasts, { id, ...item }];
                listeners.forEach((fn) => fn());
                return id;
              },
              close(id) { toasts = toasts.filter((item) => item.id !== id); listeners.forEach((fn) => fn()); },
            });
            function useToastManager() {
              const [, set] = React.useState(0);
              React.useEffect(() => {
                const fn = () => set((n) => n + 1);
                listeners.add(fn);
                return () => listeners.delete(fn);
              }, []);
              return { toasts };
            }
            const pass = (slot) => ({ children, ...props }) =>
              React.createElement('div', { 'data-slot': slot, ...props }, children);
            export const Toast = {
              createToastManager,
              useToastManager,
              Provider: ({ children }) => React.createElement(React.Fragment, null, children),
              Portal: pass('toast-portal'),
              Viewport: pass('toast-viewport'),
              Root: pass('toast'),
              Content: pass('toast-content'),
              Title: () => React.createElement('div', { 'data-slot': 'toast-title' }, 'Rejected'),
              Description: () => null,
              Action: (props) => React.createElement('button', { 'data-slot': 'toast-action', ...props }, props.children ?? 'Undo'),
              Close: ({ children }) => React.createElement('button', { 'data-slot': 'toast-close' }, children),
            };`,
          loader: 'tsx',
        }));
        builder.onResolve({ filter: /^@\// }, (args) => {
          const base = root + 'packages/core/' + args.path.slice(2);
          return {
            path:
              ['.ts', '.tsx'].map((ext) => base + ext).find(existsSync) ??
              base + '.ts',
          };
        });
      },
    },
  ],
});

const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(root + 'package.json'),
  mod,
  mod.exports,
);

void test('Toaster renders viewport and shows an undo toast after toast.add', () => {
  const { Toaster, toast } = mod.exports;
  toast.add({
    title: 'Rejected',
    type: 'success',
    actionProps: { children: 'Undo' },
  });
  const html = renderToStaticMarkup(
    createElement(Toaster, null, createElement('main', null, 'app')),
  );
  assert.match(html, /data-slot="toast-viewport"/);
  assert.match(html, /data-slot="toast-portal"/);
  assert.match(html, /data-slot="toast"/);
  assert.match(html, /Rejected/);
  assert.match(html, /Undo/);
  assert.match(html, />app</);
});
