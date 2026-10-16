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

test('semantic instructions state the strict evidence contract and reconstruct bounded fragments verbatim', () => {
  const brands = Array.from({ length: 6 }, (_, i) => ({ name: `Brand ${i}`, domain: `brand${i}.example` }));
  const configuration = validateSemanticConfiguration({ enabled: true, attributes: Array.from({ length: 5 }, (_, i) => ({ id: `attribute-${i}`, name: `Attribute ${i}` })) });
  const answer = 'Brand 0 is a clear recommendation. '.repeat(110);
  const request = semanticRequest(answer, brands, configuration);
  const payload = request.payload;
  assert.ok(payload.system_message.length <= 500);
  assert.ok(payload.user_prompt.length <= 500);
  assert.ok(payload.message_chain.length <= 10);
  assert.ok(payload.message_chain.every((part) => part.message.length <= 500));
  assert.match(payload.system_message, /Join META parts and ANSWER parts separately in order, without inserting or changing characters/);
  assert.match(payload.user_prompt, /verbatim ANSWER excerpt, 8-240 characters/);
  assert.match(payload.user_prompt, /reason.*at most 240 characters/);
  assert.match(payload.user_prompt, /insufficient\/ambiguous, score and quote must both be null/);
  assert.equal(payload.message_chain.filter((part) => part.message.startsWith('ANSWER ')).map((part) => part.message.slice(7)).join(''), request.excerpt);
  const readings = brands.flatMap((brand) => configuration.attributes.map((attribute) => ({ brand: brand.name, attribute: attribute.id, state: 'insufficient', score: null, quote: null, reason: 'No association evidence.' })));
  assert.equal(parseSemanticReadings(JSON.stringify({ readings }), brands, configuration, request.excerpt).length, 30);
  const assessed = { ...readings[0], state: 'assessed', score: 75, quote: 'Brand 0 is a clear recommendation.' };
  assert.equal(parseSemanticReadings(JSON.stringify({ readings: [assessed, ...readings.slice(1)] }), brands, configuration, request.excerpt)[0].score, 75);
  for (const size of [8, 240])
    assert.equal(parseSemanticReadings(JSON.stringify({ readings: [{ ...assessed, quote: answer.slice(0, size) }, ...readings.slice(1)] }), brands, configuration, request.excerpt)[0].quote?.length, size);
  assert.throws(() => parseSemanticReadings(JSON.stringify({ readings: [{ ...assessed, score: 80 }, ...readings.slice(1)] }), brands, configuration, request.excerpt), /evidence/);
  assert.throws(() => parseSemanticReadings(JSON.stringify({ readings: [{ ...assessed, reason: 'x'.repeat(241) }, ...readings.slice(1)] }), brands, configuration, request.excerpt), /Invalid semantic reading/);
  for (const quote of ['Brand 0', 'x'.repeat(241), 'A quote absent from the answer'])
    assert.throws(() => parseSemanticReadings(JSON.stringify({ readings: [{ ...assessed, quote }, ...readings.slice(1)] }), brands, configuration, request.excerpt), /evidence/);
});
