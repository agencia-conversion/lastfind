'use client';
import { formatNumber } from '@/lib/number-format';

import { useEffect, useRef, useState } from 'react';
import { Radar } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { competitorIdentity } from '@/lib/competitor-identity';
import { requestJson } from '@/lib/client';
import { useReport } from '@/hooks/use-report';
import type { Project } from '@/lib/types';
import { MAX_COMPETITORS } from '@/lib/brand-decisions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { Note } from '@/components/lastfind/presentation/note';
import { ExcerptSnippet } from '@/components/analytics/answer-markdown';

type Candidate = {
  name: string;
  domain: string | null;
  score?: number;
  requiresVerification?: boolean;
  answerCount: number;
  evidence: Array<{ runId: string; excerpt: string; createdAt: string }>;
};

export type AnalysisStatus = {
  revision: string | null;
  mutationRevision: number;
  status: 'idle' | 'pending' | 'running' | 'complete' | 'failed';
  processed: number;
  scanned: number;
  phase: 'seeds' | 'analysis';
  total: number;
  truncated: boolean;
  cutoff: string | null;
  maxRuns: number;
  error: string | null;
  suggestions: Candidate[];
  publicationPending?: boolean;
  needsEnsure?: boolean;
  staleDetector?: { current: string; available: string } | null;
};

/** What an ensure can change in the analysis status: another ensure is worth sending only once one of these moved. */
const analysisMark = (status: AnalysisStatus) =>
  [status.revision, status.status, status.publicationPending, status.processed, status.mutationRevision].join('\0');

export function CompetitorDiscoveryPanel({
  project,
  readOnly,
  busy,
  refresh,
  onAdd,
  onEvidence,
  onCompleted,
  research,
  sample,
}: {
  sample?: AnalysisStatus;
  research?: { name: string; domain: string | null; answerCount: number; verifiedPrompts: number; rejectedPrompts: number; ambiguousPrompts: number; evidence: Candidate['evidence'] }[];
  project: Project;
  readOnly: boolean;
  busy: boolean;
  refresh: number | string;
  onAdd: (candidate: { name: string; domain: string }) => Promise<void>;
  onEvidence: (runId: string) => void | Promise<void>;
  onCompleted: (key: string) => void | Promise<void>;
}) {
  const { locale } = useI18n();
  const text = (en: string, pt: string) => (locale === 'en' ? en : pt);
  const [poll, setPoll] = useState(0);
  const [working, setWorking] = useState('');
  const [actionError, setActionError] = useState('');
  const [domains, setDomains] = useState<Record<string, string>>({});
  const url = sample
    ? null
    : `/api/projects/${project.id}/competitor-analysis`;
  const remote = useReport<AnalysisStatus>(url, `${refresh}:${poll}`);
  const analysis = sample ? { data: sample, loading: false, error: undefined } : remote;
  const ensureRequest = useRef<{
    url: string;
    controller: AbortController;
  } | null>(null);
  useEffect(
    () => () => {
      const active = ensureRequest.current;
      if (active?.url === url) {
        active.controller.abort();
        ensureRequest.current = null;
      }
    },
    [url],
  );
  // The status an ensure was sent for: it is not sent again until the status moves (an ensure that changed nothing, say a
  // store that keeps another config, would otherwise be sent after every read, without a pause).
  const ensuredFor = useRef('');
  const ensureMark = analysis.data && `${url}\0${refresh}\0${analysisMark(analysis.data)}`;
  useEffect(() => {
    if (readOnly || !url || remote.loading || !analysis.data?.needsEnsure || ensureRequest.current || ensuredFor.current === ensureMark) return;
    ensuredFor.current = ensureMark ?? '';
    const active = { url, controller: new AbortController() };
    ensureRequest.current = active;
    // One idempotent POST may outlive several status polls. Only changing the
    // project/unmounting aborts it; normal polling never restarts or overlaps it.
    requestJson(url, 'POST', { action: 'ensure' }, active.controller.signal)
      .then(() => {
        if (
          ensureRequest.current === active &&
          !active.controller.signal.aborted
        ) {
          setActionError('');
          setPoll((value) => value + 1);
        }
      })
      .catch((error) => {
        if (
          ensureRequest.current === active &&
          !active.controller.signal.aborted
        )
          setActionError(error.message);
      })
      .finally(() => {
        if (ensureRequest.current === active) ensureRequest.current = null;
      });
  }, [url, readOnly, remote.loading, analysis.data?.needsEnsure, ensureMark]);
  // While the analysis runs, its status is read again once the last read answered (never two at once: a read cut by the
  // next one never answers), sooner at first, then less and less often (1.2 s, growing to 10 s).
  const polls = useRef(0);
  const processing = ['pending', 'running'].includes(analysis.data?.status || '');
  useEffect(() => {
    if (!processing) polls.current = 0;
    if (!processing || remote.loading) return;
    let timer: number | undefined;
    const schedule = () => {
      if (document.visibilityState === 'visible')
        timer = window.setTimeout(() => {
          // An ensure under way reads the status itself when it answers.
          if (ensureRequest.current) return;
          polls.current++;
          setPoll((value) => value + 1);
        }, Math.min(10_000, 1200 * 1.5 ** polls.current));
    };
    const visibility = () => {
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      schedule();
    };
    document.addEventListener('visibilitychange', visibility);
    schedule();
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [processing, remote.loading, poll]);
  // A completion seen on this screen (a pass that ran or changed while it was open) asks the caller to read its reports again.
  // The analysis already complete when the screen opened is in the reads under way: asking then cut them and started over.
  const seen = useRef<{ key: string | null; status?: string }>({ key: null });
  useEffect(() => {
    const status = analysis.data?.status;
    const key = status === 'complete' && analysis.data?.revision ? `${project.id}:${analysis.data.revision}:${analysis.data.mutationRevision}` : null;
    const before = seen.current;
    seen.current = { key: key ?? before.key, status };
    if (key && key !== before.key && (before.key !== null || before.status === 'pending' || before.status === 'running')) void onCompleted(key);
  }, [
    analysis.data?.mutationRevision,
    analysis.data?.revision,
    analysis.data?.status,
    onCompleted,
    project.id,
  ]);

  async function refreshSuggestions() {
    if (readOnly || !url) return;
    setWorking('refresh');
    setActionError('');
    try {
      await requestJson(url, 'POST', { action: 'refresh' });
      setPoll((value) => value + 1);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : text(
              'Analysis could not be started.',
              'Não foi possível iniciar a análise.',
            ),
      );
    } finally {
      setWorking('');
    }
  }

  const localCandidates = analysis.data?.suggestions || [];
  const hybridCandidates = (research || []).filter((candidate) => !localCandidates.some((local) => local.name === candidate.name && local.domain === candidate.domain)).map((candidate) => ({ ...candidate, requiresVerification: true }));
  const candidates: Candidate[] = [...localCandidates, ...hybridCandidates].filter((candidate) => !research || research.some((reading) => reading.name === candidate.name && reading.domain === candidate.domain && reading.verifiedPrompts > 0)).filter(
    (candidate) =>
      !project.competitors.some(
        (tracked) =>
          competitorIdentity(tracked.name) ===
            competitorIdentity(candidate.name) ||
          (!!candidate.domain && tracked.domain === candidate.domain),
      ),
  );
  // Ten at first, ten more on request: hundreds of suggestions made Settings > Competitors tens of thousands of pixels long on a
  // phone.
  const [shown, setShown] = useState(10);
  const completed =
    analysis.data?.phase === 'seeds'
      ? analysis.data.scanned
      : analysis.data?.processed || 0;
  const progress = analysis.data?.total
    ? (((analysis.data.phase === 'analysis' ? analysis.data.total : 0) +
        completed) /
        (analysis.data.total * 2)) *
      100
    : 0;

  return (
    <SectionCard
      className="mb-6"
      title={
        <span className="flex items-center gap-2">
          <Radar className="size-4 text-primary" aria-hidden="true" />
          {text('Suggested competitors', 'Concorrentes sugeridos')}
        </span>
      }
      description={text(
        'Candidates appear in contexts similar to your brand and tracked competitors. Review the answer evidence before adding one.',
        'Os candidatos aparecem em contextos parecidos com os da sua marca e dos concorrentes monitorados. Revise as respostas antes de adicionar.',
      )}
      action={
        <Button
          variant="outline"
          disabled={!!sample || readOnly || busy || working === 'refresh' || processing}
          pending={processing}
          onClick={() => void refreshSuggestions()}
        >
          {text('Analyze again', 'Analisar novamente')}
        </Button>
      }
    >
      {!sample && !readOnly && !processing && analysis.data?.staleDetector && (
        <Note className="border-b">
          {text(
            'A new version of brand detection is available. Analyzing again updates the brands discovered in the last 90 days.',
            'Nova versão da detecção de marcas disponível. Analisar novamente atualiza as marcas descobertas dos últimos 90 dias.',
          )}
        </Note>
      )}
      {actionError && (
        <p role="alert" className="px-5 py-4 text-body text-destructive">
          {actionError}
        </p>
      )}
      {analysis.loading && !candidates.length ? (
        <Skeleton className="m-5 h-28" />
      ) : (analysis.error || analysis.data?.status === 'failed') && !candidates.length ? (
        <p role="alert" className="px-5 py-6 text-body text-destructive">
          {analysis.error ||
            analysis.data?.error ||
            text(
              'Analysis could not be completed.',
              'Não foi possível concluir a análise.',
            )}
        </p>
      ) : processing && !candidates.length ? (
        <div className="space-y-3 px-5 py-6">
          <div className="flex items-center justify-between gap-3 text-body">
            <span>
              {analysis.data?.phase === 'seeds'
                ? analysis.data.publicationPending
                  ? text(
                      'Preparing saved answers…',
                      'Preparando respostas salvas…',
                    )
                  : text(
                      'Finding comparable contexts…',
                      'Identificando contextos comparáveis…',
                    )
                : text(
                    'Updating recent answers…',
                    'Atualizando respostas recentes…',
                  )}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatNumber(locale, completed)} /{' '}
              {analysis.data ? formatNumber(locale, analysis.data.total) : '—'}
            </span>
          </div>
          <Progress
            value={progress}
            aria-label={text('Analysis progress', 'Progresso da análise')}
          />
        </div>
      ) : candidates.length ? (
        <div className="divide-y">
          {candidates.slice(0, shown).map((candidate) => {
            const candidateKey = JSON.stringify([candidate.name, candidate.domain]);
            const verified = research?.find((item) => item.name === candidate.name && item.domain === candidate.domain);
            const domain = domains[candidateKey] ?? candidate.domain ?? '';
            const atLimit = project.competitors.length >= MAX_COMPETITORS;
            return (
              <div key={candidateKey} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-body">{candidate.name}</p>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {verified ? formatNumber(locale, verified.answerCount) : research ? '0' : '—'}{' '}
                      {text(
                        'distinct prepared questions in the selected filters',
                        'perguntas distintas preparadas nos filtros selecionados',
                      )}
                    </p>
                    <p className="mt-1 text-caption text-muted-foreground">{verified?.verifiedPrompts ? text(`Confirmed in ${formatNumber(locale, verified.verifiedPrompts)} questions`, `Confirmado em ${formatNumber(locale, verified.verifiedPrompts)} perguntas`) : verified?.rejectedPrompts ? text('Not confirmed as a competitor', 'Não confirmado como concorrente') : text('Suggested from your answers', 'Sugerido a partir das suas respostas')}{verified?.ambiguousPrompts ? text(`, ${verified.ambiguousPrompts} ambiguous`, `, ${verified.ambiguousPrompts} ambíguas`) : ''}</p>
                  </div>
                  {/* On a phone the domain field and Add take their own row: squeezed beside the text the field shrank to nothing. */}
                  {!readOnly && <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center justify-end gap-2 sm:flex-none sm:basis-auto">
                    <Input
                      aria-label={text(
                        `Domain for ${candidate.name}`,
                        `Domínio de ${candidate.name}`,
                      )}
                      className="h-8 min-w-0 flex-1 sm:max-w-64 sm:flex-none"
                      placeholder={text('Confirm domain', 'Confirme o domínio')}
                      value={domain}
                      onChange={(event) =>
                        setDomains((current) => ({
                          ...current,
                          [candidateKey]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      disabled={busy || !!working || !domain.trim() || atLimit || (candidate.requiresVerification && !verified?.verifiedPrompts)}
                      onClick={() => {
                        setWorking(candidateKey);
                        setActionError('');
                        void onAdd({
                          name: candidate.name,
                          domain: domain.trim(),
                        })
                          .catch((error) =>
                            setActionError(
                              error instanceof Error
                                ? error.message
                                : text(
                                    'The competitor could not be added.',
                                    'Não foi possível adicionar o concorrente.',
                                  ),
                            ),
                          )
                          .finally(() => setWorking(''));
                      }}
                    >
                      {text('Add', 'Adicionar')}
                    </Button>
                  </div>}
                </div>
                {!!candidate.evidence.length && (
                  <div className="space-y-2">
                    {candidate.evidence.map((evidence) => (
                      <button
                        type="button"
                        key={evidence.runId}
                        className="block w-full rounded-md border bg-muted/20 px-3 py-2 text-left text-caption leading-relaxed hover:bg-muted/40"
                        onClick={() => void onEvidence(evidence.runId)}
                      >
                        <ExcerptSnippet text={evidence.excerpt} names={[candidate.name]} />
                      </button>
                    ))}
                  </div>
                )}
                {atLimit && (
                  <p className="text-caption text-muted-foreground">
                    {text(
                      'Remove a tracked competitor before adding another.',
                      'Remova um concorrente monitorado antes de adicionar outro.',
                    )}
                  </p>
                )}
              </div>
            );
          })}
          {candidates.length > shown && (
            <div className="px-5 py-3">
              <Button variant="outline" onClick={() => setShown((count) => count + 10)}>
                {text(`Show more (${formatNumber(locale, candidates.length - shown)})`, `Mostrar mais (${formatNumber(locale, candidates.length - shown)})`)}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="px-5 py-8 text-center text-body text-muted-foreground">
          {text(
            research ? 'No new competitors have been confirmed with sufficient evidence in this scope.' : 'No strong new candidates were found in the analyzed answers.',
            research ? 'Nenhum novo concorrente foi confirmado com evidência suficiente neste recorte.' : 'Nenhum novo candidato forte foi encontrado nas respostas analisadas.',
          )}
        </p>
      )}
      <p className="border-t bg-muted/20 px-5 py-3 text-caption leading-relaxed text-muted-foreground">
        {text(
          'Uses up to 10,000 eligible answers from the last 90 days. Adding a competitor reprocesses those saved answers without requesting them again.',
          'Usa até 10.000 respostas elegíveis dos últimos 90 dias. Ao adicionar um concorrente, essas respostas salvas são reprocessadas sem uma nova consulta.',
        )}
        {analysis.data?.truncated &&
          ` ${text('The newest 10,000 answers were used.', 'Foram usadas as 10.000 respostas mais recentes.')}`}
      </p>
    </SectionCard>
  );
}
