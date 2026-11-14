'use client';

import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { ArrowLeft, Compass, ListChecks, Target } from 'lucide-react';
import { ENGINE_LABELS } from '@/lib/engines';
import { brandKey } from '@/lib/brand-decisions';
import { ENTITY_LABELS, contentBrief } from '@/lib/fanout-intents';
import { numberLocale } from '@/lib/number-format';
import type { OpportunitiesReport, OpportunityRow } from '@/lib/report-types';
import { useTableColumns, visibleColumns } from '@/hooks/use-table-columns';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Hint } from '@/components/ui/tooltip';
import { CompactEngineIcons, EngineIcon } from '@/components/lastfind/identity-icons';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { ColumnPicker, DataTable, DataTableScreen, DataTableToolbar, skeletonColumns, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { DetailBody, DetailHeader, DetailPage } from '@/components/lastfind/presentation/detail-page';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { BrandName, EmptyState, SearchField, SummaryPager, useCopy, useSortedPage } from './shared';
import type { DrillTarget, Linker } from './drill-link';
import { EntityBadges } from './fanout-view';
import { readParam, writeParam } from './agent-screen';

type Translate = (en: string, pt: string) => string;

// The sortable columns, ordered over the whole list before it is paged; without a choice, the report's order (impact).
const OPPORTUNITY_SORT = {
  intent: (row: OpportunityRow) => row.intent.name,
  missing: (row: OpportunityRow) => row.missing.length,
  gap: (row: OpportunityRow) => row.impact,
  prompts: (row: OpportunityRow) => row.promptCount,
};

/**
 * Opportunities (Agent): the search intents where two or more AIs answer without the brand while competitors appear, the
 * largest first (impact: those answers weighted by the project's topic weights), laid out as Brands is: the cards, then the
 * table with search, sorting, columns and pages. A row opens the opportunity on its own page (`opportunity` in the address,
 * as Agent keeps its conversation): the intent and its entities, the searches inside it, which AIs miss the brand, the
 * competitors and the sources they cite there, with links to Prompts, Responses, Query Fan Out and Sources, and "Create
 * content", which hands Contents a brief.
 */
export function OpportunitiesView({
  report,
  loading,
  failed,
  onRetry,
  locale,
  t,
  link,
  demo = false,
}: {
  report: OpportunitiesReport | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  locale: string;
  t: Translate;
  link: Linker;
  /** The public demo keeps the column choice in memory only. */
  demo?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(() => readParam('opportunity'));
  useEffect(() => {
    const read = () => setOpen(readParam('opportunity'));
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const columnsPref = useTableColumns('opportunities', demo);
  const number = useMemo(() => new Intl.NumberFormat(numberLocale(locale)), [locale]);
  const percent = useMemo(() => new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 0, style: 'percent' }), [locale]);
  const needle = search.trim().toLowerCase();
  const rows = (report?.opportunities ?? []).filter(
    (row) =>
      !needle ||
      [row.intent.name, row.intent.description, ...row.intent.entities.map((entity) => entity.value), ...row.queries.map((query) => query.text)].some((text) =>
        text.toLowerCase().includes(needle),
      ),
  );
  const page = useSortedPage(rows, OPPORTUNITY_SORT, search, 25, t, t('Opportunities', 'Oportunidades'));
  if (failed)
    return (
      <EmptyState
        tone="error"
        title={t('The report did not load.', 'O relatório não carregou.')}
        onRetry={onRetry}
      />
    );
  if (loading || !report) return <OpportunitiesSkeleton />;
  if (open) {
    const row = report.opportunities.find((item) => item.intent.id === open);
    return (
      <OpportunityPage
        row={row}
        number={number}
        t={t}
        link={link}
        onBack={() => {
          writeParam('opportunity', null);
          setOpen(null);
        }}
      />
    );
  }
  if (!report.responses)
    return (
      <EmptyState
        title={t('No responses in this period yet', 'Ainda não há respostas neste período')}
        description={t(
          'Opportunities come from the AI answers to your prompts and the searches the AIs ran for them. Try another period or wait for the first collection.',
          'As oportunidades vêm das respostas das IAs aos seus prompts e das buscas que as IAs fizeram para elas. Tente outro período ou aguarde a primeira coleta.',
        )}
      />
    );
  if (!report.withFanout)
    return (
      <EmptyState
        title={t('Searches not returned', 'Buscas não informadas')}
        description={t(
          `${number.format(report.responses)} responses were collected, but none includes the searches the AI ran. Opportunities group those searches into intents, so there is nothing to compare yet.`,
          `${number.format(report.responses)} respostas foram coletadas, mas nenhuma inclui as buscas que a IA fez. As oportunidades agrupam essas buscas em intenções, então ainda não há o que comparar.`,
        )}
      />
    );
  if (!report.classified)
    return (
      <EmptyState
        title={t('Intents are on their way', 'As intenções estão a caminho')}
        description={t(
          `Opportunities appear after the searches are grouped into intents, in the background after each collection. ${number.format(report.queries)} searches of this period wait for it.`,
          `As oportunidades aparecem depois que as buscas forem agrupadas em intenções, em segundo plano depois de cada coleta. ${number.format(report.queries)} buscas deste período aguardam.`,
        )}
        action={
          <Button variant="outline" nativeButton={false} render={<a {...link({ tab: 'fanout' })} aria-label={t('See the searches in Query Fan Out', 'Ver as buscas no Query Fan Out')} />}>
            {t('See the searches', 'Ver as buscas')}
          </Button>
        }
      />
    );
  // The whole row opens the opportunity's page; a new tab or window gets its address.
  const rowLink = (row: OpportunityRow) => ({
    href: hrefWith(link, 'opportunities', 'opportunity', row.intent.id),
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      writeParam('opportunity', row.intent.id, true);
      setOpen(row.intent.id);
      window.scrollTo({ top: 0 });
    },
  });
  const allColumns: DataColumn<OpportunityRow>[] = [
    { key: 'rank', width: 48, header: '#', align: 'center', mobile: 'hide', cell: (_, index) => <span className="text-muted-foreground">{page.offset + index + 1}</span> },
    {
      key: 'intent',
      sortValue: OPPORTUNITY_SORT.intent,
      header: t('Intent', 'Intenção'),
      mobile: 'title',
      // One line per row: the name truncates, the balloon has it whole with the description.
      width: '22rem',
      shrinkTo: '12rem',
      hint: (row) => [row.intent.name, row.intent.description].filter(Boolean).join('\n'),
      cell: (row) => row.intent.name,
    },
    {
      key: 'entities',
      header: t('Entities', 'Entidades'),
      label: t('Entities', 'Entidades'),
      info: t('What the intent is about: service, location, audience, brand or product, modifier. A dash when it names none.', 'Do que a intenção trata: serviço, local, público, marca ou produto, modificador. Um traço quando ela não cita nenhuma.'),
      width: '12rem',
      shrinkTo: '8rem',
      hint: (row) => row.intent.entities.map((entity) => `${t(...ENTITY_LABELS[entity.type])}: ${entity.value}`).join('\n'),
      cell: (row) => row.intent.entities.map((entity) => entity.value).join(', ') || '—',
    },
    {
      key: 'missing',
      sortValue: OPPORTUNITY_SORT.missing,
      header: t('AIs without you', 'IAs sem você'),
      label: t('AIs without you', 'IAs sem você'),
      info: t('AIs that answer these prompts without ever naming your brand while they name competitors.', 'IAs que respondem a esses prompts sem nunca citar sua marca enquanto citam concorrentes.'),
      cell: (row) => <CompactEngineIcons engines={row.missing} />,
    },
    {
      key: 'gap',
      sortValue: OPPORTUNITY_SORT.gap,
      header: t('Answers without you', 'Respostas sem você'),
      label: t('Answers without you', 'Respostas sem você'),
      info: t(
        'Answers to the prompts behind this intent that name a competitor but not your brand. The list is ordered by these answers weighted by your topic weights.',
        'Respostas aos prompts por trás desta intenção que citam um concorrente e não a sua marca. A lista é ordenada por essas respostas ponderadas pelos pesos dos tópicos.',
      ),
      align: 'end',
      cell: (row) => <span className="whitespace-nowrap">{`${number.format(row.gapAnswers)} ${t('of', 'de')} ${number.format(row.answers)}`}</span>,
    },
    { key: 'prompts', sortValue: OPPORTUNITY_SORT.prompts, header: t('Prompts', 'Prompts'), label: t('Prompts', 'Prompts'), align: 'end', cell: (row) => number.format(row.promptCount) },
    {
      key: 'competitors',
      header: t('Competitors present', 'Concorrentes presentes'),
      label: t('Competitors present', 'Concorrentes presentes'),
      width: '12rem',
      shrinkTo: '8rem',
      cell: (row) => row.competitors.map((brand) => brand.name).join(', '),
    },
  ];
  const pickerColumns = allColumns.map((column) => ({ key: column.key, label: column.label ?? (typeof column.header === 'string' ? column.header : column.key) }));
  return (
    <DataTableScreen
      cards={
        <>
          <MetricGrid columns={3} mobilePairs label={t('Opportunity metrics', 'Métricas de oportunidades')}>
            <MetricCard
              icon={<Target size={14} aria-hidden="true" />}
              label={t('Opportunities', 'Oportunidades')}
              definition={t('Intents where 2 or more AIs answer without your brand while competitors appear.', 'Intenções em que 2 ou mais IAs respondem sem sua marca enquanto concorrentes aparecem.')}
              value={number.format(report.opportunities.length)}
            />
            <MetricCard
              icon={<Compass size={14} aria-hidden="true" />}
              label={t('Intents', 'Intenções')}
              definition={t('Needs behind the searches the AIs ran in this period.', 'Necessidades por trás das buscas que as IAs fizeram neste período.')}
              value={number.format(report.intents)}
            />
            <MetricCard
              icon={<ListChecks size={14} aria-hidden="true" />}
              label={t('Searches classified', 'Buscas classificadas')}
              definition={t(
                `${number.format(report.classified)} of ${number.format(report.queries)} distinct searches are grouped into intents; the rest waits for the next classification.`,
                `${number.format(report.classified)} de ${number.format(report.queries)} buscas distintas estão agrupadas em intenções; o resto aguarda a próxima classificação.`,
              )}
              value={percent.format(report.classified / report.queries)}
            />
          </MetricGrid>
          {report.truncated && (
            <Note status>
              {t('Large period: limited to the newest 5,000 responses.', 'Período grande: limitado às 5.000 respostas mais recentes.')}
            </Note>
          )}
        </>
      }
    >
      <DataTableToolbar
        label={t('Opportunity filters', 'Filtros de oportunidades')}
        actions={<ColumnPicker label={t('Columns', 'Colunas')} columns={pickerColumns} hidden={columnsPref.hidden} onChange={columnsPref.setHidden} required={['intent']} />}
      >
        <SearchField value={search} onChange={setSearch} placeholder={t('Search opportunities', 'Buscar oportunidades')} />
      </DataTableToolbar>
      {report.opportunities.length === 0 ? (
        <EmptyState
          frame="bare"
          title={t('No opportunities in this period', 'Nenhuma oportunidade neste período')}
          description={t(
            `In each of the ${number.format(report.intents)} intents, your brand appears in the answers of every AI but one at most, or no competitor appears where it is missing.`,
            `Em cada uma das ${number.format(report.intents)} intenções, sua marca aparece nas respostas de todas as IAs, menos uma no máximo, ou nenhum concorrente aparece onde ela falta.`,
          )}
        />
      ) : rows.length ? (
        <DataTable
          singleLine
          compact
          fill
          stackColumns={3}
          ariaLabel={t('Opportunities', 'Oportunidades')}
          rows={page.rows}
          rowKey={(row) => row.intent.id}
          rowLink={rowLink}
          sort={page.sort}
          onSortChange={page.onSortChange}
          columns={visibleColumns(allColumns, columnsPref.hidden, ['intent'])}
          summary={{ intent: `${t('Summary', 'Resumo')} (${number.format(rows.length)})` }}
          summaryAside={<SummaryPager page={page} total={rows.length} t={t} />}
        />
      ) : (
        <EmptyState frame="bare" title={t('No opportunity matches this search.', 'Nenhuma oportunidade corresponde a esta busca.')} />
      )}
    </DataTableScreen>
  );
}

/** Opportunities while the report loads: the three metric cards, the toolbar with its search and the table, as they arrive. */
export function OpportunitiesSkeleton() {
  const l = useCopy();
  const label = l('Loading opportunities…', 'Carregando oportunidades…');
  return (
    <DataTableScreen cards={<MetricGridSkeleton count={3} label={label} />}>
      <DataTableToolbar label={label}>
        <Skeleton className="h-(--control-height) w-64 max-w-full" />
      </DataTableToolbar>
      <DataTable fill singleLine compact loading ariaLabel={label} rows={[]} rowKey={String} columns={skeletonColumns(7)} />
    </DataTableScreen>
  );
}

/** The address of a screen with one more parameter: Contents with a brief (`new`), an opportunity's page (`opportunity`). */
function hrefWith(link: Linker, tab: DrillTarget['tab'], key: string, value: string) {
  const [path, query] = link({ tab }).href.split('?');
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${path}?${params}`;
}

/** An opportunity on its own page: what it is, the figures behind it and the way to act on it. */
export function OpportunityPage({ row, number, t, link, onBack }: { row: OpportunityRow | undefined; number: Intl.NumberFormat; t: Translate; link: Linker; onBack: () => void }) {
  const brief = row ? contentBrief(row, t, (engine) => ENGINE_LABELS[engine]) : '';
  return (
    <DetailPage>
      <DetailHeader
        leading={
          <>
            <SidebarTrigger className="md:hidden" aria-label={t('Toggle navigation', 'Alternar navegação')} />
            <Hint text={t('Back to the opportunities', 'Voltar às oportunidades')}>
              <Button variant="ghost" size="icon" aria-label={t('Back to the opportunities', 'Voltar às oportunidades')} onClick={onBack}>
                <ArrowLeft />
              </Button>
            </Hint>
          </>
        }
        title={<h1>{row?.intent.name ?? t('Opportunity', 'Oportunidade')}</h1>}
        meta={row?.intent.description || undefined}
        actions={
          row && (
            <Button nativeButton={false} render={<a href={hrefWith(link, 'contents', 'new', brief)} aria-label={t(`Create content for ${row.intent.name}`, `Criar conteúdo para ${row.intent.name}`)} />}>
              {t('Create content', 'Criar conteúdo')}
            </Button>
          )
        }
      />
      <DetailBody wide>
        {!row ? (
          <EmptyState
            title={t('This opportunity is not in this period', 'Esta oportunidade não está neste período')}
            description={t(
              'Its AIs may now name your brand, or the period or filters changed. Go back to see the opportunities of this period.',
              'As IAs podem já citar sua marca, ou o período e os filtros mudaram. Volte para ver as oportunidades deste período.',
            )}
            action={<Button variant="outline" onClick={onBack}>{t('Back to the opportunities', 'Voltar às oportunidades')}</Button>}
          />
        ) : (
          <OpportunityDetail row={row} number={number} t={t} link={link} />
        )}
      </DetailBody>
    </DetailPage>
  );
}

function OpportunityDetail({ row, number, t, link }: { row: OpportunityRow; number: Intl.NumberFormat; t: Translate; link: Linker }) {
  return (
    <div className="flex flex-col gap-4">
      {row.intent.entities.length > 0 && <EntityBadges entities={row.intent.entities} t={t} />}
      <MetricGrid columns={4} mobilePairs label={t('Opportunity figures', 'Números da oportunidade')}>
        <MetricCard
          label={t('Without you', 'Sem você')}
          definition={t('Answers to the prompts behind this intent that name a competitor but not your brand, of all their answers.', 'Respostas aos prompts por trás desta intenção que citam um concorrente e não a sua marca, do total das respostas.')}
          value={`${number.format(row.gapAnswers)} ${t('of', 'de')} ${number.format(row.answers)}`}
        />
        <MetricCard
          label={t('AIs without you', 'IAs sem você')}
          definition={t('AIs that answer these prompts without ever naming your brand while they name competitors.', 'IAs que respondem a esses prompts sem nunca citar sua marca enquanto citam concorrentes.')}
          value={<span className="flex items-center gap-2">{number.format(row.missing.length)}<CompactEngineIcons engines={row.missing} /></span>}
        />
        <MetricCard label={t('Prompts', 'Prompts')} definition={t('Prompts whose answers fall in this intent.', 'Prompts cujas respostas caem nesta intenção.')} value={number.format(row.promptCount)} />
        <MetricCard label={t('Searches', 'Buscas')} definition={t('Distinct searches the AIs ran in this intent.', 'Buscas distintas que as IAs fizeram nesta intenção.')} value={number.format(row.queryCount)} />
      </MetricGrid>
      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title={t('AIs in these answers', 'IAs nestas respostas')}>
          <DataTable
            singleLine
            compact
            rows={row.engines}
            rowKey={(item) => item.engine}
            columns={[
              {
                key: 'ai',
                header: t('AI', 'IA'),
                mobile: 'title',
                cell: (item) => (
                  <span className="flex items-center gap-2">
                    <EngineIcon engine={item.engine} />
                    {ENGINE_LABELS[item.engine]}
                  </span>
                ),
              },
              { key: 'answers', header: t('Answers', 'Respostas'), label: t('Answers', 'Respostas'), align: 'end', cell: (item) => number.format(item.answers) },
              { key: 'mentioned', header: t('With you', 'Com você'), label: t('With you', 'Com você'), align: 'end', cell: (item) => number.format(item.mentioned) },
              { key: 'gap', header: t('Only competitors', 'Só concorrentes'), label: t('Only competitors', 'Só concorrentes'), align: 'end', cell: (item) => number.format(item.gap) },
            ]}
          />
        </SectionCard>
        <SectionCard
          title={t('Searches in this intent', 'Buscas nesta intenção')}
          info={row.queryCount > row.queries.length ? t(`The ${row.queries.length} most frequent of ${number.format(row.queryCount)}`, `As ${row.queries.length} mais frequentes de ${number.format(row.queryCount)}`) : undefined}
         
        >
          <DataTable
            singleLine
            compact
            rows={row.queries}
            rowKey={(query) => query.key}
            rowLink={(query) => link({ tab: 'fanout', fanoutQuery: query.key })}
            columns={[
              { key: 'query', header: t('Query', 'Query'), mobile: 'title', shrinkTo: '12rem', width: '28rem', cell: (query) => query.text },
              { key: 'occurrences', header: t('Occurrences', 'Ocorrências'), label: t('Occurrences', 'Ocorrências'), align: 'end', cell: (query) => number.format(query.occurrences) },
            ]}
          />
        </SectionCard>
        <SectionCard
          title={t('Prompts without you', 'Prompts sem você')}
          info={t('The prompts whose answers skip your brand most here; each opens its answers without you in Responses.', 'Os prompts cujas respostas mais deixam sua marca de fora aqui; cada um abre suas respostas sem você em Respostas.')}
         
        >
          <DataTable
            singleLine
            compact
            rows={row.prompts}
            rowKey={(prompt) => prompt.id}
            rowLink={(prompt) => link({ tab: 'responses', prompt: prompt.id, mention: 'missing', brand: null, brandLabel: null, sentiment: null, cites: null, run: null })}
            columns={[
              { key: 'prompt', header: t('Prompt', 'Prompt'), mobile: 'title', shrinkTo: '12rem', width: '28rem', cell: (prompt) => prompt.text || t('Prompt', 'Prompt') },
              { key: 'gap', header: t('Only competitors', 'Só concorrentes'), label: t('Only competitors', 'Só concorrentes'), align: 'end', cell: (prompt) => number.format(prompt.gap) },
            ]}
          />
        </SectionCard>
        <SectionCard title={t('Competitors and sources there', 'Concorrentes e fontes ali')}>
          <DataTable
            singleLine
            compact
            rows={row.competitors}
            rowKey={(brand) => brand.name}
            rowLink={(brand) => link({ tab: 'competitors', brandPage: brandKey(brand.name) })}
            columns={[
              { key: 'brand', header: t('Competitor', 'Concorrente'), mobile: 'title', cell: (brand) => brand.name },
              { key: 'answers', header: t('Answers without you', 'Respostas sem você'), label: t('Answers without you', 'Respostas sem você'), align: 'end', cell: (brand) => number.format(brand.answers) },
            ]}
          />
          {row.sources.length > 0 ? (
            <DataTable
              singleLine
              compact
              rows={row.sources}
              rowKey={(source) => source.domain}
              rowLink={(source) => link({ tab: 'sources', entity: { kind: 'domain', key: source.domain } })}
              columns={[
                {
                  key: 'domain',
                  header: t('Cited source', 'Fonte citada'),
                  mobile: 'title',
                  cell: (source) => <BrandName name={source.domain} domain={source.domain} own={false} />,
                },
                { key: 'count', header: t('Answers', 'Respostas'), label: t('Answers', 'Respostas'), align: 'end', cell: (source) => number.format(source.count) },
              ]}
            />
          ) : (
            <Note>{t('The newest of these answers cite no source.', 'As respostas mais recentes destas não citam fontes.')}</Note>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
