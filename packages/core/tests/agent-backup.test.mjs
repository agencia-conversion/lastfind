import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { extendStoreDigest } from '../lib/project-store-contract.ts';
import { backupFingerprint, inspectBackup } from '../lib/project-backups.ts';

// A project's backup and export carry its agent conversations (newest first, the deleted ones left out), before the
// footer; a restore checks the file as before and skips them. The conversations' agents and the database are fixtures.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fakes = {
  // Scripted rows, or a real database with the editions' migrations (the privacy test).
  './env': `export const db=()=>({prepare:(sql)=>({bind:(...params)=>({all:async()=>({results:globalThis.backupFx.sqlite?globalThis.backupFx.sqlite.prepare(sql).all(...params):globalThis.backupFx.rows(sql,params)})})})});`,
};
const bundle = await build({
  entryPoints: [path.join(root, 'packages/core/lib/server/agent-backup.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'fakes',
    setup(plugin) {
      plugin.onResolve({ filter: /^\.\/env$/ }, (args) => ({ path: args.path, namespace: 'fake' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fake' }, (args) => ({ contents: fakes[args.path], loader: 'js' }));
    },
  }],
});
const { agentBackupLines, setAgentTranscripts } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const conversation = (id, updated) => ({ id, account_id: 'member-1', title: `Chat ${id}`, pinned: 0, created_at: '2026-10-01T00:00:00.000Z', updated_at: updated });
function fixture(transcripts, agent = true) {
  const queries = [];
  // As the Worker reads them (worker/index.ts): from each conversation's agent, failing without the binding.
  setAgentTranscripts(async (id) => {
    if (!agent) throw new Error('The agent is not configured.');
    const value = transcripts[id];
    if (value instanceof Error) throw value;
    return value ?? [];
  });
  globalThis.backupFx = {
    rows: (sql, params) => {
      queries.push({ sql, params });
      return [conversation('c-new', '2026-10-03T00:00:00.000Z'), conversation('c-old', '2026-10-02T00:00:00.000Z')];
    },
  };
  return queries;
}
const parse = (text) => text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('every conversation of the project is written with its messages; an oversized message is named, not copied', async () => {
  const huge = { id: 'm-big', role: 'user', parts: [{ type: 'file', url: `data:image/png;base64,${'A'.repeat(1_200_000)}` }] };
  const queries = fixture({ 'c-new': [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Olá ☀️' }] }, huge], 'c-old': new Error('evicted') });
  const records = parse(await agentBackupLines('owner-1', 'p1', null));
  assert.match(queries[0].sql, /workspace_id=\?1 AND project_id=\?2 AND deleted_at IS NULL AND \(\?3 IS NULL OR account_id=\?3\) AND \(title<>'' OR EXISTS\(SELECT 1 FROM agent_turns t WHERE t\.conversation_id=c\.id\)\) ORDER BY updated_at DESC/);
  assert.deepEqual(queries[0].params, ['owner-1', 'p1', null]);
  assert.deepEqual(records.map((record) => [record.type, record.conversation.id, record.part]), [['agent', 'c-new', 0], ['agent', 'c-old', 0]]);
  assert.deepEqual(records[0].conversation, conversation('c-new', '2026-10-03T00:00:00.000Z'));
  assert.equal(records[0].messages[0].parts[0].text, 'Olá ☀️');
  assert.deepEqual(records[0].messages[1], { id: 'm-big', role: 'user', omitted: 'too_large' });
  // A conversation whose agent could not answer is still listed, and says so.
  assert.deepEqual([records[1].messages, records[1].unavailable], [[], true]);
  // A long conversation is split into parts, each far below the largest line a backup may hold.
  const message = (index) => ({ id: `m${index}`, role: 'assistant', parts: [{ type: 'text', text: 'x'.repeat(900_000) }] });
  fixture({ 'c-new': Array.from({ length: 10 }, (_, index) => message(index)), 'c-old': [] });
  const long = parse(await agentBackupLines('owner-1', 'p1', null)).filter((record) => record.conversation.id === 'c-new');
  assert.ok(long.length >= 3);
  assert.deepEqual(long.map((record) => record.part), long.map((_, index) => index));
  assert.equal(long.flatMap((record) => record.messages).length, 10);
  // Without the agent binding nothing is lost silently: the conversations are listed as unavailable.
  fixture({}, false);
  assert.ok(parse(await agentBackupLines('owner-1', 'p1', null)).every((record) => record.unavailable));
});

test('a backup with conversations restores as before: same footer, same fingerprint, conversations skipped', async () => {
  fixture({ 'c-new': [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }], 'c-old': [] });
  const header = { schema: 4, projectId: 'p1', ownerId: 'owner-1', generation: 'g1', revision: 3, analysisRevision: null, analysisMutationRevision: 0 };
  const prompts = [{ id: 'q1', project_id: 'p1', text: 'Best tool?', engine: 'chat_gpt' }];
  const footer = {
    ...header,
    digests: { runs: await extendStoreDigest('', 'runs', [], 4), prompts: await extendStoreDigest('', 'prompts', prompts, 4), semantic_evaluations: await extendStoreDigest('', 'semantic_evaluations', [], 4) },
    counts: { runs: 0, prompts: 1, semantic_evaluations: 0 },
  };
  const lines = (agent) =>
    [
      JSON.stringify({ type: 'manifest', manifest: header }),
      JSON.stringify({ type: 'chunk', entity: 'prompts', rows: prompts }),
      JSON.stringify({ type: 'chunk', entity: 'runs', rows: [] }),
      JSON.stringify({ type: 'chunk', entity: 'semantic_evaluations', rows: [] }),
    ].join('\n') + '\n' + agent + JSON.stringify({ type: 'footer', manifest: footer }) + '\n';
  const agent = await agentBackupLines('owner-1', 'p1', null);
  assert.ok(agent.endsWith('\n'));
  const chunks = [];
  const withAgent = await inspectBackup([lines(agent)], { project: 'p1', onChunk: (entity, rows) => chunks.push([entity, rows.length]) });
  const without = await inspectBackup([lines('')], { project: 'p1' });
  assert.deepEqual(withAgent, without);
  assert.equal(backupFingerprint(withAgent), backupFingerprint(without));
  assert.deepEqual(chunks, [['prompts', 1], ['runs', 0], ['semantic_evaluations', 0]], 'only store rows are uploaded');
  // After the footer nothing may follow, conversations included.
  await assert.rejects(inspectBackup([lines('') + agent], { project: 'p1' }), /after the project backup footer/);
});

test('a conversation is private to its author: a downloaded file holds only the requester\'s own; the operator copy holds all', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const dir = path.join(root, 'apps/selfhost/drizzle');
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(path.join(dir, name), 'utf8'));
  const add = sqlite.prepare("INSERT INTO agent_conversations(id,workspace_id,account_id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?,'2026-10-01','2026-10-02')");
  add.run('conv-a', 'owner-1', 'member-a', 'p1', 'A private plan');
  add.run('conv-b', 'owner-1', 'member-b', 'p1', 'B private plan');
  add.run('conv-other', 'owner-2', 'member-a', 'p1', 'Another workspace');
  // Opened by the new-conversation screen and never sent to: nothing to keep (its agent is not even woken).
  add.run('conv-empty', 'owner-1', 'member-a', 'p1', '');
  setAgentTranscripts(async (id) => [{ id: `${id}-m1`, role: 'user', parts: [{ type: 'text', text: `secret of ${id}` }] }]);
  globalThis.backupFx = { sqlite };
  const ids = async (account) => parse(await agentBackupLines('owner-1', 'p1', account)).map((record) => record.conversation.id).sort();
  const forA = await agentBackupLines('owner-1', 'p1', 'member-a');
  assert.deepEqual(await ids('member-a'), ['conv-a']);
  assert.deepEqual(await ids('member-b'), ['conv-b']);
  for (const leak of ['conv-b', 'B private plan', 'secret of conv-b', 'conv-other']) assert.ok(!forA.includes(leak), `member A's file never names ${leak}`);
  assert.deepEqual(await ids('owner-1'), [], 'the owner who wrote nothing gets no one else\'s chats');
  assert.deepEqual(await ids(null), ['conv-a', 'conv-b'], 'the operator copy keeps every account\'s, of this workspace only');
  delete globalThis.backupFx.sqlite;
  sqlite.close();
});
