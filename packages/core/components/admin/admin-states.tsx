'use client';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/analytics/shared';

/**
 * Admin pages share one shape: the shell prints the page title and description, the page only adds its cards (never
 * one repeating the page title). Before its data a page shows its own cards empty (`SectionCard loading`, `DataTable
 * loading`, `MetricGridSkeleton`); a failed read is this one state.
 */
export function AdminLoadError() {
  const { locale } = useI18n();
  const pt = locale === 'pt-BR';
  return (
    <EmptyState
      tone="error"
      title={pt ? 'Não foi possível carregar esta página' : 'Could not load this page'}
      description={pt ? 'Nada foi alterado. Tente de novo; se continuar, veja a saúde em Admin > Visão geral.' : 'Nothing was changed. Try again; if it keeps failing, check the health in Admin > Overview.'}
      action={<Button variant="outline" onClick={() => window.location.reload()}>{pt ? 'Tentar de novo' : 'Try again'}</Button>}
    />
  );
}
