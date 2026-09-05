import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writePrivateJson, writePrivateFile } from './private-files.mjs';
// Local development credentials are independent in every checkout/worktree.
// No production secret or database is imported by development setup.
export function developmentSettings(root, edition, owner = false) {
  if (!/^[a-z][a-z0-9-]*$/.test(edition)) throw new Error('Invalid development application');
  const file = resolve(root, '.lastfind/development', edition + '.json');
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { SESSION_SECRET: randomBytes(32).toString('hex') };
  if (owner && !settings.OWNER_ACCESS_KEY_HASH) {
    const key = randomBytes(32).toString('base64url');
    writePrivateFile(resolve(root, '.lastfind/development', edition + '-access-key.txt'), key + '\n');
    settings.OWNER_ACCESS_KEY_HASH = createHash('sha256').update(key).digest('hex');
  }
  writePrivateJson(file, settings);
  return settings;
}
