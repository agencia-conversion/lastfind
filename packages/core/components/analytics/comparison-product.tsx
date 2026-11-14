'use client';
// The drill downs of Comparison, one page in the same shape for a product, a persona and an attribute (Products, Personas, Attributes and
// the Overview's cards open them): the brand's scores against each competitor (per attribute; on an attribute's page, per product), their
// evolution in the period, the fact behind each AI's score, and the answers they come from. Every figure is the report's (lib/comparison.ts
// comparisonMetrics) with the page's own filter; the answers are the report's newest.
import { useEffect, useState, type ReactNode } from 'react';
import { requestJson } from '@/lib/client';
import { seriesColorVar } from '@/lib/chart-series';
import type { ComparisonDiscard } from '@/lib/comparison';
import type { ComparisonAnswers, ComparisonReport } from '@/lib/server/comparison';
import { MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { PageFilters, PageHeading } from '@/components/lastfind/presentation/page-heading';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { TrendCard } from '@/components/lastfind/presentation/trend-chart';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AnswerMarkdown } from './answer-markdown';
import { EmptyState, FilterSelect, ModelMark, useCopy, useNumbers } from './shared';
import type { Linker } from './drill-link';
import { COMPARISON_SECTIONS, ComparisonHeatmap, ComparisonKpis, ComparisonWaiting, Missing, useBrandCell, type ComparisonDetail, type ComparisonSettings } from './comparison-view';

type Translate = (en: string, pt: string) => string;
type Answer = ComparisonAnswers['answers'][number];
type Loaded<T> = { path: string; data: T | null; failed: boolean } | null;

/** Why one answer is left out of the figures, in a few words. */
export const discardReason = (t: Translate, reason: ComparisonDiscard) =>
  reason === 'order'
    ? t('its order on an attribute contradicts its own scores', 'a ordem num atributo contradiz as próprias notas')
    : reason === 'evidence'
      ? t('it gives a fact for almost none of its scores', 'ela dá fato para quase nenhuma das notas')
      : t('it gives no score', 'ela não dá nenhuma nota');

function useRead<T>(path: string) {
  const [found, setFound] = useState<Loaded<T>>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    requestJson<T>(path)
      .then((data) => active && setFound({ path, data, failed: false }))
      .catch((error) => active && error?.name !== 'AbortError' && setFound({ path, data: null, failed: true }));
    return () => {
      active = false;
    };
  }, [path, attempt]);
  // This path's data, else the last one while the next loads (nothing jumps).
  const current = found?.path === path ? found : null;
  return { data: current?.data ?? (found && !found.failed ? found.data : null), failed: !!current?.failed, retry: () => setAttempt((value) => value + 1) };
}

/** What each drill down reads from the report: its own filter, and the other dimensions a page filters by. */
const FILTER_OF = { products: 'product', personas: 'persona', attributes: 'attribute' } as const;

export function ComparisonDetailPage({ base, detail, settings, filters, link, onTitle }: {
  base: string;
  detail: ComparisonDetail;
  settings: ComparisonSettings;
  /** The header's period and AIs. */
  filters: URLSearchParams;
  link: Linker;
  onTitle?: (title: string | null) => void;
}) {
  const t = useCopy();
  const { number, locale } = useNumbers();
  const { section, id } = detail;
  const config = settings.config;
  const item = section === 'products' ? config.products.find((entry) => entry.id === id) : section === 'personas' ? config.personas.find((entry) => entry.id === id) : config.attributes.find((entry) => entry.id === id);
  // A page filters by the dimensions it is not: a product's by persona, a persona's by product, an attribute's by both.
  const [product, setProduct] = useState('all');
  const [persona, setPersona] = useState('all');
  const query = new URLSearchParams(filters);
  query.set(FILTER_OF[section], id);
  if (section !== 'products' && product !== 'all') query.set('product', product);
  if (section !== 'personas' && persona !== 'all') query.set('persona', persona);
  const report = useRead<ComparisonReport>(`${base}?${query}`);
  query.set('view', 'answers');
  const answers = useRead<ComparisonAnswers>(`${base}?${query}`);
  const [attribute, setAttribute] = useState<string | null>(null);
  const brandOf = useBrandCell(settings);
  useEffect(() => {
    onTitle?.(item?.name ?? null);
    return () => onTitle?.(null);
  }, [item?.name, onTitle]);

  const what = {
    products: { gone: t('This product is not compared any more', 'Este produto não é mais comparado'), list: t('See the products', 'Ver os produtos'), loading: t('The product did not load.', 'O produto não carregou.'), answers: t('The newest answers of this product in the period, what each AI was asked and what it answered, and whether it counted.', 'As respostas mais recentes deste produto no período, o que cada IA recebeu e o que respondeu, e se contou.') },
    personas: { gone: t('This persona is not asked about any more', 'Esta persona não é mais perguntada'), list: t('See the personas', 'Ver as personas'), loading: t('The persona did not load.', 'A persona não carregou.'), answers: t('The newest answers for this persona in the period, what each AI was asked and what it answered, and whether it counted.', 'As respostas mais recentes para esta persona no período, o que cada IA recebeu e o que respondeu, e se contou.') },
    attributes: { gone: t('This attribute is not compared any more', 'Este atributo não é mais comparado'), list: t('See the attributes', 'Ver os atributos'), loading: t('The attribute did not load.', 'O atributo não carregou.'), answers: t('The newest answers that asked about this attribute in the period, what each AI was asked and what it answered, and whether it counted.', 'As respostas mais recentes que perguntaram sobre este atributo no período, o que cada IA recebeu e o que respondeu, e se contou.') },
  }[section];
  if (!item)
    return (
      <EmptyState
        title={what.gone}
        description={t('It was removed from Comparison, or the address is wrong. Its answers already read stay in the overview.', `${section === 'personas' ? 'Ela' : 'Ele'} saiu da Comparação, ou o endereço está errado. As respostas já lidas continuam na visão geral.`)}
        action={<Button variant="outline" nativeButton={false} render={<a {...link({ comparisonView: COMPARISON_SECTIONS[section].page })} aria-label={what.list} />}>{what.list}</Button>}
      />
    );
  const attributeName = new Map(config.attributes.map((entry) => [entry.id, entry.name]));
  const names = (items: { name: string }[]) => items.map((entry) => entry.name).join(', ');
  const products = section === 'attributes' ? config.products.filter((entry) => entry.attributes.includes(id)) : section === 'products' ? [] : config.products;
  const productOf = section === 'products' ? config.products.find((entry) => entry.id === id)! : null;
  const description = productOf
    ? t(`Compared with ${names(productOf.competitors)} on ${names(productOf.attributes.map((key) => ({ name: attributeName.get(key) ?? key })))}.`, `Comparado com ${names(productOf.competitors)} em ${names(productOf.attributes.map((key) => ({ name: attributeName.get(key) ?? key })))}.`)
    : section === 'personas'
      ? t(`For ${(item as { description: string }).description || item.name}, on ${names(products)}.`, `Para ${(item as { description: string }).description || item.name}, em ${names(products)}.`)
      : [(item as { description: string }).description, products.length ? t(`Compared in ${names(products)}.`, `Comparado em ${names(products)}.`) : ''].filter(Boolean).join(' ');
  const filtered = product !== 'all' || persona !== 'all';
  const heading = (
    <>
      <PageHeading title={item.name} description={description || undefined} />
      {(products.length > 1 || (section !== 'personas' && config.personas.length > 1)) && (
        <PageFilters>
          {products.length > 1 && (
            <FilterSelect multiple={false} label={t('Product', 'Produto')} value={product} onChange={setProduct} options={[{ value: 'all', label: t('All products', 'Todos os produtos') }, ...products.map((entry) => ({ value: entry.id, label: entry.name }))]} />
          )}
          {section !== 'personas' && config.personas.length > 1 && (
            <FilterSelect multiple={false} label={t('Persona', 'Persona')} value={persona} onChange={setPersona} options={[{ value: 'all', label: t('All personas', 'Todas as personas') }, ...config.personas.map((entry) => ({ value: entry.id, label: entry.name }))]} />
          )}
        </PageFilters>
      )}
    </>
  );
  if (report.failed && !report.data) return <>{heading}<EmptyState tone="error" title={what.loading} onRetry={report.retry} /></>;
  if (!report.data) return <>{heading}<DetailBody /></>;
  const data = report.data;
  if (data.status !== 'ready') return <>{heading}<ComparisonWaiting report={data} filtered={filtered} onClear={() => { setProduct('all'); setPersona('all'); }} /></>;

  const rows = [...data.brands.filter((row) => row.own), ...data.brands.filter((row) => !row.own)];
  const roster = data.brands.filter((row) => !row.own).map((row) => row.brand);
  const series = rows.map((row, at) => ({ id: row.brand, key: `b${at}`, name: row.brand, color: seriesColorVar(row.brand, data.brand, roster), primary: row.own, icon: brandOf(row.brand, row.own) }));
  const trend = data.days.map((day) => ({ date: day.day, ...Object.fromEntries(rows.map((row, at) => [`b${at}`, day.brands[row.brand] ?? null])) }));
  // The heatmap's columns: an attribute's page compares the brands on it in each product; the others, on each attribute.
  const byProduct = section === 'attributes';
  const columns = byProduct ? data.products.map((entry) => ({ id: entry.id, name: entry.name })) : data.attributes.map((entry) => ({ id: entry.id, name: entry.name }));
  const cellsOf = (brand: string) => Object.fromEntries(byProduct
    ? data.products.map((entry) => [entry.id, entry.brands[brand] ?? null])
    : data.attributes.map((entry) => [entry.id, entry.brands.find((cell) => cell.brand === brand)?.score ?? null]));
  // The evidence's attributes: the product's, this attribute, or every attribute the persona was asked about.
  const asked = productOf ? productOf.attributes.map((key) => ({ id: key, name: attributeName.get(key) ?? key })) : section === 'attributes' ? [{ id, name: item.name }] : data.attributes.map((entry) => ({ id: entry.id, name: entry.name }));
  const chosen = attribute && asked.some((entry) => entry.id === attribute) ? attribute : asked[0]?.id ?? '';
  const heatTitle = t('Scores against each competitor', 'Notas contra cada concorrente');
  return (
    <>
      {heading}
      <ComparisonKpis report={data} attribute={section === 'attributes'} />
      <SectionCard
        className="mb-5"
        title={heatTitle}
        info={byProduct
          ? t(
              'Each brand’s mean score from 0 to 100 on this attribute in each product, in the answers of this period; your brand first. Overall: its mean score on this attribute in all of them, the figure the ranking and the wins come from. 🏆 marks the highest score of each column; a tie marks every leader.',
              'A nota média de cada marca de 0 a 100 neste atributo em cada produto, nas respostas deste período; sua marca primeiro. Geral: a nota média neste atributo em todos eles, o número de onde vêm o ranking e as vitórias. 🏆 marca a maior nota de cada coluna; num empate, todos os líderes.',
            )
          : t(
              'Each brand’s mean score from 0 to 100 on each attribute, in the answers of this period; your brand first. Overall: the mean of the attributes scored in each answer (half of those asked at least), the same figure the ranking and the wins come from. 🏆 marks the highest score of each column; a tie marks every leader.',
              'A nota média de cada marca de 0 a 100 em cada atributo, nas respostas deste período; sua marca primeiro. Geral: a média dos atributos com nota em cada resposta (pelo menos metade dos perguntados), o mesmo número de onde vêm o ranking e as vitórias. 🏆 marca a maior nota de cada coluna; num empate, todos os líderes.',
            )}
      >
        {rows.length ? (
          <ComparisonHeatmap
            label={heatTitle}
            brands={rows.map((row) => ({ name: row.brand, own: row.own, overall: row.score, cells: cellsOf(row.brand) }))}
            attributes={columns}
            brandCell={(row) => brandOf(row.name, row.own)}
            empty={byProduct ? t('No score on this attribute in that product in this period', 'Sem nota neste atributo nesse produto neste período') : t('No score on that attribute in this period', 'Sem nota nesse atributo neste período')}
          />
        ) : (
          <EmptyState frame="bare" title={t('No answer of this period was counted.', 'Nenhuma resposta deste período foi contada.')} description={t('Every answer read was discarded: see why in Discarded answers.', 'Todas as respostas lidas foram descartadas: veja o motivo em Respostas descartadas.')} />
        )}
      </SectionCard>
      <TrendCard
        className="mb-5"
        title={byProduct ? t('Score over time', 'Nota ao longo do tempo') : t('Overall score over time', 'Nota geral ao longo do tempo')}
        info={byProduct
          ? t('Each brand’s mean score on this attribute per day of collection. A day without a score for a brand leaves a gap, never a zero.', 'A nota média de cada marca neste atributo por dia de coleta. Um dia sem nota para uma marca deixa um vão, nunca zero.')
          : t('Each brand’s mean overall score per day of collection. A day without a score for a brand leaves a gap, never a zero.', 'A nota geral média de cada marca por dia de coleta. Um dia sem nota para uma marca deixa um vão, nunca zero.')}
        empty={trend.length ? undefined : <EmptyState frame="bare" title={t('No day with scores in this period.', 'Nenhum dia com notas neste período.')} />}
        data={trend}
        series={series}
        scale={{ domain: [0, 100], ticks: [0, 25, 50, 75, 100] }}
        locale={locale}
        formatValue={(value) => number(value, 0)}
        formatTick={(value) => number(value, 0)}
      />
      <SectionCard
        className="mb-5"
        title={t('Evidence by AI', 'Evidências por IA')}
        info={t(
          'The fact each AI gave for each brand’s score on the attribute, from its newest answer that counted. A score below 60 may come without one: the scale allows it.',
          'O fato que cada IA deu para a nota de cada marca no atributo, da resposta mais recente que contou. Uma nota abaixo de 60 pode vir sem fato: a escala permite.',
        )}
        action={asked.length > 1 ? (
          <FilterSelect multiple={false} label={t('Attribute', 'Atributo')} value={chosen} onChange={setAttribute} options={asked.map((entry) => ({ value: entry.id, label: entry.name }))} />
        ) : undefined}
      >
        <Evidence answers={answers.data?.answers ?? null} failed={answers.failed} retry={answers.retry} attribute={chosen} own={data.brand} brandOf={brandOf} />
      </SectionCard>
      <SectionCard title={t('Answers', 'Respostas')} info={what.answers} inset={answers.data?.answers.length ? 'padded' : undefined}>
        <Answers answers={answers.data?.answers ?? null} failed={answers.failed} retry={answers.retry} attributeName={(key) => attributeName.get(key) ?? key} section={section} />
      </SectionCard>
    </>
  );
}

/** The fact behind each AI's score of each brand on one attribute: its newest answer that counted. */
function Evidence({ answers, failed, retry, attribute, own, brandOf }: {
  answers: Answer[] | null;
  failed: boolean;
  retry: () => void;
  attribute: string;
  own: string;
  brandOf: (name: string, own: boolean) => ReactNode;
}) {
  const t = useCopy();
  const { number } = useNumbers();
  if (failed && !answers) return <EmptyState frame="bare" tone="error" title={t('The evidence did not load.', 'As evidências não carregaram.')} onRetry={retry} />;
  if (!answers) return <DataTable singleLine minWidth={0} compact loading={4} rows={[]} rowKey={String} columns={[{ key: 'brand', header: t('Brand', 'Marca'), cell: () => null }, { key: 'fact', header: t('Fact', 'Fato'), cell: () => null }]} />;
  const seen = new Set<string>();
  const rows = answers.flatMap((answer) => {
    if (!answer.reading || answer.reading.discarded) return [];
    return Object.entries(answer.reading.scores[attribute] ?? {}).flatMap(([brand, cell]) => {
      const key = `${answer.engine}|${brand}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, brand, engine: answer.engine, persona: answer.persona, ...cell }];
    });
  }).sort((a, b) => Number(b.brand === own) - Number(a.brand === own) || a.brand.localeCompare(b.brand) || b.score - a.score);
  if (!rows.length) return <EmptyState frame="bare" title={t('No counted answer scored this attribute in this period.', 'Nenhuma resposta que contou deu nota a este atributo neste período.')} />;
  return (
    <DataTable
      singleLine="wide"
      minWidth={0}
      compact
      ariaLabel={t('Evidence by AI', 'Evidências por IA')}
      rows={rows}
      rowKey={(row) => row.key}
      columns={[
        { key: 'brand', header: t('Brand', 'Marca'), mobile: 'title', width: '14rem', cell: (row) => brandOf(row.brand, row.brand === own) },
        { key: 'engine', header: t('AI', 'IA'), label: t('AI', 'IA'), width: '11rem', cell: (row) => <ModelMark model={row.engine} /> },
        { key: 'score', header: t('Score', 'Nota'), label: t('Score', 'Nota'), align: 'end', width: '5rem', cell: (row) => number(row.score, 0) },
        {
          // A text column of at most 20rem (shell.md section 8): a long fact ends in its balloon; the answers below hold it whole.
          key: 'fact', header: t('Fact', 'Fato'), label: t('Fact', 'Fato'), mobile: 'wide', maxWidth: '20rem', hint: (row) => row.fact ?? undefined,
          cell: (row) => row.fact ?? <span className="text-muted-foreground">{t('No fact given: the score stays below 60', 'Nenhum fato dado: a nota fica abaixo de 60')}</span>,
        },
      ]}
    />
  );
}

/** The answers behind the figures: each AI's question and answer, opened in place, and whether it counted. */
function Answers({ answers, failed, retry, attributeName, section }: { answers: Answer[] | null; failed: boolean; retry: () => void; attributeName: (id: string) => string; section: ComparisonDetail['section'] }) {
  const t = useCopy();
  const { number, locale } = useNumbers();
  const day = (value: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  if (failed && !answers) return <EmptyState frame="bare" tone="error" title={t('The answers did not load.', 'As respostas não carregaram.')} onRetry={retry} />;
  if (!answers) return <div className="grid gap-2 px-5 pb-5" aria-busy="true">{[0, 1, 2].map((at) => <Skeleton key={at} className="h-12 w-full" />)}</div>;
  if (!answers.length) return <EmptyState frame="bare" title={t('No answer in this period yet.', 'Nenhuma resposta neste período ainda.')} />;
  return (
    <Accordion variant="rows" multiple>
      {answers.map((answer) => {
        const status = !answer.reading
          ? <TagBadge tone="quiet">{t('Not read yet', 'Ainda não lida')}</TagBadge>
          : answer.reading.discarded
            ? <TagBadge tone="danger">{t('Discarded', 'Descartada')}</TagBadge>
            : <TagBadge tone="outline">{t('Counted', 'Contou')}</TagBadge>;
        return (
          <AccordionItem key={answer.id} value={answer.id}>
            <AccordionTrigger>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <ModelMark model={answer.engine} />
                <span className="text-caption text-muted-foreground">{day(answer.day)}</span>
                {section !== 'products' && <span className="min-w-0 wrap-anywhere">{answer.product}</span>}
                {section !== 'personas' && <span className="min-w-0 wrap-anywhere">{answer.persona}</span>}
                {status}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-4">
                {answer.reading?.discarded && (
                  <p className="text-muted-foreground">{t(`Left out of every figure: ${discardReason(t, answer.reading.discarded)}.`, `Fora de todos os números: ${discardReason(t, answer.reading.discarded)}.`)}</p>
                )}
                <div>
                  <h4 className="text-caption text-muted-foreground">{t('Question asked', 'Pergunta feita')}</h4>
                  <p>{answer.question}</p>
                </div>
                {answer.reading && Object.keys(answer.reading.scores).length > 0 && (
                  <DataTable
                    singleLine
                    minWidth={0}
                    compact
                    ariaLabel={t('Scores read', 'Notas lidas')}
                    rows={answer.options.map((option) => ({ name: option.name }))}
                    rowKey={(row) => row.name}
                    columns={[
                      { key: 'option', header: t('Option', 'Opção'), mobile: 'title', cell: (row) => row.name },
                      ...answer.attributes.map((item) => ({
                        key: item.id,
                        header: attributeName(item.id),
                        label: attributeName(item.id),
                        align: 'end' as const,
                        cell: (row: { name: string }) => {
                          const cell = answer.reading!.scores[item.id]?.[row.name];
                          return cell ? number(cell.score, 0) : <Missing reason={t('The answer gives it no score here', 'A resposta não lhe dá nota aqui')} label={`${row.name}, ${attributeName(item.id)}`} />;
                        },
                      })),
                    ]}
                  />
                )}
                <div>
                  <h4 className="text-caption text-muted-foreground">{t('Answer', 'Resposta')}</h4>
                  {answer.answer ? <AnswerMarkdown text={answer.answer} /> : <p className="text-muted-foreground">{t('The AI gave no text.', 'A IA não deu texto.')}</p>}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

/** A drill down's body while it loads: the strip, the heatmap, the trend and the two lists. */
function DetailBody() {
  const t = useCopy();
  const label = t('Loading…', 'Carregando…');
  return (
    <div aria-busy="true" aria-label={label}>
      <MetricGridSkeleton count={4} label={label} description />
      <SectionCard className="mb-5" title={t('Scores against each competitor', 'Notas contra cada concorrente')} loading lines={4} />
      <TrendCard className="mb-5" loading title={t('Overall score over time', 'Nota geral ao longo do tempo')} data={[]} series={[]} scale={{ domain: [0, 100], ticks: [0, 100] }} locale="en" formatValue={String} formatTick={String} />
      <SectionCard className="mb-5" title={t('Evidence by AI', 'Evidências por IA')} loading lines={4} />
      <SectionCard title={t('Answers', 'Respostas')} loading lines={3} />
    </div>
  );
}

/** A drill down's page while Comparison's settings load: its heading's place and the body. */
export function ComparisonDetailSkeleton() {
  return (
    <>
      <div className="page-heading" aria-hidden="true">
        <Skeleton inline className="h-lh w-64 max-w-full" />
      </div>
      <DetailBody />
    </>
  );
}
