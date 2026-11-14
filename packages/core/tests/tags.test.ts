import test from 'node:test';
import assert from 'node:assert/strict';
import { addTags } from '../lib/tags.ts';

const domain = (text: string) => (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text.trim().toLowerCase()) ? text.trim().toLowerCase() : null);

test('typed or pasted text becomes badges in order: repeats dropped, refused text left in the field', () => {
  assert.deepEqual(addTags(['acme.com'], 'Beta.com, gamma.com\nACME.com nope', domain, true), { next: ['acme.com', 'beta.com', 'gamma.com'], left: 'nope' });
  // Names keep their spaces: only a comma, a semicolon or a line break separates them.
  assert.deepEqual(addTags([], 'Rock Content; Acme Inc,  ', (text) => text.trim() || null, false), { next: ['Rock Content', 'Acme Inc'], left: '' });
});
