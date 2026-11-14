import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSemanticConfiguration } from '../lib/semantic-evaluation.ts';

test('configuration revisions cannot accept duplicate or malformed attributes', () => {
  assert.throws(() => validateSemanticConfiguration({ enabled: true, attributes: [] }),/one to ten/);
  assert.throws(() => validateSemanticConfiguration({ enabled: true, attributes: [
    { id: 'value', name: 'Value' }, { id: 'value', name: 'Value again' },
  ] }),/unique/);
});
