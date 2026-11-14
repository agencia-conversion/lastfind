import { isEngine, SCRAPED_ENGINES, type Engine } from '@/lib/engines';
import { ApiError } from './http';

const statuses = [
  'all',
  'queued',
  'submitting',
  'pending',
  'complete',
  'failed',
  'unknown',
];

/** The topics a read is filtered by: `topic` repeated, one name each (a name may hold a comma), at most 20 of up to 100 characters. */
export function reportTopics(q: URLSearchParams) {
  const topics = [...new Set(q.getAll('topic').map((topic) => topic.trim()).filter(Boolean))];
  if (topics.length > 20 || topics.some((topic) => topic.length > 100)) throw new ApiError(400, 'Invalid topic filter.');
  return topics;
}

export function parseReportFilter(q: URLSearchParams) {
  let days = Number(q.get('days') || 30);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new ApiError(400, 'Choose a period from 1 to 90 days.');
  // Only the AIs collected today (SCRAPED_ENGINES): every read keeps to them, so an AI switched off (Claude, Perplexity, 8/11/2026)
  // never shows nor counts, though its rows stay stored. "All" is all of them; one switched off is dropped from a list, and a list of
  // only those reads nothing (an empty `engine`), never every AI.
  const asked = q.get('engine') || 'all';
  const engines = asked === 'all' ? [...SCRAPED_ENGINES] : [...new Set(asked.split(','))];
  if (engines.some((value) => !isEngine(value)))
    throw new ApiError(400, 'Invalid AI channel.');
  const engine = engines.filter((value) => SCRAPED_ENGINES.includes(value as Engine)).join(',');
  const status = q.get('status') || 'all';
  if (!statuses.includes(status))
    throw new ApiError(400, 'Invalid response status.');
  const mention = q.get('mention') || 'all';
  if (!['all', 'mentioned', 'missing'].includes(mention))
    throw new ApiError(400, 'Invalid mention filter.');
  const gap = q.get('gap') || 'all';
  if (!['all', 'competitor-only'].includes(gap))
    throw new ApiError(400, 'Invalid opportunity filter.');
  const sourceKind = q.get('sourceKind') || 'cited';
  const sourceGroup = q.get('sourceGroup') || 'domain';
  if (
    !['cited', 'consulted'].includes(sourceKind) ||
    !['domain', 'url'].includes(sourceGroup)
  )
    throw new ApiError(400, 'Invalid source filter.');
  const customStart = q.get('start');
  const customEnd = q.get('end');
  const dateBoundary = (value: string, inclusiveEnd = false) => {
    const isDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = Date.parse(isDay ? `${value}T00:00:00.000Z` : value);
    if (
      !Number.isFinite(date) ||
      (isDay && new Date(date).toISOString().slice(0, 10) !== value)
    )
      throw new ApiError(400, 'Invalid report date.');
    return new Date(
      date + (isDay && inclusiveEnd ? 86400000 : 0),
    ).toISOString();
  };
  if (!!customStart !== !!customEnd)
    throw new ApiError(400, 'Choose both dates for a custom period.');
  const end = customEnd
    ? dateBoundary(customEnd, true)
    : new Date().toISOString();
  const cutoff = customStart
    ? dateBoundary(customStart)
    : new Date(Date.parse(end) - days * 86400000).toISOString();
  days = Math.round((Date.parse(end) - Date.parse(cutoff)) / 86400000);
  if (days < 1 || days > 90)
    throw new ApiError(400, 'Choose a period from 1 to 90 days.');
  // The comparison: the period of the same length right before, or `compareStart`/`compareEnd` (days, both included), which
  // must start before the period. Its end is held to the period's start, so a rolling period's first hours belong to one only.
  const compareStart = q.get('compareStart');
  const compareEnd = q.get('compareEnd');
  if (!!compareStart !== !!compareEnd)
    throw new ApiError(400, 'Choose both dates for the comparison period.');
  const previousCutoff = compareStart
    ? dateBoundary(compareStart)
    : new Date(Date.parse(cutoff) - (Date.parse(end) - Date.parse(cutoff))).toISOString();
  const askedPreviousEnd = compareEnd ? dateBoundary(compareEnd, true) : cutoff;
  const compareDays = (Date.parse(askedPreviousEnd) - Date.parse(previousCutoff)) / 86400000;
  if (compareStart && (compareDays < 1 || compareDays > 90 || previousCutoff >= cutoff))
    throw new ApiError(400, 'Choose a comparison period of 1 to 90 days that starts before the period.');
  return {
    days,
    engine,
    status,
    mention,
    gap,
    sourceKind,
    sourceGroup,
    end,
    cutoff,
    previousCutoff,
    /** End of the comparison (exclusive): `cutoff` unless a comparison period was chosen. */
    previousEnd: askedPreviousEnd < cutoff ? askedPreviousEnd : cutoff,
  };
}
