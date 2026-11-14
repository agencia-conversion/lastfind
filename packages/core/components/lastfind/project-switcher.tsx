'use client';
import type { ReactNode } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';
import { useOptionalSidebar } from '@/components/ui/sidebar';

// The project switcher at the top of the main sidebar (docs/design/shell.md section 5), shared by the app and the site's
// preview: the project's mark and name only (never the workspace's), and the menu each one fills with its workspaces,
// projects and actions. `loading` draws the same button with placeholders, so nothing moves when the workspace arrives.
export function ProjectSwitcher({
  icon,
  name,
  label,
  collapsed = false,
  loading = false,
  children,
}: {
  icon?: ReactNode;
  name?: string;
  /** The trigger's accessible name ("Switch project"). */
  label: string;
  /** The sidebar is a column of icons: the balloon names the project. */
  collapsed?: boolean;
  loading?: boolean;
  /** The menu's items. */
  children?: ReactNode;
}) {
  const sidebar = useOptionalSidebar();
  if (loading)
    return (
      <div aria-hidden="true" className="project-switcher flex items-center border border-border">
        <Skeleton inline className="size-4 shrink-0 rounded-sm" />
        <span>
          <Skeleton inline className="h-4 w-24 max-w-full" />
        </span>
      </div>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          // The content goes inside the button: a trigger's own children do not reach an element wrapped in a Hint.
          <Hint text={collapsed ? name : undefined} beside delay={0}>
            <Button variant="outline" className="project-switcher" aria-label={label}>
              {icon}
              <span>
                <b>{name}</b>
              </span>
              <ChevronsUpDown size={14} aria-hidden="true" />
            </Button>
          </Hint>
        }
      />
      {/* On a phone the sidebar is a drawer: choosing an item (a project, New project, New workspace) closes it too. */}
      <DropdownMenuContent
        className="analytics-menu workspace-switcher-menu"
        side="bottom"
        sideOffset={6}
        onClick={(event) => {
          if (sidebar?.isMobile && (event.target as HTMLElement).closest('[role="menuitem"]')) sidebar.setOpenMobile(false);
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
