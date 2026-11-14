/** One prompt's mention position for the Summary row (prompts without a mention stay out). */
export type MentionPositionRow = {
  position?: number | null;
  mentions?: number | null;
  /** Answers the position was measured in (a mention with no place in the text has none); the weight when known. */
  positionSamples?: number | null;
};

/**
 * Weighted average position: Σ(position × measured answers) / Σ(measured answers), the Overview's own average
 * (mentions are the weight only when the measured count is unknown). Ignores prompts with no mention or no measured position.
 */
export function weightedMentionPosition(rows: MentionPositionRow[]): number | null {
  let weighted = 0;
  let weight = 0;
  for (const row of rows) {
    const mentions = row.positionSamples ?? row.mentions ?? 0;
    if (mentions <= 0 || row.position == null) continue;
    weighted += row.position * mentions;
    weight += mentions;
  }
  return weight ? weighted / weight : null;
}
