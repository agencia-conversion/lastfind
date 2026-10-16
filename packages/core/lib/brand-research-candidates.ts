import {
  extractCompetitorFeatureRows,
  scoreCompetitorFeatureVector,
} from './competitor-discovery.ts';
import { brandProse, matchesBrand, sliceUnicode } from './metrics.ts';
import type { BrandTarget } from './types.ts';

export const RESEARCH_SHORTLIST_VERSION = 'per-answer-local-ranker-v2';
export const RESEARCH_SHORTLIST_CHARACTERS = 16000;
export function researchCandidateShortlist(
  answer: string,
  targets: BrandTarget[],
  known: { name: string; domain: string | null }[] = [],
) {
  const bounded = sliceUnicode(answer, 0, RESEARCH_SHORTLIST_CHARACTERS),
    prose = brandProse(bounded);
  const ranked = extractCompetitorFeatureRows(
    [{ id: 'answer', answer: bounded, sources: [], createdAt: '' }],
    targets,
  )
    .filter((row) =>
      matchesBrand(prose, { name: row.name, domain: row.domain || '' }),
    )
    .map((row) => ({
      name: row.name,
      domain: row.domain,
      score: scoreCompetitorFeatureVector(row.features),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
    );
  const candidates = ranked.map(({ name, domain }) => ({ name, domain }));
  for (const candidate of known)
    if (
      !candidates.some(
        (item) =>
          item.name === candidate.name && item.domain === candidate.domain,
      ) &&
      matchesBrand(prose, {
        name: candidate.name,
        domain: candidate.domain || '',
      })
    )
      candidates.push(candidate);
  return {
    candidates: candidates.slice(0, 10),
    fullCoverage: answer.length === bounded.length,
  };
}
