'use client';
import { LASTFIND_APP_ICON } from '@/lib/lastfind-brand';
import { useEffect, useRef, useState } from 'react';
import { announceSessionChange, requestJson } from '@/lib/client';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronsUpDown,
  Globe,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MessagesSquare,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Users,
  Cpu,
  Building2,
  UserRound,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { SiteFavicon, useCopy, useNumbers } from './shared';
import { UserAvatar } from './user-avatar';
import {
  accessibleWorkspaces,
  workspaceRole,
  type DemoSession,
  type SettingsSection,
} from './workspace-data';

export const navigation = [
  {
    id: 'onboarding',
    en: 'New project',
    pt: 'Novo projeto',
    icon: Plus,
    group: 'Setup',
  },
  {
    id: 'semantic-branding',
    en: 'Semantic Branding',
    pt: 'Semantic Branding',
    icon: Sparkles,
    group: 'Intelligence',
  },
  {
    id: 'overview',
    en: 'Overview',
    pt: 'Visão geral',
    icon: LayoutDashboard,
    group: 'Workspace',
  },
  {
    id: 'prompts',
    en: 'Prompts',
    pt: 'Prompts',
    icon: MessageSquare,
    group: 'Workspace',
  },
  {
    id: 'competitors',
    en: 'Brands',
    pt: 'Marcas',
    icon: Users,
    group: 'Workspace',
  },
  {
    id: 'sources',
    en: 'Sources',
    pt: 'Fontes',
    icon: Globe,
    group: 'Intelligence',
  },
  {
    id: 'models',
    en: 'AI models',
    pt: 'Modelos de IA',
    icon: Cpu,
    group: 'Intelligence',
  },
  {
    id: 'chats',
    en: 'Chats',
    pt: 'Respostas',
    icon: MessagesSquare,
    group: 'Intelligence',
  },
  {
    id: 'settings',
    en: 'Settings',
    pt: 'Configurações',
    icon: Settings2,
    group: 'Settings',
  },
];
export function AnalyticsSidebar({
  tab,
  onNavigate,
  onSearch,
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
  onSearch: () => void;
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
  const { isMobile, setOpenMobile } = useSidebar();
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
              <span className="logo-symbol">
                {/* Official transparent asset exported from the Lastfind Figma library. */}
                {/* eslint-disable-next-line next/no-img-element */}
                <img
                  src={LASTFIND_APP_ICON.src}
                  alt=""
                  width={44}
                  height={44}
                />
              </span>
              <span className="wordmark-text">
                lastfind<span className="text-primary">.</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                aria-label={l(
                  'Switch workspace or project',
                  'Trocar workspace ou projeto',
                )}
                className="project-switcher group-data-[collapsible=icon]:hidden"
              />
            }
          >
            <SiteFavicon domain={project.domain} name={workspace.name} />
            <span>
              <b>{project.name}</b>
            </span>
            <ChevronsUpDown size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="analytics-menu workspace-switcher-menu"
            side="bottom"
            sideOffset={6}
          >
            <div className="menu-caption">
              {l('Your workspaces', 'Seus workspaces')}
            </div>
            {accessibleWorkspaces(session).map((w) => (
              <DropdownMenuItem
                key={w.id}
                onClick={() => onContext({ workspaceId: w.id })}
              >
                <Building2 />
                <span className="truncate">{w.name}</span>
                {w.id === workspace.id && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <div className="menu-caption">
              {l('Projects', 'Projetos')} · {workspace.name}
            </div>
            {workspace.projects.map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => onContext({ projectId: p.id })}
              >
                <SiteFavicon domain={p.domain} name={p.name} />
                <span className="truncate">{p.name}</span>
                {p.id === project.id && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => settings('workspace')}>
              <Building2 />
              {l('Manage workspaces', 'Gerenciar workspaces')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!['owner', 'admin'].includes(workspaceRole(session))}
              onClick={() => navigate('onboarding')}
            >
              <Plus />
              {l('New project', 'Novo projeto')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => settings('projects')}>
              <Plus />
              {l('Manage projects', 'Gerenciar projetos')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={l('Quick search', 'Busca rápida')}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                onSearch();
              }}
              className="quick-search"
            >
              <Search />
              <span>{l('Quick search', 'Busca rápida')}</span>
              <kbd className="ml-auto group-data-[collapsible=icon]:hidden">
                ⌘ K
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {['Workspace', 'Intelligence'].map((group) => (
          <SidebarGroup key={group} className="px-3 pb-4">
            <SidebarGroupLabel>
              {group === 'Workspace'
                ? l('Workspace', 'Workspace')
                : l('Intelligence', 'Inteligência')}
            </SidebarGroupLabel>
            <SidebarMenu className="gap-1">
              {navigation
                .filter((n) => n.group === group)
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
                      className="h-9 text-sm"
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
        ))}
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
              aria-label={l('Settings', 'Configurações')}
            >
              <Settings2 />
              <span>{l('Settings', 'Configurações')}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={l('Documentation', 'Documentação')}
              render={
                <a
                  href="/docs"
                  aria-label={l('Documentation', 'Documentação')}
                />
              }
            >
              <BookOpen />
              <span>{l('Documentation', 'Documentação')}</span>
              <ArrowUpRight className="ml-auto group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className="sidebar-account user-menu-trigger"
                aria-label={l('User menu', 'Menu do usuário')}
              />
            }
          >
            <UserAvatar user={user} className="account-avatar" />
            <span className="user-menu-identity">
              <b>{user.name}</b>
              <span>{user.email}</span>
            </span>
            <ChevronsUpDown size={14} className="user-menu-chevron" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            sideOffset={8}
            className="analytics-menu user-menu-content"
          >
            <div className="menu-user-header flex-row">
              <UserAvatar user={user} className="size-9" />
              <div className="grid min-w-0 gap-1">
                <b>{user.name}</b>
                <span className="truncate">{user.email}</span>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => settings('profile')}>
              <UserRound />
              {l('Profile & language', 'Perfil e idioma')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => settings('workspace')}>
              <Building2 />
              {l('Workspaces', 'Workspaces')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => settings('members')}>
              <Users />
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
                  <LogOut />
                  {loggingOut
                    ? l('Signing out…', 'Saindo…')
                    : l('Sign out', 'Sair')}
                </DropdownMenuItem>
                {logoutError && (
                  <p
                    role="alert"
                    className="px-3 py-2 text-sm text-destructive"
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
                      <UserAvatar user={u} className="size-5 text-[8px]" />
                      <span>{u.name}</span>
                      {u.id === user.id && <Check className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
