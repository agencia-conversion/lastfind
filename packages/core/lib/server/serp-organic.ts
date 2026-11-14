import { serpDomains, type SerpDomain } from '@/lib/brand-domain';
import { provider, ProviderError } from './dataforseo';

/**
 * One live Google organic search (top 10) in the project's country and language, through the shared
 * DataForSEO client: it sends the request once and never repeats a call that may have been billed.
 * `google_ai_overviews` is only the engine whose base path is `serp/google/organic`; no AI Overview is asked for.
 * Live (US$ 0.002) rather than the queue (US$ 0.0006): the queue answers minutes later, which would need a second
 * state machine and polling for a difference of cents per brand, capped per project by the ceiling.
 */
export async function googleOrganicTop10(
  keyword: string,
  locationCode: number,
  languageCode: string,
): Promise<{ results: SerpDomain[]; cost: number | null }> {
  const [task] = await provider('google_ai_overviews', 'live/regular', [
    { keyword, location_code: locationCode, language_code: languageCode, depth: 10 },
  ]);
  if (!task || task.status_code !== 20000)
    throw new ProviderError(`DataForSEO task ${task?.status_code ?? 'missing'}: ${task?.status_message ?? 'no task'}`, task?.status_code ?? 0, false);
  // A reply without a usable cost keeps the whole reserve (unsettled) instead of being trusted as free.
  const cost = typeof task.cost === 'number' && Number.isFinite(task.cost) && task.cost >= 0 ? task.cost : null;
  return { results: serpDomains(task.result), cost };
}
