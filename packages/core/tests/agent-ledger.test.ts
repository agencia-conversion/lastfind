import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGERS, moduleOfContext } from '../lib/platform-spend.ts';
import { CURATOR_CONTEXT, SKILL_CONTEXT } from '../lib/agent-learning.ts';
import { BRAIN_WIZARD_CONTEXT } from '../lib/brain-wizard.ts';

// Every model call of the agent is in Admin > Usage and costs, with its cost (and, for the chat, the AI
// credits). The agent's code is every file named agent* or brain-wizard*; a file that sends a model call must be one
// listed here, with the ledger it writes and the module Admin shows it under. A new path fails this test until it is.
const core = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string) => readFileSync(path.join(core, file), 'utf8');
const walk = (dir: string): string[] =>
  readdirSync(path.join(core, dir)).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(path.join(core, file)).isDirectory() ? walk(file) : [file];
  });

/** What sends a model call: the AI SDK provider, OpenRouter's chat completions and the Decisions API. */
const SENDS = /createOpenRouter\(|\bchainedChatModel\(|\bpostChat\(|\brequestDecisions\(|\bsendDecisions\(|openrouter\.ai\/api/;
const PATHS: Record<string, { what: string; ledger: string; module: string }> = {
  'worker/agent.ts': { what: 'chat turns: answers, artifact writes and edits, content steps (every tool call is a step of the turn), and a new conversation\'s title', ledger: 'agent_turns', module: 'agent' },
  'lib/server/agent-curator.ts': { what: 'the conversation curator (Memory, Brain, summary) and the skill curator', ledger: 'brand_research_jobs', module: 'learning' },
  'lib/server/brain-wizard.ts': { what: 'the Brain wizard (Agent > Brain)', ledger: 'brand_research_jobs', module: 'brain' },
};

test('every model call path of the agent is listed with the ledger and module it writes', () => {
  const agentFiles = ['lib', 'worker', 'app'].flatMap(walk).filter((file) => /(^|\/)(agent[^/]*|brain-wizard[^/]*)\.tsx?$/.test(file) || file.includes(`${path.sep}agent${path.sep}`));
  const sending = agentFiles.filter((file) => SENDS.test(read(file))).sort();
  assert.deepEqual(sending, Object.keys(PATHS).sort());
  // The agent's tools never call a model of their own: the app's routes (MCP tools), search data, data blocks, skills.
  for (const file of ['lib/server/mcp-tools.ts', 'lib/server/agent-data.ts', 'lib/server/agent-blocks.ts', 'lib/server/agent-skills.ts', 'lib/agent.ts']) assert.doesNotMatch(read(file), SENDS, file);
});

test('the chat ledger: every call reserved before it is sent, counted when it ends, a cut one at its reserve; nothing else calls a model', () => {
  const worker = read('worker/agent.ts');
  // Think features that would call a model outside the turn's ledger: compaction, sub-agents, agent tools, a default model.
  assert.doesNotMatch(worker, /configureSession|compactAfter|onCompaction|subAgent|agentTool\(|workersAi|getAIBinding/);
  assert.match(worker, /override getModel\(\): never \{\s*throw/);
  assert.match(worker, /stopWhen: async \(\) => \{\s*if \(await holdTurn\(turn, AGENT_CALL_RESERVE_USD\)\)/);
  assert.match(worker, /override async beforeStep[\s\S]*?turn\.calling = true/);
  assert.match(worker, /override async onStepFinish[\s\S]*?turn\.calling = false;\s*await spendTurn\(turn, cost\)/);
  assert.match(read('lib/server/agent.ts'), /if \(turn\.calling\) \{\s*turn\.calling = false;\s*turn\.spent \+= AGENT_CALL_RESERVE_USD;/);
  // Search data spends in the same turn (its worst case held first, its cost counted after).
  assert.match(read('lib/server/agent-data.ts'), /holdTurn\(turn, reserve\)[\s\S]*spendTurn\(turn,/);
  // A conversation's title is its first question, cut, at once (no model call); the few words the model writes for it
  // (8/11/2026) are a call of the turn: counted in the turn, which closes after it.
  assert.doesNotMatch(read('lib/agent.ts').match(/export function conversationTitle[\s\S]*?\n\}/)?.[0] ?? '', SENDS);
  assert.match(worker, /turn\.naming = nameConversation\(turn,/);
  assert.match(worker, /await turn\.naming;\s*await closeTurn\(/);
  assert.match(read('lib/server/agent.ts'), /export async function nameConversation[\s\S]*?turn\.spent \+= /);
  const agent = LEDGERS.find((ledger) => ledger.table === 'agent_turns');
  assert.equal(agent?.module, "'agent'");
});

test('learning and the Brain wizard reserve a ledger row before each call, under their own Admin modules', () => {
  for (const file of ['lib/server/agent-curator.ts', 'lib/server/brain-wizard.ts']) {
    const text = read(file);
    // Each call (requestDecisions, which sends through postChat) comes after a claimed row: its reserve under the project's
    // budget and the platform's brake, settled at the cost the reply reports.
    const calls = [...text.matchAll(/requestDecisions\(model/g)].map((match) => match.index);
    assert.ok(calls.length >= 1, file);
    calls.forEach((at, index) => assert.ok(text.slice(index ? calls[index - 1] : 0, at).includes('claimDecisionJob('), `${file}: call ${index + 1}`));
  }
  assert.equal(moduleOfContext(CURATOR_CONTEXT), PATHS['lib/server/agent-curator.ts'].module);
  assert.equal(moduleOfContext(SKILL_CONTEXT), PATHS['lib/server/agent-curator.ts'].module);
  assert.equal(moduleOfContext(BRAIN_WIZARD_CONTEXT), PATHS['lib/server/brain-wizard.ts'].module);
});
