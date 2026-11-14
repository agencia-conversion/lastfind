import { brandDetectionKey, discoverCompetitors, looksLikeName } from './competitor-discovery.ts';
import { brandProse, matchesBrand, sliceUnicode } from './metrics.ts';
import type { BrandTarget } from './types.ts';

export const RESEARCH_SHORTLIST_VERSION = 'per-answer-structure-v5';
export const RESEARCH_SHORTLIST_CHARACTERS = 16000;
/**
 * The closed identity options of one answer for typed research: the names the free detector finds in
 * it (items first, then names of running text), plus identities accepted before that the answer's prose
 * mentions. At most ten; `fullCoverage` is false when the answer was longer than the bounded prefix.
 */
export function researchCandidateShortlist(
  answer: string,
  targets: BrandTarget[],
  known: { name: string; domain: string | null }[] = [],
) {
  const bounded = sliceUnicode(answer, 0, RESEARCH_SHORTLIST_CHARACTERS),
    prose = brandProse(bounded);
  const found = discoverCompetitors([{ id: 'answer', answer: bounded, sources: [], createdAt: '' }], targets, { maxCandidates: 50 })
    .filter((candidate) => matchesBrand(prose, { name: candidate.name, domain: candidate.domain || '' }));
  const candidates: { name: string; domain: string | null; key?: string; ambiguous?: boolean; reasons?: string[] }[] = found.map(
    ({ name, key, ambiguous, reasons, domain }) => ({ name, key, ambiguous, reasons, domain }),
  );
  for (const candidate of known) {
    const key = brandDetectionKey(candidate.name);
    if (
      looksLikeName(candidate.name, true) &&
      // The same name with another domain is another identity: both stay options.
      !candidates.some((item) => item.name === candidate.name && item.domain === candidate.domain) &&
      matchesBrand(prose, { name: candidate.name, domain: candidate.domain || '' })
    )
      candidates.push({ ...candidate, key, ambiguous: true, reasons: ['Previously accepted identity mentioned in prose; not extracted in this answer.'] });
  }
  return { candidates: candidates.slice(0, 10), fullCoverage: answer.length === bounded.length };
}
