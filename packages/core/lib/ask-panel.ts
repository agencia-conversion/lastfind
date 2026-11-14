/**
 * Ask Lastfind's panel (docs/design/shell.md section 4), four states: collapsed (only the button at the bottom right),
 * floating over the page at the bottom right, pinned as the right sidebar (a full-height sheet on a phone), and popped out
 * to its own window. One state for the tab, kept across the app's navigation and a reload (sessionStorage), so the panel
 * comes back as it was; the popped-out window knows itself by its name (ASK_WINDOW), which a reload keeps too.
 */
export type AskMode = 'floating' | 'docked';
export type AskPanelState = { open: boolean; mode: AskMode };
/** `popout`: the conversation went to its own window; this tab's panel collapses and keeps the mode for the next time. */
export type AskAction = 'open' | 'close' | 'dock' | 'float' | 'popout';

export const ASK_PANEL_INITIAL: AskPanelState = { open: false, mode: 'floating' };

export function askPanel(state: AskPanelState, action: AskAction): AskPanelState {
  switch (action) {
    case 'open':
      return { ...state, open: true };
    case 'close':
    case 'popout':
      return { ...state, open: false };
    case 'dock':
      return { open: true, mode: 'docked' };
    case 'float':
      return { open: true, mode: 'floating' };
  }
}

/** A stored state read back, anything unexpected as the initial one. */
export function readAskPanel(raw: string | null | undefined): AskPanelState {
  try {
    const value = JSON.parse(raw ?? '') as Partial<AskPanelState>;
    return { open: value.open === true, mode: value.mode === 'docked' ? 'docked' : 'floating' };
  } catch {
    return ASK_PANEL_INITIAL;
  }
}

const KEY = 'lastfind-ask-panel';
const listeners = new Set<() => void>();
let current: AskPanelState | null = null;
const storage = () => (typeof window === 'undefined' ? null : window.sessionStorage);

export function askPanelState(): AskPanelState {
  current ??= readAskPanel(storage()?.getItem(KEY));
  return current;
}
export function dispatchAskPanel(action: AskAction) {
  const next = askPanel(askPanelState(), action);
  if (next.open === current?.open && next.mode === current?.mode) return;
  current = next;
  storage()?.setItem(KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}
export function subscribeAskPanel(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The popped-out window's name: Agent > Chat in it offers the way back to the panel of the tab that opened it. */
export const ASK_WINDOW = 'lastfind-ask';
/** What that window sends its opener on the way back: open the panel again, on this conversation of this project. */
export type AskReturn = { type: typeof ASK_WINDOW; project: string; conversation: string | null };
export const isAskReturn = (data: unknown): data is AskReturn => (data as AskReturn | null)?.type === ASK_WINDOW;

/**
 * Pops the conversation out to its own window (a real window where the browser allows it; a phone opens a tab). It keeps
 * its opener (same origin) to come back. False when the browser blocked it: the panel then stays as it was.
 */
export function popOutAsk(href: string) {
  const width = Math.min(1200, window.screen.availWidth);
  const height = Math.min(900, window.screen.availHeight);
  return !!window.open(href, ASK_WINDOW, `popup,width=${width},height=${height}`);
}

/**
 * A change between floating and pinned drawn as one short move (shell.md section 4): the page lays out once for its new
 * width and the panel glides from its old box to the new one (a view transition: snapshots moved by the compositor). With
 * less motion, or a browser without view transitions, it simply changes. `flush` commits React's update inside it.
 */
export function morphAskPanel(change: () => void, flush: (fn: () => void) => void) {
  if (typeof document.startViewTransition !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return change();
  document.startViewTransition(() => flush(change));
}
