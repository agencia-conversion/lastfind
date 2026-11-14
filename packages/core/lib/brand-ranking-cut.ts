/** Overview brand ranking: at most `limit` rows; the project brand keeps its real rank. */
export function cutBrandRanking<T>(
  rows: T[],
  isProject: (row: T) => boolean,
  limit = 6,
): { row: T; rank: number }[] {
  if (rows.length <= limit) {
    return rows.map((row, index) => ({ row, rank: index + 1 }));
  }
  const projectIndex = rows.findIndex(isProject);
  if (projectIndex < 0 || projectIndex < limit) {
    return rows.slice(0, limit).map((row, index) => ({ row, rank: index + 1 }));
  }
  return [
    ...rows.slice(0, limit - 1).map((row, index) => ({ row, rank: index + 1 })),
    { row: rows[projectIndex]!, rank: projectIndex + 1 },
  ];
}

/**
 * Ranking order by the value the card shows (the trend's metric): highest first, lowest first for a position (`lowerIsBetter`);
 * brands without a value last, never as a zero; then by mentions.
 */
export function byRankingValue(lowerIsBetter = false) {
  return <T extends { value: number | null; count: number | null }>(a: T, b: T) =>
    Number(a.value == null) - Number(b.value == null) ||
    (a.value != null && b.value != null ? (lowerIsBetter ? a.value - b.value : b.value - a.value) : 0) ||
    (b.count ?? -1) - (a.count ?? -1);
}
