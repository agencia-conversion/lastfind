import * as edition from '@edition/server/policy';
import type { Capabilities } from '@/lib/types';
export const accountCapabilities: (owner: string) => Promise<Capabilities> =
  edition.accountCapabilities;
export const capacityGuards: (owner: string) => D1PreparedStatement[] =
  edition.capacityGuards;
export const allowedPromptIds: (owner: string) => Promise<Set<string> | null> =
  edition.allowedPromptIds;
export const syncAccess: () => Promise<void> = edition.syncAccess;
export const monthlyRunLimit: () => number = edition.monthlyRunLimit;
export const budgetCondition: (
  owner: string,
  month: string,
  credits: number,
) => { sql: string; params: (string | number)[] } = edition.budgetCondition;
export const usageWindow: (
  owner: string,
) => Promise<{
  periodStart: string;
  creditsLimit: number | null;
  limit: number | null;
}> = edition.usageWindow;
export const providerSettings: boolean = edition.providerSettings;
export const policyError: (message: string) => string | null =
  edition.policyError;
