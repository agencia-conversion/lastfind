import type { OnboardingResult } from './onboarding-data.ts';
import { uniqueSlug } from './routes.ts';
import { workspaceRole, type DemoSession } from './workspace-data.ts';

// Configuration is a session draft, never an API submission or a collected report.
export function createOnboardingProject(
  session: DemoSession,
  result: OnboardingResult,
  id = `demo-${crypto.randomUUID()}`,
): DemoSession {
  if (!['owner', 'admin'].includes(workspaceRole(session))) return session;
  const workspace = session.workspaces.find(
    (w) => w.id === session.workspaceId,
  )!;
  const project = {
    id,
    slug: uniqueSlug(
      result.brandName,
      workspace.projects.map((p) => p.slug),
    ),
    name: result.brandName,
    domain: result.domain,
    prompts: result.prompts.map((p, index) => ({
      ...p,
      id: `${id}-prompt-${index + 1}`,
      tags: [...p.tags],
    })),
    setup: {
      segment: result.segment,
      country: result.country,
      language: result.language,
      ...(result.semantic
        ? {
            semantic: {
              enabled: result.semantic.enabled,
              attributes: result.semantic.attributes.map((attribute) => ({
                ...attribute,
              })),
            },
          }
        : {}),
      models: [...result.models],
      competitors: result.competitors.map((c) => ({ ...c })),
    },
  };
  return {
    ...session,
    projectId: id,
    workspaces: session.workspaces.map((w) =>
      w.id === workspace.id ? { ...w, projects: [...w.projects, project] } : w,
    ),
  };
}
