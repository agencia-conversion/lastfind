import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductDetail,
  buildProducts,
  extractProducts,
  productBrand,
  productBrandSlug,
  productKey,
  productSlug,
  rawProviderResult,
  type ProductCardRow,
} from '../lib/products.ts';

// Trimmed from archived DataForSEO results of the Apple demo (ChatGPT LLM Scraper and Google AI Mode).
const chatGpt = {
  items: [
    { type: 'chat_gpt_text', markdown: 'Tablets for students' },
    {
      type: 'chat_gpt_products',
      items: [
        {
          type: 'chat_gpt_products_element',
          title: 'Lenovo IdeaPad Slim 3i 15.6 inch Laptop Inte…',
          price: 646.79,
          currency: 'USD',
          merchants: 'Walmart - LoneStar COMPUTER',
          rating: null,
          tag: 'My laptop recommendation',
          url: 'https://www.walmart.com/ip/1',
          images: ['https://i5.walmartimages.com/seo/ideapad.jpeg'],
        },
        {
          type: 'chat_gpt_products_element',
          title: 'Apple iPad Air 11-inch Tablet with M3 Chip',
          price: null,
          currency: null,
          merchants: null,
          rating: null,
          tag: null,
          url: null,
          // Only an https picture is kept: never a data: or http: one.
          images: ['data:image/png;base64,AAAA'],
        },
      ],
    },
  ],
  brand_entities: [
    {
      type: 'chat_gpt_brand_entity',
      title: 'Lenovo IdeaPad',
      category: 'product',
    },
  ],
};
const aiMode = {
  items: [
    {
      type: 'ai_overview',
      items: [
        { type: 'ai_overview_element', text: 'Kids tablets' },
        {
          type: 'ai_overview_shopping',
          items: [
            {
              type: 'ai_overview_shopping_element',
              title: 'Apple iPhone SE',
              price: {
                current: 205.56,
                currency: 'USD',
                displayed_price: '$205.56',
              },
              rating: { value: 4.6, votes_count: 12100 },
              seller: 'Walmart',
              url: 'https://www.google.com/search?ibp=oshop',
              image_url: 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:se',
            },
          ],
        },
      ],
    },
    // Google's own carousel is not part of the AI answer.
    {
      type: 'popular_products',
      items: [
        {
          type: 'popular_products_element',
          title: 'Lenovo Idea Tab',
          seller: 'Best Buy',
        },
      ],
    },
  ],
};

test('reads ChatGPT and Google cards in order, with price, store, rating and label', () => {
  const cards = extractProducts(chatGpt, 'chat_gpt');
  assert.deepEqual(
    cards.map((card) => [
      card.position,
      card.title,
      card.price,
      card.currency,
      card.store,
      card.label,
      card.image,
    ]),
    [
      [
        1,
        'Lenovo IdeaPad Slim 3i 15.6 inch Laptop Inte…',
        646.79,
        'USD',
        'Walmart',
        'My laptop recommendation',
        'https://i5.walmartimages.com/seo/ideapad.jpeg',
      ],
      [2, 'Apple iPad Air 11-inch Tablet with M3 Chip', null, null, null, null, null],
    ],
  );
  const google = extractProducts(aiMode, 'google_ai_mode');
  assert.deepEqual(
    google.map((card) => [
      card.title,
      card.price,
      card.priceText,
      card.store,
      card.rating,
      card.votes,
      card.image,
    ]),
    [['Apple iPhone SE', 205.56, '$205.56', 'Walmart', 4.6, 12100, 'https://encrypted-tbn0.gstatic.com/shopping?q=tbn:se']],
  );
  assert.equal(extractProducts(aiMode, 'google_ai_overviews').length, 1);
  // Text-only AIs and an AI's cards read as another's: nothing.
  assert.deepEqual(extractProducts(chatGpt, 'gemini'), []);
  assert.deepEqual(extractProducts(aiMode, 'chat_gpt'), []);
  assert.deepEqual(extractProducts(null, 'chat_gpt'), []);
  assert.deepEqual(
    rawProviderResult(
      JSON.stringify({ status_code: 20000, tasks: [{ result: [chatGpt] }] }),
    ),
    chatGpt,
  );
  assert.equal(rawProviderResult('not json'), null);
});

test('a product is its name without case, accents or a cut ending; its brand is the longest monitored name in it', () => {
  assert.equal(
    productKey('Apple  Watch Series 11…'),
    productKey('apple watch series 11'),
  );
  assert.equal(productKey('Café Pro...'), 'cafe pro');
  const brands = [
    { name: 'Max', aliases: [], own: false },
    { name: 'Warner', aliases: ['HBO Max'], own: false },
    { name: 'Apple', aliases: ['iPad'], own: true },
  ];
  assert.equal(productBrand('HBO Max', brands)?.name, 'Warner');
  assert.equal(productBrand('iPad Air M4', brands)?.name, 'Apple');
  assert.equal(productBrand('Samsung Galaxy Tab', brands), null);
});

test('counts each product and brand once per answer, at its first card, and the stores of every card', () => {
  const card = (
    run: string,
    position: number,
    title: string,
    extra: Partial<ProductCardRow> = {},
  ): ProductCardRow => ({
    run,
    engine: 'chat_gpt',
    promptId: `p-${run}`,
    prompt: `prompt ${run}`,
    date: '2026-10-30',
    position,
    title,
    key: productKey(title),
    price: null,
    priceText: null,
    currency: null,
    store: null,
    rating: null,
    label: null,
    image: null,
    ...extra,
  });
  const report = buildProducts(
    [
      card('a', 1, 'Apple iPad Air', {
        price: 599,
        priceText: '599',
        currency: 'USD',
        store: 'Best Buy',
        label: 'Best overall',
      }),
      card('a', 2, 'Samsung Galaxy Tab S11', {
        price: 799,
        priceText: '799',
        currency: 'USD',
        store: 'Best Buy',
      }),
      card('a', 3, 'Apple iPad Air', {
        price: 549,
        priceText: '549',
        currency: 'USD',
        store: 'Walmart',
      }),
      card('b', 2, 'Apple iPad Air…', {
        engine: 'google_ai_mode',
        price: 579,
        priceText: '$579',
        currency: 'USD',
        store: 'Target',
        rating: 4.8,
      }),
      card('b', 1, 'Lenovo Tab M11'),
    ],
    [
      { engine: 'chat_gpt', responses: 4, withProducts: 1 },
      { engine: 'google_ai_mode', responses: 2, withProducts: 1 },
    ],
    [
      { name: 'Apple', aliases: ['iPad'], own: true },
      { name: 'Samsung', own: false },
      { name: 'Google', own: false },
    ],
  );
  assert.equal(report.responses, 6);
  assert.equal(report.withProducts, 2);
  assert.equal(report.ownAnswers, 2);
  assert.equal(report.ownFirst, 1);
  const ipad = report.products[0];
  assert.deepEqual(
    [
      ipad.title,
      ipad.brand,
      ipad.own,
      ipad.answers,
      ipad.first,
      ipad.position,
      ipad.engines,
      ipad.price,
      ipad.stores,
      ipad.labels,
      ipad.rating,
    ],
    [
      'Apple iPad Air',
      'Apple',
      true,
      2,
      1,
      1.5,
      ['chat_gpt', 'google_ai_mode'],
      { min: 579, max: 599, currency: 'USD' },
      ['Best Buy', 'Target', 'Walmart'],
      ['Best overall'],
      4.8,
    ],
  );
  assert.equal(
    report.products.find((row) => row.title === 'Lenovo Tab M11')?.brand,
    null,
  );
  // Google never appears: no row, not a zero.
  assert.deepEqual(
    report.brands.map((row) => [
      row.name,
      row.answers,
      row.first,
      row.position,
      row.cards,
      row.products,
    ]),
    [
      ['Apple', 2, 1, 1.5, 3, 1],
      ['Samsung', 1, 0, 2, 1, 1],
    ],
  );
  assert.equal(report.cards, 5);
  assert.deepEqual(report.stores, [
    { name: 'Best Buy', cards: 2, products: 2 },
    { name: 'Target', cards: 1, products: 1 },
    { name: 'Walmart', cards: 1, products: 1 },
  ]);
});

test('a product page and a brand page: where it appears, once per answer at its first card, with its stores and the products beside it', () => {
  const card = (
    run: string,
    position: number,
    title: string,
    extra: Partial<ProductCardRow> = {},
  ): ProductCardRow => ({
    run,
    engine: 'chat_gpt',
    promptId: 'p1',
    prompt: 'best tablet',
    date: '2026-10-30',
    position,
    title,
    key: productKey(title),
    price: null,
    priceText: null,
    currency: null,
    store: null,
    rating: null,
    label: null,
    image: null,
    ...extra,
  });
  // Newest first, as the report reads them.
  const cards = [
    card('c', 1, 'Samsung Galaxy Tab S11', { date: '2026-10-31' }),
    card('c', 2, 'Apple iPad Air', { date: '2026-10-31', engine: 'google_ai_mode', price: 579, currency: 'USD', store: 'Target', image: 'https://img.test/new.jpg' }),
    card('b', 1, 'Apple iPad Air', { promptId: 'p2', prompt: 'ipad deals', price: 599, currency: 'USD', store: 'Best Buy' }),
    card('b', 3, 'Apple iPad Air', { promptId: 'p2', prompt: 'ipad deals', price: 549, currency: 'USD', store: 'Walmart' }),
    card('b', 2, 'Apple iPad mini', { promptId: 'p2', prompt: 'ipad deals' }),
    card('a', 1, 'Lenovo Tab M11'),
  ];
  const engines = [{ engine: 'chat_gpt' as const, responses: 3, withProducts: 3 }];
  const brands = [
    { name: 'Apple', domain: 'apple.com', own: true },
    { name: 'Samsung', own: false },
  ];
  const ipad = buildProductDetail(cards, engines, brands, productSlug(productKey('Apple iPad Air')));
  assert.equal(productSlug(productKey('Apple iPad Air')), 'apple-ipad-air');
  // Keys that differ only in punctuation never share a page; Products' own pages keep their address.
  const slugs = ['Apple iPad Air 11-inch (M3)…', 'Apple iPad Air 11 inch M3', 'Apple iPad Air 11 inch (M3)', 'Brands', 'List', 'Brands product'].map((title) => productSlug(productKey(title)));
  assert.equal(new Set(slugs).size, slugs.length);
  assert.match(slugs[0], /^apple-ipad-air-11-inch-m3-[a-z0-9]+$/);
  assert.equal(slugs[1], 'apple-ipad-air-11-inch-m3');
  assert.ok(!['brands', 'list'].includes(slugs[3]) && !['brands', 'list'].includes(slugs[4]));
  assert.equal(productSlug(productKey('Apple iPad Air 11-inch (M3)…')), slugs[0]);
  assert.equal(ipad.product?.title, 'Apple iPad Air');
  assert.equal(ipad.product?.image, 'https://img.test/new.jpg');
  assert.equal(ipad.brand, null);
  assert.equal(ipad.withProducts, 3);
  assert.deepEqual(ipad.answers.map((answer) => [answer.run, answer.position, answer.price]), [['c', 2, 579], ['b', 1, 599]]);
  assert.equal(ipad.answered, 2);
  assert.deepEqual(ipad.engines, [
    { engine: 'google_ai_mode', answers: 1, first: 0, position: 2 },
    { engine: 'chat_gpt', answers: 1, first: 1, position: 1 },
  ]);
  assert.deepEqual(ipad.days.map((day) => [day.date, day.answers, day.engines]), [
    ['2026-10-30', 1, { chat_gpt: 1 }],
    ['2026-10-31', 1, { google_ai_mode: 2 }],
  ]);
  assert.deepEqual(ipad.prompts.map((row) => [row.promptId, row.answers, row.position]), [['p2', 1, 1], ['p1', 1, 2]]);
  // One prompt answered by two AIs (a subscription each) is one row.
  const twice = buildProductDetail([card('d', 1, 'Lenovo Tab M11', { promptId: 'p1-gemini' }), card('a', 2, 'Lenovo Tab M11')], engines, brands, 'lenovo-tab-m11');
  assert.deepEqual(twice.prompts.map((row) => [row.prompt, row.answers, row.position]), [['best tablet', 2, 1.5]]);
  // Every card counts in its store, also a second one in the same answer.
  assert.deepEqual(ipad.stores.map((row) => [row.name, row.cards, row.price]), [
    ['Best Buy', 1, { min: 599, max: 599, currency: 'USD' }],
    ['Target', 1, { min: 579, max: 579, currency: 'USD' }],
    ['Walmart', 1, { min: 549, max: 549, currency: 'USD' }],
  ]);
  assert.deepEqual(ipad.beside.map((row) => [row.title, row.together]), [['Samsung Galaxy Tab S11', 1], ['Apple iPad mini', 1]]);
  // A brand's page: its products, its answers at its first card in each.
  const apple = buildProductDetail(cards, engines, brands, `brands/${productBrandSlug('Apple')}`);
  assert.equal(apple.product, null);
  assert.deepEqual([apple.brand?.name, apple.brand?.answers, apple.brand?.domain], ['Apple', 2, 'apple.com']);
  assert.deepEqual(apple.products.map((row) => row.title), ['Apple iPad Air', 'Apple iPad mini']);
  assert.deepEqual(apple.answers.map((answer) => [answer.run, answer.position, answer.title]), [['c', 2, 'Apple iPad Air'], ['b', 1, 'Apple iPad Air']]);
  assert.deepEqual(apple.beside, []);
  // Not in the period: nothing, never a zero row.
  const missing = buildProductDetail(cards, engines, brands, 'brands/google');
  assert.deepEqual([missing.brand, missing.products, missing.answers, missing.answered], [null, [], [], 0]);
});
