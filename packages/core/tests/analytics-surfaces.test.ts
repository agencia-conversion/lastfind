import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { DemoResponse } from '../components/analytics/demo-data.ts';

const coreRoot = fileURLToPath(new URL('../', import.meta.url));

// Trend maths, prompt import and the fixture-backed Overview pieces that the
// public site still renders. The app itself is covered by the live-app tests.
await test('analytics helpers and the fixture overview render finite, correctly derived metrics', async () => {
  mkdirSync(resolve('.wrangler'), { recursive: true });
  const directory = mkdtempSync(resolve('.wrangler/analytics-prototype-'));
  try {
    const bundled = await build({
      stdin: {
        contents: `
          import React from 'react';
          import { renderToPipeableStream } from 'react-dom/server';
          import { PassThrough } from 'node:stream';
          import { OverviewMetrics, getTrendPoints, getTrendScale, formatPositionTick } from './components/analytics/overview.tsx';
          import { parseDemoPromptImport } from './components/analytics/prompt-import.ts';
          import { brandMetrics, demoBrands } from './components/analytics/demo-data.ts';
          import { LocaleProvider } from './lib/i18n.tsx';
          import { AccountAvatar } from './components/analytics/account-avatar.tsx';
          async function renderNode(element) {
            return new Promise((resolve,reject) => {
              const stream=new PassThrough(); let html='';
              stream.on('data',chunk => { html+=chunk.toString() });
              stream.on('end',() => resolve(html));
              stream.on('error',reject);
              const controller=renderToPipeableStream(
                element,
                {onAllReady(){controller.pipe(stream)},onShellError:reject,onError:reject}
              );
            });
          }
          export { getTrendPoints, getTrendScale, formatPositionTick, parseDemoPromptImport };
          export function renderAvatar(name, src) {
            return renderNode(React.createElement(AccountAvatar,{name,src,className:'avatar'}));
          }
          export function renderMetrics(responses) {
            const report={responses,previous:[],trend:[],brands:demoBrands.map(brand=>({...brand,...brandMetrics(responses,brand.id),change:0}))};
            return renderNode(React.createElement(LocaleProvider,{initialLocale:'en'},React.createElement(OverviewMetrics,{report})));
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
    const code = bundled.outputFiles[0].text;
    assert.ok(!code.includes('/api/'), 'The fixture helpers never call an API');

    const filename = join(directory, 'surface.mjs');
    writeFileSync(filename, code);
    const fixture = (await import(pathToFileURL(filename).href)) as {
      renderMetrics: (responses: DemoResponse[]) => Promise<string>;
      renderAvatar: (name: string, src?: string) => Promise<string>;
      parseDemoPromptImport: (
        input: string,
      ) => { text: string; topic: string; country: string; tags: string[] }[];
      formatPositionTick: (value: number, locale: string) => string;
      getTrendScale: (
        points: unknown[],
        brands: string[],
        metric: string,
      ) => { domain: number[]; ticks: number[] };
      getTrendPoints: (
        report: unknown,
        metric: string,
      ) => Record<string, number | string | null>[];
    };
    const accountHtml = await fixture.renderAvatar('Signed in name', '/api/avatar');
    assert.match(accountHtml, />SI<img[^>]*src="\/api\/avatar"/);
    const fallbackHtml = await fixture.renderAvatar('Signed in name');
    assert.match(fallbackHtml, />SI<\/span>/);
    assert.doesNotMatch(fallbackHtml, /<img/);
    const scale = fixture.getTrendScale(
      [
        { date: '2026-09-09', own: 12, other: 18 },
        { date: '2026-09-10', own: 14, other: 22 },
      ],
      ['own', 'other'],
      'visibility',
    );
    assert.ok(scale.domain[0] <= 12 && scale.domain[1] >= 22);
    assert.ok(
      scale.domain[1] - scale.domain[0] < 100,
      'clustered series use the vertical space',
    );
    const extremes = fixture.getTrendScale(
      [{ date: '2026-09-09', own: 0, other: 100 }],
      ['own', 'other'],
      'visibility',
    );
    assert.deepEqual(extremes.domain, [0, 100]);
    const positionScale = fixture.getTrendScale(
      [{ date: '2026-09-09', own: 1.5, other: 3 }],
      ['own', 'other'],
      'position',
    );
    assert.deepEqual(positionScale.ticks, [1, 1.5, 2, 2.5, 3, 3.5]);
    assert.deepEqual(
      positionScale.ticks.map((tick) =>
        fixture.formatPositionTick(tick, 'en-US'),
      ),
      ['1', '1.5', '2', '2.5', '3', '3.5'],
    );
    assert.deepEqual(
      positionScale.ticks.map((tick) =>
        fixture.formatPositionTick(tick, 'pt-BR'),
      ),
      ['1', '1,5', '2', '2,5', '3', '3,5'],
    );
    const imported = fixture.parseDemoPromptImport(
      'prompt,topic,country,tags\n"Which agencies, for SEO?",SEO,Brazil,Discovery|Buying\n"What is ""quality"" SEO?",SEO,United States,Research',
    );
    assert.equal(imported.length, 2);
    assert.equal(imported[0].text, 'Which agencies, for SEO?');
    assert.deepEqual(imported[0].tags, ['Discovery', 'Buying']);
    assert.throws(
      () =>
        fixture.parseDemoPromptImport('prompt,country\nValid question?,Spain'),
      /country/,
    );
    assert.throws(
      () => fixture.parseDemoPromptImport('prompt\n"Unclosed question?'),
      /quotes/,
    );
    assert.throws(
      () =>
        fixture.parseDemoPromptImport(
          'prompt\n' +
            Array.from({ length: 101 }, () => 'Valid question?').join('\n'),
        ),
      /rows/,
    );

    const trendReport = {
      brands: [{ id: 'conversion' }, { id: 'mestre' }],
      trend: [{ date: '2026-09-08' }, { date: '2026-09-09' }],
      responses: [
        {
          id: 'sample',
          promptId: 'p1',
          date: '2026-09-09T07:00:00Z',
          model: 'ChatGPT',
          brandIds: ['mestre'],
          sentiment: 80,
          sourceIds: [],
          consultedSourceIds: null,
        },
      ],
    };
    const sparseSov = fixture.getTrendPoints(trendReport, 'shareOfVoice');
    assert.equal(
      sparseSov.length,
      1,
      'days without responses do not create chart categories',
    );
    assert.equal(sparseSov[0].conversion, 0);
    assert.equal(sparseSov[0].mestre, 100);
    const sparsePosition = fixture.getTrendPoints(trendReport, 'position');
    assert.equal(sparsePosition[0].conversion, null);
    assert.equal(sparsePosition[0].mestre, 1);

    const base = {
      promptId: 'p1',
      date: '2026-09-09T07:00:00.000Z',
      model: 'ChatGPT' as const,
      sentiment: 80,
      consultedSourceIds: null,
    };
    const overview = await fixture.renderMetrics([
      {
        ...base,
        id: 'one',
        brandIds: ['conversion', 'mestre'],
        sourceIds: ['s1', 's2'],
      },
      {
        ...base,
        id: 'two',
        brandIds: ['mestre', 'conversion'],
        sourceIds: ['s1'],
      },
      { ...base, id: 'three', brandIds: ['mestre'], sourceIds: ['s3'] },
    ]);
    const cards = overview.split(/class="metric-summary[ "]/).slice(1);
    assert.match(
      cards[0],
      /66\.7%/,
      'Visibility divides brand mentions by the three responses',
    );
    assert.match(
      cards[1],
      /40\.0%/,
      'Share of voice divides two mentions by five total brand mentions',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
