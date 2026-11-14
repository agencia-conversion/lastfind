// The in-app agent (Agent > Chat and Artifacts): what the screen and the server share. Pure: the limits, the default
// model, the messages of the conversation's agent as the screen shows them, and the charts and figures of an answer.
import type { LanguageModelUsage, ModelMessage, UserModelMessage } from 'ai';
import { readLiveBlock, type LiveBlock, type LiveRow } from './agent-blocks';
import type { ContentOverview } from './content-overview';
import type { LearnedChange } from './agent-learning';

/** The default model (Admin > Classifiers, function Agent, replaces it). */
export const AGENT_MODEL = 'openai/gpt-6-luna';
/** What each model call holds before it is sent: a turn raises its reserve call by call, under the project's budget. */
export const AGENT_CALL_RESERVE_USD = 0.02;
/** One answer never spends more than this (model calls and search data together). */
export const AGENT_TURN_MAX_USD = 1;
/** Model calls in one turn (each may run several tools): enough for research that reads, compares and writes. */
export const AGENT_MAX_STEPS = 20;
export const AGENT_TEXT_MAX = 4000;
/**
 * Files in one message: at most 4, each a data URL the screen made (lib/agent-files.ts): an image it shrank, a PDF as it
 * is, or the text it read from any other file.
 */
export const AGENT_FILES_MAX = 4;
export const AGENT_IMAGE_CHARS_MAX = 700_000;
export const AGENT_PDF_BYTES_MAX = 5_000_000;
/** The largest file the screen reads for its text, and how much of that text the agent takes (about 15 thousand words). */
export const AGENT_FILE_BYTES_MAX = 20_000_000;
export const AGENT_FILE_CHARS_MAX = 100_000;
export type AgentFile = { url: string; mediaType: string; name?: string };
/**
 * What an artifact is: a document (any writing, the general kind), a report on the project's data, a table, a content brief,
 * or a piece of content, the marketing text to publish (an article, a landing page), the only one with outline, research and
 * overview beside its text.
 */
export const ARTIFACT_KINDS = ['document', 'report', 'table', 'brief', 'content'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
/** The kind an artifact gets when nobody named one: the general document. */
export const DEFAULT_ARTIFACT_KIND: ArtifactKind = 'document';

export type ArtifactSummary = { id: string; title: string; kind: ArtifactKind; updated_at: string };
export type Artifact = ArtifactSummary & {
  project_id: string;
  conversation_id: string | null;
  content: string;
  created_at: string;
  /** The public link's token, while the artifact is shared. */
  share_token: string | null;
  /** Bumped by every write: the editor sends back the one it loaded, and a write against an older one is refused. */
  version: number;
  /** Its data blocks follow the project's data (live) or keep the figures they were written with. */
  live: boolean;
  /** Who wrote it last: `agent`, or the account's id. */
  updated_by: string | null;
  /** A file of the project's Brain (what the team taught the agent): renamed, never shared. */
  brain?: boolean;
  /** The Brain's Memory file (what the agent kept from the members' conversations): never deleted, members only. */
  memory?: boolean;
  /** A content's other tabs, beside its text: the outline and the research it was written from (Markdown). */
  outline?: string;
  research?: string;
  /** A content's Overview: its publication fields and the comparison with Google's top 3 (lib/content-overview.ts). */
  overview?: ContentOverview;
};
export const ARTIFACT_PARTS = ['outline', 'research'] as const;
/** The most an artifact holds (data blocks keep the figures they show). */
export const ARTIFACT_CHARS_MAX = 300_000;
/** `running`: an answer is still under way (in any tab, or none: the agent finishes it on its own). */
export type ConversationSummary = { id: string; title: string; pinned: boolean; created_at: string; updated_at: string; running?: boolean };
/** Cloud: the account's credits this period (null limit: Unlimited). Independent edition: the project's agent spend in US$. */
export type AgentUsage = { unit: 'credits' | 'usd'; used: number; limit: number | null };
/** The live connection's message with the month's use, sent after every model call and every answer (worker/agent.ts). */
export const USAGE_MESSAGE = 'lastfind_agent_usage';
/**
 * One model call's tokens for the server log (Admin's tail of the Worker, never the person): the input and the part of it
 * read from the provider's prompt cache (and written to it), the output and its reasoning, and the cost the reply reported.
 * A field the provider did not report is null, never a zero.
 */
export function stepUsage(step: { stepNumber: number; model?: { modelId?: string }; usage?: Partial<LanguageModelUsage>; finishReason?: string; toolCalls?: readonly unknown[] }, cost: unknown) {
  const usage = step.usage;
  const input = usage?.inputTokens ?? null;
  const cached = usage?.inputTokenDetails?.cacheReadTokens ?? null;
  return {
    step: step.stepNumber,
    model: step.model?.modelId ?? null,
    input,
    cached,
    cache_written: usage?.inputTokenDetails?.cacheWriteTokens ?? null,
    cached_share: input && cached !== null ? Math.round((cached / input) * 100) / 100 : null,
    output: usage?.outputTokens ?? null,
    reasoning: usage?.outputTokenDetails?.reasoningTokens ?? null,
    cost: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
    finish: step.finishReason ?? null,
    tool_calls: step.toolCalls?.length ?? 0,
  };
}
/** A short message: at most this many characters and words (a greeting, a thanks, a yes). */
const QUICK_CHARS = 40;
const QUICK_WORDS = 6;
/**
 * The latest message is short and has nothing attached: the turn's first model call reasons little, so the answer starts at
 * once (ARCHITECTURE.md, the agent's context); a call after a tool's result reasons as usual.
 */
export function quickMessage(messages: readonly { role: string; parts: readonly { type: string; text?: string }[] }[]) {
  const last = messages.findLast((message) => message.role === 'user');
  if (!last || last.parts.some((part) => part.type === 'file')) return false;
  const text = last.parts.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join(' ').trim();
  return text.length > 0 && text.length <= QUICK_CHARS && text.split(/\s+/).length <= QUICK_WORDS;
}
/** The latest message is the conversation's first question. */
export const firstQuestion = (messages: readonly { role: string }[]) => messages.filter((message) => message.role === 'user').length === 1;
/** The tool that gives a quick first call every other tool from its next call (worker/agent.ts); the chat shows no step for it. */
export const MORE_TOOLS = 'more_tools';
/**
 * A new conversation's quick first call (its first question is short) offers only these tools, so its first words come
 * sooner (about 0.35 s of 1.3 s, ARCHITECTURE.md); the call after any tool's result offers them all.
 */
export const FIRST_CALL_TOOLS = ['get_overview', 'compare_brands', 'get_sentiment', 'list_sources', 'compare_ai_models', 'list_prompts', 'read_brain', 'activate_skill', 'recall_conversations', 'list_artifacts', MORE_TOOLS];

/**
 * Each screen of the app (its `tab`), as the agent reads it: its name and the tools that answer what it shows. Ask Lastfind
 * sends the screen open behind it, so "this page" is that screen; a quick first call also offers that screen's tools.
 */
export const SCREEN_TOOLS: Record<string, { name: string; tools: string[] }> = {
  overview: { name: 'Overview', tools: ['get_overview', 'get_sentiment', 'list_sources', 'get_source_types', 'get_query_fanout', 'list_discovered_brands'] },
  prompts: { name: 'Prompts (one prompt when the address names it)', tools: ['list_prompts', 'get_prompt', 'get_sentiment'] },
  topics: { name: 'Topics', tools: ['get_project', 'compare_ai_models'] },
  responses: { name: 'Responses (one answer when the address names its run)', tools: ['list_responses', 'get_response'] },
  fanout: { name: 'Query Fan Out', tools: ['get_query_fanout'] },
  sources: { name: 'Sources (one domain or page when the address names it)', tools: ['list_sources', 'get_source', 'get_source_types'] },
  products: { name: 'Shopping, the product cards (one product or brand when the address names it)', tools: ['get_products'] },
  'ai-bots': { name: 'Traffic, AI bots and the visits AI answers send', tools: ['get_ai_bots'] },
  comparison: { name: 'Comparison (a sub-page when the address names it: products, attributes, personas)', tools: ['get_comparison'] },
  competitors: { name: 'Brands (one brand when the address names it)', tools: ['compare_brands', 'list_discovered_brands', 'get_sentiment', 'list_responses'] },
  models: { name: 'AI models', tools: ['compare_ai_models'] },
  'semantic-branding': { name: 'Semantic Branding', tools: ['get_semantic_branding', 'get_semantic_evidence', 'list_sources'] },
  opportunities: { name: 'Opportunities', tools: ['list_opportunities'] },
  settings: { name: 'Settings', tools: ['get_project'] },
  contents: { name: 'Contents', tools: ['list_artifacts', 'read_artifact'] },
  artifacts: { name: 'Artifacts', tools: ['list_artifacts', 'read_artifact'] },
  brain: { name: 'Brain', tools: ['read_brain'] },
  skills: { name: 'Skills', tools: [] },
};
/** The screen Ask Lastfind was opened on: its tab, its address (the app's own, `/app/...`) and what it reads, and its title. */
export type AskPage = { screen: string; path: string; state: string; title: string };
// eslint-disable-next-line no-control-regex
const PAGE_CONTROL = /[\u0000-\u001F\u007F]+/g;
/**
 * The page a message was sent from (`{ path, title }`, what the browser sent), checked: an app address that names a screen of
 * SCREEN_TOOLS, its state in the app's long form (`expand`: app-routes.ts expandAppPath with the edition's shape, passed in so
 * this stays pure), the workspace and the project left out (the conversation's own). Anything else is no page.
 */
export function readPage(value: unknown, expand: (segments: string[], search: URLSearchParams) => URLSearchParams | null): AskPage | null {
  const input = (value && typeof value === 'object' ? value : {}) as { path?: unknown; title?: unknown };
  if (typeof input.path !== 'string' || input.path.length > 1000 || !/^\/app(?:[/?]|$)/.test(input.path)) return null;
  const url = new URL(input.path, 'https://app.invalid');
  const long = expand(url.pathname.split('/').slice(2), url.searchParams);
  const screen = long?.get('tab') ?? '';
  if (!long || !Object.hasOwn(SCREEN_TOOLS, screen)) return null;
  long.delete('tab');
  long.delete('project');
  long.delete('workspace');
  const state = [...long].slice(0, 20).map(([key, item]) => `${key}=${item.replace(PAGE_CONTROL, ' ').slice(0, 200)}`).join(', ');
  const title = typeof input.title === 'string' ? input.title.replace(PAGE_CONTROL, ' ').trim().slice(0, 200) : '';
  return { screen, path: `${url.pathname}${url.search}`, state, title };
}
export type ToolState = 'running' | 'done' | 'error' | 'declined';
/**
 * `artifactId`: the artifact a write is changing (the editor holds still while the agent writes it). `input` and `output`:
 * what it asked and what came back, for the trace's summary and its inspector (lib/agent-steps.ts). `skill`: the one activated.
 * `ms`: how long it ran, when known beforehand (the catalog's examples); otherwise the trace times what this tab saw.
 */
export type ToolStep = { id: string; name: string; state: ToolState; artifactId?: string; input?: unknown; output?: unknown; skill?: string; ms?: number };
/** A change waiting for approval; `labels` names the prompts and topics its ids point at (the server reads them). */
export type PendingCall = { id: string; name: string; args: Record<string, unknown>; labels?: Record<string, string> };
/** The tools that change data (the MCP's writes): each waits for approval. */
export const CHANGE_TOOLS = new Set(['create_prompts', 'update_prompt', 'set_prompt_status', 'organize_prompts', 'create_topic', 'update_topic', 'delete_topic', 'decide_brand']);

export type MessageView =
  | { id: string; role: 'user'; text: string; files?: AgentFile[] }
  | { id: string; role: 'assistant'; text: string; tools: ToolStep[]; artifacts: ArtifactSummary[]; pending: PendingCall[]; stopped?: 'spend'; rating?: 1 | -1; changes?: LearnedChange[] };

/** A message of the conversation's agent as the AI SDK carries it (only what the screen reads). */
export type UiPart = { type: string; text?: string; url?: string; mediaType?: string; filename?: string; toolCallId?: string; toolName?: string; state?: string; input?: unknown; output?: unknown };
export type UiMessage = { id: string; role: string; parts: readonly UiPart[]; metadata?: unknown };

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/**
 * A change parked for the person's approval: Think's durable-pause output names its execution (the decision's id).
 * Anything else a change returned is its result.
 */
export function parkedExecution(output: unknown) {
  const value = record(output);
  const id = value.executionId ?? record(value.descriptor).executionId;
  return typeof id === 'string' && !('error' in value) && !('result' in value) && /pend|park|paus|await|wait/i.test(String(value.status ?? value.state ?? value.type ?? 'pending')) ? id : null;
}

/** One message as the screen shows it: a question with its files, or an answer with its steps, artifacts and waiting changes. */
export function viewOf(message: UiMessage): MessageView {
  if (message.role === 'user') {
    const files = message.parts.flatMap((part) => (part.type === 'file' && part.url && part.mediaType ? [{ url: part.url, mediaType: part.mediaType, ...(part.filename ? { name: part.filename } : {}) }] : []));
    return { id: message.id, role: 'user', text: userQuestion([message]), ...(files.length ? { files } : {}) };
  }
  const view: Extract<MessageView, { role: 'assistant' }> = { id: message.id, role: 'assistant', text: '', tools: [], artifacts: [], pending: [] };
  for (const part of message.parts) {
    if (part.type === 'text' && part.text) view.text += (view.text && !view.text.endsWith('\n') ? '\n\n' : '') + part.text;
    const name = part.type === 'dynamic-tool' ? part.toolName : part.type.startsWith('tool-') ? part.type.slice(5) : null;
    if (!name || !part.toolCallId || name === MORE_TOOLS) continue;
    const output = record(part.output);
    const parked = part.state === 'output-available' ? parkedExecution(part.output) : null;
    if (parked) {
      view.pending.push({ id: parked, name, args: record(part.input) });
      continue;
    }
    const error = record(output.error);
    const state: ToolState =
      part.state === 'output-denied' || output.status === 'rejected' || error.code === 'declined' || /declined/i.test(String(error.message ?? ''))
        ? 'declined'
        : part.state === 'output-error' || (part.state === 'output-available' && 'error' in output)
          ? 'error'
          : part.state === 'output-available'
            ? 'done'
            : 'running';
    const target = record(part.input).id;
    const skill = name === 'activate_skill' ? record(part.input).name : null;
    view.tools.push({
      id: part.toolCallId,
      name,
      state,
      ...(['patch_artifact', 'edit_artifact', 'update_artifact'].includes(name) && typeof target === 'string' ? { artifactId: target } : {}),
      ...(typeof skill === 'string' ? { skill } : {}),
      input: part.input,
      output: part.output,
    });
    const artifact = record(output.artifact);
    if (typeof artifact.id === 'string') view.artifacts = [...view.artifacts.filter((item) => item.id !== artifact.id), artifact as ArtifactSummary];
    // A change to the Brain, the Memory or a skill: its note under the answer, with Undo.
    const changed = record(output.changed);
    if (typeof changed.id === 'string' && typeof changed.version === 'number') view.changes = [...(view.changes ?? []), changed as LearnedChange];
  }
  if (record(message.metadata).stopped === 'spend') view.stopped = 'spend';
  return view;
}

/**
 * One answer per question: the agent's messages after a question read as one (a change the person approved continues
 * the answer in a message of its own). It keeps the last message's id, which ratings name.
 */
export function oneAnswerPerQuestion(views: MessageView[]): MessageView[] {
  const out: MessageView[] = [];
  for (const view of views) {
    const previous = out.at(-1);
    if (view.role !== 'assistant' || previous?.role !== 'assistant') {
      out.push(view);
      continue;
    }
    out[out.length - 1] = {
      ...view,
      text: [previous.text, view.text].filter(Boolean).join('\n\n'),
      tools: [...previous.tools, ...view.tools],
      artifacts: [...previous.artifacts.filter((item) => !view.artifacts.some((other) => other.id === item.id)), ...view.artifacts],
      pending: view.pending,
      ...(previous.changes || view.changes ? { changes: [...(previous.changes ?? []), ...(view.changes ?? [])] } : {}),
    };
  }
  return out;
}

/** Lastfind's copy never uses the middle dot as a separator: what the model writes gets a comma instead. */
export const tidy = (text: string) =>
  text
    .replace(/[ \t]*\u00b7[ \t]*/g, ', ')
    // The app shows an artifact as a card: a line that only links to it goes; a link to it inside a sentence keeps its words.
    .replace(/^[ \t]*\[[^\]\n]+\]\([^)\n]*artifact[^)\n]*\)[ \t]*$\n?/gim, '')
    .replace(/\[([^\]\n]+)\]\([^)\n]*artifact=[^)\n]*\)/gi, '$1')
    // A heading never uses a vertical bar as a separator either (a table row is not a heading).
    .replace(/^(#{1,6} .*)$/gm, (line) => line.replace(/\s+\|\s+/g, ': '));

/** A conversation's title from its first message: one line, at most 60 characters. */
/** The text of a conversation's first question (AI SDK UI messages), which names it. */
export function userQuestion(messages: readonly { role: string; parts: readonly { type: string; text?: string }[] }[]) {
  const first = messages.find((message) => message.role === 'user');
  return (first?.parts ?? []).map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join(' ').trim();
}

/** A data URL's bytes as UTF-8 text, or null. */
function dataText(url: string) {
  const match = /^data:[^,]*;base64,([\s\S]*)$/.exec(url);
  if (!match) return null;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

/**
 * The person's files as the model reads them: an image or a PDF as it is, the text the screen read from any other file
 * as text under the file's name. Anything else, or over its size, is left out (the screen sends only these, so it came
 * from elsewhere).
 */
export function readableFiles(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) =>
    message.role !== 'user' || typeof message.content === 'string'
      ? message
      : {
          ...message,
          content: message.content.flatMap((part): Exclude<UserModelMessage['content'], string> => {
            if (part.type !== 'file') return [part];
            const data = part.data as unknown;
            const url = data instanceof URL ? data.href : typeof data === 'string' ? data : data && typeof data === 'object' && 'url' in data ? String((data as { url: unknown }).url) : '';
            if (/^image\/(?:png|jpeg|webp|gif)$/.test(part.mediaType)) return url.length <= AGENT_IMAGE_CHARS_MAX ? [part] : [];
            if (part.mediaType === 'application/pdf') return url.length <= Math.ceil(AGENT_PDF_BYTES_MAX / 3) * 4 + 64 ? [part] : [];
            const text = part.mediaType === 'text/plain' ? dataText(url) : null;
            if (text === null) return [];
            const cut = text.length >= AGENT_FILE_CHARS_MAX ? `\n\n[The file goes on: only its first ${AGENT_FILE_CHARS_MAX} characters were attached.]` : '';
            return [{ type: 'text' as const, text: `Attached file ${JSON.stringify(part.filename ?? 'file')}:\n\n${text.slice(0, AGENT_FILE_CHARS_MAX)}${cut}` }];
          }),
        },
  );
}

/** The headings of a Markdown document (levels 1 to 3, outside fenced blocks), with the line each starts on. */
export function outline(markdown: string) {
  const headings: { line: number; level: number; text: string }[] = [];
  let fenced = false;
  markdown.split('\n').forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) {
      const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
      if (match) headings.push({ line: index, level: match[1].length, text: match[2] });
    }
  });
  return headings;
}

/** A document's sections by its second-level headings, as [heading, text]; what comes before the first goes in it. */
export function splitSections(markdown: string) {
  const lines = markdown.split('\n');
  const heads = outline(markdown).filter((heading) => heading.level === 2);
  const before = lines.slice(0, heads[0]?.line ?? 0).join('\n').trim();
  return heads.map((heading, index) => {
    const text = lines.slice(heading.line + 1, heads[index + 1]?.line ?? lines.length).join('\n').trim();
    return [heading.text, index === 0 && before ? `${before}\n\n${text}`.trim() : text];
  });
}

export type PatchMode = 'replace' | 'insert_before' | 'insert_after' | 'delete' | 'append';

/**
 * The lines [start, end) of a section: a heading and its body up to the next heading of the same or a higher level (the
 * document's title, a level-1 heading, only to the next heading: its intro, never the whole text), or a fenced data
 * block by its `id`. Null when there is none.
 */
export function sectionSpan(markdown: string, section: string | undefined): [number, number] | null {
  const lines = markdown.split('\n');
  const headings = outline(markdown);
  const key = (section ?? '').replace(/^#+\s*/, '').trim().toLowerCase();
  const heading = headings.find((item) => item.text.trim().toLowerCase() === key);
  if (heading) {
    const next = headings.find((item) => item.line > heading.line && (heading.level === 1 || item.level <= heading.level));
    return [heading.line, next ? next.line : lines.length];
  }
  for (let at = 0, open = -1; at < lines.length; at++) {
    if (!/^\s*(?:```|~~~)/.test(lines[at])) continue;
    if (open < 0) open = at;
    else {
      try {
        if (key && String(JSON.parse(lines.slice(open + 1, at).join('\n'))?.id ?? '').toLowerCase() === key) return [open, at + 1];
      } catch {
        // Not a data block.
      }
      open = -1;
    }
  }
  return null;
}

/** One change to a document by section (`sectionSpan`); `append` adds at the end. A section it cannot find gives back the headings there are. */
export function patchSection(markdown: string, change: { mode: PatchMode; section?: string; content?: string }): { markdown: string } | { headings: string[] } {
  const body = (change.content ?? '').trim();
  if (change.mode === 'append') return { markdown: `${markdown.trimEnd()}\n\n${body}\n` };
  const span = sectionSpan(markdown, change.section);
  if (!span) return { headings: outline(markdown).map((item) => item.text) };
  const lines = markdown.split('\n');
  const [start, end] = span;
  const added = body ? [...body.split('\n'), ''] : [];
  const next =
    change.mode === 'replace'
      ? [...lines.slice(0, start), ...added, ...lines.slice(end)]
      : change.mode === 'delete'
        ? [...lines.slice(0, start), ...lines.slice(end)]
        : change.mode === 'insert_before'
          ? [...lines.slice(0, start), ...added, ...lines.slice(start)]
          : [...lines.slice(0, end), '', ...added, ...lines.slice(end)];
  return { markdown: `${next.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n` };
}

/**
 * A targeted edit, as a file edit tool makes one: `old`, text found exactly once in the document, becomes `new` (empty
 * deletes it). `{ count }` when it is not found once (0, or how many times), for the model to quote more or read again.
 */
export function editText(markdown: string, old: string, next: string): { markdown: string } | { count: number } {
  const count = old ? markdown.split(old).length - 1 : 0;
  if (count !== 1) return { count };
  const at = markdown.indexOf(old);
  return { markdown: `${(markdown.slice(0, at) + next + markdown.slice(at + old.length)).replace(/\n{3,}/g, '\n\n').trim()}\n` };
}

/**
 * A fact added to a section of the Brain as one more bullet (the section's italic hint, never filled in, gives way to
 * it); a section it does not have is added at the end.
 */
export function addToSection(markdown: string, section: string, text: string) {
  const fact = `- ${text.replace(/\s+/g, ' ').trim()}`;
  const lines = markdown.split('\n');
  const headings = outline(markdown);
  const key = section.replace(/^#+\s*/, '').trim().toLowerCase();
  const heading = headings.find((item) => item.text.trim().toLowerCase() === key);
  if (!heading) return `${markdown.trimEnd()}\n\n## ${section.replace(/^#+\s*/, '').trim()}\n\n${fact}\n`;
  const next = headings.find((item) => item.line > heading.line && item.level <= heading.level);
  const end = next ? next.line : lines.length;
  const body = lines.slice(heading.line + 1, end).filter((line) => !/^_[^_].*_$/.test(line.trim()));
  while (body.length && !body.at(-1)!.trim()) body.pop();
  const kept = body.some((line) => line.trim()) ? [...body, fact] : ['', fact];
  return `${[...lines.slice(0, heading.line + 1), ...kept, '', ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function conversationTitle(text: string) {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

/**
 * The call that names a new conversation (8/11/2026): a few words from its first question, by the agent's own model,
 * with a tiny answer. Until it lands (or when it fails) the conversation keeps the question cut short (conversationTitle).
 */
export const TITLE_MAX_TOKENS = 48;
/** What a title call counts when it reports no cost or fails after it was sent (it may have been billed). */
export const TITLE_RESERVE_USD = 0.002;
export function titleRequest(question: string, locale: string) {
  const system = locale === 'pt-BR'
    ? 'Escreva um título de 2 a 6 palavras para a conversa que começa com a mensagem do usuário, na mesma língua da mensagem. Diga o assunto de forma direta, sem aspas, sem ponto final, sem emoji e sem separadores. Responda só o título.'
    : "Write a title of 2 to 6 words for the conversation that starts with the user's message, in the same language as the message. Name its subject plainly, no quotes, no final period, no emoji and no separators. Answer with the title only.";
  return { system, prompt: question.replace(/\s+/g, ' ').trim().slice(0, 1000), maxOutputTokens: TITLE_MAX_TOKENS };
}
/** The model's answer as a title: its first line, without quotes, marks, separators or a final period; null when nothing is left. */
export function generatedTitle(text: string) {
  const line = (text.split('\n').find((each) => each.trim()) ?? '')
    .replace(/^\s*(?:title|título)\s*:\s*/i, '')
    .replace(/[*_#`"“”‘’«»]/g, '')
    .replace(/\s*[\u00b7\u2022|]\s*/g, ' ')
    .replace(/[.。]+\s*$/, '');
  const title = conversationTitle(line.replace(/^['\s]+|['\s]+$/g, ''));
  return title.length >= 2 ? title : null;
}

/**
 * What each tool does, the trace's verbs: while it runs (a gerund, "Searching the web") and once it ran (the past,
 * "Searched the web"), and (a change) as the action the person approves. Every tool the agent can call has its pair
 * (guard: tests/agent-states.test.mjs).
 */
type ToolLabel = { running: [string, string]; done: [string, string]; action?: [string, string] };
export const TOOL_LABELS: Record<string, ToolLabel> = {
  list_projects: { running: ['Listing projects', 'Listando projetos'], done: ['Listed the projects', 'Listou os projetos'] },
  get_project: { running: ['Reading the project', 'Lendo o projeto'], done: ['Read the project', 'Leu o projeto'] },
  get_overview: { running: ['Reading the overview', 'Lendo a visão geral'], done: ['Read the overview', 'Leu a visão geral'] },
  list_prompts: { running: ['Reading prompts', 'Lendo prompts'], done: ['Read the prompts', 'Leu os prompts'] },
  get_prompt: { running: ['Reading a prompt', 'Lendo um prompt'], done: ['Read a prompt', 'Leu um prompt'] },
  list_responses: { running: ['Reading answers', 'Lendo respostas'], done: ['Read answers', 'Leu respostas'] },
  get_response: { running: ['Reading an answer', 'Lendo uma resposta'], done: ['Read an answer', 'Leu uma resposta'] },
  compare_brands: { running: ['Comparing brands', 'Comparando marcas'], done: ['Compared brands', 'Comparou marcas'] },
  list_discovered_brands: { running: ['Reading discovered brands', 'Lendo marcas descobertas'], done: ['Read discovered brands', 'Leu marcas descobertas'] },
  get_sentiment: { running: ['Reading sentiment', 'Lendo o sentimento'], done: ['Read the sentiment', 'Leu o sentimento'] },
  list_sources: { running: ['Reading sources', 'Lendo fontes'], done: ['Read sources', 'Leu fontes'] },
  get_source_types: { running: ['Reading source types', 'Lendo tipos de fonte'], done: ['Read source types', 'Leu tipos de fonte'] },
  get_source: { running: ['Reading a source', 'Lendo uma fonte'], done: ['Read a source', 'Leu uma fonte'] },
  compare_ai_models: { running: ['Comparing AI models', 'Comparando modelos de IA'], done: ['Compared AI models', 'Comparou modelos de IA'] },
  get_query_fanout: { running: ['Reading Query Fan Out', 'Lendo o Query Fan Out'], done: ['Read Query Fan Out', 'Leu o Query Fan Out'] },
  list_opportunities: { running: ['Reading the opportunities', 'Lendo as oportunidades'], done: ['Read the opportunities', 'Leu as oportunidades'] },
  get_semantic_branding: { running: ['Reading Semantic Branding', 'Lendo o Semantic Branding'], done: ['Read Semantic Branding', 'Leu o Semantic Branding'] },
  get_semantic_evidence: { running: ['Reading Semantic Branding evidence', 'Lendo evidências do Semantic Branding'], done: ['Read Semantic Branding evidence', 'Leu evidências do Semantic Branding'] },
  get_products: { running: ['Reading the products', 'Lendo os produtos'], done: ['Read the products', 'Leu os produtos'] },
  get_ai_bots: { running: ['Reading AI bots', 'Lendo os bots de IA'], done: ['Read AI bots', 'Leu os bots de IA'] },
  get_comparison: { running: ['Reading Comparison', 'Lendo a Comparação'], done: ['Read Comparison', 'Leu a Comparação'] },
  create_prompts: { running: ['Creating prompts', 'Criando prompts'], done: ['Created prompts', 'Criou prompts'], action: ['Create prompts', 'Criar prompts'] },
  update_prompt: { running: ['Editing a prompt', 'Editando um prompt'], done: ['Edited a prompt', 'Editou um prompt'], action: ['Edit a prompt', 'Editar um prompt'] },
  set_prompt_status: { running: ['Changing prompt status', 'Mudando o status de prompts'], done: ['Changed prompt status', 'Mudou o status de prompts'], action: ['Change prompt status', 'Mudar o status de prompts'] },
  organize_prompts: { running: ['Organizing prompts', 'Organizando prompts'], done: ['Organized prompts', 'Organizou prompts'], action: ['Organize prompts', 'Organizar prompts'] },
  create_topic: { running: ['Creating a topic', 'Criando um tópico'], done: ['Created a topic', 'Criou um tópico'], action: ['Create a topic', 'Criar um tópico'] },
  update_topic: { running: ['Renaming a topic', 'Renomeando um tópico'], done: ['Renamed a topic', 'Renomeou um tópico'], action: ['Rename a topic', 'Renomear um tópico'] },
  delete_topic: { running: ['Deleting a topic', 'Excluindo um tópico'], done: ['Deleted a topic', 'Excluiu um tópico'], action: ['Delete a topic', 'Excluir um tópico'] },
  decide_brand: { running: ['Deciding a brand', 'Decidindo uma marca'], done: ['Decided a brand', 'Decidiu uma marca'], action: ['Decide a brand', 'Decidir uma marca'] },
  create_artifact: { running: ['Writing an artifact', 'Escrevendo um artefato'], done: ['Wrote an artifact', 'Escreveu um artefato'] },
  remember: { running: ['Keeping it', 'Guardando'], done: ['Kept it', 'Guardou'] },
  forget: { running: ['Removing a note', 'Removendo uma nota'], done: ['Removed a note', 'Removeu uma nota'] },
  improve_skill: { running: ['Improving the skill', 'Melhorando a skill'], done: ['Improved the skill', 'Melhorou a skill'], action: ['Change a skill', 'Alterar uma skill'] },
  recall_conversations: { running: ['Looking for earlier conversations', 'Procurando conversas anteriores'], done: ['Looked for earlier conversations', 'Procurou conversas anteriores'] },
  update_artifact: { running: ['Updating an artifact', 'Atualizando um artefato'], done: ['Updated an artifact', 'Atualizou um artefato'] },
  patch_artifact: { running: ['Editing the artifact', 'Editando o artefato'], done: ['Edited the artifact', 'Editou o artefato'] },
  edit_artifact: { running: ['Editing the artifact', 'Editando o artefato'], done: ['Edited the artifact', 'Editou o artefato'] },
  list_artifacts: { running: ['Listing artifacts', 'Listando artefatos'], done: ['Listed artifacts', 'Listou artefatos'] },
  read_artifact: { running: ['Reading an artifact', 'Lendo um artefato'], done: ['Read an artifact', 'Leu um artefato'] },
  read_brain: { running: ['Consulting the Brain', 'Consultando o Cérebro'], done: ['Consulted the Brain', 'Consultou o Cérebro'] },
  read_guide: { running: ['Reading the steps', 'Lendo o passo a passo'], done: ['Read the steps', 'Leu o passo a passo'] },
  set_content_overview: { running: ['Comparing with the top 3', 'Comparando com os 3 primeiros'], done: ['Compared with the top 3', 'Comparou com os 3 primeiros'] },
  search_results: { running: ['Searching the web', 'Pesquisando na web'], done: ['Searched the web', 'Pesquisou na web'] },
  keyword_volume: { running: ['Reading search volumes', 'Lendo volumes de busca'], done: ['Read search volumes', 'Leu volumes de busca'] },
  keyword_ideas: { running: ['Finding keyword ideas', 'Buscando ideias de palavras-chave'], done: ['Found keyword ideas', 'Buscou ideias de palavras-chave'] },
  ranked_keywords: { running: ['Reading ranked keywords', 'Lendo palavras-chave ranqueadas'], done: ['Read ranked keywords', 'Leu palavras-chave ranqueadas'] },
  competing_domains: { running: ['Finding competing domains', 'Buscando domínios concorrentes'], done: ['Found competing domains', 'Buscou domínios concorrentes'] },
  backlinks: { running: ['Reading backlinks', 'Lendo backlinks'], done: ['Read backlinks', 'Leu backlinks'] },
  read_page: { running: ['Reading a page', 'Lendo uma página'], done: ['Read a page', 'Leu uma página'] },
  page_audit: { running: ['Checking a page', 'Verificando uma página'], done: ['Checked a page', 'Verificou uma página'] },
  activate_skill: { running: ['Opening a skill', 'Abrindo uma skill'], done: ['Opened a skill', 'Abriu uma skill'] },
  read_skill_resource: { running: ['Reading a method guide', 'Lendo um guia do método'], done: ['Read a method guide', 'Leu um guia do método'] },
};

/** A change that removes or rejects something: the approval says so (the rest are routine). */
export function destructiveChange(call: { name: string; args: Record<string, unknown> }) {
  return (
    call.name === 'delete_topic' ||
    (call.name === 'set_prompt_status' && call.args.status === 'archive') ||
    (call.name === 'decide_brand' && (call.args.action === 'reject' || call.args.action === 'merge'))
  );
}

/** An artifact's content as shown under its own title: a leading heading (the title again) is left out. */
/** The content without a first heading that repeats the artifact's title (the screen shows the title above it). */
export const withoutTitle = (content: string, title: string) => {
  const first = /^\s*#{1,2} ([^\n]*)\n*/.exec(content);
  const same = (text: string) => text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return first && same(first[1]) === same(title) ? content.slice(first[0].length) : content;
};

// ---------------------------------------------------------------- charts and key figures in an answer or an artifact

/** A chart the agent writes as a fenced `chart` block (JSON): drawn with the app's own chart components. */
export type ChartSpec = {
  type: 'line' | 'bar' | 'donut';
  title: string;
  unit: string;
  series: { key: string; label: string }[];
  data: Record<string, string | number | null>[];
};
/** Key figures, a fenced `metrics` block (JSON array): the app's metric cards. */
export type MetricSpec = { label: string; value: string; note?: string; delta?: string };
export type Block =
  | { kind: 'markdown'; text: string }
  | { kind: 'chart'; chart: ChartSpec }
  | { kind: 'metrics'; metrics: MetricSpec[] }
  /** A data block bound to the project (lib/agent-blocks.ts). */
  | { kind: 'live'; block: LiveBlock }
  /** A block still arriving (the answer is streaming). */
  | { kind: 'pending'; lang: 'chart' | 'metrics' | 'live' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const short = (value: unknown, max: number) => (typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null);

/** A valid chart, or null (the block is then shown as it was written). */
export function readChart(value: unknown): ChartSpec | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const type = input.type === 'line' || input.type === 'bar' || input.type === 'donut' ? input.type : null;
  const rows = Array.isArray(input.data) ? input.data.filter((row) => row && typeof row === 'object') : [];
  if (!type || !rows.length || rows.length > 200) return null;
  const data = rows.map((row) => row as Record<string, unknown>);
  if (data.some((row) => !short(row.x, 80))) return null;
  const series =
    type === 'donut'
      ? [{ key: 'value', label: short(input.title, 120) ?? 'value' }]
      : (Array.isArray(input.series) ? input.series : []).flatMap((item) => {
          const key = short((item as Record<string, unknown>)?.key, 40);
          const label = short((item as Record<string, unknown>)?.label, 60);
          return key && label && key !== 'x' ? [{ key, label }] : [];
        });
  if (!series.length || series.length > 8 || (type === 'donut' && data.length > 12)) return null;
  // A line runs over days; anything else reads better as bars.
  const shape = type === 'line' && !data.every((row) => DAY.test(String(row.x))) ? 'bar' : type;
  const numeric = (row: Record<string, unknown>, key: string) => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : null);
  if (!data.some((row) => series.some((item) => numeric(row, item.key) !== null))) return null;
  return {
    type: shape,
    title: short(input.title, 120) ?? '',
    unit: typeof input.unit === 'string' && input.unit.length <= 6 ? input.unit : '',
    series,
    data: data.map((row) => Object.fromEntries([['x', String(row.x).trim()], ...series.map((item) => [item.key, numeric(row, item.key)])])),
  };
}

/**
 * A data block's figures (lib/agent-blocks.ts `report`) as the chart its shape draws, by readChart's rules (a line over
 * days, a donut of up to 12 shares, up to 8 series), or null when they cannot be drawn so.
 */
export function liveChart(block: LiveBlock, rows: LiveRow[], title: string, name = (label: string) => label): ChartSpec | null {
  const labels = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => key !== 'x')))];
  const series = labels.map((label, index) => ({ key: `s${index + 1}`, label: name(label) }));
  const data = rows.map((row) => ({ x: row.x, ...Object.fromEntries(labels.map((label, index) => [`s${index + 1}`, row[label]])), value: labels[0] ? row[labels[0]] : null }));
  return readChart({ type: block.shape, title, unit: block.unit ?? '', series, data });
}

/** Valid key figures (1 to 4), or null. */
export function readMetrics(value: unknown): MetricSpec[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 4) return null;
  const metrics = value.map((item) => {
    const input = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const label = short(input.label, 60);
    const figure = short(input.value, 24);
    const delta = short(input.delta, 16);
    const note = short(input.note, 40);
    return label && figure ? { label, value: figure, ...(note ? { note } : {}), ...(delta ? { delta } : {}) } : null;
  });
  return metrics.every(Boolean) ? (metrics as MetricSpec[]) : null;
}

/** An answer split into Markdown and the chart and metrics blocks it holds (an invalid block stays Markdown). */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```(chart|metrics|live)[^\n]*\n([\s\S]*?)(```|$)/g;
  let last = 0;
  for (const match of text.matchAll(fence)) {
    const start = match.index ?? 0;
    if (start > last) blocks.push({ kind: 'markdown', text: text.slice(last, start) });
    last = start + match[0].length;
    const lang = match[1] as 'chart' | 'metrics' | 'live';
    if (!match[3]) {
      blocks.push({ kind: 'pending', lang });
      continue;
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(match[2]);
    } catch {
      /* Shown as written. */
    }
    const chart = lang === 'chart' ? readChart(parsed) : null;
    const metrics = lang === 'metrics' ? readMetrics(parsed) : null;
    const live = lang === 'live' ? readLiveBlock(parsed) : null;
    blocks.push(chart ? { kind: 'chart', chart } : metrics ? { kind: 'metrics', metrics } : live ? { kind: 'live', block: live } : { kind: 'markdown', text: match[0] });
  }
  if (last < text.length) blocks.push({ kind: 'markdown', text: text.slice(last) });
  return blocks.filter((block) => block.kind !== 'markdown' || block.text.trim());
}
