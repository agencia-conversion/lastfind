import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const coreRoot = fileURLToPath(new URL('../', import.meta.url));

await test('one language menu outside the app (flag, code and chevron beside them) and the submenu inside account menus', async () => {
  const sidebar = readFileSync(
    resolve(coreRoot, 'components/analytics/analytics-sidebar.tsx'),
    'utf8',
  );
  const liveApp = readFileSync(
    resolve(coreRoot, 'components/analytics/live-app.tsx'),
    'utf8',
  );
  assert.match(sidebar, /<LanguageSwitcher submenu/);
  assert.match(liveApp, /<LanguageSwitcher submenu/);
  // Every page outside the app shows the site header's language menu, never a second switcher (the hosted edition's
  // pages are checked beside its header test).
  const root = resolve(coreRoot, '../..');
  for (const path of [
    'apps/selfhost/components/lastfind/owner-welcome.tsx',
    'apps/selfhost/app/docs/docs-client.tsx',
    'packages/core/components/lastfind/connect-consent.tsx',
  ])
    assert.match(readFileSync(resolve(root, path), 'utf8'), /<LanguageMenu\b/, path);

  mkdirSync(resolve('.wrangler'), { recursive: true });
  const directory = mkdtempSync(resolve('.wrangler/language-switcher-'));
  try {
    const bundled = await build({
      stdin: {
        contents: `
          import React from 'react';
          import { renderToStaticMarkup } from 'react-dom/server';
          import { LanguageMenu } from './components/lastfind/public-menu.tsx';
          export function render(locale) {
            return renderToStaticMarkup(React.createElement(LanguageMenu, { locale, instance: 'test', onSelect: () => {} }));
          }
        `,
        resolveDir: coreRoot,
        loader: 'tsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      loader: { '.css': 'empty' },
      jsx: 'automatic',
      write: false,
    });
    const filename = join(directory, 'switcher.mjs');
    writeFileSync(filename, bundled.outputFiles[0].text);
    const { render } = (await import(pathToFileURL(filename).href)) as {
      render: (locale: 'en' | 'pt-BR') => string;
    };
    assert.match(render('en'), /aria-label="Interface language: EN"/);
    assert.match(render('pt-BR'), /aria-label="Idioma da interface: PT"/);
    // The flag, the code, then the chevron, inside one trigger (side by side, never stacked).
    assert.match(render('pt-BR'), /<button[^>]*lf-public-menu-trigger[^>]*><span class="lf-public-flag" aria-hidden="true">🇧🇷<\/span>PT<svg[^>]*lucide-chevron-down/);
    assert.match(render('en'), />🇺🇸<\/span>EN<svg/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
