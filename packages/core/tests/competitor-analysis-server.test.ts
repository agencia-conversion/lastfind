import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const core = fileURLToPath(new URL('..', import.meta.url));

async function bundledModule(entry: string, stubs: Record<string, string>) {
  const output = await build({
    stdin: { contents: entry, resolveDir: core, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [
      {
        name: 'server-policy-fixtures',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            Object.hasOwn(stubs, args.path)
              ? { path: args.path, namespace: 'fixture' }
              : undefined,
          );
          builder.onResolve({ filter: /^@\/lib\// }, (args) => ({
            path: `${core}/${args.path.slice(2)}${args.path.endsWith('.mjs') ? '' : '.ts'}`,
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: stubs[args.path]!,
            loader: 'js',
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`
  );
}

void test('failed analysis waits for an explicit refresh instead of automatic ensure', async () => {
  const serverModule = await bundledModule(
    "export {competitorAnalysisStatus,ensureCompetitorAnalysis} from './lib/server/competitor-analysis.ts'; export {setFixture} from 'fixture';",
    {
      fixture:
        'let value; export const setFixture = next => value = next; export const current = () => value;',
      '@/lib/target-snapshot.mjs':
        'export const buildTargetSnapshot = project => [{name:project.name,domain:project.domain}];',
      './project-store':
        "import {current} from 'fixture'; export const getProjectStore=async()=>current().registry; export const ensureProjectStore=getProjectStore; export const syncProjectStore=async()=>({registry:current().registry});",
      './project-store-transport':
        "import {current} from 'fixture'; export const projectStoreRpc=async request=>{current().requests.push(request); return current().status};",
      './workspace':
        "import {current} from 'fixture'; export const ownedProject=async()=>current().project;",
      './http':
        'export class ApiError extends Error { constructor(status,message) { super(message); this.status=status; } }',
    },
  );
  const base = {
    requests: [] as Array<Record<string, unknown>>,
    registry: {
      initialized: 1,
      generation: 'generation',
      source_revision: 3,
      applied_revision: 3,
    },
    project: {
      name: 'Acme Beacon',
      domain: 'acme.test',
      competitor_targets_revision: 7,
    },
    status: {
      revision: createHash('sha256')
        .update(JSON.stringify([{ name: 'Acme Beacon', domain: 'acme.test' }]))
        .digest('hex'),
      configVersion: 7,
      status: 'failed',
      processed: 0,
      scanned: 0,
      phase: 'seeds',
      total: 0,
      truncated: false,
      cutoff: null,
      maxRuns: 10_000,
      error: 'persistent failure',
      updatedAt: null,
      mutationRevision: 0,
      suggestions: [],
    },
  };
  serverModule.setFixture(base);
  const failed = await serverModule.competitorAnalysisStatus(
    'project',
    'owner',
  );
  assert.equal(failed.status, 'failed');
  assert.equal(failed.needsEnsure, false);
  await serverModule.ensureCompetitorAnalysis('project', 'owner', true);
  assert.equal(
    base.requests.findLast((request) => request.action === 'analysis-start')
      ?.restart,
    true,
  );
  serverModule.setFixture({
    ...base,
    status: { ...base.status, status: 'idle' },
  });
  assert.equal(
    (await serverModule.competitorAnalysisStatus('project', 'owner'))
      .needsEnsure,
    true,
  );
});

void test('project input rejects names and aliases without an identity', async () => {
  const validationModule = await bundledModule(
    "export {projectInput} from './lib/server/validation.ts';",
    {
      '@/lib/metrics':
        'export const normalizeDomain = value => value.toLowerCase();',
      './http': `
        export class ApiError extends Error { constructor(status,message) { super(message); this.status=status; } }
        export const textField = (value,label,min,max) => {
          if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new ApiError(400,label);
          return value.trim();
        };
      `,
    },
  );
  const valid = {
    name: 'Acme Beacon',
    domain: 'acme.test',
    language_code: 'en',
    competitors: [],
    aliases: [],
    additional_domains: [],
  };
  assert.throws(
    () => validationModule.projectInput({ ...valid, name: '--' }),
    /letra/,
  );
  assert.throws(
    () =>
      validationModule.projectInput({
        ...valid,
        competitors: [{ name: '?!', domain: 'other.test' }],
      }),
    /letra/,
  );
  assert.throws(
    () => validationModule.projectInput({ ...valid, aliases: ['—_'] }),
    /letra/,
  );
  assert.equal(validationModule.projectInput(valid).name, 'Acme Beacon');
});
