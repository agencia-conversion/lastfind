import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRY_CODES, countryFlag, countryIso, countryLanguage, countryName, countryOptions, isCountryCode } from '../lib/countries.ts';
import { availableEngines, engineCollectsIn, engineUnavailable, ENGINES } from '../lib/engines.ts';
import { providerPayload } from '../lib/provider-contract.ts';
import { localizeApiError } from '../lib/server/errors-i18n.ts';

void test('one country table: DataForSEO location_code is 2000 + the ISO numeric code, named by the interface language', () => {
  assert.equal(COUNTRY_CODES.length, 213);
  assert.equal(new Set(COUNTRY_CODES).size, 213);
  for (const [code, iso] of [[2076, 'BR'], [2840, 'US'], [2826, 'GB'], [2276, 'DE'], [2484, 'MX'], [2392, 'JP'], [2004, 'AF'], [2654, 'SH']] as const)
    assert.equal(countryIso(code), iso);
  // DataForSEO no longer serves Russia or Belarus; regions and cities are not countries.
  for (const code of [2643, 2112, 1001773, 2158, 0]) assert.equal(isCountryCode(code), false);
  assert.equal(isCountryCode('2076'), false);
  assert.equal(countryName(2826, 'en'), 'United Kingdom');
  assert.equal(countryName(2826, 'pt-BR'), 'Reino Unido');
  assert.equal(countryName(2276, 'pt-BR'), 'Alemanha');
  assert.equal(countryFlag(2076), '🇧🇷');
  for (const code of COUNTRY_CODES) for (const locale of ['en', 'pt-BR'] as const) assert.notEqual(countryName(code, locale), countryIso(code));
  for (const locale of ['en', 'pt-BR'] as const) {
    const names = countryOptions(locale).map((item) => item.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, locale)));
  }
  assert.equal(countryOptions('pt-BR')[0].name, 'Afeganistão');
  assert.deepEqual([2076, 2620, 2024, 2508].map(countryLanguage), ['pt', 'pt', 'pt', 'pt']);
  assert.deepEqual([2840, 2826, 2276, 2484, 2392].map(countryLanguage), ['en', 'en', 'en', 'en', 'en']);
});

void test('an AI that cannot collect in the project country is unavailable for it, never asked', () => {
  // The three countries offered before keep every AI.
  for (const code of [2076, 2840, 2826]) assert.deepEqual(availableEngines([...ENGINES], code), [...ENGINES]);
  // Every AI answers in both languages since 7/11/2026 (Gemini's interface in Portuguese, asked as pt-BR): only the country decides.
  assert.equal(engineUnavailable('gemini', 2076), null);
  assert.equal(engineUnavailable('chat_gpt', 2862), 'country'); // Venezuela: not in ChatGPT's locations
  assert.equal(engineUnavailable('claude', 2024), null); // Angola: the pure model has no country
  assert.equal(engineUnavailable('claude', 2276), null);
  assert.equal(engineUnavailable('google_ai_mode', 2156), 'country'); // China: no AI Mode
  assert.equal(engineUnavailable('google_ai_overviews', 2156), 'country');
  assert.equal(engineUnavailable('perplexity', 2156), null);
  assert.equal(engineCollectsIn('perplexity', 999), false);
  assert.deepEqual(availableEngines([...ENGINES], 2024), [...ENGINES]);
  // Every offered country has at least one AI.
  for (const code of COUNTRY_CODES) assert.ok(ENGINES.some((engine) => engineCollectsIn(engine, code)), String(code));
});

void test('the provider receives the project country and the API names an unavailable AI in both languages', () => {
  const row = { id: 'x', prompt_text: 'Best tools?', language_code: 'en', location_code: 2276 } as const;
  assert.equal((providerPayload({ ...row, engine: 'perplexity' }) as Record<string, unknown>).web_search_country_iso_code, 'DE');
  assert.equal((providerPayload({ ...row, engine: 'chat_gpt' }) as Record<string, unknown>).location_code, 2276);
  assert.equal(localizeApiError("ChatGPT is not available in this project's country.", 'pt-BR'), 'ChatGPT não está disponível no país deste projeto.');
  assert.equal(
    localizeApiError('Remove ChatGPT, Claude monitoring before changing this project country.', 'pt-BR'),
    'Remova o monitoramento de ChatGPT, Claude antes de alterar o país deste projeto.',
  );
  assert.equal(localizeApiError("Copilot is not available in this project's country.", 'en'), 'Could not complete this operation. Please try again.');
});
