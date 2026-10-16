'use client';
import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import './section-sidebar.css';

export type SectionItem = { id: string; label: string; icon?: ReactNode; count?: number; swatch?: string; title?: string };
export type SectionGroup = { id: string; label?: string; items: SectionItem[] };

/**
 * The one section navigation of the signed-in app (Prompts topics, Brands views, Settings
 * sections): a left list on wide screens and a single menu on narrow ones. `filter` marks a
 * list that narrows a table (pressed state); `navigation` marks one that switches pages.
 */
export function SectionSidebar({
  label,
  title,
  icon,
  groups,
  value,
  onChange,
  mode = 'navigation',
  className,
  footer,
}: {
  label: string;
  title?: string;
  icon?: ReactNode;
  groups: SectionGroup[];
  value: string;
  onChange: (id: string) => void;
  mode?: 'filter' | 'navigation';
  className?: string;
  footer?: ReactNode;
}) {
  const items = groups.flatMap((group) => group.items);
  const active = items.find((item) => item.id === value) ?? items[0];
  return (
    <aside className={cn('section-sidebar', className)}>
      <div className="section-selector">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="section-selector-trigger" aria-label={`${label}: ${active?.label ?? ''}`} />}>
            <span>{active?.label}</span>
            {active?.count != null && <small className="tabular-nums">{active.count}</small>}
            <ChevronDown size={16} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="section-menu" align="start" side="bottom" sideOffset={4}>
            {groups.map((group) => (
              <DropdownMenuGroup key={group.id}>
                {group.label && <DropdownMenuLabel>{group.label}</DropdownMenuLabel>}
                {group.items.map((item) => (
                  <DropdownMenuItem key={item.id} className="section-menu-item" aria-current={item.id === value ? 'page' : undefined} onClick={() => onChange(item.id)}>
                    <span className="section-menu-label">{item.label}</span>
                    {item.count != null && <small className="tabular-nums text-muted-foreground">{item.count}</small>}
                    {item.id === value && <Check size={16} aria-hidden="true" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav className="section-list" aria-label={label}>
        {title && (
          <div className="section-title">
            <span>{title}</span>
            {icon}
          </div>
        )}
        {groups.map((group) => (
          <div className="section-group" key={group.id}>
            {group.label && <p className="section-group-label">{group.label}</p>}
            {group.items.map((item) => {
              const on = item.id === value;
              return (
                <Button
                  key={item.id}
                  variant="ghost"
                  title={item.title ?? item.label}
                  className={cn('h-9 w-full justify-start text-sm', on ? 'bg-primary/7 text-primary' : 'text-muted-foreground')}
                  aria-pressed={mode === 'filter' ? on : undefined}
                  aria-current={mode === 'navigation' && on ? 'page' : undefined}
                  onClick={() => onChange(item.id)}
                >
                  {item.swatch ? <span className="size-2 shrink-0 rounded-full" style={{ background: item.swatch }} /> : item.icon}
                  <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                  {item.count != null && <span className="ml-auto tabular-nums">{item.count}</span>}
                </Button>
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
