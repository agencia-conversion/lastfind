import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exampleTopic, languageName, wizardCountry } from '../lib/new-project.ts';

test('the wizard starts on the open project country, then the browser region, then the interface market', () => {
  assert.equal(wizardCountry(2826, ['pt-BR'], 'pt-BR'), 2826);
  assert.equal(wizardCountry(null, ['de-DE', 'en'], 'en'), 2276);
  assert.equal(wizardCountry(undefined, ['pt-PT'], 'en'), 2620);
  // No region in the browser languages (or an unknown one): the interface decides.
  assert.equal(wizardCountry(null, ['en', 'xx-ZZ', 'not a tag'], 'pt-BR'), 2076);
  assert.equal(wizardCountry(null, [], 'en'), 2840);
  // A code that is not an offered country is ignored.
  assert.equal(wizardCountry(1, ['es-MX'], 'en'), 2484);
});

test('topics are written in the project language, never the interface language', () => {
  // Portuguese interface, English project (market United States): the example is English, the note in Portuguese.
  assert.equal(exampleTopic('en'), 'CRM software');
  assert.equal(languageName('en', 'pt-BR'), 'inglês');
  // English interface, Portuguese project (market Brazil): Portuguese example, the note in English.
  assert.equal(exampleTopic('pt'), 'software de CRM');
  assert.equal(languageName('pt', 'en'), 'Portuguese');
});

test('the wizard suggests with the model only (12/11/2026): no template prompts, centred in the main content', () => {
  const wizard = readFileSync(new URL('../components/analytics/new-project-wizard.tsx', import.meta.url), 'utf8');
  assert.match(wizard, /'\/api\/onboarding\/suggestions'/);
  assert.doesNotMatch(readFileSync(new URL('../lib/new-project.ts', import.meta.url), 'utf8'), /suggestedPrompts|Quais são as melhores opções/);
  assert.doesNotMatch(wizard, /suggestedPrompts/);
  assert.match(readFileSync(new URL('../components/analytics/new-project-wizard.css', import.meta.url), 'utf8'), /\.new-project-wizard \{[^}]*margin-inline: auto;/);
});
