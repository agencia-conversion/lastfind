'use client';
import { useI18n } from '@/lib/i18n';

const STATUS_NAMES: Record<string, string> = {
  queued: 'Na fila',
  submitting: 'Enviando',
  pending: 'Coletando',
  complete: 'Concluída',
  failed: 'Falhou',
  unknown: 'Sem confirmação',
};

// Collection status pill shared by the evidence sheet and the response
// tables. Extracted out of workspace-app.tsx so both call sites (and any
// future one) render the exact same dot + label instead of drifting apart.
export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <span className={`run-status status-${status}`}>
      <span />
      {t(STATUS_NAMES[status] ?? status)}
    </span>
  );
}
