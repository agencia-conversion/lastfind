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
    "export {competitorAnalysisStatus,ensureCompetitorAnalysis,syncCountedBrands} from './lib/server/competitor-analysis.ts'; export {setFixture} from 'fixture';",
    {
      fixture:
        'let value; export const setFixture = next => value = next; export const current = () => value;',
      '@/lib/target-snapshot.mjs':
        'export const buildTargetSnapshot = project => [{name:project.name,domain:project.domain}];',
      './project-store':
        "import {current} from 'fixture'; export const getProjectStore=async()=>current().registry; export const ensureProjectStore=getProjectStore; export const syncProjectStore=async()=>({registry:current().registry});",
      './project-store-transport':
        "import {current} from 'fixture'; export const projectStoreRpc=async request=>{current().requests.push(request); return request.action==='query' ? [{results:current().spans ?? []}] : current().status};",
      './workspace':
        "import {current} from 'fixture'; export const ownedProject=async()=>current().project;",
      './http':
        'export class ApiError extends Error { constructor(status,message) { super(message); this.status=status; } }',
      './env': "export const setting=()=>'';",
      './brand-roles':
        "export const decidedRoles=async()=>new Map([['loja cliente','client'],['rival','competitor'],['talvez','ambiguous'],['seo','mention']]);",
      './brand-decision-events':
        "import {current} from 'fixture'; export const loadDecisionEvents=async()=>current().events ?? [];",
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
  // Names the decision model settled as anything but a competitor are left out of the read; competitors and doubts stay.
  assert.deepEqual(base.requests.find((request) => request.action === 'analysis-status')?.exclude, ['loja cliente', 'seo']);
  // Settled competitors are always returned, beyond the 200 most mentioned.
  assert.deepEqual(base.requests.find((request) => request.action === 'analysis-status')?.include, ['rival']);
  await serverModule.ensureCompetitorAnalysis('project', 'owner', true);
  assert.equal(
    base.requests.findLast((request) => request.action === 'analysis-start')
      ?.restart,
    true,
  );
  // Share of voice and position count only settled competitors, a merged name in the group it joined (even a doubtful one),
  // and nothing the owner rejected.
  const event = (id: string, kind: string, brandKey: string, intoKey?: string) =>
    ({ id, seq: Number(id), kind, brandKey, undoes: null, payload: { name: brandKey, ...(intoKey ? { intoKey } : {}) }, author: 'owner', createdAt: '2026-10-30T00:00:00.000Z' });
  const merges = [event('1', 'alias', 'rival labs', 'rival'), event('2', 'alias', 'talvez', 'rival')];
  serverModule.setFixture({ ...base, events: merges });
  await serverModule.syncCountedBrands('project', 'owner');
  assert.deepEqual(base.requests.findLast((request) => request.action === 'brand-counted')?.groups, { rival: 'rival', 'rival labs': 'rival', talvez: 'rival' });
  serverModule.setFixture({ ...base, events: [...merges, event('3', 'reject', 'rival')] });
  await serverModule.syncCountedBrands('project', 'owner');
  assert.deepEqual(base.requests.findLast((request) => request.action === 'brand-counted')?.groups, {});
  // A longer name a name question settled as the monitored brand itself ("Amazon Prime Video" for Prime Video) is that brand:
  // never counted beside it, and listed as an alias so the lists leave it out (12/11/2026: the Overview ranked it beside the brand).
  serverModule.setFixture({ ...base, events: merges, spans: [{ span: 'Rival Labs' }, { span: 'Acme Beacon' }, { span: null }] });
  await serverModule.syncCountedBrands('project', 'owner');
  const sent = base.requests.findLast((request) => request.action === 'brand-counted');
  assert.deepEqual(sent?.groups, { rival: 'rival', talvez: 'rival' });
  assert.deepEqual(sent?.aliases, ['rival labs']);
  // Only settled verdicts: an open name question joins nothing (joining brands is the owner's decision).
  const asked = base.requests.findLast((request) => request.action === 'query')?.statements as { sql: string }[];
  assert.match(asked[0]!.sql, /counted=1 AND json_extract\(request_json,'\$\.pair'\) IS NOT NULL/);
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

void test("a competitor keeps its other domains, main one first; none is the brand's or another competitor's", async () => {
  const { projectInput, projectNameInput } = await bundledModule("export {projectInput, projectNameInput} from './lib/server/validation.ts';", {
    '@/lib/metrics': 'export const normalizeDomain = value => value.toLowerCase();',
    './http': `
      export class ApiError extends Error { constructor(status,message) { super(message); this.status=status; } }
      export const textField = (value,label,min,max) => {
        if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new ApiError(400,label);
        return value.trim();
      };
    `,
  });
  const valid = { name: 'Acme Beacon', domain: 'acme.test', aliases: [], additional_domains: [] };
  const beta = { name: 'Beta', domain: 'beta.test' };
  assert.deepEqual(projectInput({ ...valid, competitors: [{ ...beta, domains: ['beta.test', 'beta.example', 'BETA.example'] }] }).competitors, [{ name: 'Beta', domain: 'beta.test', domains: ['beta.test', 'beta.example'] }]);
  // A settings save sends the stored list back: the same list comes out.
  assert.deepEqual(projectInput({ ...valid, competitors: [{ ...beta, domains: ['beta.test', 'beta.example'] }] }).competitors[0].domains, ['beta.test', 'beta.example']);
  // Without other domains nothing is added, as before.
  assert.deepEqual(projectInput({ ...valid, competitors: [beta] }).competitors, [beta]);
  assert.throws(() => projectInput({ ...valid, competitors: [{ ...beta, domains: ['acme.test'] }] }), /domínio da marca/);
  assert.throws(() => projectInput({ ...valid, competitors: [{ ...beta, domains: ['gamma.test'] }, { name: 'Gamma', domain: 'gamma.test' }] }), /repeat competitor domains/);
  // The project's own name: empty is the brand's.
  assert.equal(projectNameInput(''), null);
  assert.equal(projectNameInput(null), null);
  assert.equal(projectNameInput(' Brand Brazil '), 'Brand Brazil');
  assert.throws(() => projectNameInput('x'), /Nome do projeto/);
});

void test('project input accepts any offered country, rejects the rest and starts the language from the country', async () => {
  const { projectInput } = await bundledModule("export {projectInput} from './lib/server/validation.ts';", {
    '@/lib/metrics': 'export const normalizeDomain = value => value.toLowerCase();',
    './http': `
      export class ApiError extends Error { constructor(status,message) { super(message); this.status=status; } }
      export const textField = (value,label,min,max) => {
        if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new ApiError(400,label);
        return value.trim();
      };
    `,
  });
  const valid = { name: 'Acme Beacon', domain: 'acme.test', competitors: [], aliases: [], additional_domains: [] };
  // The three countries offered before keep their codes; Germany, Mexico and Japan are new.
  for (const code of [2076, 2840, 2826, 2276, 2484, 2392])
    assert.equal(projectInput({ ...valid, location_code: code, language_code: 'en' }).location, code);
  // Not a country, Russia and Belarus (no longer served by DataForSEO), a region code and a fraction are refused.
  for (const code of [999, 2643, 2112, 1001773, 2076.5, 'BR'])
    assert.throws(() => projectInput({ ...valid, location_code: code }), /Mercado inválido/);
  assert.equal(projectInput({ ...valid, location_code: 2620 }).language, 'pt');
  assert.equal(projectInput({ ...valid, location_code: 2276 }).language, 'en');
  assert.equal(projectInput({ ...valid }).language, 'pt');
  assert.equal(projectInput({ ...valid, location_code: 2276, language_code: 'pt' }).language, 'pt');
  assert.throws(() => projectInput({ ...valid, location_code: 2276, language_code: 'de' }), /Idioma inválido/);
});
