'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * A list that shows only the rows that fit completely in the height its card was given.
 * The card gets that height from the grid (it ends on the same line as the column beside it),
 * so a taller or shorter neighbour shows more or fewer rows instead of an empty gap or a
 * half-cut row. When the card is not height-constrained (stacked layout) at most `stackedLimit`
 * rows are shown.
 */
export function FitList({
  children,
  className,
  stackedLimit = 5,
  wideQuery = '(min-width: 1251px)',
}: {
  children: ReactNode;
  className?: string;
  stackedLimit?: number;
  wideQuery?: string;
}) {
  const body = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const container = body.current,
      items = list.current;
    if (!container || !items) return;
    const fit = () => {
      const rows = [...items.children] as HTMLElement[];
      for (const row of rows) row.hidden = false;
      const limit = window.matchMedia(wideQuery).matches ? rows.length : Math.min(rows.length, stackedLimit);
      const bottom = container.clientHeight - Number.parseFloat(getComputedStyle(items).paddingBottom || '0');
      let visible = 0;
      for (const [index, row] of rows.entries()) {
        if (index >= limit || (visible > 0 && row.offsetTop + row.offsetHeight > bottom)) break;
        visible++;
      }
      rows.forEach((row, index) => {
        row.hidden = index >= Math.max(1, visible);
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  });
  return (
    <div ref={body} className="live-recent-body">
      <ul ref={list} className={className}>
        {children}
      </ul>
    </div>
  );
}
