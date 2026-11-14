import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesBrand, mentionOffsets } from '../lib/metrics.ts';
import { extractBrandMentions } from '../lib/competitor-discovery.ts';
import type { BrandTarget } from '../lib/types.ts';

// The project's own brand and its listed competitors are found in every answer by text alone, besides the discovery.
const own: BrandTarget = { name: 'Conversion', domain: 'conversion.com.br', aliases: ['Agência Conversion'] };
const rival: BrandTarget = { name: 'Rock Content', domain: 'rockcontent.com', aliases: ['RockContent'] };
const mentions = (answer: string, targets: BrandTarget[]) => Object.fromEntries(targets.map((target) => [target.name, matchesBrand(answer, target)]));

await test('a listed brand the discovery skips is still found', () => {
  // Written in lowercase in running text: the discovery never takes it as a name, the project's list does.
  const answer = 'Para conteúdo, muita gente contrata a rock content; para SEO técnico, a Conversion.';
  assert.ok(!extractBrandMentions(answer).some((mention) => mention.key.includes('rock')));
  assert.deepEqual(mentions(answer, [own, rival]), { Conversion: true, 'Rock Content': true });
  assert.deepEqual(mentions('Rock-Content e Rock‑Content publicam guias.', [rival]), { 'Rock Content': true });
  assert.deepEqual(mentions('Rock  Content\npublica guias.', [rival]), { 'Rock Content': true });
});

await test('a name inside another word is not a mention', () => {
  assert.equal(matchesBrand('Conversional design and reconversion.', own), false);
  assert.equal(matchesBrand('The Rock Contentful stack.', rival), false);
  assert.equal(matchesBrand('Use Contentful.', { name: 'Content', domain: '' }), false);
  // A link or a sources list is not prose.
  assert.equal(matchesBrand('Veja [o guia](https://rockcontent.com/blog).', rival), false);
});

await test('aliases count as the brand, and the first of its names gives the offset', () => {
  assert.equal(matchesBrand('A RockContent lançou um curso.', rival), true);
  assert.equal(matchesBrand('A agência conversion atende o varejo.', own), true);
  const [offset] = mentionOffsets('Primeiro a RockContent, depois a Rock Content.', [[rival.name, ...rival.aliases!]]);
  assert.equal(offset, 'Primeiro a '.length);
});

await test('accents, case, apostrophes and "&" spacing fold to one spelling', () => {
  assert.equal(matchesBrand('A AGENCIA CONVERSION é citada.', own), true);
  assert.equal(matchesBrand('Natura e São João Distribuidora.', { name: 'Sao Joao Distribuidora', domain: '' }), true);
  assert.equal(matchesBrand('Prefiro o McDonald’s.', { name: "McDonald's", domain: '' }), true);
  assert.equal(matchesBrand("Prefiro o McDonald's.", { name: 'McDonald’s', domain: '' }), true);
  assert.equal(matchesBrand('A AT & T e a P&G.', { name: 'AT&T', domain: '' }), true);
  assert.equal(matchesBrand('A Procter&Gamble.', { name: 'Procter & Gamble', domain: '' }), true);
  assert.equal(matchesBrand('A Coca Cola lidera.', { name: 'Coca-Cola', domain: '' }), true);
  // Words still have to be next to each other.
  assert.equal(matchesBrand('A Coca é Cola.', { name: 'Coca-Cola', domain: '' }), false);
});
