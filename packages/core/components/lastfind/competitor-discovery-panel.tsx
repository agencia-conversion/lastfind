'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { competitorIdentity } from '@/lib/competitor-identity';
import { requestJson } from '@/lib/client';
import { useReport } from '@/hooks/use-report';
import type { Project } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

type Candidate = {
  name: string;
  domain: string | null;
  score: number;
  answerCount: number;
  evidence: Array<{ runId: string; excerpt: string; createdAt: string }>;
};

type AnalysisStatus = {
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
};

export function CompetitorDiscoveryPanel({
  project,
  readOnly,
  busy,
  refresh,
  onAdd,
  onEvidence,
  onCompleted,
}: {
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
  const url = readOnly
    ? null
    : `/api/projects/${project.id}/competitor-analysis`;
  const analysis = useReport<AnalysisStatus>(url, `${refresh}:${poll}`);
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
  useEffect(() => {
    if (!url || !analysis.data?.needsEnsure || ensureRequest.current) return;
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
  }, [
    url,
    analysis.data?.needsEnsure,
    analysis.data?.publicationPending,
    refresh,
    poll,
  ]);
  useEffect(() => {
    if (!['pending', 'running'].includes(analysis.data?.status || '')) return;
    let timer: number | undefined;
    const schedule = () => {
      if (document.visibilityState === 'visible')
        timer = window.setTimeout(() => setPoll((value) => value + 1), 1200);
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
  }, [analysis.data?.status, poll]);
  useEffect(() => {
    if (analysis.data?.status === 'complete' && analysis.data.revision)
      void onCompleted(
        `${project.id}:${analysis.data.revision}:${analysis.data.mutationRevision}`,
      );
  }, [
    analysis.data?.mutationRevision,
    analysis.data?.revision,
    analysis.data?.status,
    onCompleted,
    project.id,
  ]);

  async function refreshSuggestions() {
    if (!url) return;
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

  const candidates = (analysis.data?.suggestions || []).filter(
    (candidate) =>
      !project.competitors.some(
        (tracked) =>
          competitorIdentity(tracked.name) ===
            competitorIdentity(candidate.name) ||
          (!!candidate.domain && tracked.domain === candidate.domain),
      ),
  );
  const processing = ['pending', 'running'].includes(
    analysis.data?.status || '',
  );
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
    <Card className="mb-6 gap-0 overflow-hidden py-0 ring-1 ring-border/70">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="max-w-2xl">
          <h2 className="!mt-0 flex items-center gap-2 !text-sm !leading-5 !font-semibold !tracking-normal">
            <Sparkles className="size-4 text-primary" />
            {text('Suggested competitors', 'Concorrentes sugeridos')}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {text(
              'Candidates appear in contexts similar to your brand and tracked competitors. Review the answer evidence before adding one.',
              'Os candidatos aparecem em contextos parecidos com os da sua marca e dos concorrentes monitorados. Revise as respostas antes de adicionar.',
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={readOnly || busy || working === 'refresh' || processing}
          onClick={() => void refreshSuggestions()}
        >
          <RefreshCw className={processing ? 'animate-spin' : ''} />
          {text('Analyze again', 'Analisar novamente')}
        </Button>
      </div>
      {actionError && (
        <p role="alert" className="px-5 py-4 text-sm text-destructive">
          {actionError}
        </p>
      )}
      {analysis.loading ? (
        <Skeleton className="m-5 h-28" />
      ) : analysis.error || analysis.data?.status === 'failed' ? (
        <p role="alert" className="px-5 py-6 text-sm text-destructive">
          {analysis.error ||
            analysis.data?.error ||
            text(
              'Analysis could not be completed.',
              'Não foi possível concluir a análise.',
            )}
        </p>
      ) : processing ? (
        <div className="space-y-3 px-5 py-6">
          <div className="flex items-center justify-between gap-3 text-sm">
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
              {completed.toLocaleString(locale)} /{' '}
              {analysis.data?.total.toLocaleString(locale)}
            </span>
          </div>
          <Progress
            value={progress}
            aria-label={text('Analysis progress', 'Progresso da análise')}
          />
        </div>
      ) : candidates.length ? (
        <div className="divide-y">
          {candidates.map((candidate) => {
            const domain = domains[candidate.name] ?? candidate.domain ?? '';
            const atLimit = project.competitors.length >= 5;
            return (
              <div key={candidate.name} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{candidate.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {candidate.answerCount.toLocaleString(locale)}{' '}
                      {text(
                        'answers with comparable mentions',
                        'respostas com menções comparáveis',
                      )}
                    </p>
                  </div>
                  <div className="flex min-w-64 flex-1 items-center justify-end gap-2 sm:flex-none">
                    <Input
                      aria-label={text(
                        `Domain for ${candidate.name}`,
                        `Domínio de ${candidate.name}`,
                      )}
                      className="h-8 max-w-64"
                      placeholder={text('Confirm domain', 'Confirme o domínio')}
                      value={domain}
                      onChange={(event) =>
                        setDomains((current) => ({
                          ...current,
                          [candidate.name]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      disabled={busy || !!working || !domain.trim() || atLimit}
                      onClick={() => {
                        setWorking(candidate.name);
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
                  </div>
                </div>
                {!!candidate.evidence.length && (
                  <div className="space-y-2">
                    {candidate.evidence.map((evidence) => (
                      <button
                        type="button"
                        key={evidence.runId}
                        className="block w-full rounded-md border bg-muted/20 px-3 py-2 text-left text-xs leading-relaxed hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => void onEvidence(evidence.runId)}
                      >
                        “{evidence.excerpt}”
                      </button>
                    ))}
                  </div>
                )}
                {atLimit && (
                  <p className="text-xs text-muted-foreground">
                    {text(
                      'Remove a tracked competitor before adding another.',
                      'Remova um concorrente monitorado antes de adicionar outro.',
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          {text(
            'No strong new candidates were found in the analyzed answers.',
            'Nenhum novo candidato forte foi encontrado nas respostas analisadas.',
          )}
        </p>
      )}
      <p className="border-t bg-muted/20 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
        {text(
          'Uses up to 10,000 eligible answers from the last 90 days. Adding a competitor reprocesses those saved answers without requesting them again.',
          'Usa até 10.000 respostas elegíveis dos últimos 90 dias. Ao adicionar um concorrente, essas respostas salvas são reprocessadas sem uma nova consulta.',
        )}
        {analysis.data?.truncated &&
          ` ${text('The newest 10,000 answers were used.', 'Foram usadas as 10.000 respostas mais recentes.')}`}
      </p>
    </Card>
  );
}
