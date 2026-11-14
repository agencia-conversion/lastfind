'use client';
// Agent > Chat and Agent > Artifacts (both editions): the conversations of the signed-in account beside the chat, each
// one live with its agent (a WebSocket to worker/agent.ts: answers stream to every open tab and survive a reload), the
// answer's steps, changes to confirm and artifacts, and the artifact it opens beside it; and the project's artifacts,
// shared by the workspace, with a public link each. Only catalog components; ./agent.css lays out.
import { Component, Suspense, lazy, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useAgent } from 'agents/react';
import { useAgentChat } from '@cloudflare/think/react';
import type { UIMessage } from 'ai';
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowUp,
  Ban,
  BookOpen,
  Check,
  CircleAlert,
  Copy,
  CornerDownRight,
  Download,
  Earth,
  EllipsisVertical,
  ExternalLink,
  FileCode,
  FileText,
  Globe,
  Paperclip,
  Radar,
  Link2,
  List,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  MessagesSquare,
  NotebookPen,
  Pencil,
  PenLine,
  Pin,
  PinOff,
  RotateCcw,
  Settings2,
  Square,
  SquarePen,
  Telescope,
  TextQuote,
  Trash2,
  X,
  Plus,
  ChevronRight,
  PanelRight,
  PictureInPicture2,
  History,
} from 'lucide-react';
import { flushSync } from 'react-dom';
import { isStaleChunk, reloadForNewVersion, requestJson } from '@/lib/client';
import { readAttachment } from '@/lib/agent-files';
import { agentDemo } from '@/lib/agent-demo';
import { useI18n } from '@/lib/i18n';
import {
  ASK_PANEL_INITIAL,
  ASK_WINDOW,
  askPanel,
  askPanelState,
  dispatchAskPanel,
  isAskReturn,
  morphAskPanel,
  popOutAsk,
  subscribeAskPanel,
  type AskAction,
  type AskMode,
  type AskPanelState,
  type AskReturn,
} from '@/lib/ask-panel';
import {
  AGENT_FILES_MAX,
  ARTIFACT_KINDS,
  ARTIFACT_PARTS,
  AGENT_TEXT_MAX,
  CHANGE_TOOLS,
  TOOL_LABELS,
  USAGE_MESSAGE,
  destructiveChange,
  withoutTitle,
  oneAnswerPerQuestion,
  viewOf,
  type AgentUsage,
  type Artifact,
  type ArtifactKind,
  type AgentFile,
  type ArtifactSummary,
  type ConversationSummary,
  type MessageView,
  type PendingCall,
  type ToolStep,
  type UiMessage,
} from '@/lib/agent';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { ArtifactIcon } from '@/components/lastfind/presentation/artifact-icon';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText, InputGroupTextarea } from '@/components/ui/input-group';
import { Textarea } from '@/components/ui/textarea';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@/components/ui/message-scroller';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceErrorMark, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@/components/ui/attachment';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useDefaultLayout } from 'react-resizable-panels';
import { DetailBody, DetailBodySkeleton, DetailHeader, DetailPage } from '@/components/lastfind/presentation/detail-page';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Kbd } from '@/components/ui/kbd';
import { conversationsShortcutLabel, isConversationsShortcut } from '@/lib/agent-shortcut';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { DataTable, DataTableScreen, DataTableToolbar } from '@/components/lastfind/presentation/data-table';
import { Hint } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { SelectField } from '@/components/ui/select';
import { LastfindLogo } from '@/components/lastfind/lastfind-logo';
import { AgentBrandsContext, AgentMarkdown, ArtifactLiveContext, type AgentBrands } from './agent-blocks';
import { Note } from '@/components/lastfind/presentation/note';
import { AgentChangeNote, AnswerFeedback, ConversationChanges, LEARNING_EVENT, ProjectHrefContext } from './agent-learning';
import { navIcons } from './nav-icons';
import { SIGNUP_PATH } from './app-routes';
import { AgentStepDetail, stepLabel } from './agent-step-detail';
import { ContentOverviewTab } from './agent-content-overview';
import type { ContentMeta } from '@/lib/content-overview';
import { editedAt } from '@/lib/report-date';
import { stepSummary } from '@/lib/agent-steps';
import { EmptyState, RetryButton, SearchField, useCopy, useNumbers } from './shared';
import { EditorToolbarPlaceholder } from './editor-toolbar';
import { SectionSidebar, type SectionItem } from './section-sidebar';
import { UsageMeterRow } from '@/components/lastfind/usage-meter-row';
import { LiveDot, LiveLabel, formatElapsed } from '@/components/ui/live-label';
import './agent.css';

// The editor loads only when a member opens an artifact: readers, the chat and the public page never fetch it.
// A tab opened before a deploy finds the editor's old file gone: it reloads into the new version instead of failing.
// A member's artifact asks for it as it starts loading (preloadEditor), so the text opens in the editor at once.
const loadEditor = () => import('./artifact-editor').catch((error) => (isStaleChunk(error) && reloadForNewVersion() ? new Promise<never>(() => {}) : Promise.reject(error)));
const ArtifactEditor = lazy(loadEditor);
const preloadEditor = () => void loadEditor().catch(() => {});

type T = (en: string, pt: string) => string;

const kindLabel = (kind: ArtifactKind, t: T) =>
  kind === 'table' ? t('Table', 'Tabela') : kind === 'brief' ? t('Brief', 'Brief') : kind === 'content' ? t('Content', 'Conteúdo') : kind === 'report' ? t('Report', 'Relatório') : t('Document', 'Documento');

// ---------------------------------------------------------------- address (`conversation`, `artifact`)

export function readParam(key: string) {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(key);
}
export function writeParam(key: string, value: string | null, push = false) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(key, value);
  else params.delete(key);
  const next = `${window.location.pathname}?${params}`;
  if (next === `${window.location.pathname}${window.location.search}`) return;
  window.history[push ? 'pushState' : 'replaceState'](window.history.state, '', next);
}

const REQUEST_KEY = 'lastfind:agent-request';
const requestKey = (artifact?: string) => (artifact ? `${REQUEST_KEY}:${artifact}` : REQUEST_KEY);
/** Leaves a request for Agent > Chat in this tab, or for the chat beside an artifact: sent when it opens (`send`), or left in its box. */
export function prepareAgentRequest(text: string, send: boolean, artifact?: string) {
  try {
    window.sessionStorage.setItem(requestKey(artifact), JSON.stringify({ text, send }));
  } catch {
    /* Storage blocked: the chat opens empty. */
  }
}
function peekAgentRequest(artifact?: string): { text: string; send: boolean } | null {
  try {
    const raw = typeof window === 'undefined' ? null : window.sessionStorage.getItem(requestKey(artifact));
    const value = raw ? (JSON.parse(raw) as { text?: unknown; send?: unknown }) : null;
    return value && typeof value.text === 'string' && value.text.trim() ? { text: value.text.slice(0, 4000), send: value.send === true } : null;
  } catch {
    return null;
  }
}
function takeAgentRequest(artifact?: string) {
  const prepared = peekAgentRequest(artifact);
  try {
    window.sessionStorage.removeItem(requestKey(artifact));
  } catch {
    /* Storage blocked: nothing was there. */
  }
  return prepared;
}

// ---------------------------------------------------------------- pieces (also shown in /design-system)

// What kind of work a step is, by its tool (a reading of the project's data unless named here).
const WRITES = new Set(['create_artifact', 'update_artifact', 'patch_artifact', 'edit_artifact', 'set_content_overview']);
const SEARCHES = new Set(['search_results', 'keyword_volume', 'keyword_ideas', 'ranked_keywords', 'competing_domains', 'backlinks']);
const stepIcon = (name: string) =>
  WRITES.has(name)
    ? PenLine
    : name === 'remember' || name === 'forget'
      ? NotebookPen
      : CHANGE_TOOLS.has(name)
        ? SquarePen
        : SEARCHES.has(name)
          ? Radar
          : name === 'read_page' || name === 'page_audit'
            ? Earth
            : name === 'activate_skill' || name === 'read_skill_resource' || name === 'improve_skill'
              ? BookOpen
              : Telescope;

/**
 * When this tab saw a step or an answer start and end (ms), for the live timers and the durations of the trace. Only what it
 * saw from the start has a start: a stored conversation, or one opened mid-step, shows no duration rather than a wrong one.
 * Recorded while rendering, once per key (idempotent).
 */
// ponytail: this tab's clock only, kept in memory; durations of stored answers need the server to keep them.
const clocks = new Map<string, { start?: number; end?: number }>();
function clockOf(key: string, running: boolean, fromStart = true) {
  let clock = clocks.get(key);
  if (!clock) clocks.set(key, (clock = running && fromStart ? { start: Date.now() } : {}));
  else if (!running && clock.start && !clock.end) clock.end = Date.now();
  return clock;
}
const took = (clock: { start?: number; end?: number }) => (clock.start && clock.end ? clock.end - clock.start : undefined);

/**
 * The steps the agent took (the catalog Trace): the tool's icon, still; the gerund while it runs, as a live label with its
 * timer ("Searching the web…"), the past once done with how long it took ("Searched the web, 4 s"). A failed step has the
 * red dot as its marker and says why in the line's grey. Done, the answer's steps fold into one receipt, "Thought for 12 s"
 * (live, three or more fold as "5 steps"). Hovering a step says in a few words what it did; clicking it opens it in detail
 * (agent-step-detail.tsx).
 */
export function AgentToolSteps({ steps, folded, thought, t }: { steps: ToolStep[]; folded?: boolean; thought?: number; t: T }) {
  const { locale } = useI18n();
  const [inspected, setInspected] = useState<string | null>(null);
  if (!steps.length) return null;
  const running = steps.findLast((step) => step.state === 'running');
  const failed = steps.filter((step) => step.state === 'error').length;
  const line = (step: ToolStep) => {
    const clock = clockOf(step.id, step.state === 'running');
    const Icon = step.state === 'declined' ? Ban : stepIcon(step.name);
    const duration = step.state === 'done' ? (step.ms ?? took(clock)) : undefined;
    const label = stepLabel(step, locale);
    // A failed step says what happened in the line's own grey: the label, then its message; only its marker is red.
    const name = `${label}${
      step.state === 'done' && CHANGE_TOOLS.has(step.name) ? `, ${t('approved', 'aprovado')}` : step.state === 'error' ? `: ${stepSummary(step, t, locale)}` : step.state === 'declined' ? `, ${t('declined', 'recusado')}` : ''
    }${duration ? `, ${formatElapsed(duration)}` : ''}`;
    return (
      <Hint key={step.id} text={stepSummary(step, t, locale)}>
        <button type="button" className="agent-step" aria-label={step.state === 'running' ? `${label}…` : name} onClick={() => setInspected(step.id)}>
          <TraceLine status={step.state === 'running' ? 'running' : step.state === 'error' ? 'error' : undefined}>
            <TraceIcon>{step.state === 'error' ? <TraceErrorMark /> : <Icon />}</TraceIcon>
            <TraceTitle>{step.state === 'running' ? <LiveLabel since={clock.start}>{`${label}…`}</LiveLabel> : name}</TraceTitle>
          </TraceLine>
        </button>
      </Hint>
    );
  };
  const detail = <AgentStepDetail step={steps.find((step) => step.id === inspected) ?? null} onClose={() => setInspected(null)} t={t} />;
  if (running)
    return (
      <Trace className="agent-steps" aria-live="polite">
        {line(running)}
        {detail}
      </Trace>
    );
  if (!folded && steps.length < 3)
    return (
      <Trace className="agent-steps">
        {steps.map(line)}
        {detail}
      </Trace>
    );
  // The receipt: how long it thought when this tab saw it from the start, else how many steps; no icon, the chevron opens them.
  const receipt = thought ? t(`Thought for ${formatElapsed(thought)}`, `Pensou por ${formatElapsed(thought)}`) : steps.length === 1 ? t('1 step', '1 passo') : t(`${steps.length} steps`, `${steps.length} passos`);
  return (
    <Trace className="agent-steps">
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceTitle>{failed ? t(`${receipt}, ${failed} failed`, `${receipt}, ${failed} ${failed === 1 ? 'falhou' : 'falharam'}`) : receipt}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>{steps.map(line)}</Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
      {detail}
    </Trace>
  );
}

/**
 * One line of the chat's state, in the steps' Trace style: live (thinking, resuming, reconnecting) as a live label with its
 * timer and no icon; at rest (stopped, cut short) with its still icon.
 */
function AgentStatus({ icon: Icon, live, since, children }: { icon?: typeof FileText; live?: boolean; since?: number; children: string }) {
  return (
    <Trace className="agent-status" aria-live={live ? 'polite' : undefined}>
      <TraceLine status={live ? 'running' : undefined}>
        {Icon && (
          <TraceIcon>
            <Icon />
          </TraceIcon>
        )}
        <TraceTitle>{live ? <LiveLabel since={since}>{children}</LiveLabel> : children}</TraceTitle>
      </TraceLine>
    </Trace>
  );
}

const ARG_LABELS: Record<string, [string, string]> = {
  prompts: ['Prompts', 'Prompts'],
  prompt: ['Prompt', 'Prompt'],
  text: ['Text', 'Texto'],
  status: ['Change', 'Alteração'],
  name: ['Name', 'Nome'],
  topic: ['Topic', 'Tópico'],
  tags: ['Tags', 'Tags'],
  engines: ['AI models', 'Modelos de IA'],
  action: ['Decision', 'Decisão'],
  domain: ['Domain', 'Domínio'],
  new_name: ['New name', 'Novo nome'],
  into: ['Merge into', 'Unir a'],
  section: ['Section', 'Seção'],
  // A skill change (improve_skill) waiting for approval after the turn read outside content.
  old: ['Replaces', 'Substitui'],
  new: ['With', 'Por'],
  why: ['Why', 'Por quê'],
  quote: ['You said', 'Você disse'],
};
const VALUE_LABELS: Record<string, [string, string]> = {
  pause: ['Pause', 'Pausar'],
  resume: ['Resume', 'Retomar'],
  archive: ['Archive', 'Arquivar'],
  restore: ['Restore', 'Restaurar'],
  confirm: ['Confirm as competitor', 'Confirmar como concorrente'],
  reject: ['Reject', 'Rejeitar'],
  merge: ['Merge', 'Unir'],
  rename: ['Rename', 'Renomear'],
  set_domain: ['Set the domain', 'Definir o domínio'],
  undo: ['Undo a decision', 'Desfazer uma decisão'],
};
function argValue(key: string, value: unknown, t: T, labels: Record<string, string> = {}): ReactNode {
  // Ids (prompts, topics) read as the names the server found for them.
  if (Array.isArray(value) && value.every((item) => typeof item === 'string' && labels[item])) value = value.map((item) => labels[item as string]);
  else if (typeof value === 'string' && labels[value] && (key === 'prompt' || key === 'topic')) return labels[value];
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string') && (key === 'prompts' || key === 'prompt') && value.some((item) => !/\s/.test(item as string)))
      return value.length === 1 ? t('1 prompt', '1 prompt') : t(`${value.length} prompts`, `${value.length} prompts`);
    return (
      <ul>
        {value.slice(0, 12).map((item, index) => (
          <li key={index}>{typeof item === 'object' && item ? String((item as Record<string, unknown>).text ?? (item as Record<string, unknown>).name ?? JSON.stringify(item)) : String(item)}</li>
        ))}
        {value.length > 12 && <li>{t(`and ${value.length - 12} more`, `e mais ${value.length - 12}`)}</li>}
      </ul>
    );
  }
  if (typeof value === 'string') {
    const copy = VALUE_LABELS[value];
    return copy ? t(...copy) : value;
  }
  return typeof value === 'object' && value ? JSON.stringify(value) : String(value);
}

/** The changes an answer is waiting on, for the person to approve or decline. */
export function AgentConfirmCard({ calls, busy, onDecide, t }: { calls: PendingCall[]; busy: boolean; onDecide: (decision: 'approve' | 'reject') => void; t: T }) {
  const { locale } = useI18n();
  // Routine changes read as routine; removing or rejecting something is marked as such.
  const destructive = calls.some(destructiveChange);
  return (
    <section className="agent-confirm" data-destructive={destructive || undefined} aria-label={t('Changes to confirm', 'Alterações para confirmar')}>
      <header>
        <CircleAlert aria-hidden="true" />
        <div>
          <h3 className="text-section">{calls.length > 1 ? t('Confirm these changes', 'Confirme estas alterações') : t('Confirm this change', 'Confirme esta alteração')}</h3>
          <p className="text-caption text-muted-foreground">{t('Nothing changes in the project until you approve.', 'Nada muda no projeto até você aprovar.')}</p>
        </div>
      </header>
      {calls.map((call) => (
        <div key={call.id} className="agent-confirm-call">
          <strong>{TOOL_LABELS[call.name] ? (locale === 'pt-BR' ? (TOOL_LABELS[call.name].action ?? TOOL_LABELS[call.name].running)[1] : (TOOL_LABELS[call.name].action ?? TOOL_LABELS[call.name].running)[0]) : call.name}</strong>
          <dl>
            {Object.entries(call.args)
              .filter(([key]) => key !== 'project')
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{ARG_LABELS[key] ? t(...ARG_LABELS[key]) : key}</dt>
                  <dd>{argValue(key, value, t, call.labels)}</dd>
                </div>
              ))}
          </dl>
        </div>
      ))}
      <footer>
        <Button variant="outline" disabled={busy} onClick={() => onDecide('reject')}>
          {t('Decline', 'Recusar')}
        </Button>
        <Button variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={() => onDecide('approve')}>
          {t('Approve', 'Aprovar')}
        </Button>
      </footer>
    </section>
  );
}

/** An artifact in the chat: opens it beside the conversation, or on its own page in a new window. */
export function AgentArtifactCard({ artifact, open, onOpen, page = true, t }: { artifact: ArtifactSummary; open?: boolean; onOpen: (id: string) => void; /** It has a page of its own (not the demo's examples). */ page?: boolean; t: T }) {
  const newWindow = t(`Open ${artifact.title} in a new window`, `Abrir ${artifact.title} em nova janela`);
  return (
    <Attachment size="sm" className="agent-artifact-card" data-active={open || undefined}>
      <AttachmentMedia variant="document">
        <ArtifactIcon kind={artifact.kind} />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>
          {artifact.title}
          <span className="sr-only">{`, ${kindLabel(artifact.kind, t)}`}</span>
        </AttachmentTitle>
      </AttachmentContent>
      <AttachmentTrigger aria-label={t(`Open ${artifact.title}`, `Abrir ${artifact.title}`)} aria-pressed={open || undefined} onClick={() => onOpen(artifact.id)} />
      {page && (
        <AttachmentActions>
          <Hint text={t('Open in a new window', 'Abrir em nova janela')}>
            <AttachmentAction aria-label={newWindow} render={<a href={`/artifact/${encodeURIComponent(artifact.id)}`} target="_blank" rel="noopener" aria-label={newWindow} />}>
              <ExternalLink />
            </AttachmentAction>
          </Hint>
        </AttachmentActions>
      )}
    </Attachment>
  );
}

/** The files of a message: images as thumbnails (opened large once sent), any other file by its name; removable while writing. */
export function AgentFiles({ files, onRemove, t }: { files: AgentFile[]; onRemove?: (index: number) => void; t: T }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!files.length) return null;
  return (
    <>
      <AttachmentGroup className="agent-files">
        {files.map((file, index) => {
          const name = file.name || t(`File ${index + 1}`, `Arquivo ${index + 1}`);
          const image = file.mediaType.startsWith('image/');
          return (
            <Attachment key={index} orientation={image ? 'vertical' : 'horizontal'} size="sm" className={image ? 'agent-image' : 'agent-file'}>
              {image ? (
                <AttachmentMedia variant="image">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={file.url} alt={name} />
                </AttachmentMedia>
              ) : (
                <>
                  <AttachmentMedia>
                    <FileText />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{name}</AttachmentTitle>
                    <AttachmentDescription>{/\.(\w{1,5})$/.exec(name)?.[1].toUpperCase() ?? (file.mediaType === 'application/pdf' ? 'PDF' : t('Text', 'Texto'))}</AttachmentDescription>
                  </AttachmentContent>
                </>
              )}
              {onRemove ? (
                <AttachmentActions>
                  <AttachmentAction variant="secondary" aria-label={t(`Remove ${name}`, `Remover ${name}`)} onClick={() => onRemove(index)}>
                    <X />
                  </AttachmentAction>
                </AttachmentActions>
              ) : (
                image && <AttachmentTrigger aria-label={t(`Open ${name}`, `Abrir ${name}`)} onClick={() => setOpen(file.url)} />
              )}
            </Attachment>
          );
        })}
      </AttachmentGroup>
      <Dialog open={!!open} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="agent-image-dialog">
          <DialogTitle className="sr-only">{t('Image', 'Imagem')}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {open && <img src={open} alt={t('Image sent in the conversation', 'Imagem enviada na conversa')} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The message box: text and up to AGENT_FILES_MAX files of any kind (attached, pasted or dropped; lib/agent-files.ts
 * reads them). Enter sends, Shift+Enter breaks the line. While the agent answers the box stays: what is sent then waits
 * in the queue for the answer to end, and the square stops the answer.
 */
export function AgentComposer({
  value,
  onChange,
  files = [],
  onFiles,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  quote,
  locked,
  t,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  files?: AgentFile[];
  onFiles?: (files: AgentFile[]) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  /** Why the box waits, when it does (a change to approve first); empty while an answer streams (no text in the box). */
  placeholder?: string;
  /** The passage selected in the artifact beside, sent with the message until removed. */
  quote?: { text: string; onRemove: () => void };
  /** The public demo: the box sends nothing, its placeholder says why and this action (sign up) takes the send button's place. */
  locked?: ReactNode;
  t: T;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false);
  const ready = (!!value.trim() || files.length > 0) && !disabled && !locked && !reading;
  const submit = () => {
    if (ready) onSend();
  };
  const add = async (added: File[]) => {
    if (!onFiles || !added.length) return;
    setNotice('');
    setReading(true);
    const room = Math.max(0, AGENT_FILES_MAX - files.length);
    const taken = await Promise.all(added.slice(0, room).map((file) => readAttachment(file).catch(() => 'unreadable' as const)));
    setReading(false);
    const kept = taken.filter((file): file is AgentFile => typeof file === 'object');
    if (kept.length) onFiles([...files, ...kept]);
    const large = added.find((_, index) => taken[index] === 'too-large');
    const unreadable = added.find((_, index) => taken[index] === 'unreadable');
    if (added.length > room) setNotice(t(`Up to ${AGENT_FILES_MAX} files per message.`, `Até ${AGENT_FILES_MAX} arquivos por mensagem.`));
    else if (large) setNotice(t(`${large.name} is too large: PDFs up to 5 MB, other files up to 20 MB.`, `${large.name} é grande demais: PDF até 5 MB, outros arquivos até 20 MB.`));
    else if (unreadable) setNotice(t(`${unreadable.name} could not be read: the agent reads text, PDFs, images, spreadsheets, documents and presentations.`, `Não foi possível ler ${unreadable.name}: o agente lê texto, PDF, imagens, planilhas, documentos e apresentações.`));
  };
  // Files dropped anywhere on the box (the textarea also takes pasted ones).
  const form = useRef<HTMLFormElement>(null);
  const addRef = useRef(add);
  useEffect(() => {
    addRef.current = add;
  });
  const takesFiles = !!onFiles;
  useEffect(() => {
    const node = form.current;
    if (!node || !takesFiles) return;
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!node.contains(event.relatedTarget as Node | null)) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      void addRef.current([...(event.dataTransfer?.files ?? [])]);
    };
    node.addEventListener('dragover', over);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);
    return () => {
      node.removeEventListener('dragover', over);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
    };
  }, [takesFiles]);
  return (
    <form
      ref={form}
      className="agent-composer"
      data-dragging={dragging || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* The passage selected in the artifact floats over the box's top edge (as a queued message looks): attaching it moves
          nothing in the chat. */}
      {quote && (
        <Item variant="outline" size="xs" className="agent-queue-item agent-composer-quote">
          <ItemMedia variant="icon">
            <TextQuote aria-hidden="true" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="agent-queue-text">{t(`Selected: ${quote.text}`, `Trecho: ${quote.text}`)}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Button variant="ghost" size="icon-xs" aria-label={t('Remove the selected passage', 'Remover o trecho selecionado')} onClick={quote.onRemove}>
              <X />
            </Button>
          </ItemActions>
        </Item>
      )}
      <InputGroup>
        {files.length > 0 && (
          <InputGroupAddon align="block-start">
            <AgentFiles files={files} onRemove={(index) => onFiles?.(files.filter((_, at) => at !== index))} t={t} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={inputRef}
          value={value}
          maxLength={AGENT_TEXT_MAX}
          rows={1}
          disabled={disabled}
          readOnly={!!locked}
          aria-label={t('Message to the agent', 'Mensagem para o agente')}
          placeholder={placeholder ?? t('Ask about your brand, its search data or content to write…', 'Pergunte sobre sua marca, os dados de busca ou um conteúdo para escrever…')}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files];
            if (!pasted.length || !onFiles) return;
            event.preventDefault();
            void add(pasted);
          }}
        />
        <InputGroupAddon align="block-end">
          {onFiles && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  void add([...(event.target.files ?? [])]);
                  event.target.value = '';
                }}
              />
              <InputGroupButton size="icon-sm" disabled={disabled || reading || files.length >= AGENT_FILES_MAX} aria-label={t('Attach files', 'Anexar arquivos')} onClick={() => fileInput.current?.click()}>
                {reading ? <Spinner /> : <Paperclip aria-hidden="true" />}
              </InputGroupButton>
            </>
          )}
          {notice && <InputGroupText className="agent-composer-notice">{notice}</InputGroupText>}
          <div className="ml-auto flex items-center gap-1">
            {locked}
            {!locked && streaming && (
              <InputGroupButton size="icon-sm" variant={ready ? 'ghost' : 'ink'} className="rounded-full" onClick={onStop} aria-label={t('Stop answering', 'Parar a resposta')}>
                <Square aria-hidden="true" />
              </InputGroupButton>
            )}
            {!locked && (!streaming || ready) && (
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="ink"
                className="rounded-full"
                disabled={!ready}
                aria-label={streaming ? t('Send after this answer', 'Enviar depois desta resposta') : t('Send', 'Enviar')}
              >
                <ArrowUp aria-hidden="true" />
              </InputGroupButton>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/**
 * One answer of the agent: its steps, its text (Markdown), the changes it waits on and the artifacts it wrote. While it
 * answers, what it does now closes the message (docs/design/shell.md section 4, "Agent states"): the step under way, or
 * "Thinking…" before its first words and between steps, or, while the words come, only a caret at their end.
 */
export function AgentAnswer({
  message,
  live,
  clock,
  stopped,
  busy,
  onDecide,
  onOpenArtifact,
  openArtifact,
  last,
  onRetry,
  onRate,
  resuming,
  example,
  t,
}: {
  message: Extract<MessageView, { role: 'assistant' }>;
  live?: boolean;
  /** The answer's key for its timing (its question's row: the same from the thinking row to the answer). */
  clock?: string;
  /** Live and still without text: the connection came back and the answer is being picked up. */
  resuming?: boolean;
  /** The artifact open beside the chat (its card shows it). */
  openArtifact?: string | null;
  /** The latest answer keeps its actions in view; earlier ones show them on hover or focus. */
  last?: boolean;
  /** The person stopped this answer (this tab saw it). */
  stopped?: boolean;
  busy?: boolean;
  onDecide?: (decision: 'approve' | 'reject') => void;
  onOpenArtifact: (id: string) => void;
  onRetry?: () => void;
  /** A stored answer can be rated: 1, -1, or 0 to take it back; with what was wrong and what should change. */
  onRate?: (rating: 1 | -1 | 0, reason?: string, comment?: string) => void;
  /** One of the public demo's examples: its artifacts open beside it only (they have no page of their own). */
  example?: boolean;
  t: T;
}) {
  const [copied, setCopied] = useState(false);
  // How long it has been answering: timed only when this tab saw it from its first moment (an empty answer).
  const timing = clockOf(clock ?? message.id, !!live, !message.text && !message.tools.length);
  // While it answers, what it is doing now closes the message, after its last words and artifacts (the steps done stay on
  // top): the step under way, or "Thinking…" without words yet; while the words come, the caret at their end.
  const running = live ? message.tools.findLast((step) => step.state === 'running') : undefined;
  const done = running ? message.tools.filter((step) => step !== running) : message.tools;
  const writing = live && !running && !message.pending.length && !!message.text;
  return (
    <Message className="agent-answer" data-last={last || undefined}>
      <MessageContent className="agent-answer-body" data-writing={writing || undefined}>
        <AgentToolSteps steps={done} folded={!live} thought={live ? undefined : took(timing)} t={t} />
        {!live && !stopped && !message.text && !message.pending.length && !message.artifacts.length && !message.tools.some((step) => step.state === 'running') && (
          <AgentStatus icon={CircleAlert}>{t('This answer stopped before its text.', 'Esta resposta parou antes do texto.')}</AgentStatus>
        )}
        {message.text && (
          <AgentMarkdown text={message.text} />
        )}
        {!live && stopped && <AgentStatus icon={Square}>{t('You stopped this answer. Tell me what to do differently.', 'Você parou esta resposta. Diga o que fazer diferente.')}</AgentStatus>}
        {message.changes?.map((change) => <AgentChangeNote key={`${change.id}:${change.version}`} change={change} t={t} />)}
        {message.artifacts.length > 0 && (
          <div className="agent-artifact-list">
            {message.artifacts.map((artifact) => (
              <AgentArtifactCard key={artifact.id} artifact={artifact} open={artifact.id === openArtifact} onOpen={onOpenArtifact} page={!example} t={t} />
            ))}
          </div>
        )}
        {message.pending.length > 0 && onDecide && <AgentConfirmCard calls={message.pending} busy={!!busy} onDecide={onDecide} t={t} />}
        {live && !message.pending.length &&
          (running ? (
            <AgentToolSteps steps={[running]} t={t} />
          ) : (
            !writing && (
              <AgentStatus live since={timing.start}>
                {resuming ? t('Resuming the answer…', 'Retomando a resposta…') : t('Thinking…', 'Pensando…')}
              </AgentStatus>
            )
          ))}
        {!live && message.text && (
          <MessageFooter className="agent-answer-actions">
            <Button
              variant="ghost"
              size="icon"
              aria-label={copied ? t('Copied', 'Copiado') : t('Copy answer', 'Copiar resposta')}
              onClick={() => {
                void navigator.clipboard.writeText(message.text).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
            {onRetry && (
              <Button variant="ghost" size="icon" aria-label={t('Ask again', 'Perguntar de novo')} onClick={onRetry}>
                <RotateCcw />
              </Button>
            )}
            {onRate && <AnswerFeedback rating={message.rating} onRate={onRate} t={t} />}
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

/** A question; the last one can be edited and sent again, replacing its answer. */
export function UserMessage({ text, files = [], onEdit, t }: { text: string; files?: AgentFile[]; onEdit?: (text: string) => void; t: T }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null)
    return (
      <form
        className="agent-edit"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim() && onEdit) onEdit(draft.trim());
          setDraft(null);
        }}
      >
        <InputGroup>
          <InputGroupTextarea
            ref={(node) => node?.focus()}
            value={draft}
            maxLength={AGENT_TEXT_MAX}
            aria-label={t('Edit your message', 'Editar sua mensagem')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setDraft(null);
              // Enter sends, Shift+Enter breaks the line: as in the message box.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <InputGroupAddon align="block-end" className="justify-end">
            <InputGroupButton variant="outline" onClick={() => setDraft(null)}>
              {t('Cancel', 'Cancelar')}
            </InputGroupButton>
            <InputGroupButton type="submit" variant="ink" disabled={!draft.trim()}>
              {t('Send', 'Enviar')}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    );
  return (
    <Message align="end" className="agent-question">
      <div className="agent-question-body">
        <AgentFiles files={files} t={t} />
        {text && (
          <Bubble variant="muted" align="end">
            <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
          </Bubble>
        )}
      </div>
      {onEdit && (
        <Button variant="ghost" size="icon" className="agent-question-edit" aria-label={t('Edit and send again', 'Editar e enviar de novo')} onClick={() => setDraft(text)}>
          <Pencil />
        </Button>
      )}
    </Message>
  );
}

/**
 * What the person sent while the agent answers, as in Codex: stacked over the message box until the answer ends, each one
 * can steer (stop the answer and go now), go back to the box to be edited, or leave the queue.
 */
export function AgentQueue({
  items,
  onSteer,
  onEdit,
  onRemove,
  t,
}: {
  items: { id: string; text: string; files: AgentFile[] }[];
  /** Stops the answer under way and sends this message now (only while an answer is under way). */
  onSteer?: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  t: T;
}) {
  if (!items.length) return null;
  return (
    <section className="agent-queue" aria-label={t('Queued messages', 'Mensagens na fila')}>
      <h3 className="text-caption text-muted-foreground">{t(`Queued (${items.length})`, `Na fila (${items.length})`)}</h3>
      <ul>
        {items.map((item) => {
          const text = item.text || (item.files.length === 1 ? t('1 file', '1 arquivo') : t(`${item.files.length} files`, `${item.files.length} arquivos`));
          return (
            <Item key={item.id} render={<li />} variant="outline" size="xs" className="agent-queue-item">
              <ItemMedia variant="icon">
                <CornerDownRight aria-hidden="true" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="agent-queue-text">{text}</ItemTitle>
              </ItemContent>
              <ItemActions>
                {onSteer && (
                  <Hint text={t('Stops this answer and sends this message now', 'Para esta resposta e envia esta mensagem agora')}>
                    <Button variant="ghost" onClick={() => onSteer(item.id)}>
                      {t('Steer', 'Direcionar')}
                    </Button>
                  </Hint>
                )}
                <Hint text={t('Edit in the message box', 'Editar na caixa de mensagem')}>
                  <Button variant="ghost" size="icon" aria-label={t(`Edit: ${text}`, `Editar: ${text}`)} onClick={() => onEdit(item.id)}>
                    <Pencil />
                  </Button>
                </Hint>
                <Hint text={t('Remove from the queue', 'Remover da fila')}>
                  <Button variant="ghost" size="icon" aria-label={t(`Remove from the queue: ${text}`, `Remover da fila: ${text}`)} onClick={() => onRemove(item.id)}>
                    <X />
                  </Button>
                </Hint>
              </ItemActions>
            </Item>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- the artifact (beside the chat, in a sheet, and in Artifacts)

function download(artifact: Artifact) {
  const url = URL.createObjectURL(new Blob([`# ${artifact.title}\n\n${withoutTitle(artifact.content, artifact.title)}`], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${artifact.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'artifact'}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Where the artifact shows: beside the chat, in Agent > Artifacts (the main content) or on its own page. */
type ArtifactPlace = 'side' | 'page' | 'standalone';
/** Whether a content's tabs are folded to a strip (this browser). */
const TABS_KEY = 'lastfind:content-tabs';
/**
 * An artifact's width (as in Notion): the person picks it in the More menu, kept in this browser per artifact
 * (as the app's other view choices); Standard, an A4 sheet, until then. agent.css draws each one.
 */
export const ARTIFACT_WIDTHS = ['narrow', 'standard', 'wide', 'full'] as const;
type ArtifactWidth = (typeof ARTIFACT_WIDTHS)[number];
const WIDTH_EVENT = 'lastfind:artifact-width';
const subscribeWidth = (changed: () => void) => {
  window.addEventListener(WIDTH_EVENT, changed);
  window.addEventListener('storage', changed);
  return () => {
    window.removeEventListener(WIDTH_EVENT, changed);
    window.removeEventListener('storage', changed);
  };
};
function useArtifactWidth(id: string) {
  const key = `lastfind:artifact-width:${id}`;
  const stored = useSyncExternalStore(subscribeWidth, () => window.localStorage.getItem(key), () => null);
  const width: ArtifactWidth = ARTIFACT_WIDTHS.find((each) => each === stored) ?? 'standard';
  const choose = (next: ArtifactWidth) => {
    window.localStorage.setItem(key, next);
    window.dispatchEvent(new Event(WIDTH_EVENT));
  };
  return [width, choose] as const;
}
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';
/** How long what the agent changed stays highlighted (the fade is agent.css `agent-changed`). */
const CHANGED_MS = 4000;
/** The document's blocks as shown (the editor's, or the reader's), with their text: what the highlight compares. */
function blockTexts(body: HTMLElement | null): [string, HTMLElement][] {
  const root = body?.querySelector<HTMLElement>('.agent-editor-content') ?? body?.querySelector<HTMLElement>('.agent-markdown:not(.agent-editor)');
  return [...(root?.children ?? [])].flatMap((element) => {
    const text = element.textContent?.replace(/\s+/g, ' ').trim();
    return text && element instanceof HTMLElement ? [[text, element] as [string, HTMLElement]] : [];
  });
}
/** The agent at work on the artifact beside its chat: the step under way (its label) and the way to stop the answer. */
/** The agent at work on an artifact: since when (ms, this tab's clock) and the way to stop it. */
type AgentWork = { since: number; stop: () => void };
const SAVE_DELAY_MS = 1500;

function ArtifactSettings({ artifact, onChange, t }: { artifact: Artifact; onChange: (change: { kind?: ArtifactKind; live?: boolean }) => void; t: T }) {
  return (
    <Popover>
      <Hint text={t('Settings', 'Configurações')}>
        <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={t('Artifact settings', 'Configurações do artefato')} />}>
          <Settings2 />
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" className="agent-artifact-settings">
        <PopoverHeader>
          <PopoverTitle>{t('Artifact settings', 'Configurações do artefato')}</PopoverTitle>
        </PopoverHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`artifact-kind-${artifact.id}`}>{t('Type', 'Tipo')}</FieldLabel>
            <SelectField<ArtifactKind> id={`artifact-kind-${artifact.id}`} value={artifact.kind} onValueChange={(kind) => onChange({ kind })} options={ARTIFACT_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind, t) }))} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`artifact-live-${artifact.id}`}>{t('Live data', 'Dados ao vivo')}</FieldLabel>
              <FieldDescription>
                {t(
                  'Its charts, key figures and data tables update every time it opens, from this project. Off, they keep the figures they were written with.',
                  'Os gráficos, números-chave e tabelas de dados se atualizam toda vez que ele abre, com os dados deste projeto. Desligado, ficam com os números de quando foram escritos.',
                )}
              </FieldDescription>
            </FieldContent>
            <Switch id={`artifact-live-${artifact.id}`} checked={artifact.live} onCheckedChange={(live) => onChange({ live })} />
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}

function ArtifactShare({ artifact, sharing, onShare, t }: { artifact: Artifact; sharing: boolean; onShare: (shared: boolean) => void; t: T }) {
  const [copied, setCopied] = useState(false);
  const link = artifact.share_token ? `${window.location.origin}/shared/${artifact.share_token}` : '';
  // Its states are the button's (an icon and its tooltip), never text in the header: a public link on, the data live.
  const state = [link ? t('Public link on', 'Link público ligado') : t('Share', 'Compartilhar'), ...(artifact.live ? [t('live data', 'dados ao vivo')] : [])].join(', ');
  return (
    <Popover>
      <Hint text={state}>
        <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={state} />}>{link ? <Globe /> : <Link2 />}</PopoverTrigger>
      </Hint>
      <PopoverContent align="end" className="agent-share">
        <PopoverHeader>
          <PopoverTitle>{t('Share by link', 'Compartilhar por link')}</PopoverTitle>
          <PopoverDescription>
            {link
              ? artifact.live
                ? t('Anyone with the link reads this artifact, without signing in, with its data updated.', 'Qualquer pessoa com o link lê este artefato, sem entrar na conta, com os dados atualizados.')
                : t('Anyone with the link can read this artifact, without signing in.', 'Qualquer pessoa com o link lê este artefato, sem entrar na conta.')
              : t('Only people in this workspace can open it. A link lets anyone read it, without signing in.', 'Só as pessoas deste workspace podem abrir. Um link deixa qualquer pessoa ler, sem entrar na conta.')}
          </PopoverDescription>
        </PopoverHeader>
        {link ? (
          <>
            <InputGroup>
              <InputGroupInput readOnly value={link} aria-label={t('Public link', 'Link público')} onFocus={(event) => event.currentTarget.select()} />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  onClick={() =>
                    void navigator.clipboard.writeText(link).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? t('Copied', 'Copiado') : t('Copy', 'Copiar')}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <Button variant="outline" pending={sharing} pendingLabel={t('Stopping…', 'Parando…')} onClick={() => onShare(false)}>
              {t('Stop sharing', 'Parar de compartilhar')}
            </Button>
          </>
        ) : (
          <Button variant="default" pending={sharing} pendingLabel={t('Creating the link…', 'Criando o link…')} onClick={() => onShare(true)}>
            {t('Create a public link', 'Criar link público')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The title, edited in place as in Google Docs (members): it reads as the heading, shows its edge on hover, and while
 * focused it is a field as wide as its text. Enter or leaving the field saves it; Escape puts it back. An artifact's, and
 * (`label`, `maxLength`) a conversation's in the chat's bar.
 */
function EditableTitle({ title, hint, canEdit, onRename, heading: Heading = 'h1', label, maxLength = 120, t }: { title: string; hint?: string; canEdit: boolean; onRename: (title: string) => Promise<void>; heading?: 'h1' | 'h2'; label?: string; maxLength?: number; t: T }) {
  const [draft, setDraft] = useState(title);
  const [failure, setFailure] = useState<string | null>(null);
  // Escape leaves the field without saving: blur reads this, not the draft of the render it was bound in.
  const cancelled = useRef(false);
  // Its tooltip says the whole title and when it was last edited (the caption beside it gives way on a narrow header).
  if (!canEdit)
    return (
      <Hint text={hint ?? title}>
        <Heading className="agent-artifact-title">{title}</Heading>
      </Hint>
    );
  const commit = async (value: string) => {
    const next = value.replace(/\s+/g, ' ').trim();
    if (cancelled.current || !next || next === title) {
      cancelled.current = false;
      setDraft(title);
      return;
    }
    setFailure(null);
    await onRename(next).catch((cause) => {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      setDraft(title);
    });
  };
  return (
    <Heading className="agent-artifact-title">
      {/* The heading's own text (a field's value is not): a page never has an empty title for a screen reader. */}
      <span className="sr-only">{title}</span>
      <Hint text={failure ?? `${hint ?? title}\n${t('Click to rename', 'Clique para renomear')}`}>
        <Input
          variant="title"
          value={draft}
          maxLength={maxLength}
          spellCheck={false}
          aria-label={label ?? t('Artifact title', 'Título do artefato')}
          aria-invalid={failure ? true : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => void commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              cancelled.current = true;
              event.currentTarget.blur();
            }
          }}
        />
      </Hint>
    </Heading>
  );
}

/**
 * In Ask Lastfind's panel on an artifact's page: the person's conversation about it, for the people of the workspace (never the public
 * link). Its own conversations, not the one that wrote it: the latest, or a new one (`fresh`, the panel's New chat). Every
 * message carries the artifact (the agent may change it) and the passage selected in it.
 */
function ArtifactChat({
  artifact,
  fresh,
  selection,
  onClearSelection,
  onWriting,
  onWritten,
  onConversation,
  t,
}: {
  artifact: Artifact;
  fresh: boolean;
  selection: string;
  onClearSelection: () => void;
  onWriting: (work: AgentWork | null) => void;
  onWritten: (id: string) => void;
  /** The conversation on screen (none yet: null), for the panel's new window. */
  onConversation?: (id: string | null) => void;
  t: T;
}) {
  const { locale } = useI18n();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => onConversation?.(id), [id, onConversation]);
  const [ready, setReady] = useState(fresh);
  const [opening, setOpening] = useState<Opening | null>(null);
  const usage = useAgentUsage(artifact.project_id);
  // A request left for this artifact (a content started from Agent > Contents): in the box to finish, or sent at once (below).
  const [draft, setDraft] = useState(() => {
    const prepared = peekAgentRequest(artifact.id);
    return prepared && !prepared.send ? prepared.text : '';
  });
  const [files, setFiles] = useState<AgentFile[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let current = true;
    requestJson<{ conversations: ConversationSummary[]; usage: AgentUsage }>(
      `/api/agent/conversations?project=${encodeURIComponent(artifact.project_id)}&artifact=${encodeURIComponent(artifact.id)}`,
    )
      .then(
        (data) => {
          if (!current) return;
          announceUsage(artifact.project_id, data.usage);
          // A conversation started meanwhile (a request sent at once) stays.
          if (!fresh) setId((now) => now ?? data.conversations[0]?.id ?? null);
        },
        () => {},
      )
      .finally(() => current && setReady(true));
    return () => {
      current = false;
    };
  }, [artifact.project_id, artifact.id, fresh]);
  const body: TurnBody = { locale, artifact: artifact.id, ...(selection ? { selection } : {}) };
  const quote = selection ? { text: selection.replace(/\s+/g, ' ').slice(0, 120), onRemove: onClearSelection } : undefined;
  const limited = usage?.limit != null && usage.used >= usage.limit;
  // The first message shows at once, waiting in the new conversation until it exists (as in Agent > Chat).
  const start = (text: string, attached: AgentFile[]) => {
    if (!text && !attached.length) return;
    setDraft('');
    setFiles([]);
    setOpening({ text, files: attached });
    setId(newConversation(artifact.project_id, artifact.id));
  };
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  useEffect(() => {
    const prepared = takeAgentRequest(artifact.id);
    if (prepared?.send) startRef.current(prepared.text, []);
  }, [artifact.id]);
  return (
    <section className="agent-thread agent-artifact-chat" aria-label={t('Chat about this artifact', 'Chat sobre este artefato')}>
      {!ready ? (
        <div className="agent-thread-body">
          <div className="agent-thread-loading" aria-busy="true" aria-label={t('Loading the conversation', 'Carregando a conversa')}>
            <Skeleton className="h-10 w-2/3 self-end" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      ) : id ? (
        <ThreadBoundary key={id} t={t}>
          <Suspense fallback={null}>
            <LiveThread
              id={id}
              opening={opening}
              body={body}
              draft={draft}
              setDraft={setDraft}
              files={files}
              setFiles={setFiles}
              limited={limited}
              wide={false}
              artifactId={artifact.id}
              onOpenArtifact={(other) => other && other !== artifact.id && window.open(`/artifact/${encodeURIComponent(other)}`, '_blank', 'noopener')}
              onArtifact={onWritten}
              onTurnEnd={() => {}}
              onWriting={onWriting}
              quote={quote}
              inputRef={input}
              t={t}
            />
          </Suspense>
        </ThreadBoundary>
      ) : (
        <>
          <div className="agent-thread-body">
            <div className="agent-artifact-chat-welcome">
              {/* The chat beside a skill (Agent > Skills) changes the skill. */}
              <h2 className="text-section">{artifact.id.startsWith('skill:') ? t('Ask the agent to change this skill', 'Peça ao agente para mudar esta skill') : t('Ask the agent about this artifact', 'Peça ao agente sobre este artefato')}</h2>
              <p className="text-body text-muted-foreground">
                {artifact.id.startsWith('skill:')
                  ? t('Say what to do differently: it changes the skill for every project and tells you what changed. Select a passage to talk about it.', 'Diga o que fazer diferente: ele muda a skill para todos os projetos e diz o que mudou. Selecione um trecho para falar dele.')
                  : t(
                      'It reads the artifact and the project data, and changes the text when you ask. Select a passage to talk about it.',
                      'Ele lê o artefato e os dados do projeto, e altera o texto quando você pedir. Selecione um trecho para falar dele.',
                    )}
              </p>
            </div>
          </div>
          <footer className="agent-thread-footer">
            <ComposerFor
              draft={draft}
              setDraft={setDraft}
              files={files}
              setFiles={setFiles}
              onSend={() => start(draft.trim(), files)}
              onStop={() => {}}
              streaming={false}
              disabled={limited}
              quote={quote}
              inputRef={input}
              t={t}
            />
          </footer>
        </>
      )}
    </section>
  );
}

/** The title while an artifact loads, as tall as the one it will be (an editable title is a button). */
export const ArtifactTitleSkeleton = ({ editable }: { editable: boolean }) => (
  <span className={editable ? 'flex h-(--control-height) items-center' : 'flex items-center'}>
    <Skeleton inline className="h-lh w-40" />
  </span>
);
/** The editor's bar while the artifact loads. */
/** The formatting bar's place while a document loads: the bar itself, disabled (editor-toolbar.tsx), never a grey block. */
export const ArtifactBarsSkeleton = EditorToolbarPlaceholder;

/**
 * An artifact opened from its link (Agent > Artifacts or Contents, `?artifact=`) while the workspace still loads: its page as a
 * member opens it (the back arrow, its type, title and actions, the editor's bar, the text), so the app's top bar never shows
 * first and steps aside after (live-app.tsx).
 */
export function ArtifactPageSkeleton() {
  const t = useCopy();
  return (
    <DetailPage className="agent-artifact" data-place="page" aria-busy="true">
      <div className="agent-artifact-main">
        <DetailHeader
          leading={
            <>
              <Button variant="ghost" size="icon" disabled aria-label={t('Back', 'Voltar')}>
                <ArrowLeft />
              </Button>
              <Skeleton className="size-5" />
            </>
          }
          title={<ArtifactTitleSkeleton editable />}
          meta={<Skeleton inline className="h-lh w-32" />}
          actions={['w-20', 'w-8', 'w-8', 'w-8'].map((width, index) => (
            <Skeleton key={index} className={`h-(--control-height) ${width}`} />
          ))}
        >
          <div className="agent-artifact-subheader">
            <div className="agent-artifact-bars">
              <ArtifactBarsSkeleton />
            </div>
          </div>
        </DetailHeader>
        <DetailBodySkeleton label={t('Loading the artifact', 'Carregando o artefato')} lines={4} />
      </div>
    </DetailPage>
  );
}

/**
 * The header's caption, Google Drive style (docs/design/shell.md section 4): when it was last edited, read from now and kept
 * current, with the full date and who edited it in its tooltip; while the person types, the save under way or its failure.
 */
function ArtifactEdited({ artifact, save, label, t }: { artifact: Artifact; save: SaveState; label?: ReactNode; t: T }) {
  const { locale } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && setNow(Date.now());
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  // The save that just ended moves the date: read it from the clock of that render.
  const clock = Math.max(now, save === 'saved' ? Date.parse(artifact.updated_at) || 0 : 0);
  const edited = editedAt(artifact.updated_at, locale, artifact.updated_by === 'agent', clock);
  const fresh = save === 'saved' && clock - Date.parse(artifact.updated_at) < 60_000;
  const caption =
    save === 'saving'
      ? t('Saving…', 'Salvando…')
      : save === 'pending'
        ? t('Unsaved changes', 'Alterações não salvas')
        : save === 'failed'
          ? t("Couldn't save changes", 'Não foi possível salvar as alterações')
          : fresh
            ? t('Changes saved', 'Alterações salvas')
            : (label ?? edited?.caption);
  return (
    <>
      <Hint text={edited?.full}>
        <button type="button" className="agent-edited" data-failed={save === 'failed' || undefined}>
          <time dateTime={artifact.updated_at}>{caption}</time>
        </button>
      </Hint>
      {/* The save's news, read once (never the minute's tick). */}
      <span className="sr-only" role={save === 'failed' ? 'alert' : 'status'}>
        {save === 'saving' ? t('Saving…', 'Salvando…') : save === 'failed' ? t("Couldn't save changes", 'Não foi possível salvar as alterações') : fresh ? t('Changes saved', 'Alterações salvas') : ''}
      </span>
    </>
  );
}

/**
 * A document's tabs (a content's parts; a shared page's sections): on the right, with its fold toggle in its head; below
 * 900px one menu above the document (SectionSidebar). `floating` (a content's tabs on a wide screen): a panel over the page's
 * edge, in a gutter the document keeps for it, so opening or folding it never moves the text; otherwise a second sidebar.
 */
function TabsRail({ items, value, onChange, folded = false, toggle, label, floating = false, t }: { items: SectionItem[]; value: string; onChange: (id: string) => void; folded?: boolean; toggle?: ReactNode; label?: string; floating?: boolean; t: T }) {
  const name = label ?? t('Tabs', 'Abas');
  const rail = (
    <SectionSidebar
      className="agent-tabs-rail"
      side="right"
      surface={floating ? 'floating' : 'sidebar'}
      collapsed={folded}
      label={name}
      header={
        <div className="agent-tabs-rail-head">
          {!folded && <span className="section-group-label">{name}</span>}
          {toggle}
        </div>
      }
      groups={[{ id: 'tabs', items }]}
      value={value}
      onChange={onChange}
    />
  );
  return floating ? <div className="agent-tabs-float">{rail}</div> : rail;
}

/** One confirmation for deleting an artifact, from its page and from the list. */
function DeleteArtifactDialog({ open, onOpenChange, onConfirm, t }: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void; t: T }) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Delete this artifact?', 'Excluir este artefato?')}
      description={t('It leaves the workspace and its public link stops working.', 'Ele sai do workspace e o link público para de funcionar.')}
      cancelLabel={t('Cancel', 'Cancelar')}
      confirmLabel={t('Delete', 'Excluir')}
      destructive
      onConfirm={onConfirm}
    />
  );
}

/**
 * The agent at work on the document open beside its chat: the text stays on screen, read-only (as Google Docs, Notion AI
 * and Cursor keep it), under this banner with Stop (shell.md section 4, "A document the agent is editing"): the pencil,
 * still, and the live label "Editing the artifact…" with its timer, the chat's own sign.
 */
export function AgentWorkNote({ work, canEdit, t }: { work: AgentWork; canEdit: boolean; t: T }) {
  return (
    <Note
      status
      className="agent-artifact-note"
      icon={<PenLine className="size-4" />}
      action={
        <Button variant="outline" onClick={work.stop}>
          {t('Stop', 'Parar')}
        </Button>
      }
    >
      <LiveLabel since={work.since} className="agent-artifact-note-step">
        {t('Editing the artifact…', 'Editando o artefato…')}
      </LiveLabel>{' '}
      {canEdit ? t('Read-only until it finishes.', 'Somente leitura até terminar.') : t('The text updates when it finishes.', 'O texto se atualiza quando ele terminar.')}
    </Note>
  );
}

export function AgentArtifactView({
  id,
  canEdit,
  onClose,
  onChanged,
  expanded,
  onExpand,
  place = 'side',
  agentWork = null,
  onSelection,
  onDelete,
  headerAction,
  variant = 'artifact',
  endpoint,
  projectId,
  meta: metaOverride,
  notes,
  menu,
  titleEditable,
  refresh = 0,
  onLoaded,
  fixture,
  t,
}: {
  id: string;
  canEdit: boolean;
  onClose?: () => void;
  onChanged?: () => void;
  /** Beside the chat on wide screens: the artifact can take the whole pane. */
  expanded?: boolean;
  onExpand?: (expanded: boolean) => void;
  place?: ArtifactPlace;
  /** The agent answers in the chat about this artifact: the editor holds still, saves what it has, and takes the new version after. */
  agentWork?: AgentWork | null;
  /** The text selected in the editor, for the chat beside. */
  onSelection?: (text: string) => void;
  onDelete?: () => void;
  /** One more action first in the page's header (the Brain's Generate with AI). */
  headerAction?: ReactNode;
  /**
   * What it is, known before it loads: an artifact, a Brain file (no icon in its header, the skeleton included) or a skill
   * (Agent > Skills: read and written at `endpoint`, its chat in `projectId`; no share, live data, kind or new window).
   */
  variant?: 'artifact' | 'brain' | 'skill';
  /** Where it is read and written (an artifact's own by default). */
  endpoint?: string;
  /** The project its chat runs in, when it is not a project's own (a skill is the workspace's). */
  projectId?: string;
  /** In place of the line under the title, and slots of the caller's own: notes above the text, items of the More menu. */
  meta?: ReactNode;
  notes?: ReactNode;
  menu?: ReactNode;
  /** Whether the title can be renamed (members, by default). */
  titleEditable?: boolean;
  /** Bumped by the caller after it changed what this shows: it loads again. */
  refresh?: number;
  /** Every load and save hands the caller what came back (its own fields included). */
  onLoaded?: (artifact: Artifact & Record<string, unknown>) => void;
  /** The public demo's example artifact, shown as it is: nothing is read or written, and it has no page of its own. */
  fixture?: Artifact;
  t: T;
}) {
  const url = endpoint ?? `/api/agent/artifacts/${encodeURIComponent(id)}`;
  const handOver = useRef(onLoaded);
  useEffect(() => {
    handOver.current = onLoaded;
  });
  const { locale } = useI18n();
  const wide = useWide('(min-width: 1024px)');
  // A phone shows every width at its own: no choice there.
  const [width, setWidth] = useArtifactWidth(id);
  const roomy = useWide('(min-width: 768px)');
  const [stored, setArtifact] = useState<Artifact | null>(null);
  // The demo's example is shown as it is, never read.
  const artifact = fixture ?? stored;
  const [failure, setFailure] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [save, setSave] = useState<SaveState>('idle');
  const [conflict, setConflict] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // On its page: the chat beside it, the passage selected for it, and whether its agent is working on this artifact.
  // Everything opens without its chat (the Chat button opens it), except one left a request to send.
  // The chat is Ask Lastfind's panel (AskPanel): floating or docked at the right, in the mode the tab last used. Once opened
  // it stays mounted while closed, so an answer under way and its banner go on.
  const [chat, setChat] = useState<AskPanelState>(() => ({ open: !!peekAgentRequest(id), mode: askPanelState().mode }));
  const [chatMounted, setChatMounted] = useState(chat.open);
  const [chatConversation, setChatConversation] = useState<string | null>(null);
  const chatButton = useRef<HTMLButtonElement>(null);
  const chatAct = (action: AskAction) => {
    if (action === 'open') setChatMounted(true);
    setChat((state) => askPanel(state, action));
  };
  useAskReturn(() => chatAct('open'));
  // Bumped by "+": the chat starts a new conversation about it.
  const [chatKey, setChatKey] = useState(0);
  const [selection, setSelection] = useState('');
  // A content's tab: its Overview (publication fields and the top 3), its text, its outline or its research.
  const [tab, setTab] = useState<'overview' | 'content' | (typeof ARTIFACT_PARTS)[number]>('content');
  // A content's tabs fold to a strip.
  const [tabsFolded, setTabsFolded] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem(TABS_KEY) === 'folded');
  // "Edit as Markdown": the text in a plain field instead of the editor, on the same draft and autosave.
  const [markdown, setMarkdown] = useState<string | null>(null);
  // Back from it: the editor opens on what was typed there (until the next load).
  const [resume, setResume] = useState<string | null>(null);
  const partTimer = useRef<number | undefined>(undefined);
  const [chatWork, setChatWork] = useState<AgentWork | null>(null);
  // The project's address (`/app/<workspace>/<project>`): the app's, then as the artifact's read answers it (its own page is
  // outside the app). The chat's new window and its links open under it.
  const [projectHref, setProjectHref] = useState(useContext(ProjectHrefContext));
  const [bars, setBars] = useState<HTMLDivElement | null>(null);
  const draft = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // The document's element, and its text just before a reload shows the agent's version (the highlight, below).
  const bodyRef = useRef<HTMLDivElement>(null);
  const seenBlocks = useRef<string | null>(null);
  const load = () => {
    setFailure(null);
    setGeneration((value) => value + 1);
  };
  useEffect(() => {
    if (canEdit && !fixture) preloadEditor();
  }, [canEdit, fixture]);
  useEffect(() => {
    if (fixture) return;
    let current = true;
    // Its live data blocks come computed now.
    requestJson<{ artifact: Artifact; projectHref?: string | null }>(`${url}?live=1`).then(
      (data) => {
        if (!current) return;
        if (data.projectHref) setProjectHref(data.projectHref);
        draft.current = null;
        seenBlocks.current = blockTexts(bodyRef.current).map(([text]) => text).join('\n');
        setArtifact(projectId ? { ...data.artifact, project_id: projectId } : data.artifact);
        handOver.current?.(data.artifact as Artifact & Record<string, unknown>);
        setResume(null);
      },
      (cause) => current && setFailure(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      current = false;
    };
  }, [id, generation, url, projectId, refresh, fixture]);

  const artifactRef = useRef(artifact);
  useEffect(() => {
    artifactRef.current = artifact;
  });
  /** Saves what the editor holds against the version it loaded; `force` writes over a newer one. */
  const flush = useCallback(
    async (force = false) => {
      window.clearTimeout(timer.current);
      const loaded = artifactRef.current;
      const content = draft.current;
      if (!loaded || content === null) return;
      setSave('saving');
      try {
        const data = await requestJson<{ artifact: Artifact }>(url, 'PUT', { content, version: loaded.version, ...(force ? { force: true } : {}) });
        if (draft.current === content) draft.current = null;
        const saved = projectId ? { ...data.artifact, project_id: projectId } : data.artifact;
        setArtifact((now) => (now && draft.current !== null ? { ...saved, content: now.content } : saved));
        handOver.current?.(data.artifact as Artifact & Record<string, unknown>);
        setSave(draft.current === null ? 'saved' : 'pending');
        onChanged?.();
      } catch (cause) {
        if ((cause as { status?: number })?.status === 409) setConflict(true);
        setSave('failed');
      }
    },
    [url, projectId, onChanged],
  );
  const change = (markdown: string) => {
    // Back to what is saved: nothing to write.
    const saved = artifactRef.current;
    if (saved && markdown === withoutTitle(saved.content, saved.title).trim()) {
      draft.current = null;
      window.clearTimeout(timer.current);
      setSave((now) => (now === 'pending' ? 'idle' : now));
      return;
    }
    draft.current = markdown;
    setSave('pending');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  };
  const work = agentWork ?? chatWork;
  const writing = !!work;
  // What the agent changed, highlighted when it lands: the blocks whose text was nowhere on screen just before the new
  // version came in (`seenBlocks`, read in `load` before it shows it), drawn as boxes over the document so the editor's own
  // DOM is never touched.
  const [marks, setMarks] = useState<CSSProperties[]>([]);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    const before = seenBlocks.current;
    const blocks = blockTexts(bodyRef.current);
    seenBlocks.current = null;
    if (!before || !blocks.length || artifact?.updated_by !== 'agent') return;
    const frame = bodyRef.current!.getBoundingClientRect();
    const changed = blocks.filter(([text]) => !before.includes(text)).map(([, element]) => element.getBoundingClientRect());
    if (!changed.length) return;
    setMarks(changed.map((rect) => ({ top: rect.top - frame.top, left: rect.left - frame.left, width: rect.width, height: rect.height })));
    setChanges((value) => value + 1);
  }, [artifact?.content, artifact?.updated_by]);
  useEffect(() => {
    if (!marks.length) return;
    const timer = window.setTimeout(() => setMarks([]), CHANGED_MS);
    return () => window.clearTimeout(timer);
  }, [marks]);
  // The agent starts writing it: what the person typed is saved first.
  useEffect(() => {
    if (writing) void flush();
  }, [writing, flush]);
  // Leaving with unsaved changes asks first; leaving the screen saves them.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (draft.current !== null) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      void flush();
    };
  }, [flush]);

  const patch = async (change: Record<string, unknown>) => {
    const data = await requestJson<{ artifact: Artifact }>(url, 'PATCH', change);
    const saved = projectId ? { ...data.artifact, project_id: projectId } : data.artifact;
    setArtifact((now) => (now ? { ...saved, content: now.content, version: now.version } : saved));
    handOver.current?.(data.artifact as Artifact & Record<string, unknown>);
    onChanged?.();
  };
  /**
   * A content's outline, research or publication fields, as the person types them: saved after a pause (no history, the
   * text's is kept).
   */
  const changePart = (part: (typeof ARTIFACT_PARTS)[number] | 'meta', value: string | ContentMeta) => {
    setSave('pending');
    window.clearTimeout(partTimer.current);
    partTimer.current = window.setTimeout(() => {
      setSave('saving');
      void patch({ [part]: value }).then(
        () => setSave('saved'),
        () => setSave('failed'),
      );
    }, SAVE_DELAY_MS);
  };
  const share = async (shared: boolean) => {
    setSharing(true);
    await patch({ shared })
      .catch((cause) => setFailure(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSharing(false));
  };
  const remove = async () => {
    await requestJson(url, 'DELETE').catch((cause) => setFailure(cause instanceof Error ? cause.message : String(cause)));
    onDelete?.();
  };
  const downloadMarkdown = () => artifact && download({ ...artifact, content: draft.current ?? artifact.content });
  const copy = () =>
    artifact &&
    void navigator.clipboard.writeText(draft.current ?? artifact.content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  const editing = canEdit && !!artifact;
  // A Brain file is renamed and deleted, never typed, live or shared; nor is a skill.
  const fixed = variant !== 'artifact' || !!artifact?.brain;
  const full = place !== 'side';
  const newWindow = place !== 'standalone' && variant !== 'skill' && !fixture ? `/artifact/${encodeURIComponent(id)}` : null;

  const tabs = full && artifact?.kind === 'content';
  const part = tabs ? tab : 'content';
  // Loading: a line where the caption will be, so the header keeps its place. A caller's own line (a skill's) stands in
  // for "Edited …" while nothing is being saved.
  const meta = !artifact ? !failure && <Skeleton inline className="h-lh w-32" /> : <ArtifactEdited artifact={artifact} save={save} label={metaOverride} t={t} />;
  const titleHint = artifact ? [artifact.title, editedAt(artifact.updated_at, locale, artifact.updated_by === 'agent')?.full].filter(Boolean).join('\n') : undefined;
  const title = artifact ? <EditableTitle key={artifact.title} title={artifact.title} hint={titleHint} canEdit={(titleEditable ?? canEdit) && !writing} onRename={(next) => patch({ title: next })} heading={full ? 'h1' : 'h2'} t={t} /> : <ArtifactTitleSkeleton editable={canEdit} />;
  const actions = (
    <>
      {/* A failed save: the one retry, first among the actions (the caption beside the title says it failed). */}
      {save === 'failed' && <RetryButton onClick={() => void flush()} />}
      {full && headerAction}
      {/* Shown (off) while the artifact loads, so the header does not change when it arrives. */}
      {full && (
        <>
          <Hint text={chat.open ? t('Close the chat', 'Fechar o chat') : t('Chat with the agent about it', 'Converse com o agente sobre ele')}>
            <Button ref={chatButton} variant="ghost" disabled={!artifact} aria-pressed={chat.open} onClick={() => chatAct(chat.open ? 'close' : 'open')}>
              {!fixed && <MessagesSquare aria-hidden="true" />}
              <span className={fixed ? undefined : 'max-md:sr-only'}>{t('Chat', 'Chat')}</span>
            </Button>
          </Hint>
        </>
      )}
      {artifact && canEdit && !fixed && (
        <>
          <ArtifactShare artifact={artifact} sharing={sharing} onShare={(shared) => void share(shared)} t={t} />
          <ArtifactSettings artifact={artifact} onChange={(next) => void patch(next).catch((cause) => setFailure(cause instanceof Error ? cause.message : String(cause)))} t={t} />
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" disabled={!artifact} aria-label={t('More actions', 'Mais ações')} />}>
          <EllipsisVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {newWindow && (
            <DropdownMenuItem render={<a href={newWindow} target="_blank" rel="noopener" aria-label={t('Open in a new window', 'Abrir em nova janela')} />}>
              <ExternalLink aria-hidden="true" />
              {t('Open in a new window', 'Abrir em nova janela')}
            </DropdownMenuItem>
          )}
          {editing && (
            <DropdownMenuItem
              onClick={() => {
                // Back to the editor: what was typed is saved first, and the editor opens on it.
                if (markdown !== null) {
                  setResume(markdown);
                  void flush();
                }
                setMarkdown(markdown === null ? (draft.current ?? withoutTitle(artifact.content, artifact.title).trim()) : null);
              }}
            >
              <FileCode aria-hidden="true" />
              {markdown === null ? t('Edit as Markdown', 'Editar como Markdown') : t('Back to the editor', 'Voltar ao editor')}
            </DropdownMenuItem>
          )}
          {menu}
          {roomy && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <MoveHorizontal aria-hidden="true" />
                {t('Width', 'Largura')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={width} onValueChange={(value) => setWidth(value as ArtifactWidth)}>
                  <DropdownMenuRadioItem value="narrow">{t('Narrow', 'Estreita')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="standard">{t('Standard (A4 page)', 'Padrão (página A4)')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="wide">{t('Wide', 'Larga')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="full">{t('Full width', 'Largura total')}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onClick={copy}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? t('Copied', 'Copiado') : t('Copy Markdown', 'Copiar Markdown')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={downloadMarkdown}>
            <Download aria-hidden="true" />
            {t('Download Markdown', 'Baixar Markdown')}
          </DropdownMenuItem>
          {canEdit && onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden="true" />
                {t('Delete', 'Excluir')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {onExpand && (
        <Hint text={expanded ? t('Back to the chat', 'Voltar ao chat') : t('Expand', 'Expandir')}>
          <Button variant="ghost" size="icon" aria-pressed={!!expanded} aria-label={expanded ? t('Back to the chat', 'Voltar ao chat') : t('Expand', 'Expandir')} onClick={() => onExpand(!expanded)}>
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </Hint>
      )}
      {place === 'side' && onClose && (
        <Hint text={t('Close', 'Fechar')}>
          <Button variant="ghost" size="icon" aria-label={t('Close', 'Fechar')} onClick={onClose}>
            <X />
          </Button>
        </Hint>
      )}
    </>
  );
  const note = work && <AgentWorkNote work={work} canEdit={canEdit} t={t} />;
  // While the text or the editor loads (the editor is asked for as the artifact starts loading): never the reader first and
  // the editor after, which draw the same text a little apart and move it once on screen.
  const textSkeleton = (
    <div className="grid gap-3" aria-hidden="true" aria-busy="true">
      <Skeleton inline className="h-lh w-3/4" />
      <Skeleton inline className="h-lh w-full" />
      <Skeleton inline className="h-lh w-5/6" />
      <Skeleton inline className="h-lh w-full" />
      <Skeleton inline className="h-lh w-2/3" />
    </div>
  );
  const document = (
    <ArtifactLiveContext.Provider value={!!artifact?.live}>
      <div ref={bodyRef} className="agent-artifact-body" data-locked={writing || undefined} aria-busy={writing || undefined}>
        {marks.map((mark, index) => (
          <span key={`${changes}:${index}`} className="agent-artifact-changed" style={mark} aria-hidden="true" />
        ))}
        {failure ? (
          <EmptyState frame="bare" tone="error" title={variant === 'skill' ? t('Could not open this skill', 'Não foi possível abrir esta skill') : t('Could not open this artifact', 'Não foi possível abrir este artefato')} description={failure} onRetry={load} />
        ) : !artifact ? (
          textSkeleton
        ) : part === 'overview' ? (
          <ContentOverviewTab
            key={generation}
            overview={artifact.overview}
            text={artifact.content}
            version={artifact.version}
            canEdit={editing && !writing}
            onMeta={(meta) => changePart('meta', meta)}
            t={t}
          />
        ) : part !== 'content' ? (
          editing ? (
            <Suspense fallback={textSkeleton}>
              <ArtifactEditor
                key={part}
                artifactId={artifact.id}
                markdown={artifact[part] ?? ''}
                editable={!writing}
                onChange={(markdown) => changePart(part, markdown)}
                onSelection={setSelection}
                bars={bars}
                label={part === 'outline' ? t('Outline', 'Outline') : t('Research', 'Pesquisa')}
                t={t}
              />
            </Suspense>
          ) : artifact[part] ? (
            <AgentMarkdown document text={artifact[part] ?? ''} />
          ) : null
        ) : editing && markdown !== null ? (
          <Textarea
            className="min-h-96 font-mono"
            spellCheck={false}
            aria-label={t(`${artifact.title}, Markdown`, `${artifact.title}, Markdown`)}
            value={markdown}
            readOnly={writing}
            onChange={(event) => {
              setMarkdown(event.target.value);
              change(event.target.value);
            }}
          />
        ) : editing ? (
          <Suspense fallback={textSkeleton}>
            <ArtifactEditor
              key={markdown === null ? 'editor' : 'markdown'}
              artifactId={variant === 'skill' ? '' : artifact.id}
              markdown={resume ?? withoutTitle(artifact.content, artifact.title)}
              editable={!writing}
              onChange={change}
              onSelection={full ? setSelection : onSelection}
              bars={full ? bars : null}
              label={artifact.title}
              t={t}
            />
          </Suspense>
        ) : (
          <AgentMarkdown document text={withoutTitle(artifact.content, artifact.title)} />
        )}
        {part !== 'content' && part !== 'overview' && artifact && !artifact[part] && !editing && (
          <p className="text-body text-muted-foreground">
            {part === 'outline' ? t('No outline yet: the agent writes it with the content.', 'Ainda sem outline: o agente escreve com o conteúdo.') : t('No research yet: the agent notes it while it writes.', 'Ainda sem pesquisa: o agente anota enquanto escreve.')}
          </p>
        )}
      </div>
    </ArtifactLiveContext.Provider>
  );
  const dialogs = (
    <>
      <ConfirmDialog
        open={conflict}
        onOpenChange={(value) => !value && setConflict(false)}
        title={variant === 'skill' ? t('This skill changed while you were editing it', 'Esta skill mudou enquanto você editava') : t('This artifact changed while you were editing it', 'Este artefato mudou enquanto você editava')}
        description={t(
          'Someone (or the agent) saved a newer version. Keep yours, and the other stays in its history, or take the newer one.',
          'Alguém (ou o agente) salvou uma versão mais nova. Fique com a sua, e a outra fica no histórico, ou pegue a mais nova.',
        )}
        cancelLabel={t('Take the newer one', 'Pegar a mais nova')}
        onCancel={() => {
          draft.current = null;
          setSave('idle');
          load();
        }}
        confirmLabel={t('Keep mine', 'Ficar com a minha')}
        onConfirm={() => {
          setConflict(false);
          void flush(true);
        }}
      />
      <DeleteArtifactDialog open={deleting} onOpenChange={setDeleting} onConfirm={() => void remove()} t={t} />
    </>
  );

  if (full) {
    // The chat about it: Ask Lastfind's panel, floating or docked at the right of the screen, never between the app and the text.
    const chatPanel = artifact && chatMounted && (
      <AskPanel
        open={chat.open}
        onOpenChange={(open) => chatAct(open ? 'open' : 'close')}
        mode={chat.mode}
        finalFocus={chatButton}
        description={t('A conversation about this artifact.', 'Uma conversa sobre este artefato.')}
        bar={
          <AskPanelBar
            title={<SheetTitle>Ask Lastfind</SheetTitle>}
            mode={chat.mode}
            onNew={() => setChatKey((value) => value + 1)}
            onAction={chatAct}
            fullHref={chatAddress(projectHref, chatConversation, fixed ? undefined : artifact.id)}
            t={t}
          />
        }
      >
        <ProjectHrefContext value={projectHref}>
          <ArtifactChat
            key={chatKey}
            artifact={artifact}
            fresh={chatKey > 0}
            selection={selection}
            onClearSelection={() => setSelection('')}
            onWriting={setChatWork}
            onWritten={(written) => written === id && load()}
            onConversation={setChatConversation}
            t={t}
          />
        </ProjectHrefContext>
      </AskPanel>
    );
    // Two headers: the page's (the title and its actions), then the document's formatting. A content's tabs run down the side
    // of the document in a second sidebar, as Google Docs lists its tabs (folded to a strip on demand), above it on narrow screens.
    // The editor's bar, and its place while the artifact loads.
    // Only while an editor is on screen (the Overview tab has none): an empty row is a bug (shell.md section 4).
    const second = canEdit && !failure && (!artifact || part !== 'overview') && (
      <div className="agent-artifact-subheader">
        <div ref={setBars} className="agent-artifact-bars">
          <ArtifactBarsSkeleton />
        </div>
      </div>
    );
    const changeTab = (value: string) => {
      // What the person typed is saved first: the Overview counts the saved text.
      void flush();
      setTab(value as typeof tab);
    };
    const tabItems = [
      { id: 'overview', label: t('Overview', 'Visão geral') },
      { id: 'content', label: t('Content', 'Conteúdo') },
      { id: 'outline', label: t('Outline', 'Outline') },
      { id: 'research', label: t('Research', 'Pesquisa') },
    ];
    const fold = (folded: boolean) => {
      setTabsFolded(folded);
      window.localStorage.setItem(TABS_KEY, folded ? 'folded' : 'open');
    };
    const foldButton = (
      <Hint text={tabsFolded ? t('Show the tabs', 'Mostrar as abas') : t('Hide the tabs', 'Ocultar as abas')} side="left">
        {/* Folded, the tabs wait in a round button with a list, as a Google Docs outline. */}
        <Button
          variant={tabsFolded ? 'outline' : 'ghost'}
          size="icon"
          className={tabsFolded ? 'rounded-full' : undefined}
          aria-expanded={!tabsFolded}
          aria-label={tabsFolded ? t('Show the tabs', 'Mostrar as abas') : t('Hide the tabs', 'Ocultar as abas')}
          onClick={() => fold(!tabsFolded)}
        >
          <List />
        </Button>
      </Hint>
    );
    // A content's tabs: a second sidebar on the right of the document, white as every second sidebar (shell.md section 5),
    // folded to its toggle on demand; on narrow screens the same list is one menu above the document.
    const rail = tabs && (
      <TabsRail items={tabItems} value={tab} onChange={changeTab} folded={tabsFolded && wide} toggle={wide ? foldButton : undefined} floating={wide} t={t} />
    );
    const header = (
      <DetailHeader
        leading={
          place === 'standalone' ? (
            <a href="/app" className="agent-artifact-logo" aria-label={t('Open Lastfind', 'Abrir o Lastfind')}>
              <LastfindLogo className="h-6 w-auto" />
            </a>
          ) : (
            <>
              <SidebarTrigger className="md:hidden" aria-label={t('Toggle navigation', 'Alternar navegação')} />
              {/* Back to the list it was opened from (contents, artifacts, skills), from the first frame. */}
              {onClose && (
                <Hint text={t('Back', 'Voltar')}>
                  <Button variant="ghost" size="icon" aria-label={t('Back', 'Voltar')} onClick={onClose}>
                    <ArrowLeft />
                  </Button>
                </Hint>
              )}
              {/* Its type before the title (a skill's is known at once; an artifact's holds its place while it loads). A Brain file has none. */}
              {variant === 'skill' ? <ArtifactIcon kind="skill" /> : variant === 'artifact' && !artifact?.brain && (artifact ? <ArtifactIcon kind={artifact.kind} /> : !failure && <Skeleton className="size-5" />)}
            </>
          )
        }
        title={title}
        meta={meta}
        actions={actions}
      >
        {second}
      </DetailHeader>
    );
    const main = (
      <div className="agent-artifact-main">
        {header}
        <div className="agent-artifact-docs" data-tabs={(rail && wide && 'floating') || undefined}>
          <div className="agent-artifact-scroll">
            <DetailBody>
              {note}
              {notes}
              {document}
            </DetailBody>
          </div>
          {rail}
        </div>
      </div>
    );
    return (
      <DetailPage className="agent-artifact" data-place={place} data-width={width} aria-busy={!artifact && !failure}>
        {main}
        {chatPanel}
        {dialogs}
      </DetailPage>
    );
  }
  return (
    <article className="agent-artifact" data-place={place} data-width={width} aria-label={artifact?.title ?? t('Artifact', 'Artefato')} aria-busy={!artifact && !failure}>
      <DetailHeader density="compact" className="static" title={title} meta={meta} actions={actions} />
      {note}
      {document}
      {dialogs}
    </article>
  );
}

/** An artifact on its own page (/artifact/<id>): no app navigation, the same page as in the app, the logo back to Lastfind. */
export function AgentArtifactPage({ id }: { id: string }) {
  const t = useCopy();
  const [access, setAccess] = useState<{ canEdit: boolean } | 'signed-out' | 'missing' | null>(null);
  useEffect(() => {
    let current = true;
    requestJson<{ canEdit: boolean }>(`/api/agent/artifacts/${encodeURIComponent(id)}`).then(
      (data) => current && setAccess({ canEdit: data.canEdit }),
      (cause) => current && setAccess((cause as { status?: number })?.status === 401 ? 'signed-out' : 'missing'),
    );
    return () => {
      current = false;
    };
  }, [id]);
  if (access && typeof access === 'object') return <AgentArtifactView id={id} canEdit={access.canEdit} place="standalone" onDelete={() => window.location.assign('/app')} t={t} />;
  return (
    <DetailPage className="agent-standalone">
      <DetailHeader
        leading={
          <a href="/app" className="agent-artifact-logo" aria-label={t('Open Lastfind', 'Abrir o Lastfind')}>
            <LastfindLogo className="h-6 w-auto" />
          </a>
        }
        title={access === null ? <ArtifactTitleSkeleton editable={false} /> : <h1 className="agent-artifact-title">{t('Artifact', 'Artefato')}</h1>}
        meta={access === null && <Skeleton inline className="h-lh w-32" />}
      />
      {access === null ? (
        <DetailBodySkeleton label={t('Loading the artifact', 'Carregando o artefato')} />
      ) : (
        <DetailBody>
          <EmptyState
            frame="bare"
            title={access === 'signed-out' ? t('Sign in to open this artifact', 'Entre para abrir este artefato') : t('Artifact not found', 'Artefato não encontrado')}
            description={
              access === 'signed-out'
                ? t('It belongs to a Lastfind workspace.', 'Ele pertence a um workspace do Lastfind.')
                : t('It was deleted, or it belongs to another workspace.', 'Ele foi excluído, ou pertence a outro workspace.')
            }
            action={
              <Button variant="outline" nativeButton={false} render={<a href="/app" aria-label={access === 'signed-out' ? t('Sign in', 'Entrar') : t('Open Lastfind', 'Abrir o Lastfind')} />}>
                {access === 'signed-out' ? t('Sign in', 'Entrar') : t('Open Lastfind', 'Abrir o Lastfind')}
              </Button>
            }
          />
        </DetailBody>
      )}
    </DetailPage>
  );
}

function useDates() {
  const { locale } = useNumbers();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return { dateTime: (value: string) => format.format(new Date(value)) };
  }, [locale]);
}

/** Wide screens show the artifact beside the chat; narrower ones in a sheet. */
function useWide(query = '(min-width: 1280px)') {
  // Read at once in the browser: the panes are laid out right from the first frame.
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return wide;
}

// ---------------------------------------------------------------- conversations

function groups(conversations: ConversationSummary[], t: T) {
  const day = 86_400_000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  const sections: { id: string; label: string; items: ConversationSummary[] }[] = [
    { id: 'pinned', label: t('Pinned', 'Fixadas'), items: [] },
    { id: 'today', label: t('Today', 'Hoje'), items: [] },
    { id: 'yesterday', label: t('Yesterday', 'Ontem'), items: [] },
    { id: 'week', label: t('Previous 7 days', 'Últimos 7 dias'), items: [] },
    { id: 'month', label: t('Previous 30 days', 'Últimos 30 dias'), items: [] },
    { id: 'older', label: t('Older', 'Mais antigas'), items: [] },
  ];
  for (const item of conversations) {
    const at = new Date(item.updated_at).getTime();
    const index = item.pinned ? 0 : at >= start ? 1 : at >= start - day ? 2 : at >= start - 7 * day ? 3 : at >= start - 30 * day ? 4 : 5;
    sections[index].items.push(item);
  }
  return sections.filter((section) => section.items.length);
}

/** The conversations of a project: a search and the rows by date, in the chat's popover (a sheet on a phone). */
export function ConversationList({
  conversations,
  loading,
  failure,
  activeId,
  answering,
  unread,
  onSelect,
  onRename,
  onPin,
  onDelete,
  onRetry,
  readOnly,
  t,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  failure: string | null;
  activeId: string | null;
  /** Conversations this page sees answering (the list's `running` covers the others). */
  answering: ReadonlySet<string>;
  /** Conversations whose answer ended while another was open: not seen yet. */
  unread: ReadonlySet<string>;
  onSelect: (id: string) => void;
  /** The row menu (rename, pin, delete); without them the rows only open (Ask Lastfind's history). */
  onRename?: (item: ConversationSummary, title: string) => void;
  onPin?: (item: ConversationSummary) => void;
  onDelete?: (item: ConversationSummary) => void;
  onRetry: () => void;
  /** The public demo's examples: no row menu, and nothing opens ahead (there is no conversation to open). */
  readOnly?: boolean;
  t: T;
}) {
  const { locale } = useNumbers();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  // Enter or leaving the field saves the new name, as the chat bar's title does; Esc puts it back. Once per rename.
  const settled = useRef(false);
  const rename = (item: ConversationSummary) => {
    settled.current = false;
    setEditing({ id: item.id, title: item.title });
  };
  const finish = (item: ConversationSummary, save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = editing?.title.replace(/\s+/g, ' ').trim();
    if (save && next && next !== item.title) onRename?.(item, next);
    setEditing(null);
  };
  const needle = query.trim().toLocaleLowerCase(locale);
  const shown = needle ? conversations.filter((item) => (item.title || t('New conversation', 'Nova conversa')).toLocaleLowerCase(locale).includes(needle)) : conversations;
  const byId = new Map(conversations.map((item) => [item.id, item]));
  const row = (item: ConversationSummary): SectionItem => ({
    id: item.id,
    label: item.title || t('New conversation', 'Nova conversa'),
    editor:
      editing?.id === item.id ? (
        <form
          className="agent-conversation-rename"
          onSubmit={(event) => {
            event.preventDefault();
            finish(item, true);
          }}
        >
          <Input
            ref={(node) => node?.focus()}
            maxLength={80}
            value={editing.title}
            aria-label={t('Conversation title', 'Título da conversa')}
            onChange={(event) => setEditing({ id: item.id, title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              // Esc ends the rename only; the popover or sheet around the list stays open.
              event.stopPropagation();
              finish(item, false);
            }}
            onBlur={() => finish(item, true)}
          />
        </form>
      ) : undefined,
    actions: (
      <>
        {/* Still answering: a thin spinner before the menu, always in view; an answer that ended unseen: a fixed dot. */}
        {item.running || answering.has(item.id) ? (
          <Spinner variant="activity" className="agent-conversation-running" aria-label={t('Answering', 'Respondendo')} />
        ) : (
          unread.has(item.id) && (
            <output className="agent-conversation-running" aria-label={t('New answer', 'Resposta nova')}>
              <LiveDot />
            </output>
          )
        )}
        {!readOnly && onPin && onDelete && <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t(`Actions for ${item.title || 'this conversation'}`, `Ações de ${item.title || 'esta conversa'}`)} />}>
            <EllipsisVertical />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => rename(item)}>
              <Pencil aria-hidden="true" />
              {t('Rename', 'Renomear')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPin(item)}>
              {item.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
              {item.pinned ? t('Unpin', 'Desafixar') : t('Pin', 'Fixar')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(item)}>
              <Trash2 aria-hidden="true" />
              {t('Delete', 'Excluir')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </>
    ),
  });
  // The row the pointer rests on (or the keyboard reaches) starts opening its conversation.
  const warm = (target: EventTarget) => {
    const id = (target as Element).closest?.('[data-item]')?.getAttribute('data-item');
    if (id && byId.has(id) && !readOnly) prefetchConversation(id);
  };
  const state = loading ? (
    <div className="agent-conversations-state" aria-busy="true" aria-label={t('Loading conversations', 'Carregando conversas')}>
      {['w-3/4', 'w-1/2', 'w-5/6', 'w-2/3'].map((width, index) => (
        <div key={index} className="agent-conversations-skeleton">
          <Skeleton inline className={`h-lh ${width}`} />
        </div>
      ))}
    </div>
  ) : failure ? (
    <EmptyState frame="inline" tone="error" title={t('Could not load the conversations', 'Não foi possível carregar as conversas')} description={failure} onRetry={onRetry} />
  ) : !shown.length ? (
    <EmptyState
      frame="inline"
      title={needle ? t('No conversation has this in its title', 'Nenhuma conversa tem isso no título') : t('No conversations yet', 'Nenhuma conversa ainda')}
      description={needle ? undefined : t('Your conversations about this project appear here.', 'Suas conversas sobre este projeto aparecem aqui.')}
    />
  ) : null;
  // The arrows walk from the search through the rows (and back up to it); Enter opens the row, or the first result from the search.
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('.agent-conversations-top input, .section-row-button')];
    const at = stops.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    stops[Math.min(stops.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
  };
  const first = groups(shown, t)[0]?.items[0];
  return (
    <div className="agent-conversations">
      <div className="contents" role="presentation" onKeyDown={walk} onPointerOver={(event) => warm(event.target)} onPointerLeave={cancelPrefetch} onFocus={(event) => warm(event.target)}>
        <SectionSidebar
          className="agent-conversations-list"
          side="left"
          narrow="list"
          label={t('Conversations', 'Conversas')}
          header={
            <div className="agent-conversations-top">
              <SearchField
                fullWidth
                value={query}
                onChange={setQuery}
                placeholder={t('Search conversations', 'Buscar conversas')}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || !first || state) return;
                  event.preventDefault();
                  onSelect(first.id);
                }}
              />
              {state}
            </div>
          }
          groups={state ? [] : groups(shown, t).map((section) => ({ id: section.id, label: section.label, items: section.items.map(row) }))}
          value={activeId ?? ''}
          onChange={onSelect}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Agent > Chat

/** Scrolls glide unless the person asked for less motion. */
const glide = (): ScrollBehavior => (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/**
 * Brings the end of the chat into view when `when` changes to a new value (a question just sent, a change to approve
 * just arrived); the chat then follows the answer while the person stays at its end.
 */
function FollowTo({ when }: { when: string }) {
  const { scrollToEnd } = useMessageScroller();
  const scroll = useRef(scrollToEnd);
  const followed = useRef(when);
  useEffect(() => {
    scroll.current = scrollToEnd;
  });
  useEffect(() => {
    if (!when || when === followed.current) return;
    followed.current = when;
    scroll.current({ behavior: glide() });
  }, [when]);
  return null;
}

/** What the page sends with each message: the period it shows (the agent's default) and its language. */
type TurnBody = {
  period?: { days: number } | { start: string; end: string };
  locale: string;
  /** The artifact open beside the chat (the agent may change it), and the passage selected in it. */
  artifact?: string;
  selection?: string;
  /** Ask Lastfind: the screen behind the panel, its address and title ("this page"; lib/agent.ts readPage). */
  page?: { path: string; title: string };
};

/** A message the person sent before its conversation existed: the new conversation's thread sends it once connected. */
type Opening = { text: string; files: AgentFile[] };
/** A message waiting to go: behind the answer under way, or until the conversation connects. It keeps what the page sent with it. */
type Queued = { id: string; text: string; files: AgentFile[]; body: TurnBody };

const NONE: PendingCall[] = [];
const filePart = (file: AgentFile) => ({ type: 'file' as const, mediaType: file.mediaType, url: file.url, ...(file.name ? { filename: file.name } : {}) });

// ---------------------------------------------------------------- what this tab keeps of each conversation
// A conversation opens in one round trip (its ticket, messages and ratings together), at once when this tab showed it
// before (its last messages, then the agent's), and starts opening when the pointer rests on it in the list.

// The ticket itself is an HttpOnly cookie for the conversation's live path (the page never sees it); `expires` says one
// was just set. It opens one connection: a connection that closes asks for a new one.
type Opened = { expires: number; messages: UIMessage[]; ratings: Record<string, number> };
/** A ticket lasts two minutes: one fetched less than a minute ago, and not used yet, still opens the connection. */
const TICKET_REUSE_MS = 60_000;
/** A connection that keeps failing asks for a new ticket at most this often (its own retries go on meanwhile). */
const TICKET_REFRESH_MS = 3_000;
const opens = new Map<string, { at: number; promise: Promise<Opened> }>();
const keptMessages = new Map<string, UIMessage[]>();
/** Conversations this tab created or is creating (their id chosen here): opening one waits until it exists. */
const creations = new Map<string, () => Promise<unknown>>();
/** The first ticket a creation brought (its expiry), until a connection opens with it: no request of its own. */
const firstTickets = new Map<string, number>();
/** The first messages already put in a queue (a thread mounted again does not send one twice). */
const queuedOpenings = new WeakSet<Opening>();

function openLive(id: string, fresh = false): Promise<Opened> {
  const known = opens.get(id);
  if (known && !fresh && Date.now() - known.at < TICKET_REUSE_MS) return known.promise;
  const promise = (async () => {
    await creations.get(id)?.();
    // Just created here: nothing to read yet, and its ticket came with it.
    const expires = firstTickets.get(id);
    firstTickets.delete(id);
    if (expires && !fresh && expires - Date.now() > TICKET_REUSE_MS) return { expires, messages: [], ratings: {} };
    return requestJson<Opened>(`/api/agent/conversations/${encodeURIComponent(id)}/live`, 'POST', {});
  })();
  opens.set(id, { at: Date.now(), promise });
  promise.catch(() => opens.get(id)?.promise === promise && opens.delete(id));
  return promise;
}

/**
 * A new conversation, its id chosen here: it shows at once, and opening it waits for the server to have it. One request
 * creates it and brings its first ticket (`live`; its agent wakes meanwhile), so the connection opens right after. Asked
 * again for the same id (focused, then sent), it is the same creation.
 */
export function newConversation(projectId: string, artifactId?: string, id: string = crypto.randomUUID()) {
  if (creations.has(id)) return id;
  let made: Promise<unknown> | null = null;
  creations.set(id, () =>
    (made ??= requestJson<{ expires?: number }>('/api/agent/conversations', 'POST', { project: projectId, id, live: true, ...(artifactId ? { artifact: artifactId } : {}) }).then(
      (created) => {
        if (typeof created.expires === 'number') firstTickets.set(id, created.expires);
      },
      (cause) => {
        made = null;
        throw cause;
      },
    )),
  );
  return id;
}

function keep(id: string, messages: UIMessage[]) {
  keptMessages.delete(id);
  keptMessages.set(id, messages);
  // ponytail: the last 20 conversations of this tab, in memory only (images make transcripts heavy).
  if (keptMessages.size > 20) keptMessages.delete(keptMessages.keys().next().value!);
}

type ConversationsRead = { conversations: ConversationSummary[]; usage: AgentUsage };
/** Every read of the month's use (the chat's lists after each answer) reaches the account menu's credit row. */
const USAGE_EVENT = 'lastfind:agent-usage';
/** The last use read per project: the account menu mounts its row only when opened, so it starts from here. */
const lastUsage = new Map<string, AgentUsage>();
const announceUsage = (projectId: string, usage: AgentUsage) => {
  lastUsage.set(projectId, usage);
  window.dispatchEvent(new CustomEvent(USAGE_EVENT, { detail: { projectId, usage } }));
};
/** A project's use as last read (a list, or the live connection after every model call and answer), kept current. */
function useAgentUsage(projectId: string) {
  return useSyncExternalStore(subscribeUsage, () => lastUsage.get(projectId) ?? null, () => null);
}
const subscribeUsage = (changed: () => void) => {
  window.addEventListener(USAGE_EVENT, changed);
  return () => window.removeEventListener(USAGE_EVENT, changed);
};

/**
 * The account menu's credit row, among the plan's rows, on every screen of the project. Cloud: the account's AI
 * credits left this month (Unlimited: used); the independent edition, which has no credits (the owner pays the AI directly):
 * what is left of the project's budget in US$ (no budget: the month's spend). Nothing until the first read (never a zero).
 */
export function AgentUsageRow({ projectId }: { projectId: string }) {
  const { locale } = useI18n();
  const t = (en: string, pt: string) => (locale === 'pt-BR' ? pt : en);
  const usage = useAgentUsage(projectId);
  if (!usage) return null;
  const usd = (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
  const label =
    usage.unit === 'usd'
      ? usage.limit === null
        ? t('Spent this month', 'Gasto no mês')
        : t('Project budget', 'Orçamento')
      : t('AI credits', 'Créditos de IA');
  return <UsageMeterRow row={{ key: 'agent', label, used: usage.used, limit: usage.limit, format: usage.unit === 'usd' ? usd : undefined, credits: usage.unit === 'credits', left: true }} />;
}
/** The last list of conversations this tab read, per project: Agent > Chat shows it at once and reads it again. */
const conversationLists = new Map<string, ConversationsRead>();
const listReads = new Map<string, Promise<ConversationsRead>>();
/** Reads a project's conversations and keeps them; `reuse` takes a read already under way (the prefetch) instead of a new one. */
function readConversations(projectId: string, reuse = false) {
  const under = reuse ? listReads.get(projectId) : undefined;
  if (under) return under;
  const read = requestJson<ConversationsRead>(`/api/agent/conversations?project=${encodeURIComponent(projectId)}`).then((data) => {
    conversationLists.set(projectId, data);
    announceUsage(projectId, data.usage);
    return data;
  });
  listReads.set(projectId, read);
  void read.catch(() => {}).finally(() => listReads.get(projectId) === read && listReads.delete(projectId));
  return read;
}
/** Agent > Chat opens with its conversations already read (live-app.tsx asks once the project is known). */
export function prefetchConversations(projectId: string) {
  if (!conversationLists.has(projectId)) void readConversations(projectId, true).catch(() => {});
}

/** Starts opening a conversation; its messages are kept to show at once when it opens (even after the ticket is old). */
function warmConversation(id: string) {
  void openLive(id).then((opened) => keptMessages.has(id) || keep(id, opened.messages), () => {});
}
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
/** The pointer resting on a conversation (or the keyboard on it) starts opening it. */
function prefetchConversation(id: string) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => warmConversation(id), 120);
}
const cancelPrefetch = () => clearTimeout(prefetchTimer);

/** The artifacts the messages show, each with its version (a rewrite is new). */
const artifactKeys = (messages: readonly UIMessage[]) =>
  oneAnswerPerQuestion(messages.map((message) => viewOf(message as UiMessage))).flatMap((view) =>
    view.role === 'assistant' ? view.artifacts.map((artifact) => `${artifact.id}:${artifact.updated_at}`) : [],
  );

/** The connection's own words (the agent's errors arrive in the person's language). */
const TRANSPORT_ERRORS = /^(WebSocket closed mid-stream|Stream error|Aborted|Connection closed)$/;
const SOCKET_DROPPED = 'WebSocket closed mid-stream';
/**
 * A chat request the page does not wait on: an abort (the person stopped, the page left, the connection changed) is how
 * it ends, not an error; anything else still surfaces.
 */
const unawaited = (request: Promise<unknown>) =>
  void request.catch((error: unknown) => {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  });

/**
 * One conversation, live: its agent (worker/agent.ts) over a WebSocket opened with a ticket. The agent keeps the
 * messages and finishes an answer even when the page leaves; every open tab sees it stream, and a reload picks it up.
 * What the person sends shows at once: it goes when the conversation is connected and no answer is under way, in order;
 * sent while an answer is under way, it waits over the message box (AgentQueue). A thread kept `hidden` (another
 * conversation is open) keeps answering and sending its queue, and shows nothing. A `blank` thread is the new conversation
 * before its first message: the same thread (and message box, which keeps focus) goes on once `onStart` creates it. It
 * starts opening (`onWarm` creates it with its ticket, then its connection) as soon as it shows, so the first message
 * goes the moment it is sent, as a later one does.
 */
function LiveThread({
  id,
  blank,
  onStart,
  onWarm,
  welcome,
  opening,
  body,
  draft,
  setDraft,
  files,
  setFiles,
  limited,
  wide,
  artifactId,
  onOpenArtifact,
  onArtifact,
  onTurnEnd,
  onWriting,
  onBusy,
  hidden,
  quote,
  inputRef,
  t,
}: {
  id: string;
  blank?: boolean;
  /** A blank thread's first message: the page creates the conversation and sends this as its `opening`. */
  onStart?: (first: Opening) => void;
  /** A blank thread shown: the page creates the conversation (the same one `onStart` then goes on with). */
  onWarm?: () => void;
  /** What a blank thread shows before its first message. */
  welcome?: ReactNode;
  opening: Opening | null;
  body: TurnBody;
  draft: string;
  setDraft: (value: string) => void;
  files: AgentFile[];
  setFiles: (value: AgentFile[]) => void;
  limited: boolean;
  wide: boolean;
  artifactId: string | null;
  onOpenArtifact: (id: string | null) => void;
  /** The agent wrote or rewrote an artifact while this page watched. */
  onArtifact: (id: string) => void;
  onTurnEnd: () => void;
  /** The agent is at work on the artifact open beside the chat (null once it ends or stops). */
  onWriting: (work: AgentWork | null) => void;
  /** Whether the conversation is answering or has messages waiting to go. */
  onBusy?: (id: string, busy: boolean) => void;
  hidden?: boolean;
  quote?: { text: string; onRemove: () => void };
  inputRef: RefObject<HTMLTextAreaElement | null>;
  t: T;
}) {
  // The parent's callbacks may be new functions on every render: the effects read the latest ones, never re-run for them.
  const callbacks = useRef({ onArtifact, onTurnEnd, onWriting, onBusy });
  useEffect(() => {
    callbacks.current = { onArtifact, onTurnEnd, onWriting, onBusy };
  });
  const bodyRef = useRef(body);
  useEffect(() => {
    bodyRef.current = body;
  });
  const [ticket, setTicket] = useState<{ value: string; at: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(() => !!blank || keptMessages.has(id));
  const warmRef = useRef(onWarm);
  useEffect(() => {
    warmRef.current = onWarm;
  });
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const ticketRef = useRef(ticket);
  useEffect(() => {
    ticketRef.current = ticket;
  });
  const agent = useAgent({
    agent: 'lastfind-agent',
    basePath: `agent-live/${id}`,
    // The ticket only opens the connection (an open one stays open past it) and is spent doing so: a dropped one asks
    // for a new ticket. Not a credential (that is the cookie): a new ticket re-creates the socket at once.
    query: { opened: ticket?.value ?? '' },
    // Without a ticket yet the socket waits unopened (what is sent meanwhile waits in it; never closed, never lost).
    startClosed: !ticket,
    // Connected once the agent has said where the conversation stands (its messages, or the answer under way to resume):
    // a message sent before that would be overwritten by it.
    onMessage: (event: MessageEvent) => {
      // The month's use after every model call and answer: the account menu and the chat count it down as the answer goes.
      if (typeof event.data === 'string' && event.data.startsWith(`{"type":"${USAGE_MESSAGE}"`)) {
        const sent = JSON.parse(event.data) as { project?: unknown; usage?: AgentUsage };
        if (typeof sent.project === 'string' && sent.usage) announceUsage(sent.project, sent.usage);
        return;
      }
      if (typeof event.data === 'string' && /^\{"type":"cf_agent_(chat_messages|stream_resuming)"/.test(event.data)) {
        setEverConnected(true);
        setConnected(true);
      }
    },
    onClose: () => {
      setConnected(false);
      const current = ticketRef.current;
      if (current && Date.now() - current.at >= TICKET_REFRESH_MS)
        openLive(id, true).then(
          (opened) => ticketRef.current === current && setTicket({ value: String(opened.expires), at: Date.now() }),
          () => {},
        );
    },
  });
  // A stopped answer settles on the server (its text stored, the transcript sent to every tab) before the next message
  // goes: sent earlier, that transcript would arrive after it and take it off the screen.
  const [settling, setSettling] = useState(false);
  const chat = useAgentChat({
    agent,
    body: () => bodyRef.current,
    getInitialMessages: null,
    messages: keptMessages.get(id) ?? [],
    onTurnEnd: () => setSettling(false),
  });
  // Its helpers are new functions on every render: effects call the latest ones.
  const chatRef = useRef(chat);
  useEffect(() => {
    chatRef.current = chat;
  });
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState(false);
  const [decisionFailure, setDecisionFailure] = useState<string | null>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  // The first message joins the queue before the screen paints: it shows at once, never after an empty frame.
  useLayoutEffect(() => {
    if (!opening || queuedOpenings.has(opening)) return;
    queuedOpenings.add(opening);
    setQueue((items) => [...items, { id: crypto.randomUUID(), ...opening, body: bodyRef.current }]);
  }, [opening]);
  const [stopped, setStopped] = useState<ReadonlySet<string>>(() => new Set());
  const streaming = chat.status === 'submitted' || chat.status === 'streaming' || chat.isServerStreaming || chat.isRecovering;
  // A socket that closed mid-answer is a reconnection, not an error: the answer resumes (or its stored text shows) once
  // the connection is back.
  const dropped = chat.error?.message === SOCKET_DROPPED;
  // An answer cut by a dropped connection is still under way on the server: it reads as live until it resumes.
  const answering = streaming || dropped;
  const views = useMemo(() => oneAnswerPerQuestion(chat.messages.map((message) => viewOf(message as UiMessage))), [chat.messages]);
  const { clearError } = chat;

  // The artifacts already shown (null until the agent's own messages arrive: a kept copy may be older), so only one
  // written while this page watches opens beside the chat.
  const seen = useRef<Set<string> | null>(opening || blank ? new Set() : null);

  // Opening: the ticket, the messages and the ratings in one request (a kept copy shows meanwhile). A blank one (mounted
  // only while the new-conversation screen shows) opens at once too: `onWarm` creates it with its ticket and its agent
  // wakes (the slowest part, a few seconds the first time) while the person is still typing, never after they send.
  useEffect(() => {
    warmRef.current?.();
    let current = true;
    openLive(id).then(
      (opened) => {
        if (!current) return;
        seen.current ??= new Set(artifactKeys(opened.messages));
        setRatings(opened.ratings ?? {});
        chatRef.current.setMessages(opened.messages);
        setLoaded(true);
        setTicket({ value: String(opened.expires), at: Date.now() });
        // This ticket is about to be spent: the next thread that opens this conversation asks for its own.
        opens.delete(id);
      },
      (cause) => current && setOpenFailure(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      current = false;
    };
  }, [id, attempt]);

  useEffect(() => {
    if (loaded && !blank) keep(id, chat.messages);
  }, [id, loaded, blank, chat.messages]);
  useEffect(() => {
    if (connected && dropped) clearError();
  }, [connected, dropped, clearError]);

  // An answer that ends: the list and the credits are read again, and the messages are taken as the agent stored them (a
  // turn the person's approval continued can reach this page twice, streamed and stored).
  const wasStreaming = useRef(false);
  const streamingNow = useRef(streaming);
  useEffect(() => {
    streamingNow.current = streaming;
    if (!streaming && wasStreaming.current) {
      callbacks.current.onTurnEnd();
      openLive(id, true).then((opened) => {
        if (streamingNow.current) return;
        chatRef.current.setMessages(opened.messages);
        setRatings(opened.ratings ?? {});
      }, () => {});
    }
    wasStreaming.current = streaming;
  }, [id, streaming]);

  // An artifact written while this page watches opens beside the chat (wide screens) and is read again if open.
  useEffect(() => {
    if (seen.current === null) return;
    for (const message of views)
      if (message.role === 'assistant')
        for (const artifact of message.artifacts) {
          const key = `${artifact.id}:${artifact.updated_at}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          if (!hidden) callbacks.current.onArtifact(artifact.id);
        }
  }, [views, hidden]);

  const last = views.at(-1);
  // The artifact this chat is about (beside it, or the page's own) is read-only for the whole answer, not only while a step
  // writes it: the agent may write it at any step.
  const writing = !hidden && streaming && !!artifactId;
  // Since when it works, for the artifact's banner, and the way to stop it from there.
  const stopRef = useRef(() => {});
  useEffect(() => callbacks.current.onWriting(writing ? { since: Date.now(), stop: () => stopRef.current() } : null), [writing]);
  // A thread that closes (the chat's sheet, another conversation) hands the artifact back: never left locked.
  useEffect(() => () => callbacks.current.onWriting(null), []);
  const pending = useMemo(() => (!streaming && last?.role === 'assistant' ? last.pending : NONE), [streaming, last]);
  // The names of the prompts and topics the waiting changes point at.
  useEffect(() => {
    const ids = pending.flatMap((call) => [call.args.prompt, call.args.topic, ...(Array.isArray(call.args.prompts) ? call.args.prompts : [])]).filter((value): value is string => typeof value === 'string');
    if (!ids.length) return;
    let current = true;
    requestJson<{ labels: Record<string, string> }>(`/api/agent/conversations/${encodeURIComponent(id)}/labels`, 'POST', { ids }).then(
      (data) => current && setLabels((known) => ({ ...known, ...data.labels })),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [id, pending]);

  // The queue goes one message at a time, once connected and with no answer under way nor a change waiting on the person.
  const idle = connected && loaded && !streaming && !settling && !pending.length && !deciding;
  useEffect(() => {
    const next = queue[0];
    if (!idle || !next) return;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setQueue((items) => items.filter((item) => item.id !== next.id));
      clearError();
      setDecisionFailure(null);
      unawaited(chatRef.current.sendMessage(
        { id: next.id, role: 'user', parts: [...next.files.map(filePart), ...(next.text ? [{ type: 'text' as const, text: next.text }] : [])] },
        { body: next.body },
      ));
    });
    return () => {
      current = false;
    };
  }, [idle, queue, clearError]);
  const busy = streaming || queue.length > 0;
  useEffect(() => {
    callbacks.current.onBusy?.(id, busy);
  }, [id, busy]);
  useEffect(() => () => callbacks.current.onBusy?.(id, false), [id]);

  const decide = async (decision: 'approve' | 'reject') => {
    setDeciding(true);
    setDecisionFailure(null);
    try {
      for (const call of pending) await requestJson(`/api/agent/conversations/${encodeURIComponent(id)}/decision`, 'POST', { execution: call.id, approve: decision === 'approve' });
    } catch (cause) {
      setDecisionFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeciding(false);
    }
  };
  const send = (text: string, attached: AgentFile[] = []) => {
    if (!text.trim() && !attached.length) return;
    setDraft('');
    setFiles([]);
    if (blank && onStart) return onStart({ text, files: attached });
    setQueue((items) => [...items, { id: crypto.randomUUID(), text, files: attached, body: bodyRef.current }]);
  };
  const stop = () => {
    const answer = views.at(-1);
    if (answer?.role === 'assistant') setStopped((ids) => new Set(ids).add(answer.id));
    setSettling(true);
    // The server's word usually comes in a moment; a lost one never holds the queue.
    window.setTimeout(() => setSettling(false), 4000);
    unawaited(chat.stop());
  };
  useEffect(() => {
    stopRef.current = stop;
  });
  // Steering: the answer under way stops and this message goes first.
  const steer = (item: string) => {
    setQueue((items) => [...items.filter((other) => other.id === item), ...items.filter((other) => other.id !== item)]);
    if (streaming) stop();
    inputRef.current?.focus();
  };
  // A queued message goes back to the box to be edited (before what is being written there).
  const editQueued = (item: string) => {
    const queued = queue.find((other) => other.id === item);
    if (!queued) return;
    setQueue((items) => items.filter((other) => other.id !== item));
    setDraft(draft.trim() ? `${queued.text}\n\n${draft}` : queued.text);
    setFiles([...queued.files, ...files].slice(0, AGENT_FILES_MAX));
    inputRef.current?.focus();
  };
  // An edited question is answered again as a new branch: the agent keeps the earlier answer aside, off the conversation.
  const edit = (id: string, text: string) => {
    const index = chat.messages.findIndex((message) => message.id === id);
    if (index < 0 || !text.trim()) return;
    const question = chat.messages[index];
    chat.clearError();
    chat.setMessages([...chat.messages.slice(0, index), { ...question, parts: [{ type: 'text', text }, ...question.parts.filter((part) => part.type !== 'text')] }]);
    unawaited(chat.regenerate());
  };
  const rate = (answer: string, rating: 1 | -1 | 0, reason?: string, comment?: string) => {
    setRatings((items) => ({ ...items, [answer]: rating }));
    // A 👎 or a comment teaches the agent: what it changes shows under the conversation (ConversationChanges).
    void requestJson<{ learning?: boolean }>(`/api/agent/conversations/${encodeURIComponent(id)}/feedback`, 'PUT', { message: answer, rating, reason, comment }).then(
      (result) => result.learning && window.dispatchEvent(new CustomEvent(LEARNING_EVENT, { detail: id })),
      () => setRatings((items) => ({ ...items, [answer]: 0 })),
    );
  };

  if (hidden) return null;

  const lastUser = [...views].reverse().find((view) => view.role === 'user');
  const reconnecting = !connected && (everConnected || dropped);
  // What holds the queue besides the connection: then what is sent waits over the box. Otherwise the next message is on
  // its way and already shows in the conversation, where it stays once sent (the same row: nothing moves).
  const holding = answering || settling || deciding || pending.length > 0;
  const sending = holding ? [] : queue.slice(0, 1);
  const waiting = holding ? queue : queue.slice(1);
  // The answer's row is there from the moment the question shows (thinking), and the answer fills that same row.
  const asked = sending.at(-1)?.id ?? (streaming && last?.role === 'user' ? last.id : null);
  const status = streaming ? t('The agent is answering.', 'O agente está respondendo.') : reconnecting ? t('Reconnecting to the agent.', 'Reconectando ao agente.') : last?.role === 'assistant' ? t('The answer is ready.', 'A resposta está pronta.') : '';
  const chatError = chat.error && !dropped ? (TRANSPORT_ERRORS.test(chat.error.message) ? t('The connection dropped before the answer ended.', 'A conexão caiu antes do fim da resposta.') : chat.error.message) : null;
  const failure = openFailure ?? chatError ?? decisionFailure ?? (chat.connectionError ? t('Could not reach the agent.', 'Não foi possível falar com o agente.') : null);
  const retry =
    openFailure || chat.connectionError
      ? () => {
          setOpenFailure(null);
          setAttempt((value) => value + 1);
        }
      : chat.error && lastUser
        ? () => unawaited(chat.regenerate())
        : undefined;
  // One list of rows, each answer keyed by its question: a message on its way keeps its row once sent, and the thinking
  // row becomes the answer.
  const rows = views.map((message, index) => {
    const final = index === views.length - 1;
    if (message.role === 'user')
      return (
        <MessageScrollerItem key={message.id} messageId={message.id}>
          <UserMessage text={message.text} files={message.files} onEdit={!answering && !queue.length && message === lastUser ? (text) => edit(message.id, text) : undefined} t={t} />
        </MessageScrollerItem>
      );
    const key = `answer:${views[index - 1]?.id ?? message.id}`;
    const live = final && answering;
    return (
      <MessageScrollerItem key={key} messageId={key}>
        <AgentAnswer
          clock={key}
          message={{ ...message, pending: message.pending.map((call) => ({ ...call, labels })), rating: (ratings[message.id] || undefined) as 1 | -1 | undefined }}
          live={live}
          resuming={live && chat.isRecovering}
          stopped={stopped.has(message.id)}
          busy={answering || deciding}
          onDecide={final && !answering ? (decision) => void decide(decision) : undefined}
          onOpenArtifact={(artifact) => onOpenArtifact(artifact)}
          openArtifact={wide ? artifactId : null}
          last={final}
          onRetry={final && !answering && !queue.length ? () => unawaited(chat.regenerate()) : undefined}
          onRate={live ? undefined : (rating, reason, comment) => rate(message.id, rating, reason, comment)}
          t={t}
        />
      </MessageScrollerItem>
    );
  });
  for (const item of sending)
    rows.push(
      <MessageScrollerItem key={item.id} messageId={item.id}>
        <UserMessage text={item.text} files={item.files} t={t} />
      </MessageScrollerItem>,
    );
  if (asked && !reconnecting)
    rows.push(
      <MessageScrollerItem key={`answer:${asked}`} messageId={`answer:${asked}`}>
        <AgentAnswer live clock={`answer:${asked}`} resuming={chat.isRecovering} message={{ id: `answer:${asked}`, role: 'assistant', text: '', tools: [], artifacts: [], pending: [] }} onOpenArtifact={() => {}} t={t} />
      </MessageScrollerItem>,
    );

  return (
    <>
      <div className="agent-thread-body">
        {blank && !views.length && !queue.length ? (
          welcome
        ) : !loaded && !queue.length && !openFailure ? (
          <div className="agent-thread-loading" aria-busy="true" aria-label={t('Loading the conversation', 'Carregando a conversa')}>
            <Skeleton className="h-10 w-2/3 self-end" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <FollowTo when={pending.map((call) => call.id).join(',')} />
            <FollowTo when={sending.at(-1)?.id ?? lastUser?.id ?? ''} />
            <MessageScroller>
              <MessageScrollerViewport aria-label={t('Messages', 'Mensagens')}>
                <MessageScrollerContent className="agent-messages">
                  {rows}
                  {!blank && <ConversationChanges conversationId={id} fresh={creations.has(id)} t={t} />}
                  {reconnecting && (
                    <AgentStatus live>{t('Reconnecting…', 'Reconectando…')}</AgentStatus>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton behavior={glide()} aria-label={t('Go to the latest message', 'Ir para a última mensagem')} />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>
      <footer className="agent-thread-footer">
        {failure && !streaming && (
          <Note
            tone="danger"
            icon={<CircleAlert aria-hidden="true" />}
            action={
retry ? <RetryButton onClick={retry} /> : undefined
            }
          >
            {failure}
          </Note>
        )}
        {!streaming && last?.role === 'assistant' && last.stopped === 'spend' && (
          <Note status>{t('This answer stopped at the agent spending limit.', 'Esta resposta parou no limite de gasto do agente.')}</Note>
        )}
        <AgentQueue
          items={waiting}
          onSteer={streaming ? steer : undefined}
          onEdit={editQueued}
          onRemove={(item) => {
            setQueue((items) => items.filter((other) => other.id !== item));
            inputRef.current?.focus();
          }}
          t={t}
        />
        <ComposerFor
          draft={draft}
          setDraft={setDraft}
          files={files}
          setFiles={setFiles}
          onSend={() => send(draft.trim(), files)}
          onStop={stop}
          streaming={streaming}
          disabled={limited || pending.length > 0}
          placeholder={
            pending.length
              ? t('Approve or decline the change above first.', 'Aprove ou recuse a alteração acima primeiro.')
              : streaming
                ? ''
                : undefined
          }
          quote={quote}
          inputRef={inputRef}
          t={t}
        />
        <output className="sr-only" aria-live="polite">
          {status}
        </output>
      </footer>
    </>
  );
}

/**
 * The public demo's conversation (lib/agent-demo.ts): an example, read-only, in the rows and message box of a live one.
 * Nothing connects and nothing is sent: the box says the demo does not answer, with the way to sign up in place of Send.
 */
function DemoThread({
  messages,
  welcome,
  wide,
  artifactId,
  onOpenArtifact,
  t,
}: {
  /** None: the new-conversation screen. */
  messages?: MessageView[];
  welcome: ReactNode;
  wide: boolean;
  artifactId: string | null;
  onOpenArtifact: (id: string | null) => void;
  t: T;
}) {
  return (
    <>
      <div className="agent-thread-body">
        {!messages ? (
          welcome
        ) : (
          <MessageScrollerProvider defaultScrollPosition="start">
            <MessageScroller>
              <MessageScrollerViewport aria-label={t('Messages', 'Mensagens')}>
                <MessageScrollerContent className="agent-messages">
                  {messages.map((message, index) => (
                    <MessageScrollerItem key={message.id} messageId={message.id}>
                      {message.role === 'user' ? (
                        <UserMessage text={message.text} files={message.files} t={t} />
                      ) : (
                        <AgentAnswer example message={message} onOpenArtifact={onOpenArtifact} openArtifact={wide ? artifactId : null} last={index === messages.length - 1} t={t} />
                      )}
                    </MessageScrollerItem>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton behavior={glide()} aria-label={t('Go to the latest message', 'Ir para a última mensagem')} />
            </MessageScroller>
          </MessageScrollerProvider>
        )}
      </div>
      <footer className="agent-thread-footer">
        <AgentComposer
          value=""
          onChange={() => {}}
          onSend={() => {}}
          onStop={() => {}}
          streaming={false}
          placeholder={t('This demo is read-only: the agent does not answer here. Sign up free to ask it about your brand.', 'Esta demo é somente leitura: o agente não responde aqui. Crie sua conta grátis para perguntar sobre a sua marca.')}
          locked={
            <a href={SIGNUP_PATH} className={cn(buttonVariants(), 'rounded-full')}>
              {t('Start for free', 'Começar grátis')}
            </a>
          }
          t={t}
        />
      </footer>
    </>
  );
}

/** The chat's message box, the same for a new conversation and a live one. */
function ComposerFor({
  draft,
  setDraft,
  files,
  setFiles,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  quote,
  inputRef,
  t,
}: {
  draft: string;
  setDraft: (value: string) => void;
  files: AgentFile[];
  setFiles: (value: AgentFile[]) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  placeholder?: string;
  quote?: { text: string; onRemove: () => void };
  inputRef: RefObject<HTMLTextAreaElement | null>;
  t: T;
}) {
  return (
    <AgentComposer
      value={draft}
      onChange={setDraft}
      onSend={onSend}
      onStop={onStop}
      streaming={streaming}
      disabled={disabled}
      placeholder={placeholder}
      quote={quote}
      inputRef={inputRef}
      files={files}
      onFiles={setFiles}
      t={t}
    />
  );
}

// Each starting question names the screen it reads, with that screen's icon.
const SUGGESTIONS: { icon: typeof FileText; text: [string, string] }[] = [
  { icon: navIcons.overview, text: ['How is my visibility in AI answers, and what changed?', 'Como está minha visibilidade nas respostas de IA, e o que mudou?'] },
  { icon: navIcons.competitors, text: ['Which competitors appear more than my brand, and in which prompts?', 'Quais concorrentes aparecem mais do que minha marca, e em quais prompts?'] },
  { icon: navIcons.sources, text: ['Which sources do the AIs cite most about my market?', 'Quais fontes as IAs mais citam sobre o meu mercado?'] },
  { icon: NotebookPen, text: ['Research the keywords of my market and write a content brief for the best opportunity.', 'Pesquise as palavras-chave do meu mercado e escreva um brief de conteúdo para a melhor oportunidade.'] },
];

/** The demo's examples (lib/agent-demo.ts), in their order: the overview, the brands, a content. */
const EXAMPLE_ICONS = [navIcons.overview, navIcons.competitors, NotebookPen];

export function AgentChat({
  projectId,
  projectName,
  brands,
  period,
  canEdit,
  demo = false,
}: {
  projectId: string;
  projectName: string;
  brands?: AgentBrands;
  /** The app's period: the agent answers for it unless the question names another, and says which one it used. */
  period?: { days: string; start?: string; end?: string };
  canEdit: boolean;
  /** The public demo: its example conversations (lib/agent-demo.ts), read-only; nothing is read from or sent to the agent. */
  demo?: boolean;
}) {
  const t = useCopy();
  const { locale } = useI18n();
  const wide = useWide();
  // From 768px the conversations open in a popover under their button; a phone has them in a sheet from the bottom.
  const popover = useWide('(min-width: 768px)');
  const examples = useMemo(() => (demo ? agentDemo((en, pt) => (locale === 'pt-BR' ? pt : en)) : null), [demo, locale]);
  // The list this tab read last shows at once (stale while it is read again).
  const [read, setConversations] = useState<ConversationSummary[]>(() => conversationLists.get(projectId)?.conversations ?? []);
  const [readState, setListState] = useState<{ loading: boolean; failure: string | null }>(() => ({ loading: !conversationLists.has(projectId), failure: null }));
  const conversations = examples?.conversations ?? read;
  const listState = examples ? { loading: false, failure: null } : readState;
  const usage = useAgentUsage(projectId);
  const [activeId, setActiveId] = useState<string | null>(() => readParam('conversation'));
  // The next new conversation's id: its blank thread is the new-conversation screen, and the same thread (and message
  // box) goes on once its first message creates it.
  const [blankId, setBlankId] = useState(() => crypto.randomUUID());
  // The first message of a new conversation (sent by its thread once connected).
  const [opening, setOpening] = useState<Opening | null>(null);
  // Conversations answering or with messages waiting to go; one the person leaves while busy stays connected, unseen.
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [background, setBackground] = useState<string[]>([]);
  const [draft, setDraft] = useState(() => {
    const prepared = peekAgentRequest();
    return prepared && !prepared.send ? prepared.text : '';
  });
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [artifactId, setArtifactId] = useState<string | null>(() => readParam('artifact'));
  // Bumped when the agent writes an artifact, so an open one is read again.
  const [artifactVersion, setArtifactVersion] = useState(0);
  const [artifactFull, setArtifactFull] = useState(false);
  // The conversations are closed until asked for: their button in the chat's bar, or the shortcut.
  const [listOpen, setListOpen] = useState(false);
  const listTrigger = useRef<HTMLButtonElement>(null);
  // The phone's sheet takes the focus itself: the search would raise the keyboard over the list.
  const listSheet = useRef<HTMLDivElement>(null);
  // The device's own spelling of the shortcut, once in the browser (the server's page says ⌘K).
  const shortcut = useSyncExternalStore(noSubscription, () => conversationsShortcutLabel(navigator.userAgent), () => '⌘K');
  // Ask Lastfind popped out to this window (lib/ask-panel.ts): while the tab that opened it is there, the way back to its panel.
  const askWindow = useSyncExternalStore(noSubscription, () => window.name === ASK_WINDOW && !!window.opener && !window.opener.closed, () => false);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !isConversationsShortcut(event, input.current)) return;
      event.preventDefault();
      setListOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [listGeneration, setListGeneration] = useState(0);
  const loadList = useCallback(() => setListGeneration((value) => value + 1), []);
  // The artifact open beside the chat goes with each message, with the passage selected in it (until removed).
  const [selection, setSelection] = useState('');
  const [writing, setWriting] = useState<AgentWork | null>(null);
  const body: TurnBody = {
    locale,
    ...(period ? { period: period.start && period.end ? { start: period.start, end: period.end } : { days: Number(period.days) || 28 } } : {}),
    ...(artifactId ? { artifact: artifactId, ...(selection ? { selection } : {}) } : {}),
  };
  const quote = artifactId && selection ? { text: selection.replace(/\s+/g, ' ').slice(0, 120), onRemove: () => setSelection('') } : undefined;

  // A conversation this tab holds open says itself whether it answers: a list read just as its answer ended may still call
  // it running (its ledger closes a moment later), which would read the list once more for nothing.
  const listed = useMemo(() => {
    const own = (id: string) => id === (activeId ?? blankId) || background.includes(id);
    return conversations.map((item) => (own(item.id) && !!item.running !== busy.has(item.id) ? { ...item, running: busy.has(item.id) || undefined } : item));
  }, [conversations, activeId, blankId, background, busy]);
  // While an answer is under way somewhere (this page, another tab, or one the agent finishes on its own), the list is
  // read again every few seconds, so it shows which ones still answer.
  const answering = listed.some((item) => item.running) || busy.size > 0;
  // An answer that ends in a conversation not open is new to the person until they open it (this tab's memory only).
  const [unread, setUnread] = useState<ReadonlySet<string>>(() => new Set());
  const runningIds = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const now = new Set(listed.filter((item) => item.running).map((item) => item.id));
    const ended = [...runningIds.current].filter((id) => !now.has(id) && id !== activeId && listed.some((item) => item.id === id));
    runningIds.current = now;
    if (ended.length || (activeId && unread.has(activeId))) setUnread((ids) => new Set([...ids, ...ended].filter((id) => id !== activeId)));
  }, [listed, activeId, unread]);
  useEffect(() => {
    if (!answering) return;
    const timer = window.setTimeout(loadList, 5000);
    return () => window.clearTimeout(timer);
  }, [answering, listed, loadList]);
  const markBusy = useCallback((id: string, value: boolean) => {
    setBusy((ids) => {
      if (ids.has(id) === value) return ids;
      const next = new Set(ids);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (demo) return;
    let current = true;
    readConversations(projectId, listGeneration === 0).then(
      (data) => {
        if (!current) return;
        setConversations(data.conversations);
        setListState({ loading: false, failure: null });
      },
      // Only the first read says it failed: a later one (after an answer, or while one is under way) keeps the list shown.
      (cause) => current && setListState((state) => (state.loading || state.failure ? { loading: false, failure: cause instanceof Error ? cause.message : String(cause) } : state)),
    );
    return () => {
      current = false;
    };
  }, [projectId, listGeneration, demo]);
  // The newest conversations start opening once the list shows (a phone has no pointer to rest on them).
  const warmed = useRef(demo);
  useEffect(() => {
    if (warmed.current || listState.loading || !conversations.length) return;
    warmed.current = true;
    for (const item of conversations.slice(0, 3)) if (!keptMessages.has(item.id)) warmConversation(item.id);
  }, [listState.loading, conversations]);
  // An address naming a conversation of another project (or one that is gone) opens a new one here.
  useEffect(() => {
    if (!activeId || creations.has(activeId)) return;
    let current = true;
    const leave = () => {
      if (!current) return;
      setActiveId(null);
      writeParam('conversation', null);
    };
    if (examples) {
      if (!examples.messages[activeId]) leave();
      return;
    }
    requestJson<{ project_id: string }>(`/api/agent/conversations/${encodeURIComponent(activeId)}`).then((data) => data.project_id !== projectId && leave(), leave);
    return () => {
      current = false;
    };
  }, [activeId, projectId, examples]);
  // The conversation left behind keeps its connection while it answers or has messages to send; one in the background
  // goes once it has nothing more to do.
  const leave = useCallback(() => {
    setBackground((ids) => [...ids.filter((id) => id !== activeId && busy.has(id)), ...(activeId && busy.has(activeId) ? [activeId] : [])]);
  }, [activeId, busy]);
  const shown = activeId ?? blankId;
  const threads = [...background.filter((id) => id !== shown && busy.has(id)), shown];
  const leaveRef = useRef(leave);
  useEffect(() => {
    leaveRef.current = leave;
  });
  useEffect(() => {
    const onPop = () => {
      leaveRef.current();
      setOpening(null);
      setActiveId(readParam('conversation'));
      setArtifactId(readParam('artifact'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const select = (id: string | null) => {
    if (id && id === activeId) return setListOpen(false);
    leave();
    setOpening(null);
    setActiveId(id);
    setListOpen(false);
    writeParam('conversation', id, true);
    if (!id) window.setTimeout(() => input.current?.focus(), 0);
  };
  const openArtifact = useCallback((id: string | null) => {
    setArtifactId(id);
    setSelection('');
    if (!id) setArtifactFull(false);
    writeParam('artifact', id);
  }, []);
  const onArtifact = useCallback(
    (id: string) => {
      setArtifactVersion((value) => value + 1);
      if (wide) openArtifact(id);
    },
    [wide, openArtifact],
  );

  /**
   * A new conversation's first message: the blank thread becomes the conversation (same thread, same box) with the
   * message in it at once, and sends it as soon as the conversation exists and is connected.
   */
  const start = (first: Opening) => {
    if (!first.text && !first.files.length) return;
    newConversation(projectId, undefined, blankId);
    leave();
    setDraft('');
    setFiles([]);
    setOpening(first);
    setActiveId(blankId);
    setBlankId(crypto.randomUUID());
    writeParam('conversation', blankId, true);
  };

  // A request prepared on another screen of this tab (Agent > Contents: the wizard sends it, the chat choice leaves it in
  // the box, read with the box's first state). It travels in this tab's session storage, never in the address: a link
  // cannot make the agent answer. Sent before the first paint: the new-conversation screen never flashes.
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  useLayoutEffect(() => {
    if (demo) return;
    const prepared = takeAgentRequest();
    if (prepared?.send) startRef.current({ text: prepared.text, files: [] });
    else if (prepared) window.setTimeout(() => input.current?.focus(), 0);
  }, [demo]);

  const rename = async (item: ConversationSummary, title: string) => {
    setConversations((items) => items.map((each) => (each.id === item.id ? { ...each, title } : each)));
    await requestJson(`/api/agent/conversations/${encodeURIComponent(item.id)}`, 'PATCH', { title }).catch(() => loadList());
  };
  const pin = async (item: ConversationSummary) => {
    await requestJson(`/api/agent/conversations/${encodeURIComponent(item.id)}`, 'PATCH', { pinned: !item.pinned }).catch(() => {});
    loadList();
  };
  const remove = async (item: ConversationSummary) => {
    await requestJson(`/api/agent/conversations/${encodeURIComponent(item.id)}`, 'DELETE').catch(() => {});
    if (item.id === activeId) select(null);
    loadList();
  };

  const active = conversations.find((item) => item.id === activeId);
  const limited = usage?.limit != null && usage.used >= usage.limit;
  const list = (
    <ConversationList
      conversations={listed}
      loading={listState.loading}
      failure={listState.failure}
      activeId={activeId}
      answering={busy}
      unread={unread}
      onSelect={select}
      onRename={(item, title) => void rename(item, title)}
      onPin={(item) => void pin(item)}
      onDelete={setDeleting}
      onRetry={() => loadList()}
      readOnly={demo}
      t={t}
    />
  );
  const welcome = (
    <div className="agent-welcome">
      <h2 className="text-title">{t(`What do you want to know about ${projectName}?`, `O que você quer saber sobre ${projectName}?`)}</h2>
      <p className="text-body text-muted-foreground">
        {t(
          'The agent reads every report of this project, researches Google and keywords, writes reports and content you can share and, with your approval, changes prompts, topics and brands.',
          'O agente lê todos os relatórios deste projeto, pesquisa o Google e palavras-chave, escreve relatórios e conteúdos para compartilhar e, com a sua aprovação, altera prompts, tópicos e marcas.',
        )}
      </p>
      <ItemGroup className="agent-suggestions">
        {(examples
          ? examples.conversations.map((item, index) => ({ key: item.id, icon: EXAMPLE_ICONS[index] ?? MessagesSquare, text: examples.messages[item.id][0].text, open: () => select(item.id) }))
          : SUGGESTIONS.map(({ icon, text: [en, pt] }) => ({ key: en, icon, text: t(en, pt), open: () => start({ text: t(en, pt), files: [] }) }))
        ).map(({ key, icon: Icon, text, open }) => (
          <Item key={key} variant="outline" size="sm" render={<button type="button" aria-label={text} disabled={limited} onClick={open} />}>
            <ItemMedia variant="icon">
              <Icon aria-hidden="true" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{text}</ItemTitle>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
      <p className="text-caption text-muted-foreground">
        {t('The agent can be wrong: check the numbers in the Lastfind screens.', 'O agente pode errar: confira os números nas telas do Lastfind.')}
      </p>
    </div>
  );
  const artifactPane = artifactId && (!examples || examples.artifacts[artifactId]) ? (
    <AgentArtifactView
      key={artifactId}
      fixture={examples?.artifacts[artifactId]}
      refresh={artifactVersion}
      id={artifactId}
      canEdit={canEdit}
      onClose={() => openArtifact(null)}
      expanded={artifactFull}
      onExpand={wide ? setArtifactFull : undefined}
      agentWork={writing}
      onSelection={setSelection}
      t={t}
    />
  ) : null;
  const sideArtifact = wide && !!artifactPane;
  const shellLayout = useDefaultLayout({
    id: 'lastfind-agent-shell',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    panelIds: ['agent-thread', ...(sideArtifact ? ['agent-artifact'] : [])],
  });
  const listLabel = (
    <>
      <MessagesSquare aria-hidden="true" />
      {t('Conversations', 'Conversas')}
      <Kbd aria-hidden="true" className="agent-chat-bar-kbd">{shortcut}</Kbd>
    </>
  );
  const listButton = { variant: 'ghost', 'aria-keyshortcuts': 'Meta+K Control+K' } as const;

  return (
    <AgentBrandsContext.Provider value={brands ?? null}>
    <div className="agent-shell" data-artifact={sideArtifact ? (artifactFull ? 'full' : 'side') : undefined}>
      {/* The chat and the artifact share the width: the person drags (or moves with the arrow keys) the line between them,
          and the sizes are kept on this device. Phones show the chat alone (the artifact in a sheet). */}
      <ResizablePanelGroup className="agent-shell-panels" defaultLayout={shellLayout.defaultLayout} onLayoutChanged={shellLayout.onLayoutChanged}>
        <ResizablePanel id="agent-thread" data-pane="thread" minSize="360px">
          <section className="agent-thread" aria-label={active?.title || t('New conversation', 'Nova conversa')}>
            {/* One bar at every width: the app navigation, the conversations (closed until asked for), this one's title, a new one. */}
            <DetailHeader
              className="static agent-chat-bar"
              leading={
                <>
                  <SidebarTrigger aria-label={t('Toggle navigation', 'Alternar navegação')} />
                  <span className="topbar-divider" />
                  {popover ? (
                    <Popover open={listOpen} onOpenChange={setListOpen}>
                      {/* Hover intent: the pointer resting 150ms on the button opens them (Base UI's `delay` is a rest time:
                          each move restarts it, so a pass across the page never opens them), without taking the focus from
                          the message box; leaving, a safe path into the list and 300ms of grace keep them open. A click, a
                          tap, Enter and ⌘K open them as before. */}
                      <PopoverTrigger ref={listTrigger} openOnHover delay={150} closeDelay={300} render={<Button {...listButton} />}>
                        {listLabel}
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="agent-conversations-popover"
                        aria-label={t('Conversations', 'Conversas')}
                        initialFocus={(type) => type === 'touch' || document.querySelector<HTMLElement>('.agent-conversations-popover .agent-conversations-top input')}
                        finalFocus={listTrigger}
                      >
                        {list}
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <Button ref={listTrigger} {...listButton} aria-expanded={listOpen} onClick={() => setListOpen(true)}>
                      {listLabel}
                    </Button>
                  )}
                </>
              }
              title={
                active?.title && !demo ? (
                  <EditableTitle
                    key={`${active.id}:${active.title}`}
                    title={active.title}
                    canEdit
                    onRename={(next) => rename(active, next)}
                    label={t('Conversation title', 'Título da conversa')}
                    maxLength={80}
                    t={t}
                  />
                ) : (
                  <h1>{active?.title || t('New conversation', 'Nova conversa')}</h1>
                )
              }
              actions={
                <>
                  {askWindow && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const back: AskReturn = { type: ASK_WINDOW, project: projectId, conversation: activeId };
                        window.opener?.postMessage(back, window.location.origin);
                        window.close();
                      }}
                    >
                      {t('Back to the panel', 'Voltar ao painel')}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => select(null)}>
                    {t('New', 'Nova')}
                  </Button>
                </>
              }
            />
            {examples ? (
              <DemoThread key={shown} messages={examples.messages[shown]} welcome={welcome} wide={wide} artifactId={artifactId} onOpenArtifact={openArtifact} t={t} />
            ) : threads.map((id) => (
              <ThreadBoundary key={id} t={t}>
                <LiveThread
                  id={id}
                  blank={id === blankId}
                  onStart={start}
                  onWarm={id === blankId ? () => newConversation(projectId, undefined, blankId) : undefined}
                  welcome={welcome}
                  hidden={id !== shown}
                  opening={id === activeId ? opening : null}
                  body={body}
                  draft={draft}
                  setDraft={setDraft}
                  files={files}
                  setFiles={setFiles}
                  limited={limited}
                  wide={wide}
                  artifactId={artifactId}
                  onOpenArtifact={openArtifact}
                  onArtifact={onArtifact}
                  onTurnEnd={loadList}
                  onWriting={setWriting}
                  onBusy={markBusy}
                  quote={quote}
                  inputRef={input}
                  t={t}
                />
              </ThreadBoundary>
            ))}
            {limited && (
              <Note status className="agent-limit">
                {usage?.unit === 'credits'
                  ? t('Your account used all its AI credits this month. They renew with the next period.', 'Sua conta usou todos os créditos de IA do mês. Eles renovam no próximo período.')
                  : usage?.limit === 0
                    ? t('The agent is off for this project: its monthly budget is 0 in Settings > Monitoring > Budget.', 'O agente está desligado neste projeto: o orçamento mensal é 0 em Configurações > Monitoramento > Orçamento.')
                    : t('This project reached its monthly agent limit. It renews on the 1st.', 'Este projeto atingiu o limite mensal do agente. Ele renova no dia 1.')}
              </Note>
            )}
          </section>
        </ResizablePanel>
        {sideArtifact && <ResizableHandle aria-label={t('Resize the artifact', 'Redimensionar o artefato')} />}
        {sideArtifact && (
          <ResizablePanel id="agent-artifact" data-pane="artifact" defaultSize="50%" minSize="360px">
            <aside className="agent-shell-artifact">{artifactPane}</aside>
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
      {!wide && (
        <Sheet open={!!artifactPane} onOpenChange={(open) => !open && openArtifact(null)}>
          <SheetContent side="right" className="agent-sheet" showCloseButton={false}>
            <SheetHeader className="sr-only">
              <SheetTitle>{t('Artifact', 'Artefato')}</SheetTitle>
              <SheetDescription>{t('The document the agent wrote.', 'O documento que o agente escreveu.')}</SheetDescription>
            </SheetHeader>
            {artifactPane}
          </SheetContent>
        </Sheet>
      )}
      {!popover && (
        <Sheet open={listOpen} onOpenChange={setListOpen}>
          <SheetContent ref={listSheet} side="bottom" className="agent-sheet-list" initialFocus={listSheet} finalFocus={listTrigger}>
            <SheetHeader>
              <SheetTitle>{t('Conversations', 'Conversas')}</SheetTitle>
              <SheetDescription className="sr-only">{t('Your conversations about this project.', 'Suas conversas sobre este projeto.')}</SheetDescription>
            </SheetHeader>
            {list}
          </SheetContent>
        </Sheet>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('Delete this conversation?', 'Excluir esta conversa?')}
        description={t('It leaves your list. The artifacts it wrote stay in Artifacts.', 'Ela sai da sua lista. Os artefatos que ela escreveu continuam em Artefatos.')}
        cancelLabel={t('Cancel', 'Cancelar')}
        confirmLabel={t('Delete', 'Excluir')}
        destructive
        onConfirm={() => {
          const item = deleting;
          setDeleting(null);
          if (item) void remove(item);
        }}
      />
    </div>
    </AgentBrandsContext.Provider>
  );
}

/** A conversation that could not be opened (its messages did not load): says so, with a retry. */
class ThreadBoundary extends Component<{ children: ReactNode; t: T }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    const { t } = this.props;
    if (!this.state.failed) return this.props.children;
    return (
      <div className="agent-thread-body">
        <EmptyState
          frame="bare"
          tone="error"
          title={t('Could not open this conversation', 'Não foi possível abrir esta conversa')}
          description={t('Check your connection and try again.', 'Verifique sua conexão e tente de novo.')}
          onRetry={() => this.setState({ failed: false })}
        />
      </div>
    );
  }
}

// ---------------------------------------------------------------- Ask Lastfind

/** The questions any screen can take (12/11/2026, after Ahrefs' "Ask Ahrefs"). */
const ASK_GENERAL: [string, string][] = [
  ['Summarize what matters on this page', 'Resuma o que importa nesta página'],
  ['Explain these metrics in plain language', 'Explique estas métricas em linguagem simples'],
  ['What should I do next?', 'O que devo fazer agora?'],
  ['Compare my brand with competitors', 'Compare minha marca com os concorrentes'],
  ['Surface risks or opportunities I am missing', 'Aponte riscos ou oportunidades que estou perdendo'],
];
/** The questions of a screen (its tab), asked first. */
const ASK_SCREEN: Record<string, [string, string][]> = {
  overview: [['What changed in this period?', 'O que mudou neste período?']],
  prompts: [
    ['Which prompts mention my brand the least?', 'Em quais prompts minha marca aparece menos?'],
    ['Suggest new prompts to monitor', 'Sugira novos prompts para monitorar'],
  ],
  topics: [['Which topics am I losing?', 'Em quais temas estou perdendo?']],
  responses: [
    ['Summarize what these answers say about my brand', 'Resuma o que estas respostas dizem sobre minha marca'],
    ['Find the negative mentions', 'Encontre as menções negativas'],
  ],
  fanout: [
    ['Which searches should I create content for?', 'Para quais buscas devo criar conteúdo?'],
    ['Explain what Query Fan Out shows', 'Explique o que o Query Fan Out mostra'],
  ],
  sources: [
    ['Which sources cite competitors but not my brand?', 'Quais fontes citam concorrentes e não a minha marca?'],
    ['Which domains weigh most in AI answers?', 'Quais domínios mais pesam nas respostas das IAs?'],
  ],
  products: [
    ['Which products do AIs recommend most?', 'Quais produtos as IAs mais recomendam?'],
    ['Compare my products with competitors', 'Compare meus produtos com os dos concorrentes'],
  ],
  'ai-bots': [
    ['Which AI bots visit my site the most?', 'Quais bots de IA mais visitam meu site?'],
    ['Which pages do AI bots read?', 'Quais páginas os bots de IA leem?'],
  ],
  competitors: [
    ['Which competitors are gaining visibility?', 'Quais concorrentes estão ganhando visibilidade?'],
    ['Compare my brand with the leader', 'Compare minha marca com a líder'],
  ],
  models: [
    ['Which AI mentions my brand the most?', 'Qual IA mais menciona minha marca?'],
    ['On which AI am I weakest, and why?', 'Em qual IA estou mais fraco, e por quê?'],
  ],
  'semantic-branding': [
    ['How do AIs describe my brand?', 'Como as IAs descrevem minha marca?'],
    ['On which attributes do competitors beat me?', 'Em quais atributos os concorrentes me superam?'],
  ],
  opportunities: [['Which opportunity should I start with?', 'Por qual oportunidade devo começar?']],
  settings: [
    ['Explain these settings', 'Explique estas configurações'],
    ['What else should I monitor?', 'O que mais devo monitorar?'],
  ],
};
/** Five questions about the screen: its own first, then the general ones. */
export const askSuggestions = (screen: string) => {
  const seen = new Set<string>();
  return [...(ASK_SCREEN[screen] ?? []), ...ASK_GENERAL].filter(([en]) => !seen.has(en) && !!seen.add(en)).slice(0, 5);
};

/** Agent > Chat on a conversation (and the artifact beside it), from the project's address: what the panel's new window opens. */
const chatAddress = (projectHref: string, conversation: string | null, artifact?: string) => {
  const query = new URLSearchParams({ ...(conversation ? { conversation } : {}), ...(artifact ? { artifact } : {}) });
  return `${projectHref}/agent${query.size ? `?${query}` : ''}`;
};

/**
 * Ask Lastfind's bar (shell.md section 4, one header height): the name and Beta, then New chat (with its plus), History
 * when there is one, and the panel's states, each icon the state it leads to: Pin to the side (`PanelRight`, the right
 * sidebar) or, pinned, Unpin (`PictureInPicture2`, the card in the corner); Open in a new window (`ExternalLink`, as every
 * "new window" of the app); Close (`X`, back to the button alone).
 */
export function AskPanelBar({
  title,
  mode,
  history,
  onNew,
  onHistory,
  onAction,
  fullHref,
  t,
}: {
  /** The panel's title element (a SheetTitle inside the panel). */
  title: ReactNode;
  mode: AskMode;
  history?: boolean;
  onNew: () => void;
  onHistory?: () => void;
  onAction: (action: 'dock' | 'float' | 'popout' | 'close') => void;
  /** Agent > Chat on this conversation: what the new window opens. */
  fullHref: string;
  t: T;
}) {
  const icon = (label: string, glyph: ReactNode, onClick: () => void) => (
    <Hint text={label}>
      <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
        {glyph}
      </Button>
    </Hint>
  );
  const docked = mode === 'docked';
  return (
    <DetailHeader
      className="static agent-ask-bar"
      title={
        <>
          {title}
          <TagBadge tone="primary">Beta</TagBadge>
        </>
      }
      actions={
        <>
          <Button variant="ghost" onClick={onNew} aria-label={t('New chat', 'Novo chat')}>
            <Plus aria-hidden="true" />
            <span className="agent-ask-new">{t('New chat', 'Novo chat')}</span>
          </Button>
          {/* Icons past New chat, as Ahrefs' bar: the name and Beta keep their width in a 400px panel. */}
          {onHistory && (
            <Hint text={t('History', 'Histórico')}>
              <Button variant="ghost" size="icon" aria-label={t('History', 'Histórico')} aria-pressed={!!history} onClick={onHistory}>
                <History />
              </Button>
            </Hint>
          )}
          {docked
            ? icon(t('Unpin from the side', 'Soltar da lateral'), <PictureInPicture2 />, () => morphAskPanel(() => onAction('float'), flushSync))
            : icon(t('Pin to the side', 'Fixar na lateral'), <PanelRight />, () => morphAskPanel(() => onAction('dock'), flushSync))}
          {icon(t('Open in a new window', 'Abrir em nova janela'), <ExternalLink />, () => popOutAsk(fullHref) && onAction('popout'))}
          {icon(t('Close', 'Fechar'), <X />, () => onAction('close'))}
        </>
      }
    />
  );
}

/** The empty panel, as Ahrefs' (12/11/2026): what it can use, then five quiet rows of questions about the screen. */
export function AskWelcome({ screen, disabled, onPick, t }: { screen: string; disabled?: boolean; onPick: (text: string) => void; t: T }) {
  return (
    <div className="agent-artifact-chat-welcome agent-ask-welcome">
      <p className="text-body">{t("Hi! I can use the page you're on and your workspace to answer questions.", 'Olá! Posso usar a página em que você está e o seu workspace para responder.')}</p>
      <p className="text-body text-muted-foreground">{t('Here are a few ideas to get started:', 'Algumas ideias para começar:')}</p>
      <ItemGroup className="agent-suggestions agent-ask-ideas">
        {askSuggestions(screen).map(([en, pt]) => (
          <Item key={en} size="xs" render={<button type="button" aria-label={t(en, pt)} disabled={disabled} onClick={() => onPick(t(en, pt))} />}>
            <ItemMedia variant="icon">
              <ChevronRight aria-hidden="true" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t(en, pt)}</ItemTitle>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}

/** The popped-out window coming back (its "Back to the panel"): the tab that opened it opens its panel again. */
function useAskReturn(onReturn: (back: AskReturn) => void) {
  const latest = useRef(onReturn);
  useEffect(() => {
    latest.current = onReturn;
  });
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.origin === window.location.origin && isAskReturn(event.data)) latest.current(event.data);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);
}

/**
 * Ask Lastfind's panel, the one way the agent opens over a screen (the app's screens and an artifact's page alike): floating
 * at the bottom right, or docked as the right sidebar, where the page narrows for it (lib/ask-panel.ts). From 768px the page
 * stays usable beside it; on a phone it is a sheet over a dimmed page (docked: the whole height). Esc and Close close it and
 * the focus goes back to what opened it; closed, it stays mounted, so its conversation and an answer under way go on.
 */
export function AskPanel({
  open,
  onOpenChange,
  mode,
  trigger,
  initialFocus,
  finalFocus,
  description,
  bar,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: AskMode;
  /** A SheetTrigger (the floating button), when the panel has one. */
  trigger?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  finalFocus?: RefObject<HTMLElement | null>;
  description: string;
  bar: ReactNode;
  children: ReactNode;
}) {
  const roomy = useWide('(min-width: 768px)');
  const floating = !!trigger;
  const docked = open && mode === 'docked';
  // The page makes room for the panel through <body>'s attributes (agent.css), never `body:has(...)`: a :has() on <body> made
  // every change anywhere on the page restyle all of it, and a chart measures each axis label that way (13/11/2026: a
  // 2 to 3 s freeze on every screen with a chart).
  useLayoutEffect(() => {
    const body = document.body;
    body.toggleAttribute('data-ask-floating', floating);
    body.toggleAttribute('data-ask-docked', docked);
    return () => {
      body.removeAttribute('data-ask-floating');
      body.removeAttribute('data-ask-docked');
    };
  }, [floating, docked]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={!roomy} disablePointerDismissal={roomy}>
      {trigger}
      <SheetContent side="right" keepMounted overlay={!roomy} showCloseButton={false} className="agent-ask" data-mode={mode} initialFocus={initialFocus} finalFocus={finalFocus}>
        {bar}
        <SheetDescription className="sr-only">{description}</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Ask Lastfind: the agent over every screen of the app (12/11/2026, after Ahrefs' "Ask Ahrefs"). A button at the bottom
 * right opens Agent > Chat's own conversations in AskPanel: the same conversations, model, limits and history, plus the
 * screen behind it as "this page" (its address, with its period, filters and the item open there; lib/agent.ts readPage).
 * Its state (open, floating or docked) is the tab's and survives the app's navigation (lib/ask-panel.ts).
 */
export function AskLastfind({
  projectId,
  projectHref,
  brands,
  period,
  screen,
  title,
  onExpand,
}: {
  projectId: string;
  /** The project's address (`/app/<workspace>/<project>`, app-routes.ts): the panel's new window opens under it. */
  projectHref: string;
  brands: AgentBrands;
  period: { days: string; start?: string; end?: string };
  /** The screen behind it (the app's tab): its questions. */
  screen: string;
  /** The screen's own name and the item open on it, as the top bar shows them. */
  title: string;
  /** Agent > Chat with this conversation and an artifact of it open (an artifact card in the panel). */
  onExpand: (conversation: string | null, artifact?: string) => void;
}) {
  const t = useCopy();
  const { locale } = useI18n();
  const panel = useSyncExternalStore(subscribeAskPanel, askPanelState, () => ASK_PANEL_INITIAL);
  const [id, setId] = useState<string | null>(null);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [history, setHistory] = useState(false);
  const [list, setList] = useState<{ conversations: ConversationSummary[]; loading: boolean; failure: string | null }>(() => ({
    conversations: conversationLists.get(projectId)?.conversations ?? [],
    loading: !conversationLists.has(projectId),
    failure: null,
  }));
  const [listRead, setListRead] = useState(0);
  const usage = useAgentUsage(projectId);
  const input = useRef<HTMLTextAreaElement>(null);
  const limited = usage?.limit != null && usage.used >= usage.limit;
  useEffect(() => {
    if (!history) return;
    let current = true;
    readConversations(projectId).then(
      (data) => current && setList({ conversations: data.conversations, loading: false, failure: null }),
      (cause) => current && setList((state) => ({ ...state, loading: false, failure: cause instanceof Error ? cause.message : String(cause) })),
    );
    return () => {
      current = false;
    };
  }, [history, projectId, listRead]);
  // The address of the screen behind the panel when a message goes (the page re-renders this on every move).
  const body: TurnBody = {
    locale,
    period: period.start && period.end ? { start: period.start, end: period.end } : { days: Number(period.days) || 28 },
    page: { path: typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}`, title },
  };
  const focusBox = () => window.setTimeout(() => input.current?.focus(), 0);
  const start = (text: string, attached: AgentFile[]) => {
    if (!text && !attached.length) return;
    setDraft('');
    setFiles([]);
    setOpening({ text, files: attached });
    setId(newConversation(projectId));
  };
  const show = (next: string | null) => {
    setHistory(false);
    setOpening(null);
    setId(next);
    focusBox();
  };
  // Back from its own window: the panel opens again here, on the conversation the window had (if it is this project's).
  useAskReturn((back) => {
    if (back.project === projectId) show(back.conversation);
    dispatchAskPanel('open');
  });
  return (
    <AskPanel
      open={panel.open}
      onOpenChange={(open) => dispatchAskPanel(open ? 'open' : 'close')}
      mode={panel.mode}
      trigger={
        <SheetTrigger render={<Button variant="ink" className="agent-ask-cta" data-floating="" />}>
          <navIcons.agent aria-hidden="true" />
          <span className="max-sm:sr-only">Ask Lastfind</span>
        </SheetTrigger>
      }
      initialFocus={input}
      description={t('The agent, about the screen behind this panel and your project.', 'O agente, sobre a tela por trás deste painel e o seu projeto.')}
      bar={
        <AskPanelBar
          title={<SheetTitle>Ask Lastfind</SheetTitle>}
          mode={panel.mode}
          history={history}
          onNew={() => show(null)}
          onHistory={() => setHistory((value) => !value)}
          onAction={dispatchAskPanel}
          fullHref={chatAddress(projectHref, id)}
          t={t}
        />
      }
    >
      {history ? (
        <div className="agent-ask-history">
          <ConversationList
            conversations={list.conversations}
            loading={list.loading}
            failure={list.failure}
            activeId={id}
            answering={new Set()}
            unread={new Set()}
            onSelect={show}
            onRetry={() => setListRead((value) => value + 1)}
            t={t}
          />
        </div>
      ) : (
        <AgentBrandsContext.Provider value={brands}>
          <section className="agent-thread agent-artifact-chat agent-ask-chat" aria-label="Ask Lastfind">
            {id ? (
              <ThreadBoundary key={id} t={t}>
                <LiveThread
                  id={id}
                  opening={opening}
                  body={body}
                  draft={draft}
                  setDraft={setDraft}
                  files={files}
                  setFiles={setFiles}
                  limited={limited}
                  wide={false}
                  artifactId={null}
                  onOpenArtifact={(artifact) => {
                    if (!artifact) return;
                    dispatchAskPanel('close');
                    onExpand(id, artifact);
                  }}
                  onArtifact={() => {}}
                  onTurnEnd={() => {}}
                  onWriting={() => {}}
                  inputRef={input}
                  t={t}
                />
              </ThreadBoundary>
            ) : (
              <>
                <div className="agent-thread-body">
                  <AskWelcome screen={screen} disabled={limited} onPick={(text) => start(text, [])} t={t} />
                </div>
                <footer className="agent-thread-footer">
                  <ComposerFor
                    draft={draft}
                    setDraft={setDraft}
                    files={files}
                    setFiles={setFiles}
                    onSend={() => start(draft.trim(), files)}
                    onStop={() => {}}
                    streaming={false}
                    disabled={limited}
                    placeholder={t('Ask about this page or your project', 'Pergunte sobre esta página ou o seu projeto')}
                    inputRef={input}
                    t={t}
                  />
                </footer>
              </>
            )}
          </section>
        </AgentBrandsContext.Provider>
      )}
    </AskPanel>
  );
}

// ---------------------------------------------------------------- Agent > Artifacts

type ArtifactRow = ArtifactSummary & { conversation_id: string | null; created_at: string; shared: boolean };

/**
 * Agent > Artifacts (reports, tables, briefs) and Agent > Contents (articles, pages, posts): the same list of the project's
 * artifacts, by kind; one opens in place of the list, on its page.
 */
export function AgentArtifacts({
  projectId,
  canEdit,
  onOpenConversation,
  scope = 'artifacts',
  action,
}: {
  projectId: string;
  canEdit: boolean;
  onOpenConversation: (id: string) => void;
  scope?: 'artifacts' | 'contents';
  /** The screen's action (Create content), in the toolbar and the empty state; Agent > Artifacts has its own, New artifact. */
  action?: ReactNode;
}) {
  const t = useCopy();
  const { dateTime } = useDates();
  const [rows, setRows] = useState<ArtifactRow[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => readParam('artifact'));
  const [deleting, setDeleting] = useState<ArtifactRow | null>(null);
  const [search, setSearch] = useState('');
  const [generation, setGeneration] = useState(0);
  const load = () => {
    setFailure(null);
    setGeneration((value) => value + 1);
  };
  useEffect(() => {
    let current = true;
    requestJson<{ artifacts: ArtifactRow[] }>(`/api/agent/artifacts?project=${encodeURIComponent(projectId)}`).then(
      (data) => current && setRows(data.artifacts.filter((row) => (row.kind === 'content') === (scope === 'contents'))),
      (cause) => current && setFailure(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      current = false;
    };
  }, [projectId, generation, scope]);
  // Opening one is a step in the browser's history: Back returns to the list.
  const open = (id: string | null) => {
    setOpenId(id);
    writeParam('artifact', id, !!id);
  };
  useEffect(() => {
    const onPop = () => setOpenId(readParam('artifact'));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const remove = async (row: ArtifactRow) => {
    await requestJson(`/api/agent/artifacts/${encodeURIComponent(row.id)}`, 'DELETE').catch((cause) => setFailure(cause instanceof Error ? cause.message : String(cause)));
    if (openId === row.id) open(null);
    load();
  };
  const [creating, setCreating] = useState(false);
  const [createFailure, setCreateFailure] = useState<string | null>(null);
  // A blank artifact, opened at once in its editor (the title in place to rename); the chat beside it writes it on request.
  const create = async () => {
    setCreating(true);
    setCreateFailure(null);
    try {
      const made = await requestJson<{ artifact: { id: string } }>('/api/agent/artifacts', 'POST', { project: projectId, title: t('Untitled', 'Sem título') });
      open(made.artifact.id);
    } catch (cause) {
      setCreateFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };
  const toolbarAction =
    action ??
    (scope === 'artifacts' && canEdit ? (
      <Button disabled={creating} onClick={() => void create()}>
        {creating && <Spinner />}
        {t('New artifact', 'Novo artefato')}
      </Button>
    ) : undefined);
  const createNote = createFailure && (
    <Note tone="danger">
      {createFailure}
    </Note>
  );
  // An artifact opens in place of the list, in the main content, with a way back.
  if (openId)
    return (
      <div className="agent-artifacts" data-open="">
        <AgentArtifactView
          key={openId}
          id={openId}
          canEdit={canEdit}
          place="page"
          onClose={() => {
            open(null);
            load();
          }}
          onDelete={() => {
            open(null);
            load();
          }}
          t={t}
        />
      </div>
    );
  const dialog = (
    <DeleteArtifactDialog
      open={!!deleting}
      onOpenChange={(value) => !value && setDeleting(null)}
      onConfirm={() => {
        const row = deleting;
        setDeleting(null);
        if (row) void remove(row);
      }}
      t={t}
    />
  );
  const label = scope === 'contents' ? t('Contents', 'Conteúdos') : t('Artifacts', 'Artefatos');
  const query = search.trim().toLocaleLowerCase();
  const shown = rows && query ? rows.filter((row) => row.title.toLocaleLowerCase().includes(query)) : rows;
  if (failure && !rows)
    return (
      <EmptyState
        tone="error"
        title={scope === 'contents' ? t('Could not load the contents', 'Não foi possível carregar os conteúdos') : t('Could not load the artifacts', 'Não foi possível carregar os artefatos')}
        description={failure}
        onRetry={load}
      />
    );
  if (rows && !rows.length)
    return (
      <EmptyState
        title={scope === 'contents' ? t('No content yet', 'Nenhum conteúdo ainda') : t('No artifacts yet', 'Nenhum artefato ainda')}
        description={
          scope === 'contents'
            ? t('Articles, pages and posts written with the agent stay here, for everyone in the workspace.', 'Artigos, páginas e posts escritos com o agente ficam aqui, para todo o workspace.')
            : t('Ask the agent for a report, a table or a content brief, or start one yourself: they stay here, for everyone in the workspace.', 'Peça ao agente um relatório, uma tabela ou um brief de conteúdo, ou comece um você mesmo: eles ficam aqui, para todo o workspace.')
        }
        action={
          toolbarAction && (
            <div className="grid justify-items-center gap-3">
              {toolbarAction}
              {createNote}
            </div>
          )
        }
      />
    );
  // The list as Brands lists its brands: the whole width, a search, the table filling the screen; while it loads, the same
  // screen with its rows drawn as skeletons.
  return (
      <DataTableScreen className="agent-artifacts-list">
        <DataTableToolbar label={t('Search', 'Busca')} actions={toolbarAction}>
          <SearchField value={search} onChange={setSearch} placeholder={scope === 'contents' ? t('Search contents', 'Buscar conteúdos') : t('Search artifacts', 'Buscar artefatos')} />
        </DataTableToolbar>
        {createNote}
        <DataTable
          fill
          singleLine
          lines="rows"
          loading={!shown}
          ariaLabel={label}
          rows={shown ?? []}
          rowKey={(row) => row.id}
          rowState={(row) => (row.id === openId ? 'selected' : undefined)}
          // The whole row opens it, as the app's other tables do (a new tab with the modifier keys).
          rowLink={(row) => ({
            href: `?artifact=${encodeURIComponent(row.id)}`,
            onClick: (event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              open(row.id);
            },
          })}
          defaultSort={{ key: 'updated', direction: 'desc' }}
          caption={!shown || shown.length ? undefined : t('Nothing matches this search.', 'Nada corresponde a esta busca.')}
          columns={[
            {
              key: 'title',
              header: scope === 'contents' ? t('Content', 'Conteúdo') : t('Artifact', 'Artefato'),
              mobile: 'title',
              shrinkTo: '12rem',
              width: '28rem',
              sortValue: (row) => row.title,
              cell: (row) => (
                <span className="agent-artifact-open">
                  <ArtifactIcon kind={row.kind} size="sm" />
                  <span className="truncate">{row.title}</span>
                </span>
              ),
            },
            ...(scope === 'contents' ? [] : [{ key: 'kind', header: t('Type', 'Tipo'), label: t('Type', 'Tipo'), sortValue: (row: ArtifactRow) => kindLabel(row.kind, t), cell: (row: ArtifactRow) => kindLabel(row.kind, t) }]),
            { key: 'updated', header: t('Updated', 'Atualizado em'), label: t('Updated', 'Atualizado em'), sortValue: (row) => row.updated_at, cellClassName: 'tabular-nums', cell: (row) => dateTime(row.updated_at) },
            {
              key: 'access',
              header: t('Access', 'Acesso'),
              label: t('Access', 'Acesso'),
              // One component for every value, so the column reads at one size.
              cell: (row) => <TagBadge tone={row.shared ? 'primary' : 'muted'}>{row.shared ? t('Public link', 'Link público') : t('Workspace', 'Workspace')}</TagBadge>,
            },
            {
              key: 'actions',
              header: <span className="sr-only">{t('Actions', 'Ações')}</span>,
              align: 'end',
              mobile: 'actions',
              cell: (row) => {
                const newWindow = t(`Open ${row.title} in a new window`, `Abrir ${row.title} em nova janela`);
                return (
                  <div className="flex items-center justify-end">
                    <Hint text={t('Open in a new window', 'Abrir em nova janela')}>
                      <Button variant="ghost" size="icon-xs" nativeButton={false} aria-label={newWindow} render={<a href={`/artifact/${encodeURIComponent(row.id)}`} target="_blank" rel="noopener" aria-label={newWindow} />}>
                        <ExternalLink />
                      </Button>
                    </Hint>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t(`Actions for ${row.title}`, `Ações de ${row.title}`)} />}>
                        <EllipsisVertical />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => open(row.id)}>
                          <ArrowUpRight aria-hidden="true" />
                          {t('Open', 'Abrir')}
                        </DropdownMenuItem>
                        {row.conversation_id && (
                          <DropdownMenuItem onClick={() => onOpenConversation(row.conversation_id!)}>
                            <MessagesSquare aria-hidden="true" />
                            {t('Open its conversation', 'Abrir a conversa')}
                          </DropdownMenuItem>
                        )}
                        {canEdit && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(row)}>
                              <Trash2 aria-hidden="true" />
                              {t('Delete', 'Excluir')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              },
            },
          ]}
        />
        {dialog}
      </DataTableScreen>
    );
}

/** Agent where the account has none (the public demo, or a plan without it). */
export function AgentUnavailable() {
  const t = useCopy();
  return (
    <EmptyState
      icon={navIcons.agent}
      title={t('The agent works with your own project', 'O agente trabalha com o seu próprio projeto')}
      description={t(
        'Chat with your project data, get reports you can share and make changes with your approval. Every Cloud plan includes it, and so does your own installation.',
        'Converse com os dados do projeto, receba relatórios para compartilhar e faça alterações com a sua aprovação. Todo plano do Cloud inclui o agente, e a sua própria instalação também.',
      )}
    />
  );
}

const noSubscription = () => () => {};

/** A document cut at its second-level headings (outside code blocks), for the page's sections sidebar. */
export function documentSections(markdown: string) {
  const sections: { title: string; text: string }[] = [{ title: '', text: '' }];
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) sections.push({ title: heading[1].replace(/[*_`]/g, ''), text: '' });
    sections.at(-1)!.text += `${line}\n`;
  }
  return sections.filter((section) => section.title || section.text.trim());
}

/**
 * A shared artifact's public page (`/shared/<token>`): the app's detail page without the app, the logo at its head with
 * the title and when it was last edited, the document at reading width and its sections in the second sidebar on the
 * right (the content's tabs place), each leading to its heading.
 */
export function AgentSharedArtifact({ artifact }: { artifact: { title: string; kind: string; content: string; live?: boolean; updated_at: string } }) {
  const t = useCopy();
  const { locale } = useI18n();
  const sections = useMemo(() => documentSections(withoutTitle(artifact.content, artifact.title)), [artifact.content, artifact.title]);
  const headings = sections.flatMap((section, index) => (section.title ? [{ id: `section-${index}`, label: section.title }] : []));
  const [active, setActive] = useState(headings[0]?.id ?? '');
  // Read from the browser's clock and calendar once on screen (the server's would differ).
  const onScreen = useSyncExternalStore(noSubscription, () => true, () => false);
  const edited = onScreen ? editedAt(artifact.updated_at, locale, false) : null;
  return (
    <DetailPage className="agent-shared">
      <DetailHeader
        leading={<LastfindLogo className="h-6 w-auto" />}
        title={
          <Hint text={edited ? `${artifact.title}\n${edited.full}` : artifact.title}>
            <h1 className="agent-artifact-title">{artifact.title}</h1>
          </Hint>
        }
        meta={
          edited && (
            <Hint text={`${edited.full}. ${t('Shared from Lastfind', 'Compartilhado pelo Lastfind')}${artifact.live ? `, ${t('live data', 'dados ao vivo')}` : ''}`}>
              <button type="button" className="agent-edited">
                <time dateTime={artifact.updated_at}>{edited.caption}</time>
              </button>
            </Hint>
          )
        }
      />
      <div className="agent-artifact-docs">
        <div className="agent-artifact-scroll">
          <DetailBody>
            <ArtifactLiveContext.Provider value={!!artifact.live}>
              {sections.map((section, index) => (
                <section key={index} id={`section-${index}`} className="agent-shared-section" aria-label={section.title || undefined}>
                  <AgentMarkdown document text={section.text} />
                </section>
              ))}
            </ArtifactLiveContext.Provider>
          </DetailBody>
        </div>
        {headings.length > 0 && (
          <TabsRail
            label={t('On this page', 'Nesta página')}
            items={headings}
            value={active}
            onChange={(id) => {
              setActive(id);
              document.getElementById(id)?.scrollIntoView({ behavior: glide(), block: 'start' });
            }}
            t={t}
          />
        )}
      </div>
    </DetailPage>
  );
}
