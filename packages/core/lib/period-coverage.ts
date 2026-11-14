/**
 * The one rule for a change against an earlier period (10/11/2026): the earlier period is compared only when it measured at
 * least half as many answers as the current one. Fewer (Conversion's 140 against 3,464 showed "+5.4 pp"; a brand the
 * analysis had not read then showed its whole value as growth) is "no comparison", never a change from a thin base or a zero.
 */
export const MIN_PREVIOUS_COVERAGE = 0.5;

/** Whether the earlier period's measured answers are enough to compare with the current one's. */
export function coveredPeriods(previous: number | null | undefined, current: number | null | undefined) {
  return !!previous && !!current && previous >= current * MIN_PREVIOUS_COVERAGE;
}

/** Why there is no change, for the info balloon: the earlier period had answers, too few to compare. */
export function thinPeriodNote(t: (en: string, pt: string) => string, period: string, previous: string, current: string) {
  return t(
    `No comparison: ${period} measured ${previous} answers against ${current} now, fewer than half.`,
    `Sem comparação: o ${period} mediu ${previous} respostas ante ${current} agora, menos da metade.`,
  );
}
