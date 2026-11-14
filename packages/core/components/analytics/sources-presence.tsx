'use client';
import type { ReactNode } from 'react';
import { Award, Maximize2, ShieldCheck } from 'lucide-react';
import { formatNumber } from '@/lib/number-format';
import { Hint } from '@/components/ui/tooltip';
// Promoted from the approved composition; the server supplies period-wide leaders.
import { DataTable, DataTableScreen, type DataColumn, type DataSort } from '@/components/lastfind/presentation/data-table';
import {
  MetricCard,
  MetricGrid,
} from '@/components/lastfind/presentation/metric-card';
import { visibleColumns } from '@/hooks/use-table-columns';
import type { SourcesPage, SourceRow } from '@/lib/report-types';
import { DrillLink, type Linker } from './drill-link';
import { CompactEngineIcons } from '@/components/lastfind/identity-icons';
import { Change, FilterSelect, SiteFavicon, useComparison, WithChange } from './shared';
import { UrlCell } from './url-cell';
import {
  OwnerBadge,
  sourceTypeLabel,
  unknownDomainLabel,
} from './source-types-ui';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { ENGINE_LABELS } from '@/lib/engines';

type Translate = (en: string, pt: string) => string;
type Group = 'domain' | 'url';
/** The Sources list's evidence filter (`kind` in the address): every source (cited or consulted), the cited ones, the consulted ones. */
export type SourceCitation = 'all' | 'cited' | 'consulted';
type Kind = SourceCitation;
/** Absent or unknown is All; an old `kind=uncited` link (consulted, never cited) opens on the consulted ones. */
export const sourceCitationFrom = (value: string | null | undefined): SourceCitation =>
  value === 'cited' || value === 'consulted' ? value : value === 'uncited' ? 'consulted' : 'all';

export const MENTION_DEFINITION: [string, string] = ['Mention: the brand’s name appears in the answer text.', 'Menção: o nome da marca aparece no texto da resposta.'];
export const CITATION_DEFINITION: [string, string] = ['Citation: the answer lists the URL as a source.', 'Citação: a resposta lista a URL como fonte.'];
const CONSULTED_DEFINITION: [string, string] = [
  'Consulted: the AI read the URL while preparing the answer without citing it; only some models report it.',
  'Consultada: a IA leu a URL ao montar a resposta sem citá-la; só alguns modelos informam.',
];
/** What the Sources list counts under each filter: the heading's help and the presence column's definition. */
export function sourcesDefinition(kind: SourceCitation, t: Translate) {
  const presence =
    kind === 'cited'
      ? t('Citations: each question × model counts once, weighted by the fraction of its collections whose answer cited the source.', 'Citações: cada pergunta × modelo conta uma vez, ponderada pela fração das coletas cuja resposta citou a fonte.')
      : kind === 'consulted'
      ? t('Sources the AIs consulted in the period, cited or not. Presence: each question × model counts once, weighted by the fraction of its collections that consulted the source; only models that report consultations count.', 'Fontes que as IAs consultaram no período, citadas ou não. Presença: cada pergunta × modelo conta uma vez, ponderada pela fração das coletas que consultaram a fonte; só contam os modelos que informam consultas.')
      : t('Every source the answers cited or consulted. Presence: each question × model counts once, weighted by the fraction of its collections whose answer cited or consulted the source.', 'Toda fonte que as respostas citaram ou consultaram. Presença: cada pergunta × modelo conta uma vez, ponderada pela fração das coletas cuja resposta citou ou consultou a fonte.');
  return [t(...CITATION_DEFINITION), kind === 'cited' ? '' : t(...CONSULTED_DEFINITION), presence].filter(Boolean).join(' ');
}
/** The evidence filter of the Sources toolbar: every source (the default), only the cited ones, only the consulted ones. */
export function SourceCitationFilter({ value, onChange, t }: { value: SourceCitation; onChange: (value: SourceCitation) => void; t: Translate }) {
  return (
    <FilterSelect
      multiple={false}
      label={t('Evidence', 'Evidência')}
      value={value}
      onChange={(next) => onChange(sourceCitationFrom(next))}
      options={[
        { value: 'all', label: t('All sources', 'Todas as fontes') },
        { value: 'cited', label: t('Cited', 'Citadas') },
        { value: 'consulted', label: t('Consulted', 'Consultadas') },
      ]}
    />
  );
}
/** What the answers did with a source: cited it, consulted it, or both. Nothing known (an older read) is a dash. */
export function SourceEvidence({ cited, consulted, t }: { cited?: boolean; consulted?: boolean; t: Translate }) {
  if (!cited && !consulted) return <span aria-label={t('Not reported', 'Não informado')}>—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {cited && <TagBadge tone="primary">{t('Cited', 'Citada')}</TagBadge>}
      {consulted && <TagBadge tone="neutral">{t('Consulted', 'Consultada')}</TagBadge>}
    </span>
  );
}
export const EVIDENCE_DEFINITION: [string, string] = [
  'Cited: the answer lists it as a source. Consulted: the AI read it while preparing the answer. Only some models report consultations, so a source without the Consulted mark may still have been read.',
  'Citada: a resposta a lista como fonte. Consultada: a IA a leu ao montar a resposta. Só alguns modelos informam consultas, então uma fonte sem a marca Consultada ainda pode ter sido lida.',
];

/** Rows per page of the server-paged source list. */
export const SOURCE_PAGE_SIZE = 50;

// The server orders every page by presence, largest to smallest over the whole analysed period
// (product rule), and sends the leaders of that period; nothing here depends on the page.
export const presencePercent = (value: number, locale: string) =>
  `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value)}%`;
/**
 * What a presence figure is: an average over the question × model combinations (each weighted by the share of its
 * collections with the source), never a count of them. Its base goes under the figure; the combinations it appears in
 * at least once are another quantity, said in words in the balloon so no fraction under the percentage reads as its base.
 */
export const presenceBase = (slots: number, t: Translate, locale: string) =>
  t(`average over ${formatNumber(locale, slots)} question × model combinations`, `média de ${formatNumber(locale, slots)} combinações pergunta × modelo`);
export const presenceReach = (presence: { slots: number }, total: number, t: Translate, locale: string) =>
  t(
    `It appears at least once in ${formatNumber(locale, presence.slots)} of the ${formatNumber(locale, total)} combinations.`,
    `Aparece ao menos uma vez em ${formatNumber(locale, presence.slots)} das ${formatNumber(locale, total)} combinações.`,
  );

// The page's one list: the leaders' metric cards (when there are any) above the table screen that
// holds the table and its own filter toolbar (`children`), so filtering to nothing keeps the filters.
export function SourcesPresence({
  sources,
  kind,
  locale,
  t,
  group,
  busy,
  loadingCards,
  children,
}: {
  sources?: SourcesPage | null;
  kind: Kind;
  locale: string;
  t: Translate;
  group: Group;
  busy?: boolean;
  /** Placeholder cards while the first page loads, so the table does not drop when the cards arrive. */
  loadingCards?: ReactNode;
  children: ReactNode;
}) {
  const number = (value: number) => formatNumber(locale, value);
  const totals = sources?.totals;
  const rows = sources?.leaders?.ranking;
  const wide = sources?.leaders?.widest;
  if (!totals || !rows?.length || !wide) return <DataTableScreen busy={busy} cards={loadingCards}>{children}</DataTableScreen>;
  const label = (row: SourceRow) =>
    row.title || row.domain || unknownDomainLabel(t);
  // Portuguese agrees in gender: "domínio ... citado", "página ... citada".
  const noun = group === 'domain' ? ['domain', 'Domínio'] : ['page', 'Página'];
  // What happens to a source in this list: cited, consulted, or either.
  const verb = kind === 'cited' ? ['is cited', 'é citada'] : kind === 'consulted' ? ['is consulted', 'é consultada'] : ['appears', 'aparece'];
  const male = group === 'domain';
  const stability = stabilityMetric(rows[0].presence, t, locale, label(rows[0]));
  const cards = (
      <MetricGrid columns={3} mobilePairs label={t('Source presence', 'Presença das fontes')}>
        <MetricCard
          icon={<Award size={14} aria-hidden="true" />}
          label={
            kind === 'cited'
              ? t(`Most cited ${noun[0]}`, `${noun[1]} mais ${male ? 'citado' : 'citada'}`)
              : kind === 'consulted'
              ? t(`Most consulted ${noun[0]}`, `${noun[1]} mais ${male ? 'consultado' : 'consultada'}`)
              : t(`Most present ${noun[0]}`, `${noun[1]} mais presente`)
          }
          value={presencePercent(rows[0].presence!.presence, locale)}
          definition={`${sourcesDefinition(kind, t)} ${presenceReach(rows[0].presence!, totals.slots, t, locale)}`}
          description={`${label(rows[0])}, ${presenceBase(totals.slots, t, locale)}`}
        />
        <MetricCard
          icon={<Maximize2 size={14} aria-hidden="true" />}
          label={t('Widest reach', 'Maior alcance')}
          value={`${number(wide.presence!.questions)} / ${number(totals.questions)}`}
          definition={t(
            `Questions where the widest source ${verb[0]} at least once.`,
            `Perguntas em que a fonte de maior alcance ${verb[1]} ao menos uma vez.`,
          )}
          description={t(
            `questions where ${label(wide)} ${verb[0]}`,
            `perguntas em que ${label(wide)} ${verb[1]}`,
          )}
        />
        <MetricCard
          icon={<ShieldCheck size={14} aria-hidden="true" />}
          label={t('Leading source stability', 'Estabilidade da líder')}
          value={stability.value}
          definition={stability.definition}
          description={stability.description}
        />
      </MetricGrid>
  );
  return <DataTableScreen cards={cards} busy={busy}>{children}</DataTableScreen>;
}

export function SourcesPresenceTable({
  sources,
  group,
  kind,
  page,
  sort,
  onSortChange,
  locale,
  t,
  link,
  hiddenColumns = [],
  summaryAside,
}: {
  sources: SourcesPage;
  group: Group;
  kind: Kind;
  page: number;
  sort?: DataSort;
  onSortChange: (sort: DataSort) => void;
  locale: string;
  t: Translate;
  link: Linker;
  hiddenColumns?: string[];
  /** Compact pager for the Summary row. */
  summaryAside?: ReactNode;
}) {
  const number = (value: number) => formatNumber(locale, value);
  const compared = useComparison(t);
  const totalQuestions = sources.totals?.questions ?? 0;
  // One name for the metric on every screen; the evidence filter (and the balloon) says what counts.
  const presenceHead = t('Presence', 'Presença');
  const totals = sources.totals;
  const presenceInfo = [
    sourcesDefinition(kind, t),
    totals &&
      t(
        `Base: ${number(totals.slots)} ${totals.slots === 1 ? 'combination' : 'combinations'}, ${number(totals.questions)} ${totals.questions === 1 ? 'question' : 'questions'}, ${number(totals.models)} ${totals.models === 1 ? 'model' : 'models'}.`,
        `Base: ${number(totals.slots)} ${totals.slots === 1 ? 'combinação' : 'combinações'}, ${number(totals.questions)} ${totals.questions === 1 ? 'pergunta' : 'perguntas'}, ${number(totals.models)} ${totals.models === 1 ? 'modelo' : 'modelos'}.`,
      ),
    !compared.off &&
      t(
        `Beside it, the change in percentage points against ${compared.period}; none when that period has no answers.`,
        `Ao lado, a variação em pontos percentuais ante o ${compared.period}; nenhuma quando esse período não tem respostas.`,
      ),
  ]
    .filter(Boolean)
    .join(' ');
  const allColumns: DataColumn<SourceRow>[] = [
          {
            key: 'rank',
            header: '#',
            width: 44,
            align: 'center',
            mobile: 'hide',
            cell: (_row, index) => (page - 1) * SOURCE_PAGE_SIZE + index + 1,
          },
          {
            key: 'source',
            sortValue: (source) => source.key,
            header: group === 'domain' ? t('Domain', 'Domínio') : 'URL',
            mobile: 'title',
            cell: (source) => {
              return (
                <div className="st-name-line">
                  {group === 'url' ? (
                    <UrlCell link={link} url={source.key} title={source.title} domain={source.domain} t={t} kind={source.cited === false ? 'consulted' : undefined} />
                  ) : (
                    <DrillLink
                      link={link}
                      // A source never cited opens on its consultations.
                      to={{ tab: 'sources', entity: { kind: 'domain', key: source.key }, ...(source.cited === false ? { kind: 'consulted' as const } : {}) }}
                      className="flex min-w-0 items-center gap-2"
                      disabled={!source.key}
                    >
                      {source.domain && <SiteFavicon domain={source.domain} name={source.domain} />}
                      <span className="truncate">{source.title || source.domain || unknownDomainLabel(t)}</span>
                    </DrillLink>
                  )}
                  <OwnerBadge owner={source.ownership} t={t} />
                </div>
              );
            },
          },
          {
            key: 'evidence',
            width: 150,
            sortValue: (source) => (source.cited ? 2 : 0) + (source.consulted ? 1 : 0),
            header: t('Evidence', 'Evidência'),
            info: t(...EVIDENCE_DEFINITION),
            label: t('Evidence', 'Evidência'),
            cell: (source) => <SourceEvidence cited={source.cited} consulted={source.consulted} t={t} />,
          },
          {
            key: 'type',
            width: 150,
            sortValue: (source) => sourceTypeLabel(source.sourceType, t),
            header:
              group === 'domain'
                ? t('Site type', 'Tipo de site')
                : t('Content type', 'Tipo de conteúdo'),
            label: t('Type', 'Tipo'),
            cell: (source) => {
              const label = sourceTypeLabel(source.sourceType, t);
              return (
                <span className="truncate">
                  {label}
                </span>
              );
            },
          },
          {
            key: 'presence',
            width: 152,
            sortValue: (source) => source.presence?.presence,
            header: presenceHead,
            info: presenceInfo,
            label: presenceHead,
            align: 'end',
            cell: (source) => {
              // The change against the comparison period: none when that period had no answers (never a 0 made up).
              const change = source.presence && source.previousPresence != null && !compared.off
                ? <Change value={source.presence.presence - source.previousPresence} locale={locale} margin={0} /> : null;
              const figure = source.presence ? presencePercent(source.presence.presence, locale) : '—';
              const detail = kind === 'cited'
                ? t(`${number(source.responses)} responses cite it; ${number(source.citations)} citations`, `${number(source.responses)} respostas a citam; ${number(source.citations)} citações`)
                : kind === 'consulted'
                ? t(`${number(source.responses)} responses consulted it`, `${number(source.responses)} respostas a consultaram`)
                : t(`${number(source.responses)} responses cite or consult it; ${number(source.citations)} citations`, `${number(source.responses)} respostas a citam ou consultam; ${number(source.citations)} citações`);
              // Drill down: a cited source's figure opens the monitored answers that cite it. Responses has citations only
              // and no Semantic Branding answers: with every origin, only a source the prompts' answers cite (it has a visibility).
              if (source.presence && source.key && kind !== 'consulted' && source.cited !== false && (sources.origin === 'prompts' || source.visibility != null))
                return (
                  <WithChange change={change}>
                    <DrillLink
                      link={link}
                      to={{ tab: 'responses', cites: source.key, brand: null, brandLabel: null, sentiment: null, mention: 'all', run: null, prompt: null }}
                      className={`${change ? 'min-w-0' : 'w-full'} truncate text-right`}
                      title={detail}
                      aria-label={`${presenceHead} ${figure}. ${t('Open the answers that cite it', 'Abrir as respostas que a citam')}`}
                    >
                      {figure}
                    </DrillLink>
                  </WithChange>
                );
              return (
                <WithChange change={change}>
                  <Hint text={detail}>
                    <button
                      type="button"
                      className={`${change ? 'min-w-0' : 'w-full'} truncate text-right`}
                      aria-label={
                        source.presence
                          ? `${presenceHead} ${figure}, ${presenceBase(sources.totals?.slots ?? 0, t, locale)}. ${presenceReach(source.presence, sources.totals?.slots ?? 0, t, locale)}`
                          : '—'
                      }
                    >
                      {figure}
                    </button>
                  </Hint>
                </WithChange>
              );
            },
          },
          ...(sources.origin === 'semantic-branding' ? [{
            key: 'average-score',
            width: 100,
            sortValue: (source: SourceRow) => source.averageScore,
            header: t('Avg. score', 'Nota média'),
            label: t('Average score', 'Nota média'),
            title: t('Average score of citing responses', 'Nota média das respostas que citam esta fonte'),
            align: 'end' as const,
            cell: (source: SourceRow) => source.averageScore == null ? (
              <Hint text={t('No score available for the responses citing this source. This is not zero.', 'Não há nota disponível nas respostas que citam esta fonte. Isso não é zero.')}>
                <button type="button" className="text-right">—</button>
              </Hint>
            ) : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(source.averageScore),
          }] : []),
          {
            key: 'questions',
            width: 100,
            sortValue: (source) => source.presence?.questions,
            header: t('Reach', 'Alcance'),
            label: t('Questions', 'Perguntas'),
            align: 'end',
            cell: (source) =>
              source.presence
                ? `${number(source.presence.questions)} / ${number(totalQuestions)}`
                : '—',
          },
          {
            key: 'stability',
            width: 128,
            sortValue: (source) => source.presence?.steady,
            header: t('Stability', 'Estabilidade'),
            info: t(...STABILITY_DEFINITION),
            label: t('Stability', 'Estabilidade'),
            align: 'end',
            cell: (source) => (
              <PresenceStability
                presence={source.presence}
                t={t}
                locale={locale}
              />
            ),
          },
          {
            key: 'models',
            sortValue: (source) => source.engines.map((engine) => ENGINE_LABELS[engine]).join(' '),
            header: t('Models', 'Modelos'),
            label: t('Models', 'Modelos'),
            width: 140,
            mobile: 'wide',
            cell: (source) => <CompactEngineIcons engines={source.engines} />,
          },
        ];
  // Without a total (the list is paged on the server) the label counts only when everything fit on the first page.
  const summaryCount = !sources.hasMore && page === 1 ? number(sources.rows.length) : null;
  return (
    <DataTable
      fill
      singleLine
      minWidth={1180}
      className="table-fixed"
      stackColumns={2}
      rows={sources.rows}
      rowKey={(source) => source.key}
      sort={sort}
      onSortChange={onSortChange}
      columns={visibleColumns(allColumns, hiddenColumns, ['source'])}
      summary={{ source: summaryCount ? t(`Summary (${summaryCount})`, `Resumo (${summaryCount})`) : t('Summary', 'Resumo') }}
      summaryAside={summaryAside}
    />
  );
}

export const SOURCE_PICKER_COLUMNS = (
  group: Group,
  t: Translate,
  /** Only when the table actually shows the score column (Semantic Branding). */
  showAverageScore = false,
) => [
  { key: 'rank', label: '#' },
  { key: 'source', label: group === 'domain' ? t('Domain', 'Domínio') : 'URL' },
  { key: 'evidence', label: t('Evidence', 'Evidência') },
  { key: 'type', label: group === 'domain' ? t('Site type', 'Tipo de site') : t('Content type', 'Tipo de conteúdo') },
  { key: 'presence', label: t('Presence', 'Presença') },
  ...(showAverageScore ? [{ key: 'average-score', label: t('Avg. score', 'Nota média') }] : []),
  { key: 'questions', label: t('Reach', 'Alcance') },
  { key: 'stability', label: t('Stability', 'Estabilidade') },
  { key: 'models', label: t('Models', 'Modelos') },
];

const STABILITY_DEFINITION: [string, string] = [
  'Of the question × model combinations where the source appears and that have at least two collections, how many have it in every collection.',
  'Das combinações pergunta × modelo em que a fonte aparece e que têm ao menos duas coletas, quantas a têm em toda coleta.',
];

/**
 * Stability as a metric card: the combinations with the source in every collection over the combinations measured
 * (at least two collections), its unit under it, and the whole breakdown, which adds up, in the balloon.
 */
export function stabilityMetric(p: SourceRow['presence'] | null | undefined, t: Translate, locale: string, source?: string) {
  const n = (value: number) => formatNumber(locale, value);
  if (!p || p.single === p.slots)
    return {
      value: '—',
      description: t('Not yet measured', 'Ainda não medida'),
      definition: t('Stability needs at least two collections per question × model combination.', 'A estabilidade precisa de ao menos duas coletas por combinação pergunta × modelo.'),
    };
  return {
    value: `${n(p.steady)} / ${n(p.slots - p.single)}`,
    description: source
      ? t(`combinations with ${source} in every collection`, `combinações com ${source} em toda coleta`)
      : t('combinations with it in every collection', 'combinações com a fonte em toda coleta'),
    definition: `${t(...STABILITY_DEFINITION)} ${stabilityBreakdown(p, t, locale)}`,
  };
}

/** The measured combinations split three ways (every collection, some, only one), plus the ones not measured yet. */
function stabilityBreakdown(p: NonNullable<SourceRow['presence']>, t: Translate, locale: string) {
  const n = (value: number) => formatNumber(locale, value);
  const measured = p.slots - p.single;
  const some = measured - p.steady - p.once;
  return t(
    `Of ${n(measured)} measured: ${n(p.steady)} in every collection, ${n(some)} in some, ${n(p.once)} in only one.${p.single ? ` ${n(p.single)} more have a single collection and are not measured yet.` : ''}`,
    `Das ${n(measured)} medidas: ${n(p.steady)} em toda coleta, ${n(some)} em algumas, ${n(p.once)} em só uma.${p.single ? ` Outras ${n(p.single)} têm uma só coleta e ainda não são medidas.` : ''}`,
  );
}

/** The Stability cell of the Sources table: combinations in every collection over those measured, the breakdown in its balloon. */
export function PresenceStability({
  presence: p,
  t,
  locale,
}: {
  presence?: SourceRow['presence'] | null;
  t: Translate;
  locale: string;
}) {
  const { value, definition } = stabilityMetric(p, t, locale);
  const text = p && p.single < p.slots ? stabilityBreakdown(p, t, locale) : definition;
  return (
    <Hint text={text}>
      <button type="button" className="w-full text-right" aria-label={`${value}. ${text}`}>
        {value}
      </button>
    </Hint>
  );
}
