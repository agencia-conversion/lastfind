import type { Workspace, Run } from '../../lib/types.ts';
export function workspaceFixture(): Workspace {
  const project = {
    id: 'test-project',
    name: 'Example',
    domain: 'example.test',
    competitors: [{ name: 'Other', domain: 'other.test' }],
    location_code: 2840,
    language_code: 'en',
    daily_enabled: 1,
    interval_hours: 24,
    category: 'Software',
    audience: 'Teams',
    created_at: '2026-09-01T12:00:00.000Z',
  };
  const prompt = {
    id: 'test-prompt',
    project_id: project.id,
    text: 'Which software works for teams?',
    engine: 'chat_gpt' as const,
    tag: 'Research',
    tags: [],
    archived: 0,
    active: 1,
    next_run_at: '2026-09-06T07:00:00.000Z',
    created_at: project.created_at,
  };
  const run: Run = {
    id: 'test-run',
    project_id: project.id,
    prompt_id: prompt.id,
    prompt_text: prompt.text,
    engine: prompt.engine,
    status: 'complete',
    mentions: { Example: true, Other: false },
    brand_name: project.name,
    sources: [
      {
        url: 'https://example.test/review',
        domain: 'example.test',
        title: 'Review',
      },
    ],
    consulted_sources: null,
    cost: 0.001,
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    error: null,
    answer: 'Example is available.',
    model: 'test-model',
  };
  return {
    user: { name: 'Owner', email: 'owner@example.test' },
    projects: [project],
    prompts: [prompt],
    topics: [{ id: 'test-topic', project_id: project.id, name: 'Research' }],
    capabilities: {
      engines: ['chat_gpt'],
      promptLimit: null,
      topicLimit: null,
    },
    capacity: { prompts: 1, topics: 1 },
    runs: Array.from({ length: 30 }, (_, index) => ({
      ...run,
      id: `test-run-${index}`,
    })),
    selectedProjectId: project.id,
    usage: { used: 30, limit: null, period: '2026-09' },
    config: {
      dataforseo: true,
      scheduling: true,
      schedulerLastSeen: new Date().toISOString(),
      providerSettings: true,
    },
  };
}
