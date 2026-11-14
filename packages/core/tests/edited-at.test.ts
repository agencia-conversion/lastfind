import test from 'node:test';
import assert from 'node:assert/strict';
import { editedAt } from '../lib/report-date.ts';

// The artifact header's "Edited 5 minutes ago" (docs/design/shell.md section 4), in both languages.
test('an edit reads from now, by the calendar of the browser, with the full date for the tooltip', () => {
  const now = new Date(2026, 10, 2, 15, 30).getTime();
  const at = (date: Date, locale = 'en') => editedAt(date.toISOString(), locale, false, now)!.caption;
  assert.equal(at(new Date(2026, 10, 2, 15, 29, 40)), 'Edited just now');
  assert.equal(at(new Date(2026, 10, 2, 15, 35)), 'Edited just now');
  assert.equal(at(new Date(2026, 10, 2, 15, 25)), 'Edited 5 minutes ago');
  assert.equal(at(new Date(2026, 10, 2, 15, 25), 'pt-BR'), 'Última edição há 5 minutos');
  assert.equal(at(new Date(2026, 10, 2, 12, 10)), 'Edited 3 hours ago');
  assert.equal(at(new Date(2026, 10, 1, 23, 50)), 'Edited yesterday');
  assert.equal(at(new Date(2026, 10, 1, 23, 50), 'pt-BR'), 'Última edição ontem');
  assert.equal(at(new Date(2026, 9, 28, 9, 0)), 'Edited Oct 28');
  assert.equal(at(new Date(2026, 9, 28, 9, 0), 'pt-BR'), 'Última edição em 28 de out.');
  assert.equal(at(new Date(2025, 9, 28, 9, 0)), 'Edited Oct 28, 2025');
  assert.equal(at(new Date(2025, 9, 28, 9, 0), 'pt-BR'), 'Última edição em 28 de out. de 2025');
  const agent = editedAt(new Date(2026, 10, 2, 10, 7).toISOString(), 'en', true, now)!.full;
  assert.equal(agent, 'Edited by the agent on Nov 2, 2026, 10:07 AM');
  assert.equal(editedAt(new Date(2026, 10, 2, 10, 7).toISOString(), 'pt-BR', true, now)!.full, 'Última edição pelo agente em 2 de nov. de 2026, 10:07');
  assert.equal(editedAt(new Date(2026, 10, 2, 10, 7).toISOString(), 'pt-BR', false, now)!.full, 'Última edição em 2 de nov. de 2026, 10:07');
});

// A Lastfind skill the workspace never changed has no edit date: its page opened on a crash ("We could not open this page").
test('no date reads as no edit, never a thrown RangeError', () => {
  assert.equal(editedAt(null, 'en', false), null);
  assert.equal(editedAt(undefined, 'pt-BR', true), null);
  assert.equal(editedAt('not a date', 'en', false), null);
});
