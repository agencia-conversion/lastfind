'use client';
// Project settings an owner needs to run a project end to end: when it collects, what it may spend, which provider keys
// the installation holds (independent edition), its backups and restore, and its danger zone (archive and delete). Kept apart from live-app/live-monitoring-settings.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import type { Project, Workspace } from '@/lib/types';
import { requestHeaders, type requestJson } from '@/lib/client';
import { DAILY, WEEKLY, formatNextCollection, scheduleOf } from '@/lib/scheduling';
import { formatNumber, numberLocale } from '@/lib/number-format';
import { MAX_RESTORE_BYTES } from '@/lib/project-backups';
import { DEFAULT_RETENTION_DAYS, RETENTION_DAYS } from '@/lib/retention';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable, skeletonColumns } from '@/components/lastfind/presentation/data-table';
import { Skeleton } from '@/components/ui/skeleton';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { Note } from '@/components/lastfind/presentation/note';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { UsageMeterRow } from '@/components/lastfind/usage-meter-row';
import { SettingsBlock } from './settings-block';
import { SearchSelect, timeZoneOptions } from './country-field';
import { EmptyState } from './shared';
import { projectLabel } from '@/lib/new-project';
import { blockLabel, moduleLabel, platformPauseCopy, usdFormat } from './spend-labels';

type Copy = (en: string, pt: string) => string;
const pad = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
/** Monday first; 4 January 2026 is a Sunday, so its date plus the weekday names the day. */
const weekdays = (locale: string) =>
  [1, 2, 3, 4, 5, 6, 0].map((day) => ({ value: String(day), label: new Intl.DateTimeFormat(numberLocale(locale), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + day))) }));

/**
 * Frequency, day, hour and time zone of the project's collection, and its pause. The day and hour are in the workspace's time zone,
 * which every project of the workspace shares; a weekly-only plan stays weekly. Only workspace admins change the schedule.
 */
export function CollectionSchedule({
  workspace,
  project,
  busy,
  t,
  save,
  onDirty,
}: {
  workspace: Workspace;
  project: Project;
  busy: boolean;
  t: Copy;
  save: (path: string, method: string, value: unknown) => Promise<unknown>;
  onDirty: (dirty: boolean) => void;
}) {
  const locale = t('en', 'pt-BR');
  const id = useId();
  const free = !!workspace.capabilities.free;
  const admin = workspace.role === undefined || workspace.role === 'owner' || workspace.role === 'admin';
  const schedule = scheduleOf(project, free, workspace.timeZone);
  const [weekly, setWeekly] = useState(schedule.weekly);
  const [pauseConfirm, setPauseConfirm] = useState(false);
  const path = `/api/projects/${encodeURIComponent(project.id)}`;
  const zones = useMemo(() => timeZoneOptions(numberLocale(locale), schedule.zone), [locale, schedule.zone]);
  const next = formatNextCollection(schedule, locale);
  const prompts = formatNumber(locale, workspace.capacity.prompts);
  const limit = workspace.capabilities.promptLimit;
  return (
    <>
      <SettingsBlock
        className="collection-schedule"
        title={t('Collection schedule', 'Agenda de coleta')}
        description={t('How often, on which day and at what time the AIs are asked your questions.', 'Com que frequência, em que dia e em que horário as IAs recebem suas perguntas.')}
        t={t}
        busy={busy}
        onDirty={onDirty}
        action={
          <Button variant="outline" disabled={busy} onClick={() => setPauseConfirm(true)}>
            {project.daily_enabled ? t('Pause monitoring', 'Pausar monitoramento') : t('Resume monitoring', 'Retomar monitoramento')}
          </Button>
        }
        save={async (data) => {
          const zone = String(data.get('time_zone') ?? '');
          if (zone && zone !== schedule.zone && !(await save('/api/workspace', 'PATCH', { time_zone: zone }))) return false;
          const value: Record<string, number> = { collection_hour: Number(data.get('collection_hour')) };
          if (!free) value.interval_hours = Number(data.get('interval_hours'));
          if (data.has('collection_day')) value.collection_day = Number(data.get('collection_day'));
          return Boolean(await save(path, 'PATCH', value));
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <label className="grid gap-2">
              {t('Frequency', 'Frequência')}
              <SelectField
                name="interval_hours"
                defaultValue={String(schedule.weekly ? WEEKLY : DAILY)}
                disabled={free || !admin}
                onValueChange={(value) => setWeekly(Number(value) === WEEKLY)}
                aria-describedby={free ? `${id}-frequency` : undefined}
                options={[
                  { value: String(DAILY), label: t('Daily', 'Diária') },
                  { value: String(WEEKLY), label: t('Weekly', 'Semanal') },
                ]}
              />
            </label>
            {free && <span id={`${id}-frequency`} className="text-caption text-muted-foreground">{t('Your plan collects once a week.', 'Seu plano coleta uma vez por semana.')}</span>}
          </div>
          {weekly && (
            <label className="grid content-start gap-2">
              {t('Day', 'Dia')}
              <SelectField name="collection_day" defaultValue={String(schedule.day)} disabled={!admin} options={weekdays(locale)} />
            </label>
          )}
          <label className="grid content-start gap-2">
            {t('Time', 'Horário')}
            <SelectField
              name="collection_hour"
              defaultValue={String(schedule.hour)}
              disabled={!admin}
              options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: pad(hour) }))}
            />
          </label>
          <div className="grid content-start gap-2">
            <label className="grid gap-2">
              {t('Time zone', 'Fuso horário')}
              <SearchSelect name="time_zone" defaultValue={schedule.zone} options={zones} locale={locale} disabled={!admin}
                search={t('Search a time zone', 'Busque um fuso horário')} empty={t('No time zone found.', 'Nenhum fuso horário encontrado.')} />
            </label>
            <span className="text-caption text-muted-foreground">{t("The workspace's: every project uses it.", 'O do workspace: vale para todos os projetos.')}</span>
          </div>
        </div>
        {!admin && <Note className="mt-4">{t('Only workspace admins change the collection schedule.', 'Só admins do workspace mudam a agenda de coleta.')}</Note>}
        <p className="mt-4 text-muted-foreground">
          {/* Without the search data key nothing is collected, whatever the schedule says (the Overview says the same). */}
          {workspace.config?.dataforseo === false
            ? <>{t('Monitoring is off: this installation has no search data key. Add it in Admin > Providers; your prompts are kept.', 'O monitoramento está desligado: esta instalação não tem a chave de dados de busca. Adicione em Admin > Provedores; seus prompts ficam guardados.')}{' '}<a href="/app/admin/providers" className="text-primary hover:underline">{t('Open Admin', 'Abrir Admin')}</a></>
            : project.daily_enabled
            ? t(`Monitoring is on. Next collection: ${next}.`, `Monitoramento ativo. Próxima coleta: ${next}.`)
            : t('Monitoring is paused. Nothing is collected until you resume it.', 'Monitoramento pausado. Nada é coletado até você retomá-lo.')}
          <br />
          {limit === null
            ? t(`${prompts} questions in this workspace, shared by all its projects.`, `${prompts} perguntas neste workspace, divididas entre todos os projetos.`)
            : t(`${prompts} of ${formatNumber(locale, limit)} questions in this workspace, shared by all its projects.`, `${prompts} de ${formatNumber(locale, limit)} perguntas neste workspace, divididas entre todos os projetos.`)}
        </p>
      </SettingsBlock>
      <ConfirmDialog
        open={pauseConfirm}
        onOpenChange={setPauseConfirm}
        title={project.daily_enabled ? t('Pause monitoring?', 'Pausar o monitoramento?') : t('Resume monitoring?', 'Retomar o monitoramento?')}
        description={project.daily_enabled
          ? t('No new answers are collected while paused. History and prompts are kept.', 'Nenhuma resposta nova é coletada enquanto estiver pausado. Histórico e prompts ficam guardados.')
          : t('Collection resumes at the next scheduled time.', 'A coleta volta no próximo horário agendado.')}
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={project.daily_enabled ? t('Pause', 'Pausar') : t('Resume', 'Retomar')}
        pending={busy}
        onConfirm={() => { setPauseConfirm(false); void save(path, 'PATCH', { daily_enabled: !project.daily_enabled }); }}
      />
    </>
  );
}

/** GET /api/projects/:id/spending (lib/server/project-budgets.ts). */
export type ProjectBudgetData = {
  month: string;
  budgetUsd: number | null;
  spentUsd: number;
  leftUsd: number | null;
  defaultUsd: number | null;
  maxUsd: number | null;
  custom: boolean;
  platformRoomUsd: number | null;
  share: number;
  projectedUsd: number | null;
  exhausted: boolean;
  alarm: boolean;
  modules: { module: string; realUsd: number; spendUsd: number; items: number }[];
  blocked: { reason: string; module: string; at: string } | null;
  plan: PlanAllowances | null;
  canSet: boolean;
  canUnlimited: boolean;
};
type PlanAllowances = {
  plan: string;
  periodStart: string;
  collectionCredits: { used: number; limit: number | null };
  agentCredits: { used: number; limit: number | null; usd: number };
  panelRounds: { used: number; limit: number | null };
  projects: { used: number; limit: number | null };
  budget: { defaultUsd: number | null; maxUsd: number | null };
};

/** The project's monthly budget: an amount, back to the default, or (a Lastfind admin, or the independent owner) none. */
function BudgetDialog({ project, data, request, t, onClose, onSaved }: { project: Project; data: ProjectBudgetData; request: typeof requestJson; t: Copy; onClose: () => void; onSaved: (data: ProjectBudgetData) => void }) {
  const id = useId();
  const usd = usdFormat(t('en', 'pt-BR'));
  const [value, setValue] = useState(data.custom && data.budgetUsd !== null ? String(data.budgetUsd) : '');
  const [unlimited, setUnlimited] = useState(data.custom && data.budgetUsd === null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (monthly: number | null | 'default') => {
    setBusy(true);
    setError('');
    try {
      onSaved(await request<ProjectBudgetData>(`/api/projects/${encodeURIComponent(project.id)}/spending`, 'PUT', { monthly_usd: monthly }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unlimited) return void save(null);
    if (!value.trim()) return void save('default');
    const amount = Number(value.replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0 || (data.maxUsd !== null && amount > data.maxUsd))
      return setError(data.maxUsd === null ? t('Enter 0 or more.', 'Informe 0 ou mais.') : t(`Enter a budget between 0 and ${usd(data.maxUsd)}.`, `Informe um orçamento entre 0 e ${usd(data.maxUsd)}.`));
    void save(amount);
  };
  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Monthly budget', 'Orçamento mensal')}</DialogTitle>
          <DialogDescription>
            {t(
              `An optional cap on everything ${projectLabel(project)} may spend each month (collection, Semantic Branding, Products, evaluations, brand domains and the agent), inside the workspace's monthly limit, which all its projects share. When it is reached, paid work waits for the next month and this page says so.`,
              `Um teto opcional para tudo o que ${projectLabel(project)} pode gastar por mês (coleta, Semantic Branding, Produtos, avaliações, domínios de marca e o agente), dentro do limite mensal do workspace, que todos os projetos dividem. Ao chegar nele, o trabalho pago espera o próximo mês e esta página avisa.`,
            )}
          </DialogDescription>
        </DialogHeader>
        <form id={`${id}-form`} onSubmit={submit} noValidate>
          <FieldGroup className="gap-5">
            {data.canUnlimited && (
              <Field orientation="horizontal">
                <Switch id={`${id}-unlimited`} checked={unlimited} disabled={busy} onCheckedChange={(on) => { setUnlimited(on); setError(''); }} />
                <FieldLabel htmlFor={`${id}-unlimited`}>{t('No budget', 'Sem orçamento')}</FieldLabel>
              </Field>
            )}
            {!unlimited && (
              <Field data-invalid={Boolean(error) || undefined}>
                <FieldLabel htmlFor={`${id}-budget`}>{t('Budget per month (US$)', 'Orçamento por mês (US$)')}</FieldLabel>
                <Input
                  id={`${id}-budget`}
                  inputMode="decimal"
                  value={value}
                  placeholder={data.defaultUsd === null ? '' : String(data.defaultUsd)}
                  disabled={busy}
                  aria-invalid={Boolean(error) || undefined}
                  aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
                  onChange={(event) => {
                    setValue(event.target.value);
                    setError('');
                  }}
                />
                <FieldDescription id={`${id}-help`}>
                  {[
                    data.defaultUsd === null
                      ? t("0 stops paid work in this project. Empty: no cap, only the workspace's plan limits it.", '0 para o trabalho pago neste projeto. Vazio: sem teto, só o plano do workspace limita.')
                      : t(`0 stops paid work in this project. Empty uses the default, ${usd(data.defaultUsd)}.`, `0 para o trabalho pago neste projeto. Vazio usa o padrão, ${usd(data.defaultUsd)}.`),
                    data.maxUsd === null ? '' : t(`Your plan allows up to ${usd(data.maxUsd)}.`, `Seu plano permite até ${usd(data.maxUsd)}.`),
                  ].filter(Boolean).join(' ')}
                </FieldDescription>
                {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
              </Field>
            )}
            {unlimited && error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('Cancel', 'Cancelar')}
          </Button>
          <Button type="submit" form={`${id}-form`} pending={busy} pendingLabel={t('Saving…', 'Salvando…')}>
            {t('Save', 'Salvar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Settings > Monitoring > Budget: the project's monthly budget for every paid module, what it spent so far by module (real and
 * held), the run-rate to the month's end, an alarm past 80%, and, when a limit stops work, which one. Cloud adds the plan's
 * quantities (collection and AI credits, projects). Workspace admins and above.
 */
export function SpendingLimits({ project, workspace, request, t, demo }: { project: Project; workspace: Workspace; request: typeof requestJson; t: Copy; demo?: boolean }) {
  const locale = t('en', 'pt-BR');
  const usd = usdFormat(locale);
  const [data, setData] = useState<ProjectBudgetData | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const admin = workspace.role === undefined || workspace.role === 'owner' || workspace.role === 'admin';
  useEffect(() => {
    if (demo || !admin) return;
    let active = true;
    queueMicrotask(() => { if (active) { setData(null); setError(''); } });
    request<ProjectBudgetData>(`/api/projects/${encodeURIComponent(project.id)}/spending`)
      .then((value) => { if (active) setData(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [admin, demo, project.id, request, retry]);
  const title = t('Budget', 'Orçamento');
  const info = t(
    "The workspace's plan is one pool of prompts and credits that all its projects share. This project's monthly budget is an optional cap inside it, for everything the project spends on AI answers, evaluations and data. Held means reserved for work still running, or kept for an answer that was never confirmed; it counts until it settles. Every paid step checks the cap first.",
    'O plano do workspace é um só conjunto de prompts e créditos que todos os projetos dividem. O orçamento mensal deste projeto é um teto opcional dentro dele, para tudo o que o projeto gasta com respostas de IA, avaliações e dados. Reservado é o que está guardado para trabalho em andamento, ou para uma resposta que nunca foi confirmada; conta até o custo real chegar. Todo passo pago confere o teto antes.',
  );
  if (!admin && !demo) return null;
  const change = data && (
    <Button variant="outline" onClick={() => setEditing(true)}>
      {t('Change', 'Alterar')}
    </Button>
  );
  return (
    <SectionCard title={title} info={info} action={change || undefined}>
      {demo ? (
        <EmptyState frame="bare" title={t('Not available in this demo', 'Indisponível nesta demo')} description={t('Budgets are shown in your own projects.', 'Os orçamentos aparecem nos seus próprios projetos.')} />
      ) : error ? (
        <EmptyState
          frame="bare"
          tone="error"
          title={t('Could not load the budget', 'Não foi possível carregar o orçamento')}
          description={error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : !data ? (
        <>
          <div className="grid gap-2 px-5 pb-4" aria-busy="true" aria-label={t('Loading the budget', 'Carregando o orçamento')}>
            <Skeleton className="h-lh w-1/2" />
            <Skeleton className="h-2 w-full" />
          </div>
          <DataTable singleLine loading={3} ariaLabel={t('Spend by module', 'Gasto por módulo')} rows={[]} rowKey={String} columns={skeletonColumns(3)} />
        </>
      ) : (
        <>
          <div className="grid gap-2 px-5 pb-4">
            <UsageMeterRow
              row={{
                key: 'budget',
                label: data.budgetUsd === null ? t('Spent this month, no cap', 'Gasto neste mês, sem teto') : data.custom ? t('Spent this month of its budget', 'Gasto neste mês do orçamento') : t('Spent this month of the default budget', 'Gasto neste mês do orçamento padrão'),
                used: data.spentUsd,
                limit: data.budgetUsd,
                format: usd,
              }}
            />
            <p className="text-caption text-muted-foreground">
              {[
                data.leftUsd === null ? '' : t(`Left: ${usd(data.leftUsd)}.`, `Restante: ${usd(data.leftUsd)}.`),
                data.projectedUsd === null ? t('The pace shows from the 2nd day.', 'O ritmo aparece a partir do 2º dia.') : t(`At this pace, ${usd(data.projectedUsd)} by month end.`, `Neste ritmo, ${usd(data.projectedUsd)} até o fim do mês.`),
              ].filter(Boolean).join(' ')}
            </p>
          </div>
          {data.blocked ? (
            <Note tone="danger" icon={<CircleAlert size={16} />}>
              {data.blocked.reason === 'platform'
                ? `${t('Paused: ', 'Pausado: ')}${platformPauseCopy(t)}`
                : t(`Paused: ${blockLabel(data.blocked.reason, t)}. ${moduleLabel(data.blocked.module, t)} waits until there is room.`, `Pausado: ${blockLabel(data.blocked.reason, t)}. ${moduleLabel(data.blocked.module, t)} espera até haver espaço.`)}
            </Note>
          ) : data.exhausted ? (
            <Note tone="danger" icon={<CircleAlert size={16} />}>{t('The budget is used up: paid work waits for next month or a higher budget.', 'O orçamento acabou: o trabalho pago espera o próximo mês ou um orçamento maior.')}</Note>
          ) : data.alarm ? (
            <Note icon={<CircleAlert size={16} />}>
              {data.share >= 0.8
                ? t(`Over 80% of this month's budget is used.`, `Mais de 80% do orçamento deste mês foi usado.`)
                : t('At this pace the budget runs out before the month ends.', 'Neste ritmo o orçamento acaba antes do fim do mês.')}
            </Note>
          ) : null}
          {data.modules.length ? (
            <DataTable
              singleLine
              ariaLabel={t('Spend by module', 'Gasto por módulo')}
              rows={data.modules}
              rowKey={(row) => row.module}
              defaultSort={{ key: 'spend', direction: 'desc' }}
              columns={[
                { key: 'module', header: t('Module', 'Módulo'), mobile: 'title', shrinkTo: '12rem', cell: (row) => moduleLabel(row.module, t) },
                { key: 'spend', header: t('Counts', 'Conta'), label: t('Counts', 'Conta'), align: 'end', sortValue: (row) => row.spendUsd, cell: (row) => usd(row.spendUsd), info: t('Real cost plus what is held.', 'Custo real mais o reservado.') },
                { key: 'real', header: t('Real', 'Real'), label: t('Real', 'Real'), align: 'end', sortValue: (row) => row.realUsd, cell: (row) => usd(row.realUsd) },
                { key: 'held', header: t('Held', 'Reservado'), label: t('Held', 'Reservado'), align: 'end', sortValue: (row) => row.spendUsd - row.realUsd, cell: (row) => usd(Math.max(0, row.spendUsd - row.realUsd)) },
              ]}
            />
          ) : (
            <EmptyState frame="bare" title={t('Nothing spent this month', 'Nada gasto neste mês')} description={t('Each module shows here once it spends.', 'Cada módulo aparece aqui quando gastar.')} />
          )}
          {data.plan && (
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              <UsageMeterRow row={{ key: 'prompts', label: t('Prompts (workspace)', 'Prompts (workspace)'), used: workspace.capacity.prompts, limit: workspace.capabilities.promptLimit }} />
              <UsageMeterRow row={{ key: 'agent', label: t('AI credits (workspace)', 'Créditos de IA (workspace)'), used: data.plan.agentCredits.used, limit: data.plan.agentCredits.limit, credits: true }} />
              <UsageMeterRow row={{ key: 'collection', label: t('Collection credits (workspace)', 'Créditos de coleta (workspace)'), used: data.plan.collectionCredits.used, limit: data.plan.collectionCredits.limit }} />
              <UsageMeterRow row={{ key: 'projects', label: t('Projects (workspace)', 'Projetos (workspace)'), used: data.plan.projects.used, limit: data.plan.projects.limit }} />
            </div>
          )}
        </>
      )}
      {editing && data && <BudgetDialog project={project} data={data} request={request} t={t} onClose={() => setEditing(false)} onSaved={setData} />}
    </SectionCard>
  );
}

/** Independent edition only: which provider keys the installation holds. Never a value; Admin > Providers changes them. */
export function ProviderKeys({ workspace, t }: { workspace: Workspace; t: Copy }) {
  if (!workspace.config.providerSettings) return null;
  const rows = [
    { key: 'dataforseo', name: 'DataForSEO', use: t('Collection and Semantic Branding', 'Coleta e Semantic Branding'), configured: workspace.config.dataforseo },
    { key: 'evaluations', name: t('Evaluations', 'Avaliações'), use: t('Sentiment and source types', 'Sentimento e tipos de fonte'), configured: !!workspace.config.openrouter },
  ];
  return (
    <SectionCard title={t('Provider keys', 'Chaves dos provedores')} description={t('The keys stay in your installation, sealed; this screen only says whether each one is set.', 'As chaves ficam na sua instalação, seladas; esta tela só diz se cada uma está definida.')}>
      <DataTable
        singleLine
        rows={rows}
        rowKey={(row) => row.key}
        columns={[
          { key: 'name', header: t('Provider', 'Provedor'), mobile: 'title', cell: (row) => row.name },
          { key: 'use', header: t('Used for', 'Usada para'), label: t('Used for', 'Usada para'), mobile: 'wide', cell: (row) => row.use },
          { key: 'state', header: t('State', 'Estado'), label: t('State', 'Estado'), align: 'end', cell: (row) => <TagBadge tone={row.configured ? 'success' : 'warning'}>{row.configured ? t('Configured', 'Configurada') : t('Missing', 'Ausente')}</TagBadge> },
        ]}
      />
      <Note action={<a href="/app/admin/providers" className="text-primary hover:underline">{t('Open Providers', 'Abrir Provedores')}</a>}>{t('To add or change a key, open Admin > Providers. Each key is tested for free before it is saved. Your projects and history are kept.', 'Para adicionar ou trocar uma chave, abra Admin > Provedores. Cada chave é testada de graça antes de ser salva. Seus projetos e histórico ficam guardados.')}</Note>
    </SectionCard>
  );
}

type Backup = { id: string; status: 'running' | 'ready' | 'failed'; bytes: number; created_at: string; finished_at: string | null };
type RestoreSource = { file: File; backup?: undefined } | { backup: Backup; file?: undefined };
/** The newest restore as the server keeps it (lib/server/project-restores.ts): it runs whether or not this page is open. */
type Restore = {
  id: string;
  status: 'uploading' | 'running' | 'done' | 'failed';
  step: 'saving' | 'uploading' | 'verifying';
  label: string;
  source: 'file' | 'backup';
  rows: number;
  created_at: string;
  finished_at: string | null;
  error: 'invalid' | 'other-project' | 'not-made-here' | 'backup' | 'changed' | 'upload' | 'timeout' | 'failed' | null;
};

/** A message already in the viewer's language (the server's answers and this screen's own). */
class ShownError extends Error {}
/** The server's message, or a neutral one in the viewer's language (never a status code or a browser's network error). */
const shownMessage = (cause: unknown, t: Copy) =>
  cause instanceof ShownError ? cause.message : t('Could not complete this operation. Please try again.', 'Não foi possível concluir a operação. Tente novamente.');
async function requestOk<T>(path: string, init?: RequestInit): Promise<T> {
  const json = typeof init?.body === 'string';
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: requestHeaders(json) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw body?.error ? new ShownError(body.error) : new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Backups made in the background (listed with date, size and state, downloadable when ready) and restore of one of them or
 * of a file over this same project (archiving and deleting live in the danger zone, ProjectDangerZone). Owner only, both editions; Cloud restores only backups Lastfind made.
 * The restore also runs on the server: once the file is sent, closing the page does not stop it.
 */
/**
 * How long the project keeps each answer's text and original response (lib/retention.ts). What the reports count stays for
 * good. Worded as a recommendation, in data terms only. Only workspace admins change it.
 */
export function DataRetention({ workspace, project, busy, t, demo, save, onDirty }: { workspace: Workspace; project: Project; busy: boolean; t: Copy; demo?: boolean; save: (value: unknown) => Promise<unknown>; onDirty: (dirty: boolean) => void }) {
  const admin = workspace.role === undefined || workspace.role === 'owner' || workspace.role === 'admin';
  const current = project.raw_retention_days ?? null;
  const label = (days: number) =>
    days === 90 ? t('90 days', '90 dias') : days === 180 ? t('6 months', '6 meses') : days === 365 ? t('1 year', '1 ano') : t('2 years', '2 anos');
  return (
    <SettingsBlock
      title={t('Data retention', 'Retenção de dados')}
      description={t(
        'How long this project keeps the full text of each answer and its original response. Brands, positions, sources, sentiment and Semantic Branding scores are kept for good, so trends stay available.',
        'Por quanto tempo este projeto guarda o texto completo de cada resposta e a resposta original. Marcas, posições, fontes, sentimento e notas do Semantic Branding ficam guardados sempre, então as tendências continuam disponíveis.',
      )}
      t={t}
      busy={busy || demo === true}
      onDirty={onDirty}
      save={async (data) => {
        const value = String(data.get('raw_retention_days') ?? 'keep');
        return Boolean(await save({ raw_retention_days: value === 'keep' ? null : Number(value) }));
      }}
    >
      <label className="grid max-w-sm gap-2">
        {t('Keep answer text for', 'Guardar o texto das respostas por')}
        <SelectField
          name="raw_retention_days"
          defaultValue={current === null ? 'keep' : String(current)}
          disabled={!admin || demo}
          options={[
            ...RETENTION_DAYS.map((days) => ({ value: String(days), label: days === DEFAULT_RETENTION_DAYS ? t(`${label(days)} (recommended)`, `${label(days)} (recomendado)`) : label(days) })),
            { value: 'keep', label: t('Keep everything', 'Guardar tudo') },
          ]}
        />
      </label>
      <p className="mt-4 text-muted-foreground">
        {t('Recommended: 90 days. It keeps the project light; trends stay available.', 'Recomendado: 90 dias. Mantém o projeto leve; as tendências continuam disponíveis.')}
        <br />
        {current === null
          ? t('This project keeps everything until you choose.', 'Este projeto guarda tudo até você escolher.')
          : t('Older answers keep their numbers in every report; their text no longer opens.', 'Respostas mais antigas mantêm os números em todos os relatórios; o texto delas deixa de abrir.')}
      </p>
      {!admin && <Note className="mt-4">{t('Only workspace admins change data retention.', 'Só admins do workspace mudam a retenção de dados.')}</Note>}
    </SettingsBlock>
  );
}

export function ProjectDataSettings({ project, workspace, t, demo, onRestored }: { project: Project; workspace: Workspace; t: Copy; demo?: boolean; onRestored?: () => Promise<unknown> }) {
  const locale = t('en', 'pt-BR');
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [listError, setListError] = useState('');
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [source, setSource] = useState<RestoreSource | null>(null);
  const [restore, setRestore] = useState<Restore | null>(null);
  const [restoreReload, setRestoreReload] = useState(0);
  // This page's own part of a restore: asking the server to start it and, for a file, sending it (percent sent).
  const [sending, setSending] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const watching = useRef<string | null>(null);
  const restored = useRef(onRestored);
  useEffect(() => { restored.current = onRestored; });
  const selfhost = workspace.config.providerSettings;
  const base = `/api/projects/${encodeURIComponent(project.id)}`;
  const running = backups?.some((backup) => backup.status === 'running') ?? false;
  const restoring = sending !== null || restore?.status === 'running' || restore?.status === 'uploading';
  useEffect(() => {
    if (demo) return;
    let active = true;
    requestOk<{ backups: Backup[] }>(`${base}/backups`)
      .then((value) => { if (active) { setBackups(value.backups); setListError(''); } })
      .catch((cause) => { if (active) setListError(shownMessage(cause, t)); });
    return () => { active = false; };
  }, [base, demo, reload, t]);
  // While one is being made, the list is read again every few seconds; leaving the page does not stop it.
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setReload((value) => value + 1), 4000);
    return () => clearTimeout(timer);
  }, [running, backups]);
  // The newest restore, whenever the page opens and every few seconds while it runs.
  useEffect(() => {
    if (demo) return;
    let active = true;
    requestOk<{ restore: Restore | null }>(`${base}/restores`)
      .then((value) => {
        if (!active) return;
        setRestore(value.restore);
        // A restore this page saw running has just finished: the reports read the restored store from now on.
        if (value.restore?.status === 'done' && watching.current === value.restore.id) void restored.current?.().catch(() => undefined);
        watching.current = value.restore?.status === 'running' ? value.restore.id : null;
        if (value.restore && value.restore.status !== 'uploading') setReload((count) => count + 1);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [base, demo, restoreReload]);
  useEffect(() => {
    if (restore?.status !== 'running') return;
    const timer = setTimeout(() => setRestoreReload((value) => value + 1), 3000);
    return () => clearTimeout(timer);
  }, [restore]);
  const date = (value: string) => new Intl.DateTimeFormat(numberLocale(locale), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  const size = (bytes: number) => bytes >= 1024 * 1024
    ? `${formatNumber(locale, bytes / 1024 / 1024, 1)} MB`
    : `${formatNumber(locale, Math.max(1, Math.round(bytes / 1024)))} KB`;
  async function start() {
    setStarting(true);
    setStartError('');
    try {
      // The answer is the backup itself (a new one, or the one already being made): it is listed at once, so the button
      // stays disabled until it is ready and a second click cannot ask for another.
      const { backup } = await requestOk<{ id: string; backup: Backup }>(`${base}/backups`, { method: 'POST', body: '{}' });
      setBackups((list) => [backup, ...(list ?? []).filter((item) => item.id !== backup.id)]);
      setReload((value) => value + 1);
    } catch (cause) {
      setStartError(shownMessage(cause, t));
    } finally {
      setStarting(false);
    }
  }
  async function runRestore(chosen: RestoreSource) {
    setRestoreError('');
    setSending(0);
    try {
      let started: Restore;
      if (chosen.backup) {
        started = (await requestOk<{ restore: Restore }>(`${base}/restores`, { method: 'POST', body: JSON.stringify({ backup: chosen.backup.id }) })).restore;
      } else {
        const file = chosen.file;
        if (file.size > MAX_RESTORE_BYTES) throw new ShownError(t('The file is larger than 1 GB.', 'O arquivo tem mais de 1 GB.'));
        const opened = await requestOk<{ restore: Restore; partBytes: number; parts: number }>(`${base}/restores`, { method: 'POST', body: JSON.stringify({ file: { name: file.name, bytes: file.size } }) });
        setRestore(opened.restore);
        const path = `${base}/restores/${encodeURIComponent(opened.restore.id)}`;
        for (let part = 1; part <= opened.parts; part++) {
          await requestOk(`${path}?part=${part}`, { method: 'PUT', body: file.slice((part - 1) * opened.partBytes, part * opened.partBytes) });
          setSending(Math.floor((part / opened.parts) * 100));
        }
        started = (await requestOk<{ restore: Restore }>(path, { method: 'POST' })).restore;
      }
      setRestore(started);
      watching.current = started.id;
      setRestoreReload((value) => value + 1);
    } catch (cause) {
      setRestoreError(cause instanceof ShownError
        ? cause.message
        : t('The connection dropped. Nothing was switched; try again.', 'A conexão caiu. Nada foi trocado; tente de novo.'));
      setRestoreReload((value) => value + 1);
    } finally {
      setSending(null);
    }
  }
  const restoreLabel = (value: Restore) => value.source === 'backup' ? date(value.label) : value.label;
  const restoreFailure = (value: Restore) => ({
    invalid: t('The file is not a complete Lastfind backup.', 'O arquivo não é um backup completo do Lastfind.'),
    'other-project': t('This backup is from another project.', 'Este backup é de outro projeto.'),
    'not-made-here': t('Only backups Lastfind made of this project can be restored here.', 'Aqui só é possível restaurar backups que o Lastfind fez deste projeto.'),
    backup: t('Could not keep a backup of the current state, so nothing was restored.', 'Não foi possível guardar um backup do estado atual, então nada foi restaurado.'),
    changed: t('The project changed while restoring. Nothing was switched; try again.', 'O projeto mudou durante a restauração. Nada foi trocado; tente de novo.'),
    upload: t('The upload was interrupted. Choose the file again.', 'O envio foi interrompido. Escolha o arquivo de novo.'),
    timeout: t('The restore stopped. Nothing was switched; try again.', 'A restauração parou. Nada foi trocado; tente de novo.'),
    failed: t('The restore stopped. Nothing was switched; try again.', 'A restauração parou. Nada foi trocado; tente de novo.'),
  })[value.error ?? 'failed'];
  const sourceLabel = source?.backup ? date(source.backup.created_at) : source?.file?.name ?? '';
  // What the restore card shows: this page sending the file, then the server's state (also after the page reopens).
  const shown = sending !== null ? 'sending' : restore?.status === 'uploading' ? 'sending' : restore?.status ?? null;
  return (
    <div className="live-settings-content min-w-0 space-y-6">
      <SectionCard
        title={t('Backups', 'Backups')}
        description={t('A file with the project’s answers, evidence and history, with checksums. It is made in the background: you can leave this page. The 3 most recent are kept for 30 days.', 'Um arquivo com as respostas, evidências e o histórico do projeto, com checksums. Ele é gerado em segundo plano: você pode sair desta página. Os 3 mais recentes ficam guardados por 30 dias.')}
        action={<Button variant="outline" disabled={demo || running || restoring} pending={starting} onClick={() => void start()}>{t('Make backup', 'Gerar backup')}</Button>}
      >
        {demo ? (
          <Note>{t('Backups are not available in this temporary demo.', 'O backup não está disponível nesta demo temporária.')}</Note>
        ) : listError && !backups ? (
          <EmptyState frame="bare" tone="error" title={t('Could not load the backups.', 'Não foi possível carregar os backups.')} description={listError} onRetry={() => setReload((value) => value + 1)} />
        ) : !backups ? (
          // The size of the one-line answer most projects get ("No backup yet"); a list of backups grows below it.
          <Note status aria-busy="true"><span className="sr-only">{t('Loading backups', 'Carregando backups')}</span><Skeleton inline className="h-lh w-80 max-w-full align-top" /></Note>
        ) : !backups.length ? (
          <Note>{t('No backup yet. Make one to download it or to restore it later.', 'Nenhum backup ainda. Gere um para baixar ou para restaurar depois.')}</Note>
        ) : (
          <DataTable
            singleLine
            rows={backups}
            rowKey={(row) => row.id}
            columns={[
              { key: 'date', header: t('Made on', 'Gerado em'), mobile: 'title', cell: (row) => date(row.created_at) },
              { key: 'size', header: t('Size', 'Tamanho'), label: t('Size', 'Tamanho'), align: 'end', cell: (row) => row.status === 'ready' ? size(row.bytes) : <span className="text-muted-foreground">{t('Not available', 'Indisponível')}</span> },
              {
                key: 'status',
                header: t('State', 'Estado'),
                label: t('State', 'Estado'),
                cell: (row) => row.status === 'running'
                  ? <TagBadge tone="warning"><Spinner />{t('Making', 'Gerando')}</TagBadge>
                  : row.status === 'ready'
                    ? <TagBadge tone="success">{t('Ready', 'Pronto')}</TagBadge>
                    : <TagBadge tone="danger">{t('Failed', 'Falhou')}</TagBadge>,
              },
              {
                key: 'actions',
                header: <span className="sr-only">{t('Actions', 'Ações')}</span>,
                mobile: 'wide',
                align: 'end',
                cell: (row) => row.status === 'ready' ? (
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" nativeButton={false} render={<a href={`${base}/backups/${encodeURIComponent(row.id)}`} download aria-label={t(`Download the backup of ${date(row.created_at)}`, `Baixar o backup de ${date(row.created_at)}`)} />}>{t('Download', 'Baixar')}</Button>
                    <Button variant="ghost" disabled={restoring} onClick={() => { setSource({ backup: row }); setConfirm(true); }}>{t('Restore', 'Restaurar')}</Button>
                  </div>
                ) : row.status === 'failed' ? <span className="text-muted-foreground">{t('Make it again', 'Gere de novo')}</span> : null,
              },
            ]}
          />
        )}
        {startError && <Note tone="danger">{t('Could not start the backup.', 'Não foi possível iniciar o backup.')} {startError}</Note>}
      </SectionCard>
      <SectionCard
        inset="padded"
        title={t('Restore a backup', 'Restaurar backup')}
        description={t('Replaces this project’s answers and history with the backup’s. Settings, prompts and monitoring do not change. A backup of the current state is made first.', 'Troca as respostas e o histórico deste projeto pelos do backup. Configurações, prompts e monitoramento não mudam. Antes, o Lastfind gera um backup do estado atual.')}
      >
        <p className="text-muted-foreground">
          {demo
            ? t('Restoring is not available in this temporary demo.', 'Restaurar não está disponível nesta demo temporária.')
            : selfhost
              ? t('Choose one of the backups above or a backup file of this project. The command npm run storage -- restore also works.', 'Escolha um dos backups acima ou um arquivo de backup deste projeto. O comando npm run storage -- restore também funciona.')
              : t('Choose one of the backups above or a file Lastfind made of this project. Any other file is restored by the Lastfind team.', 'Escolha um dos backups acima ou um arquivo que o Lastfind gerou deste projeto. Outro arquivo, só pela equipe do Lastfind.')}
        </p>
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          accept=".ndjson,application/x-ndjson"
          aria-label={t('Backup file', 'Arquivo de backup')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setSource({ file });
            setConfirm(true);
          }}
        />
        <Button className="mt-4" variant="outline" disabled={demo || restoring} onClick={() => fileInput.current?.click()}>
          {t('Restore from a file', 'Restaurar de um arquivo')}
        </Button>
        <output className="mt-4 block text-body" aria-live="polite">
          {shown === 'sending' && (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <TagBadge tone="warning"><Spinner />{sending ? t('Sending', 'Enviando') : t('Restoring', 'Restaurando')}</TagBadge>
                {sending ? t(`Sending the file: ${formatNumber(locale, sending)}%.`, `Enviando o arquivo: ${formatNumber(locale, sending)}%.`) : t('Starting the restore…', 'Iniciando a restauração…')}
              </span>
              <span className="mt-1 block text-caption text-muted-foreground">{t('Keep this page open until the file is sent. After that, the restore goes on even if you close it.', 'Mantenha esta página aberta até o arquivo ser enviado. Depois, a restauração continua mesmo se você fechar a página.')}</span>
            </>
          )}
          {shown === 'running' && restore && (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <TagBadge tone="warning"><Spinner />{t('Restoring', 'Restaurando')}</TagBadge>
                {restore.step === 'saving'
                  ? t('Keeping a backup of the current state…', 'Guardando um backup do estado atual…')
                  : restore.step === 'uploading'
                    ? t(`Restoring ${restoreLabel(restore)}: ${formatNumber(locale, restore.rows)} records.`, `Restaurando ${restoreLabel(restore)}: ${formatNumber(locale, restore.rows)} registros.`)
                    : t('Verifying the restored data…', 'Verificando os dados restaurados…')}
              </span>
              <span className="mt-1 block text-caption text-muted-foreground">{t('You can close this page: the restore goes on and its state shows here when you come back.', 'Você pode fechar esta página: a restauração continua e o estado aparece aqui quando você voltar.')}</span>
            </>
          )}
          {shown === 'done' && restore && (
            <span className="flex flex-wrap items-center gap-2">
              <TagBadge tone="success">{t('Restored', 'Restaurado')}</TagBadge>
              {t(`The project now has the data of ${restoreLabel(restore)}.`, `O projeto agora tem os dados de ${restoreLabel(restore)}.`)}
            </span>
          )}
          {shown === 'failed' && restore && !restoreError && (
            <span className="flex flex-wrap items-center gap-2">
              <TagBadge tone="danger">{t('Failed', 'Falhou')}</TagBadge>
              {t(`Could not restore ${restoreLabel(restore)}.`, `Não foi possível restaurar ${restoreLabel(restore)}.`)} {restoreFailure(restore)}
            </span>
          )}
          {restoreError && sending === null && (
            <span className="flex flex-wrap items-center gap-2">
              <TagBadge tone="danger">{t('Failed', 'Falhou')}</TagBadge>
              {t('Could not restore the backup.', 'Não foi possível restaurar o backup.')} {restoreError}
            </span>
          )}
        </output>
      </SectionCard>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t(`Restore ${sourceLabel}?`, `Restaurar ${sourceLabel}?`)}
        description={t(`The answers and history of ${projectLabel(project)} are replaced with this backup’s. A backup of the current state is made first, so you can go back. Settings, prompts and monitoring do not change.`, `As respostas e o histórico de ${projectLabel(project)} são trocados pelos deste backup. Antes, o Lastfind gera um backup do estado atual, para você poder voltar. Configurações, prompts e monitoramento não mudam.`)}
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={t('Restore', 'Restaurar')}
        destructive
        onConfirm={() => { setConfirm(false); if (source) void runRestore(source); }}
      />
    </div>
  );
}

/**
 * The project's danger zone (Settings > Brand and market, last; 10/11/2026), owner only: archive (monitoring stops, the
 * history is kept, Settings > Projects brings it back) and delete for good (typing the project's name; POST /api/projects/:id/erase
 * stops its collections at once and erases its data in the background, ARCHITECTURE.md "Archiving, deleting and spending").
 */
export function ProjectDangerZone({ project, owner, busy, t, demo, onArchive, onDelete }: { project: Project; owner: boolean; busy: boolean; t: Copy; demo?: boolean; onArchive: () => Promise<boolean>; onDelete: () => Promise<string | null> }) {
  const typedId = useId();
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiveError, setArchiveError] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const locked = demo || !owner || busy;
  const row = (title: string, description: string, action: ReactNode) => (
    <div className="danger-zone-row">
      <div className="min-w-0">
        <p className="font-(--weight-label)">{title}</p>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
  return (
    <SectionCard inset="padded" title={t('Danger zone', 'Zona de perigo')} description={demo ? t('Not available in this temporary demo.', 'Indisponível nesta demo temporária.') : !owner ? t('Only the workspace owner can archive or delete this project.', 'Só o dono do workspace pode arquivar ou excluir este projeto.') : undefined}>
      <div className="danger-zone">
        {row(
          t('Archive project', 'Arquivar projeto'),
          t('Stops monitoring and removes the project from the project menu. Its history is kept: bring it back in Settings > Projects, under Archived.', 'Para o monitoramento e tira o projeto do menu de projetos. O histórico fica guardado: traga-o de volta em Configurações > Projetos, em Arquivados.'),
          <Button variant="outline" disabled={locked} onClick={() => { setArchiveError(false); setArchiveConfirm(true); }}>{t('Archive project', 'Arquivar projeto')}</Button>,
        )}
        {row(
          t('Delete project', 'Excluir projeto'),
          t('Deletes the project and all its data for good. This cannot be undone.', 'Exclui o projeto e todos os seus dados para sempre. Não dá para desfazer.'),
          <Button variant="destructive" disabled={locked} onClick={() => { setTyped(''); setDeleteError(''); setDeleteOpen(true); }}>{t('Delete project', 'Excluir projeto')}</Button>,
        )}
      </div>
      {archiveError && <Note tone="danger" className="px-0">{t('Could not archive the project. Try again.', 'Não foi possível arquivar o projeto. Tente de novo.')}</Note>}
      <ConfirmDialog
        open={archiveConfirm}
        onOpenChange={setArchiveConfirm}
        title={t(`Archive ${projectLabel(project)}?`, `Arquivar ${projectLabel(project)}?`)}
        description={t('Monitoring stops and the project leaves the project menu. Answers and history are kept.', 'O monitoramento para e o projeto sai do menu de projetos. Respostas e histórico ficam guardados.')}
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={t('Archive project', 'Arquivar projeto')}
        destructive
        pending={busy}
        onConfirm={async () => { setArchiveConfirm(false); if (!(await onArchive())) setArchiveError(true); }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => { if (!deleting) setDeleteOpen(open); }}
        title={t(`Delete ${projectLabel(project)}?`, `Excluir ${projectLabel(project)}?`)}
        description={t('This deletes the project for good and cannot be undone. Its collections and scheduled spending stop right away. Deleted:', 'Isto exclui o projeto para sempre e não dá para desfazer. As coletas e os gastos agendados param na hora. É excluído:')}
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={t('Delete project', 'Excluir projeto')}
        destructive
        pending={deleting}
        confirmDisabled={typed.trim() !== projectLabel(project)}
        onConfirm={async () => {
          setDeleting(true);
          setDeleteError('');
          const failure = await onDelete();
          setDeleting(false);
          if (failure) setDeleteError(failure);
          else setDeleteOpen(false);
        }}
      >
        <ul className="danger-zone-list">
          <li>{t('the answers collected, with the original AI answers', 'as respostas coletadas, com as respostas originais das IAs')}</li>
          <li>{t('reports, Semantic Branding and brand analysis', 'relatórios, Semantic Branding e análise de marcas')}</li>
          <li>{t('prompts, topics, competitors and the collection schedule', 'prompts, tópicos, concorrentes e a agenda de coleta')}</li>
          <li>{t('the agent’s conversations, artifacts, contents and Brain', 'as conversas, artefatos, conteúdos e o Cérebro do agente')}</li>
          <li>{t('the project’s backups', 'os backups do projeto')}</li>
        </ul>
        <p className="text-body text-muted-foreground">{t('Usage and spending records stay, as the monthly limits count them. To keep a copy, download a backup in Project data first.', 'Os registros de uso e gasto ficam, como os limites mensais os contam. Para guardar uma cópia, baixe antes um backup em Dados do projeto.')}</p>
        <Field>
          <FieldLabel htmlFor={typedId}>{t(`Type ${projectLabel(project)} to confirm`, `Digite ${projectLabel(project)} para confirmar`)}</FieldLabel>
          <Input id={typedId} autoComplete="off" value={typed} placeholder={projectLabel(project)} onChange={(event) => setTyped(event.target.value)} />
        </Field>
        {deleteError && <p role="alert" className="text-body text-destructive">{t('Could not delete the project.', 'Não foi possível excluir o projeto.')} {deleteError}</p>}
      </ConfirmDialog>
    </SectionCard>
  );
}

type ArchivedProject = { id: string; name: string; domain: string; created_at: string };
/** Settings > Projects, owner only: the archived projects, collapsed, each one can be brought back to the project menu. */
export function ArchivedProjects({ t, onUnarchived }: { t: Copy; onUnarchived: (id: string) => Promise<unknown> }) {
  const [projects, setProjects] = useState<ArchivedProject[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ArchivedProject | null>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    let active = true;
    requestOk<{ projects: ArchivedProject[] }>('/api/projects/archived')
      .then((value) => { if (active) { setProjects(value.projects); setError(''); } })
      .catch((cause) => { if (active) setError(shownMessage(cause, t)); });
    return () => { active = false; };
  }, [reload, t]);
  if (!error && !projects?.length) return null;
  async function unarchive(project: ArchivedProject) {
    setWorking(true);
    setActionError('');
    try {
      await requestOk(`/api/projects/${encodeURIComponent(project.id)}/unarchive`, { method: 'POST', body: '{}' });
      setReload((value) => value + 1);
      await onUnarchived(project.id);
    } catch (cause) {
      setActionError(shownMessage(cause, t));
    } finally {
      setWorking(false);
    }
  }
  return (
    <SectionCard
      title={t(`Archived (${projects?.length ?? 0})`, `Arquivados (${projects?.length ?? 0})`)}
      description={t('Projects taken out of the menu. Their history is kept.', 'Projetos tirados do menu. O histórico fica guardado.')}
      action={projects?.length ? <Button variant="outline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? t('Hide', 'Ocultar') : t('Show', 'Mostrar')}</Button> : undefined}
    >
      {error ? (
        <EmptyState frame="bare" tone="error" title={t('Could not load the archived projects.', 'Não foi possível carregar os projetos arquivados.')} description={error} onRetry={() => setReload((value) => value + 1)} />
      ) : open && projects ? (
        <DataTable
          singleLine
          rows={projects}
          rowKey={(row) => row.id}
          columns={[
            { key: 'name', header: t('Project', 'Projeto'), mobile: 'title', cell: (row) => row.name },
            { key: 'domain', header: t('Domain', 'Domínio'), label: t('Domain', 'Domínio'), cell: (row) => row.domain },
            {
              key: 'actions',
              header: <span className="sr-only">{t('Actions', 'Ações')}</span>,
              mobile: 'wide',
              align: 'end',
              cell: (row) => <Button variant="outline" disabled={working} onClick={() => { setActionError(''); setChosen(row); }}>{t('Unarchive', 'Desarquivar')}</Button>,
            },
          ]}
        />
      ) : null}
      {actionError && <Note tone="danger">{t('Could not unarchive the project.', 'Não foi possível desarquivar o projeto.')} {actionError}</Note>}
      <ConfirmDialog
        open={!!chosen}
        onOpenChange={(value) => { if (!value) setChosen(null); }}
        title={t(`Unarchive ${chosen?.name ?? ''}?`, `Desarquivar ${chosen?.name ?? ''}?`)}
        description={t('The project returns to the project menu with its history. Its prompts count toward the limits again. Monitoring stays paused until you resume it in Monitoring.', 'O projeto volta ao menu de projetos com o histórico. Os prompts dele voltam a contar nos limites. O monitoramento fica pausado até você retomá-lo em Monitoramento.')}
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={t('Unarchive', 'Desarquivar')}
        pending={working}
        onConfirm={() => { const project = chosen; setChosen(null); if (project) void unarchive(project); }}
      />
    </SectionCard>
  );
}
