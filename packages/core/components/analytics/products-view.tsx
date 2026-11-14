'use client';

import { useState } from 'react';
import { ENGINE_LABELS } from '@/lib/engines';
import { formatNumber, formatPercent, numberLocale } from '@/lib/number-format';
import { PRODUCT_ENGINES, productBrandSlug, productSlug } from '@/lib/products';
import type { ProductBrandRow, ProductRow, ProductsReport } from '@/lib/report-types';
import {
  CompactEngineIcons,
  EngineIcon,
} from '@/components/lastfind/identity-icons';
import {
  MetricCard,
  MetricGrid,
  MetricGridSkeleton,
} from '@/components/lastfind/presentation/metric-card';
import {
  DataTable,
  DataTableScreen,
  DataTableToolbar,
  type DataColumn,
} from '@/components/lastfind/presentation/data-table';
import { Hint } from '@/components/ui/tooltip';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { BrandName, EmptyState, ProductThumb, SearchField, useCopy, useSortedPage } from './shared';
import { ViewAllAction, type Linker } from './drill-link';

type Translate = (en: string, pt: string) => string;

/** The sortable columns of the products table: the whole list is ordered before a page is cut (useSortedPage). */
export const SORT_VALUES: Record<
  string,
  (row: ProductRow) => string | number | null | undefined
> = {
  product: (row) => row.title,
  answers: (row) => row.answers,
  position: (row) => row.position,
  first: (row) => row.first,
  price: (row) => row.price?.min,
};

/** A price in its currency; a code Intl does not know shows as the number and the code the card gave. */
export function formatMoney(locale: string, value: number, currency: string) {
  try {
    return new Intl.NumberFormat(numberLocale(locale), {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    return `${formatNumber(locale, value, 2)} ${currency}`;
  }
}
/** The lowest and highest price shown ("—" when no card showed one). */
export function formatPriceRange(locale: string, price: ProductRow['price']) {
  if (!price) return '—';
  const min = formatMoney(locale, price.min, price.currency);
  return price.min === price.max ? min : `${min} – ${formatMoney(locale, price.max, price.currency)}`;
}
/** Where a product's or a brand's page is (app-routes.ts: /shopping/<slug>, /shopping/brands/<slug>). */
/**
 * A part of a whole as a percentage: whole numbers, one decimal under 1% and "<0.1%" below that, so a share that is not zero
 * never reads as 0% (2 of 2,204 answers is 0.1%, not 0%). — without a whole.
 */
export function sharePercent(locale: string, part: number, whole: number) {
  if (!whole) return '—';
  const value = (part / whole) * 100;
  if (part > 0 && value < 0.05) return `<${formatPercent(locale, 0.1, 1)}`;
  return formatPercent(locale, value, part > 0 && value < 1 ? 1 : 0);
}
/**
 * How many stores the cards named, under a count of products. A card often names none (ChatGPT's cards for a service that
 * sells itself), so no store is said as such, never as "in 0 stores".
 */
export function storesLine(locale: string, t: Translate, stores: number) {
  const count = formatNumber(locale, stores);
  if (!stores) return t('No card named a store', 'Nenhum cartão citou loja');
  return stores === 1 ? t('In 1 store', 'Em 1 loja') : t(`In ${count} stores`, `Em ${count} lojas`);
}
export const productPage = (key: string) => ({ productDetail: productSlug(key) });
export const productBrandPage = (name: string) => ({ productDetail: `brands/${productBrandSlug(name)}` });

/**
 * The columns of a table of products (Products, a brand's page): its picture, name, brand and the AI's label, the AIs,
 * answers, place, first card, price and stores. `share` is the base of the answers' share (answers with cards).
 */
export function productColumns(locale: string, t: Translate, share: number): DataColumn<ProductRow>[] {
  const number = (value: number, digits = 0) => formatNumber(locale, value, digits);
  return [
    {
      key: 'product',
      sortValue: SORT_VALUES.product,
      header: t('Product', 'Produto'),
      mobile: 'title',
      width: '28rem',
      shrinkTo: '12rem',
      // One line (shell.md section 8): the brand and the AI's own label are in the balloon.
      hint: (row) => [row.title, row.brand ?? t('Brand not monitored', 'Marca não monitorada'), row.labels[0]].filter(Boolean).join('\n'),
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <ProductThumb src={row.image} />
          <span className="min-w-0 truncate">{row.title}</span>
          {row.own && <TagBadge className="shrink-0" tone="primary">{t('Your brand', 'Sua marca')}</TagBadge>}
        </span>
      ),
    },
    {
      key: 'ais',
      header: t('AIs', 'IAs'),
      label: t('AIs', 'IAs'),
      cell: (row) => <CompactEngineIcons engines={row.engines} />,
    },
    {
      key: 'answers',
      sortValue: SORT_VALUES.answers,
      // The same measure as a brand's Visibility on Products > Brands: over the answers with cards, never over every answer.
      header: t('Visibility', 'Visibilidade'),
      label: t('Visibility', 'Visibilidade'),
      info: t(
        `Answers with product cards that include it, over the ${number(share)} answers with cards (not over every answer), with their count.`,
        `Respostas com cartões de produto que o incluem, sobre as ${number(share)} respostas com cartões (não sobre todas as respostas), com a contagem.`,
      ),
      align: 'end',
      cell: (row) => `${sharePercent(locale, row.answers, share)} (${number(row.answers)})`,
    },
    {
      key: 'position',
      sortValue: SORT_VALUES.position,
      header: t('Position', 'Posição'),
      label: t('Position', 'Posição'),
      info: t(
        'Its mean place among the cards of an answer; 1 is the first card.',
        'O lugar médio entre os cartões de uma resposta; 1 é o primeiro cartão.',
      ),
      align: 'end',
      cell: (row) => number(row.position, 1),
    },
    {
      key: 'first',
      sortValue: SORT_VALUES.first,
      header: t('First card', '1º cartão'),
      label: t('First card', '1º cartão'),
      info: t('Answers where it was the first card.', 'Respostas em que ele foi o primeiro cartão.'),
      align: 'end',
      cell: (row) => number(row.first),
    },
    {
      key: 'price',
      sortValue: SORT_VALUES.price,
      header: t('Price shown', 'Preço mostrado'),
      label: t('Price shown', 'Preço mostrado'),
      info: t(
        'Lowest and highest price on its cards. — when no card showed a price.',
        'Menor e maior preço nos seus cartões. — quando nenhum cartão mostrou preço.',
      ),
      align: 'end',
      cell: (row) => formatPriceRange(locale, row.price),
    },
    {
      key: 'stores',
      header: t('Stores', 'Lojas'),
      label: t('Stores', 'Lojas'),
      info: t(
        'Where its cards send buyers, the most frequent first. — when no card named a store.',
        'Para onde os cartões levam o comprador, a mais frequente primeiro. — quando nenhum cartão citou loja.',
      ),
      maxWidth: '16rem',
      hint: (row) => row.stores.join(', ') || undefined,
      cell: (row) => (row.stores.length ? row.stores.slice(0, 2).join(', ') : '—'),
    },
  ];
}

/**
 * Products' three pages, sub-items of Products in the sidebar: the address after /shopping (`productDetail`) is
 * none for the overview, `brands` or `list` for the tables, and anything else is a product's or a brand's page, which
 * belongs to the table it opens from.
 */
export type ProductsSection = 'overview' | 'brands' | 'products';
export const PRODUCT_SECTIONS: Record<ProductsSection, { page: string | null; label: [string, string] }> = {
  overview: { page: null, label: ['Overview', 'Visão geral'] },
  brands: { page: 'brands', label: ['Brands', 'Marcas'] },
  products: { page: 'list', label: ['Products', 'Produtos'] },
};
export const productSection = (detail: string | null): ProductsSection =>
  !detail ? 'overview' : detail === 'brands' || detail.startsWith('brands/') ? 'brands' : 'products';
/** A product's or a brand's page, not one of the three pages. */
export const isProductDetail = (detail: string | null): detail is string => !!detail && !Object.values(PRODUCT_SECTIONS).some((section) => section.page === detail);

/**
 * Products (31/10): the product cards ChatGPT and Google's AI answers show, read from the collected answers at no cost.
 * One report, three pages (`view`): the overview (the share of answers with cards, your brand in them, the top products and
 * the stores), the brands in the cards and the products, each row opening its own page (product-page.tsx).
 */
export function ProductsView({
  view,
  report,
  loading,
  failed,
  onRetry,
  locale,
  t,
  link,
}: {
  view: ProductsSection;
  report: ProductsReport | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  locale: string;
  t: Translate;
  link: Linker;
}) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const rows = (report?.products ?? []).filter(
    (row) =>
      !needle ||
      [row.title, row.brand ?? '', ...row.stores].some((text) =>
        text.toLowerCase().includes(needle),
      ),
  );
  const page = useSortedPage(
    rows,
    SORT_VALUES,
    needle,
    25,
    t,
    t('Products', 'Produtos'),
  );
  const [brandSearch, setBrandSearch] = useState('');
  const number = (value: number, digits = 0) =>
    formatNumber(locale, value, digits);
  const percent = (part: number, whole: number) => sharePercent(locale, part, whole);
  const engineNames = new Intl.ListFormat(numberLocale(locale), {
    type: 'conjunction',
  }).format(PRODUCT_ENGINES.map((engine) => ENGINE_LABELS[engine]));
  if (failed)
    return (
      <EmptyState
        tone="error"
        title={t('The report did not load.', 'O relatório não carregou.')}
        onRetry={onRetry}
      />
    );
  if (loading || !report) return <ProductsSkeleton view={view} />;
  if (!report.responses)
    return (
      <EmptyState
        title={t(
          'No answers from AIs that show products',
          'Nenhuma resposta das IAs que mostram produtos',
        )}
        description={t(
          `Product cards come from these AIs: ${engineNames}. There are no answers from them in this period and filter.`,
          `Os cartões de produto vêm destas IAs: ${engineNames}. Não há respostas delas neste período e filtro.`,
        )}
      />
    );
  if (!report.withProducts)
    return (
      <EmptyState
        // Each page names what it lists, so the three still read as three pages with nothing to show.
        title={
          view === 'brands'
            ? t('No brand in product cards in this period', 'Nenhuma marca em cartões de produto neste período')
            : view === 'products'
              ? t('No product in this period', 'Nenhum produto neste período')
              : t('No product cards in this period', 'Nenhum cartão de produto neste período')
        }
        description={t(
          `${number(report.responses)} answers from ${engineNames} were read and none showed product cards. The AIs show them for questions about what to buy; for services and B2B they are rare.`,
          `${number(report.responses)} respostas de ${engineNames} foram lidas e nenhuma mostrou cartões de produto. As IAs os mostram em perguntas sobre o que comprar; para serviços e B2B eles são raros.`,
        )}
      />
    );
  const truncated = report.truncated && (
    <Note status>
      {t(
        'Large period: limited to the newest 5,000 cards.',
        'Período grande: limitado aos 5.000 cartões mais recentes.',
      )}
    </Note>
  );
  const columns = productColumns(locale, t, report.withProducts);
  if (view === 'overview') {
    const own = report.brands.find((row) => row.own);
    return (
      <>
        <MetricGrid columns={4} mobilePairs label={t('Product metrics', 'Métricas de produtos')}>
          <MetricCard
            label={t('Answers with products', 'Respostas com produtos')}
            definition={t(
              `Answers from ${engineNames} that show at least one product card. Only these AIs show product cards, so the base is their ${number(report.responses)} answers, not every answer of the period: the other AIs answer in text only. Per AI below: the share of that AI's answers with cards.`,
              `Respostas de ${engineNames} que mostram ao menos um cartão de produto. Só essas IAs mostram cartões de produto, então a base são as ${number(report.responses)} respostas delas, não todas as respostas do período: as outras IAs respondem só em texto. Por IA abaixo: a parcela das respostas daquela IA com cartões.`,
            )}
            value={percent(report.withProducts, report.responses)}
            description={t(
              `${number(report.withProducts)} of ${number(report.responses)} answers from the AIs that show products`,
              `${number(report.withProducts)} de ${number(report.responses)} respostas das IAs que mostram produtos`,
            )}
            rows={report.engines.map((row) => {
              // An AI whose answers showed no card has nothing to measure here: a dash with the reason, never 0%.
              const none = t(
                `None of the ${number(row.responses)} answers from ${ENGINE_LABELS[row.engine]} in this period showed product cards.`,
                `Nenhuma das ${number(row.responses)} respostas de ${ENGINE_LABELS[row.engine]} neste período mostrou cartões de produto.`,
              );
              return {
                key: row.engine,
                icon: <EngineIcon engine={row.engine} size={14} />,
                label: ENGINE_LABELS[row.engine],
                value: row.withProducts ? percent(row.withProducts, row.responses) : (
                  <Hint text={none}>
                    <button type="button" aria-label={`${ENGINE_LABELS[row.engine]}: ${none}`}>—</button>
                  </Hint>
                ),
              };
            })}
          />
          <MetricCard
            label={t('Your brand in the cards', 'Sua marca nos cartões')}
            definition={t(
              'Answers with product cards that include a product of your brand.',
              'Respostas com cartões de produto que incluem um produto da sua marca.',
            )}
            value={percent(report.ownAnswers, report.withProducts)}
            // Whether the brand opens the cards, said only when it does (never "first card in 0").
            description={t(
              `${number(report.ownAnswers)} of ${number(report.withProducts)} answers with cards${report.ownFirst ? `; the first card in ${number(report.ownFirst)} ${report.ownFirst === 1 ? 'answer' : 'answers'}` : ''}`,
              `${number(report.ownAnswers)} de ${number(report.withProducts)} respostas com cartões${report.ownFirst ? `; o primeiro cartão em ${number(report.ownFirst)} ${report.ownFirst === 1 ? 'resposta' : 'respostas'}` : ''}`,
            )}
          />
          <MetricCard
            label={t('Your position', 'Sua posição')}
            definition={t(
              'Mean place of your brand’s first card in the answers that show it; 1 is the first card. — when no card shows your brand.',
              'Lugar médio do primeiro cartão da sua marca nas respostas que a mostram; 1 é o primeiro cartão. — quando nenhum cartão mostra sua marca.',
            )}
            value={own ? number(own.position, 1) : '—'}
            description={own ? t(`Share of cards ${percent(own.cards, report.cards)}`, `Fatia dos cartões ${percent(own.cards, report.cards)}`) : t('No card shows your brand', 'Nenhum cartão mostra sua marca')}
          />
          <MetricCard
            label={t('Products', 'Produtos')}
            definition={t(
              'Distinct products in the cards, by name.',
              'Produtos distintos nos cartões, pelo nome.',
            )}
            value={number(report.products.length)}
            description={storesLine(locale, t, report.stores.length)}
          />
        </MetricGrid>
        {truncated}
        <div className="overview-grid">
          <SectionCard
            title={t('Top products', 'Principais produtos')}
            info={t(
              `The products in the most answers with cards. Visibility: the share of the ${number(report.withProducts)} answers with product cards that show it (not of every answer). Each opens its page.`,
              `Os produtos em mais respostas com cartões. Visibilidade: a parcela das ${number(report.withProducts)} respostas com cartões de produto que o mostram (não de todas as respostas). Cada um abre a sua página.`,
            )}
            action={<ViewAllAction link={link} to={{ productDetail: PRODUCT_SECTIONS.products.page }}>{t('View all', 'Ver todos')}</ViewAllAction>}
          >
            <DataTable
              singleLine
              minWidth={0}
              compact
              rows={report.products.slice(0, 5)}
              rowKey={(row) => row.key}
              rowLink={(row) => link(productPage(row.key))}
              // In a half-width card (a fixed layout, minWidth 0) the product name takes what the figure leaves and truncates.
              columns={[{ ...columns[0], width: undefined, shrinkTo: undefined }, { ...columns[2], width: '8rem' }].map((column) => ({ ...column, sortValue: undefined }))}
            />
          </SectionCard>
          <SectionCard
            title={t('Stores', 'Lojas')}
            info={t(
              'Where the product cards send buyers: cards and distinct products per store. Cards without a store (common on ChatGPT) are not counted here.',
              'Para onde os cartões de produto levam o comprador: cartões e produtos distintos por loja. Cartões sem loja (comuns no ChatGPT) não entram aqui.',
            )}
          >
            {report.stores.length ? (
              <DataTable
                singleLine
                minWidth={0}
                compact
                rows={report.stores.slice(0, 5)}
                rowKey={(row) => row.name}
                columns={[
                  {
                    key: 'store',
                    header: t('Store', 'Loja'),
                    mobile: 'title',
                    cell: (row) => row.name,
                  },
                  {
                    key: 'cards',
                    header: t('Cards', 'Cartões'),
                    label: t('Cards', 'Cartões'),
                    align: 'end',
                    cell: (row) => number(row.cards),
                  },
                  {
                    key: 'products',
                    header: t('Products', 'Produtos'),
                    label: t('Products', 'Produtos'),
                    align: 'end',
                    cell: (row) => number(row.products),
                  },
                ]}
              />
            ) : (
              <EmptyState frame="bare" title={t('No card in this period names a store.', 'Nenhum cartão deste período cita uma loja.')} />
            )}
          </SectionCard>
        </div>
      </>
    );
  }
  if (view === 'brands') {
    const brandNeedle = brandSearch.trim().toLowerCase();
    const brands = report.brands.filter((row) => !brandNeedle || [row.name, row.domain].some((text) => text.toLowerCase().includes(brandNeedle)));
    const brandColumns: DataColumn<ProductBrandRow>[] = [
      {
        key: 'brand',
        sortValue: (row) => row.name,
        header: t('Brand', 'Marca'),
        mobile: 'title',
        width: '28rem',
        shrinkTo: '12rem',
        cell: (row) => (
          <span className="flex min-w-0 items-center gap-2">
            <BrandName name={row.name} domain={row.domain} own={row.own} />
            {row.own && <TagBadge className="shrink-0" tone="primary">{t('Your brand', 'Sua marca')}</TagBadge>}
          </span>
        ),
      },
      {
        key: 'visibility',
        sortValue: (row) => row.answers,
        header: t('Visibility', 'Visibilidade'),
        label: t('Visibility', 'Visibilidade'),
        info: t(
          'Answers with product cards that include one of its products, over all answers with cards.',
          'Respostas com cartões de produto que incluem um produto dela, sobre todas as respostas com cartões.',
        ),
        align: 'end',
        cell: (row) => `${percent(row.answers, report.withProducts)} (${number(row.answers)})`,
      },
      {
        key: 'share',
        sortValue: (row) => row.cards,
        header: t('Share of cards', 'Fatia dos cartões'),
        label: t('Share of cards', 'Fatia dos cartões'),
        info: t(
          'Its cards over every product card read, of any brand, monitored or not.',
          'Os cartões dela sobre todos os cartões de produto lidos, de qualquer marca, monitorada ou não.',
        ),
        align: 'end',
        cell: (row) => percent(row.cards, report.cards),
      },
      {
        key: 'position',
        sortValue: (row) => row.position,
        header: t('Position', 'Posição'),
        label: t('Position', 'Posição'),
        info: t(
          'Mean place of its first card in each answer; 1 is the first card.',
          'Lugar médio do primeiro cartão dela em cada resposta; 1 é o primeiro cartão.',
        ),
        align: 'end',
        cell: (row) => number(row.position, 1),
      },
      {
        key: 'first',
        sortValue: (row) => row.first,
        header: t('First card', '1º cartão'),
        label: t('First card', '1º cartão'),
        info: t('Answers where one of its products was the first card.', 'Respostas em que um produto dela foi o primeiro cartão.'),
        align: 'end',
        cell: (row) => number(row.first),
      },
      {
        key: 'products',
        sortValue: (row) => row.products,
        header: t('Products', 'Produtos'),
        label: t('Products', 'Produtos'),
        info: t('Its distinct products in the cards, by name.', 'Os produtos distintos dela nos cartões, pelo nome.'),
        align: 'end',
        cell: (row) => number(row.products),
      },
    ];
    return (
      <DataTableScreen cards={truncated || undefined}>
        <DataTableToolbar label={t('Brand filters', 'Filtros de marcas')}>
          <SearchField value={brandSearch} onChange={setBrandSearch} placeholder={t('Search brands', 'Buscar marcas')} />
        </DataTableToolbar>
        {!report.brands.length ? (
          <EmptyState
            frame="bare"
            title={t('No brand in the cards', 'Nenhuma marca nos cartões')}
            description={t(
              'No card names your brand or a competitor you monitor. Brands you monitor appear here when a product card names them.',
              'Nenhum cartão cita sua marca ou um concorrente que você monitora. As marcas monitoradas aparecem aqui quando um cartão de produto as cita.',
            )}
          />
        ) : brands.length ? (
          <DataTable
            compact
            fill
            singleLine
            ariaLabel={t('Brands', 'Marcas')}
            rows={brands}
            rowKey={(row) => row.name}
            rowLink={(row) => link(productBrandPage(row.name))}
            columns={brandColumns}
          />
        ) : (
          <EmptyState frame="bare" title={t('No brand matches this search.', 'Nenhuma marca corresponde a esta busca.')} />
        )}
      </DataTableScreen>
    );
  }
  return (
    <DataTableScreen cards={truncated || undefined}>
      <DataTableToolbar label={t('Product filters', 'Filtros de produtos')}>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t(
            'Search products, brands or stores',
            'Buscar produtos, marcas ou lojas',
          )}
        />
      </DataTableToolbar>
      {rows.length ? (
        <>
          <DataTable
            fill
            singleLine
            ariaLabel={t('Products', 'Produtos')}
            rows={page.rows}
            sort={page.sort}
            onSortChange={page.onSortChange}
            rowKey={(row) => row.key}
            rowLink={(row) => link(productPage(row.key))}
            columns={columns}
          />
          {page.controls}
        </>
      ) : (
        <EmptyState
          frame="bare"
          title={t(
            'No product matches this search.',
            'Nenhum produto corresponde a esta busca.',
          )}
        />
      )}
    </DataTableScreen>
  );
}

/**
 * Products while the report loads (shell.md section 9): each page in its own frame, the overview's cards and two tables, or the
 * list's toolbar and table with its own columns, in their loading state.
 */
export function ProductsSkeleton({ view = 'overview' }: { view?: ProductsSection }) {
  const l = useCopy();
  const label = l('Loading products…', 'Carregando produtos…');
  const head = (key: string, en: string, pt: string, align?: 'end') => ({ key, header: l(en, pt), align, cell: () => null });
  if (view !== 'overview') {
    const columns = view === 'brands'
      ? [head('brand', 'Brand', 'Marca'), head('visibility', 'Visibility', 'Visibilidade', 'end'), head('share', 'Share of cards', 'Fatia dos cartões', 'end'), head('position', 'Position', 'Posição', 'end'), head('first', 'First card', '1º cartão', 'end'), head('products', 'Products', 'Produtos', 'end')]
      : [head('product', 'Product', 'Produto'), head('ais', 'AIs', 'IAs'), head('answers', 'Visibility', 'Visibilidade', 'end'), head('position', 'Position', 'Posição', 'end'), head('first', 'First card', '1º cartão', 'end'), head('price', 'Price shown', 'Preço mostrado', 'end'), head('stores', 'Stores', 'Lojas')];
    return (
      <DataTableScreen>
        <DataTableToolbar label={label}>
          <SearchField value="" onChange={() => {}} placeholder={view === 'brands' ? l('Search brands', 'Buscar marcas') : l('Search products, brands or stores', 'Buscar produtos, marcas ou lojas')} />
        </DataTableToolbar>
        <DataTable fill singleLine compact={view === 'brands'} loading ariaLabel={label} rows={[]} rowKey={String} columns={columns} />
      </DataTableScreen>
    );
  }
  return (
    <div aria-busy="true" aria-label={label} data-screen-skeleton="">
      <MetricGridSkeleton count={4} label={label} description />
      <div className="overview-grid">
        <SectionCard title={l('Top products', 'Principais produtos')}>
          <DataTable singleLine minWidth={0} compact loading={5} rows={[]} rowKey={String} columns={[head('product', 'Product', 'Produto'), head('answers', 'Visibility', 'Visibilidade', 'end')]} />
        </SectionCard>
        <SectionCard title={l('Stores', 'Lojas')}>
          <DataTable singleLine minWidth={0} compact loading={5} rows={[]} rowKey={String} columns={[head('store', 'Store', 'Loja'), head('cards', 'Cards', 'Cartões', 'end'), head('products', 'Products', 'Produtos', 'end')]} />
        </SectionCard>
      </div>
    </div>
  );
}
