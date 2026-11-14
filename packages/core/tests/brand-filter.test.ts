import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_BRANDS, brandFilterActive, brandShown, readBrandFilter, toggleBrand, writeBrandFilter } from '../lib/brand-filter.ts';

test('the header Brands filter: every brand, the monitored ones, or the ones picked; the own brand always', () => {
  assert.deepEqual(readBrandFilter(null), ALL_BRANDS);
  assert.equal(brandFilterActive(readBrandFilter('')), false);
  const monitored = readBrandFilter('monitored,max');
  assert.equal(brandShown(monitored, 'netflix', 'own'), true);
  assert.equal(brandShown(monitored, 'globoplay', 'monitored'), true);
  assert.equal(brandShown(monitored, 'max', 'discovered'), true);
  assert.equal(brandShown(monitored, 'apple tv', 'discovered'), false);
  const hidden = readBrandFilter('-globoplay');
  assert.equal(brandShown(hidden, 'globoplay', 'monitored'), false);
  assert.equal(brandShown(hidden, 'apple tv', 'discovered'), true);
  const picked = readBrandFilter('picked,max,-ignored');
  assert.deepEqual(picked, { base: 'picked', show: ['max'], hide: [] });
  assert.equal(brandShown(picked, 'globoplay', 'monitored'), false);
  assert.equal(brandShown(picked, 'netflix', 'own'), true);
  assert.equal(brandShown(picked, 'max', 'discovered'), true);
});

test('toggling keeps only the exceptions to the base, and the address round-trips', () => {
  let filter = toggleBrand(ALL_BRANDS, 'globoplay', 'monitored', false);
  assert.equal(writeBrandFilter(filter), '-globoplay');
  filter = toggleBrand(filter, 'globoplay', 'monitored', true);
  assert.equal(writeBrandFilter(filter), '');
  filter = toggleBrand({ ...ALL_BRANDS, base: 'monitored' }, 'disney+', 'discovered', true);
  assert.equal(writeBrandFilter(filter), 'monitored,disney+');
  assert.deepEqual(readBrandFilter(writeBrandFilter(filter)), filter);
  filter = toggleBrand(filter, 'disney+', 'discovered', false);
  assert.equal(writeBrandFilter(filter), 'monitored');
});

test('the header menu lists every brand, no cap, and a search narrows them by name or domain', async () => {
  const { brandsListed } = await import('../lib/brand-filter.ts');
  const brands = Array.from({ length: 57 }, (_, index) => ({ key: `b${index}`, name: index === 10 ? 'Café Orbital' : `Brand ${index}`, domain: index === 11 ? 'rival.test' : `b${index}.test` }));
  assert.equal(brandsListed(brands, '').size, 57, 'the own brand, 6 monitored and 50 discoveries: all listed, the menu scrolls');
  assert.deepEqual([...brandsListed(brands, 'cafe')], ['b10'], 'accents and case aside');
  assert.deepEqual([...brandsListed(brands, 'RIVAL.t')], ['b11'], 'by domain');
  assert.equal(brandsListed(brands, 'brand').size, 56);
  assert.equal(brandsListed(brands, 'zzz').size, 0);
});
