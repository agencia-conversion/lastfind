'use client';
import { useI18n } from '@/lib/i18n';

import {
  Aperture,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronsUpDown,
  Clock,
  Globe,
  LogOut,
  MessageSquare,
  Plus,
  Settings2,
  Users,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { requestJson } from '@/lib/client';
import { Favicon } from './identity-icons';
import type { Project, Workspace } from '@/lib/types';

export type WorkspaceNavigation = {
  id: string;
  label: string;
  icon: typeof ChartNoAxesCombined;
};
export const WORKSPACE_NAV: WorkspaceNavigation[] = [
  { id: 'overview', label: 'Visão geral', icon: ChartNoAxesCombined },
  { id: 'prompts', label: 'Prompts', icon: MessageSquare },
  { id: 'competitors', label: 'Concorrentes', icon: Users },
  { id: 'sources', label: 'Fontes', icon: Globe },
  { id: 'history', label: 'Histórico', icon: Clock },
  { id: 'settings', label: 'Configurações', icon: Settings2 },
];

// Adapted from shadcn/ui sidebar-07. Keep the installed Base UI primitives.
export function AppSidebar({
  data,
  project,
  readOnly,
  navigation = WORKSPACE_NAV,
  accountSummary,
  tab,
  onNavigate,
  onProject,
  onNewProject,
}: {
  data: Workspace | null;
  project?: Project;
  readOnly: boolean;
  navigation?: WorkspaceNavigation[];
  accountSummary?: React.ReactNode;
  tab: string;
  onNavigate: (tab: string) => void;
  onProject: (id: string) => void;
  onNewProject: () => void;
}) {
  const { t, conversionUrl } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = (id: string) => {
    onNavigate(id);
    if (isMobile) setOpenMobile(false);
  };
  const userName = readOnly
    ? t('Visitante')
    : data?.user.name || t('Sua conta');
  const userEmail = readOnly
    ? t('Workspace de demonstração')
    : data?.user.email;
  const workspaceName = t('Seu workspace');
  return (
    <Sidebar collapsible="icon" variant="inset" className="lastfind-sidebar">
      <SidebarHeader className="gap-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<a href="/" aria-label={t('Lastfind, início')} />}
              className="lf-sidebar-brand"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Aperture className="size-5!" />
              </span>
              <span className="text-xl font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                lastfind<span className="text-primary">.</span>
                <small className="block text-[10px] font-normal tracking-normal text-muted-foreground">
                  by Conversion
                </small>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="mt-3">
            <DropdownMenu>
              <DropdownMenuTrigger
                id="workspace-project-selector"
                render={
                  <SidebarMenuButton
                    size="lg"
                    aria-label={t('Selecionar projeto')}
                    className="border border-sidebar-border bg-background data-open:bg-sidebar-accent"
                  />
                }
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                  {project ? (
                    <Favicon domain={project.domain} name={project.name} />
                  ) : (
                    <Globe />
                  )}
                </span>
                <div className="grid min-w-0 flex-1 gap-1 text-left group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium">
                    {project?.name || t('Seu workspace')}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {project?.domain || t('Adicione sua marca')}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-64"
                side={isMobile ? 'bottom' : 'right'}
                align="start"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t('Seus projetos')}</DropdownMenuLabel>
                  {data?.projects.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      className="gap-3 p-2"
                      onClick={() => {
                        onProject(item.id);
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <Favicon domain={item.domain} name={item.name} />
                      <span className="min-w-0 flex-1 truncate">
                        {item.name}
                      </span>
                      {item.id === project?.id && (
                        <Check className="text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-3 p-2"
                  onClick={() => {
                    onNewProject();
                    if (isMobile) setOpenMobile(false);
                  }}
                >
                  <Plus />
                  {t('Novo projeto')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {[
          { label: 'Workspace', items: navigation.slice(0, 5) },
          { label: t('Gerenciar'), items: navigation.slice(5) },
        ].map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{t(group.label)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      id={`workspace-nav-${item.id}`}
                      tooltip={t(item.label)}
                      aria-label={t(item.label)}
                      aria-current={tab === item.id ? 'page' : undefined}
                      isActive={tab === item.id}
                      onClick={() => navigate(item.id)}
                      className="h-10"
                    >
                      <item.icon />
                      <span>{t(item.label)}</span>
                    </SidebarMenuButton>
                    {item.id === 'prompts' && (
                      <SidebarMenuBadge>
                        {data?.prompts.filter((p) => !p.archived).length ?? 0}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <SidebarGroup className="mt-auto">
          <a
            href={conversionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
          >
            by Conversion ↗
          </a>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                id="workspace-documentation"
                tooltip={t('Documentação')}
                render={<a href="/docs" aria-label={t('Documentação')} />}
              >
                <BookOpen />
                <span>{t('Documentação')}</span>
                <ArrowUpRight className="ml-auto group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-3">
        {accountSummary ?? (
          <div className="mx-1 rounded-lg border border-sidebar-border bg-background p-3 group-data-[collapsible=icon]:hidden">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">{workspaceName}</span>
              <span className="text-muted-foreground">
                {data?.capacity.prompts ?? 0} /{' '}
                {data?.capabilities.promptLimit ?? '∞'}
              </span>
            </div>
            {data?.capabilities.promptLimit ? (
              <Progress
                className="mt-3"
                aria-label={t('Prompts usados')}
                value={
                  (data.capacity.prompts / data.capabilities.promptLimit) * 100
                }
              />
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              {data?.capabilities.promptLimit
                ? t('Prompts no seu workspace')
                : t('Prompts ilimitados')}
            </p>
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                id="workspace-account-menu"
                render={
                  <SidebarMenuButton
                    size="lg"
                    aria-label={t('Menu da conta')}
                    className="data-open:bg-sidebar-accent"
                  />
                }
              >
                <Avatar className="rounded-lg">
                  <AvatarFallback className="rounded-lg bg-primary/10 font-medium text-primary">
                    {userName[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 flex-1 gap-1 text-left group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium">{userName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {userEmail || workspaceName}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-64"
                side={isMobile ? 'bottom' : 'right'}
                align="end"
                sideOffset={8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="grid gap-1 p-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {userName}
                    </span>
                    <span className="truncate">{userEmail}</span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {navigation
                  .filter(
                    (item) =>
                      !WORKSPACE_NAV.some((base) => base.id === item.id),
                  )
                  .map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      onClick={() => navigate(item.id)}
                    >
                      <item.icon />
                      {t(item.label)}
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuItem onClick={() => navigate('settings')}>
                  <Settings2 />
                  {t('Configurações')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  render={<a href="/" aria-label={t('Início')} />}
                >
                  <ArrowUpRight />
                  {t('Início')}
                </DropdownMenuItem>
                {!readOnly && (
                  <DropdownMenuItem
                    onClick={async () => {
                      await requestJson('/api/auth/logout', 'POST');
                      window.location.assign('/');
                    }}
                  >
                    <LogOut />
                    {t('Sair')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail
        aria-label={t('Recolher ou expandir menu')}
        title={t('Recolher ou expandir menu')}
      />
    </Sidebar>
  );
}
