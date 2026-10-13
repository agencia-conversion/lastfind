import type { SemanticConfiguration } from './semantic-configuration.ts';
import { demoPrompts, type DemoPrompt, type DemoModel } from './demo-data.ts';

export type DemoRole = 'owner' | 'admin' | 'member' | 'viewer';
export type DemoUser = {
  id: string;
  name: string;
  email: string;
  avatar?: {
    source: string;
    preview: string;
    width: number;
    height: number;
    zoom: number;
    x: number;
    y: number;
  };
};
export type DemoMember = {
  userId: string;
  role: DemoRole;
  status: 'active' | 'invited';
};
export type DemoProject = {
  id: string;
  slug: string;
  name: string;
  domain: string;
  prompts: DemoPrompt[];
  setup?: {
    segment: string;
    country: string;
    language?: 'en-US' | 'pt-BR';
    semantic?: SemanticConfiguration;
    models: DemoModel[];
    competitors: { name: string; domain: string }[];
  };
};
export type DemoWorkspace = {
  id: string;
  slug: string;
  name: string;
  members: DemoMember[];
  projects: DemoProject[];
};
export type DemoSession = {
  users: DemoUser[];
  workspaces: DemoWorkspace[];
  userId: string;
  workspaceId: string;
  projectId: string;
};
export type SettingsSection = 'workspace' | 'members' | 'projects' | 'profile';

export function createDemoSession(
  authenticatedUser?: Pick<DemoUser, 'id' | 'name' | 'email'>,
): DemoSession {
  const session: DemoSession = {
    users: [
      { id: 'diego', name: 'Diego Ivo', email: 'diego@example.com' },
      { id: 'marina', name: 'Marina Costa', email: 'marina@example.com' },
      { id: 'lucas', name: 'Lucas Almeida', email: 'lucas@example.com' },
    ],
    workspaces: [
      {
        id: 'conversion',
        slug: 'conversion',
        name: 'Conversion',
        members: [
          { userId: 'diego', role: 'owner', status: 'active' },
          { userId: 'marina', role: 'admin', status: 'active' },
          { userId: 'lucas', role: 'viewer', status: 'active' },
        ],
        projects: [
          {
            id: 'conversion-web',
            slug: 'conversion',
            name: 'Conversion',
            domain: 'conversion.com.br',
            prompts: demoPrompts.map((p) => ({ ...p, tags: [...p.tags] })),
          },
        ],
      },
      {
        id: 'lab',
        slug: 'seo-lab',
        name: 'SEO Lab',
        members: [{ userId: 'diego', role: 'owner', status: 'active' }],
        projects: [
          {
            id: 'lab-web',
            slug: 'seo-lab',
            name: 'SEO Lab',
            domain: 'example.com',
            prompts: [],
          },
        ],
      },
    ],
    userId: 'diego',
    workspaceId: 'conversion',
    projectId: 'conversion-web',
  };
  if (authenticatedUser) {
    const originalOwner = session.userId;
    session.users = [
      {
        id: authenticatedUser.id,
        name: authenticatedUser.name,
        email: authenticatedUser.email,
      },
      ...session.users.filter(
        (user) => user.id !== originalOwner && user.id !== authenticatedUser.id,
      ),
    ];
    for (const workspace of session.workspaces) {
      workspace.members = workspace.members
        .filter(
          (member) =>
            member.userId !== authenticatedUser.id ||
            member.userId === originalOwner,
        )
        .map((member) =>
          member.userId === originalOwner
            ? { ...member, userId: authenticatedUser.id }
            : member,
        );
    }
    session.userId = authenticatedUser.id;
  }
  return session;
}

export function accessibleWorkspaces(session: DemoSession) {
  return session.workspaces.filter((w) =>
    w.members.some((m) => m.userId === session.userId && m.status === 'active'),
  );
}

export function workspaceRole(session: DemoSession): DemoRole {
  return (
    session.workspaces
      .find((w) => w.id === session.workspaceId)
      ?.members.find(
        (m) => m.userId === session.userId && m.status === 'active',
      )?.role ?? 'viewer'
  );
}

export function switchDemoContext(
  session: DemoSession,
  next: { userId?: string; workspaceId?: string; projectId?: string },
): DemoSession {
  const candidate = { ...session, userId: next.userId ?? session.userId };
  if (!candidate.users.some((u) => u.id === candidate.userId)) return session;
  const available = accessibleWorkspaces(candidate);
  const workspace =
    available.find((w) => w.id === (next.workspaceId ?? session.workspaceId)) ??
    available[0];
  if (!workspace) return session;
  const project =
    workspace.projects.find(
      (p) => p.id === (next.projectId ?? session.projectId),
    ) ?? workspace.projects[0];
  if (!project) return session;
  return { ...candidate, workspaceId: workspace.id, projectId: project.id };
}

export function setProjectPrompts(
  session: DemoSession,
  prompts: DemoPrompt[],
): DemoSession {
  if (workspaceRole(session) === 'viewer') return session;
  return {
    ...session,
    workspaces: session.workspaces.map((w) =>
      w.id !== session.workspaceId
        ? w
        : {
            ...w,
            projects: w.projects.map((p) =>
              p.id !== session.projectId ? p : { ...p, prompts },
            ),
          },
    ),
  };
}
