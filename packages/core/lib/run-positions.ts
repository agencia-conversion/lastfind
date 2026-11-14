import { mentionOffsets, mentionPositions } from './metrics.ts';
import type { BrandTarget } from './types.ts';

/**
 * Version of the ranking below (3: a monitored brand the answer does not mention, such as "conversion" written as a
 * word, no longer ranks ahead of the brands it does mention). A change bumps it: `run_positions` keys rows by a basis that ends in this suffix, so every
 * answer misses its row and `positions-fill` ranks it again, free. Version 1 adds nothing, so the rows saved before it stay valid.
 */
export const POSITIONS_VERSION: number = 3;
export const POSITIONS_BASIS_SUFFIX = POSITIONS_VERSION > 1 ? `#${POSITIONS_VERSION}` : '';

/**
 * Every brand an answer mentions with a textual rank, as `[domain, 1 for the project's own brand else 0, rank, offset]` rows:
 * the rank among the monitored brands, and where it is first named (version 2), so a report also counts the
 * discoveries named before it (DISCOVERED_BEFORE_SQL) and ranks it among every identified brand.
 * Saved per answer in the project store (`run_positions`) so reports sum ranks in SQL instead of reading the answers.
 */
export function runPositionEntries(answer: string | null, targetsJson: string, mentionsJson: string): string {
  let targets: BrandTarget[];
  let mentions: Record<string, boolean>;
  try {
    targets = JSON.parse(targetsJson);
    mentions = JSON.parse(mentionsJson);
  } catch {
    return '[]';
  }
  if (!Array.isArray(targets)) return '[]';
  if (!mentions || typeof mentions !== 'object') mentions = {};
  // Only the brands the answer mentions rank: the letters of one it does not (a common word) push no one down.
  const offsets = mentionOffsets(answer, targets.map((target) => [target.name, ...(target.aliases || [])])).map((offset, index) => (mentions[targets[index]!.name] ? offset : null));
  const positions = mentionPositions(answer, targets, offsets);
  return JSON.stringify(
    targets.flatMap((target, index) => {
      const position = positions[index];
      return mentions[target.name] && position != null ? [[target.domain, index === 0 ? 1 : 0, position, offsets[index]]] : [];
    }),
  );
}
