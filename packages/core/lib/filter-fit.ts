/**
 * The top bar's filters that fit beside the path: every one when the row fits; otherwise the first ones, in their
 * order, that fit together with the Filters button that holds the rest. Returns how many stay in the bar.
 */
export function filtersThatFit(widths: readonly number[], gap: number, available: number, toggle: number): number {
  const all = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
  if (all <= available) return widths.length;
  const room = available - toggle - gap;
  let used = 0;
  let shown = 0;
  for (const width of widths) {
    const next = used + (shown ? gap : 0) + width;
    if (next > room) break;
    used = next;
    shown++;
  }
  return shown;
}
