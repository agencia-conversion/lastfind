'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge, type TagTone } from '@/components/lastfind/presentation/tag-badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProvidersData } from './admin-providers';
import { AdminSemanticPanel } from './admin-semantic-panel';

type Health = {
  ok: boolean;
  /** Only a remote preview reports it (with its revision or null). */
  previewSha?: string | null;
  database: boolean;
  rawArchive: boolean;
  projectStorage: boolean;
  problems: string[];
  scheduler: {
    heartbeatAgeMinutes: number | null;
    failedSteps: string[];
    oldestOpenRunMinutes: number | null;
    unknownRuns: number;
    unknownJobs: number;
    operationsHeartbeatAgeMinutes?: number | null;
    operationsFailedSteps?: string[];
    unrecoverableRuns?: number;
    unsettledJobs?: number;
    budgetBlocked?: number;
    deadLetters?: number;
    publicationQueue: number;
    publicationErrors: number;
    providerRejectionsLastHour: number;
    creditRejectionsLastHour: number;
  } | null;
};
type Row = { id: string; check: string; tone: TagTone; state: string; detail: string };
type Copy = (en: string, pt: string) => string;

function rows(health: Health, t: Copy, locale: string): Row[] {
  const n = (value: number) => value.toLocaleString(locale);
  const yes = t('OK', 'OK'),
    no = t('Missing', 'Ausente');
  const s = health.scheduler;
  const age = s?.heartbeatAgeMinutes ?? null;
  return [
    { id: 'database', check: t('Control database', 'Banco de controle'), tone: health.database ? 'success' : 'danger', state: health.database ? yes : t('Unreachable', 'Inacessível'), detail: '' },
    { id: 'raw', check: t('Raw response archive', 'Arquivo de respostas originais'), tone: health.rawArchive ? 'success' : 'danger', state: health.rawArchive ? yes : no, detail: '' },
    { id: 'stores', check: t('Project storage', 'Armazenamento dos projetos'), tone: health.projectStorage ? 'success' : 'danger', state: health.projectStorage ? yes : no, detail: '' },
    {
      id: 'heartbeat',
      check: t('Scheduler', 'Agendador'),
      tone: age === null ? 'neutral' : health.problems.includes('scheduler_stale') ? 'danger' : 'success',
      state: age === null ? t('Never ran', 'Nunca rodou') : health.problems.includes('scheduler_stale') ? t('Stale', 'Parado') : t('Running', 'Rodando'),
      detail: age === null ? t('No heartbeat yet: the scheduler has not run since the deploy (a preview has no scheduler).', 'Ainda sem heartbeat: o agendador não rodou desde a publicação (um preview não tem agendador).') : t(`Last tick ${n(age)} min ago.`, `Último tick há ${n(age)} min.`),
    },
    {
      id: 'steps',
      check: t('Failed steps on the last tick', 'Passos com falha no último tick'),
      tone: s?.failedSteps.length ? 'warning' : 'success',
      state: s?.failedSteps.length ? n(s.failedSteps.length) : t('None', 'Nenhum'),
      detail: s?.failedSteps.join(', ') ?? '',
    },
    {
      id: 'open',
      check: t('Oldest open collection', 'Coleta aberta mais antiga'),
      tone: s?.oldestOpenRunMinutes == null ? 'success' : s.oldestOpenRunMinutes > 180 ? 'warning' : 'neutral',
      state: s?.oldestOpenRunMinutes == null ? t('None', 'Nenhuma') : t(`${n(s.oldestOpenRunMinutes)} min`, `${n(s.oldestOpenRunMinutes)} min`),
      detail: t('Provider answers can take hours; days mean something is stuck.', 'Respostas do provedor podem levar horas; dias indicam algo travado.'),
    },
    {
      id: 'unknown',
      check: t('Unknown outcomes', 'Resultados desconhecidos'),
      tone: (s?.unknownRuns ?? 0) + (s?.unknownJobs ?? 0) ? 'warning' : 'success',
      state: n((s?.unknownRuns ?? 0) + (s?.unknownJobs ?? 0)),
      detail: t(`${n(s?.unknownRuns ?? 0)} collections, ${n(s?.unknownJobs ?? 0)} evaluations. They hold their reservation and are never resent.`, `${n(s?.unknownRuns ?? 0)} coletas, ${n(s?.unknownJobs ?? 0)} avaliações. Mantêm a reserva e nunca são reenviadas.`),
    },
    {
      id: 'operations',
      check: t('Operations', 'Operações'),
      tone: health.problems.includes('operations_stale') ? 'danger' : s?.operationsFailedSteps?.length ? 'warning' : 'success',
      state: s?.operationsHeartbeatAgeMinutes == null ? t('Never ran', 'Nunca rodou') : health.problems.includes('operations_stale') ? t('Stale', 'Parado') : t('Running', 'Rodando'),
      detail: [
        s?.operationsHeartbeatAgeMinutes == null ? '' : t(`Last run ${n(s.operationsHeartbeatAgeMinutes)} min ago.`, `Última execução há ${n(s.operationsHeartbeatAgeMinutes)} min.`),
        s?.operationsFailedSteps?.length ? t(`Failed: ${s.operationsFailedSteps.join(', ')}.`, `Com falha: ${s.operationsFailedSteps.join(', ')}.`) : '',
      ].filter(Boolean).join(' '),
    },
    {
      id: 'unrecoverable',
      check: t('Lost answers', 'Respostas perdidas'),
      tone: s?.unrecoverableRuns ? 'warning' : 'success',
      state: n(s?.unrecoverableRuns ?? 0),
      detail: t('Unknown for more than three days: the provider no longer keeps them, so they cannot be recovered.', 'Desconhecidas há mais de três dias: o provedor não as guarda mais, e não dá para recuperar.'),
    },
    {
      id: 'unsettled',
      check: t('Costs not reported', 'Custos não informados'),
      tone: s?.unsettledJobs ? 'warning' : 'success',
      state: n(s?.unsettledJobs ?? 0),
      detail: t('Evaluations whose provider did not say what they cost: they count at their reservation in the month they ran.', 'Avaliações cujo provedor não informou o custo: contam pela reserva no mês em que rodaram.'),
    },
    {
      id: 'blocked',
      check: t('Projects stopped by a limit', 'Projetos parados por um limite'),
      tone: s?.budgetBlocked ? 'warning' : 'success',
      state: n(s?.budgetBlocked ?? 0),
      detail: t('In the last 6 hours. Usage and costs says which limit.', 'Nas últimas 6 horas. Uso e custos diz qual limite.'),
    },
    {
      id: 'dead',
      check: t('Unpublishable rows', 'Linhas que não publicam'),
      tone: s?.deadLetters ? 'danger' : 'success',
      state: n(s?.deadLetters ?? 0),
      detail: t('Moved aside so the rest of the project publishes: a payload missing or too large.', 'Separadas para o resto do projeto publicar: conteúdo ausente ou grande demais.'),
    },
    {
      id: 'publication',
      check: t('Publication queue', 'Fila de publicação'),
      tone: s?.publicationErrors ? 'danger' : (s?.publicationQueue ?? 0) > 500 ? 'warning' : 'success',
      state: n(s?.publicationQueue ?? 0),
      detail: s?.publicationErrors ? t(`${n(s.publicationErrors)} project stores with an error.`, `${n(s.publicationErrors)} armazenamentos de projeto com erro.`) : t('Results waiting to reach their project store.', 'Resultados esperando chegar ao armazenamento do projeto.'),
    },
    {
      id: 'rejections',
      check: t('Provider rejections, last hour', 'Recusas do provedor, última hora'),
      tone: health.problems.includes('provider_credit') ? 'danger' : s?.providerRejectionsLastHour ? 'warning' : 'success',
      state: n(s?.providerRejectionsLastHour ?? 0),
      detail: s?.creditRejectionsLastHour ? t(`${n(s.creditRejectionsLastHour)} for missing credit (HTTP 402).`, `${n(s.creditRejectionsLastHour)} por falta de crédito (HTTP 402).`) : t('Key, credit or rate-limit answers (401, 402, 403, 429).', 'Respostas de chave, crédito ou limite (401, 402, 403, 429).'),
    },
  ];
}

/**
 * Admin > Overview: what /api/health reports, in words, plus what still needs setting up. `children` is the edition's
 * own live status (Cloud: a running reprocess), shown under the health so its arrival never moves the table, then each project's
 * latest Semantic Branding round (AdminSemanticPanel).
 */
export function AdminOverview({ children }: { children?: ReactNode }) {
  const { locale } = useI18n();
  const t: Copy = (en, pt) => (locale === 'pt-BR' ? pt : en);
  const [health, setHealth] = useState<Health | null | 'failed'>(null);
  const [providers, setProviders] = useState<ProvidersData | null | 'failed'>(null);
  useEffect(() => {
    // Health answers 503 with the same body when something is wrong: that body is the report, not a failure. Any other
    // answer (an error page, a body without the report) is a failed read, never a broken page.
    fetch('/api/health').then((response) => response.json() as Promise<Health>).then((body) => setHealth(Array.isArray(body?.problems) ? body : 'failed'), () => setHealth('failed'));
    fetch('/api/admin/providers').then((response) => (response.ok ? (response.json() as Promise<ProvidersData>) : Promise.reject())).then(setProviders, () => setProviders('failed'));
  }, []);
  // Both reads arrive before anything is drawn, so the setup note never pushes the table down.
  const loading = health === null || providers === null;
  const missing = providers && providers !== 'failed' ? providers.secrets.filter((secret) => !secret.set).map((secret) => secret.key) : [];
  const dataforseoMissing = missing.includes('DATAFORSEO_LOGIN') || missing.includes('DATAFORSEO_PASSWORD');
  // Functions no model provider with a key serves (Admin > Providers, model per function): their readings stay pending.
  const functions = providers && providers !== 'failed' ? (providers.models?.functions ?? []) : [];
  const unserved = functions.filter((fn) => !fn.servedBy).map((fn) => fn.label);
  const noModelKey = unserved.length > 0 && unserved.length === functions.length;
  // A preview never collects (no search data collection, no cron): its answers are imported from production, so a missing key is not a setup step.
  const preview = !!health && health !== 'failed' && 'previewSha' in health;
  const title = t('Health', 'Saúde');
  const columns = [
    { key: 'check', header: t('Check', 'Verificação'), mobile: 'title' as const, headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal', cell: (row: Row) => <span className="font-medium">{row.check}</span> },
    { key: 'state', header: t('State', 'Estado'), label: t('State', 'Estado'), cell: (row: Row) => <TagBadge tone={row.tone}>{row.state}</TagBadge> },
    { key: 'detail', header: t('Detail', 'Detalhe'), label: t('Detail', 'Detalhe'), mobile: 'wide' as const, headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal text-muted-foreground', cell: (row: Row) => row.detail || '' },
  ];
  return (
    <>
      {!loading && preview && (
        <Note className="px-0 py-0" tone="muted">
          {t('Preview: answers are imported from production and nothing is collected here (no search data collection, no cron). Sentiment, source types and brand domains are processed by the preview reprocessing.', 'Preview: as respostas vêm importadas da produção e nada é coletado aqui (sem coleta de dados de busca e sem cron). Sentimento, tipos de fonte e domínios de marca são processados pelo reprocessamento do preview.')}
        </Note>
      )}
      {!loading && !preview && providers !== 'failed' && (dataforseoMissing || unserved.length > 0) && (
        <Note
          className="px-0 py-0"
          tone={dataforseoMissing ? 'danger' : 'muted'}
          action={<a href="/app/admin/providers" className="text-primary hover:underline">{t('Open Providers', 'Abrir Provedores')}</a>}
        >
          {dataforseoMissing
            ? t('Setup needed: without the search data key nothing is collected. The guided setup asks for it first.', 'Falta configurar: sem a chave de dados de busca nada é coletado. A configuração guiada pede essa chave primeiro.')
            : noModelKey
              ? t('No model provider has a key: sentiment, roles, source types, brand domains, the agent and the wizards stay pending.', 'Nenhum provedor de modelo tem chave: sentimento, papéis, tipos de fonte, domínios de marca, o agente e os wizards ficam pendentes.')
              : t(`No model provider with a key serves ${unserved.map((fn) => fn[0]).join(', ')}: they stay pending until one does (OpenRouter for the Liquid and TypeSafe decision models).`, `Nenhum provedor de modelo com chave atende ${unserved.map((fn) => fn[1]).join(', ')}: ficam pendentes até um atender (OpenRouter para os modelos de decisão da Liquid e da TypeSafe).`)}
        </Note>
      )}
      <SectionCard
        title={title}
        description={t('The same numbers /api/health reports every 15 minutes to the uptime monitor. Counts and ages only.', 'Os mesmos números que /api/health reporta a cada 15 minutos ao monitor. Só contagens e idades.')}
        action={loading ? <Skeleton inline className="h-5 w-16" /> : health !== 'failed' ? <TagBadge tone={health.ok ? 'success' : 'danger'}>{health.ok ? t('Healthy', 'Saudável') : t('Problems', 'Problemas')}</TagBadge> : undefined}
        inset={!loading && health === 'failed' ? 'padded' : undefined}
      >
        {!loading && health === 'failed' ? (
          <p role="alert" className="text-body text-destructive">{t('Could not read /api/health. Reload and try again.', 'Não foi possível ler /api/health. Recarregue e tente de novo.')}</p>
        ) : (
          <div className="live-table-scroll">
            <DataTable ariaLabel={title} rows={loading || health === 'failed' ? [] : rows(health, t, locale)} loading={loading ? 9 : undefined} rowKey={(row) => row.id} columns={columns} />
          </div>
        )}
      </SectionCard>
      {providers === 'failed' && (
        <Note className="px-0 py-0" tone="danger">{t('Could not read the providers. Reload and try again.', 'Não foi possível ler os provedores. Recarregue e tente de novo.')}</Note>
      )}
      {children}
      {/* Why an AI gave no notes and the order effect, off the Semantic Branding screen. */}
      <AdminSemanticPanel />
    </>
  );
}
