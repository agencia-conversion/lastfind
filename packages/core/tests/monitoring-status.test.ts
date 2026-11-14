import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monitoringStatus,
  formatMonitoringTime,
} from '../lib/monitoring-status.ts';
import { workspaceFixture } from './fixtures/workspace.ts';
function fixture() {
  const w = workspaceFixture();
  w.prompts = w.prompts.slice(0, 1);
  w.runs = [];
  w.prompts[0].next_run_at = '2026-09-05T22:26:24.659Z';
  w.config.schedulerLastSeen = '2026-09-05T12:07:50.060Z';
  return w;
}
void test('daily monitoring is not overdue the next morning, even when cron health is stale', () => {
  const w = fixture(),
    result = monitoringStatus(w, Date.parse('2026-09-05T13:39:00Z'));
  assert.equal(result.overdue, false);
  assert.equal(result.stale, true);
  assert.equal(result.title, 'Acompanhamento automático');
  assert.ok(result.description.includes('19:26'));
});
void test('a due prompt after the grace period is shown as waiting, not all up to date', () => {
  const result = monitoringStatus(
    fixture(),
    Date.parse('2026-09-05T23:00:00Z'),
  );
  assert.equal(result.overdue, true);
  assert.equal(result.title, 'Atualização aguardando execução');
});
void test('pause, quota and pending work take precedence over scheduled-time messaging', () => {
  const w = fixture();
  w.projects[0].daily_enabled = 0;
  assert.equal(monitoringStatus(w, 0).title, 'Acompanhamento pausado');
  w.projects[0].daily_enabled = 1;
  w.usage.limit = 100;
  w.usage.used = 100;
  assert.equal(monitoringStatus(w, 0).title, 'Limite mensal atingido');
  w.runs = [{ ...workspaceFixture().runs[0], status: 'pending' }];
  assert.equal(monitoringStatus(w, 0).title, 'Preparando suas respostas');
});
void test('schedule times are explicitly consistent in Brasilia', () => {
  assert.ok(formatMonitoringTime('2026-09-05T22:26:24.659Z').includes('19:26'));
});
