'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useReport } from '@/hooks/use-report';
import { requestJson } from '@/lib/client';
import { SENTIMENTS, type ResearchProvider } from '@/lib/brand-research';
import type { BrandTarget, Project } from '@/lib/types';
import {
  CompetitorDiscoveryPanel,
  type AnalysisStatus,
} from '@/components/lastfind/competitor-discovery-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { BrandSentimentAnalysis } from './brand-sentiment-analysis';
import { FilterSelect } from './shared';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionCard } from '@/components/lastfind/presentation/section-card';

export type BrandResearchReport = {
  configuration?: {
    provider: ResearchProvider;
    enabled: boolean;
    revision: number;
    updatedAt: string | null;
  };
  manualProcessing?: boolean;
  previewImport?: {
    kind: string;
    importedAt: string;
    answers: number;
    questions: number;
    sourceUrl: string;
  } | null;
  provider: ResearchProvider;
  model: string;
  configured: boolean;
  allowed: boolean;
  truncated: boolean;
  selectedChannels: number;
  maxChannels: number;
  unassessed: number;
  brands: {
    brand: string;
    prompts: number;
    assessed: number;
    absent: number;
    partial: number;
    pending: number;
    insufficient: number;
    ambiguous: number;
    failed: number;
    distribution: Record<(typeof SENTIMENTS)[number], number>;
  }[];
  jobs: { id: string; status: string; error: string | null }[];
  suggestionsTruncated?: boolean;
  maxSuggestions?: number;
  suggestions: {
    name: string;
    domain: string | null;
    answerCount: number;
    verifiedPrompts: number;
    rejectedPrompts: number;
    ambiguousPrompts: number;
    evidence: { runId: string; excerpt: string; createdAt: string }[];
  }[];
  details: {
    runId: string;
    unitId: string;
    prompt: string;
    engine: string;
    date: string;
    brand: string;
    state: string;
    sentiment: string | null;
    evidence: string[];
  }[];
  detailsTruncated: boolean;
};
export function BrandResearchPanel({
  project,
  filters,
  demo,
  refresh,
  busy,
  onAdd,
  onEvidence,
  promptId,
  sample,
  discoverySample,
  settings = false,
  onManage,
}: {
  settings?: boolean;
  onManage?: () => void;
  sample?: BrandResearchReport;
  discoverySample?: AnalysisStatus;
  project: Project;
  filters: URLSearchParams;
  demo: boolean;
  refresh: string | number;
  busy: boolean;
  onAdd?: (candidate: BrandTarget) => Promise<void>;
  onEvidence: (runId: string) => void;
  promptId?: string;
}) {
  const { locale } = useI18n();
  const t = (en: string, pt: string) => (locale === 'en' ? en : pt);
  const [draft, setDraft] = useState<{
      key: string;
      provider: ResearchProvider;
      enabled: boolean;
    } | null>(null),
    [saving, setSaving] = useState(false),
    [poll, setPoll] = useState(0),
    [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const evaluationInFlight = useRef(false);
  const query = new URLSearchParams(filters);
  query.delete('provider');
  if (promptId) query.set('prompt', promptId);
  const url =
    demo || sample
      ? null
      : `/api/projects/${encodeURIComponent(project.id)}/brand-research?${query}`;
  const remote = useReport<BrandResearchReport>(url, `${refresh}:${poll}`);
  const report = sample
    ? { data: sample, loading: false, error: undefined }
    : remote;
  const savedProvider =
    report.data?.configuration?.provider || report.data?.provider || 'jev';
  const savedEnabled = report.data?.configuration?.enabled ?? false;
  const revision = report.data?.configuration?.revision ?? 0;
  const configurationKey = `${project.id}:${revision}`;
  const provider =
    draft?.key === configurationKey ? draft.provider : savedProvider;
  const enabled =
    draft?.key === configurationKey ? draft.enabled : savedEnabled;
  const dirty = provider !== savedProvider || enabled !== savedEnabled;
  const saveConfiguration = async () => {
    if (!url || !settings || saving || working) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await requestJson(url, 'PATCH', {
        provider,
        enabled,
        expectedRevision: revision,
      });
      setPoll((value) => value + 1);
      setNotice(
        t(
          'Settings saved. Evaluation starts only when you choose Evaluate.',
          'Configuração salva. A avaliação começa somente ao escolher Avaliar.',
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              'Could not save settings.',
              'Não foi possível salvar a configuração.',
            ),
      );
      setPoll((value) => value + 1);
    } finally {
      setSaving(false);
    }
  };
  const onDiscoveryCompleted = useCallback(
    () => setPoll((value) => value + 1),
    [],
  );
  const pending = report.data?.jobs.some((job) =>
    ['pending', 'submitting'].includes(job.status),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPoll((value) => value + 1), 5000);
    return () => clearTimeout(timer);
  }, [pending, poll]);
  const label = (value: string) =>
    ({
      positive: t('Positive', 'Positivo'),
      neutral: t('Neutral', 'Neutro'),
      negative: t('Negative', 'Negativo'),
      mixed: t('Mixed', 'Misto'),
      insufficient: t('Insufficient evidence', 'Evidência insuficiente'),
      ambiguous: t('Ambiguous identity', 'Identidade ambígua'),
      absent: t('No mention', 'Sem menção'),
      unassessed: t('Not evaluated', 'Não avaliado'),
      pending: t('Queued', 'Na fila'),
      submitting: t('Evaluating', 'Avaliando'),
      completed: t('Evaluated', 'Avaliado'),
      unsettled: t('Evaluated; cost pending', 'Avaliado; custo pendente'),
      cancelled: t('Cancelled', 'Cancelado'),
      failed: t('Evaluation failed', 'Falha na avaliação'),
      unknown: t(
        'Outcome unknown; no automatic resend',
        'Resultado incerto; sem reenvio automático',
      ),
    })[value] || value;
  const evaluate = async () => {
    if (
      !url ||
      !settings ||
      !savedEnabled ||
      dirty ||
      saving ||
      evaluationInFlight.current
    )
      return;
    evaluationInFlight.current = true;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const result = report.data?.unassessed
        ? await requestJson<{ enqueued: number }>(url, 'POST', {
            provider: savedProvider,
          })
        : { enqueued: 0 };
      setNotice(
        t(
          report.data?.manualProcessing
            ? `${result.enqueued} evaluations queued. Processing this preview’s selected evaluator…`
            : `${result.enqueued} evaluations queued. Processing runs on the scheduler.`,
          report.data?.manualProcessing
            ? `${result.enqueued} avaliações na fila. Processando o avaliador selecionado deste preview…`
            : `${result.enqueued} avaliações na fila. O processamento ocorre pelo agendador.`,
        ),
      );
      setPoll((value) => value + 1);
      if (report.data?.manualProcessing) {
        for (let batch = 0; batch < 10; batch++) {
          const result = await requestJson<{
            processed: number;
            pending: number;
            failed: number;
          }>(url, 'POST', { action: 'process', provider: savedProvider });
          setPoll((value) => value + 1);
          if (!result.processed || !result.pending || result.failed) break;
        }
        setNotice(
          t(
            'Preview processing finished. Review the coverage and any errors below.',
            'O processamento do preview terminou. Revise a cobertura e eventuais erros abaixo.',
          ),
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              'Could not start evaluation.',
              'Não foi possível iniciar a avaliação.',
            ),
      );
    } finally {
      evaluationInFlight.current = false;
      setWorking(false);
    }
  };
  return (
    <div className="space-y-6 min-w-0">
      <SectionCard
        className="min-w-0"
        title={t(
          settings
            ? 'Brand discovery and sentiment'
            : 'Brand sentiment by monitored question',
          settings
            ? 'Descoberta de marcas e sentimento'
            : 'Sentimento da marca por pergunta monitorada',
        )}
        action={
          <>
          {!settings && onManage && (
            <Button variant="outline" size="sm" onClick={onManage}>
              {t('Manage in Settings', 'Gerenciar em Settings')}
            </Button>
          )}
          {settings && !demo && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={enabled}
                  disabled={
                    busy || working || saving || !!sample || report.loading
                  }
                  onCheckedChange={(value) =>
                    setDraft({
                      key: configurationKey,
                      provider,
                      enabled: !!value,
                    })
                  }
                />
                {t('Enable evaluation', 'Habilitar avaliação')}
              </label>
              <FilterSelect
                label={t('Sentiment evaluator', 'Avaliador de sentimento')}
                value={provider}
                disabled={
                  busy || working || saving || !!sample || report.loading
                }
                onChange={(value) => {
                  setDraft({
                    key: configurationKey,
                    provider: value as ResearchProvider,
                    enabled,
                  });
                  setError('');
                  setNotice('');
                }}
                options={[
                  { value: 'jev', label: 'Jev 1.14' },
                  { value: 'decisions', label: 'OpenAI Decisions' },
                ]}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={
                  busy ||
                  working ||
                  saving ||
                  !!sample ||
                  report.loading ||
                  !dirty
                }
                onClick={() => void saveConfiguration()}
              >
                {saving
                  ? t('Saving…', 'Salvando…')
                  : t('Save settings', 'Salvar configuração')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !!sample ||
                  !savedEnabled ||
                  dirty ||
                  saving ||
                  busy ||
                  working ||
                  (pending && !report.data?.manualProcessing) ||
                  !report.data?.configured ||
                  !report.data?.allowed ||
                  (!report.data.unassessed &&
                    !(report.data.manualProcessing && pending))
                }
                onClick={() => void evaluate()}
              >
                {working
                  ? t('Processing…', 'Processando…')
                  : pending && report.data?.manualProcessing
                    ? t(
                        'Process queued evaluations',
                        'Processar avaliações da fila',
                      )
                    : t(
                        'Evaluate up to 20 answers',
                        'Avaliar até 20 respostas',
                      )}
              </Button>
            </div>
          )}
          </>
        }
      >
        <div className="px-5 pb-5">
            {settings ? (
              <p className="max-w-3xl text-sm text-muted-foreground">
                {t(
                  'Choose the evaluator for this project, enable evaluation and review discovered competitors below. The same evaluator classifies cited sources by type. Saving does not start an evaluation or a classification.',
                  'Escolha o avaliador deste projeto, habilite a avaliação e revise os concorrentes descobertos abaixo. O mesmo avaliador classifica as fontes citadas por tipo. Salvar não inicia avaliação nem classificação.',
                )}
              </p>
            ) : (
              <details className="max-w-3xl text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {t('How sentiment is counted', 'Como o sentimento é contado')}
                </summary>
                <p className="mt-2">
                  {t(
                    'Each logical question counts once per brand. We use its latest completed answer from each selected AI. Positive and negative views together become mixed; missing evidence stays unavailable.',
                    'Cada pergunta lógica conta uma vez por marca. Usamos sua resposta completa mais recente em cada IA selecionada. Visões positivas e negativas juntas compõem misto; ausência de evidência continua indisponível.',
                  )}
                </p>
                <p className="mt-2">
                  {t(
                    'Counts are questions, not name repetitions or model votes. Evaluated counts can have partial AI coverage. Unassessed, insufficient and ambiguous evidence never becomes neutral. Each bar divides evaluated logical questions only. Coverage states can overlap.',
                    'As contagens representam perguntas, sem repetição de nomes ou votos de modelos. Avaliadas podem ter cobertura parcial de IA. Evidência não avaliada, insuficiente ou ambígua nunca vira neutra. Cada barra divide somente perguntas lógicas avaliadas. Estados de cobertura podem se sobrepor.',
                  )}
                </p>
                {report.data?.previewImport && (
                  <p className="mt-2">
                    {t(
                      'This preview imports public answers with original collection dates and sources preserved. Automatic collection is paused.',
                      'Este preview importa respostas públicas preservando datas de coleta e fontes originais. A coleta automática está pausada.',
                    )}
                  </p>
                )}
              </details>
            )}
        {demo ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t(
              'No reviewed public sentiment has been published for this project. Private evaluations and excerpts are not exposed in the public demo.',
              'Nenhum sentimento público revisado foi publicado para este projeto. Avaliações e trechos privados não são expostos na demo pública.',
            )}
          </p>
        ) : report.loading ? (
          <Skeleton className="mt-4 h-32" />
        ) : report.error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {report.error}
          </p>
        ) : (
          report.data && (
            <>
              {report.data.previewImport && (
                <p className="mt-4 text-sm text-muted-foreground">
                  {t(
                    settings
                      ? `Preview with ${report.data.previewImport.answers} imported public answers across ${report.data.previewImport.questions} questions. Original collection dates and sources are preserved. Automatic collection is paused.`
                      : `Real preview sample: ${report.data.previewImport.answers} answers · ${report.data.previewImport.questions} questions · collection paused.`,
                    settings
                      ? `Preview com ${report.data.previewImport.answers} respostas públicas importadas de ${report.data.previewImport.questions} perguntas. Datas de coleta e fontes originais preservadas. A coleta automática está pausada.`
                      : `Amostra real do preview: ${report.data.previewImport.answers} respostas · ${report.data.previewImport.questions} perguntas · coleta pausada.`,
                  )}{' '}
                  <a
                    className="text-primary hover:underline"
                    href={report.data.previewImport.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('Public source', 'Fonte pública')}
                  </a>
                </p>
              )}
              {settings && !report.data.configured && (
                <p className="mt-4 text-sm text-muted-foreground">
                  {t(
                    'Add the OpenRouter API key to the server configuration to enable Jev and OpenAI Decisions.',
                    'Adicione a chave OpenRouter à configuração do servidor para habilitar Jev e OpenAI Decisions.',
                  )}
                </p>
              )}
              {settings && report.data.configured && !report.data.allowed && (
                <p className="mt-4 text-sm text-muted-foreground">
                  {t(
                    'Evaluation requires operator authorization for this project. Existing results remain available.',
                    'A avaliação requer autorização do operador para este projeto. Os resultados existentes continuam disponíveis.',
                  )}
                </p>
              )}
              {!savedEnabled && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t(
                    'Evaluation is disabled for this project. Existing results remain available.',
                    'A avaliação está desabilitada neste projeto. Os resultados existentes continuam disponíveis.',
                  )}
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {report.data.model} · {report.data.selectedChannels}{' '}
                {t('latest AI answers', 'últimas respostas por IA')} ·{' '}
                {report.data.unassessed} {t('not evaluated', 'não avaliadas')}
                {working ||
                report.data.jobs.some((job) => job.status === 'submitting')
                  ? ` · ${t('Processing queued evaluations…', 'Processando avaliações da fila…')}`
                  : pending
                    ? ` · ${t('Evaluations queued', 'Avaliações na fila')}`
                    : ''}
              </p>
              {report.data.truncated && (
                <output className="mt-3 block text-sm">
                  {t(
                    `Partial scope: only ${report.data.selectedChannels} latest question/AI channels fit this bounded report. Narrow the filters.`,
                    `Recorte parcial: somente ${report.data.selectedChannels} canais pergunta/IA recentes cabem neste relatório limitado. Restrinja os filtros.`,
                  )}
                </output>
              )}
              {!settings && (
                <BrandSentimentAnalysis
                  report={report.data}
                  project={project}
                  onEvidence={onEvidence}
                  label={label}
                />
              )}
              {report.data.jobs
                .filter((job) => job.error)
                .slice(0, 3)
                .map((job) => (
                  <output
                    key={job.id}
                    className="mt-3 text-sm text-destructive"
                  >
                    {label(job.status)}:{' '}
                    {job.status === 'unsettled'
                      ? t(
                          'Sentiment is available. The cost is pending and its conservative reservation is retained.',
                          'O sentimento está disponível. O custo está pendente e sua reserva conservadora foi mantida.',
                        )
                      : job.status === 'unknown'
                        ? t(
                            'The provider outcome is unknown. This evaluation will not be resent automatically.',
                            'O resultado do provedor é incerto. Esta avaliação não será reenviada automaticamente.',
                          )
                        : t(
                            'The evaluation could not be completed. Review the server configuration or contact your operator.',
                            'Não foi possível concluir a avaliação. Revise a configuração do servidor ou contate o operador.',
                          )}
                  </output>
                ))}
            </>
          )
        )}
        {notice && <output className="mt-3 text-sm">{notice}</output>}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        </div>
      </SectionCard>
      {settings && report.data?.suggestionsTruncated && (
        <output className="block text-sm text-muted-foreground">
          {t(
            `Showing the first ${report.data.maxSuggestions} hybrid candidates. Narrow the filters for additional candidates.`,
            `Exibindo os primeiros ${report.data.maxSuggestions} candidatos híbridos. Restrinja os filtros para ver os demais.`,
          )}
        </output>
      )}
      {settings && !promptId && !demo && onAdd && (
        <CompetitorDiscoveryPanel
          project={project}
          sample={discoverySample}
          readOnly={false}
          busy={busy || working || saving}
          refresh={refresh}
          onAdd={onAdd}
          onEvidence={onEvidence}
          onCompleted={onDiscoveryCompleted}
          research={report.data?.suggestions || []}
        />
      )}
    </div>
  );
}
