import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSemanticReadings, semanticRequest, validateSemanticConfiguration,
} from '../lib/semantic-evaluation.ts';

const targets = [{ name: 'Netflix', domain: 'netflix.com' }];
const config = validateSemanticConfiguration({
  enabled: true,
  attributes: [{ id: 'value', name: 'Value for money', description: 'Price compared with catalog.' }],
});

test('semantic grades require an exact quote and cannot turn missing evidence into zero', () => {
  const answer = 'Netflix has a broad catalog, but its premium tier costs more than many alternatives.';
  const request = semanticRequest(answer, targets, config);
  assert.equal(request.payload.web_search, false);
  assert.ok(request.payload.message_chain.every((part) => part.message.length <= 500));
  assert.deepEqual(parseSemanticReadings(JSON.stringify({ readings: [{
    brand: 'Netflix', attribute: 'value', state: 'assessed', score: 50,
    quote: 'its premium tier costs more than many alternatives', reason: 'Mixed value signal',
  }] }),targets,config,request.excerpt)[0].score,50);
  assert.throws(() => parseSemanticReadings(JSON.stringify({ readings: [{
    brand: 'Netflix', attribute: 'value', state: 'assessed', score: 100,
    quote: 'Netflix is the best value', reason: 'Invented',
  }] }),targets,config,request.excerpt),/evidence/);
  assert.throws(() => parseSemanticReadings(JSON.stringify({ readings: [{
    brand: 'Netflix', attribute: 'value', state: 'insufficient', score: 0,
    quote: null, reason: 'No evidence',
  }] }),targets,config,request.excerpt),/cannot have a score/);
});

test('configuration revisions cannot accept duplicate or malformed attributes', () => {
  assert.throws(() => validateSemanticConfiguration({ enabled: true, attributes: [] }),/one to ten/);
  assert.throws(() => validateSemanticConfiguration({ enabled: true, attributes: [
    { id: 'value', name: 'Value' }, { id: 'value', name: 'Value again' },
  ] }),/unique/);
});
