import test from 'node:test';
import assert from 'node:assert/strict';
import { CLASSIFIER_FUNCTIONS, classifierEngines } from '../lib/classifier-models.ts';

const D1 = 'liquid/d1-ultra';
const JEV = 'typesafe/jev-1.14';

test('the default model applies when the setting is absent, and an override keeps the default as its fallback', () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  assert.deepEqual(classifierEngines('', 'source_types', JEV, warn), { model: JEV, fallback: null });
  assert.deepEqual(classifierEngines('{}', 'source_types', JEV, warn), { model: JEV, fallback: null });
  assert.deepEqual(classifierEngines(`{"source_types":"${D1}"}`, 'source_types', JEV, warn), { model: D1, fallback: JEV });
  assert.deepEqual(classifierEngines(`{"source_types":"${D1}"}`, 'semantic', JEV, warn), { model: JEV, fallback: null });
  assert.deepEqual(classifierEngines(`{"source_types":"${JEV}"}`, 'source_types', JEV, warn), { model: JEV, fallback: null });
  assert.deepEqual(warnings, []);
});

test('an invalid setting falls back to the default and says so', () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  for (const raw of ['nope', '[]', 'null', '{"source_types":7}', '{"source_types":"has space"}', '{"source_types":""}'])
    assert.deepEqual(classifierEngines(raw, 'source_types', JEV, warn), { model: JEV, fallback: null }, raw);
  assert.equal(warnings.length, 4, 'not JSON, a number, a bad name and an empty name are logged; an array or null just has no entry');
});

test('a model saved in Admin for the function wins over the server setting and keeps the code default as fallback', () => {
  const warn = () => {};
  assert.deepEqual(classifierEngines(`{"source_types":"${D1}"}`, 'source_types', JEV, warn, 'vendor/admin'), { model: 'vendor/admin', fallback: JEV });
  assert.deepEqual(classifierEngines('', 'source_types', JEV, warn, JEV), { model: JEV, fallback: null });
  assert.deepEqual(classifierEngines(`{"source_types":"${D1}"}`, 'source_types', JEV, warn, 'has space'), { model: D1, fallback: JEV }, 'an invalid stored name is ignored');
  assert.deepEqual(classifierEngines('', 'source_types', JEV, warn, null), { model: JEV, fallback: null });
});

test('Semantic Branding has two Admin functions: the attribute wizard and the reading of an answer in prose (8/11/2026)', () => {
  assert.deepEqual(CLASSIFIER_FUNCTIONS.filter((fn) => fn.id.startsWith('semantic_')).map((fn) => fn.id), ['semantic_attributes', 'semantic_reader']);
});
