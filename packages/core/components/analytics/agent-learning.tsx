'use client';
// What the agent learns, as the person sees and undoes it (both editions): the note under an answer when the agent
// changed the Brain, the Memory or a skill (lib/agent-learning.ts), what the curator changed after a conversation, the
// rating with its reason and comment, a text's history with Restore, and the optional learning limit in
// Settings > Agent. Only catalog components.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Bookmark, ChevronDown, NotebookPen, ThumbsDown, ThumbsUp } from 'lucide-react';
import { requestJson } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { skillTitle, visibleLines, type LearnedChange } from '@/lib/agent-learning';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { DetailBody, DetailBodySkeleton, DetailHeader, DetailPage } from '@/components/lastfind/presentation/detail-page';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { Note } from '@/components/lastfind/presentation/note';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { SettingsBlock } from './settings-block';
import { EmptyState } from './shared';

type T = (en: string, pt: string) => string;
export type Change = LearnedChange & { current?: number; author?: string; at?: string };
/** Sent by the chat when a rating will teach the agent: the conversation's changes are polled for a while. */
export const LEARNING_EVENT = 'lastfind:agent-learning';

const shortDate = (value: string, locale: string) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(value));
const dateTime = (value: string, locale: string) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const ICONS = { skill: BookOpen, brain: NotebookPen, memory: Bookmark };

/** The open project's address (`/app/<workspace>/<project>`, app-routes.ts), given by the app: its Agent screens' links start with it. */
export const ProjectHrefContext = createContext('/app');
/** An address of another Agent screen of this project. */
const screenHref = (base: string, screen: string, query: string) => `${base}/${screen}?${query}`;
/** Where a change's history opens: Agent > Skills for a skill, Agent > Brain for a file. */
const historyHref = (base: string, change: Change) =>
  change.target === 'skill' ? screenHref(base, 'skills', `skill=${encodeURIComponent(change.name ?? '')}&history=1`) : screenHref(base, 'brain', `file=${encodeURIComponent(change.id)}&history=1`);
const restoreUrl = (change: Change, version: number) =>
  change.target === 'skill' ? `/api/agent/skills/${encodeURIComponent(change.name ?? '')}/versions/${version}/restore` : `/api/agent/artifacts/${encodeURIComponent(change.id)}/versions/${version}/restore`;

function changeTitle(change: Change, t: T, pt: boolean) {
  if (change.target === 'skill') return t(`Skill updated: ${skillTitle(change.name ?? '', pt, change.name && change.title !== change.name ? change.title : null)}`, `Skill atualizada: ${skillTitle(change.name ?? '', pt, change.name && change.title !== change.name ? change.title : null)}`);
  if (change.target === 'memory') return t('Memory updated', 'Memória atualizada');
  return t(`Brain updated: ${change.title}`, `Cérebro atualizado: ${change.title}`);
}

/** The lines a change added (+) and removed (−), each read out as such. */
function ChangedLines({ added: allAdded, removed: allRemoved, t }: { added: string[]; removed: string[]; t: T }) {
  // A template's hint giving way to the first line is not a change anyone made; every other line shows (visibleLines).
  const { shown: added, hidden: addedHidden } = visibleLines(allAdded);
  const { shown: removed, hidden: removedHidden } = visibleLines(allRemoved);
  const hidden = addedHidden + removedHidden;
  if (!added.length && !removed.length && !hidden) return null;
  const clean = (line: string) => line.replace(/^\s*[-*]\s+/, '').replace(/^#+\s*/, '');
  return (
    <ul className="agent-change-lines grid gap-1 text-caption">
      {added.map((line, index) => (
        <li key={`a${index}`} className="text-foreground">
          <span aria-hidden="true">+ </span>
          <span className="sr-only">{t('Added: ', 'Adicionado: ')}</span>
          {clean(line)}
        </li>
      ))}
      {removed.map((line, index) => (
        <li key={`r${index}`} className="text-muted-foreground line-through">
          <span aria-hidden="true">− </span>
          <span className="sr-only">{t('Removed: ', 'Removido: ')}</span>
          {clean(line)}
        </li>
      ))}
      {hidden > 0 && <li className="text-muted-foreground">{t(`${hidden} template ${hidden === 1 ? 'line' : 'lines'} hidden`, `${hidden} ${hidden === 1 ? 'linha' : 'linhas'} do modelo ${hidden === 1 ? 'oculta' : 'ocultas'}`)}</li>}
    </ul>
  );
}

/**
 * One change under an answer (or after the conversation): what it changed, Undo (its previous version comes back as a new
 * one; when it changed again since, the history decides) and History.
 */
export function AgentChangeNote({ change, t }: { change: Change; t: T }) {
  const projectHref = useContext(ProjectHrefContext);
  const { locale } = useI18n();
  const pt = locale === 'pt-BR';
  const [state, setState] = useState<'idle' | 'undoing' | 'undone' | 'moved' | 'error'>('idle');
  const Icon = ICONS[change.target];
  const moved = change.current !== undefined && change.current !== change.version;
  const undo = async () => {
    setState('undoing');
    try {
      if (change.target === 'skill' && change.version === 1) await requestJson(`/api/agent/skills/${encodeURIComponent(change.name ?? '')}`, 'DELETE');
      else await requestJson(restoreUrl(change, change.version - 1), 'POST', { expected: change.version });
      setState('undone');
    } catch (cause) {
      setState((cause as { status?: number }).status === 409 ? 'moved' : 'error');
    }
  };
  return (
    <Item variant="outline" size="sm" className="agent-change-note">
      <ItemMedia variant="icon">
        <Icon aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{change.author === 'guard' ? t('Undone automatically: answers got worse after this change', 'Desfeito automaticamente: as respostas pioraram depois desta mudança') : changeTitle(change, t, pt)}</ItemTitle>
        <ChangedLines added={change.added} removed={change.removed} t={t} />
        {state === 'moved' || (moved && state === 'idle') ? (
          <p className="text-caption text-muted-foreground">{t('This changed again since. Open its history.', 'Isto mudou de novo depois. Abra o histórico.')}</p>
        ) : state === 'error' ? (
          <p className="text-caption text-destructive">{t('Could not undo. Try again.', 'Não foi possível desfazer. Tente de novo.')}</p>
        ) : null}
      </ItemContent>
      <ItemActions>
        {state === 'undone' ? (
          <TagBadge tone="quiet">{t('Undone', 'Desfeito')}</TagBadge>
        ) : (
          !moved &&
          change.author !== 'guard' &&
          (change.version > 1 || change.target === 'skill') && (
            <Button variant="ghost" pending={state === 'undoing'} pendingLabel={t('Undoing…', 'Desfazendo…')} onClick={() => void undo()}>
              {t('Undo', 'Desfazer')}
            </Button>
          )
        )}
        <Button variant="ghost" nativeButton={false} render={<a href={historyHref(projectHref, change)} aria-label={t(`History: ${changeTitle(change, t, pt)}`, `Histórico: ${changeTitle(change, t, pt)}`)} />}>
          {t('History', 'Histórico')}
        </Button>
      </ItemActions>
    </Item>
  );
}

/**
 * What the curator changed after this conversation, under its last answer. After a rating that teaches the agent
 * (LEARNING_EVENT) it looks again every 5 seconds for 90 seconds. A conversation just created (`fresh`) has none yet: it
 * reads only after such a rating (no request beside its first message).
 */
export function ConversationChanges({ conversationId, fresh, t }: { conversationId: string; fresh?: boolean; t: T }) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [learning, setLearning] = useState<'idle' | 'waiting' | 'later'>('idle');
  // Whether it was just created when it showed (later renders do not change that).
  const freshRef = useRef(fresh);
  useEffect(() => {
    let current = true;
    let timer = 0;
    const read = () =>
      requestJson<{ changes: Change[] }>(`/api/agent/conversations/${encodeURIComponent(conversationId)}/changes`).then(
        (data) => {
          if (current) setChanges(data.changes);
          return data.changes.length;
        },
        () => -1,
      );
    if (!freshRef.current) void read();
    const onLearning = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== conversationId) return;
      window.clearInterval(timer);
      setLearning('waiting');
      const started = Date.now();
      void read().then((before) => {
        timer = window.setInterval(() => {
          void read().then((count) => {
            if (!current) return;
            if (count > before) {
              window.clearInterval(timer);
              setLearning('idle');
            } else if (Date.now() - started > 90_000) {
              window.clearInterval(timer);
              setLearning('later');
            }
          });
        }, 5_000);
      });
    };
    window.addEventListener(LEARNING_EVENT, onLearning);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener(LEARNING_EVENT, onLearning);
    };
  }, [conversationId]);
  if (!changes.length && learning === 'idle') return null;
  return (
    <section className="agent-conversation-changes grid gap-2" aria-label={t('What the agent learned', 'O que o agente aprendeu')}>
      {learning !== 'idle' && (
        <Note status>
          {learning === 'waiting' ? t('Learning from your feedback…', 'Aprendendo com seu feedback…') : t('It will show here when it is applied.', 'Vai aparecer aqui quando for aplicado.')}
        </Note>
      )}
      {changes.length > 0 && <h2 className="text-caption text-muted-foreground">{t('After this conversation the agent updated:', 'Depois desta conversa o agente atualizou:')}</h2>}
      {changes.map((change) => (
        <AgentChangeNote key={`${change.id}:${change.version}`} change={change} t={t} />
      ))}
    </section>
  );
}

const REASONS = [
  ['numbers', 'Wrong numbers', 'Números errados'],
  ['tone', 'Wrong tone', 'Tom errado'],
  ['missing', 'Missing something', 'Faltou algo'],
  ['long', 'Too long', 'Longa demais'],
  ['other', 'Other', 'Outro'],
] as const;

/**
 * An answer's rating (👍 or 👎, recorded at once), then what was wrong and what should change, optional: the curator learns
 * from it (the Brain, the Memory or a skill). No skill is made from one answer.
 */
export function AnswerFeedback({ rating, onRate, t }: { rating?: 1 | -1; onRate: (rating: 1 | -1 | 0, reason?: string, comment?: string) => void; t: T }) {
  const [open, setOpen] = useState<1 | -1 | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const pick = (value: 1 | -1) => {
    if (rating === value) {
      onRate(0);
      return;
    }
    onRate(value);
    setReason(null);
    setComment('');
    setOpen(value);
  };
  const thumb = (value: 1 | -1) => {
    const Icon = value === 1 ? ThumbsUp : ThumbsDown;
    return (
      <Popover open={open === value} onOpenChange={(next) => !next && setOpen(null)}>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon" aria-pressed={rating === value} aria-label={value === 1 ? t('Good answer', 'Boa resposta') : t('Bad answer', 'Resposta ruim')} onClick={() => pick(value)} />
          }
        >
          <Icon fill={rating === value ? 'currentColor' : 'none'} />
        </PopoverTrigger>
        <PopoverContent align="start" className="agent-feedback w-80">
          <PopoverHeader>
            <PopoverTitle>{value === -1 ? t('What was wrong?', 'O que estava errado?') : t('What was good?', 'O que estava bom?')}</PopoverTitle>
            <PopoverDescription>{t('The agent learns from it for this project.', 'O agente aprende com isso para este projeto.')}</PopoverDescription>
          </PopoverHeader>
          {value === -1 && (
            <fieldset className="flex flex-wrap gap-1.5">
              <legend className="sr-only">{t('Reason', 'Motivo')}</legend>
              {REASONS.map(([id, en, ptText]) => (
                <Button key={id} variant={reason === id ? 'secondary' : 'outline'} aria-pressed={reason === id} onClick={() => setReason(reason === id ? null : id)}>
                  {t(en, ptText)}
                </Button>
              ))}
            </fieldset>
          )}
          <Field>
            <FieldLabel htmlFor={`feedback-${value}`}>{value === -1 ? t('What should change? (optional)', 'O que deveria mudar? (opcional)') : t('Anything to keep doing? (optional)', 'Algo para continuar fazendo? (opcional)')}</FieldLabel>
            <Textarea id={`feedback-${value}`} maxLength={1000} rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(null)}>
              {t('Skip', 'Pular')}
            </Button>
            <Button
             
              disabled={!reason && !comment.trim()}
              onClick={() => {
                onRate(value, reason ?? undefined, comment.trim() || undefined);
                setOpen(null);
              }}
            >
              {t('Send', 'Enviar')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  };
  return (
    <>
      {thumb(1)}
      {thumb(-1)}
    </>
  );
}

type Version = { version: number; author: string; name: string | null; created_at: string; conversation_id: string | null; added: string[]; removed: string[] };
type Versions = { current: number | null; canRestore: boolean; versions: Version[] };

/**
 * A text's history (a Brain file, the Memory, a skill), newest first, in place of the text with a way back: who changed it
 * and when, the lines each version changed, and Restore (members), which writes that text as a new version.
 */
export function VersionHistory({ source, title, onBack, onRestored, t }: { source: { artifact: string } | { skill: string }; title: string; onBack: () => void; onRestored?: () => void; t: T }) {
  const projectHref = useContext(ProjectHrefContext);
  const { locale } = useI18n();
  const [data, setData] = useState<Versions | { failure: string } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [restoring, setRestoring] = useState<number | null>(null);
  const base = 'artifact' in source ? `/api/agent/artifacts/${encodeURIComponent(source.artifact)}/versions` : `/api/agent/skills/${encodeURIComponent(source.skill)}/versions`;
  useEffect(() => {
    let current = true;
    requestJson<Versions>(base).then(
      (value) => current && setData(value),
      (cause) => current && setData({ failure: cause instanceof Error ? cause.message : String(cause) }),
    );
    return () => {
      current = false;
    };
  }, [base, generation]);
  const who = (version: Version) =>
    ({ you: t('You', 'Você'), agent: t('Agent', 'Agente'), curator: t('Learning review', 'Revisão de aprendizado'), guard: t('Undone automatically', 'Desfeito automaticamente'), lastfind: 'Lastfind', admin: t('Lastfind admin', 'Admin do Lastfind') })[version.author] ??
    version.name ??
    t('A member', 'Um membro');
  const restore = async (version: number) => {
    setRestoring(version);
    try {
      await requestJson(`${base}/${version}/restore`, 'POST', {});
      onRestored?.();
      setGeneration((value) => value + 1);
    } catch (cause) {
      setData({ failure: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setRestoring(null);
    }
  };
  return (
    <DetailPage className="agent-history">
      <DetailHeader
        leading={
          <Button variant="ghost" size="icon" aria-label={t('Back', 'Voltar')} onClick={onBack}>
            <ArrowLeft />
          </Button>
        }
        title={<h1>{t(`History: ${title}`, `Histórico: ${title}`)}</h1>}
      />
      {!data ? (
        <DetailBodySkeleton label={t('Loading the history', 'Carregando o histórico')} />
      ) : (
      <DetailBody>
        {'failure' in data ? (
          <EmptyState frame="bare" tone="error" title={t('Could not load the history', 'Não foi possível carregar o histórico')} description={data.failure} onRetry={() => (setData(null), setGeneration((value) => value + 1))} />
        ) : !data.versions.length ? (
          <EmptyState frame="bare" title={t('No changes yet', 'Nenhuma mudança ainda')} description={t("This is Lastfind's version as shipped. Its first change starts the history.", 'Esta é a versão do Lastfind como veio. A primeira mudança começa o histórico.')} />
        ) : (
          <ol className="grid gap-2">
            {data.versions.map((version) => (
              <li key={version.version}>
                <Collapsible className="rounded-lg border border-border">
                  <CollapsibleTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`${t(`Version ${version.version}`, `Versão ${version.version}`)}, ${who(version)}, ${dateTime(version.created_at, locale)}`}
                        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 text-left text-body"
                      />
                    }
                  >
                    <span>{t(`Version ${version.version}`, `Versão ${version.version}`)}</span>
                    <span className="text-muted-foreground">{who(version)}</span>
                    <span className="text-muted-foreground tabular-nums">{dateTime(version.created_at, locale)}</span>
                    {version.version === data.current && <TagBadge tone="primary">{t('Current', 'Atual')}</TagBadge>}
                    <ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-3 px-3 pb-3">
                    <ChangedLines added={version.added} removed={version.removed} t={t} />
                    {!version.added.length && !version.removed.length && <p className="text-caption text-muted-foreground">{t('No line changed.', 'Nenhuma linha mudou.')}</p>}
                    <div className="flex flex-wrap gap-2">
                      {data.canRestore && version.version !== data.current && (
                        <Button variant="outline" pending={restoring === version.version} pendingLabel={t('Restoring…', 'Restaurando…')} onClick={() => void restore(version.version)}>
                          {t('Restore this version', 'Restaurar esta versão')}
                        </Button>
                      )}
                      {version.conversation_id && (
                        <Button variant="ghost" nativeButton={false} render={<a href={screenHref(projectHref, 'agent', `conversation=${encodeURIComponent(version.conversation_id)}`)} aria-label={t('Open the conversation', 'Abrir a conversa')} />}>
                          {t('Open the conversation', 'Abrir a conversa')}
                        </Button>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ol>
        )}
      </DetailBody>
      )}
    </DetailPage>
  );
}

/** A History button for a header (a Brain file's). */
export function HistoryButton({ onClick, t }: { onClick: () => void; t: T }) {
  return (
    <Button variant="ghost" onClick={onClick}>
      {t('History', 'Histórico')}
    </Button>
  );
}

type Budget = { cap: number | null; spent: number; canSet: boolean; disabled: boolean };

/**
 * Settings > Agent: the optional monthly limit of learning from conversations and feedback in this project (empty: no
 * limit; 0 turns it off; workspace admins set it), and what it spent.
 */
export function CurationBudget({ projectId, t }: { projectId: string; t: T }) {
  const { locale } = useI18n();
  const [budget, setBudget] = useState<Budget | { failure: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [generation, setGeneration] = useState(0);
  const shown = (value: Budget) => {
    setBudget(value);
    setAmount(value.cap === null ? '' : String(value.cap));
  };
  useEffect(() => {
    let current = true;
    requestJson<Budget>(`/api/agent/curation?project=${encodeURIComponent(projectId)}`).then(
      (value) => {
        if (current) shown(value);
      },
      (cause) => current && setBudget({ failure: cause instanceof Error ? cause.message : String(cause) }),
    );
    return () => {
      current = false;
    };
  }, [projectId, generation]);
  const money = (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const title = t('Learning from conversations and feedback', 'Aprender com conversas e feedback');
  const description = t(
    'After a conversation, and when someone rates an answer, the agent reviews it and keeps what the team taught it in the Brain, the Memory or a skill. When the same kind of work repeats across conversations, it learns a skill. Every change can be undone.',
    'Depois de uma conversa, e quando alguém avalia uma resposta, o agente revisa e guarda o que o time ensinou no Cérebro, na Memória ou numa skill. Quando o mesmo tipo de trabalho se repete em conversas, ele aprende uma skill. Toda mudança pode ser desfeita.',
  );
  if (!budget) return <SectionCard loading title={title} />;
  if ('failure' in budget)
    return <EmptyState tone="error" title={t('Could not load the learning limit', 'Não foi possível carregar o limite de aprendizado')} description={budget.failure} onRetry={() => (setBudget(null), setGeneration((value) => value + 1))} />;
  const locked = !budget.canSet;
  const dirty = amount !== (budget.cap === null ? '' : String(budget.cap));
  return (
    <SettingsBlock
      title={title}
      description={description}
      busy={locked}
      dirty={dirty}
      onCancel={() => shown(budget)}
      // ponytail: this block's unsaved state is not reported to Settings' leave warning; join it with the content block's if needed.
      onDirty={() => {}}
      t={t}
      save={async () => {
        const raw = amount.replace(',', '.').trim();
        const value = raw === '' ? null : Number(raw);
        if (value !== null && !Number.isFinite(value)) return false;
        shown(await requestJson<Budget>('/api/agent/curation', 'PUT', { project: projectId, monthly_usd: value }));
        return true;
      }}
    >
      {budget.disabled && <Note>{t('A Lastfind admin turned learning off for every project: nothing is reviewed until it is on again.', 'Um admin do Lastfind desligou o aprendizado em todos os projetos: nada é revisado até ele voltar.')}</Note>}
      <Field>
        <FieldLabel htmlFor="curation-usd">{t('Monthly limit for learning (optional, US$)', 'Limite mensal de aprendizado (opcional, US$)')}</FieldLabel>
        <Input
          id="curation-usd"
          name="curation_usd"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.5"
          className="w-40"
          disabled={locked}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder={t('No limit', 'Sem limite')}
        />
        <FieldDescription>{t('Empty: no limit. 0 turns learning off.', 'Vazio: sem limite. 0 desliga o aprendizado.')}</FieldDescription>
      </Field>
      <p className="text-body text-muted-foreground">{t(`Spent this month: ${money(budget.spent)}`, `Gasto neste mês: ${money(budget.spent)}`)}</p>
      {locked && <p className="text-caption text-muted-foreground">{t('Only workspace admins change it.', 'Só admins do workspace mudam isto.')}</p>}
    </SettingsBlock>
  );
}

/** A labelled date ("Updated on 01/11"), for lists. */
export const updatedOn = (value: string | null, locale: string, t: T): ReactNode => (value ? t(`Updated on ${shortDate(value, locale)}`, `Atualizado em ${shortDate(value, locale)}`) : null);
