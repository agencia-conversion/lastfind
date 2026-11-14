'use client';
import type { ReactNode } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';

// The account menu at the foot of the main sidebar (docs/design/shell.md section 5), shared by the app and the site's
// preview: avatar and name in the chrome; the name and email head the menu, and each caller fills the rest (plan,
// language, docs, sign out). `loading` draws the same row with placeholders, so nothing moves when the account arrives.
export function NavUser({
  name,
  email,
  avatar,
  label,
  loading = false,
  children,
}: {
  name?: string;
  email?: string;
  /** The person's avatar (UserAvatar), drawn in the row and at the head of the menu. */
  avatar?: ReactNode;
  /** The trigger's accessible name ("User menu"). */
  label: string;
  loading?: boolean;
  /** The menu's items, under the name and email. */
  children?: ReactNode;
}) {
  if (loading)
    return (
      <div aria-hidden="true" className="sidebar-account user-menu-trigger">
        <Skeleton inline className="size-7 shrink-0 rounded-full" />
        <span className="user-menu-identity">
          <Skeleton inline className="h-4 w-24" />
        </span>
      </div>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Hint text={email && name !== email ? `${name}\n${email}` : name} beside delay={0}>
            <button type="button" className="sidebar-account user-menu-trigger" aria-label={label}>
              {avatar}
              <span className="user-menu-identity">
                <b>{name}</b>
              </span>
              <ChevronsUpDown size={14} className="user-menu-chevron" aria-hidden="true" />
            </button>
          </Hint>
        }
      />
      <DropdownMenuContent side="bottom" sideOffset={8} className="analytics-menu user-menu-content live-account-menu">
        <div className="menu-user-header flex-row">
          {avatar}
          <div className="grid min-w-0">
            <b className="truncate">{name}</b>
            {email && email !== name && <span className="truncate">{email}</span>}
          </div>
        </div>
        <DropdownMenuSeparator />
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
