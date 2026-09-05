import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const coreRoot = fileURLToPath(new URL('../', import.meta.url));

await test('real sources and competitor trends use complete reports when workspace summaries omit evidence', async () => {
  mkdirSync(resolve('.wrangler'), { recursive: true });
  const directory = mkdtempSync(resolve('.wrangler/analytics-surface-'));
  try {
    const bundled = await build({
      stdin: {
        contents: `
          import React from 'react';
          import { renderToPipeableStream } from 'react-dom/server';
          import { PassThrough } from 'node:stream';
          import { WorkspaceApp } from './components/lastfind/workspace-app.tsx';
          import { workspaceFixture } from './tests/fixtures/workspace.ts';
          const workspace=workspaceFixture();
          workspace.runs=workspace.runs.slice(0,25).map(run=>({...run,sources:[],consulted_sources:null,evidence_loaded:false,source_count:12}));
          export const projectId=workspace.selectedProjectId;
          export async function render(tab,extension=false){
            return new Promise((resolve,reject)=>{
              const stream=new PassThrough();let html='';
              stream.on('data',chunk=>{html+=chunk.toString()});stream.on('end',()=>resolve(html));stream.on('error',reject);
              const controller=renderToPipeableStream(React.createElement(WorkspaceApp,{initialData:extension?{...workspace,projects:[],selectedProjectId:null}:workspace,initialTab:tab,extensions:extension?[{id:'account-tools',label:'Account tools',icon:()=>null,render:()=>React.createElement('p',{'data-extension':'ready'},'Edition tools')}]:[]}),{
                onAllReady(){controller.pipe(stream)},onShellError:reject,onError:reject
              });
            });
          }
        `,
        resolveDir: coreRoot,
        loader: 'tsx',
      },
      plugins: [
        {
          name: 'external-boundaries',
          setup(plugin) {
            plugin.onResolve({ filter: /^next\/image$/ }, () => ({
              path: 'image',
              namespace: 'surface-fixture',
            }));
            plugin.onResolve({ filter: /^@\/hooks\/use-report$/ }, () => ({
              path: 'report',
              namespace: 'surface-fixture',
            }));
            plugin.onResolve({ filter: /^\.\/remote-sources$/ }, () => ({
              path: 'sources',
              namespace: 'surface-fixture',
            }));
            plugin.onResolve({ filter: /^\.\/visibility-chart$/ }, () => ({
              path: 'chart',
              namespace: 'surface-fixture',
            }));
            plugin.onLoad(
              { filter: /.*/, namespace: 'surface-fixture' },
              ({ path }) => ({
                loader: 'tsx',
                resolveDir: coreRoot,
                contents:
                  path === 'report'
                    ? `export function useReport(url){return {loading:false,error:undefined,data:url?{metrics:{responses:1000,mentions:100,citedDomains:15,visibility:10,shareOfVoice:20,cost:1.2},leaderboard:[],daily:[{date:'2026-09-01',brand:10},{date:'2026-09-02',brand:20}]}:undefined}}`
                    : path === 'sources'
                      ? `import React from 'react';export function RemoteSources({reportBase,refresh}){return <div data-source-report={reportBase} data-refresh={refresh}>Server citations</div>}`
                      : path === 'chart'
                        ? `import React from 'react';export function VisibilityChart({points}){return <div data-report-days={points?.length??0}>Server daily series</div>}`
                        : `import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>}`,
              }),
            );
          },
        },
      ],
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      jsx: 'automatic',
      write: false,
    });
    const filename = join(directory, 'surface.mjs');
    writeFileSync(filename, bundled.outputFiles[0].text);
    const fixture = (await import(pathToFileURL(filename).href)) as {
      projectId: string;
      render: (tab: string, extension?: boolean) => Promise<string>;
    };
    const sources = await fixture.render('sources');
    assert.ok(
      !sources.includes('Plan &amp; usage'),
      'Core navigation must not contain commercial account menus',
    );
    assert.ok(
      !bundled.outputFiles[0].text.includes('/api/billing'),
      'Shared UI must not bundle commercial API calls',
    );
    const extension = await fixture.render('account-tools', true);
    assert.ok(
      extension.includes('data-extension="ready"'),
      'Edition tools stay accessible before creating the first project',
    );
    assert.ok(
      sources.includes(
        'data-source-report="/api/reports?project=' + fixture.projectId,
      ),
    );
    assert.ok(sources.includes('Server citations'));
    assert.ok(!sources.includes('No citations in this period'));
    const competitors = await fixture.render('competitors');
    assert.ok(
      competitors.includes('data-report-days="2"'),
      'Competitor charts must receive the server series, not derive trends from 25 summaries',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
