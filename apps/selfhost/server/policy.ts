import { ENGINES } from '@/lib/engines';
import type { Capabilities } from '@/lib/types';
import { positiveLimit } from '@/lib/scheduling';
import { setting } from '@/lib/server/env';
export const providerSettings = true;
export async function accountCapabilities(_owner: string): Promise<Capabilities> { return {engines: [...ENGINES], promptLimit: null, topicLimit: null}; }
export function capacityGuards(_owner: string): D1PreparedStatement[] { return []; }
export async function allowedPromptIds(_owner: string): Promise<Set<string> | null> { return null; }
export async function syncAccess(): Promise<void> {}
export function monthlyRunLimit() { return positiveLimit(setting('SELF_HOST_MONTHLY_LIMIT'), 1500); }
export function budgetCondition(_owner: string, _month: string, _credits: number) { return {sql: '1=1', params: [] as (string | number)[]}; }
export async function usageWindow(_owner: string) { return {periodStart: new Date().toISOString().slice(0,7)+'-01T00:00:00.000Z', creditsLimit: null, limit: monthlyRunLimit()}; }
export function policyError(_message: string): string | null { return null; }
