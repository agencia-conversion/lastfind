'use client';
import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cva } from 'class-variance-authority';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNumbers } from './shared';
import { cn } from '@/lib/utils';
import {
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Linker } from './drill-link';
import './section-sidebar.css';

export type SectionItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  swatch?: string;
  title?: string;
  /** The row's own actions (a ⋮ menu): shown on hover, keyboard focus and on the active row. */
  actions?: ReactNode;
  /** In place of the row while it is edited (a name renamed in place). */
  editor?: ReactNode;
};
export type SectionGroup = { id: string; label?: string; items: SectionItem[] };

// Open/closed groups live for the visit only: the first paint (server) and the browser agree (the group of the
// current page is open), so the sidebar never expands a group after it appears.
const groupPreferences = new Map<string, boolean>();
const preferenceEvent = 'lastfind:sidebar-preference';
function subscribePreferences(notify: () => void) {
  window.addEventListener(preferenceEvent, notify);
  return () => window.removeEventListener(preferenceEvent, notify);
}
function savePreference(key: string, open: boolean) {
  groupPreferences.set(key, open);
  window.dispatchEvent(new Event(preferenceEvent));
}

type MenuItemProps = {
  label: string;
  icon: ReactNode;
  active: boolean;
  link: ReturnType<Linker>;
  groupId?: string;
  items?: {
    id: string;
    label: string;
    active: boolean;
    link: ReturnType<Linker>;
    badge?: ReactNode;
  }[];
  badge?: ReactNode;
};

/** Primary navigation shared by every live section, including the mobile sheet. */
export function SectionMenuItem(props: MenuItemProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  if (props.items && props.groupId) return <SectionMenuGroup {...props} />;
  const { label, icon, active, link, badge } = props;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={label}
        isActive={active}
        aria-current={active ? 'page' : undefined}
        render={
          <a
            href={link.href}
            aria-label={label}
            onClick={(event) => {
              link.onClick(event);
              if (event.defaultPrevented && isMobile) setOpenMobile(false);
            }}
          />
        }
      >
        {icon}
        <span>{label}</span>
        {badge}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SectionMenuGroup({
  label,
  icon,
  active,
  groupId,
  items = [],
}: MenuItemProps) {
  const { isMobile, setOpenMobile, state, setOpen } = useSidebar();
  const storageKey = `lastfind:sidebar-group:${groupId}`;
  const activeItem = items.find((item) => item.active)?.id;
  const readPreference = useCallback(() => groupPreferences.get(storageKey) ?? active, [storageKey, active]);
  const expanded = useSyncExternalStore(
    subscribePreferences,
    readPreference,
    () => active,
  );
  // Opening a new section reveals its active child; toggling the same group can close it.
  useEffect(() => {
    if (activeItem) savePreference(storageKey, true);
  }, [storageKey, activeItem]);
  const changeExpanded = (open: boolean) => {
    if (state === 'collapsed' && !isMobile) {
      setOpen(true);
      open = true;
    }
    savePreference(storageKey, open);
  };
  return (
    <Collapsible
      open={expanded}
      onOpenChange={changeExpanded}
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={
          <SidebarMenuButton
            tooltip={label}
            isActive={active && state === 'collapsed' && !isMobile}
            aria-label={label}
          />
        }
      >
        {icon}
        <span>{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'ml-auto transition-transform group-data-[collapsible=icon]:hidden',
            expanded && 'rotate-90',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub aria-label={label}>
          {items.map((item) => (
            <SidebarMenuSubItem key={item.id}>
              <SidebarMenuSubButton
                isActive={item.active}
                aria-current={item.active ? 'page' : undefined}
                render={
                  <a
                    href={item.link.href}
                    aria-label={item.label}
                    onClick={(event) => {
                      item.link.onClick(event);
                      if (event.defaultPrevented && isMobile)
                        setOpenMobile(false);
                    }}
                  />
                }
              >
                <span>{item.label}</span>
                {item.badge}
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
}

const sectionSidebarVariants = cva('section-sidebar', {
  variants: {
    side: { left: '', right: '' },
    surface: { none: '', sidebar: '', floating: '' },
  },
  defaultVariants: { side: 'left', surface: 'none' },
});

/**
 * The one section navigation of the signed-in app and its second sidebars (Prompts topics, Brands views, Settings sections,
 * a content's tabs, the Brain, the conversations): a list of nav rows on wide screens and a single menu on narrow ones
 * (docs/design/shell.md section 5). `filter` marks a list that narrows a table (pressed state); `navigation` marks one
 * that switches pages. `surface="sidebar"` is a second sidebar (white, the main sidebar's edge) on the `side` it sits;
 * `surface="floating"` a panel that floats over the page's edge (a document's tabs: opening or folding it never moves the
 * text); `collapsed` folds it to its header (where the caller puts the toggle).
 */
export function SectionSidebar({
  label,
  title,
  icon,
  groups,
  value,
  onChange,
  mode = 'navigation',
  side = 'left',
  surface = 'none',
  collapsed = false,
  narrow = 'menu',
  className,
  header,
  footer,
}: {
  side?: 'left' | 'right';
  /** Below 900px: one menu (a page's sections), or still the list (a list that is itself the page's navigation, in a sheet). */
  narrow?: 'menu' | 'list';
  surface?: 'none' | 'sidebar' | 'floating';
  collapsed?: boolean;
  label: string;
  /** A bar above the list, in place of `title`: a full-height page's own top bar (Agent > Brain, as the chat's conversations). */
  header?: ReactNode;
  title?: string;
  icon?: ReactNode;
  groups: SectionGroup[];
  value: string;
  onChange: (id: string) => void;
  mode?: 'filter' | 'navigation';
  className?: string;
  footer?: ReactNode;
}) {
  const { number } = useNumbers();
  const items = groups.flatMap((group) => group.items);
  const active = items.find((item) => item.id === value) ?? items[0];
  return (
    <aside
      className={cn(sectionSidebarVariants({ side, surface }), className)}
      data-side={side}
      data-surface={surface}
      data-collapsed={collapsed || undefined}
      data-narrow={narrow}
    >
      {header}
      <div className="section-selector">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="section-selector-trigger" aria-label={`${label}: ${active?.label ?? ''}`} />}>
            <span>{active?.label}</span>
            {active?.count != null && <small className="tabular-nums">{number(active.count)}</small>}
            <ChevronDown size={16} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="section-menu" align="start" side="bottom" sideOffset={4}>
            {groups.map((group) => (
              <DropdownMenuGroup key={group.id}>
                {group.label && <DropdownMenuLabel>{group.label}</DropdownMenuLabel>}
                {group.items.map((item) => (
                  <DropdownMenuItem key={item.id} className="section-menu-item" aria-current={item.id === value ? 'page' : undefined} onClick={() => onChange(item.id)}>
                    <span className="section-menu-label">{item.label}</span>
                    {item.count != null && <small className="tabular-nums text-muted-foreground">{number(item.count)}</small>}
                    {item.id === value && <Check size={16} aria-hidden="true" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav className="section-list" aria-label={label}>
        {/* The title reads as the app sidebar's group labels (Settings, Admin): the same component and style. */}
        {title && (
          <SidebarGroupLabel className="section-title">
            <span>{title}</span>
            {icon}
          </SidebarGroupLabel>
        )}
        {groups.map((group) => (
          <div className="section-group" key={group.id}>
            {group.label && <p className="section-group-label">{group.label}</p>}
            {group.items.map((item) => {
              const on = item.id === value;
              if (item.editor)
                return (
                  <div key={item.id} className="section-row" data-item={item.id}>
                    {item.editor}
                  </div>
                );
              return (
                <div key={item.id} className="section-row" data-item={item.id} data-active={on || undefined}>
                  <Hint text={item.title ?? item.label} side={side === 'right' ? 'left' : 'right'}>
                    <button
                      type="button"
                      className="section-row-button"
                      aria-pressed={mode === 'filter' ? on : undefined}
                      aria-current={mode === 'navigation' && on ? 'page' : undefined}
                      onClick={() => onChange(item.id)}
                    >
                      {item.swatch ? <span className="size-2 shrink-0 rounded-full" style={{ background: item.swatch }} /> : item.icon}
                      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                      {item.count != null && <span className="ml-auto tabular-nums">{number(item.count)}</span>}
                    </button>
                  </Hint>
                  {item.actions && <div className="section-row-actions">{item.actions}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      {footer && <div className="section-footer">{footer}</div>}
    </aside>
  );
}

/** Sidebar plus content; below 900px the sidebar becomes a sticky menu above the content. */
export function SectionLayout({ children, className, ...sidebar }: { children: ReactNode; className?: string } & Parameters<typeof SectionSidebar>[0]) {
  return (
    <div className={cn('section-layout', className)}>
      <SectionSidebar {...sidebar} />
      <div className="section-content">{children}</div>
    </div>
  );
}
