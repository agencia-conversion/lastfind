import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENGINE_META, ENGINES } from '../lib/engines.ts';

test('AI Mode has its own icon, distinct from AI Overview', () => {
  assert.notEqual(
    ENGINE_META.google_ai_mode.icon,
    ENGINE_META.google_ai_overviews.icon,
  );
  for (const engine of ENGINES)
    assert.ok(
      existsSync(
        resolve(
          import.meta.dirname,
          `../public/icons/ai/${ENGINE_META[engine].icon}.svg`,
        ),
      ),
      engine,
    );
});
