'use client';
import { useEffect, useRef } from 'react';

/** The last pointer that pressed anywhere: a scroll closes a balloon only when a finger opened it. */
let lastPointer = 'mouse';
/** The last pointer that pressed: `mouse`, `touch` or `pen`. */
export const lastPointerType = () => lastPointer;

/**
 * A chart's balloon on a touch screen (docs/design/shell.md section 11, tooltips): a tap outside the chart or a scroll closes
 * it, and a second tap on the same point closes it too. A phone never moves the "hover" off a chart on a tap elsewhere (iOS
 * keeps the focus and sends no leave), so the balloon stayed open. A mouse is left alone: hover opens and leaving closes, as
 * before. One listener set per chart, on the document; every chart balloon goes through here (ChartTooltip, the donut, the
 * radar).
 *
 * `root`: the chart's element. `point`: what the balloon shows now (undefined when closed). `close`: hides it. `reopen`: a
 * press inside the chart after a close lets the chart show its balloon again (it gets the press, to show it there).
 */
export function useTouchDismiss({
  root,
  point,
  close,
  reopen,
}: {
  root: () => Element | null | undefined;
  point: () => unknown;
  close: () => void;
  reopen?: (event: PointerEvent) => void;
}) {
  const latest = useRef({ root, point, close, reopen });
  // The listeners below read the last render's callbacks.
  useEffect(() => {
    latest.current = { root, point, close, reopen };
  });
  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return; // a test renderer without a document
    let pressed: unknown;
    const inside = (target: EventTarget | null) => target instanceof Node && !!latest.current.root()?.contains(target);
    const down = (event: PointerEvent) => {
      lastPointer = event.pointerType || 'mouse';
      pressed = undefined;
      if (lastPointer === 'mouse') return;
      if (!inside(event.target)) return latest.current.close();
      pressed = latest.current.point();
      latest.current.reopen?.(event);
    };
    // After the chart took the tap (its own handlers run first): the same point again closes it. On its click; a chart that
    // cancels the touch (Recharts) gets no click, so the release decides a moment later.
    const settle = () => {
      if (pressed !== undefined && Object.is(latest.current.point(), pressed)) latest.current.close();
      pressed = undefined;
    };
    let wait: ReturnType<typeof setTimeout> | undefined;
    const click = (event: MouseEvent) => {
      if (lastPointer === 'mouse' || pressed === undefined || !inside(event.target)) return;
      clearTimeout(wait);
      settle();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || pressed === undefined || !inside(event.target)) return;
      clearTimeout(wait);
      wait = setTimeout(settle, 350);
    };
    // A mouse (a laptop with a touch screen) gets its hover back.
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && lastPointer !== 'mouse') lastPointer = 'mouse';
      if (event.pointerType === 'mouse' && inside(event.target)) latest.current.reopen?.(event);
    };
    const scroll = () => {
      if (lastPointer !== 'mouse' && latest.current.point() !== undefined) latest.current.close();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('scroll', scroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('click', click);
      document.removeEventListener('pointerup', up);
      clearTimeout(wait);
      document.removeEventListener('scroll', scroll, true);
    };
  }, []);
}
