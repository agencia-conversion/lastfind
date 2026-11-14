'use client';
import { formatNumber } from '@/lib/number-format';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useReport } from '@/hooks/use-report';
import { requestJson } from '@/lib/client';
import { SENTIMENTS, type SentimentCriterion } from '@/lib/brand-research';
import type { BrandTarget, Project } from '@/lib/types';
import {
  CompetitorDiscoveryPanel,
  type AnalysisStatus,
} from '@/components/lastfind/competitor-discovery-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { BrandSentimentAnalysis, criteriaRule, sentimentLabel } from './brand-sentiment-analysis';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { SettingsBlock } from './settings-block';

export type BrandResearchReport = {
  configuration?: {
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
  configured: boolean;
  allowed: boolean;
  truncated: boolean;
  selectedChannels: number;
  maxChannels: number;
  unassessed: number;
  /** Saved evaluations made for another brand list or setup: kept, not counted. */
  outdated?: number;
  /** Monitored competitors beyond the evaluated list: no sentiment reading. */
  unread?: string[];
  brands: {
    brand: string;
    /** A discovery of the Brands screen: evaluated, but not part of the comparison of the project's own brands. */
    discovered?: boolean;
    prompts: number;
    assessed: number;
    absent: number;
    partial: number;
    pending: number;
    insufficient: number;
    ambiguous: number;
    failed: number;
    distribution: Record<(typeof SENTIMENTS)[number], number>;
    /** Sum of the assessed questions' 0–100 scores (`sentimentScore` makes the index). */
    scoreTotal?: number;
    /** The same aggregate per channel, for the channels where the brand has questions. */
    channels?: { engine: string; assessed: number; distribution: Record<(typeof SENTIMENTS)[number], number>; scoreTotal?: number }[];
  }[];
  /** The project brand's composed verdict per question (logical prompt id), assessed questions only. */
  units?: Record<string, { assessed: number; distribution: Record<(typeof SENTIMENTS)[number], number>; scoreTotal?: number }>;
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
    /** 0–100 under the current rule; null otherwise. */
    score?: number | null;
    /** The criteria met, each with the index of its quote in `evidence`; null without a score. */
    criteria?: Partial<Record<SentimentCriterion, number>> | null;
    evidence: string[];
  }[];
  detailsTruncated: boolean;
};
/** The read of {@link BrandResearchPanel} for these filters (a prompt's, or Settings'). */
export function researchPanelPath(projectId: string, filters: URLSearchParams, { promptId, settings = false }: { promptId?: string; settings?: boolean } = {}) {
  const query = new URLSearchParams(filters);
  query.delete('provider');
  if (promptId) query.set('prompt', promptId);
  // Beyond the aggregate: the question's evidence of every brand, discovered ones too, and in Settings the
  // suggestions' evidence (the competitor discovery shows it).
  if (promptId) query.set('evidenceBrand', '*');
  if (settings) query.set('suggestions', '1');
  // Always computed now (`fresh`): settings and evaluations act on it, never on a kept copy.
  query.set('fresh', '1');
  return `/api/projects/${encodeURIComponent(projectId)}/brand-research?${query}`;
}
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
  onDirty,
  request,
}: {
  /** The app's kept request, on the prompt page: the page starts this read with the prompt's report (researchPanelPath). */
  request?: typeof requestJson;
  onDirty?: (dirty: boolean) => void;
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
      enabled: boolean;
      baseline: boolean;
    } | null>(null),
    [saving, setSaving] = useState(false),
    [poll, setPoll] = useState(0),
    [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const evaluationInFlight = useRef(false);
  const url = demo || sample ? null : researchPanelPath(project.id, filters, { promptId, settings });
  const remote = useReport<BrandResearchReport>(url, `${refresh}:${poll}`, request);
  const report = sample
    ? { data: sample, loading: false, error: undefined }
    : remote;
  const savedEnabled = report.data?.configuration?.enabled ?? false;
  const revision = report.data?.configuration?.revision ?? 0;
  const configurationKey = `${project.id}:${revision}`;
  const currentDraft = draft?.key.startsWith(`${project.id}:`) ? draft : null;
  const enabled = currentDraft ? currentDraft.enabled : savedEnabled;
  const dirty =
    currentDraft !== null && currentDraft.enabled !== currentDraft.baseline;
  const dirtyCallback = useRef(onDirty);
  useEffect(() => {
    dirtyCallback.current = onDirty;
  }, [onDirty]);
  // Keep the draft guard active while the report refetches in the background.
  useEffect(() => {
    dirtyCallback.current?.(settings && dirty);
  }, [settings, dirty]);
  useEffect(() => () => dirtyCallback.current?.(false), []);
  const saveConfiguration = async () => {
    if (!url || !settings || !report.data || saving || working) return false;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      // The evaluator is chosen only in Admin; saving keeps it.
      await requestJson(url, 'PATCH', {
        enabled,
        expectedRevision: currentDraft
          ? Number(
              currentDraft.key.slice(currentDraft.key.lastIndexOf(':') + 1),
            )
          : revision,
      });
      setDraft(null);
      setPoll((value) => value + 1);
      setNotice(
        t(
          'Settings saved. Evaluation starts only when you choose Evaluate.',
          'Configuração salva. A avaliação começa somente ao escolher Avaliar.',
        ),
      );
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              'Could not save settings.',
              'Não foi possível salvar a configuração.',
            ),
      );
      return false;
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
  const label = (value: string) => sentimentLabel(value, t);
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
        ? await requestJson<{ enqueued: number }>(url, 'POST', {})
        : { enqueued: 0 };
      setNotice(
        t(
          report.data?.manualProcessing
            ? `${formatNumber(locale, result.enqueued)} evaluations queued. Processing this preview’s selected evaluator…`
            : `${formatNumber(locale, result.enqueued)} evaluations queued. Processing runs on the scheduler.`,
          report.data?.manualProcessing
            ? `${formatNumber(locale, result.enqueued)} avaliações na fila. Processando o avaliador selecionado deste preview…`
            : `${formatNumber(locale, result.enqueued)} avaliações na fila. O processamento ocorre pelo agendador.`,
        ),
      );
      setPoll((value) => value + 1);
      if (report.data?.manualProcessing) {
        for (let batch = 0; batch < 10; batch++) {
          const result = await requestJson<{
            processed: number;
            pending: number;
            failed: number;
          }>(url, 'POST', { action: 'process' });
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
      {settings && !demo && !report.data && !currentDraft && report.loading && <SectionCard loading lines={2} />}
      {settings && !demo && (report.data || currentDraft) && (
        <SettingsBlock
          title={t('Evaluation settings', 'Configurações da avaliação')}
          description={t(
            'Saving does not start an evaluation or a classification.',
            'Salvar não inicia avaliação nem classificação.',
          )}
          t={t}
          busy={busy || working || saving || !!sample || report.loading}
          dirty={dirty}
          onDirty={() => {}}
          onCancel={() => {
            setDraft(null);
            setError('');
          }}
          save={saveConfiguration}
        >
          <label className="live-model-option">
            <Checkbox
              checked={enabled}
              disabled={busy || working || saving || !!sample || report.loading}
              onCheckedChange={(value) =>
                setDraft({
                  key: currentDraft?.key ?? configurationKey,
                  enabled: !!value,
                  baseline: currentDraft?.baseline ?? savedEnabled,
                })
              }
            />
            {t('Enable evaluation', 'Habilitar avaliação')}
          </label>
        </SettingsBlock>
      )}

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
            <Button variant="outline" onClick={onManage}>
              {t('Manage in Settings', 'Gerenciar em Configurações')}
            </Button>
          )}
          {settings && !demo && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
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
              <p className="max-w-3xl text-body text-muted-foreground">
                {t(
                  'Enable evaluation for this project and review discovered competitors below. Saving does not start an evaluation or a classification.',
                  'Habilite a avaliação deste projeto e revise os concorrentes descobertos abaixo. Salvar não inicia avaliação nem classificação.',
                )}
              </p>
            ) : (
              <details className="max-w-3xl text-caption text-muted-foreground">
                <summary className="cursor-pointer">
                  {t('How sentiment is counted', 'Como o sentimento é contado')}
                </summary>
                <p className="mt-2">
                  {t(
                    `In every answer each brand starts at 50 and the evaluator answers yes or no to fixed criteria: ${criteriaRule(t)}; the score stays between 0 and 100: 60–100 promoter, 40–59 neutral, 0–39 detractor. Each logical question counts once per brand, with the mean of the latest completed answer of each selected AI; the index is the mean of the scores. Missing evidence stays unavailable.`,
                    `Em cada resposta cada marca parte de 50 e o avaliador responde sim ou não a critérios fixos: ${criteriaRule(t)}; a nota fica entre 0 e 100: 60–100 promotor, 40–59 neutro, 0–39 detrator. Cada pergunta lógica conta uma vez por marca, com a média da resposta completa mais recente de cada IA selecionada; o índice é a média das notas. Ausência de evidência continua indisponível.`,
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
          <p className="mt-4 text-body text-muted-foreground">
            {t(
              'No reviewed public sentiment has been published for this project. Private evaluations and excerpts are not exposed in the public demo.',
              'Nenhum sentimento público revisado foi publicado para este projeto. Avaliações e trechos privados não são expostos na demo pública.',
            )}
          </p>
        ) : report.loading ? (
          <output aria-busy="true" className="mt-4 block">
            <span className="sr-only">
              {t('Loading sentiment…', 'Carregando sentimentos…')}
            </span>
            <Skeleton className="h-32" />
          </output>
        ) : report.error ? (
          <p role="alert" className="mt-4 text-body text-destructive">
            {report.error}
          </p>
        ) : (
          report.data && (
            <>
              {report.data.previewImport && (
                <p className="mt-4 text-body text-muted-foreground">
                  {t(
                    settings
                      ? `Preview with ${formatNumber(locale, report.data.previewImport.answers)} imported public answers across ${formatNumber(locale, report.data.previewImport.questions)} questions. Original collection dates and sources are preserved. Automatic collection is paused.`
                      : `Real preview sample: ${formatNumber(locale, report.data.previewImport.answers)} answers, ${formatNumber(locale, report.data.previewImport.questions)} questions, collection paused.`,
                    settings
                      ? `Preview com ${formatNumber(locale, report.data.previewImport.answers)} respostas públicas importadas de ${formatNumber(locale, report.data.previewImport.questions)} perguntas. Datas de coleta e fontes originais preservadas. A coleta automática está pausada.`
                      : `Amostra real do preview: ${formatNumber(locale, report.data.previewImport.answers)} respostas, ${formatNumber(locale, report.data.previewImport.questions)} perguntas, coleta pausada.`,
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
                <p className="mt-4 text-body text-muted-foreground">
                  {t(
                    "Brand evaluation isn't available on this installation yet.",
                    'A avaliação de marcas ainda não está disponível nesta instalação.',
                  )}{' '}
                  <a href="/docs" className="text-primary hover:underline">
                    {t('Installation guide', 'Guia de instalação')}
                  </a>
                </p>
              )}
              {settings && report.data.configured && !report.data.allowed && (
                <p className="mt-4 text-body text-muted-foreground">
                  {t(
                    'Evaluation is not available for this project. Existing results remain available.',
                    'A avaliação não está disponível para este projeto. Os resultados existentes continuam disponíveis.',
                  )}
                </p>
              )}
              {!savedEnabled && (
                <p className="mt-3 text-body text-muted-foreground">
                  {t(
                    'Evaluation is disabled for this project. Existing results remain available.',
                    'A avaliação está desabilitada neste projeto. Os resultados existentes continuam disponíveis.',
                  )}
                </p>
              )}
              {/* Queue and coverage status is for Settings; the prompt page shows the reading only. */}
              {settings && (
              <p className="mt-3 text-caption text-muted-foreground">
                {formatNumber(locale, report.data.selectedChannels)}{' '}
                {t('latest AI answers', 'últimas respostas por IA')},{' '}
                {formatNumber(locale, report.data.unassessed)} {t('not evaluated', 'não avaliadas')}
                {working ||
                report.data.jobs.some((job) => job.status === 'submitting')
                  ? `, ${t('Processing queued evaluations…', 'Processando avaliações da fila…')}`
                  : pending
                    ? `, ${t('Evaluations queued', 'Avaliações na fila')}`
                    : ''}
              </p>
              )}
              {!!report.data.outdated && (
                <p className="mt-3 text-caption text-muted-foreground">
                  {t(
                    `${formatNumber(locale, report.data.outdated)} answers in this view were evaluated for an earlier brand list and are out of date. Those readings are not counted or carried over; evaluate again to refresh.`,
                    `${formatNumber(locale, report.data.outdated)} respostas desta visão foram avaliadas para uma lista de marcas anterior e estão desatualizadas. Essas leituras não são contadas nem transferidas; avalie novamente para atualizar.`,
                  )}
                </p>
              )}
              {settings && report.data.truncated && (
                <output className="mt-3 block text-body">
                  {t(
                    `Partial scope: only ${formatNumber(locale, report.data.selectedChannels)} latest question/AI channels fit this bounded report. Narrow the filters.`,
                    `Recorte parcial: somente ${formatNumber(locale, report.data.selectedChannels)} canais pergunta/IA recentes cabem neste relatório limitado. Restrinja os filtros.`,
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
              {settings &&
                report.data.jobs
                  .filter((job) => job.error && job.status !== 'unsettled')
                  .slice(0, 3)
                  .map((job) => (
                    <output
                      key={job.id}
                      className="mt-3 block text-body text-muted-foreground"
                    >
                      {job.status === 'unknown'
                        ? t(
                            'An evaluation could not be confirmed and will not be retried automatically.',
                            'Uma avaliação não pôde ser confirmada e não será repetida automaticamente.',
                          )
                        : t(
                            'An evaluation could not be completed.',
                            'Uma avaliação não pôde ser concluída.',
                          )}
                    </output>
                  ))}
            </>
          )
        )}
        {notice && <output className="mt-3 text-body">{notice}</output>}
        {error && (
          <p role="alert" className="mt-3 text-body text-destructive">
            {error}
          </p>
        )}
        </div>
      </SectionCard>
      {settings && report.data?.suggestionsTruncated && (
        <output className="block text-caption text-muted-foreground">
          {t(
            `Top ${report.data.maxSuggestions != null ? formatNumber(locale, report.data.maxSuggestions) : '—'} hybrid candidates, narrow filters for more`,
            `Top ${report.data.maxSuggestions != null ? formatNumber(locale, report.data.maxSuggestions) : '—'} candidatos híbridos, filtre para ver mais`,
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
