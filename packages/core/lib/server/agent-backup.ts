// The project's agent conversations in its backup and export (both editions): one `agent` record per conversation (or
// per part of a long one), written before the footer. They are a copy for the record: a restore checks the file and
// skips them (lib/project-backups.ts), and never changes a conversation, which lives in its own agent (worker/agent.ts).
import { db } from './env';

// The Worker (worker/index.ts) supplies how a conversation's messages are read, so this module never loads the agent
// runtime (and the modules that import it stay light). Without it, or when a read fails, a conversation is listed
// as unavailable instead of left out.
type Transcripts = (id: string) => Promise<unknown[]>;
let transcripts: Transcripts | null = null;
export const setAgentTranscripts = (read: Transcripts) => {
  transcripts = read;
};

/** A message larger than this (an attached image, a huge paste) is named in the record without its content. */
const MESSAGE_MAX = 1024 * 1024;
/** One record stays far below the largest line a backup may hold (8 MiB). */
const RECORD_MAX = 4 * 1024 * 1024;
// ponytail: conversations newest first up to 32 MiB, the rest counted in an `omitted` record; page through R2 if projects outgrow it.
const TOTAL_MAX = 32 * 1024 * 1024;

type Conversation = { id: string; account_id: string; title: string; pinned: number; created_at: string; updated_at: string };
const encoder = new TextEncoder();
const size = (text: string) => encoder.encode(text).byteLength;

function records(conversation: Conversation, messages: unknown[], unavailable: boolean) {
  const lines: string[] = [];
  let batch: unknown[] = [],
    batchBytes = 0;
  const flush = () => {
    lines.push(JSON.stringify({ type: 'agent', conversation, part: lines.length, messages: batch, ...(unavailable ? { unavailable: true } : {}) }) + '\n');
    batch = [];
    batchBytes = 0;
  };
  for (const message of messages) {
    let kept = message;
    let bytes = size(JSON.stringify(message) ?? 'null');
    if (bytes > MESSAGE_MAX) {
      const { id, role } = (message ?? {}) as { id?: unknown; role?: unknown };
      kept = { id, role, omitted: 'too_large' };
      bytes = size(JSON.stringify(kept));
    }
    if (batch.length && batchBytes + bytes > RECORD_MAX) flush();
    batch.push(kept);
    batchBytes += bytes;
  }
  if (batch.length || !lines.length) flush();
  return lines.join('');
}

/**
 * The NDJSON lines of the project's conversations (none deleted), newest first; '' when there are none. A conversation
 * is private to the account that wrote it: a file someone downloads (Settings > Project data) holds only `account`'s
 * own; `null` (every account's) is only for the operations route, the operator's copy that keeps nothing from being lost.
 */
export async function agentBackupLines(workspaceId: string, projectId: string, account: string | null) {
  const read = transcripts;
  const { results } = await db()
    // A conversation that never had a turn (the chat opens one as its new-conversation screen shows) holds nothing to keep.
    .prepare(
      "SELECT id,account_id,title,pinned,created_at,updated_at FROM agent_conversations c WHERE workspace_id=?1 AND project_id=?2 AND deleted_at IS NULL AND (?3 IS NULL OR account_id=?3) AND (title<>'' OR EXISTS(SELECT 1 FROM agent_turns t WHERE t.conversation_id=c.id)) ORDER BY updated_at DESC,id",
    )
    .bind(workspaceId, projectId, account)
    .all<Conversation>();
  let out = '',
    total = 0,
    omitted = 0;
  for (const conversation of results) {
    let messages: unknown[] = [],
      unavailable = !read;
    if (read)
      try {
        messages = await read(conversation.id);
      } catch {
        unavailable = true; // The record says so; the rest of the backup goes on.
      }
    const lines = records(conversation, Array.isArray(messages) ? messages : [], unavailable);
    const bytes = size(lines);
    if (total + bytes > TOTAL_MAX) {
      omitted++;
      continue;
    }
    out += lines;
    total += bytes;
  }
  return omitted ? `${out}${JSON.stringify({ type: 'agent', omitted })}\n` : out;
}
