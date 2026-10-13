'use client';

import {
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import {
  ArrowUpRight,
  Building2,
  Check,
  ChevronRight,
  FolderKanban,
  Mail,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n, type Locale } from '@/lib/i18n';
import {
  FilterSelect,
  PanelHeading,
  SiteFavicon,
  useCopy,
  useNumbers,
} from './shared';
import {
  accessibleWorkspaces,
  switchDemoContext,
  workspaceRole,
  type DemoMember,
  type DemoProject,
  type DemoRole,
  type DemoSession,
  type DemoWorkspace,
  type SettingsSection,
} from './workspace-data';
import { ProfileAvatar, UserAvatar } from './user-avatar';
import { uniqueSlug } from './routes';

type Props = {
  session: DemoSession;
  setSession: Dispatch<SetStateAction<DemoSession>>;
  section: SettingsSection;
  onSectionChange: (value: SettingsSection) => void;
};
type Editor = 'workspace' | 'project' | 'invite' | null;

const domainPattern = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i;
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
const canManage = (session: DemoSession) =>
  ['owner', 'admin'].includes(workspaceRole(session));
const canManageMember = (session: DemoSession, member: DemoMember) =>
  canManage(session) &&
  member.role !== 'owner' &&
  member.userId !== session.userId &&
  (workspaceRole(session) === 'owner' || member.role !== 'admin');

export function WorkspaceSettingsView(props: Props) {
  return (
    <WorkspaceSettings
      key={`${props.session.userId}:${props.session.workspaceId}:${props.session.projectId}`}
      {...props}
    />
  );
}

function WorkspaceSettings({
  session,
  setSession,
  section,
  onSectionChange,
}: Props) {
  const copy = useCopy();
  const { number } = useNumbers();
  const { locale, setLocale } = useI18n();
  const workspace = session.workspaces.find(
    (item) => item.id === session.workspaceId,
  )!;
  const user = session.users.find((item) => item.id === session.userId)!;
  const project = workspace.projects.find(
    (item) => item.id === session.projectId,
  )!;
  const role = workspaceRole(session);
  const manage = canManage(session);
  const activeMemberCount = workspace.members.filter(
    (member) => member.status === 'active',
  ).length;
  const projectLabel = (count: number) =>
    count === 1 ? copy('project', 'projeto') : copy('projects', 'projetos');
  const [editor, setEditor] = useState<Editor>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<DemoRole>('member');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nameError, setNameError] = useState('');
  const [profileError, setProfileError] = useState('');

  const roleName = (value: DemoRole) =>
    ({
      owner: copy('Owner', 'Proprietário'),
      admin: copy('Admin', 'Administrador'),
      member: copy('Member', 'Membro'),
      viewer: copy('Viewer', 'Leitor'),
    })[value];
  const roles = (
    role === 'owner' ? ['admin', 'member', 'viewer'] : ['member', 'viewer']
  ).map((value) => ({ value, label: roleName(value as DemoRole) }));
  const saved = () =>
    setNotice(
      copy(
        'Changes saved for this session.',
        'Alterações salvas nesta sessão.',
      ),
    );

  function updateWorkspace(
    update: (current: DemoWorkspace, state: DemoSession) => DemoWorkspace,
  ) {
    setSession((current) =>
      !canManage(current) ||
      current.userId !== user.id ||
      current.workspaceId !== workspace.id
        ? current
        : {
            ...current,
            workspaces: current.workspaces.map((item) =>
              item.id === workspace.id ? update(item, current) : item,
            ),
          },
    );
  }

  function openEditor(value: Exclude<Editor, null>, project?: DemoProject) {
    setEditor(value);
    setEditingProjectId(project?.id ?? null);
    setName('');
    setProjectName(project?.name ?? '');
    setDomain(project?.domain ?? '');
    setEmail('');
    setInviteRole('member');
    setError('');
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editor !== 'workspace' && !manage) return;
    const cleanName = name.trim();
    const cleanProjectName = projectName.trim();
    const cleanDomain = domain.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();
    if (editor === 'workspace' && (!cleanName || !cleanProjectName)) {
      setError(
        copy(
          'Enter a workspace name and project name.',
          'Informe o nome do workspace e do projeto.',
        ),
      );
      return;
    }
    if (editor === 'project' && !cleanProjectName) {
      setError(copy('Enter a project name.', 'Informe o nome do projeto.'));
      return;
    }
    if (
      (editor === 'workspace' || editor === 'project') &&
      (cleanDomain.length > 253 || !domainPattern.test(cleanDomain))
    ) {
      setError(
        copy(
          'Enter a valid domain without https:// or a path.',
          'Informe um domínio válido, sem https:// ou caminho.',
        ),
      );
      return;
    }
    if (
      editor === 'workspace' &&
      accessibleWorkspaces(session).some(
        (item) =>
          item.name.toLocaleLowerCase(locale) ===
          cleanName.toLocaleLowerCase(locale),
      )
    ) {
      setError(
        copy(
          'You already have a workspace with this name.',
          'Você já tem um workspace com este nome.',
        ),
      );
      return;
    }
    if (
      editor === 'project' &&
      workspace.projects.some(
        (item) =>
          item.id !== editingProjectId &&
          (item.domain === cleanDomain ||
            item.name.toLocaleLowerCase(locale) ===
              cleanProjectName.toLocaleLowerCase(locale)),
      )
    ) {
      setError(
        copy(
          'A project with this name or domain already exists in this workspace.',
          'Já existe um projeto com este nome ou domínio neste workspace.',
        ),
      );
      return;
    }
    if (editor === 'invite') {
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
        !domainPattern.test(cleanEmail.split('@')[1] ?? '') ||
        cleanEmail.length > 254
      ) {
        setError(
          copy('Enter a valid email address.', 'Informe um e-mail válido.'),
        );
        return;
      }
      const existingUser = session.users.find(
        (item) => item.email.toLowerCase() === cleanEmail,
      );
      if (
        existingUser &&
        workspace.members.some((member) => member.userId === existingUser.id)
      ) {
        setError(
          copy(
            'This person is already a member or has a pending invitation.',
            'Esta pessoa já é membro ou tem um convite pendente.',
          ),
        );
        return;
      }
      const invitedUser = existingUser ?? {
        id: crypto.randomUUID(),
        name: cleanEmail.split('@')[0],
        email: cleanEmail,
      };
      setSession((current) => {
        if (
          !canManage(current) ||
          current.userId !== user.id ||
          current.workspaceId !== workspace.id ||
          !['admin', 'member', 'viewer'].includes(inviteRole) ||
          (workspaceRole(current) !== 'owner' && inviteRole === 'admin')
        )
          return current;
        const currentWorkspace = current.workspaces.find(
          (item) => item.id === workspace.id,
        )!;
        const matchedUser =
          current.users.find(
            (item) => item.email.toLowerCase() === cleanEmail,
          ) ?? invitedUser;
        if (
          currentWorkspace.members.some(
            (member) => member.userId === matchedUser.id,
          )
        )
          return current;
        return {
          ...current,
          users: current.users.some((item) => item.id === matchedUser.id)
            ? current.users
            : [...current.users, matchedUser],
          workspaces: current.workspaces.map((item) =>
            item.id !== workspace.id
              ? item
              : {
                  ...item,
                  members: [
                    ...item.members,
                    {
                      userId: matchedUser.id,
                      role: inviteRole,
                      status: 'invited',
                    },
                  ],
                },
          ),
        };
      });
      setNotice(
        copy(
          'Invitation prepared. No email was sent.',
          'Convite preparado. Nenhum e-mail foi enviado.',
        ),
      );
    } else if (editor === 'workspace') {
      const project: DemoProject = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(cleanProjectName, []),
        name: cleanProjectName,
        domain: cleanDomain,
        prompts: [],
      };
      const newWorkspace: DemoWorkspace = {
        id: crypto.randomUUID(),
        slug: uniqueSlug(
          cleanName,
          session.workspaces.map((item) => item.slug),
        ),
        name: cleanName,
        members: [{ userId: session.userId, role: 'owner', status: 'active' }],
        projects: [project],
      };
      setSession((current) =>
        current.userId !== user.id ||
        accessibleWorkspaces(current).some(
          (item) =>
            item.name.toLocaleLowerCase(locale) ===
            cleanName.toLocaleLowerCase(locale),
        )
          ? current
          : {
              ...current,
              workspaces: [...current.workspaces, newWorkspace],
              workspaceId: newWorkspace.id,
              projectId: project.id,
            },
      );
    } else if (editor === 'project') {
      if (editingProjectId) {
        updateWorkspace((current) => ({
          ...current,
          projects: current.projects.map((project) =>
            project.id === editingProjectId
              ? { ...project, name: cleanProjectName, domain: cleanDomain }
              : project,
          ),
        }));
      } else {
        const project: DemoProject = {
          id: crypto.randomUUID(),
          slug: uniqueSlug(
            cleanProjectName,
            workspace.projects.map((item) => item.slug),
          ),
          name: cleanProjectName,
          domain: cleanDomain,
          prompts: [],
        };
        setSession((current) =>
          !canManage(current) ||
          current.userId !== user.id ||
          current.workspaceId !== workspace.id
            ? current
            : {
                ...current,
                projectId: project.id,
                workspaces: current.workspaces.map((item) =>
                  item.id === workspace.id
                    ? { ...item, projects: [...item.projects, project] }
                    : item,
                ),
              },
        );
      }
      saved();
    }
    setEditor(null);
  }

  const sections = [
    {
      value: 'workspace',
      label: copy('Workspace', 'Workspace'),
      icon: Building2,
    },
    { value: 'members', label: copy('Members', 'Membros'), icon: Users },
    {
      value: 'projects',
      label: copy('Projects', 'Projetos'),
      icon: FolderKanban,
    },
    {
      value: 'profile',
      label: copy('My profile', 'Meu perfil'),
      icon: UserRound,
    },
  ] as const;

  return (
    <div className="workspace-settings max-w-5xl space-y-4">
      <Tabs
        value={section}
        onValueChange={(value) => {
          onSectionChange(value as SettingsSection);
          setNotice('');
        }}
        className="gap-5"
      >
        <div className="min-w-0 border-b">
          <TabsList
            variant="line"
            className="settings-tab-list grid w-full grid-cols-2 gap-x-3 gap-y-1 p-0 sm:w-fit sm:grid-cols-4 sm:gap-x-5"
            aria-label={copy('Settings sections', 'Seções das configurações')}
          >
            {sections.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="h-10 min-w-0 gap-2 px-0 text-sm sm:flex-none"
              >
                <item.icon size={14} />
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="workspace" className="m-0 space-y-5">
          <section className="analytics-panel overflow-hidden">
            <PanelHeading
              title={copy('Workspace details', 'Detalhes do workspace')}
              description={copy(
                'A shared home for your team and projects.',
                'O espaço da sua equipe e dos seus projetos.',
              )}
            />
            <form
              key={workspace.name}
              onSubmit={(event) => {
                event.preventDefault();
                if (!manage) return;
                const value = String(
                  new FormData(event.currentTarget).get('workspace-name') ?? '',
                ).trim();
                setNameError('');
                if (!value) {
                  setNameError(
                    copy(
                      'Enter a workspace name.',
                      'Informe o nome do workspace.',
                    ),
                  );
                  return;
                }
                if (
                  accessibleWorkspaces(session).some(
                    (item) =>
                      item.id !== workspace.id &&
                      item.name.toLocaleLowerCase(locale) ===
                        value.toLocaleLowerCase(locale),
                  )
                ) {
                  setNotice(
                    copy(
                      'You already have a workspace with this name.',
                      'Você já tem um workspace com este nome.',
                    ),
                  );
                  return;
                }
                updateWorkspace((current) => ({ ...current, name: value }));
                saved();
              }}
            >
              <div className="space-y-5 border-t p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl border bg-muted/35 text-sm font-semibold">
                    {initials(workspace.name)}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">
                      {workspace.name}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {number(activeMemberCount)}{' '}
                      {activeMemberCount === 1
                        ? copy('member', 'membro')
                        : copy('members', 'membros')}{' '}
                      · {number(workspace.projects.length)}{' '}
                      {projectLabel(workspace.projects.length)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="ml-auto text-sm font-normal"
                  >
                    {roleName(role)}
                  </Badge>
                </div>
                <div className="max-w-md space-y-2">
                  <Label htmlFor="workspace-name" className="text-sm">
                    {copy('Workspace name', 'Nome do workspace')}
                  </Label>
                  <Input
                    id="workspace-name"
                    name="workspace-name"
                    defaultValue={workspace.name}
                    aria-invalid={!!nameError}
                    aria-describedby={
                      nameError ? 'workspace-name-error' : undefined
                    }
                    maxLength={80}
                    required
                    disabled={!manage}
                    className="h-9 text-sm md:text-sm"
                  />
                </div>
                {nameError && (
                  <p
                    id="workspace-name-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {nameError}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3 border-t pt-5">
                  <SiteFavicon domain={project.domain} name={project.name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted-foreground">
                      {copy('Current project', 'Projeto atual')}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium">
                      {project.name}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onSectionChange('projects')}
                  >
                    {copy('View projects', 'Ver projetos')}
                    <ChevronRight size={13} />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/15 px-5 py-3.5">
                <p className="text-sm text-muted-foreground">
                  {copy(
                    'Members and projects belong to this workspace.',
                    'Membros e projetos pertencem a este workspace.',
                  )}
                </p>
                <Button size="sm" type="submit" disabled={!manage}>
                  {copy('Save changes', 'Salvar alterações')}
                </Button>
              </div>
            </form>
          </section>
          <section className="analytics-panel overflow-hidden">
            <PanelHeading
              title={copy('Your workspaces', 'Seus workspaces')}
              description={copy(
                'Switch between the teams you belong to.',
                'Alterne entre as equipes das quais você participa.',
              )}
              action={copy('New workspace', 'Novo workspace')}
              onAction={() => openEditor('workspace')}
            />
            <div className="divide-y border-t">
              {accessibleWorkspaces(session).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/25"
                  onClick={() =>
                    setSession((current) =>
                      switchDemoContext(current, { workspaceId: item.id }),
                    )
                  }
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/25 text-sm font-medium">
                    {initials(item.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {item.name}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {number(item.projects.length)}{' '}
                      {projectLabel(item.projects.length)} ·{' '}
                      {roleName(
                        item.members.find(
                          (member) => member.userId === user.id,
                        )!.role,
                      )}
                    </span>
                  </span>
                  {item.id === workspace.id ? (
                    <Badge variant="secondary" className="text-sm font-normal">
                      {copy('Current', 'Atual')}
                    </Badge>
                  ) : (
                    <ChevronRight size={15} className="text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="members" className="m-0 space-y-5">
          <section className="analytics-panel overflow-hidden">
            <PanelHeading
              title={copy('Workspace members', 'Membros do workspace')}
              description={copy(
                'Manage who can access your team’s projects.',
                'Gerencie quem pode acessar os projetos da equipe.',
              )}
              action={
                manage ? copy('Invite member', 'Convidar membro') : undefined
              }
              onAction={manage ? () => openEditor('invite') : undefined}
            />
            <div className="relative overflow-x-auto border-t">
              <table className="analytics-table min-w-[650px]">
                <thead>
                  <tr>
                    <th>{copy('Member', 'Membro')}</th>
                    <th>{copy('Role', 'Permissão')}</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">
                        {copy('Actions', 'Ações')}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.members.map((member) => {
                    const person = session.users.find(
                      (item) => item.id === member.userId,
                    )!;
                    const editable = canManageMember(session, member);
                    return (
                      <tr key={member.userId}>
                        <td aria-label={person.name}>
                          <div className="flex items-center gap-3">
                            <UserAvatar user={person} />
                            <div>
                              <div className="flex items-center gap-2 text-sm font-medium">
                                {person.name}
                                {person.id === user.id && (
                                  <span className="text-sm font-normal text-muted-foreground">
                                    {copy('(you)', '(você)')}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {person.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td>
                          {editable ? (
                            <FilterSelect
                              label={copy(
                                `Role for ${person.name}`,
                                `Permissão de ${person.name}`,
                              )}
                              value={member.role}
                              options={roles}
                              onChange={(value) => {
                                const nextRole = value as DemoRole;
                                updateWorkspace((current, state) => ({
                                  ...current,
                                  members: current.members.map((target) =>
                                    target.userId === member.userId &&
                                    canManageMember(state, target) &&
                                    ['admin', 'member', 'viewer'].includes(
                                      nextRole,
                                    ) &&
                                    (workspaceRole(state) === 'owner' ||
                                      nextRole !== 'admin')
                                      ? { ...target, role: nextRole }
                                      : target,
                                  ),
                                }));
                                saved();
                              }}
                            />
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                              {member.role === 'owner' && (
                                <ShieldCheck size={13} />
                              )}
                              {roleName(member.role)}
                            </span>
                          )}
                        </td>
                        <td>
                          <Badge
                            variant="outline"
                            className={`gap-1.5 text-sm font-normal ${member.status === 'invited' ? 'text-muted-foreground' : ''}`}
                          >
                            <span
                              className={`size-1.5 rounded-full ${member.status === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground/60'}`}
                            />
                            {member.status === 'active'
                              ? copy('Active', 'Ativo')
                              : copy('Invited', 'Convidado')}
                          </Badge>
                        </td>
                        <td className="text-right">
                          {editable && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={
                                member.status === 'invited'
                                  ? copy(
                                      `Cancel invitation for ${person.email}`,
                                      `Cancelar convite de ${person.email}`,
                                    )
                                  : copy(
                                      `Remove ${person.name}`,
                                      `Remover ${person.name}`,
                                    )
                              }
                              onClick={() => {
                                updateWorkspace((current, state) => ({
                                  ...current,
                                  members: current.members.filter(
                                    (target) =>
                                      target.userId !== member.userId ||
                                      !canManageMember(state, target),
                                  ),
                                }));
                                saved();
                              }}
                            >
                              <Trash2
                                size={14}
                                className="text-muted-foreground"
                              />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 border-t bg-muted/15 px-5 py-3.5 text-sm leading-relaxed text-muted-foreground">
              <Mail size={14} className="mt-0.5 shrink-0" />
              {copy(
                'Invitations remain in this browser session. No email is sent.',
                'Os convites são simulados nesta prévia. Nenhum e-mail é enviado.',
              )}
            </div>
          </section>
          <section className="analytics-panel overflow-hidden">
            <PanelHeading
              title={copy('Role permissions', 'Permissões de acesso')}
            />
            <div className="grid gap-5 border-t p-5 sm:grid-cols-2">
              {(
                [
                  [
                    'owner',
                    copy(
                      'Full access to the workspace, projects and members.',
                      'Acesso completo ao workspace, projetos e membros.',
                    ),
                  ],
                  [
                    'admin',
                    copy(
                      'Manage projects and invite members and viewers.',
                      'Gerenciar projetos e convidar membros e leitores.',
                    ),
                  ],
                  [
                    'member',
                    copy(
                      'Manage prompts and explore project reports.',
                      'Gerenciar prompts e explorar os relatórios dos projetos.',
                    ),
                  ],
                  [
                    'viewer',
                    copy(
                      'View reports and responses without editing data.',
                      'Consultar relatórios e respostas sem editar dados.',
                    ),
                  ],
                ] as [DemoRole, string][]
              ).map(([value, description]) => (
                <div key={value}>
                  <h3 className="text-sm font-medium">{roleName(value)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="projects" className="m-0">
          <section className="analytics-panel overflow-hidden">
            <PanelHeading
              title={copy('Workspace projects', 'Projetos do workspace')}
              description={copy(
                'Keep brands, prompts and reports organized by project.',
                'Organize marcas, prompts e relatórios por projeto.',
              )}
              action={manage ? copy('New project', 'Novo projeto') : undefined}
              onAction={manage ? () => openEditor('project') : undefined}
            />
            <div className="divide-y border-t">
              {workspace.projects.map((project) => (
                <div
                  key={project.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  <SiteFavicon domain={project.domain} name={project.name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {project.name}
                      {project.id === session.projectId && (
                        <Badge
                          variant="secondary"
                          className="text-sm font-normal"
                        >
                          {copy('Current', 'Atual')}
                        </Badge>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {project.domain} · {number(project.prompts.length)}{' '}
                      {project.prompts.length === 1 ? 'prompt' : 'prompts'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {manage && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={copy(
                          `Edit ${project.name}`,
                          `Editar ${project.name}`,
                        )}
                        onClick={() => openEditor('project', project)}
                      >
                        <Pencil size={14} />
                      </Button>
                    )}
                    {project.id !== session.projectId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSession((current) =>
                            switchDemoContext(current, {
                              projectId: project.id,
                            }),
                          )
                        }
                      >
                        {copy('Switch', 'Selecionar')}
                        <ArrowUpRight size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t bg-muted/15 px-5 py-3.5 text-sm text-muted-foreground">
              {copy(
                'New projects start with an empty prompt list.',
                'Novos projetos começam com uma lista de prompts vazia.',
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="profile" className="m-0 space-y-5">
          <section className="analytics-panel overflow-hidden">
            <PanelHeading
              title={copy('My profile', 'Meu perfil')}
              description={copy(
                'Your identity across all your workspaces.',
                'Sua identidade em todos os seus workspaces.',
              )}
            />
            <form
              key={user.name}
              onSubmit={(event) => {
                event.preventDefault();
                const value = String(
                  new FormData(event.currentTarget).get('profile-name') ?? '',
                ).trim();
                setProfileError('');
                if (!value) {
                  setProfileError(
                    copy('Enter your name.', 'Informe seu nome.'),
                  );
                  return;
                }
                setSession((current) =>
                  current.userId !== user.id
                    ? current
                    : {
                        ...current,
                        users: current.users.map((item) =>
                          item.id === user.id ? { ...item, name: value } : item,
                        ),
                      },
                );
                saved();
              }}
            >
              <div className="space-y-5 border-t p-5">
                <ProfileAvatar
                  user={user}
                  onSave={(avatar) => {
                    setSession((current) =>
                      current.userId !== user.id
                        ? current
                        : {
                            ...current,
                            users: current.users.map((item) =>
                              item.id === user.id ? { ...item, avatar } : item,
                            ),
                          },
                    );
                    saved();
                  }}
                />
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="profile-name" className="text-sm">
                      {copy('Full name', 'Nome completo')}
                    </Label>
                    <Input
                      id="profile-name"
                      name="profile-name"
                      defaultValue={user.name}
                      aria-invalid={!!profileError}
                      aria-describedby={
                        profileError ? 'profile-name-error' : undefined
                      }
                      maxLength={80}
                      required
                      className="h-9 text-sm md:text-sm"
                    />
                    {profileError && (
                      <p
                        id="profile-name-error"
                        role="alert"
                        className="text-sm text-destructive"
                      >
                        {profileError}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-email" className="text-sm">
                      E-mail
                    </Label>
                    <Input
                      id="profile-email"
                      value={user.email}
                      readOnly
                      className="h-9 bg-muted/20 text-sm text-muted-foreground md:text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end border-t bg-muted/15 px-5 py-3.5">
                <Button type="submit" size="sm">
                  {copy('Save changes', 'Salvar alterações')}
                </Button>
              </div>
            </form>
          </section>
          <section className="analytics-panel overflow-hidden">
            <PanelHeading title={copy('Preferences', 'Preferências')} />
            <div className="flex flex-wrap items-center justify-between gap-4 border-t p-5">
              <div>
                <h3 className="text-sm font-medium">
                  {copy('Interface language', 'Idioma da interface')}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy(
                    'Also sets date and number formatting.',
                    'Também define o formato de datas e números.',
                  )}
                </p>
              </div>
              <FilterSelect
                label={copy('Interface language', 'Idioma da interface')}
                value={locale}
                onChange={(value) => setLocale(value as Locale)}
                options={[
                  { value: 'en', label: 'English (US)' },
                  { value: 'pt-BR', label: 'Português (Brasil)' },
                ]}
              />
            </div>
          </section>
        </TabsContent>
      </Tabs>

      {notice && (
        <output className="flex items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm">
          <Check size={14} className="text-muted-foreground" />
          {notice}
        </output>
      )}
      {!manage && section !== 'profile' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck size={14} />
          {copy(
            'Only owners and admins can manage workspace settings.',
            'Somente proprietários e administradores podem gerenciar o workspace.',
          )}
        </p>
      )}

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editor === 'workspace'
                ? copy('Create workspace', 'Criar workspace')
                : editor === 'invite'
                  ? copy('Invite member', 'Convidar membro')
                  : editingProjectId
                    ? copy('Edit project', 'Editar projeto')
                    : copy('Create project', 'Criar projeto')}
            </DialogTitle>
            <DialogDescription className="pr-4 text-sm leading-relaxed">
              {editor === 'workspace'
                ? copy(
                    'Create a team space and add your first project.',
                    'Crie um espaço para a equipe e adicione seu primeiro projeto.',
                  )
                : editor === 'invite'
                  ? copy(
                      `Add someone to ${workspace.name}.`,
                      `Adicione alguém ao workspace ${workspace.name}.`,
                    )
                  : copy(
                      'Choose the brand and website you want to track.',
                      'Escolha a marca e o site que deseja acompanhar.',
                    )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEditor} className="space-y-5">
            {editor === 'workspace' && (
              <div className="space-y-2">
                <Label htmlFor="new-workspace-name" className="text-sm">
                  {copy('Workspace name', 'Nome do workspace')}
                </Label>
                <Input
                  id="new-workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={copy('e.g. My agency', 'Ex.: Minha agência')}
                  maxLength={80}
                  required
                  className="h-9 text-sm md:text-sm"
                />
              </div>
            )}
            {(editor === 'workspace' || editor === 'project') && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="new-project-name" className="text-sm">
                    {editor === 'workspace'
                      ? copy('First project name', 'Nome do primeiro projeto')
                      : copy('Project name', 'Nome do projeto')}
                  </Label>
                  <Input
                    id="new-project-name"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder={copy('e.g. My brand', 'Ex.: Minha marca')}
                    maxLength={80}
                    required
                    className="h-9 text-sm md:text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-project-domain" className="text-sm">
                    {copy('Website domain', 'Domínio do site')}
                  </Label>
                  <Input
                    id="new-project-domain"
                    value={domain}
                    onChange={(event) => setDomain(event.target.value)}
                    placeholder="example.com"
                    maxLength={253}
                    required
                    className="h-9 text-sm md:text-sm"
                  />
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {copy(
                      'Enter the domain without https:// or a path.',
                      'Informe o domínio sem https:// ou caminho.',
                    )}
                  </p>
                </div>
              </>
            )}
            {editor === 'invite' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="invite-email" className="text-sm">
                    E-mail
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={copy('name@company.com', 'nome@empresa.com')}
                    maxLength={254}
                    required
                    className="h-9 text-sm md:text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {copy('Workspace role', 'Permissão no workspace')}
                  </p>
                  <FilterSelect
                    label={copy('Invitation role', 'Permissão do convite')}
                    value={inviteRole}
                    onChange={(value) => setInviteRole(value as DemoRole)}
                    options={roles}
                  />
                </div>
                <p className="rounded-lg border bg-muted/20 p-3 text-sm leading-relaxed text-muted-foreground">
                  {copy(
                    'This prepares a pending invitation for this session. No email is sent.',
                    'Isto prepara um convite pendente para esta sessão. Nenhum e-mail é enviado.',
                  )}
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditor(null)}
              >
                {copy('Cancel', 'Cancelar')}
              </Button>
              <Button type="submit" size="sm">
                {editor === 'invite' ? (
                  <>
                    <Mail size={13} />
                    {copy('Create invitation', 'Criar convite')}
                  </>
                ) : editingProjectId ? (
                  copy('Save changes', 'Salvar alterações')
                ) : (
                  <>
                    <Plus size={13} />
                    {editor === 'workspace'
                      ? copy('Create workspace', 'Criar workspace')
                      : copy('Create project', 'Criar projeto')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
