'use client';
import { useEffect } from 'react';
import type { requestJson } from '@/lib/client';
import { useReport } from '@/hooks/use-report';
import { brandKey } from '@/lib/brand-decisions';
import { ENGINE_LABELS } from '@/lib/engines';
import { formatNumber } from '@/lib/number-format';
import { PRODUCT_ENGINES } from '@/lib/products';
import type { ProductAnswer, ProductDetailReport, ProductRow } from '@/lib/report-types';
import { CompactEngineIcons, EngineIcon } from '@/components/lastfind/identity-icons';
import { DataTable, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { PageHeading } from '@/components/lastfind/presentation/page-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { TrendCard } from '@/components/lastfind/presentation/trend-chart';
import { DrillLink, ViewAllAction, type Linker } from './drill-link';
import { PRODUCT_SECTIONS, SORT_VALUES, formatMoney, formatPriceRange, productBrandPage, productColumns, productPage, sharePercent, storesLine } from './products-view';
import { EmptyState, ProductThumb, SiteFavicon, useCopy, useSortedPage } from './shared';

type Translate = (en: string, pt: string) => string;

/** A product's or a brand's page in Products while it loads: the same heading, cards, chart and tables in their loading state. */
export function ProductPageSkeleton() {
  const l = useCopy();
  const label = l('Loading the page…', 'Carregando a página…');
  return (
    <div className="st-entity" aria-busy="true" aria-label={label} data-screen-skeleton="">
      <PageHeading title={<Skeleton inline className="h-lh w-56 max-w-full align-top" />} description={<Skeleton inline className="h-lh w-40 max-w-full align-top" />} />
      <MetricGridSkeleton count={4} label={label} description />
      <TrendCard loading title={l('Position per day', 'Posição por dia')} data={[]} series={[]} scale={{ domain: [1, 2], ticks: [1, 2] }} locale="en" formatValue={String} formatTick={String} />
      <div className="overview-grid">
        <SectionCard title={l('Prompts', 'Prompts')} loading />
        <SectionCard title={l('Stores', 'Lojas')} loading />
      </div>
      <SectionCard title={l('Answers', 'Respostas')} loading lines={5} />
    </div>
  );
}

/**
 * A product's page or a brand's page in Products (`/shopping/<slug>`, `/shopping/brands/<slug>`), in the mould of the brand
 * page: under the header's period and filters, where it appears (AIs, place per day, prompts, every answer with a link to
 * it in Responses), the stores and prices of its cards and, for a product, the products shown beside it.
 */
export function ProductPage({
  target,
  api,
  filters,
  request,
  refresh,
  locale,
  t,
  link,
  promptUnit,
  onTitle,
}: {
  /** The page's address after /shopping: a product's slug or `brands/<brand slug>`. */
  target: string;
  api: string;
  /** The header's period and filters (the list's report query). */
  filters: URLSearchParams;
  request?: typeof requestJson;
  refresh: number | string;
  locale: string;
  t: Translate;
  link: Linker;
  /** The prompt an answer's subscription belongs to (its page). */
  promptUnit: (promptId: string) => string;
  onTitle: (title: string | null) => void;
}) {
  const query = new URLSearchParams(filters);
  query.set('view', 'product-detail');
  query.set('key', target);
  const { data, loading, error } = useReport<ProductDetailReport>(`${api}/reports?${query}`, refresh, request);
  const brandPage = target.startsWith('brands/');
  const title = (brandPage ? data?.brand?.name : data?.product?.title) ?? null;
  useEffect(() => onTitle(title), [title, onTitle]);
  const page = useSortedPage(data?.answers ?? [], {}, target, 10, t, t('Answers', 'Respostas'));
  const products = useSortedPage(data?.products ?? [], SORT_VALUES, target, 10, t, t('Products', 'Produtos'));
  const number = (value: number, digits = 0) => formatNumber(locale, value, digits);
  const percent = (part: number, whole: number) => sharePercent(locale, part, whole);
  if (error)
    return <EmptyState tone="error" title={t('This page did not load.', 'Esta página não carregou.')} description={t('Reload the page to try again.', 'Recarregue a página para tentar de novo.')} />;
  if (loading || !data) return <ProductPageSkeleton />;
  const row = brandPage ? data.brand : data.product;
  if (!row)
    return (
      <div className="st-entity">
        <EmptyState
          title={brandPage ? t('No card shows this brand in this period.', 'Nenhum cartão mostra esta marca neste período.') : t('This product is not in the cards of this period.', 'Este produto não está nos cartões deste período.')}
          description={t('Choose a longer period or other AIs in the header, or go back to Products.', 'Escolha um período maior ou outras IAs no cabeçalho, ou volte para Produtos.')}
          action={<DrillLink link={link} to={{ productDetail: PRODUCT_SECTIONS[brandPage ? 'brands' : 'products'].page }}>{t('Back to Products', 'Voltar para Produtos')}</DrillLink>}
        />
      </div>
    );
  const product = data.product;
  const brand = data.brand;
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const series = PRODUCT_ENGINES.filter((engine) => data.days.some((day) => day.engines[engine] != null)).map((engine, index) => ({
    id: engine,
    key: engine,
    name: ENGINE_LABELS[engine],
    color: `var(--chart-${PRODUCT_ENGINES.indexOf(engine) + 1})`,
    primary: index === 0,
  }));
  const trend = data.days.map((day) => ({ date: day.date, ...day.engines }));
  const ceiling = Math.ceil(Math.max(1, ...data.days.flatMap((day) => Object.values(day.engines) as number[])));
  const answerColumns: DataColumn<ProductAnswer>[] = [
    {
      key: 'prompt',
      header: t('Prompt', 'Prompt'),
      mobile: 'title',
      width: '28rem',
      shrinkTo: '12rem',
      // One line: on a brand's page, the product shown is in the balloon.
      hint: (answer) => [answer.prompt, brandPage ? answer.title : ''].filter(Boolean).join('\n'),
      cell: (answer) => answer.prompt || t('Prompt', 'Prompt'),
    },
    { key: 'ai', header: t('AI', 'IA'), label: t('AI', 'IA'), cell: (answer) => <CompactEngineIcons engines={[answer.engine]} /> },
    { key: 'date', header: t('Date', 'Data'), label: t('Date', 'Data'), cell: (answer) => date.format(new Date(`${answer.date}T00:00:00Z`)) },
    { key: 'position', header: t('Position', 'Posição'), label: t('Position', 'Posição'), align: 'end', cell: (answer) => number(answer.position) },
    {
      key: 'price',
      header: t('Price', 'Preço'),
      label: t('Price', 'Preço'),
      align: 'end',
      cell: (answer) => (answer.price === null ? '—' : answer.currency ? formatMoney(locale, answer.price, answer.currency) : number(answer.price, 2)),
    },
    { key: 'store', header: t('Store', 'Loja'), label: t('Store', 'Loja'), cell: (answer) => answer.store ?? '—' },
    { key: 'label', header: t('AI label', 'Selo da IA'), label: t('AI label', 'Selo da IA'), maxWidth: '14rem', hint: (answer) => answer.label ?? undefined, cell: (answer) => answer.label ?? '—' },
  ];
  return (
    <div className="st-entity">
      <PageHeading
        title={
          <span className="inline-flex min-w-0 max-w-full items-center gap-2">
            {product ? <ProductThumb src={product.image} alt={product.title} /> : <SiteFavicon domain={brand!.domain} name={brand!.name} />}
            <span className="truncate">{product?.title ?? brand!.name}</span>
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {product ? (
              product.brand ? (
                <DrillLink link={link} to={productBrandPage(product.brand)}>{product.brand}</DrillLink>
              ) : (
                <span>{t('Brand not monitored', 'Marca não monitorada')}</span>
              )
            ) : (
              <span>{brand!.domain}</span>
            )}
            {(product ? product.own : brand!.own) && <TagBadge tone="primary">{t('Your brand', 'Sua marca')}</TagBadge>}
            {product?.labels.map((label) => <TagBadge key={label} tone="neutral">{label}</TagBadge>)}
          </span>
        }
        actions={brand ? <ViewAllAction link={link} to={{ tab: 'competitors', brandPage: brandKey(brand.name) }}>{t('Open in Brands', 'Abrir em Marcas')}</ViewAllAction> : undefined}
      />
      <MetricGrid columns={4} mobilePairs label={t('Product metrics', 'Métricas de produtos')}>
        <MetricCard
          label={t('Visibility', 'Visibilidade')}
          definition={brand ? t('Answers with product cards that include one of its products, over all answers with cards.', 'Respostas com cartões de produto que incluem um produto dela, sobre todas as respostas com cartões.') : t('Answers with product cards that include it, over all answers with cards.', 'Respostas com cartões de produto que o incluem, sobre todas as respostas com cartões.')}
          value={percent(row.answers, data.withProducts)}
          description={t(`${number(row.answers)} of ${number(data.withProducts)} answers with cards`, `${number(row.answers)} de ${number(data.withProducts)} respostas com cartões`)}
          rows={data.engines.map((item) => ({ key: item.engine, icon: <EngineIcon engine={item.engine} size={14} />, label: ENGINE_LABELS[item.engine], value: number(item.answers) }))}
        />
        <MetricCard
          label={t('Position', 'Posição')}
          definition={t('Mean place of its first card in each answer; 1 is the first card.', 'Lugar médio do primeiro cartão em cada resposta; 1 é o primeiro cartão.')}
          value={number(row.position, 1)}
          description={t(`First card in ${number(row.first)} answers`, `Primeiro cartão em ${number(row.first)} respostas`)}
        />
        {product ? (
          <>
            <MetricCard
              label={t('Price shown', 'Preço mostrado')}
              definition={t('Lowest and highest price on its cards, in the currency most of them use. — when no card showed a price.', 'Menor e maior preço nos seus cartões, na moeda que a maioria usa. — quando nenhum cartão mostrou preço.')}
              value={formatPriceRange(locale, product.price)}
              description={storesLine(locale, t, data.stores.length)}
            />
            <MetricCard
              label={t('Rating', 'Nota')}
              definition={t('Mean rating its cards showed, out of 5. — when no card showed one.', 'Nota média que os cartões mostraram, de 0 a 5. — quando nenhum cartão mostrou nota.')}
              value={product.rating === null ? '—' : number(product.rating, 1)}
              description={product.rating === null ? t('No card showed a rating', 'Nenhum cartão mostrou nota') : t('Out of 5', 'De 0 a 5')}
            />
          </>
        ) : (
          <>
            <MetricCard
              label={t('Share of cards', 'Fatia dos cartões')}
              definition={t('Its cards over every product card read, of any brand, monitored or not.', 'Os cartões dela sobre todos os cartões de produto lidos, de qualquer marca, monitorada ou não.')}
              value={percent(brand!.cards, data.cards)}
              description={t(`${number(brand!.cards)} of ${number(data.cards)} cards`, `${number(brand!.cards)} de ${number(data.cards)} cartões`)}
            />
            <MetricCard
              label={t('Products', 'Produtos')}
              definition={t('Its distinct products in the cards, by name.', 'Os produtos distintos dela nos cartões, pelo nome.')}
              value={number(brand!.products)}
              description={storesLine(locale, t, data.stores.length)}
            />
          </>
        )}
      </MetricGrid>
      {data.truncated && <Note status>{t('Large period: limited to the newest 5,000 cards.', 'Período grande: limitado aos 5.000 cartões mais recentes.')}</Note>}
      <TrendCard
        title={t('Position per day', 'Posição por dia')}
        info={t('Mean place of its first card on each day it appeared, per AI; 1 is the first card. Days without it have no point.', 'Lugar médio do primeiro cartão em cada dia em que apareceu, por IA; 1 é o primeiro cartão. Dias sem ele não têm ponto.')}
        data={trend}
        series={series}
        scale={{ domain: [1, ceiling], ticks: ceiling > 1 ? [1, ceiling] : [1] }}
        reversed
        locale={locale}
        formatValue={(value) => number(value, 1)}
        formatTick={(value) => number(value)}
        label={t('Position per day', 'Posição por dia')}
      />
      {brand && (
        <SectionCard title={t('Products', 'Produtos')} info={t('Its products in the cards of the period. Each opens its page.', 'Os produtos dela nos cartões do período. Cada um abre a sua página.')}>
          <DataTable singleLine rows={products.rows} sort={products.sort} onSortChange={products.onSortChange} rowKey={(item) => item.key} rowLink={(item) => link(productPage(item.key))} columns={productColumns(locale, t, data.withProducts)} />
          {products.controls}
        </SectionCard>
      )}
      <div className="overview-grid">
        <SectionCard title={t('Prompts', 'Prompts')} info={t('The prompts whose answers show it, by answers. Each opens the prompt.', 'Os prompts cujas respostas o mostram, por respostas. Cada um abre o prompt.')}>
          <DataTable
            singleLine
            minWidth={0}
            compact
            rows={data.prompts.slice(0, 10)}
            rowKey={(item) => item.prompt}
            rowLink={(item) => link({ tab: 'prompts', prompt: promptUnit(item.promptId) })}
            columns={[
              { key: 'prompt', header: t('Prompt', 'Prompt'), mobile: 'title', hint: (item) => item.prompt || undefined, cell: (item) => <span className="block truncate">{item.prompt || t('Prompt', 'Prompt')}</span> },
              { key: 'ais', header: t('AIs', 'IAs'), label: t('AIs', 'IAs'), cell: (item) => <CompactEngineIcons engines={item.engines} /> },
              { key: 'answers', header: t('Answers', 'Respostas'), label: t('Answers', 'Respostas'), align: 'end', cell: (item) => number(item.answers) },
              { key: 'position', header: t('Position', 'Posição'), label: t('Position', 'Posição'), align: 'end', cell: (item) => number(item.position, 1) },
            ]}
          />
        </SectionCard>
        <SectionCard
          title={t('Stores', 'Lojas')}
          info={t('Where its cards send buyers, every card counted, with the prices shown there. Cards without a store (common on ChatGPT) are not counted here.', 'Para onde os cartões levam o comprador, contando todos os cartões, com os preços mostrados ali. Cartões sem loja (comuns no ChatGPT) não entram aqui.')}
        >
          {data.stores.length ? (
            <DataTable
              singleLine
              minWidth={0}
              compact
              rows={data.stores.slice(0, 10)}
              rowKey={(item) => item.name}
              columns={[
                { key: 'store', header: t('Store', 'Loja'), mobile: 'title', cell: (item) => item.name },
                { key: 'cards', header: t('Cards', 'Cartões'), label: t('Cards', 'Cartões'), align: 'end', cell: (item) => number(item.cards) },
                product
                  ? { key: 'price', header: t('Price shown', 'Preço mostrado'), label: t('Price shown', 'Preço mostrado'), align: 'end', cell: (item) => formatPriceRange(locale, item.price) }
                  : { key: 'products', header: t('Products', 'Produtos'), label: t('Products', 'Produtos'), align: 'end', cell: (item) => number(item.products) },
              ]}
            />
          ) : (
            <EmptyState frame="bare" title={t('No card in this period names a store.', 'Nenhum cartão deste período cita uma loja.')} />
          )}
        </SectionCard>
      </div>
      {product && (
        <SectionCard title={t('Shown alongside', 'Mostrados junto')} info={t('Other products in the same answers, by the answers they share with it. Each opens its page.', 'Outros produtos nas mesmas respostas, pelas respostas que dividem com ele. Cada um abre a sua página.')}>
          {data.beside.length ? (
            <DataTable
              singleLine
              minWidth={0}
              compact
              rows={data.beside}
              rowKey={(item) => item.key}
              rowLink={(item) => link(productPage(item.key))}
              columns={[
                { ...productColumns(locale, t, data.withProducts)[0], sortValue: undefined } as DataColumn<ProductRow & { together: number }>,
                { key: 'together', header: t('Answers together', 'Respostas juntos'), label: t('Answers together', 'Respostas juntos'), align: 'end', cell: (item) => number(item.together) },
              ]}
            />
          ) : (
            <EmptyState frame="bare" title={t('No other product appears in its answers.', 'Nenhum outro produto aparece nas respostas dele.')} />
          )}
        </SectionCard>
      )}
      <SectionCard
        title={t('Answers', 'Respostas')}
        info={
          data.answered > data.answers.length
            ? t(`The newest ${number(data.answers.length)} of ${number(data.answered)}; each opens in Responses. — when the card showed no price, store or label.`, `As ${number(data.answers.length)} mais recentes de ${number(data.answered)}; cada uma abre em Respostas. — quando o cartão não mostrou preço, loja ou selo.`)
            : t('Each opens in Responses. — when the card showed no price, store or label.', 'Cada uma abre em Respostas. — quando o cartão não mostrou preço, loja ou selo.')
        }
      >
        <DataTable singleLine rows={page.rows} rowKey={(answer) => answer.run} rowLink={(answer) => link({ tab: 'responses', run: answer.run })} columns={answerColumns} />
        {page.controls}
      </SectionCard>
    </div>
  );
}
