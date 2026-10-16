'use client';
import { useCollectionPage } from './shared';

import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Link2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useI18n } from '@/lib/i18n';
import {
  brandMetrics,
  demoBrands,
  demoModels,
  demoSources,
  type DemoPrompt,
  type DemoResponse,
} from './demo-data';
import {
  CollectionToolbar,
  EmptyState,
  FilterSelect,
  ModelMark,
  PanelHeading,
  SearchField,
  SiteFavicon,
  useCopy,
  useNumbers,
} from './shared';

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{note}</p>
    </div>
  );
}

export function SourcesView({
  responses,
  selectedDomain: controlledDomain,
  onSelectedDomainChange,
}: {
  responses: DemoResponse[];
  selectedDomain?: string | null;
  onSelectedDomainChange?: (domain: string | null) => void;
}) {
  const copy = useCopy();
  const { number: count, percent, locale } = useNumbers();
  const [tab, setTab] = useState('domains');
  const [search, setSearch] = useState('');
  const [localDomain, setLocalDomain] = useState<string | null>(null);
  const selectedDomain =
    controlledDomain === undefined ? localDomain : controlledDomain;
  const setSelectedDomain = onSelectedDomainChange ?? setLocalDomain;
  const knownConsulted = responses.filter(
    (response) => response.consultedSourceIds !== null,
  ).length;
  const citedResponses = responses.filter(
    (response) => response.sourceIds.length > 0,
  ).length;
  const availableSources = useMemo(
    () =>
      demoSources
        .map((source) => {
          const cited = responses.filter((response) =>
            response.sourceIds.includes(source.id),
          ).length;
          const consulted = responses.filter((response) =>
            response.consultedSourceIds?.includes(source.id),
          ).length;
          return {
            ...source,
            cited,
            consulted,
            rate: responses.length ? (cited / responses.length) * 100 : 0,
          };
        })
        .filter((source) => source.cited > 0 || source.consulted > 0)
        .sort((a, b) => b.cited - a.cited),
    [responses],
  );
  const domains = useMemo(
    () =>
      Array.from(new Set(availableSources.map((source) => source.domain)))
        .map((domain) => {
          const sources = availableSources.filter(
            (source) => source.domain === domain,
          );
          const ids = new Set(sources.map((source) => source.id));
          const cited = responses.filter((response) =>
            response.sourceIds.some((id) => ids.has(id)),
          ).length;
          const consulted = responses.filter((response) =>
            response.consultedSourceIds?.some((id) => ids.has(id)),
          ).length;
          return {
            ...sources[0],
            id: domain,
            sources,
            cited,
            consulted,
            rate: responses.length ? (cited / responses.length) * 100 : 0,
          };
        })
        .sort((a, b) => b.cited - a.cited),
    [availableSources, responses],
  );
  const query = search.trim().toLocaleLowerCase(locale);
  const filteredRows = (tab === 'domains' ? domains : availableSources).filter(
    (source) =>
      `${source.domain} ${source.url} ${source.title}`
        .toLocaleLowerCase(locale)
        .includes(query),
  );
  const sourcePage = useCollectionPage(
    filteredRows,
    `${tab}|${search}|${JSON.stringify(responses.map((item) => item.id))}`,
  );
  const rows = sourcePage.rows;
  const selectedSources = availableSources.filter(
    (source) => source.domain === selectedDomain,
  );

  const evidencePage = useCollectionPage(selectedSources, selectedDomain ?? '');

  return (
    <div className="space-y-5">
      <div className="analytics-panel grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Metric
          label={copy('Cited domains', 'Domínios citados')}
          value={count(domains.filter((domain) => domain.cited > 0).length)}
          note={copy(
            'Unique domains in citations',
            'Domínios únicos nas citações',
          )}
        />
        <Metric
          label={copy('Cited URLs', 'URLs citadas')}
          value={count(
            availableSources.filter((source) => source.cited > 0).length,
          )}
          note={copy(
            'Pages referenced in responses',
            'Páginas referenciadas nas respostas',
          )}
        />
        <Metric
          label={copy('Responses with citations', 'Respostas com citações')}
          value={count(citedResponses)}
          note={copy(
            `Of ${count(responses.length)} sample responses`,
            `De ${count(responses.length)} respostas de exemplo`,
          )}
        />
      </div>
      <section className="analytics-panel collection-panel overflow-hidden">
        <PanelHeading
          title={copy('Sources used by AI', 'Fontes utilizadas pelas IAs')}
          description={copy(
            'See which websites shape answers in your category.',
            'Veja quais sites influenciam as respostas na sua categoria.',
          )}
        />
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(String(value))}
          className="gap-0"
        >
          <CollectionToolbar>
            <TabsList variant="line" className="h-10 gap-5">
              <TabsTrigger value="domains" className="px-0 text-sm">
                <Globe2 size={14} />
                {copy('Domains', 'Domínios')}
                <span className="ml-1 text-sm text-muted-foreground">
                  {count(domains.length)}
                </span>
              </TabsTrigger>
              <TabsTrigger value="urls" className="px-0 text-sm">
                <Link2 size={14} />
                URLs
                <span className="ml-1 text-sm text-muted-foreground">
                  {count(availableSources.length)}
                </span>
              </TabsTrigger>
            </TabsList>
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder={copy('Search sources...', 'Buscar fontes...')}
            />
          </CollectionToolbar>
          {['domains', 'urls'].map((value) => (
            <TabsContent key={value} value={value}>
              {rows.length ? (
                <div>
                  <Table className="analytics-table min-w-[660px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>
                          {value === 'domains'
                            ? copy('Domain', 'Domínio')
                            : 'URL'}
                        </TableHead>
                        <TableHead className="text-right">
                          <span className="inline-flex items-center gap-1">
                            {copy('Cited responses', 'Respostas com citação')}
                            <ArrowDown size={12} />
                          </span>
                        </TableHead>
                        <TableHead className="text-right">
                          {copy('Citation rate', 'Taxa de citação')}
                        </TableHead>
                        <TableHead className="text-right">
                          {copy(
                            'Consulted responses',
                            'Respostas com consulta',
                          )}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((source, index) => (
                        <TableRow key={source.id}>
                          <TableCell className="text-muted-foreground">
                            {count(index + 1)}
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              aria-label={copy(
                                `View sources for ${source.domain}`,
                                `Ver fontes de ${source.domain}`,
                              )}
                              onClick={() => setSelectedDomain(source.domain)}
                              className="group flex items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <SiteFavicon
                                domain={source.domain}
                                name={source.title}
                                className="size-7"
                              />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="max-w-72 truncate font-medium group-hover:text-primary">
                                  {value === 'domains'
                                    ? source.domain
                                    : source.url.replace(
                                        /^https?:\/\/(www\.)?/,
                                        '',
                                      )}
                                </span>
                                {value === 'urls' && (
                                  <span className="text-sm text-muted-foreground">
                                    {source.title}
                                  </span>
                                )}
                              </span>
                            </button>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {count(source.cited)}
                          </TableCell>
                          <TableCell aria-label={percent(source.rate)}>
                            <div className="flex items-center justify-end gap-2.5">
                              <span className="h-1 w-14 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full bg-primary"
                                  style={{ width: `${source.rate}%` }}
                                />
                              </span>
                              <span className="w-12 text-right tabular-nums">
                                {percent(source.rate)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {knownConsulted ? (
                              count(source.consulted)
                            ) : (
                              <span className="text-muted-foreground">
                                {copy('Not provided', 'Não informado')}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  title={copy('No sources found', 'Nenhuma fonte encontrada')}
                  description={copy(
                    'Try another search or adjust your filters.',
                    'Tente outra busca ou ajuste os filtros.',
                  )}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
        <div className="flex flex-col gap-1 border-t px-5 py-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            {copy(
              'Citation rate is the share of filtered responses citing a source. Each source is counted once per response.',
              'A taxa de citação é a proporção de respostas filtradas que citam uma fonte. Cada fonte é contada uma vez por resposta.',
            )}
          </p>
          <p>
            {knownConsulted
              ? copy(
                  `Consulted evidence is available for ${count(knownConsulted)} of ${count(responses.length)} responses. Counts use only those responses; missing evidence does not mean zero consultations.`,
                  `Há evidências de consulta em ${count(knownConsulted)} de ${count(responses.length)} respostas. As contagens usam apenas essas respostas; a ausência de evidências não significa zero consultas.`,
                )
              : copy(
                  'Consulted evidence was not provided for these responses. Cited sources and consulted sources are separate evidence.',
                  'As evidências de consulta não foram informadas nessas respostas. Fontes citadas e fontes consultadas são evidências distintas.',
                )}
          </p>
        </div>
      </section>
      <Dialog
        open={selectedDomain !== null}
        onOpenChange={(open) => !open && setSelectedDomain(null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selectedDomain}</DialogTitle>
            <DialogDescription>
              {copy(
                'Sample URLs and their evidence in the current filters.',
                'URLs de exemplo e suas evidências nos filtros atuais.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {selectedSources.length === 0 && (
              <EmptyState
                title={copy(
                  'No sources in these filters',
                  'Nenhuma fonte nestes filtros',
                )}
                description={copy(
                  'Change the period or model selection to view evidence for this domain.',
                  'Altere o período ou a seleção de modelos para ver evidências deste domínio.',
                )}
              />
            )}
            {evidencePage.rows.map((source) => (
              <div key={source.id} className="rounded-lg border p-3">
                <div className="flex items-start gap-2.5">
                  <SiteFavicon
                    domain={source.domain}
                    name={source.title}
                    className="size-7"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{source.title}</p>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-sm text-primary hover:underline"
                    >
                      {source.url}
                      <ArrowUpRight size={12} className="shrink-0" />
                    </a>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-sm text-muted-foreground">
                  <span>
                    {copy('Cited in', 'Citada em')}{' '}
                    <strong className="font-medium text-foreground">
                      {count(source.cited)}
                    </strong>{' '}
                    {copy('responses', 'respostas')}
                  </span>
                  <span>
                    {copy('Consulted in', 'Consultada em')}{' '}
                    <strong className="font-medium text-foreground">
                      {knownConsulted
                        ? count(source.consulted)
                        : copy('not provided', 'não informado')}
                    </strong>
                    {knownConsulted ? copy(' responses', ' respostas') : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {copy(
              'These are illustrative source links in a synthetic dataset. They do not represent a live crawl or a verified model response.',
              'Estes links são ilustrativos e pertencem a um conjunto de dados sintético. Eles não representam uma coleta ou uma resposta verificada de um modelo.',
            )}
          </p>
          {evidencePage.controls}
        </DialogContent>
      </Dialog>
      {sourcePage.controls}
    </div>
  );
}

export function ModelsView({
  responses,
  brandName = 'Conversion',
}: {
  responses: DemoResponse[];
  brandName?: string;
}) {
  const copy = useCopy();
  const { number, percent } = useNumbers();
  const rows = demoModels.map((model) => {
    const samples = responses.filter((response) => response.model === model);
    return {
      model,
      samples,
      ...brandMetrics(samples, 'conversion'),
      citations: samples.reduce(
        (total, response) => total + new Set(response.sourceIds).size,
        0,
      ),
      consultedEvidence: samples.filter(
        (response) => response.consultedSourceIds !== null,
      ).length,
    };
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((row) => (
          <section key={row.model} className="analytics-panel p-5">
            <div className="flex items-center justify-between gap-2 text-sm font-medium">
              <ModelMark model={row.model} />
              <span
                className={`size-1.5 rounded-full ${row.samples.length ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                aria-label={
                  row.samples.length
                    ? copy(
                        'Sample data available',
                        'Dados de exemplo disponíveis',
                      )
                    : copy('No matching data', 'Sem dados correspondentes')
                }
              />
            </div>
            <p className="mt-7 text-sm text-muted-foreground">
              {copy('Brand visibility', 'Visibilidade da marca')}
            </p>
            <div className="mt-1.5 flex items-end gap-2">
              <strong className="text-3xl font-semibold tracking-tight tabular-nums">
                {row.samples.length ? percent(row.visibility) : '—'}
              </strong>
              <span className="pb-1 text-sm text-muted-foreground">
                {brandName}
              </span>
            </div>
            <div className="mt-5 flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                {copy('Sample responses', 'Respostas de exemplo')}
              </span>
              <span className="font-medium tabular-nums">
                {number(row.samples.length)}
              </span>
            </div>
          </section>
        ))}
      </div>
      <section className="analytics-panel overflow-hidden">
        <PanelHeading
          title={copy('Compare AI models', 'Compare os modelos de IA')}
          description={copy(
            `How ${brandName} appears across the selected sample responses.`,
            `Como ${brandName} aparece nas respostas de exemplo selecionadas.`,
          )}
        />
        <div>
          <Table className="analytics-table min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>{copy('Model', 'Modelo')}</TableHead>
                <TableHead className="text-right">{copy('Responses', 'Respostas')}</TableHead>
                <TableHead className="text-right">
                  {copy('Brand mentions', 'Menções à marca')}
                </TableHead>
                <TableHead className="text-right">
                  {copy('Visibility', 'Visibilidade')}
                </TableHead>
                <TableHead className="text-right">{copy('Citations', 'Citações')}</TableHead>
                <TableHead className="text-right">
                  {copy('Consulted evidence', 'Evidência de consulta')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.model}>
                  <TableCell className="font-medium">
                    <ModelMark model={row.model} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number(row.samples.length)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number(row.mentions)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.samples.length ? percent(row.visibility) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number(row.citations)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.consultedEvidence ? (
                      <span className="text-sm tabular-nums">
                        {number(row.consultedEvidence)} /{' '}
                        {number(row.samples.length)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {copy('Not provided', 'Não informado')}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="border-t px-5 py-3 text-sm leading-relaxed text-muted-foreground">
          {copy(
            `Visibility = responses mentioning ${brandName} ÷ total responses. Citations count unique sources within each response. These model names describe the mock dataset; no provider is being queried.`,
            `Visibilidade = respostas que mencionam ${brandName} ÷ total de respostas. As citações contam fontes únicas por resposta. Os nomes dos modelos descrevem os dados mockados; nenhum provedor está sendo consultado.`,
          )}
        </p>
      </section>
      <div className="flex items-start gap-3 rounded-lg border border-primary/10 bg-primary/[0.025] px-4 py-3.5">
        <Globe2 size={16} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">
            {copy(
              'One view of your AI presence',
              'Uma visão da sua presença nas IAs',
            )}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {copy(
              'Use the filters above to compare a market, topic, or time period across models. All metrics update from the same sample evidence.',
              'Use os filtros acima para comparar um mercado, tópico ou período entre modelos. Todas as métricas usam as mesmas evidências de exemplo.',
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ChatsView({
  responses,
  prompts,
  onOpenChat,
  brandName = 'Conversion',
}: {
  responses: DemoResponse[];
  prompts: DemoPrompt[];
  onOpenChat: (response: DemoResponse) => void;
  brandName?: string;
}) {
  const copy = useCopy();
  const { formatTime } = useI18n();
  const { number, locale } = useNumbers();
  const [search, setSearch] = useState('');
  const [mention, setMention] = useState('all');
  const [page, setPage] = useState(0);
  const pageSize = 15;
  const brandLabel = (id: string) =>
    id === 'conversion'
      ? brandName
      : (demoBrands.find((brand) => brand.id === id)?.name ?? id);
  const promptMap = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  const query = search.trim().toLocaleLowerCase(locale);
  const filtered = responses
    .filter((response) => {
      const prompt = promptMap.get(response.promptId);
      const matchesQuery =
        `${prompt?.text ?? ''} ${prompt?.topic ?? ''} ${response.model} ${response.brandIds.map(brandLabel).join(' ')}`
          .toLocaleLowerCase(locale)
          .includes(query);
      return (
        matchesQuery &&
        (mention === 'all' ||
          (mention === 'mentioned'
            ? response.brandIds.includes('conversion')
            : !response.brandIds.includes('conversion')))
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  return (
    <section className="analytics-panel collection-panel overflow-hidden">
      <PanelHeading
        title={copy('AI responses', 'Respostas das IAs')}
        description={copy(
          'Explore the conversations behind your visibility metrics.',
          'Explore as conversas por trás das métricas de visibilidade.',
        )}
      />
      <CollectionToolbar
        actions={
          <span className="text-sm text-muted-foreground">
            {number(filtered.length)} {copy('responses', 'respostas')}
          </span>
        }
      >
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          placeholder={copy(
            'Search prompts, models, or brands...',
            'Buscar prompts, modelos ou marcas...',
          )}
        />
        <FilterSelect
          label={copy('Brand mention', 'Menção à marca')}
          value={mention}
          onChange={(value) => {
            setMention(value);
            setPage(0);
          }}
          options={[
            {
              value: 'all',
              label: copy('All responses', 'Todas as respostas'),
            },
            {
              value: 'mentioned',
              label: copy(`${brandName} mentioned`, `${brandName} mencionada`),
            },
            {
              value: 'unmentioned',
              label: copy(
                `${brandName} not mentioned`,
                `${brandName} não mencionada`,
              ),
            },
          ]}
        />
      </CollectionToolbar>
      {visible.length ? (
        <div>
          <Table className="analytics-table min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[43%]">Prompt</TableHead>
                <TableHead>{copy('Model', 'Modelo')}</TableHead>
                <TableHead>{copy('Brands mentioned', 'Marcas mencionadas')}</TableHead>
                <TableHead className="text-right">{copy('Citations', 'Citações')}</TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    {copy('Date', 'Data')}
                    <ArrowDown size={12} />
                  </span>
                </TableHead>
                <TableHead>
                  <span className="sr-only">
                    {copy('Open response', 'Abrir resposta')}
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((response) => {
                const prompt = promptMap.get(response.promptId);
                const brands = response.brandIds
                  .map((id) => demoBrands.find((brand) => brand.id === id))
                  .filter((brand) => !!brand);
                return (
                  <TableRow key={response.id}>
                    <TableCell>
                      <button
                        type="button"
                        aria-label={copy(
                          `Open response: ${prompt?.text ?? response.promptId}`,
                          `Abrir resposta: ${prompt?.text ?? response.promptId}`,
                        )}
                        className="block max-w-[440px] text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onOpenChat(response)}
                      >
                        <span className="line-clamp-1 text-sm font-medium">
                          {prompt?.text ??
                            copy('Unknown prompt', 'Prompt desconhecido')}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {prompt?.topic ?? '—'}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <ModelMark model={response.model} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {brands.slice(0, 2).map((brand) => (
                          <Badge
                            key={brand.id}
                            variant="outline"
                            className={`max-w-24 truncate rounded-md px-1.5 text-sm font-normal ${brand.id === 'conversion' ? 'border-primary/15 bg-primary/5 text-primary' : ''}`}
                          >
                            {brandLabel(brand.id)}
                          </Badge>
                        ))}
                        {brands.length > 2 && (
                          <span
                            title={brands
                              .slice(2)
                              .map((brand) => brandLabel(brand.id))
                              .join(', ')}
                            className="text-sm text-muted-foreground"
                          >
                            +{number(brands.length - 2)}
                          </span>
                        )}
                        {!brands.length && (
                          <span className="text-sm text-muted-foreground">
                            {copy('None', 'Nenhuma')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number(new Set(response.sourceIds).size)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      <time dateTime={response.date}>
                        {formatTime(response.date)}
                      </time>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={copy('Open response', 'Abrir resposta')}
                        onClick={() => onOpenChat(response)}
                      >
                        <ChevronRight size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title={copy('No responses found', 'Nenhuma resposta encontrada')}
          description={copy(
            'Try a different search or change your filters.',
            'Tente outra busca ou altere os filtros.',
          )}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <span className="text-sm text-muted-foreground">
          {filtered.length
            ? `${number(currentPage * pageSize + 1)}–${number(Math.min((currentPage + 1) * pageSize, filtered.length))}`
            : '0'}{' '}
          {copy('of', 'de')} {number(filtered.length)}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {copy('Page', 'Página')} {number(currentPage + 1)}{' '}
            {copy('of', 'de')} {number(pages)}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={copy('Previous page', 'Página anterior')}
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={13} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={copy('Next page', 'Próxima página')}
            disabled={currentPage >= pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={13} />
          </Button>
        </div>
      </div>
    </section>
  );
}
