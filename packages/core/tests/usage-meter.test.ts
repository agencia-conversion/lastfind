import test from 'node:test';
import assert from 'node:assert/strict';
import { usageMeter } from '../lib/usage-meter.ts';

test('finite usage clamps the percentage and changes state at 80% and 100%', () => {
  for (const [used, limit, value, state] of [
    [0, 150, 0, 'normal'],
    [103, 150, (103 / 150) * 100, 'normal'],
    [79, 100, 79, 'normal'],
    [80, 100, 80, 'warning'],
    [99, 100, 99, 'warning'],
    [100, 100, 100, 'reached'],
    [120, 100, 100, 'reached'],
    [0, 0, 100, 'reached'],
    [-1, 100, 0, 'normal'],
  ] as const) {
    const meter = usageMeter(used, limit, 'en');
    assert.equal(meter.value, value);
    assert.equal(meter.state, state);
  }
});

test('unlimited usage has a localized count and no percentage', () => {
  assert.deepEqual(usageMeter(2639, null, 'en'), {
    state: 'unlimited',
    value: undefined,
    text: '2,639 (Unlimited)',
  });
  assert.deepEqual(usageMeter(2639, null, 'pt-BR'), {
    state: 'unlimited',
    value: undefined,
    text: '2.639 (Ilimitado)',
  });
  assert.equal(usageMeter(0, null, 'en').state, 'unlimited');
});

test('missing usage or limit stays unknown instead of becoming zero or unlimited', () => {
  for (const [used, limit] of [
    [undefined, undefined],
    [undefined, null],
    [undefined, 10],
    [3, undefined],
  ] as const) {
    assert.deepEqual(usageMeter(used, limit, 'en'), {
      state: 'unknown',
      value: undefined,
      text: '—',
    });
  }
});

test('finite usage and limit both use the selected number format', () => {
  assert.equal(usageMeter(2639, 5000, 'en').text, '2,639 / 5,000');
  assert.equal(usageMeter(2639, 5000, 'pt-BR').text, '2.639 / 5.000');
});

test('AI credits are whole on screen, what is left rounded down and what was spent rounded up; a balance says what is left', async () => {
  const { wholeCredits, creditsFormat } = await import('../lib/usage-meter.ts');
  assert.deepEqual([wholeCredits(4879.2, 'left'), wholeCredits(120.2, 'used'), wholeCredits(120, 'used'), wholeCredits(0.0001, 'used'), Object.is(wholeCredits(0, 'used'), 0)], [4879, 121, 120, 1, true]);
  assert.equal(usageMeter(120.2, 5000, 'pt-BR', creditsFormat('pt-BR', 'left'), { left: true }).text, '4.879 restantes');
  assert.equal(usageMeter(120.2, 5000, 'en', creditsFormat('en', 'used')).text, '121 / 5,000');
  assert.equal(usageMeter(6000, 5000, 'en', undefined, { left: true }).text, '0 left', 'never below zero');
  assert.equal(usageMeter(834.4, null, 'en', creditsFormat('en', 'used'), { left: true }).text, '835 (Unlimited)', 'no limit: what was spent');
});
