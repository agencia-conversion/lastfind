'use client';
import { LastfindLogo } from '@/components/lastfind/lastfind-logo';
import { useEffect, useRef, useState } from 'react';
import { announceSessionChange, requestJson } from '@/lib/client';
import { ArrowUpRight, Check } from 'lucide-react';
import { navIcons, settingsIcons } from './nav-icons';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { SiteFavicon, useCopy, useNumbers } from './shared';
import { projectLabel } from '@/lib/new-project';
import { UserAvatar } from './user-avatar';
import { NavUser } from '@/components/lastfind/nav-user';
import { ProjectSwitcher } from '@/components/lastfind/project-switcher';
import { LanguageSwitcher } from '@/lib/i18n';
import {
  accessibleWorkspaces,
  workspaceRole,
  type DemoSession,
  type SettingsSection,
} from './workspace-data';

// The main navigation, one list in this order; New project and Settings live in the switcher and the footer.
export const navigation = [
  {
    id: 'onboarding',
    en: 'New project',
    pt: 'Novo projeto',
    icon: navIcons.onboarding,
    group: 'Setup',
  },
  {
    id: 'overview',
    en: 'Overview',
    pt: 'Visão geral',
    icon: navIcons.overview,
    group: 'Main',
  },
  {
    id: 'agent',
    en: 'Agent',
    pt: 'Agente',
    icon: navIcons.agent,
    group: 'Main',
  },
  {
    id: 'prompts',
    en: 'Prompts',
    pt: 'Prompts',
    icon: navIcons.prompts,
    group: 'Main',
  },
  {
    id: 'semantic-branding',
    en: 'Semantic Branding',
    pt: 'Semantic Branding',
    icon: navIcons['semantic-branding'],
    group: 'Main',
  },
  {
    id: 'competitors',
    en: 'Brands',
    pt: 'Marcas',
    icon: navIcons.competitors,
    group: 'Main',
  },
  {
    id: 'sources',
    en: 'Sources',
    pt: 'Fontes',
    icon: navIcons.sources,
    group: 'Main',
  },
  {
    id: 'comparison',
    en: 'Comparison',
    pt: 'Comparação',
    icon: navIcons.comparison,
    group: 'Main',
  },
  {
    id: 'ai-bots',
    en: 'Traffic',
    pt: 'Tráfego',
    icon: navIcons['ai-bots'],
    group: 'Main',
  },
  {
    id: 'products',
    en: 'Shopping',
    pt: 'Shopping',
    icon: navIcons.products,
    group: 'Main',
  },
  {
    id: 'models',
    en: 'AI models',
    pt: 'Modelos de IA',
    icon: navIcons.models,
    group: 'Main',
  },
  {
    id: 'settings',
    en: 'Settings',
    pt: 'Configurações',
    icon: navIcons.settings,
    group: 'Settings',
  },
];
export function AnalyticsSidebar({
  tab,
  onNavigate,
  activeCount,
  session,
  onContext,
  onSettings,
  hrefForTab,
  authenticated = false,
}: {
  authenticated?: boolean;
  tab: string;
  onNavigate: (v: string) => void;
  activeCount: number;
  session: DemoSession;
  onContext: (next: {
    userId?: string;
    workspaceId?: string;
    projectId?: string;
  }) => void;
  onSettings: (section: SettingsSection) => void;
  hrefForTab: (tab: string, section?: SettingsSection) => string;
}) {
  const l = useCopy();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const logoutInFlight = useRef(false);
  const logoutController = useRef<AbortController | null>(null);
  useEffect(() => () => logoutController.current?.abort(), []);
  const logout = async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setLoggingOut(true);
    setLogoutError(false);
    const controller = new AbortController();
    logoutController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      await requestJson(
        '/api/auth/logout',
        'POST',
        undefined,
        controller.signal,
      );
      announceSessionChange();
      window.location.assign('/app');
    } catch {
      logoutInFlight.current = false;
      setLoggingOut(false);
      setLogoutError(true);
    } finally {
      window.clearTimeout(timeout);
      logoutController.current = null;
    }
  };
  const { number } = useNumbers();
  const workspace = session.workspaces.find(
    (w) => w.id === session.workspaceId,
  )!;
  const project = workspace.projects.find((p) => p.id === session.projectId)!;
  const user = session.users.find((u) => u.id === session.userId)!;
  const settings = (section: SettingsSection) => {
    onSettings(section);
    if (isMobile) setOpenMobile(false);
  };
  const { isMobile, open, setOpenMobile } = useSidebar();
  const navigate = (v: string) => {
    onNavigate(v);
    if (isMobile) setOpenMobile(false);
  };
  return (
    <Sidebar collapsible="icon" className="analytics-sidebar">
      <SidebarHeader className="px-3 pt-5 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="lastfind-wordmark"
              render={<a href={hrefForTab('overview')} aria-label="Lastfind" />}
              onClick={(e) => {
                if (
                  e.button ||
                  e.metaKey ||
                  e.ctrlKey ||
                  e.shiftKey ||
                  e.altKey
                )
                  return;
                e.preventDefault();
                navigate('overview');
              }}
            >
              <LastfindLogo />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <ProjectSwitcher
          icon={<SiteFavicon domain={project.domain} name={project.name} />}
          name={projectLabel(project)}
          label={l('Switch workspace or project', 'Trocar workspace ou projeto')}
          collapsed={!open}
        >
          <div className="menu-caption">
            {l('Your workspaces', 'Seus workspaces')}
          </div>
          {accessibleWorkspaces(session).map((w) => (
            <DropdownMenuItem
              key={w.id}
              onClick={() => onContext({ workspaceId: w.id })}
            >
              <navIcons.workspaces />
              <span className="truncate">{w.name}</span>
              {w.id === workspace.id && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <div className="menu-caption">
            {l('Projects', 'Projetos')}, {workspace.name}
          </div>
          {workspace.projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => onContext({ projectId: p.id })}
            >
              <SiteFavicon domain={p.domain} name={p.name} />
              <span className="truncate">{projectLabel(p)}</span>
              {p.id === project.id && <Check className="ml-auto" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => settings('workspace')}>
            <navIcons.workspaces />
            {l('Manage workspaces', 'Gerenciar workspaces')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!['owner', 'admin'].includes(workspaceRole(session))}
            onClick={() => navigate('onboarding')}
          >
            <navIcons.onboarding />
            {l('New project', 'Novo projeto')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => settings('projects')}>
            <settingsIcons.projects />
            {l('Manage projects', 'Gerenciar projetos')}
          </DropdownMenuItem>
        </ProjectSwitcher>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-3 pb-4">
          <SidebarMenu className="gap-1">
            {navigation
              .filter((n) => n.group === 'Main')
              .map((n) => (
                <SidebarMenuItem key={n.id}>
                  <SidebarMenuButton
                    tooltip={l(n.en, n.pt)}
                    isActive={tab === n.id}
                    aria-current={tab === n.id ? 'page' : undefined}
                    aria-label={l(n.en, n.pt)}
                    render={
                      <a href={hrefForTab(n.id)} aria-label={l(n.en, n.pt)} />
                    }
                    onClick={(e) => {
                      if (
                        e.button ||
                        e.metaKey ||
                        e.ctrlKey ||
                        e.shiftKey ||
                        e.altKey
                      )
                        return;
                      e.preventDefault();
                      navigate(n.id);
                    }}
                  >
                    <n.icon />
                    <span>{l(n.en, n.pt)}</span>
                    {n.id === 'prompts' && (
                      <span className="nav-count group-data-[collapsible=icon]:hidden">
                        {number(activeCount)}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 pb-3">
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={l('Settings', 'Configurações')}
              render={
                <a
                  href={hrefForTab('settings', 'workspace')}
                  aria-label={l('Settings', 'Configurações')}
                />
              }
              onClick={(e) => {
                if (
                  e.button ||
                  e.metaKey ||
                  e.ctrlKey ||
                  e.shiftKey ||
                  e.altKey
                )
                  return;
                e.preventDefault();
                settings('workspace');
              }}
              isActive={tab === 'settings'}
              aria-current={tab === 'settings' ? 'page' : undefined}
              aria-label={l('Settings', 'Configurações')}
            >
              <navIcons.settings />
              <span>{l('Settings', 'Configurações')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser
          name={user.name}
          email={user.email}
          avatar={<UserAvatar user={user} className="account-avatar" />}
          label={l('User menu', 'Menu do usuário')}
        >
            <LanguageSwitcher submenu />
            <DropdownMenuItem onClick={() => settings('profile')}>
              <navIcons.profile />
              {l('Profile & language', 'Perfil e idioma')}
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <a
                  href="/docs"
                  aria-label={l('Documentation', 'Documentação')}
                />
              }
            >
              <navIcons.docs />
              {l('Documentation', 'Documentação')}
              <ArrowUpRight className="ml-auto" />
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => settings('workspace')}>
              <navIcons.workspaces />
              {l('Workspaces', 'Workspaces')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => settings('members')}>
              <settingsIcons.members />
              {l('Members & permissions', 'Membros e permissões')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {authenticated ? (
              <>
                <DropdownMenuItem
                  disabled={loggingOut}
                  closeOnClick={false}
                  onClick={() => void logout()}
                >
                  <navIcons.signOut />
                  {loggingOut
                    ? l('Signing out…', 'Saindo…')
                    : l('Sign out', 'Sair')}
                </DropdownMenuItem>
                {logoutError && (
                  <p
                    role="alert"
                    className="px-3 py-2 text-body text-destructive"
                  >
                    {l(
                      'Could not sign out. Please try again.',
                      'Não foi possível sair. Tente novamente.',
                    )}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="menu-caption">
                  {l('Switch user', 'Trocar usuário')}
                </div>
                {session.users
                  .filter((u) =>
                    session.workspaces.some((w) =>
                      w.members.some(
                        (m) => m.userId === u.id && m.status === 'active',
                      ),
                    ),
                  )
                  .map((u) => (
                    <DropdownMenuItem
                      key={u.id}
                      onClick={() => onContext({ userId: u.id })}
                    >
                      <UserAvatar user={u} size="xs" className="size-5" />
                      <span>{u.name}</span>
                      {u.id === user.id && <Check className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
              </>
            )}
        </NavUser>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
