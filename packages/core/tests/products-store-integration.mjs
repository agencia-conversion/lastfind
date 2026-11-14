// Products in the project store: cards published with an answer, cards read from the archive for answers stored before,
// and cards removed with their answer. Private, ephemeral Miniflare namespace and bucket; no provider I/O.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { storeIdentity } from '../lib/project-store-contract.ts';

const directory = await mkdtemp(join(tmpdir(), 'lastfind-products-store-'));
const bundled = await build({
  stdin: {
    contents:
      "export { ProjectStore } from './worker/project-store.ts'; export default { fetch() { return new Response(null, {status:404}); } };",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  external: ['cloudflare:workers'],
  write: false,
});
// A restart keeps the store and the bucket on disk: the store wakes as existing stores do after a deploy.
const start = () =>
  new Miniflare(
    convertV4MiniflareOptions({
      name: 'lastfind-products-store-test',
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: '2026-05-22',
      durableObjects: {
        PROJECT_STORES: { className: 'ProjectStore', useSQLite: true },
      },
      r2Buckets: ['RAW_RESPONSES'],
      resourcePersistencePath: directory,
      unsafeDevRegistryPath: join(directory, 'registry'),
      telemetry: { enabled: false },
      logRequests: false,
    }),
  );
const scope = {
  ownerId: 'owner-p',
  projectId: 'project-p',
  generation: 'first',
};
const rpc = async (runtime, message) => {
  const namespace = await runtime.getDurableObjectNamespace('PROJECT_STORES');
  const response = await namespace
    .get(namespace.idFromName(storeIdentity(scope)))
    .fetch('https://project-store/rpc', {
      method: 'POST',
      body: JSON.stringify(message),
    });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
};
const cards = async (runtime) =>
  (
    await rpc(runtime, {
      scope,
      action: 'query',
      statements: [
        {
          sql: 'SELECT run_id,position,engine,title,title_key,price_value,currency,merchants_json,tag,image_url FROM run_products ORDER BY run_id,position',
          params: [],
        },
      ],
    })
  )[0].results;
const run = (id, engine, extra = {}) => ({
  id,
  owner_id: scope.ownerId,
  project_id: scope.projectId,
  prompt_id: 'prompt-p',
  prompt_text: 'Which tablet should I buy?',
  engine,
  status: 'complete',
  answer: 'Answer',
  targets_json: '[]',
  mentions_json: '{}',
  sources_json: '[]',
  consulted_sources_json: null,
  search_queries_json: '[]',
  response_available: 1,
  cost: 0,
  created_at: '2026-10-30T10:00:00.000Z',
  completed_at: '2026-10-30T10:01:00.000Z',
  ...extra,
});
const archived = (items) =>
  JSON.stringify({ status_code: 20000, tasks: [{ result: [{ items }] }] });

let runtime = start();
try {
  await rpc(runtime, { scope, action: 'initialize' });
  const bucket = await runtime.getR2Bucket('RAW_RESPONSES');
  await bucket.put(
    'raw/old-chatgpt.json',
    archived([
      {
        type: 'chat_gpt_products',
        items: [
          {
            type: 'chat_gpt_products_element',
            title: 'Apple iPad Air 11-inch…',
            price: 599,
            currency: 'USD',
            merchants: 'Best Buy - Marketplace',
            tag: 'Best overall',
            images: ['https://img.test/ipad-air.jpg'],
          },
          {
            type: 'chat_gpt_products_element',
            title: 'Samsung Galaxy Tab S11 &amp;amp; Pen',
            price: null,
            currency: null,
            merchants: null,
            tag: null,
          },
        ],
      },
    ]),
  );
  await bucket.put(
    'raw/old-gemini.json',
    archived([
      {
        type: 'chat_gpt_products',
        items: [
          { type: 'chat_gpt_products_element', title: 'Not a Gemini card' },
        ],
      },
    ]),
  );
  const published = [
    {
      title: 'Apple iPhone SE',
      price: 205.56,
      priceText: '$205.56',
      currency: 'USD',
      store: 'Walmart',
      rating: 4.6,
      votes: 12100,
      label: null,
      url: null,
      image: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:se',
      position: 1,
    },
  ];
  await rpc(runtime, {
    scope,
    action: 'apply',
    changes: [
      // Stored before Products: no cards with it, its response in the archive.
      {
        entity: 'runs',
        id: 'run-old',
        revision: 1,
        data: run('run-old', 'chat_gpt', {
          raw_response_key: 'raw/old-chatgpt.json',
        }),
      },
      // An AI that never shows cards is never read.
      {
        entity: 'runs',
        id: 'run-gemini',
        revision: 2,
        data: run('run-gemini', 'gemini', {
          raw_response_key: 'raw/old-gemini.json',
        }),
      },
      // Published with its cards; its archived copy is missing (an imported project), so the scan keeps what it has.
      {
        entity: 'runs',
        id: 'run-new',
        revision: 3,
        data: run('run-new', 'google_ai_mode', {
          raw_response_key: 'raw/missing.json',
          products_json: JSON.stringify(published),
        }),
      },
    ],
  });
  assert.deepEqual(
    (await cards(runtime)).map((row) => [
      row.run_id,
      row.title,
      row.price_value,
      row.merchants_json,
    ]),
    [['run-new', 'Apple iPhone SE', 205.56, '["Walmart"]']],
  );
  // A card without a title is skipped, never a reason to refuse the publication.
  await rpc(runtime, {
    scope,
    action: 'apply',
    changes: [
      {
        entity: 'runs',
        id: 'run-bad',
        revision: 4,
        data: run('run-bad', 'chat_gpt', {
          products_json: JSON.stringify([
            { title: '' },
            { title: 'Kindle &amp; Cover' },
            'x',
          ]),
        }),
      },
    ],
  });
  assert.deepEqual(
    (await cards(runtime))
      .filter((row) => row.run_id === 'run-bad')
      .map((row) => [row.position, row.title]),
    [[1, 'Kindle & Cover']],
  );

  await runtime.dispose();
  runtime = start();
  const deadline = Date.now() + 10000;
  let rows = await cards(runtime);
  while (
    !rows.some((row) => row.run_id === 'run-old') &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    rows = await cards(runtime);
  }
  assert.deepEqual(
    rows.map((row) => [
      row.run_id,
      row.position,
      row.engine,
      row.title,
      row.title_key,
      row.price_value,
      row.currency,
      row.merchants_json,
      row.tag,
      row.image_url,
    ]),
    [
      ['run-bad', 1, 'chat_gpt', 'Kindle & Cover', 'kindle & cover', null, null, '[]', null, null],
      [
        'run-new',
        1,
        'google_ai_mode',
        'Apple iPhone SE',
        'apple iphone se',
        205.56,
        'USD',
        '["Walmart"]',
        null,
        'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:se',
      ],
      [
        'run-old',
        1,
        'chat_gpt',
        'Apple iPad Air 11-inch…',
        'apple ipad air 11-inch',
        599,
        'USD',
        '["Best Buy"]',
        'Best overall',
        'https://img.test/ipad-air.jpg',
      ],
      [
        'run-old',
        2,
        'chat_gpt',
        'Samsung Galaxy Tab S11 & Pen',
        'samsung galaxy tab s11 & pen',
        null,
        null,
        '[]',
        null,
        null,
      ],
    ],
  );
  const meta = (
    await rpc(runtime, {
      scope,
      action: 'query',
      statements: [
        {
          sql: "SELECT key,value FROM store_meta WHERE key LIKE 'products_scan%'",
          params: [],
        },
      ],
    })
  )[0].results;
  assert.deepEqual(meta, [{ key: 'products_scan', value: 'v3' }]);
  // A removed answer takes its cards with it.
  await rpc(runtime, {
    scope,
    action: 'apply',
    changes: [{ entity: 'runs', id: 'run-old', revision: 5, data: null }],
  });
  assert.deepEqual(
    [...new Set((await cards(runtime)).map((row) => row.run_id))],
    ['run-bad', 'run-new'],
  );
  console.log(
    'Products store: published cards, archive scan, missing archive and removal passed.',
  );
} finally {
  await runtime.dispose();
  await rm(directory, { recursive: true, force: true });
}
