// The independent edition's first run (/app/setup): an empty installation opens the setup wizard before anything else, and a
// finished one never shows it again. Pure, so the gate is tested without a database (tests/setup.test.mjs).

/** `admin`: no admin yet, anyone who opens the installation creates it. `setup`: the admin finishes the wizard. `done`: the app. */
export type SetupStage = 'admin' | 'setup' | 'done';

export function setupStage({ owner, completed, projects }: { owner: boolean; completed: boolean; projects: boolean }): SetupStage {
  // Finished, or an installation already in use before the wizard existed: never again, even with no admin key in sight
  // (a missing key then shows the sign-in, never an open "create the admin" form over existing data).
  if (completed || projects) return 'done';
  return owner ? 'setup' : 'admin';
}

/** What a wizard request may do: create the admin only while there is none; finish only once it exists. */
export const setupAllows = (stage: SetupStage, action: 'admin' | 'complete') => (action === 'admin' ? stage === 'admin' : stage === 'setup');

/** The admin's access key: the owner sign-in's own rule (at least 32 characters, at most 256). */
export const validAccessKey = (key: unknown): key is string => typeof key === 'string' && key.length >= 32 && key.length <= 256;
export const validAdminEmail = (email: unknown): email is string =>
  typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
