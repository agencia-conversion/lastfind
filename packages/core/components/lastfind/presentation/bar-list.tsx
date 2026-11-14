'use client';
import type { CSSProperties, ReactNode } from 'react';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';
import './bar-list.css';

export type BarListRow = {
  key: string;
  /** What the bar measures: a topic, a brand with its favicon. */
  label: ReactNode;
  /** 0–100, one scale for every row so they compare; null draws no bar and the figure says why (never a zero). */
  value: number | null;
  /** The figure beside the label, as the screen formats it ("42,3%", "78", "—"); it can be a drill link. */
  figure: ReactNode;
  /** The row in words for screen readers ("Pricing: 42.3%"). */
  text: string;
  /** Why there is no value, in the figure's balloon. */
  missing?: string;
  /** The bar's color token (a brand's series color); the brand's own color (chart-1) by default. */
  color?: string;
  /** A tick on the bar at another value of the same scale (a rival's), named in its balloon. */
  mark?: { value: number; label: string };
  /** The bar's balloon: who the bar is and its figure ("Acme: 42%"), so a bar never stands unnamed. */
  hint?: string;
  /** A line under the bar: what goes with the item (Top terms: the terms in the same searches). */
  detail?: ReactNode;
};
const clamp = (value: number) => Math.max(0, Math.min(100, value));

/** Horizontal bars, one row each: the name and the figure on one line, the bar under them. Rows come in the caller's order. */
export function BarList({ rows, label }: { rows: BarListRow[]; label: string }) {
  return (
    <ul className="bar-list" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} style={row.color ? ({ '--bar-color': row.color } as CSSProperties) : undefined}>
          <div className="bar-list-line">
            <span className="bar-list-label">{row.label}</span>
            {row.value == null && row.missing ? (
              <Hint text={row.missing}><span className="bar-list-figure text-muted-foreground">{row.figure}<span className="sr-only">: {row.missing}</span></span></Hint>
            ) : (
              <span className="bar-list-figure">{row.figure}</span>
            )}
          </div>
          {row.value != null && (
            <div className="bar-list-bar">
              <Hint text={row.hint}><span className="block"><Progress value={clamp(row.value)} aria-label={row.text} getAriaValueText={() => row.text} /></span></Hint>
              {row.mark && <Hint text={row.mark.label}><span className="bar-list-mark" style={{ left: `${clamp(row.mark.value)}%` }} /></Hint>}
            </div>
          )}
          {row.detail && <div className="bar-list-detail">{row.detail}</div>}
        </li>
      ))}
    </ul>
  );
}

/** A BarList while its rows load: the same list, each row a label line and a bar placeholder (shell.md section 9). */
export function BarListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="bar-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index}>
          <div className="bar-list-line">
            <Skeleton inline className="h-lh w-40 max-w-full" />
            <Skeleton inline className="ml-auto h-lh w-10" />
          </div>
          <div className="bar-list-bar">
            <Skeleton className="h-1.5 w-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}
