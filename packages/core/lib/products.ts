import { matchesBrand, normalizeText } from './metrics.ts';
import type { Engine } from './engines.ts';
import { decodeEntities } from './html-text.ts';
import type {
  ProductAnswer,
  ProductBrandRow,
  ProductDetailReport,
  ProductPlace,
  ProductRow,
  ProductStoreRow,
  ProductsReport,
} from './report-types.ts';

/**
 * Products (31/10): the product cards the AIs show in their answers, read from the provider's result for free. Only these
 * answers carry them; Gemini, Claude and Perplexity answer in text only.
 */
export const PRODUCT_ENGINES = [
  'chat_gpt',
  'google_ai_mode',
  'google_ai_overviews',
] as const satisfies readonly Engine[];
const CARD_TYPE: Record<string, string> = {
  chat_gpt: 'chat_gpt_products_element',
  // Inside the AI answer; Google's own "popular products" are not part of it and are another type.
  google_ai_mode: 'ai_overview_shopping_element',
  google_ai_overviews: 'ai_overview_shopping_element',
};
/** Raised when the extraction changes: every store reads its archived answers again (v2: the card's image; v3: entities decoded). */
export const PRODUCTS_SCAN = 'v3';

export type ProductCard = {
  position: number;
  title: string;
  price: number | null;
  priceText: string | null;
  currency: string | null;
  store: string | null;
  rating: number | null;
  votes: number | null;
  label: string | null;
  url: string | null;
  /** The card's picture (ChatGPT `images[0]`, Google `image_url`): an https address only, else null. */
  image: string | null;
};

/** A card's text as the reader sees it: HTML entities decoded ("Web &amp;amp; Mobile" is "Web & Mobile"), trimmed, capped. */
export const cardText = (value: unknown, max: number) => {
  const decoded = typeof value === 'string' ? decodeEntities(value).trim() : '';
  return decoded ? decoded.slice(0, max) : null;
};
const text = cardText;
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
/** An https address (an image the browser loads by itself, never a data: or http: one), or null. */
export const httpsUrl = (value: unknown) => {
  const url = text(value, 2000);
  return url && /^https:\/\/[^\s]+$/i.test(url) ? url : null;
};

/** The cards of one answer, in the order shown (`result`: the provider's task result). */
export function extractProducts(
  result: unknown,
  engine: string,
): ProductCard[] {
  const type = CARD_TYPE[engine];
  const cards: ProductCard[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!type || depth > 8 || !node || typeof node !== 'object') return;
    if (Array.isArray(node))
      return node.forEach((child) => visit(child, depth + 1));
    const o = node as Record<string, unknown>;
    if (o.type === type) {
      const title = text(o.title, 300);
      if (!title || cards.length >= 50) return;
      // ChatGPT: a number and its currency; Google: { current, currency, displayed_price }.
      const price =
        o.price && typeof o.price === 'object'
          ? (o.price as Record<string, unknown>)
          : null;
      const rating =
        o.rating && typeof o.rating === 'object'
          ? (o.rating as Record<string, unknown>)
          : null;
      const value = number(price ? price.current : o.price);
      // "Walmart - LoneStar COMPUTER": the store, then the seller in it.
      const store =
        text(o.merchants, 120) ??
        text(o.seller, 120) ??
        text(o.marketplace, 120);
      cards.push({
        position: cards.length + 1,
        title,
        price: value,
        priceText:
          text(price?.displayed_price, 60) ??
          (value === null ? null : String(value)),
        currency: text(price ? price.currency : o.currency, 8),
        store: store?.split(' - ')[0].trim() || null,
        rating: number(rating?.value),
        votes: number(rating?.votes_count),
        label: text(o.tag, 120),
        url: text(o.url, 2000),
        image: httpsUrl(Array.isArray(o.images) ? o.images[0] : o.image_url),
      });
      return;
    }
    for (const key of ['items', 'sections']) visit(o[key], depth + 1);
  };
  visit(result, 0);
  return cards;
}

/** The task result inside an archived provider response, or null. */
export function rawProviderResult(body: string): unknown {
  try {
    return (
      (JSON.parse(body) as { tasks?: { result?: unknown[] }[] }).tasks?.[0]
        ?.result?.[0] ?? null
    );
  } catch {
    return null;
  }
}

/** One product across answers and AIs: its name without case, accents, the "…" of a cut title and extra spaces. */
// ponytail: variants of one product with different titles ("Apple Watch Series 11" and "Apple Watch Series 11 GPS 42 mm") stay apart; group by Google's product id when cross-AI identity matters.
export const productKey = (title: string) =>
  normalizeText(title)
    .replace(/(…|\.\.\.)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

type Brand = {
  name: string;
  domain?: string;
  aliases?: string[];
  own: boolean;
};
/** The monitored brand named in the product's title, the longest name or alias first; null when none is. */
export function productBrand<T extends Brand>(
  title: string,
  brands: T[],
): T | null {
  let best: { brand: T; length: number } | null = null;
  for (const brand of brands)
    for (const name of [brand.name, ...(brand.aliases || [])])
      if (
        name.trim().length > (best?.length ?? 0) &&
        matchesBrand(title, { name, domain: brand.domain ?? '' })
      )
        best = { brand, length: name.trim().length };
  return best?.brand ?? null;
}

/**
 * A product's page in the app's address: its key with every run of other characters as one hyphen. A key the hyphens do
 * not spell back (punctuation: "ipad air (m3)" and "ipad air m3") gets a short hash of itself, so two products never share
 * a page; so do `brands` and `list`, Products' own pages (/shopping/brands, /shopping/list).
 */
export const productSlug = (key: string) => {
  const slug = key.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  if (slug.replace(/-/g, ' ') === key && slug !== 'brands' && slug !== 'list') return slug;
  // FNV-1a, 32 bits: deterministic in the browser and the server.
  let hash = 0x811c9dc5;
  for (const char of key) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  return `${slug || 'product'}-${hash.toString(36)}`;
};
/** A brand's page in Products (`brands/<this>`): its name as Brands addresses it (brandKey, spaces as hyphens). */
export const productBrandSlug = (name: string) =>
  normalizeText(name)
    .replace(/[^\p{L}\p{N}+&]+/gu, ' ')
    .trim()
    .replace(/ /g, '-');

/** A card as the report reads it: the answer it was in and its place there. */
export type ProductCardRow = {
  run: string;
  engine: Engine;
  promptId: string;
  prompt: string;
  date: string;
  position: number;
  title: string;
  key: string;
  price: number | null;
  priceText: string | null;
  currency: string | null;
  store: string | null;
  rating: number | null;
  label: string | null;
  image: string | null;
};

const top = (counts: Map<string, number>, limit: number) =>
  [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
const add = (counts: Map<string, number>, key: string | null) =>
  key && counts.set(key, (counts.get(key) ?? 0) + 1);
/** Lowest and highest price of these cards, in the currency most of them use; null when none shows one. */
function priceRange(cards: ProductCardRow[]) {
  const prices = cards.filter((card) => card.price !== null);
  const currency =
    top(
      prices.reduce(
        (counts, card) => (add(counts, card.currency), counts),
        new Map<string, number>(),
      ),
      1,
    )[0] ?? null;
  const values = prices
    .filter((card) => card.currency === currency)
    .map((card) => card.price!);
  return values.length && currency
    ? { min: Math.min(...values), max: Math.max(...values), currency }
    : null;
}
/** Answers, those with a first card, and the mean place of these appearances (one per answer). */
const place = (cards: ProductCardRow[]): ProductPlace => ({
  answers: cards.length,
  first: cards.filter((card) => card.position === 1).length,
  position: cards.reduce((sum, card) => sum + card.position, 0) / cards.length,
});
function groups<K>(cards: ProductCardRow[], by: (card: ProductCardRow) => K) {
  const map = new Map<K, ProductCardRow[]>();
  for (const card of cards) map.set(by(card), [...(map.get(by(card)) ?? []), card]);
  return [...map];
}

/**
 * The Products report from the period's cards (newest first) and its answers per AI: products, the brands behind them
 * and the stores the cards send buyers to. An answer counts once per product and per brand, at its first card.
 */
export function buildProducts(
  cards: ProductCardRow[],
  engines: { engine: Engine; responses: number; withProducts: number }[],
  brands: Brand[],
  truncated = false,
): ProductsReport {
  const products = new Map<
    string,
    {
      cards: ProductCardRow[];
      brand: Brand | null;
      runs: Set<string>;
      stores: Map<string, number>;
      image: string | null;
    }
  >();
  const brandRuns = new Map<string, Map<string, number>>();
  const brandCards = new Map<string, number>();
  const stores = new Map<string, { cards: number; products: Set<string> }>();
  for (const card of cards) {
    const product = products.get(card.key) ?? {
      cards: [],
      brand: productBrand(card.title, brands),
      runs: new Set<string>(),
      stores: new Map<string, number>(),
      image: null,
    };
    products.set(card.key, product);
    add(product.stores, card.store);
    // The newest picture the cards showed.
    product.image ??= card.image;
    if (product.brand) add(brandCards, product.brand.name);
    // The same product twice in one answer (two stores) is one appearance, at its first place.
    if (!product.runs.has(card.run)) {
      product.runs.add(card.run);
      product.cards.push(card);
      if (product.brand) {
        const runs =
          brandRuns.get(product.brand.name) ?? new Map<string, number>();
        brandRuns.set(product.brand.name, runs);
        runs.set(
          card.run,
          Math.min(runs.get(card.run) ?? Infinity, card.position),
        );
      }
    }
    if (card.store) {
      const store = stores.get(card.store) ?? {
        cards: 0,
        products: new Set<string>(),
      };
      stores.set(card.store, store);
      store.cards++;
      store.products.add(card.key);
    }
  }
  const productRows: ProductRow[] = [...products].map(
    ([key, { cards: seen, brand, stores: storeCounts, image }]) => {
      const labelCounts = new Map<string, number>();
      for (const card of seen) add(labelCounts, card.label);
      const ratings = seen.flatMap((card) =>
        card.rating === null ? [] : [card.rating],
      );
      return {
        key,
        title: seen[0].title,
        brand: brand?.name ?? null,
        own: !!brand?.own,
        image,
        ...place(seen),
        engines: [...new Set(seen.map((card) => card.engine))],
        price: priceRange(seen),
        stores: top(storeCounts, 5),
        labels: top(labelCounts, 3),
        rating: ratings.length
          ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
          : null,
      };
    },
  );
  productRows.sort(
    (a, b) =>
      b.answers - a.answers ||
      a.position - b.position ||
      a.title.localeCompare(b.title),
  );
  const brandRows: ProductBrandRow[] = brands.flatMap((brand) => {
    const runs = brandRuns.get(brand.name);
    if (!runs) return [];
    const places = [...runs.values()];
    return [
      {
        name: brand.name,
        own: brand.own,
        domain: brand.domain ?? '',
        answers: runs.size,
        first: places.filter((place) => place === 1).length,
        position: places.reduce((sum, place) => sum + place, 0) / places.length,
        cards: brandCards.get(brand.name) ?? 0,
        products: productRows.filter((row) => row.brand === brand.name).length,
      },
    ];
  });
  brandRows.sort((a, b) => b.answers - a.answers || a.position - b.position);
  const storeRows: ProductStoreRow[] = [...stores]
    .map(([name, store]) => ({
      name,
      cards: store.cards,
      products: store.products.size,
    }))
    .sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name));
  const own = brands.find((brand) => brand.own);
  return {
    responses: engines.reduce((sum, row) => sum + row.responses, 0),
    withProducts: engines.reduce((sum, row) => sum + row.withProducts, 0),
    cards: cards.length,
    ownAnswers: own ? (brandRuns.get(own.name)?.size ?? 0) : 0,
    ownFirst: own
      ? [...(brandRuns.get(own.name)?.values() ?? [])].filter(
          (place) => place === 1,
        ).length
      : 0,
    engines,
    brands: brandRows,
    stores: storeRows,
    products: productRows,
    truncated,
  };
}

const DETAIL_ANSWERS = 100;
/**
 * A product's page or a brand's page in Products (view=product-detail), from the same cards as the report: `target` is the
 * page's address, a product's slug or `brands/<brand slug>`. Where it appears (AIs, days, prompts, answers), the stores and
 * prices of its cards and, for a product, the products shown beside it. An answer counts once, at its first card.
 */
export function buildProductDetail(
  cards: ProductCardRow[],
  engines: { engine: Engine; responses: number; withProducts: number }[],
  brands: Brand[],
  target: string,
  truncated = false,
): ProductDetailReport {
  const report = buildProducts(cards, engines, brands, truncated);
  const brandPage = target.startsWith('brands/') ? target.slice(7) : null;
  const brand =
    brandPage === null
      ? null
      : (report.brands.find((row) => productBrandSlug(row.name) === brandPage) ??
        null);
  const products =
    brandPage === null
      ? report.products.filter((row) => productSlug(row.key) === target)
      : brand
        ? report.products.filter((row) => row.brand === brand.name)
        : [];
  const keys = new Set(products.map((row) => row.key));
  const mine = cards.filter((card) => keys.has(card.key));
  const firsts = new Map<string, ProductCardRow>();
  for (const card of mine) {
    const seen = firsts.get(card.run);
    if (!seen || card.position < seen.position) firsts.set(card.run, card);
  }
  // Newest first, as the cards are.
  const answers = [...firsts.values()];
  // The other products of those answers, by the answers they share.
  const beside = new Map<string, Set<string>>();
  if (brandPage === null)
    for (const card of cards)
      if (firsts.has(card.run) && !keys.has(card.key))
        beside.set(card.key, (beside.get(card.key) ?? new Set()).add(card.run));
  const rows = new Map(report.products.map((row) => [row.key, row]));
  const answer = (card: ProductCardRow): ProductAnswer => ({
    run: card.run,
    engine: card.engine,
    prompt: card.prompt,
    date: card.date,
    position: card.position,
    price: card.price,
    currency: card.currency,
    store: card.store,
    label: card.label,
    title: card.title,
  });
  return {
    withProducts: report.withProducts,
    cards: report.cards,
    product: brandPage === null ? (products[0] ?? null) : null,
    brand,
    products: brandPage === null ? [] : products,
    engines: groups(answers, (card) => card.engine).map(([engine, rows]) => ({
      engine,
      ...place(rows),
    })),
    days: groups(answers, (card) => card.date)
      .map(([date, rows]) => ({
        date,
        ...place(rows),
        engines: Object.fromEntries(
          groups(rows, (card) => card.engine).map(([engine, cards]) => [
            engine,
            place(cards).position,
          ]),
        ),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    // By the prompt's text: its AIs answer it under one subscription each.
    prompts: groups(answers, (card) => card.prompt)
      .map(([prompt, rows]) => ({
        promptId: rows[0].promptId,
        prompt,
        engines: [...new Set(rows.map((card) => card.engine))],
        ...place(rows),
      }))
      .sort((a, b) => b.answers - a.answers || a.position - b.position),
    stores: groups(
      mine.filter((card) => card.store),
      (card) => card.store!,
    )
      .map(([name, rows]) => ({
        name,
        cards: rows.length,
        products: new Set(rows.map((card) => card.key)).size,
        price: priceRange(rows),
      }))
      .sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name)),
    beside: [...beside]
      .map(([key, runs]) => ({ ...rows.get(key)!, together: runs.size }))
      .sort((a, b) => b.together - a.together || b.answers - a.answers || a.position - b.position)
      .slice(0, 5),
    answers: answers.slice(0, DETAIL_ANSWERS).map(answer),
    answered: answers.length,
    truncated,
  };
}
