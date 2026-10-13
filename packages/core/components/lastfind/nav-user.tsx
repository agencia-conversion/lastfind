'use client';
import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, ChevronsUpDown, LogOut, Settings2 } from 'lucide-react';
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
import { toast } from '@/components/ui/toast';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useI18n } from '@/lib/i18n';
import { requestJson } from '@/lib/client';
import type { Workspace } from '@/lib/types';

export type AccountMenuItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type UsageRow = {
  key: string;
  label: string;
  used: number;
  // null = genuinely unlimited (still shows the count); undefined = not
  // supplied yet (unknown/loading), rendered as "—" instead of a false "∞".
  limit: number | null | undefined;
};

function UsageMeterRow({ row }: { row: UsageRow }) {
  const { t } = useI18n();
  const bounded = typeof row.limit === 'number';
  const value =
    bounded && row.limit! > 0 ? Math.min(100, (row.used / row.limit!) * 100) : 0;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{row.label}</span>
        <span>
          {row.used} /{' '}
          {row.limit === null
            ? t('Ilimitado')
            : row.limit === undefined
              ? '—'
              : row.limit}
        </span>
      </div>
      {bounded && (
        <Progress
          aria-label={t('{label} usados', { label: row.label })}
          value={value}
        />
      )}
    </div>
  );
}

// Read-only plan/usage summary shown inside the account dropdown (never a
// fixed sidebar footer card). Falls back to real Cloud/selfhost limits from
// data.capabilities/data.capacity/data.usage and never shows "unlimited" or
// hides the count while workspace data is still loading.
export function AccountUsageSummary({
  data,
  planName,
  note,
}: {
  data: Workspace | null;
  planName?: string;
  note?: string;
}) {
  const { t } = useI18n();
  if (!data) {
    return (
      <p className="px-2 py-1.5 text-xs text-muted-foreground">
        {t('Carregando plano…')}
      </p>
    );
  }
  const rows: UsageRow[] = [
    {
      key: 'prompts',
      label: t('Prompts'),
      used: data.capacity.prompts,
      limit: data.capabilities.promptLimit,
    },
    {
      key: 'topics',
      label: t('Tópicos'),
      used: data.capacity.topics,
      limit: data.capabilities.topicLimit,
    },
  ];
  if (data.usage.creditsUsed !== undefined) {
    rows.push({
      key: 'credits',
      label: t('Créditos'),
      used: data.usage.creditsUsed,
      limit: data.usage.creditsLimit,
    });
  }
  return (
    <div className="grid gap-3 px-2 py-1.5">
      {planName && (
        <span className="text-sm font-medium text-foreground">
          {planName}
        </span>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {rows.map((row) => (
        <UsageMeterRow key={row.key} row={row} />
      ))}
    </div>
  );
}

// Adapted from shadcn/ui sidebar-07's nav-user. Plan/usage lives in
// DropdownMenuGroup/DropdownMenuLabel as read-only content, not an
// interactive control nested inside a menu item.
export function NavUser({
  data,
  readOnly,
  accountSummary,
  extraItems,
  onNavigate,
  onSettings,
}: {
  data: Workspace | null;
  readOnly: boolean;
  accountSummary?: React.ReactNode;
  extraItems: AccountMenuItem[];
  onNavigate: (id: string) => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();
  const userName = readOnly
    ? t('Visitante')
    : data?.user.name || t('Sua conta');
  const userEmail = readOnly ? t('Workspace de demonstração') : data?.user.email;
  const [loggingOut, setLoggingOut] = useState(false);
  const loggingOutRef = useRef(false);
  const logout = async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setLoggingOut(true);
    try {
      await requestJson('/api/auth/logout', 'POST');
      window.location.assign('/');
    } catch {
      // The mobile sheet may have been reopened while logout was pending.
      setOpenMobile(false);
      toast.add({
        title: t('Não foi possível sair.'),
        description: t('Abra o menu da conta e tente sair novamente.'),
        type: 'error',
      });
      loggingOutRef.current = false;
      setLoggingOut(false);
    }
  };
  return (
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
                {userEmail || t('Seu workspace')}
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
                <span className="truncate text-xs text-muted-foreground">
                  {userEmail}
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0">
                {accountSummary ?? <AccountUsageSummary data={data} />}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {extraItems.length > 0 && (
              <>
                <DropdownMenuGroup>
                  {extraItems.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      onClick={() => onNavigate(item.id)}
                    >
                      <item.icon />
                      {t(item.label)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={onSettings}>
              <Settings2 />
              {t('Configurações')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<a href="/" aria-label={t('Início')} />}>
              <ArrowUpRight />
              {t('Início')}
            </DropdownMenuItem>
            {!readOnly && (
              <DropdownMenuItem disabled={loggingOut} onClick={() => void logout()}>
                <LogOut />
                {loggingOut ? t('Saindo…') : t('Sair')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
