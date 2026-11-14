// In-memory copy of the control database's `platform_settings` rows (credentials already opened), filled by
// `loadPlatformSettings` before a request or a scheduled tick runs. `setting()` reads it before the Worker's own
// variables and secrets, so a credential saved in Admin wins over the Worker's value of the same name.
// No import here: `env.ts` reads this module and `platform-settings.ts` writes it.
const values = new Map<string, string>();
const unreadable = new Set<string>();
let loadedAt = 0;
/** A request or tick reads the database again after this long; saving in Admin refreshes at once. */
export const STORED_SETTINGS_TTL_MS = 60_000;

export const storedSetting = (key: string) => values.get(key) ?? '';
/** A sealed credential no current key (CREDENTIALS_KEY, SESSION_SECRET) could open (one was rotated): set it again. */
export const storedSettingUnreadable = (key: string) => unreadable.has(key);
export const storedSettingsFresh = (now = Date.now()) => now - loadedAt < STORED_SETTINGS_TTL_MS;
export function replaceStoredSettings(entries: Iterable<[string, string]>, failed: Iterable<string> = []) {
  values.clear();
  unreadable.clear();
  for (const [key, value] of entries) values.set(key, value);
  for (const key of failed) unreadable.add(key);
  loadedAt = Date.now();
}
export function forgetStoredSettings() {
  loadedAt = 0;
}
