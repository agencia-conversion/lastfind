'use client';
import { Check, ChevronsUpDown, Globe, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useI18n } from '@/lib/i18n';
import { Favicon } from './identity-icons';
import type { Project } from '@/lib/types';

// Adapted from shadcn/ui sidebar-07's team-switcher: name + favicon only, no
// textual domain in the trigger or the options (REQUIREMENTS.md, 7 Sep 2026).
export function ProjectSwitcher({
  project,
  projects,
  onSelect,
  onCreate,
}: {
  project?: Project;
  projects: Project[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();
  const selectProject = (id: string) => {
    onSelect(id);
    if (isMobile) setOpenMobile(false);
  };
  const createProject = () => {
    onCreate();
    if (isMobile) setOpenMobile(false);
  };
  return (
    <SidebarMenu>
      <SidebarMenuItem>
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
            <span className="min-w-0 flex-1 truncate text-left font-medium group-data-[collapsible=icon]:hidden">
              {project?.name || t('Seu workspace')}
            </span>
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
              {projects.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="gap-3 p-2"
                  onClick={() => selectProject(item.id)}
                >
                  <Favicon domain={item.domain} name={item.name} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.id === project?.id && (
                    <Check className="text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-3 p-2" onClick={createProject}>
              <Plus />
              {t('Novo projeto')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
