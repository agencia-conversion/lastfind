'use client';
// Agent > Skills (both editions): the workspace's skills, shared by every project, listed as Artifacts lists its artifacts:
// Lastfind's (each can be changed, turned off or restored), the team's (written here) and the ones the agent learned from
// the same kind of work repeated across conversations (never from one message). A skill opens as an artifact does, in
// the artifact view (rich editor, Markdown only as an option, its chat beside it, History), with its status, what the
// agent proposes (a change it learned after reading third-party content waits here), its "Used when" and its lock
// (lib/server/agent-skills.ts). Only catalog components.
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, CircleAlert, CirclePower, EllipsisVertical, History, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { requestJson } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { BUILTIN_SKILL_TITLES, skillTitle, type SkillStatus, type SkillStatusReason } from '@/lib/agent-learning';
import type { Artifact } from '@/lib/agent';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/tooltip';
import { DataTable, DataTableScreen, DataTableToolbar, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { InfoHint } from '@/components/lastfind/presentation/info-hint';
import { Note } from '@/components/lastfind/presentation/note';
import { TagBadge, type TagTone } from '@/components/lastfind/presentation/tag-badge';
import { ArtifactIcon } from '@/components/lastfind/presentation/artifact-icon';
import { VersionHistory } from './agent-learning';
import { AgentArtifactView, readParam, writeParam } from './agent-screen';
import { EmptyState, FilterSelect, SearchField, useCopy } from './shared';

type T = (en: string, pt: string) => string;

type Source = 'lastfind' | 'changed' | 'team' | 'learned';
type Listed = {
  name: string;
  title: string | null;
  description: string;
  source: Source;
  status: SkillStatus;
  status_reason: SkillStatusReason | null;
  merged_into: string | null;
  locked: boolean;
  version: number | null;
  updated_at: string | null;
  outdated: boolean;
  reverted: boolean;
  proposal: boolean;
  uses: number;
  up: number;
  down: number;
  projects: number;
  last_used_at: string | null;
  learned: { conversations: number; projects: number; at: string } | null;
};
type Opened = Artifact & {
  name: string;
  skill: Listed & {
    bundled: boolean;
    proposal: { why: string; at: string; added: string[]; removed: string[] } | null;
    used_in: { projects: { id: string; name: string; uses: number }[]; conversations: { id: string; title: string; project_id: string; at: string }[] };
  };
};

const sourceLabel = (source: Source, t: T) =>
  ({ lastfind: t('Lastfind', 'Lastfind'), changed: t('Changed by the team', 'Alterada pelo time'), team: t('Team', 'Time'), learned: t('Learned', 'Aprendida') })[source];
const sourceTone = (source: Source): TagTone => (source === 'lastfind' ? 'quiet' : source === 'changed' ? 'warning' : 'primary');
const statusLabel = (skill: Pick<Listed, 'status' | 'merged_into' | 'proposal'>, t: T) =>
  skill.status === 'active'
    ? skill.proposal
      ? t('Change to review', 'Mudança para revisar')
      : t('In use', 'Em uso')
    : skill.status === 'draft'
      ? t('Draft', 'Rascunho')
      : skill.status === 'merged'
        ? t(`Merged into ${skill.merged_into ?? ''}`, `Unida a ${skill.merged_into ?? ''}`)
        : t('Off', 'Desligada');
const statusTone = (skill: Pick<Listed, 'status' | 'proposal'>): TagTone => (skill.status === 'active' ? (skill.proposal ? 'warning' : 'success') : skill.status === 'draft' ? 'neutral' : 'muted');
const team = (source: Source) => source === 'team' || source === 'learned';

function useDay() {
  const { locale } = useI18n();
  return (value: string) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }).format(new Date(value));
}

export function AgentSkills({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const t = useCopy();
  const { locale } = useI18n();
  const pt = locale === 'pt-BR';
  const day = useDay();
  const [data, setData] = useState<{ skills: Listed[]; canEdit: boolean; max: number } | { failure: string } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [open, setOpen] = useState<string | null>(() => readParam('skill'));
  const [search, setSearch] = useState('');
  // 'all', or the statuses chosen, comma-separated (the filter bar's FilterSelect).
  const [status, setStatus] = useState('all');
  const [toggling, setToggling] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ skill: Listed; action: 'delete' | 'restore' } | null>(null);
  const reload = () => setGeneration((value) => value + 1);
  useEffect(() => {
    let current = true;
    requestJson<{ skills: Listed[]; canEdit: boolean; max: number }>('/api/agent/skills').then(
      (value) => current && setData(value),
      (cause) => current && setData({ failure: cause instanceof Error ? cause.message : String(cause) }),
    );
    return () => {
      current = false;
    };
  }, [generation]);
  useEffect(() => {
    const onPop = () => setOpen(readParam('skill'));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Opening one is a step in the browser's history: Back returns to the list.
  const show = (name: string | null, history = false) => {
    setOpen(name);
    writeParam('history', history ? '1' : null);
    writeParam('skill', name, !!name);
    if (!name) reload();
  };
  const title = (skill: Pick<Listed, 'name' | 'title' | 'source'>) => skillTitle(skill.name, pt, team(skill.source) ? skill.title : null);
  if (open) return <SkillPage key={open} name={open} projectId={projectId} canEdit={canEdit} onBack={() => show(null)} t={t} />;
  const fail = (cause: unknown) => setFailure(cause instanceof Error ? cause.message : String(cause));
  const toggle = async (skill: Listed, on: boolean) => {
    setToggling(skill.name);
    setFailure(null);
    await requestJson(`/api/agent/skills/${encodeURIComponent(skill.name)}`, 'PATCH', { status: on ? 'active' : 'deprecated' })
      .then(reload, fail)
      .finally(() => setToggling(null));
  };
  const create = async () => {
    setCreating(true);
    setFailure(null);
    await requestJson<{ artifact: { name: string } }>('/api/agent/skills', 'POST', { title: t('New skill', 'Nova skill') })
      .then((made) => show(made.artifact.name), fail)
      .finally(() => setCreating(false));
  };
  const remove = async () => {
    const chosen = confirm;
    setConfirm(null);
    if (chosen) await requestJson(`/api/agent/skills/${encodeURIComponent(chosen.skill.name)}`, 'DELETE').then(reload, fail);
  };
  const loaded = data && 'skills' in data ? data : null;
  const own = loaded?.skills.filter((skill) => team(skill.source)) ?? [];
  const query = search.trim().toLocaleLowerCase();
  const rows = (loaded?.skills ?? []).filter(
    (skill) => (status === 'all' || status.split(',').includes(skill.status)) && (!query || `${title(skill)} ${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query)),
  );
  const about =
    loaded && own.length
      ? t(
          `Shared by every project in this workspace. The agent learns a skill when the same kind of work repeats across conversations, never from one message. ${own.filter((skill) => skill.status === 'active').length} of ${loaded.max} team skills on.`,
          `Compartilhadas por todos os projetos deste workspace. O agente aprende uma skill quando o mesmo tipo de trabalho se repete em conversas, nunca de uma mensagem só. ${own.filter((skill) => skill.status === 'active').length} de ${loaded.max} skills do time ligadas.`,
        )
      : t(
          'No team skills yet. The agent learns one when the same kind of work repeats across conversations, or you can write one. Shared by every project in this workspace.',
          'Nenhuma skill da equipe ainda. O agente aprende uma quando o mesmo tipo de trabalho se repete em conversas, ou você pode escrever uma. Compartilhadas por todos os projetos deste workspace.',
        );
  // Lastfind's text is English: its Portuguese summary, unless the team changed it.
  const used = (skill: Listed) => (pt && skill.source === 'lastfind' && BUILTIN_SKILL_TITLES[skill.name]?.[2]) || skill.description;
  const rating = (skill: Listed) => (skill.up || skill.down ? t(`${skill.up} good, ${skill.down} bad in 30 days`, `${skill.up} boas, ${skill.down} ruins em 30 dias`) : t('Not rated yet', 'Sem avaliação ainda'));
  const columns: DataColumn<Listed>[] = [
    {
      key: 'skill',
      header: t('Skill', 'Skill'),
      mobile: 'title',
      width: '22rem',
      shrinkTo: '12rem',
      sortValue: (skill) => title(skill),
      // What it is used for, and how its answers were rated, on hover.
      hint: (skill) => `${used(skill)} ${rating(skill)}.`,
      // Every skill has the one skill icon, in the artifacts' family (ArtifactIcon), as Artifacts marks each row's type.
      cell: (skill) => (
        <span className="agent-artifact-open">
          <ArtifactIcon kind="skill" size="sm" />
          <span className="truncate">{title(skill)}</span>
        </span>
      ),
    },
    { key: 'source', header: t('Source', 'Origem'), label: t('Source', 'Origem'), sortValue: (skill) => skill.source, cell: (skill) => <TagBadge tone={sourceTone(skill.source)}>{sourceLabel(skill.source, t)}</TagBadge> },
    { key: 'status', header: t('Status', 'Status'), label: t('Status', 'Status'), sortValue: (skill) => skill.status, cell: (skill) => <TagBadge tone={statusTone(skill)}>{statusLabel(skill, t)}</TagBadge> },
    { key: 'uses', header: t('Uses in 30 days', 'Usos em 30 dias'), label: t('Uses in 30 days', 'Usos em 30 dias'), align: 'end', sortValue: (skill) => skill.uses, cellClassName: 'tabular-nums', cell: (skill) => skill.uses },
    {
      key: 'used',
      header: t('Last used', 'Último uso'),
      label: t('Last used', 'Último uso'),
      sortValue: (skill) => skill.last_used_at ?? '',
      cellClassName: 'tabular-nums whitespace-nowrap',
      cell: (skill) => (skill.last_used_at ? day(skill.last_used_at) : <span className="text-muted-foreground">{t('Never', 'Nunca')}</span>),
    },
    {
      key: 'updated',
      header: t('Updated', 'Atualizada'),
      label: t('Updated', 'Atualizada'),
      sortValue: (skill) => skill.updated_at ?? '',
      cellClassName: 'tabular-nums whitespace-nowrap',
      cell: (skill) => (skill.updated_at ? day(skill.updated_at) : <span className="text-muted-foreground">{t('Original', 'Original')}</span>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('Actions', 'Ações')}</span>,
      align: 'end',
      mobile: 'actions',
      cell: (skill) => (
        <div className="flex items-center justify-end gap-1">
          <Hint text={skill.status === 'active' ? t('On for the agent', 'Ligada para o agente') : t('Off for the agent', 'Desligada para o agente')}>
            <Switch
              checked={skill.status === 'active'}
              disabled={!canEdit || toggling === skill.name || skill.status === 'merged'}
              aria-label={t(`${title(skill)} on for the agent`, `${title(skill)} ligada para o agente`)}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={(on) => void toggle(skill, on)}
            />
          </Hint>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t(`Actions for ${title(skill)}`, `Ações de ${title(skill)}`)} onClick={(event) => event.stopPropagation()} />}>
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => show(skill.name)}>
                <ArrowUpRight aria-hidden="true" />
                {t('Open', 'Abrir')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => show(skill.name, true)}>
                <History aria-hidden="true" />
                {t('History', 'Histórico')}
              </DropdownMenuItem>
              {canEdit && skill.source === 'changed' && (
                <DropdownMenuItem onClick={() => setConfirm({ skill, action: 'restore' })}>
                  <RotateCcw aria-hidden="true" />
                  {t("Restore Lastfind's version", 'Restaurar a versão do Lastfind')}
                </DropdownMenuItem>
              )}
              {canEdit && team(skill.source) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirm({ skill, action: 'delete' })}>
                    <Trash2 aria-hidden="true" />
                    {t('Delete', 'Excluir')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
  if (data && 'failure' in data)
    return <EmptyState tone="error" frame="bare" title={t('Could not load the skills', 'Não foi possível carregar as skills')} description={data.failure} onRetry={() => (setData(null), reload())} />;
  // While it loads: this very screen (its toolbar and columns), its rows drawn as skeletons.
  return (
    <DataTableScreen className="agent-artifacts-list agent-skills">
      {/* The search, then the status and New skill on one row: side by side on a phone too (the button keeps the right end). */}
      <DataTableToolbar label={t('Search', 'Busca')}>
        <SearchField value={search} onChange={setSearch} placeholder={t('Search skills', 'Buscar skills')} />
        <div className="flex min-w-0 items-center gap-3" style={{ flex: '1 1 auto' }}>
          <FilterSelect
            label={t('Status', 'Status')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: t('Every status', 'Todos os status') },
              { value: 'active', label: t('In use', 'Em uso') },
              { value: 'draft', label: t('Drafts', 'Rascunhos') },
              { value: 'deprecated', label: t('Off', 'Desligadas') },
              { value: 'merged', label: t('Merged', 'Unidas') },
            ]}
          />
          <InfoHint text={about} />
          {failure && (
            <output className="min-w-0 truncate text-caption text-destructive" role="alert">
              {failure}
            </output>
          )}
          {canEdit && (
            <Button className="ml-auto" pending={creating} pendingLabel={t('Creating…', 'Criando…')} disabled={!loaded} onClick={() => void create()}>
              {t('New skill', 'Nova skill')}
            </Button>
          )}
        </div>
      </DataTableToolbar>
      {loaded && !rows.length ? (
        <EmptyState
          frame="inline"
          title={t('No skill matches', 'Nenhuma skill corresponde')}
          description={t('Change the search or the status.', 'Mude a busca ou o status.')}
          action={
            <Button variant="outline" onClick={() => (setSearch(''), setStatus('all'))}>
              {t('Clear the filters', 'Limpar os filtros')}
            </Button>
          }
        />
      ) : (
        <DataTable
          fill
          singleLine
          loading={!loaded}
          ariaLabel={t('Skills', 'Skills')}
          rows={rows}
          rowKey={(skill) => skill.name}
          rowLink={(skill) => ({
            href: `?skill=${encodeURIComponent(skill.name)}`,
            onClick: (event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              show(skill.name);
            },
          })}
          defaultSort={{ key: 'updated', direction: 'desc' }}
          columns={columns}
        />
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(value) => !value && setConfirm(null)}
        title={confirm?.action === 'delete' ? t('Delete this skill?', 'Excluir esta skill?') : t("Restore Lastfind's version?", 'Restaurar a versão do Lastfind?')}
        description={
          confirm?.action === 'delete'
            ? t('The agent stops using it in every project of the workspace. Its history stays.', 'O agente deixa de usá-la em todos os projetos do workspace. O histórico fica.')
            : t("The agent goes back to Lastfind's text, and the team's version is set aside.", 'O agente volta ao texto do Lastfind, e a versão do time sai.')
        }
        confirmLabel={confirm?.action === 'delete' ? t('Delete', 'Excluir') : t('Restore', 'Restaurar')}
        cancelLabel={t('Cancel', 'Cancelar')}
        destructive={confirm?.action === 'delete'}
        onConfirm={() => void remove()}
      />
    </DataTableScreen>
  );
}

/**
 * One skill, as an artifact opens: the artifact view on the skill's endpoint (its body in the rich editor, Markdown from
 * the More menu, its chat beside it in this project), with what only a skill has around it: its status and what to do
 * about it, the change the agent proposes, its "Used when" and lock, History, and turning it on or off, restoring
 * Lastfind's version or deleting it.
 */
function SkillPage({ name, projectId, canEdit, onBack, t }: { name: string; projectId: string; canEdit: boolean; onBack: () => void; t: T }) {
  const day = useDay();
  const [skill, setSkill] = useState<Opened | null>(null);
  const [history, setHistory] = useState(() => readParam('history') === '1');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'restore' | null>(null);
  const endpoint = `/api/agent/skills/${encodeURIComponent(name)}`;
  const editable = canEdit && !!skill;
  const own = !!skill && team(skill.skill.source);
  const showHistory = (value: boolean) => {
    setHistory(value);
    writeParam('history', value ? '1' : null, value);
  };
  /**
   * A setting or an action of the skill: what came back shows at once; the text loads again only when it changed (a new
   * "Used when", a proposal applied), so a status or the lock never drops what the person is typing.
   */
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setFailure(null);
    await requestJson<{ artifact: Opened }>(endpoint, 'PATCH', body)
      .then(
        (data) => {
          if (data.artifact.version !== skill?.version) setRefresh((value) => value + 1);
          setSkill(data.artifact);
        },
        (cause) => setFailure(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false));
  };
  const remove = async () => {
    setConfirm(null);
    const restoring = confirm === 'restore';
    await requestJson(endpoint, 'DELETE').then(
      () => (restoring ? setRefresh((value) => value + 1) : onBack()),
      (cause) => setFailure(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  if (history)
    return (
      <div className="agent-artifacts" data-open="">
        <VersionHistory source={{ skill: name }} title={skill?.title ?? name} onBack={() => showHistory(false)} onRestored={() => setRefresh((value) => value + 1)} t={t} />
      </div>
    );
  const info = skill?.skill;
  const turnOn = (label = t('Turn on', 'Ligar')) =>
    editable && (
      <Button pending={busy} pendingLabel={t('Turning on…', 'Ligando…')} onClick={() => void act({ status: 'active' })}>
        {label}
      </Button>
    );
  // The line under the title: where it comes from (what it was learned from, in counts), then when it last changed.
  const meta =
    info &&
    [
      info.source === 'learned' && info.learned
        ? t(
            `Learned on ${day(info.learned.at)} from ${info.learned.conversations} conversations in ${info.learned.projects} ${info.learned.projects === 1 ? 'project' : 'projects'}`,
            `Aprendida em ${day(info.learned.at)} com ${info.learned.conversations} conversas em ${info.learned.projects} ${info.learned.projects === 1 ? 'projeto' : 'projetos'}`,
          )
        : info.source === 'lastfind'
          ? t('Lastfind skill', 'Skill do Lastfind')
          : info.source === 'changed'
            ? t('Lastfind skill, changed by the team', 'Skill do Lastfind, alterada pelo time')
            : t('Team skill', 'Skill do time'),
      info.updated_at ? t(`edited on ${day(info.updated_at)}`, `editada em ${day(info.updated_at)}`) : null,
      info.uses ? t(`${info.uses} uses in 30 days`, `${info.uses} usos em 30 dias`) : null,
    ]
      .filter(Boolean)
      .join(', ');
  const why: Record<string, string> = {
    unused: t('Off: nobody used it in 30 days.', 'Desligada: ninguém a usou em 30 dias.'),
    degraded: t('Off: answers got worse with it.', 'Desligada: as respostas pioraram com ela.'),
    person: t('Off: the agent does not use it.', 'Desligada: o agente não a usa.'),
  };
  const notes: ReactNode = info && (
    <div className="mb-6 grid gap-3 empty:hidden">
      {failure && (
        <Note tone="danger" icon={<CircleAlert aria-hidden="true" />}>
          {failure}
        </Note>
      )}
      {info.proposal && (
        <Note
          action={
            editable && (
              <span className="flex gap-2">
                <Button variant="outline" disabled={busy} onClick={() => void act({ proposal: 'dismiss' })}>
                  {t('Dismiss', 'Descartar')}
                </Button>
                <Button disabled={busy} onClick={() => void act({ proposal: 'apply' })}>
                  {t('Apply', 'Aplicar')}
                </Button>
              </span>
            )
          }
        >
          <span className="grid gap-1">
            <span>
              {t(
                'The agent proposes a change it learned from a conversation that read outside content (pages, searches or AI answers), so it waits for you.',
                'O agente propõe uma mudança que aprendeu numa conversa que leu conteúdo de fora (páginas, buscas ou respostas de IA), por isso ela espera por você.',
              )}
              {info.proposal.why ? ` ${info.proposal.why}` : ''}
            </span>
            {info.proposal.added.map((line, index) => (
              <span key={`a${index}`} className="text-foreground">
                {t('Adds: ', 'Acrescenta: ')}
                {line.replace(/^\s*[-*]\s+/, '')}
              </span>
            ))}
            {info.proposal.removed.map((line, index) => (
              <span key={`r${index}`}>
                {t('Removes: ', 'Tira: ')}
                {line.replace(/^\s*[-*]\s+/, '')}
              </span>
            ))}
          </span>
        </Note>
      )}
      {info.status === 'draft' && (
        <Note action={info.status_reason === 'full' ? undefined : turnOn()}>
          {info.status_reason === 'review'
            ? t('The agent learned this from conversations that read outside content: review it, then turn it on.', 'O agente aprendeu isto em conversas que leram conteúdo de fora: revise e depois ligue.')
            : info.status_reason === 'full'
              ? t('Draft: the workspace has 25 team skills on. Turn one off to turn this one on.', 'Rascunho: o workspace tem 25 skills do time ligadas. Desligue uma para ligar esta.')
              : t('Draft: the agent does not use it until you turn it on.', 'Rascunho: o agente não a usa até você ligar.')}
        </Note>
      )}
      {info.status === 'deprecated' && <Note action={turnOn()}>{why[info.status_reason ?? 'person'] ?? why.person}</Note>}
      {info.status === 'merged' && <Note>{t(`Merged into ${info.merged_into}: the agent uses that one.`, `Unida a ${info.merged_into}: o agente usa aquela.`)}</Note>}
      {info.outdated && (
        <Note
          action={
            editable && (
              <Button variant="outline" onClick={() => setConfirm('restore')}>
                {t("Restore Lastfind's version", 'Restaurar a versão do Lastfind')}
              </Button>
            )
          }
        >
          {t('Lastfind has a newer version of this skill. Restoring it replaces the team’s version.', 'O Lastfind tem uma versão mais nova desta skill. Restaurar substitui a versão do time.')}
        </Note>
      )}
      {info.reverted && (
        <Note>{t('Undone automatically: answers got worse after the last automatic change. It can be applied again from the history.', 'Desfeita automaticamente: as respostas pioraram depois da última mudança automática. Ela pode ser aplicada de novo pelo histórico.')}</Note>
      )}
    </div>
  );
  // History is in the menu (the header stays short enough for the title on a phone).
  const menu = (
    <>
      <DropdownMenuItem onClick={() => showHistory(true)}>
        <History aria-hidden="true" />
        {t('History', 'Histórico')}
      </DropdownMenuItem>
      {editable && info?.status === 'active' ? (
        <DropdownMenuItem onClick={() => void act({ status: 'deprecated' })}>
          <CirclePower aria-hidden="true" />
          {t('Turn off', 'Desligar')}
        </DropdownMenuItem>
      ) : editable && info?.status !== 'merged' ? (
        <DropdownMenuItem onClick={() => void act({ status: 'active' })}>
          <CirclePower aria-hidden="true" />
          {t('Turn on', 'Ligar')}
        </DropdownMenuItem>
      ) : null}
      {editable && info?.source === 'changed' && (
        <DropdownMenuItem onClick={() => setConfirm('restore')}>
          <RotateCcw aria-hidden="true" />
          {t("Restore Lastfind's version", 'Restaurar a versão do Lastfind')}
        </DropdownMenuItem>
      )}
      {editable && own && (
        <DropdownMenuItem variant="destructive" onClick={() => setConfirm('delete')}>
          <Trash2 aria-hidden="true" />
          {t('Delete', 'Excluir')}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
    </>
  );
  const headerAction = (
    <>
      {info && <SkillSettings key={`${info.description}:${info.locked}`} skill={info} canEdit={editable} busy={busy} onSave={(change) => void act(change)} t={t} />}
    </>
  );
  return (
    <div className="agent-artifacts" data-open="">
      <AgentArtifactView
        id={`skill:${name}`}
        variant="skill"
        endpoint={endpoint}
        projectId={projectId}
        canEdit={canEdit && (skill ? skill.skill.status !== 'merged' : true)}
        titleEditable={canEdit && own}
        place="page"
        refresh={refresh}
        meta={meta}
        notes={notes}
        menu={menu}
        headerAction={headerAction}
        onLoaded={(value) => setSkill(value as unknown as Opened)}
        onClose={onBack}
        t={t}
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(value) => !value && setConfirm(null)}
        title={confirm === 'delete' ? t('Delete this skill?', 'Excluir esta skill?') : t("Restore Lastfind's version?", 'Restaurar a versão do Lastfind?')}
        description={
          confirm === 'delete'
            ? t('The agent stops using it in every project of the workspace. Its history stays.', 'O agente deixa de usá-la em todos os projetos do workspace. O histórico fica.')
            : t("The agent goes back to Lastfind's text, and the team's version is set aside.", 'O agente volta ao texto do Lastfind, e a versão do time sai.')
        }
        confirmLabel={confirm === 'delete' ? t('Delete', 'Excluir') : t('Restore', 'Restaurar')}
        cancelLabel={t('Cancel', 'Cancelar')}
        destructive={confirm === 'delete'}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/** A skill's settings, as an artifact's are: its "Used when" (what the agent reads to choose it) and its lock against automatic changes. */
function SkillSettings({ skill, canEdit, busy, onSave, t }: { skill: Opened['skill']; canEdit: boolean; busy: boolean; onSave: (change: Record<string, unknown>) => void; t: T }) {
  const [description, setDescription] = useState(skill.description);
  // The server's rule (checkSkillText): it keeps its first words ("Use when" for a new one), 20 to 300 characters (or what it had).
  const next = description.trim();
  const opening = skill.description.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase();
  const draft = skill.status === 'draft';
  const invalid =
    next !== skill.description &&
    (next.length < 20 || next.length > Math.max(300, skill.description.length) || (draft ? !/^use (when|quando)\b/i.test(next) : !next.toLowerCase().startsWith(opening)));
  return (
    <Popover>
      <Hint text={t('Settings', 'Configurações')}>
        <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={t('Skill settings', 'Configurações da skill')} />}>
          <Settings2 />
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" className="agent-artifact-settings">
        <PopoverHeader>
          <PopoverTitle>{t('Skill settings', 'Configurações da skill')}</PopoverTitle>
        </PopoverHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="skill-description">{t('Used when', 'Usada quando')}</FieldLabel>
            <Textarea id="skill-description" rows={4} maxLength={Math.max(300, skill.description.length)} value={description} disabled={!canEdit} aria-invalid={invalid || undefined} aria-describedby="skill-description-help" onChange={(event) => setDescription(event.target.value)} />
            <FieldDescription id="skill-description-help" className={invalid ? 'text-destructive' : undefined}>
              {draft
                ? t('Starts with "Use when", 20 to 300 characters: the only part the agent reads to choose it.', 'Começa com "Use when" (ou "Use quando"), de 20 a 300 caracteres: a única parte que o agente lê para escolhê-la.')
                : t('Keeps its first words, 20 to 300 characters: the only part the agent reads to choose it.', 'Mantém as primeiras palavras, de 20 a 300 caracteres: a única parte que o agente lê para escolhê-la.')}
            </FieldDescription>
            {canEdit && (
              <Button className="justify-self-end" disabled={busy || invalid || next === skill.description} onClick={() => onSave({ description: description.trim() })}>
                {t('Save', 'Salvar')}
              </Button>
            )}
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="skill-locked">{t('Locked', 'Travada')}</FieldLabel>
              <FieldDescription>{t('The agent never changes it by itself: only people do.', 'O agente nunca a muda sozinho: só pessoas mudam.')}</FieldDescription>
            </FieldContent>
            <Switch id="skill-locked" checked={skill.locked} disabled={!canEdit || busy} onCheckedChange={(locked) => onSave({ locked })} />
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
