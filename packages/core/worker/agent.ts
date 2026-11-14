// The agent of one conversation (both editions): a Think agent (Cloudflare Agents SDK) in its own Durable Object, named
// by the conversation id. It keeps the conversation's messages, streams each answer to every open tab, resumes an answer
// a deploy or an eviction cut short, and runs Lastfind's tools as the conversation's author. The Worker lets a
// connection in only with a ticket for that conversation (worker/index.ts); each turn re-reads the author, reserves its
// money before every call and closes its ledger row when it ends (lib/server/agent.ts). A change to the project's data is
// a durable-pause action: the turn ends there, and the change runs only once the person approves it. What the agent
// learns (the Brain, the Memory, the workspace's skills) it changes at once, quoting the person, with a version to undo;
// a change to a skill in a turn that read third-party content waits for the person's approval, as a data change does.
import { Think, action, type ChatResponseResult, type ChunkContext, type PrepareStepContext, type TurnConfig, type TurnContext, type StepContext } from '@cloudflare/think';
import { generateText, tool, wrapLanguageModel, type ModelMessage, type ToolSet } from 'ai';
import { chainedChatModel, servedCost, type ReasoningEffort } from '../lib/server/model-chat';
import type { Route } from '../lib/server/model-routes';
import { recordModelCall } from '../lib/server/model-tally';
import * as z from 'zod';
import { genericObservability } from 'agents/observability';
import { AGENT_CALL_RESERVE_USD, AGENT_MAX_STEPS, ARTIFACT_CHARS_MAX, ARTIFACT_KINDS, DEFAULT_ARTIFACT_KIND, FIRST_CALL_TOOLS, MORE_TOOLS, SCREEN_TOOLS, USAGE_MESSAGE, firstQuestion, quickMessage, readableFiles, stepUsage, userQuestion } from '../lib/agent';
import { loadPlatformSettings } from '../lib/server/platform-settings';
import { ApiError } from '../lib/server/http';
import { localizeApiError } from '../lib/server/errors-i18n';
import { neutralModelErrors } from '../lib/server/model-errors';
import {
  agentMcpTools,
  CONTENT_OVERVIEW_INPUT,
  closeTurn,
  forgetInBrain,
  foreignChange,
  holdTurn,
  learnerOf,
  nameConversation,
  listProjectArtifacts,
  openTurn,
  editArtifact,
  patchArtifact,
  readBrain,
  readProjectArtifact,
  recallConversations,
  rememberInBrain,
  runMcpTool,
  saveArtifact,
  setContentOverview,
  spendTurn,
  systemPrompt,
  turnUsage,
  readGuide,
  GUIDES,
  type GuideName,
  type AgentTurn,
} from '../lib/server/agent';
import { agentDataTools } from '../lib/server/agent-data';
import { conversationReads, type ReadMessage } from '../lib/content-overview';
import { patchSkill, recordSkillUses, workspaceSkills } from '../lib/server/agent-skills';
import { QUOTE_MAX, SKILL_STANDARD, seen } from '../lib/agent-learning';
import type { Json } from '../lib/server/mcp-tools';

/** Think's workspace file tools: the agent keeps its documents as artifacts instead. */
const WORKSPACE_TOOLS = new Set(['read', 'ls', 'find', 'grep', 'write', 'edit', 'delete', 'exec']);
/** What a viewer's turn cannot do: write artifacts, and change the Brain, the Memory or a skill. */
const MEMBER_TOOLS = ['read_guide', 'create_artifact', 'update_artifact', 'patch_artifact', 'edit_artifact', 'set_content_overview', 'remember', 'forget', 'improve_skill'];
const quote = z.string().max(QUOTE_MAX).describe("The person's own words in this conversation that ask for this, copied verbatim.");

export class LastfindAgent extends Think<Cloudflare.Env> {
  override maxSteps = AGENT_MAX_STEPS;
  // Tool results of earlier turns reach the model cut to about 500 characters by Think's read-time truncation, whose cutoff
  // moves once every `truncationStep` (8) messages so the cached prompt prefix survives the turns in between; left at its
  // default on purpose. Inside a turn nothing is cut: the steps' messages only grow, so each call reuses the previous call's
  // cached prefix, and the pages and results read in the turn are what its answer or artifact is written from (8/11/2026).
  // The tools keep one fixed order (getTools), so their definitions stay in that prefix.
  override sendReasoning = false;
  /** The turn being answered (one at a time: Think queues the next message), opened by its first need of it. */
  #turn: Promise<AgentTurn> | null = null;
  /** The language of the last turn, for an error Think asks for synchronously. */
  #locale: 'en' | 'pt-BR' = 'en';
  /** The workspace's skills (Lastfind's and the team's), listed again before every turn. */
  #skills = workspaceSkills(() => this.name);
  /** The turn's way to its first words, in ms from its start (logged once they come: ARCHITECTURE.md, the agent's context). */
  #timing: { start: number; marks: Record<string, number>; logged: boolean } | null = null;
  /** When Think started the turn (before it lists the skills and assembles the messages), the timing's start. */
  #turnStart = 0;
  override observability = {
    emit: (event: Parameters<typeof genericObservability.emit>[0]) => {
      if (event.type === 'chat:turn:start') this.#turnStart = event.timestamp;
      genericObservability.emit(event);
    },
  };
  /**
   * The first call of a turn whose message is short reasons little (lib/agent.ts quickMessage); in a new conversation it
   * also offers only the first call's tools (`tools`), every tool from the next call.
   */
  #quick: { model: ReturnType<typeof wrapLanguageModel>; tools: string[] | null } | null = null;
  /** The provider and model that answered the latest model call (the admin's order may have moved it). */
  #served: Route | null = null;

  /**
   * The open turn, or a new one. `body` is what the page sent with the message (its period and language); a turn the
   * person's approval continues has none, so the last one is kept.
   */
  #current(body?: Json) {
    if (!this.#turn) {
      const opening = (async () => {
        const sent = body && Object.keys(body).length ? body : null;
        if (sent) await this.ctx.storage.put('body', sent);
        const read = sent ?? ((await this.ctx.storage.get<Json>('body')) ?? {});
        this.#locale = read.locale === 'pt-BR' ? 'pt-BR' : 'en';
        return openTurn(this.name, read, userQuestion(this.messages));
      })();
      opening.catch(() => {
        if (this.#turn === opening) this.#turn = null;
      });
      this.#turn = opening;
    }
    return this.#turn;
  }

  async #close(failed: boolean) {
    const turn = await this.#turn?.catch(() => null);
    this.#turn = null;
    if (turn) {
      await turn.naming;
      await closeTurn(turn, failed, userQuestion(this.messages)).catch((error) => console.error('Lastfind agent ledger failed:', error instanceof Error ? error.message : 'Unknown error'));
      this.#announce(turn);
    }
    return turn;
  }

  /** The month's use, to every open tab (the account menu and the chat count it down as the answer goes). */
  #announce(turn: AgentTurn) {
    this.ctx.waitUntil(
      turnUsage(turn).then(
        (usage) => this.broadcast(JSON.stringify({ type: USAGE_MESSAGE, project: turn.projectId, usage })),
        () => {},
      ),
    );
  }

  #mark(name: string) {
    if (this.#timing && !(name in this.#timing.marks)) this.#timing.marks[name] = Date.now() - this.#timing.start;
  }

  /** Spends a live-connection ticket's nonce (worker/index.ts): true the first time, false ever after. */
  async claimTicket(nonce: string, expires: number) {
    const now = Date.now();
    const spent = (await this.ctx.storage.get<Record<string, number>>('tickets')) ?? {};
    if (spent[nonce]) return false;
    // A spent nonce is kept until its ticket would have expired anyway.
    for (const [key, until] of Object.entries(spent)) if (until <= now) delete spent[key];
    spent[nonce] = expires;
    await this.ctx.storage.put('tickets', spent);
    return true;
  }

  /** The messages as the page shows them before its connection opens (the author's own, checked by the caller). */
  transcript() {
    return this.messages;
  }

  // Think registers these four as client-callable: anyone holding the live connection could approve a change over the
  // WebSocket and skip decideChange (its author and role checks). Redeclared here without the registration, so a
  // connection's call is refused ("not callable"); the Worker's own calls (decide, below) go through as before.
  override pendingExecutions(executionId?: string) {
    return super.pendingExecutions(executionId);
  }
  override pendingApprovals(executionId?: string) {
    return super.pendingApprovals(executionId);
  }
  override approveExecution(executionId: string) {
    return super.approveExecution(executionId);
  }
  override rejectExecution(...args: Parameters<Think<Cloudflare.Env>['rejectExecution']>) {
    return super.rejectExecution(...args);
  }

  /** Runs (approve) or declines a change this conversation is waiting on; false when there is none by that id. */
  async decide(execution: string, approve: boolean) {
    const waiting = await this.pendingApprovals(execution);
    if (!waiting.length) return false;
    // `remember` was an approved action before it applied at once: one still waiting from then is declined.
    const stale = waiting.some((item) => item.descriptor.action === 'remember');
    await (approve && !stale ? this.approveExecution(execution) : this.rejectExecution(execution, 'The person declined this change.'));
    return true;
  }

  override getModel(): never {
    throw new Error('The model is chosen per turn.');
  }

  override getSystemPrompt() {
    return 'You are the Lastfind agent.';
  }

  override getSkills() {
    return [this.#skills];
  }

  /**
   * The person's words, the skills used (and the one open beside the chat) and the tools' results so far, for a change to
   * what the agent learned. A change the person approved runs in a later step, whose messages may not reach back: their
   * last question is still theirs.
   */
  async #learning(messages: readonly ModelMessage[]) {
    const read = seen(messages);
    const turn = await this.#current();
    const users = read.users.length ? read.users : [userQuestion(this.messages)].filter(Boolean);
    return { turn, learner: learnerOf(turn, users, read.foreign), use: { activated: new Set([...read.activated, ...(turn.skill ? [turn.skill.name] : [])]) } };
  }

  /** What the conversation read: its kept messages and the answer under way (in the step's model messages until it ends). */
  #reads(messages: readonly unknown[]) {
    return conversationReads(this.messages as readonly ReadMessage[], messages as readonly ReadMessage[]);
  }

  override getTools(): ToolSet {
    const reads = agentMcpTools().filter((definition) => !definition.write);
    // A content has three tabs: its text, the outline it follows and the research it was written from.
    const part = z.enum(['content', 'outline', 'research']).optional().describe("A content's tab: content (the text, by default), outline or research.");
    return {
      ...Object.fromEntries(
        reads.map((definition) => [
          definition.name,
          tool({ description: definition.description, inputSchema: definition.input, execute: async (input) => runMcpTool(await this.#current(), definition.name, input as Json) }),
        ]),
      ),
      ...agentDataTools(() => this.#current()),
      create_artifact: tool({
        description:
          'Saves a document the person can open, export and share in Agent > Artifacts, in Markdown (tables as Markdown tables): any writing (a plan, notes, a summary, an email, an analysis), a report on the project data, a table, a content brief, or a marketing text to publish. Use it whenever they ask for something to keep, export or share.',
        inputSchema: z.object({
          title: z.string().max(120),
          kind: z.enum(ARTIFACT_KINDS).optional().describe(`Left out (${DEFAULT_ARTIFACT_KIND}) for any general writing. content only when the person asks for a marketing text to publish (a blog post, an article for search, a landing page, a product page); report for a report on the project data; table; brief for a content brief.`),
          content: z.string().max(ARTIFACT_CHARS_MAX).describe('Markdown.'),
          live: z.boolean().optional().describe('Its data blocks follow the project data when opened (a dashboard-like report); tables are live unless false.'),
        }),
        execute: async (input, { messages }) => saveArtifact(await this.#current(), input, this.#reads(messages)),
      }),
      edit_artifact: tool({
        description:
          "Edits an artifact in place (this conversation's, or the one open beside the chat), as a file edit tool does: old is text found exactly once in it (a heading line, a sentence, a paragraph), new replaces it (empty deletes it). The fastest way to make a small change (add a subtitle under a heading, fix a sentence, rename a heading, add a line): send only the part that changes, never the whole text. To add after a line, quote the line as old and write it again followed by the addition as new.",
        inputSchema: z.object({
          id: z.string().max(100),
          old: z.string().min(1).max(ARTIFACT_CHARS_MAX).describe('Exact text of the artifact, Markdown marks included (for a heading, its # line), found once.'),
          new: z.string().max(ARTIFACT_CHARS_MAX).describe('Markdown that replaces it.'),
          part,
        }),
        execute: async (input, { messages }) => editArtifact(await this.#current(), input, this.#reads(messages)),
      }),
      patch_artifact: tool({
        description:
          "Changes one whole section of an artifact (this conversation's, or the one open beside the chat): a section is a heading and its text up to the next heading of the same level (for the title, a # heading, only its intro up to the next heading). For a small change inside a section, use edit_artifact. Modes: replace, insert_before, insert_after, delete, or append (at the end, no section).",
        inputSchema: z.object({
          id: z.string().max(100),
          mode: z.enum(['replace', 'insert_before', 'insert_after', 'delete', 'append']),
          section: z.string().max(200).optional().describe('The heading text (without #), as in its sections.'),
          content: z.string().max(ARTIFACT_CHARS_MAX).optional().describe('Markdown; for replace, it includes the heading.'),
          part,
        }),
        execute: async (input, { messages }) => patchArtifact(await this.#current(), input, this.#reads(messages)),
      }),
      list_artifacts: tool({
        description: "Lists this project's artifacts (reports, tables, briefs, content), newest first, from every conversation: title, kind, id, last update. Optionally filters by words of the title.",
        inputSchema: z.object({ query: z.string().max(80).optional() }),
        execute: async ({ query }) => listProjectArtifacts(await this.#current(), query),
      }),
      read_artifact: tool({
        description:
          "Reads one of this project's artifacts whole, to continue or build on earlier work (a brief to draft from, a past report); a content comes with its outline and research tabs. With section, only that section (its heading text), to quote it exactly in edit_artifact without reading the whole text.",
        inputSchema: z.object({ id: z.string().max(100), section: z.string().max(200).optional(), part }),
        execute: async ({ id, section, part }) => readProjectArtifact(await this.#current(), id, section, part),
      }),
      set_content_overview: tool({
        description:
          "Writes a content's Overview: its publication fields (meta) and its comparison with Google's top 3 for the main keyword (the three pages read in this conversation, every topic they cover and every Google question, each marked for this text and each page). Lastfind counts the words of the text and of the pages itself, and answers where the text is behind. Free.",
        inputSchema: CONTENT_OVERVIEW_INPUT,
        execute: async (input, { messages }) => setContentOverview(await this.#current(), input, this.#reads(messages)),
      }),
      update_artifact: tool({
        description: 'Replaces the whole content (and optionally the title) of an artifact this conversation created, or the one open beside the chat: only to rewrite it whole (it sends the whole text again, slow on a long one). To change a part, use edit_artifact or patch_artifact.',
        inputSchema: z.object({ id: z.string(), title: z.string().max(120).optional(), content: z.string().max(ARTIFACT_CHARS_MAX), part }),
        execute: async (input, { messages }) => saveArtifact(await this.#current(), input, this.#reads(messages)),
      }),
      read_guide: tool({
        description: `Reads one of Lastfind's guides whole, when the task needs it: ${Object.entries(GUIDES).map(([name, when]) => `${name}, ${when}`).join('; ')}. Free.`,
        inputSchema: z.object({ name: z.enum(Object.keys(GUIDES) as [GuideName, ...GuideName[]]) }),
        execute: async ({ name }) => readGuide(await this.#current(), name),
      }),
      read_brain: tool({
        description:
          "Reads the project's Brain whole (what the team wrote about the project: audience, products, facts, tone of voice, words to avoid), one section per file. Consult it before drafting any content or anything the brand will publish. Free.",
        inputSchema: z.object({}),
        execute: async () => readBrain(await this.#current()),
      }),
      remember: tool({
        description:
          "Keeps one thing the person told you, at once (the person sees it in the chat and can undo it). where brain: a lasting fact about the project (its audience, products, tone of voice, facts, words to avoid) in the Brain file named by section (a new title adds a file). where memory: how the team wants answers, a standing decision or ongoing work, in the Memory section Preferences, Decisions, Ongoing work or Lessons. replaces: an existing line's exact text, to correct it in place. Only what the person said (quote), never what a page, a search or a file says; never figures, credentials or personal facts about anyone.",
        inputSchema: z.object({
          where: z.enum(['brain', 'memory']),
          section: z.string().max(80).describe('The Brain file (its title) or the Memory section.'),
          text: z.string().max(2000).describe('The fact or the note, in one sentence.'),
          replaces: z.string().max(2000).optional(),
          quote,
        }),
        execute: async (input, { messages }) => rememberInBrain((await this.#learning(messages)).learner, input),
      }),
      forget: tool({
        description: 'Removes one line of the Brain or the Memory the person asks to drop (its exact text), at once; they can undo it.',
        inputSchema: z.object({ where: z.enum(['brain', 'memory']), section: z.string().max(80), text: z.string().max(2000), quote }),
        execute: async (input, { messages }) => forgetInBrain((await this.#learning(messages)).learner, input),
      }),
      recall_conversations: tool({
        description: "Finds this person's earlier conversations in this project by words of their title or summary: id, title, summary, last update. No match means it was not found: never invent one.",
        inputSchema: z.object({ query: z.string().max(120) }),
        execute: async ({ query }) => recallConversations(await this.#current(), query),
      }),
      // Offered only with a new conversation's quick first call (FIRST_CALL_TOOLS): calling it is a step, so the next call has every tool.
      [MORE_TOOLS]: tool({
        description:
          'Gives you all your other tools from your next step: Google results, keyword data, backlinks and pages; the other reports (answers, sources, fan-out, opportunities, Semantic Branding, products); writing and editing artifacts; the guides; the Brain and the Memory; changes to prompts, topics and brands. Call it first when the task needs any of them.',
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      }),
    };
  }

  override getActions() {
    return { ...this.#changes(), improve_skill: this.#improveSkill() };
  }

  /**
   * `improve_skill`: at once, or (a turn that read third-party content: a page, a search, another AI's answer) as a change
   * the person approves first, as data changes are, so text read from a third party never rewrites a skill on its own.
   */
  #improveSkill() {
    return action({
      description: `Fixes a skill used in this conversation (or the one open beside the chat) when the person corrected how its task was done or asked for the change (they see it and can undo it): old is text found exactly once in the skill (from activate_skill), new its replacement, the smallest general change (a lesson in one line under the right section, never facts of this project). Quote the person's words. ${SKILL_STANDARD}`,
      inputSchema: z.object({ name: z.string().max(64), old: z.string().max(4000), new: z.string().max(4000), why: z.string().max(300), quote }),
      kind: 'durable-pause',
      approval: ({ ctx }) => seen(ctx.messages).thirdParty,
      approvalSummary: 'Change a skill',
      approvalRisk: 'medium',
      timeoutMs: 60_000,
      execute: async (input, ctx) => {
        const { turn, learner, use } = await this.#learning(ctx.messages);
        return patchSkill(learner, use, input, { open: turn.skill?.name === input.name });
      },
    });
  }

  #changes() {
    return Object.fromEntries(
      agentMcpTools()
        .filter((definition) => definition.write)
        .map((definition) => [
          definition.name,
          action({
            description: definition.description,
            inputSchema: definition.input,
            kind: 'durable-pause',
            // A change aimed at another project is refused when it runs, without asking anyone.
            approval: async ({ input }) => {
              const turn = await this.#current();
              return !(await foreignChange(turn, definition.name, { ...(input as Json), project: (input as Json).project ?? turn.projectId }));
            },
            approvalSummary: definition.title,
            approvalRisk: definition.destructive ? 'high' : 'medium',
            timeoutMs: 60_000,
            execute: async (input) => runMcpTool(await this.#current(), definition.name, input as Json),
          }),
        ]),
    );
  }

  override async beforeTurn(context: TurnContext): Promise<TurnConfig> {
    // From Think's start of the turn: `turn_started` is what Think did before this hook (the skills, the messages).
    this.#timing = { start: this.#turnStart || Date.now(), marks: {}, logged: false };
    this.#turnStart = 0;
    this.#mark('turn_started');
    // A new question sets aside the changes still waiting on the person: they are declined, and the model sees that
    // (while the platform's settings load).
    await Promise.all([
      loadPlatformSettings(),
      (async () => {
        if (!context.continuation)
          for (const waiting of await this.pendingApprovals())
            await this.rejectExecution(waiting.executionId, 'The person asked something else instead.', { autoContinue: false });
      })(),
    ]);
    this.#mark('settings');
    const turn = await this.#current((context.body ?? {}) as Json);
    turn.catalog = this.#skills.catalog;
    this.#mark('turn');
    // The admin's order of model providers (Admin > Providers): an error answer of one before anything is read moves the
    // call to the next; the route that answered prices the step (onStepFinish).
    const served = (route: Route) => {
      this.#served = route;
    };
    const chain = (effort?: ReasoningEffort) => {
      const chained = chainedChatModel(turn.model, 'agent', { effort, onServed: served });
      if (!chained) throw new ApiError(503, 'The agent is not configured yet: an admin needs to add the model key in Admin > Providers.');
      return chained;
    };
    // The service's failures (no credit, down) reach the chat as one neutral sentence, never its name or reply.
    const middleware = neutralModelErrors(this.#locale);
    const model = wrapLanguageModel({ model: chain(), middleware });
    // A new conversation gets its title from its first question beside the answer (never before it): the agent's model, a
    // tiny answer, no reasoning (`none`, among the efforts the agent's model lists); the turn closes after it, so
    // its cost is the turn's.
    if (!context.continuation && !turn.title && !turn.naming)
      turn.naming = nameConversation(turn, userQuestion(this.messages), async ({ system, prompt, maxOutputTokens }) => {
        let route: Route | null = null;
        const titled = chainedChatModel(turn.model, 'agent', { effort: 'none', onServed: (answered) => (route = answered) });
        if (!titled) return { text: '', cost: undefined };
        const result = await generateText({ model: titled, system, prompt, maxOutputTokens, abortSignal: AbortSignal.timeout(15_000) });
        const cost = servedCost(route, result.usage, result.providerMetadata);
        if (route) await recordModelCall((route as Route).provider, 'agent', (route as Route).model, { cost: cost ?? null });
        return { text: result.text, cost };
      });
    const activeTools = Object.keys(context.tools).filter((name) => !WORKSPACE_TOOLS.has(name) && name !== MORE_TOOLS && (turn.canWrite || !MEMBER_TOOLS.includes(name)));
    // A greeting or a thanks (and not a change to the artifact or the skill open beside the chat) answers without long
    // reasoning; as a new conversation's first question, with the first call's tools only (a later "yes" may need any).
    this.#quick =
      !context.continuation && !turn.open && !turn.skill && quickMessage(this.messages)
        ? {
            model: wrapLanguageModel({ model: chain('low'), middleware }),
            // From Ask Lastfind, the tools of the screen behind it too: "summarize this page" reads it in the first call.
            tools: firstQuestion(this.messages) ? [...activeTools.filter((name) => FIRST_CALL_TOOLS.includes(name) || (!!turn.page && SCREEN_TOOLS[turn.page.screen].tools.includes(name))), MORE_TOOLS] : null,
          }
        : null;
    const instructions = systemPrompt(turn);
    this.#mark('prompt');
    this.#timing.marks.prompt_chars = instructions.length;
    return {
      model,
      instructions,
      messages: readableFiles(context.messages),
      activeTools,
      // Before every further call: the turn stops when its reserve cannot be raised (its limit, the ceiling, the credits).
      stopWhen: async () => {
        if (await holdTurn(turn, AGENT_CALL_RESERVE_USD)) return false;
        turn.stopped = 'spend';
        return true;
      },
      messageMetadata: ({ part }) => (part.type === 'finish' && turn.stopped ? { stopped: turn.stopped } : undefined),
    };
  }

  /** Before each model call: it is counted as sent (closeTurn counts a cut one), and a short message's first call reasons little. */
  override async beforeStep(step: PrepareStepContext) {
    const turn = await this.#turn?.catch(() => null);
    if (turn) turn.calling = true;
    this.#mark('model_sent');
    const quick = step.stepNumber === 0 ? this.#quick : null;
    return quick ? { model: quick.model, ...(quick.tools ? { activeTools: quick.tools } : {}) } : undefined;
  }

  /** The turn's first words (or its first step) end its timing: logged once, for Admin's tail of the Worker. */
  override onChunk({ chunk }: ChunkContext) {
    const timing = this.#timing;
    if (!timing || timing.logged || !['text-delta', 'tool-input-start', 'reasoning-delta'].includes(chunk.type)) return;
    this.#mark(chunk.type === 'reasoning-delta' ? 'first_reasoning' : 'first_output');
    if (chunk.type === 'reasoning-delta') return;
    timing.logged = true;
    console.log('Lastfind agent timing', JSON.stringify({ ...timing.marks, quick: !!this.#quick, first_call_tools: this.#quick?.tools?.length ?? null }));
  }

  override async onStepFinish(step: StepContext) {
    // OpenRouter reports the call's cost; a direct provider's is its tokens at the model's list price.
    const route = this.#served;
    const cost = servedCost(route, step.usage, step.providerMetadata);
    // Each call's tokens, the cached and the reasoning ones apart (Admin's tail of the Worker): whether the prompt cache works.
    console.log('Lastfind agent step', JSON.stringify(stepUsage(step, cost)));
    if (route) await recordModelCall(route.provider, 'agent', route.model, { cost: cost ?? null });
    const turn = await this.#turn?.catch(() => null);
    if (!turn) return;
    turn.calling = false;
    await spendTurn(turn, cost);
    this.#announce(turn);
  }

  override async onChatResponse(result: ChatResponseResult) {
    // Which skill (at which version) this answer used, so its ratings count for that version.
    const used = result.message.parts.flatMap((part) => {
      const name = part.type === 'tool-activate_skill' ? (part as { input?: { name?: unknown } }).input?.name : null;
      return typeof name === 'string' ? [[name, this.#skills.versions.get(name) ?? null] as [string, number | null]] : [];
    });
    await Promise.all([
      this.#close(result.status === 'error'),
      recordSkillUses(this.name, result.message.id, used).catch((error) => console.error('Lastfind skill uses failed:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error')),
    ]);
  }

  // Think reads what this returns at once (a promise would reach the person as "[object Promise]"): the ledger closes in
  // the background.
  override onChatError(error: unknown) {
    this.ctx.waitUntil(this.#close(true));
    if (error instanceof ApiError) return new Error(localizeApiError(error.message, this.#locale));
    console.error('Lastfind agent turn failed:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error');
    return new Error(localizeApiError('The agent could not finish this answer. Try again.', this.#locale));
  }
}
