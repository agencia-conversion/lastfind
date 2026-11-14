'use client';

import { useEffect } from 'react';
import '@/app/globals.css';

// Keys that move the focus: after one of them the ring shows again. Enter, Space and Esc do not count: a mouse user pressing
// Esc on a menu gets the focus back on its trigger without a ring; a keyboard user already moved with Tab or the arrows.
const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * The input the person used last, on `<html data-input="pointer|keyboard">` (docs/design/shell.md section 10). Chrome matches
 * `:focus-visible` on a clicked button as soon as any key is pressed (Shift, ⌘C, ⌘Tab back to the window), so a mouse click
 * "sometimes" left a ring; globals.css hides it while the pointer was last, until a navigation key.
 */
function inputModality(root: HTMLElement) {
  const pointer = () => {
    root.dataset.input = 'pointer';
  };
  const key = (event: KeyboardEvent) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey && NAVIGATION_KEYS.has(event.key)) root.dataset.input = 'keyboard';
  };
  window.addEventListener('pointerdown', pointer, true);
  window.addEventListener('keydown', key, true);
  return () => {
    window.removeEventListener('pointerdown', pointer, true);
    window.removeEventListener('keydown', key, true);
  };
}

// Keep the shared stylesheet in the client graph of every edition/layout, and the input modality on every page.
export function ApplicationStyles() {
  useEffect(() => inputModality(document.documentElement), []);
  return null;
}
