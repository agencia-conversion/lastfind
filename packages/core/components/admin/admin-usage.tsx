'use client';
// Admin > Usage and costs: where the money goes, in the shape of a cost console (Vercel usage,
// OpenAI usage, Datadog cost): the platform's day and month next to its brake, then one table per view (module, project, AI or
// model, agent, workspace, day) with real next to held, each project's budget burn with its alarm and what blocks it, and the platform's
// brake itself, then the Cloudflare account's own usage and cost (admin-cloudflare.tsx). Catalog components only; every sum is the one the reservation guards read (lib/server/admin-usage.ts).
import { Fragment, useEffect, useId, useState, type FormEvent } from 'react';
import { CircleAlert, Pencil } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { ENGINE_LABELS } from '@/lib/engines';
import type { Engine } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { SelectField } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { DataTable, DataTableToolbar, skeletonColumns, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { MODEL_PROVIDER_NAMES, type ModelProvider } from '@/lib/model-providers';
import { Hint } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/analytics/shared';
import { blockLabel, moduleLabel, usdFormat } from '@/components/analytics/spend-labels';
import { wholeCredits } from '@/lib/usage-meter';
import { AdminLoadError } from './admin-states';
import { CloudflareUsage } from './admin-cloudflare';

type Cell = { realUsd: number; spendUsd: number; items: number };
type Line = Cell & { key: string };
type Plan = {
  plan: string;
  collectionCredits: { used: number; limit: number | null };
  agentCredits: { used: number; limit: number | null; usd: number };
  projects: { used: number; limit: number | null };
};
type Project = {
  id: string;
  name: string;
  domain: string;
  archived: boolean;
  owner: string;
  workspace: string;
  budgetUsd: number | null;
  spentUsd: number;
  custom: boolean;
  share: number;
  projectedUsd: number | null;
  exhausted: boolean;
  alarm: boolean;
  blocked: { reason: string; module: string; at: string } | null;
  evaluations: { enabled: boolean; automatic: boolean; revision: number } | null;
};
export type UsageData = {
  months: string[];
  platform: {
    monthUsd: number;
    dayUsd: number;
    limits: { monthUsd: number | null; dayUsd: number | null; dailyRuns: number | null };
    defaults: { monthUsd: number | null; dayUsd: number | null };
    custom: { monthUsd: boolean; dayUsd: boolean; dailyRuns: boolean };
    runsToday: number;
    dailyRunsDefault: number | null;
  };
  totals: Record<string, Record<string, Cell>>;
  views: Record<string, { module: Line[]; project: Line[]; engine: Line[]; workspace: Line[]; projectModules: Record<string, Record<string, Cell>>; agent?: Record<AgentGroup, Line[]> }>;
  days: { day: string; modules: Record<string, Cell> }[];
  /** Model calls per provider and month (OpenAI, Anthropic, OpenRouter): calls served, their cost, and failovers to the next provider. */
  modelProviders?: Record<string, { provider: string; calls: number; failovers: number; costUsd: number; unpriced: number }[]>;
  projects: Project[];
  workspaces: { id: string; email: string; plan: Plan | null }[];
  blocks: number;
};
type Copy = (en: string, pt: string) => string;
type AgentGroup = 'project' | 'model' | 'day';

const sum = (cells: Record<string, Cell> | undefined) =>
  Object.values(cells ?? {}).reduce((total, cell) => ({ realUsd: total.realUsd + cell.realUsd, spendUsd: total.spendUsd + cell.spendUsd, items: total.items + cell.items }), { realUsd: 0, spendUsd: 0, items: 0 });
const held = (cell: Cell) => Math.max(0, cell.spendUsd - cell.realUsd);
const monthLabel = (month: string, locale: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (day: string, locale: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { day: '2-digit', month: 'short', timeZone: 'UTC' });

async function patch(body: Record<string, unknown>) {
  const response = await fetch('/api/admin/usage', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response?.ok) throw new Error(typeof json?.error === 'string' ? json.error : `HTTP ${response?.status ?? 0}`);
  return json as unknown as UsageData;
}

/** The money columns every view shares: what counts, the real part, the held part and the share of the period. */
function moneyColumns<T extends Cell>(t: Copy, usd: (value: number) => string, total: number, locale: string): DataColumn<T>[] {
  return [
    { key: 'spend', header: t('Counts', 'Conta'), label: t('Counts', 'Conta'), align: 'end', sortValue: (row) => row.spendUsd, cell: (row) => usd(row.spendUsd), info: t('Real cost plus what is held: the number the limits read.', 'Custo real mais o reservado: o número que os limites leem.') },
    { key: 'real', header: t('Real', 'Real'), label: t('Real', 'Real'), align: 'end', sortValue: (row) => row.realUsd, cell: (row) => usd(row.realUsd) },
    { key: 'held', header: t('Held', 'Reservado'), label: t('Held', 'Reservado'), align: 'end', sortValue: held, cell: (row) => usd(held(row)) },
    { key: 'share', header: t('Share', 'Parcela'), label: t('Share', 'Parcela'), align: 'end', mobile: 'hide', sortValue: (row) => row.spendUsd, cell: (row) => (total > 0 ? `${(Math.round((row.spendUsd / total) * 1000) / 10).toLocaleString(locale)}%` : '') },
  ];
}

/** A project's budget, set from Admin: not held to the plan's maximum; no budget is allowed. Logged with the admin's name. */
function BudgetEditor({ project, t, usd, onClose, onSaved }: { project: Project; t: Copy; usd: (value: number) => string; onClose: () => void; onSaved: (data: UsageData) => void }) {
  const id = useId();
  const [value, setValue] = useState(project.custom && project.budgetUsd !== null ? String(project.budgetUsd) : '');
  const [unlimited, setUnlimited] = useState(project.custom && project.budgetUsd === null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(value.replace(',', '.'));
    if (!unlimited && value.trim() && !(Number.isFinite(amount) && amount >= 0)) return setError(t('Enter 0 or more.', 'Informe 0 ou mais.'));
    setBusy(true);
    try {
      onSaved(await patch({ action: 'budget', projectId: project.id, monthlyUsd: unlimited ? null : value.trim() ? amount : 'default' }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`Budget of ${project.name}`, `Orçamento de ${project.name}`)}</DialogTitle>
          <DialogDescription>{t('Everything the project may spend each month. From Admin it is not held to the plan; the change is logged with your name.', 'Tudo o que o projeto pode gastar por mês. Pelo Admin não fica preso ao plano; a alteração fica registrada com seu nome.')}</DialogDescription>
        </DialogHeader>
        <form id={`${id}-form`} onSubmit={submit} noValidate>
          <FieldGroup className="gap-5">
            <Field orientation="horizontal">
              <Switch id={`${id}-none`} checked={unlimited} disabled={busy} onCheckedChange={(on) => { setUnlimited(on); setError(''); }} />
              <FieldLabel htmlFor={`${id}-none`}>{t('No budget', 'Sem orçamento')}</FieldLabel>
            </Field>
            {!unlimited && (
              <Field data-invalid={Boolean(error) || undefined}>
                <FieldLabel htmlFor={`${id}-usd`}>{t('Budget per month (US$)', 'Orçamento por mês (US$)')}</FieldLabel>
                <Input id={`${id}-usd`} inputMode="decimal" value={value} disabled={busy} aria-invalid={Boolean(error) || undefined} onChange={(event) => { setValue(event.target.value); setError(''); }} />
                <FieldDescription>{t(`Empty goes back to the default. Now: ${project.budgetUsd === null ? 'no budget' : usd(project.budgetUsd)}.`, `Vazio volta ao padrão. Agora: ${project.budgetUsd === null ? 'sem orçamento' : usd(project.budgetUsd)}.`)}</FieldDescription>
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t('Cancel', 'Cancelar')}</Button>
          <Button type="submit" form={`${id}-form`} pending={busy} pendingLabel={t('Saving…', 'Salvando…')}>{t('Save', 'Salvar')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The platform's brake: this month's and today's dollars and today's collections. Empty is the edition's default. */
function PlatformLimits({ data, t, usd, locale, onSaved }: { data: UsageData; t: Copy; usd: (value: number) => string; locale: string; onSaved: (data: UsageData) => void }) {
  const id = useId();
  const { limits, custom, defaults } = data.platform;
  const initial = { monthUsd: custom.monthUsd ? String(limits.monthUsd) : '', dayUsd: custom.dayUsd ? String(limits.dayUsd) : '', dailyRuns: custom.dailyRuns ? String(limits.dailyRuns) : '' };
  const [form, setForm] = useState(initial);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' });
  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  const fallback = (value: number | null, money = true) => (value === null ? t('none', 'nenhum') : money ? usd(value) : value.toLocaleString(locale));
  const fields = [
    { key: 'monthUsd' as const, label: t('All projects, per month (US$)', 'Todos os projetos, por mês (US$)'), fallback: fallback(defaults.monthUsd) },
    { key: 'dayUsd' as const, label: t('All projects, per day (US$)', 'Todos os projetos, por dia (US$)'), fallback: fallback(defaults.dayUsd) },
    { key: 'dailyRuns' as const, label: t('Collections per day', 'Coletas por dia'), fallback: fallback(data.platform.dailyRunsDefault, false) },
  ];
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setState({ kind: 'saving' });
    try {
      onSaved(await patch({ action: 'platform', ...Object.fromEntries(fields.map((field) => [field.key, form[field.key].trim() === '' ? null : Number(form[field.key].replace(',', '.'))])) }));
      setState({ kind: 'saved' });
    } catch (cause) {
      setState({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) });
    }
  };
  return (
    <SectionCard
      title={t('Platform brake', 'Freio da plataforma')}
      info={t('An operations safety brake over every project together, not a product limit: past it, paid work waits for the next day or month. Each project has its own budget above. Empty uses the default.', 'Um freio de segurança da operação sobre todos os projetos juntos, não um limite de produto: passado dele, o trabalho pago espera o próximo dia ou mês. Cada projeto tem o próprio orçamento acima. Vazio usa o padrão.')}
      inset="padded"
    >
      <form id={`${id}-form`} onSubmit={save} noValidate className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          {fields.map((field) => (
            <Field key={field.key}>
              <FieldLabel htmlFor={`${id}-${field.key}`}>{field.label}</FieldLabel>
              <Input id={`${id}-${field.key}`} inputMode="decimal" value={form[field.key]} placeholder={field.fallback} disabled={state.kind === 'saving'} onChange={(event) => { setForm({ ...form, [field.key]: event.target.value }); setState({ kind: 'idle' }); }} />
              <FieldDescription>{t(`Default: ${field.fallback}.`, `Padrão: ${field.fallback}.`)}</FieldDescription>
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={!changed} pending={state.kind === 'saving'} pendingLabel={t('Saving…', 'Salvando…')}>{t('Save', 'Salvar')}</Button>
          <output className="text-body text-muted-foreground">{state.kind === 'saved' ? t('Saved.', 'Salvo.') : state.kind === 'error' ? <span className="text-destructive">{state.message}</span> : null}</output>
        </div>
      </form>
    </SectionCard>
  );
}

/** Cloud: a project's automatic evaluations (sentiment and source types), on the row its owner set up; logged with the admin's name. */
function AutomaticSwitch({ project, t, onSaved }: { project: Project; t: Copy; onSaved: (data: UsageData) => void }) {
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const evaluations = project.evaluations;
  if (!evaluations) return <span className="whitespace-nowrap text-muted-foreground">{t('Not set up', 'Não configuradas')}</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <Switch
        aria-label={`${t('Automatic evaluations', 'Avaliações automáticas')}: ${project.name}`}
        checked={evaluations.automatic}
        disabled={!evaluations.enabled || state === 'saving'}
        onCheckedChange={async (on) => {
          setState('saving');
          try {
            onSaved(await patch({ action: 'automatic', projectId: project.id, automatic: on, expectedRevision: evaluations.revision }));
            setState('idle');
          } catch {
            setState('error');
          }
        }}
      />
      {state === 'error' && <span className="text-destructive">{t('Not saved', 'Não salvo')}</span>}
    </span>
  );
}

function UsageSkeleton({ t }: { t: Copy }) {
  return (
    <>
      <MetricGridSkeleton count={5} description label={t('Loading usage', 'Carregando uso')} />
      <SectionCard title={t('Where the money goes', 'Para onde vai o dinheiro')}>
        <DataTable loading={6} ariaLabel={t('Loading usage', 'Carregando uso')} rows={[]} rowKey={String} columns={skeletonColumns(5)} />
      </SectionCard>
    </>
  );
}

/** Used of a plan quantity; AI credits whole, rounded up (lib/usage-meter.ts). */
const usageLabel = (used: number, limit: number | null, locale: string, t: Copy) => {
  const spent = wholeCredits(used, 'used').toLocaleString(locale);
  return limit === null ? t(`${spent} (no limit)`, `${spent} (sem limite)`) : `${spent} / ${limit.toLocaleString(locale)}`;
};

export function AdminUsage() {
  const { locale } = useI18n();
  const t: Copy = (en, pt) => (locale === 'pt-BR' ? pt : en);
  const usd = usdFormat(locale);
  const [data, setData] = useState<UsageData | null>(null);
  const [failed, setFailed] = useState(false);
  const [month, setMonth] = useState<string | null>(null);
  const [view, setView] = useState('project');
  const [agentBy, setAgentBy] = useState<AgentGroup>('project');
  const [editing, setEditing] = useState<Project | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    fetch('/api/admin/usage')
      .then((response) => (response.ok ? (response.json() as Promise<UsageData>) : Promise.reject(new Error(String(response.status)))))
      .then((value) => active && (setData(value), setFailed(false)), () => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [retry]);
  if (failed) return <AdminLoadError />;
  if (!data) return <UsageSkeleton t={t} />;
  const current = data.months[0];
  const selected = month ?? current;
  const views = data.views[selected];
  const total = sum(data.totals[selected]);
  const { platform } = data;
  // An archived project shows only in a month it spent.
  const projects = data.projects.filter((project) => !project.archived || (views?.project.find((line) => line.key === project.id)?.spendUsd ?? 0) > 0);
  const flagged = data.projects.filter((project) => !project.archived && (project.blocked || project.alarm || project.exhausted));
  const limitText = (spent: number, limit: number | null) => (limit === null ? t('no brake', 'sem freio') : t(`of ${usd(limit)} (${Math.round((spent / Math.max(limit, 1e-9)) * 100)}%)`, `de ${usd(limit)} (${Math.round((spent / Math.max(limit, 1e-9)) * 100)}%)`));
  // An AI view key is `<engine|model>:<module>:<name>` (lib/server/admin-usage.ts); a model id may hold a colon of its own.
  const engineLine = (key: string) => {
    const [kind, module] = key.split(':', 2);
    return { kind, module, name: key.slice(kind.length + module.length + 2) };
  };
  const engineName = (key: string) => {
    const { kind, name } = engineLine(key);
    return kind === 'engine' ? (ENGINE_LABELS[name as Engine] ?? name) : name === 'google' ? 'Google Search' : name || t('Unknown model', 'Modelo desconhecido');
  };
  // The agent's spend in AI credits, as the sidebar and the chat count them (Cloud; an edition without plans has none).
  const creditUsd = data.workspaces.find((workspace) => workspace.plan)?.plan?.agentCredits.usd ?? null;
  const credits = (spendUsd: number) => (creditUsd ? wholeCredits(spendUsd / creditUsd, 'used').toLocaleString(locale) : '');
  const agentCell = data.totals[selected]?.agent ?? { realUsd: 0, spendUsd: 0, items: 0 };
  const agentLines = views?.agent?.[agentBy] ?? [];
  const projectName = (id: string) => data.projects.find((project) => project.id === id)?.name ?? t('Deleted project', 'Projeto excluído');
  const agentFirst: Record<AgentGroup, DataColumn<Line>> = {
    project: { key: 'name', header: t('Project', 'Projeto'), mobile: 'title', shrinkTo: '12rem', width: '20rem', hint: (row) => projectName(row.key), sortValue: (row) => projectName(row.key), cell: (row) => projectName(row.key) },
    model: { key: 'name', header: t('Model', 'Modelo'), mobile: 'title', shrinkTo: '12rem', width: '20rem', hint: (row) => row.key, sortValue: (row) => row.key, cell: (row) => row.key || t('Unknown model', 'Modelo desconhecido') },
    day: { key: 'name', header: t('Day (UTC)', 'Dia (UTC)'), mobile: 'title', sortValue: (row) => row.key, cell: (row) => dayLabel(row.key, locale) },
  };
  const agentColumns: DataColumn<Line>[] = [
    agentFirst[agentBy],
    ...moneyColumns<Line>(t, usd, agentCell.spendUsd, locale),
    ...(creditUsd ? [{ key: 'credits', header: t('AI credits', 'Créditos de IA'), label: t('AI credits', 'Créditos de IA'), align: 'end' as const, mobile: 'hide' as const, info: t('What the agent spent, in the AI credits of the sidebar and the chat.', 'O que o agente gastou, nos créditos de IA da barra lateral e do chat.'), sortValue: (row: Line) => row.spendUsd, cell: (row: Line) => credits(row.spendUsd) }] : []),
    { key: 'items', header: t('Answers', 'Respostas'), label: t('Answers', 'Respostas'), align: 'end', mobile: 'hide', info: t('One per message the agent answered, stopped and failed ones included.', 'Uma por mensagem que o agente respondeu, incluindo as interrompidas e as que falharam.'), sortValue: (row) => row.items, cell: (row) => row.items.toLocaleString(locale) },
  ];
  const status = (project: Project) =>
    project.blocked ? (
      <Hint content={`${blockLabel(project.blocked.reason, t)} (${moduleLabel(project.blocked.module, t)})`}>
        <TagBadge tone="danger">{t('Blocked', 'Bloqueado')}</TagBadge>
      </Hint>
    ) : project.exhausted ? (
      <TagBadge tone="danger">{t('Used up', 'Esgotado')}</TagBadge>
    ) : project.alarm ? (
      <TagBadge tone="warning">{project.share >= 0.8 ? t('Over 80%', 'Acima de 80%') : t('Will run out', 'Vai acabar')}</TagBadge>
    ) : (
      <TagBadge tone="success">{t('OK', 'OK')}</TagBadge>
    );
  const empty = <EmptyState frame="bare" title={t('Nothing spent in this month', 'Nada gasto neste mês')} description={t('Each line shows once a paid call is reserved.', 'Cada linha aparece quando uma chamada paga é reservada.')} />;
  const projectColumns: DataColumn<Project>[] = [
    { key: 'project', header: t('Project', 'Projeto'), mobile: 'title', shrinkTo: '12rem', width: '20rem', hint: (row) => `${row.name}, ${row.owner}`, sortValue: (row) => row.name, cell: (row) => `${row.name}${row.archived ? ` (${t('archived', 'arquivado')})` : ''}` },
    { key: 'status', header: t('State', 'Estado'), label: t('State', 'Estado'), sortValue: (row) => (row.blocked ? 0 : row.exhausted ? 1 : row.alarm ? 2 : 3), cell: status },
    { key: 'month', header: t('Spent', 'Gasto'), label: t('Spent', 'Gasto'), align: 'end', sortValue: (row) => views?.project.find((line) => line.key === row.id)?.spendUsd ?? 0, cell: (row) => usd(views?.project.find((line) => line.key === row.id)?.spendUsd ?? 0), info: t(`In ${monthLabel(selected, locale)}, by when each call was sent.`, `Em ${monthLabel(selected, locale)}, pela data em que cada chamada foi enviada.`) },
    ...(selected === current
      ? [
          { key: 'spent', header: t('Budget used', 'Orçamento usado'), label: t('Budget used', 'Orçamento usado'), align: 'end' as const, maxWidth: '12rem', sortValue: (row: Project) => row.share, cell: (row: Project) => (row.budgetUsd === null ? usd(row.spentUsd) : `${usd(row.spentUsd)} / ${usd(row.budgetUsd)}`), info: t('What the reservation guard reads now, held work from earlier months included.', 'O que a guarda de reserva lê agora, incluindo trabalho reservado de meses anteriores.') },
          { key: 'projected', header: t('By month end', 'Até o fim do mês'), label: t('By month end', 'Até o fim do mês'), align: 'end' as const, mobile: 'hide' as const, sortValue: (row: Project) => row.projectedUsd, cell: (row: Project) => (row.projectedUsd === null ? '' : usd(row.projectedUsd)) },
        ]
      : []),
    ...(data.projects.some((project) => project.evaluations)
      ? [{ key: 'automatic', header: t('Evaluations', 'Avaliações'), label: t('Automatic evaluations', 'Avaliações automáticas'), mobile: 'hide' as const, info: t('Automatic evaluations (sentiment and source types), switched here; the change is logged with your name.', 'Avaliações automáticas (sentimento e tipos de fonte), ligadas aqui; a alteração fica registrada com seu nome.'), cell: (row: Project) => <AutomaticSwitch project={row} t={t} onSaved={setData} /> }]
      : []),
    {
      key: 'edit',
      header: <span className="sr-only">{t('Budget', 'Orçamento')}</span>,
      mobile: 'actions',
      align: 'end',
      width: 48,
      cell: (row) => (
        <Hint text={t('Budget', 'Orçamento')}>
          <Button variant="ghost" size="icon-xs" aria-label={t(`Budget of ${row.name}`, `Orçamento de ${row.name}`)} onClick={() => setEditing(row)}>
            <Pencil aria-hidden="true" />
          </Button>
        </Hint>
      ),
    },
  ];
  const content = () => {
    if (view === 'project')
      return projects.length ? (
        <DataTable singleLine="wide" ariaLabel={t('Spend by project', 'Gasto por projeto')} rows={projects} rowKey={(row) => row.id} defaultSort={{ key: selected === current ? 'spent' : 'month', direction: 'desc' }} columns={projectColumns} />
      ) : (
        <EmptyState frame="bare" title={t('No project yet', 'Nenhum projeto ainda')} />
      );
    if (view === 'module')
      return views?.module.length ? (
        <DataTable singleLine="wide" ariaLabel={t('Spend by module', 'Gasto por módulo')} rows={views.module} rowKey={(row) => row.key} defaultSort={{ key: 'spend', direction: 'desc' }} columns={[
          { key: 'module', header: t('Module', 'Módulo'), mobile: 'title', shrinkTo: '12rem', width: '20rem', cell: (row) => moduleLabel(row.key, t) },
          ...moneyColumns<Line>(t, usd, total.spendUsd, locale),
          { key: 'items', header: t('Calls', 'Chamadas'), label: t('Calls', 'Chamadas'), align: 'end', mobile: 'hide', sortValue: (row) => row.items, cell: (row) => row.items.toLocaleString(locale) },
        ]} />
      ) : empty;
    if (view === 'engine')
      return views?.engine.length ? (
        <DataTable singleLine="wide" ariaLabel={t('Spend by AI or model', 'Gasto por IA ou modelo')} rows={views.engine} rowKey={(row) => row.key} defaultSort={{ key: 'spend', direction: 'desc' }} columns={[
          { key: 'engine', header: t('AI or model', 'IA ou modelo'), mobile: 'title', shrinkTo: '12rem', width: '20rem', hint: (row) => engineName(row.key), cell: (row) => engineName(row.key) },
          { key: 'kind', header: t('Module', 'Módulo'), label: t('Module', 'Módulo'), mobile: 'hide', maxWidth: '20rem', sortValue: (row) => engineLine(row.key).module, cell: (row) => moduleLabel(engineLine(row.key).module, t) },
          ...moneyColumns<Line>(t, usd, total.spendUsd, locale),
        ]} />
      ) : empty;
    if (view === 'provider') {
      const lines = data.modelProviders?.[selected] ?? [];
      const spent = lines.reduce((sum, line) => sum + line.costUsd, 0);
      return lines.length ? (
        <>
          <Note>{t('The model calls of every module (classifiers, wizards, intents, learning and the agent), by the provider that answered them, in the order set in Admin, Providers. Cost is what OpenRouter reported, or the provider\'s tokens at its list price for OpenAI and Anthropic; their own dashboards have the bill.', 'As chamadas de modelo de todos os módulos (classificadores, wizards, intenções, aprendizado e agente), pelo provedor que as respondeu, na ordem definida em Admin, Provedores. O custo é o que o OpenRouter informou, ou os tokens do provedor a preço de tabela para OpenAI e Anthropic; os painéis deles têm a fatura.')}</Note>
          <DataTable singleLine="wide" ariaLabel={t('Model calls by provider', 'Chamadas de modelo por provedor')} rows={lines} rowKey={(row) => row.provider} defaultSort={{ key: 'cost', direction: 'desc' }} columns={[
            { key: 'provider', header: t('Provider', 'Provedor'), mobile: 'title', shrinkTo: '12rem', width: '20rem', cell: (row) => MODEL_PROVIDER_NAMES[row.provider as ModelProvider] ?? row.provider },
            { key: 'cost', header: t('Cost', 'Custo'), label: t('Cost', 'Custo'), align: 'end', sortValue: (row) => row.costUsd, cell: (row) => usd(row.costUsd) },
            { key: 'share', header: t('Share', 'Parcela'), label: t('Share', 'Parcela'), align: 'end', mobile: 'hide', sortValue: (row) => row.costUsd, cell: (row) => (spent > 0 ? `${Math.round((row.costUsd / spent) * 100)}%` : '') },
            { key: 'calls', header: t('Calls', 'Chamadas'), label: t('Calls', 'Chamadas'), align: 'end', sortValue: (row) => row.calls, cell: (row) => row.calls.toLocaleString(locale) },
            { key: 'failovers', header: t('Moved to the next', 'Passadas ao próximo'), label: t('Moved to the next', 'Passadas ao próximo'), align: 'end', mobile: 'hide', sortValue: (row) => row.failovers, cell: (row) => row.failovers.toLocaleString(locale), info: t('Calls this provider refused (no credit, quota, rate limit, server error) and the next provider in the order answered.', 'Chamadas que este provedor recusou (sem crédito, cota, limite de taxa, erro do servidor) e o próximo provedor da ordem respondeu.') },
            { key: 'unpriced', header: t('No price', 'Sem preço'), label: t('No price', 'Sem preço'), align: 'end', mobile: 'hide', sortValue: (row) => row.unpriced, cell: (row) => row.unpriced.toLocaleString(locale), info: t('Calls with no cost to show: the provider reported none, or the model has no list price here. Their jobs keep the reservation.', 'Chamadas sem custo para mostrar: o provedor não informou, ou o modelo não tem preço de tabela aqui. Os jobs delas mantêm a reserva.') },
          ]} />
        </>
      ) : (
        <EmptyState frame="bare" title={t('No model call in this month', 'Nenhuma chamada de modelo neste mês')} description={t('Each call to OpenAI, Anthropic or OpenRouter shows here by the provider that answered it.', 'Cada chamada a OpenAI, Anthropic ou OpenRouter aparece aqui pelo provedor que a respondeu.')} />
      );
    }
    if (view === 'agent')
      return agentLines.length ? (
        <DataTable singleLine="wide" ariaLabel={t('Agent spend', 'Gasto do agente')} rows={agentLines} rowKey={(row) => row.key} defaultSort={agentBy === 'day' ? { key: 'name', direction: 'desc' } : { key: 'spend', direction: 'desc' }} columns={agentColumns} />
      ) : (
        <EmptyState frame="bare" title={t('The agent spent nothing in this month', 'O agente não gastou nada neste mês')} description={t('Each answer of the agent shows here once it is reserved.', 'Cada resposta do agente aparece aqui quando é reservada.')} />
      );
    if (view === 'workspace') {
      type WorkspaceRow = Cell & { id: string; email: string; plan: Plan | null };
      const columns: DataColumn<WorkspaceRow>[] = [
        { key: 'workspace', header: t('Workspace', 'Workspace'), mobile: 'title', shrinkTo: '12rem', width: '20rem', hint: (row) => row.email, cell: (row) => row.email },
        { key: 'plan', header: t('Plan', 'Plano'), label: t('Plan', 'Plano'), maxWidth: '10rem', cell: (row) => row.plan?.plan ?? '' },
        ...moneyColumns<WorkspaceRow>(t, usd, total.spendUsd, locale).slice(0, 3),
        { key: 'agent', header: t('AI credits', 'Créditos de IA'), label: t('AI credits', 'Créditos de IA'), align: 'end', mobile: 'hide', maxWidth: '10rem', cell: (row) => (row.plan ? usageLabel(row.plan.agentCredits.used, row.plan.agentCredits.limit, locale, t) : '') },
        { key: 'credits', header: t('Collection credits', 'Créditos de coleta'), label: t('Collection credits', 'Créditos de coleta'), align: 'end', mobile: 'hide', maxWidth: '10rem', cell: (row) => (row.plan ? usageLabel(row.plan.collectionCredits.used, row.plan.collectionCredits.limit, locale, t) : '') },
      ];
      // Plan columns only where plans exist (the hosted edition); an installation without plans has nothing to show in them.
      const planned = data.workspaces.some((row) => row.plan);
      return data.workspaces.length ? (
        <DataTable singleLine="wide" ariaLabel={t('Spend by workspace', 'Gasto por workspace')} rows={data.workspaces.map((workspace) => ({ ...workspace, ...(views?.workspace.find((line) => line.key === workspace.id) ?? { realUsd: 0, spendUsd: 0, items: 0 }) }))} rowKey={(row) => row.id} defaultSort={{ key: 'spend', direction: 'desc' }}
          columns={columns.filter((column) => planned || !['plan', 'agent', 'credits'].includes(column.key))} />
      ) : empty;
    }
    return data.days.length ? (
      <DataTable singleLine="wide" ariaLabel={t('Spend by day', 'Gasto por dia')} rows={data.days.map((day) => ({ ...day, ...sum(day.modules), top: Object.entries(day.modules).sort(([, a], [, b]) => b.spendUsd - a.spendUsd)[0]?.[0] ?? '' }))} rowKey={(row) => row.day} columns={[
        { key: 'day', header: t('Day (UTC)', 'Dia (UTC)'), mobile: 'title', sortValue: (row) => row.day, cell: (row) => dayLabel(row.day, locale) },
        ...moneyColumns<Cell & { day: string }>(t, usd, 0, locale).slice(0, 3),
        { key: 'top', header: t('Largest module', 'Maior módulo'), label: t('Largest module', 'Maior módulo'), mobile: 'hide', maxWidth: '20rem', cell: (row) => moduleLabel(row.top, t) },
        { key: 'limit', header: t('Day brake', 'Freio do dia'), label: t('Day brake', 'Freio do dia'), align: 'end', mobile: 'hide', cell: (row) => (platform.limits.dayUsd ? `${Math.round((row.spendUsd / platform.limits.dayUsd) * 100)}%` : '') },
      ]} />
    ) : (
      <EmptyState frame="bare" title={t('Nothing spent in the last 31 days', 'Nada gasto nos últimos 31 dias')} />
    );
  };
  const chosen = monthLabel(selected, locale);
  return (
    <>
      <MetricGrid columns={5} mobilePairs label={t('Platform', 'Plataforma')}>
        <MetricCard label={t('Today (UTC)', 'Hoje (UTC)')} value={usd(platform.dayUsd)} description={limitText(platform.dayUsd, platform.limits.dayUsd)} />
        <MetricCard label={t('This month (UTC)', 'Este mês (UTC)')} value={usd(platform.monthUsd)} description={limitText(platform.monthUsd, platform.limits.monthUsd)} />
        <MetricCard label={t('Real', 'Real')} definition={t(`What the providers reported in ${chosen}, the month chosen below.`, `O que os provedores informaram em ${chosen}, o mês escolhido abaixo.`)} value={usd(total.realUsd)} description={t(`${usd(held(total))} held`, `${usd(held(total))} reservado`)} />
        <MetricCard
          label={t('Agent', 'Agente')}
          definition={t(`What the agent's answers count in ${chosen}, the month chosen below: real plus held. Details in the Agent view.`, `O que as respostas do agente contam em ${chosen}, o mês escolhido abaixo: real mais reservado. Detalhes na visão Agente.`)}
          value={usd(agentCell.spendUsd)}
          description={creditUsd ? t(`${credits(agentCell.spendUsd)} AI credits`, `${credits(agentCell.spendUsd)} créditos de IA`) : t(`${agentCell.items.toLocaleString(locale)} answers`, `${agentCell.items.toLocaleString(locale)} respostas`)}
        />
        <MetricCard
          label={t('Collections today', 'Coletas hoje')}
          value={platform.runsToday.toLocaleString(locale)}
          description={(platform.limits.dailyRuns ?? platform.dailyRunsDefault) === null
            ? t('No daily limit', 'Sem limite diário')
            : t(`of ${(platform.limits.dailyRuns ?? platform.dailyRunsDefault)!.toLocaleString(locale)} a day`, `de ${(platform.limits.dailyRuns ?? platform.dailyRunsDefault)!.toLocaleString(locale)} por dia`)}
        />
      </MetricGrid>
      <SectionCard title={t('Where the money goes', 'Para onde vai o dinheiro')} info={t('Every ledger the limits read, by when each call was sent (UTC). Held is reserved for work still running, or kept for an answer the provider never confirmed. Nothing here spends.', 'Todos os registros que os limites leem, pela data de envio de cada chamada (UTC). Reservado é o guardado para trabalho em andamento, ou para uma resposta que o provedor não confirmou. Nada aqui gasta.')}>
        <DataTableToolbar
          label={t('View and month', 'Visão e mês')}
          actions={
            view === 'day' ? undefined : (
              <>
                {view === 'agent' && (
                  <SelectField aria-label={t('Group by', 'Agrupar por')} size="sm" className="w-auto" value={agentBy} onValueChange={(value) => setAgentBy(value as AgentGroup)} options={[
                    { value: 'project', label: t('By project', 'Por projeto') },
                    { value: 'model', label: t('By model', 'Por modelo') },
                    { value: 'day', label: t('By day', 'Por dia') },
                  ]} />
                )}
                <SelectField aria-label={t('Month', 'Mês')} size="sm" className="w-auto" value={selected} onValueChange={setMonth} options={data.months.map((value) => ({ value, label: monthLabel(value, locale) }))} />
              </>
            )
          }
        >
          {/* The tabs only switch the view: the table sits right under the toolbar, as on every list (no gap, one hairline). */}
          <Tabs value={view} onValueChange={(value) => setView(String(value))}>
            <TabsList variant="line" aria-label={t('View', 'Visão')}>
              <TabsTrigger value="project">{t('Project', 'Projeto')}</TabsTrigger>
              <TabsTrigger value="module">{t('Module', 'Módulo')}</TabsTrigger>
              <TabsTrigger value="engine">{t('AI', 'IA')}</TabsTrigger>
              <TabsTrigger value="agent">{t('Agent', 'Agente')}</TabsTrigger>
              <TabsTrigger value="provider">{t('Model provider', 'Provedor de modelo')}</TabsTrigger>
              <TabsTrigger value="workspace">{t('Workspace', 'Workspace')}</TabsTrigger>
              <TabsTrigger value="day">{t('Day', 'Dia')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </DataTableToolbar>
        {flagged.length > 0 && (
          <Note tone="danger" icon={<CircleAlert size={16} />}>
            {flagged.length === 1
              ? t('1 project needs attention: blocked by a limit, over 80% of its budget, or on pace to run out: see State in the Project view.', '1 projeto precisa de atenção: bloqueado por um limite, acima de 80% do orçamento ou no ritmo de acabar: veja Estado na visão Projeto.')
              : t(`${flagged.length} projects need attention: blocked by a limit, over 80% of their budget, or on pace to run out: see State in the Project view.`, `${flagged.length} projetos precisam de atenção: bloqueados por um limite, acima de 80% do orçamento ou no ritmo de acabar: veja Estado na visão Projeto.`)}
          </Note>
        )}
        {/* One table per view (and grouping): each starts with its own default sort. */}
        <Fragment key={view === 'agent' ? `agent:${agentBy}` : view}>{content()}</Fragment>
      </SectionCard>
      <PlatformLimits data={data} t={t} usd={usd} locale={locale} onSaved={setData} />
      <CloudflareUsage />
      {editing && <BudgetEditor project={editing} t={t} usd={usd} onClose={() => setEditing(null)} onSaved={(value) => { setData(value); setRetry((count) => count + 1); }} />}
    </>
  );
}
