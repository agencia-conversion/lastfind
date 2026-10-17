import test from 'node:test';
import assert from 'node:assert/strict';
import { demoPrompts } from '../components/analytics/demo-data.ts';
import {
  accessibleWorkspaces,
  createDemoSession,
  setProjectPrompts,
  switchDemoContext,
  workspaceRole,
} from '../components/analytics/workspace-data.ts';

await test('workspace accessibility includes only active memberships for the selected user', () => {
  const session = createDemoSession();
  session.workspaces[1].members.push({
    userId: 'marina',
    role: 'admin',
    status: 'invited',
  });
  assert.deepEqual(
    accessibleWorkspaces(session).map((workspace) => workspace.id),
    ['conversion', 'lab'],
  );
  const marina = switchDemoContext(session, { userId: 'marina' });
  assert.deepEqual(
    accessibleWorkspaces(marina).map((workspace) => workspace.id),
    ['conversion'],
  );
  assert.equal(workspaceRole(marina), 'admin');
  assert.equal(
    workspaceRole({ ...marina, workspaceId: 'lab' }),
    'viewer',
    'An invitation grants no editing role',
  );
  assert.deepEqual(accessibleWorkspaces({ ...session, userId: 'unknown' }), []);
});

await test('switching users selects an accessible workspace and a project inside it', () => {
  const session = switchDemoContext(createDemoSession(), {
    workspaceId: 'lab',
  });
  assert.equal(session.workspaceId, 'lab');
  assert.equal(session.projectId, 'lab-web');
  const marina = switchDemoContext(session, {
    userId: 'marina',
    workspaceId: 'lab',
    projectId: 'lab-web',
  });
  assert.equal(marina.userId, 'marina');
  assert.equal(marina.workspaceId, 'conversion');
  assert.equal(marina.projectId, 'conversion-web');
  const fallback = switchDemoContext(marina, {
    workspaceId: 'unknown',
    projectId: 'lab-web',
  });
  assert.equal(fallback.workspaceId, 'conversion');
  assert.equal(fallback.projectId, 'conversion-web');
  assert.equal(
    session.userId,
    'diego',
    'Switching context must not mutate the previous session',
  );
  assert.strictEqual(
    switchDemoContext(session, { userId: 'unknown' }),
    session,
  );
});

await test('a user with only invited memberships cannot switch into a workspace', () => {
  const session = createDemoSession();
  session.workspaces[0].members = session.workspaces[0].members.map((member) =>
    member.userId === 'marina' ? { ...member, status: 'invited' } : member,
  );
  assert.strictEqual(switchDemoContext(session, { userId: 'marina' }), session);
});

await test('prompt updates remain isolated across projects and workspaces', () => {
  const session = createDemoSession();
  session.workspaces[0].projects.push({
    id: 'second-project',
    slug: 'second-project',
    name: 'Second project',
    domain: 'second.example',
    prompts: [],
  });
  const editedPrompts = session.workspaces[0].projects[0].prompts.map(
    (prompt, index) =>
      index === 0
        ? { ...prompt, text: 'An edited question for the first project' }
        : prompt,
  );
  const updated = setProjectPrompts(session, editedPrompts);
  assert.deepEqual(updated.workspaces[0].projects[0].prompts, editedPrompts);
  assert.strictEqual(
    updated.workspaces[0].projects[1],
    session.workspaces[0].projects[1],
  );
  assert.strictEqual(updated.workspaces[1], session.workspaces[1]);
  assert.notEqual(
    session.workspaces[0].projects[0].prompts[0].text,
    editedPrompts[0].text,
  );

  const second = switchDemoContext(updated, { projectId: 'second-project' });
  const secondPrompts = [
    { ...demoPrompts[0], id: 'second-prompt', tags: ['Second project'] },
  ];
  const updatedSecond = setProjectPrompts(second, secondPrompts);
  assert.deepEqual(
    updatedSecond.workspaces[0].projects[0].prompts,
    editedPrompts,
  );
  assert.deepEqual(
    updatedSecond.workspaces[0].projects[1].prompts,
    secondPrompts,
  );
  assert.deepEqual(updatedSecond.workspaces[1].projects[0].prompts, []);
  const firstAgain = switchDemoContext(updatedSecond, {
    projectId: 'conversion-web',
  });
  assert.equal(firstAgain.projectId, 'conversion-web');
  assert.deepEqual(firstAgain.workspaces[0].projects[0].prompts, editedPrompts);
});

await test('viewer and invited memberships cannot change project prompts', () => {
  const session = createDemoSession();
  const viewer = switchDemoContext(session, { userId: 'lucas' });
  assert.equal(workspaceRole(viewer), 'viewer');
  assert.strictEqual(setProjectPrompts(viewer, []), viewer);
  assert.deepEqual(viewer.workspaces[0].projects[0].prompts, demoPrompts);
  session.workspaces[1].members.push({
    userId: 'marina',
    role: 'admin',
    status: 'invited',
  });
  const invited = {
    ...session,
    userId: 'marina',
    workspaceId: 'lab',
    projectId: 'lab-web',
  };
  assert.strictEqual(setProjectPrompts(invited, demoPrompts), invited);
});

await test('new demo sessions own their prompt and tag arrays independently', () => {
  const first = createDemoSession();
  const second = createDemoSession();
  first.workspaces[0].projects[0].prompts[0].text =
    'Only changed in the first session';
  first.workspaces[0].projects[0].prompts[0].tags.push('First session');
  assert.deepEqual(second.workspaces[0].projects[0].prompts, demoPrompts);
  assert.ok(!demoPrompts[0].tags.includes('First session'));
});

await test('a validated identity replaces the sample owner in every membership without mutating the caller', () => {
  const user = {
    id: 'signed-in-owner',
    name: 'Account owner',
    email: 'owner@example.test',
  };
  const session = createDemoSession(user);
  assert.equal(session.userId, user.id);
  assert.deepEqual(
    session.users.find((entry) => entry.id === session.userId),
    { ...user, importedAvatar: true },
  );
  assert.notStrictEqual(session.users[0], user);
  assert.equal(
    session.users.some((entry) => entry.email === 'diego@example.com'),
    false,
  );
  assert.deepEqual(
    accessibleWorkspaces(session).map((workspace) => workspace.id),
    ['conversion', 'lab'],
  );
  for (const workspace of session.workspaces) {
    assert.equal(
      workspace.members.some((member) => member.userId === 'diego'),
      false,
    );
    assert.equal(
      workspaceRole({ ...session, workspaceId: workspace.id }),
      'owner',
    );
  }
  assert.equal(
    createDemoSession().userId,
    'diego',
    'anonymous preview keeps its independent identity fixture',
  );
});

await test('an identity with a fixture id is not duplicated or left with the fixture role', () => {
  const session = createDemoSession({
    id: 'marina',
    name: 'Real account',
    email: 'real@example.test',
  });
  assert.equal(
    session.users.filter((entry) => entry.id === 'marina').length,
    1,
  );
  assert.equal(
    session.workspaces[0].members.filter((member) => member.userId === 'marina')
      .length,
    1,
  );
  assert.equal(workspaceRole(session), 'owner');
});
