import type { Workspace } from './types';
export function formatMonitoringTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
export function monitoringStatus(workspace: Workspace, now: number) {
  const project = workspace.projects.find(
    (p) => p.id === workspace.selectedProjectId,
  );
  const active = workspace.prompts.filter((p) => p.active && !p.archived);
  const pending =
    workspace.monitoring?.pending ??
    workspace.runs.filter((r) =>
      ['queued', 'submitting', 'pending'].includes(r.status),
    ).length;
  const next =
    active
      .map((p) => p.next_run_at)
      .filter((d) => Number.isFinite(Date.parse(d)))
      .sort()[0] ?? null;
  const last =
    workspace.monitoring?.last ??
    workspace.runs
      .filter((r) => r.status === 'complete' && r.completed_at)
      .map((r) => r.completed_at!)
      .sort()
      .at(-1) ??
    null;
  const stale =
    !workspace.config.schedulerLastSeen ||
    now - Date.parse(workspace.config.schedulerLastSeen) > 60 * 60000;
  const overdue = !!next && Date.parse(next) + 15 * 60000 < now;
  let title = 'Acompanhamento automático';
  let description = next
    ? `Próxima consulta prevista: ${formatMonitoringTime(next)}`
    : 'Adicione ou retome um prompt para acompanhar.';
  if (!project?.daily_enabled) {
    title = 'Acompanhamento pausado';
    description = 'Retome o acompanhamento nas configurações.';
  } else if (pending) {
    title = 'Preparando suas respostas';
    description = `${pending} respostas em andamento. O prazo varia por plataforma; coletas em lote podem levar mais tempo.`;
  } else if (
    workspace.usage.limit !== null &&
    workspace.usage.used >= workspace.usage.limit
  ) {
    title = 'Limite mensal atingido';
    description = 'O acompanhamento será retomado após a renovação do limite.';
  } else if (overdue) {
    title = 'Atualização aguardando execução';
    description = `Prevista desde ${formatMonitoringTime(next!)}. O agendador ainda não iniciou uma nova consulta.`;
  }
  return { title, description, next, last, pending, overdue, stale };
}
