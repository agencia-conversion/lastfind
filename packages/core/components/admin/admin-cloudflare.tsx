'use client';
// Admin > Usage and costs, Cloudflare: what this Cloudflare account used this month and its estimated cost at the published
// prices (lib/cloudflare-usage.ts), read on the server and kept for an hour (lib/server/cloudflare-usage.ts). Admin only;
// the same cards and tables as the rest of the page.
import { useEffect, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { CloudflareLine, CloudflareUsage as Usage } from '@/lib/cloudflare-usage';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, DataTableToolbar, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { MetricCard, MetricGrid } from '@/components/lastfind/presentation/metric-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { EmptyState } from '@/components/analytics/shared';
import { usdFormat } from '@/components/analytics/spend-labels';

/** The server keeps Cloudflare's own error text in its log: a missing measure arrives as its id only. */
type Answer = (Omit<Usage, 'failed'> & { failed: { id: string }[] }) | { configured: false; missing: string[] };
type Copy = (en: string, pt: string) => string;
type Day = Usage['days'][number];

const PRODUCTS: Record<string, string> = { workers: 'Workers', d1: 'D1', durableObjects: 'Durable Objects', r2: 'R2' };
const METERS: Record<CloudflareLine['meter'], [string, string, string]> = {
  workersRequests: ['Requests', 'Requisições', ''],
  workersCpuMs: ['CPU time', 'Tempo de CPU', 'ms'],
  d1RowsRead: ['Rows read', 'Linhas lidas', ''],
  d1RowsWritten: ['Rows written', 'Linhas gravadas', ''],
  d1StorageGb: ['Storage', 'Armazenamento', 'GB'],
  doRequests: ['Requests', 'Requisições', ''],
  doDurationGbS: ['Duration', 'Duração', 'GB-s'],
  doRowsRead: ['SQLite rows read', 'Linhas SQLite lidas', ''],
  doRowsWritten: ['SQLite rows written', 'Linhas SQLite gravadas', ''],
  doStorageGb: ['SQLite storage', 'Armazenamento SQLite', 'GB'],
  r2ClassA: ['Class A operations', 'Operações classe A', ''],
  r2ClassB: ['Class B operations', 'Operações classe B', ''],
  r2StorageGb: ['Storage', 'Armazenamento', 'GB'],
};
const DATASET_NAMES: Record<string, [string, string]> = {
  workers: ['Workers requests and CPU', 'Requisições e CPU dos Workers'],
  d1: ['D1 rows', 'Linhas do D1'],
  d1Storage: ['D1 storage', 'Armazenamento do D1'],
  doRequests: ['Durable Objects requests', 'Requisições dos Durable Objects'],
  doDuration: ['Durable Objects duration', 'Duração dos Durable Objects'],
  doRows: ['Durable Objects SQLite rows', 'Linhas SQLite dos Durable Objects'],
  doStorage: ['Durable Objects storage', 'Armazenamento dos Durable Objects'],
  r2Operations: ['R2 operations', 'Operações do R2'],
  r2Storage: ['R2 storage', 'Armazenamento do R2'],
};

export function CloudflareUsage() {
  const { locale } = useI18n();
  const t: Copy = (en, pt) => (locale === 'pt-BR' ? pt : en);
  const usd = usdFormat(locale);
  const number = (value: number, digits = 0) => value.toLocaleString(locale, { maximumFractionDigits: digits });
  const compact = (value: number) => value.toLocaleString(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const [data, setData] = useState<Answer | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState('meter');
  useEffect(() => {
    let active = true;
    fetch('/api/admin/cloudflare')
      .then((response) => (response.ok ? (response.json() as Promise<Answer>) : Promise.reject(new Error(String(response.status)))))
      .then((value) => active && setData(value), () => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);
  const info = t(
    "This Cloudflare account's use this month (UTC), from Cloudflare's analytics, read at most once an hour. Cost is an estimate at Cloudflare's published prices; the invoice is the reference. Only admins see this.",
    'O uso desta conta da Cloudflare neste mês (UTC), pela análise da Cloudflare, lida no máximo uma vez por hora. O custo é uma estimativa pelos preços publicados da Cloudflare; a fatura é a referência. Só admins veem isto.',
  );
  if (failed)
    return (
      <SectionCard title="Cloudflare" info={info} inset="padded">
        <EmptyState frame="bare" tone="error" title={t('Could not read the Cloudflare usage', 'Não foi possível ler o uso da Cloudflare')} description={t('Nothing was changed. Reload the page to try again.', 'Nada foi alterado. Recarregue a página para tentar de novo.')} />
      </SectionCard>
    );
  if (!data) return <SectionCard title="Cloudflare" info={info} loading lines={4} />;
  if (!data.configured)
    return (
      <SectionCard title="Cloudflare" info={info} inset="padded">
        <EmptyState
          frame="bare"
          title={t('Cloudflare usage is not configured', 'O uso da Cloudflare não está configurado')}
          description={t(
            'To see storage, requests and their estimated cost here, save a Cloudflare API token in Providers. The token needs only Account Analytics: Read on this account. Only admins see this.',
            'Para ver aqui armazenamento, requisições e o custo estimado, salve um token de API da Cloudflare em Provedores. O token precisa só de Account Analytics: Read nesta conta. Só admins veem isto.',
          )}
          action={<Button variant="outline" nativeButton={false} render={<a href="/app/admin/providers#provider-cloudflare" aria-label={t('Set the Cloudflare token', 'Definir o token da Cloudflare')} />}>{t('Set the Cloudflare token', 'Definir o token da Cloudflare')}</Button>}
        />
      </SectionCard>
    );
  const missing = (language: 0 | 1) => data.failed.map((item) => DATASET_NAMES[item.id]?.[language] ?? item.id).join(', ');
  const line = (meter: CloudflareLine['meter']) => data.lines.find((item) => item.meter === meter);
  const requests = line('workersRequests');
  const cpu = line('workersCpuMs');
  const quantity = (row: CloudflareLine, value: number) => {
    const unit = METERS[row.meter][2];
    return unit === 'GB' || unit === 'GB-s' ? `${number(value, unit === 'GB' ? 2 : 0)} ${unit}` : `${compact(value)}${unit ? ` ${unit}` : ''}`;
  };
  const meterColumns: DataColumn<CloudflareLine>[] = [
    { key: 'meter', header: t('Product and meter', 'Produto e medida'), mobile: 'title', shrinkTo: '12rem', width: '20rem', sortValue: (row) => `${PRODUCTS[row.product]} ${t(METERS[row.meter][0], METERS[row.meter][1])}`, cell: (row) => `${PRODUCTS[row.product]}: ${t(METERS[row.meter][0], METERS[row.meter][1])}` },
    { key: 'used', header: t('This month', 'Este mês'), label: t('This month', 'Este mês'), align: 'end', info: t('Requests, time and operations add up from the 1st; storage is the newest level.', 'Requisições, tempo e operações somam desde o dia 1; armazenamento é o nível mais recente.'), cell: (row) => quantity(row, row.used) },
    { key: 'included', header: t('Included', 'Incluído'), label: t('Included', 'Incluído'), align: 'end', mobile: 'hide', info: t('What the Workers Paid plan includes each month at no extra cost.', 'O que o plano Workers Paid inclui por mês sem custo extra.'), cell: (row) => quantity(row, row.included) },
    { key: 'usd', header: t('Estimated', 'Estimado'), label: t('Estimated', 'Estimado'), align: 'end', sortValue: (row) => row.usd, cell: (row) => usd(row.usd) },
  ];
  const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const dayValue = (row: Day, key: keyof Day) => (typeof row[key] === 'number' ? compact(row[key] as number) : '');
  const dayColumns: DataColumn<Day>[] = [
    { key: 'date', header: t('Day (UTC)', 'Dia (UTC)'), mobile: 'title', sortValue: (row) => row.date, cell: (row) => dayLabel(row.date) },
    { key: 'requests', header: t('Workers requests', 'Requisições Workers'), label: t('Workers requests', 'Requisições Workers'), align: 'end', sortValue: (row) => row.workersRequests, cell: (row) => dayValue(row, 'workersRequests') },
    { key: 'cpu', header: t('CPU (ms)', 'CPU (ms)'), label: t('CPU (ms)', 'CPU (ms)'), align: 'end', sortValue: (row) => row.workersCpuMs, cell: (row) => dayValue(row, 'workersCpuMs') },
    { key: 'd1read', header: t('D1 rows read', 'Linhas lidas D1'), label: t('D1 rows read', 'Linhas lidas D1'), align: 'end', mobile: 'hide', sortValue: (row) => row.d1RowsRead, cell: (row) => dayValue(row, 'd1RowsRead') },
    { key: 'd1write', header: t('D1 rows written', 'Linhas gravadas D1'), label: t('D1 rows written', 'Linhas gravadas D1'), align: 'end', mobile: 'hide', sortValue: (row) => row.d1RowsWritten, cell: (row) => dayValue(row, 'd1RowsWritten') },
    { key: 'do', header: t('Durable Objects requests', 'Requisições Durable Objects'), label: t('Durable Objects requests', 'Requisições Durable Objects'), align: 'end', mobile: 'hide', sortValue: (row) => row.doRequests, cell: (row) => dayValue(row, 'doRequests') },
    { key: 'r2', header: t('R2 operations', 'Operações R2'), label: t('R2 operations', 'Operações R2'), align: 'end', mobile: 'hide', sortValue: (row) => (row.r2ClassA ?? 0) + (row.r2ClassB ?? 0), cell: (row) => (row.r2ClassA === undefined && row.r2ClassB === undefined ? '' : compact((row.r2ClassA ?? 0) + (row.r2ClassB ?? 0))) },
  ];
  const checked = new Date(`${data.prices.checkedOn}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const readAt = new Date(data.readAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <MetricGrid columns={4} mobilePairs label="Cloudflare">
        <MetricCard
          label="Cloudflare"
          definition={t(`Estimated cost this month: the Workers Paid plan (${usd(data.planUsd)}) plus what went past its allowances, at the prices of ${checked}.`, `Custo estimado do mês: o plano Workers Paid (${usd(data.planUsd)}) mais o que passou das franquias, pelos preços de ${checked}.`)}
          value={usd(data.estimateUsd)}
          description={t(`${usd(data.projectedUsd)} by month end`, `${usd(data.projectedUsd)} até o fim do mês`)}
        />
        <MetricCard label={t('Requests', 'Requisições')} definition={t('Requests to the Workers of this account this month.', 'Requisições aos Workers desta conta neste mês.')} value={requests ? compact(requests.used) : t('Unavailable', 'Indisponível')} description={requests ? t(`of ${compact(requests.included)} included`, `de ${compact(requests.included)} incluídas`) : undefined} />
        <MetricCard label={t('CPU time', 'Tempo de CPU')} value={cpu ? `${compact(cpu.used)} ms` : t('Unavailable', 'Indisponível')} description={cpu ? t(`of ${compact(cpu.included)} ms included`, `de ${compact(cpu.included)} ms incluídos`) : undefined} />
        <MetricCard
          label={t('Storage', 'Armazenamento')}
          definition={t('D1, Durable Objects (SQLite) and R2 together, at their newest level.', 'D1, Durable Objects (SQLite) e R2 juntos, no nível mais recente.')}
          value={`${number(data.storageGb, 2)} GB`}
          description={data.r2Objects === null ? undefined : t(`${compact(data.r2Objects)} objects in R2`, `${compact(data.r2Objects)} objetos no R2`)}
        />
      </MetricGrid>
      <SectionCard title="Cloudflare" info={info}>
        <DataTableToolbar label={t('View', 'Visão')}>
          <Tabs value={view} onValueChange={(value) => setView(String(value))}>
            <TabsList variant="line" aria-label={t('View', 'Visão')}>
              <TabsTrigger value="meter">{t('By meter', 'Por medida')}</TabsTrigger>
              <TabsTrigger value="day">{t('By day', 'Por dia')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </DataTableToolbar>
        {data.failed.length > 0 && (
          <div className="px-5 py-4">
            <Alert variant="warning">
              <CircleAlert />
              <AlertTitle>{t('Part of the Cloudflare usage is missing', 'Parte do uso da Cloudflare está faltando')}</AlertTitle>
              <AlertDescription>
                {t(
                  `Cloudflare did not answer for: ${missing(0)}. Those lines are left out, not counted as zero, and the estimate leaves them out too. The page reads Cloudflare again within the hour; the Worker log has the details.`,
                  `A Cloudflare não respondeu sobre: ${missing(1)}. Essas linhas ficam de fora, não contam como zero, e a estimativa também as deixa de fora. A página lê a Cloudflare de novo em até uma hora; o log do Worker tem os detalhes.`,
                )}
              </AlertDescription>
            </Alert>
          </div>
        )}
        {view === 'meter' ? (
          data.lines.length ? (
            <DataTable singleLine="wide" ariaLabel={t('Cloudflare usage by meter', 'Uso da Cloudflare por medida')} rows={data.lines} rowKey={(row) => row.meter} columns={meterColumns} />
          ) : (
            <EmptyState frame="bare" tone="error" title={t('Cloudflare answered nothing', 'A Cloudflare não respondeu nada')} description={t('Check that the token has Account Analytics: Read on this account and that CLOUDFLARE_ACCOUNT_ID names it.', 'Confira se o token tem Account Analytics: Read nesta conta e se o CLOUDFLARE_ACCOUNT_ID a identifica.')} />
          )
        ) : data.days.length ? (
          <DataTable singleLine="wide" ariaLabel={t('Cloudflare usage by day', 'Uso da Cloudflare por dia')} rows={data.days} rowKey={(row) => row.date} defaultSort={{ key: 'date', direction: 'desc' }} columns={dayColumns} />
        ) : (
          <EmptyState frame="bare" title={t('No usage in the last 31 days', 'Nenhum uso nos últimos 31 dias')} />
        )}
        <Note>
          {t(
            `Prices published by Cloudflare, checked on ${checked}. Read at ${readAt}. Browser Run is not measured: Cloudflare offers no analytics for browser hours (10 a month included, then US$ 0.09 an hour); see its dashboard.`,
            `Preços publicados pela Cloudflare, conferidos em ${checked}. Lido às ${readAt}. O Browser Run não é medido: a Cloudflare não oferece análise das horas de navegador (10 por mês incluídas, depois US$ 0,09 a hora); veja o painel dela.`,
          )}
        </Note>
      </SectionCard>
    </>
  );
}
