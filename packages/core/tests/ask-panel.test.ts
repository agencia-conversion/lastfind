import test from 'node:test';
import assert from 'node:assert/strict';
import { ASK_PANEL_INITIAL, ASK_WINDOW, askPanel, askPanelState, dispatchAskPanel, isAskReturn, morphAskPanel, readAskPanel, subscribeAskPanel } from '../lib/ask-panel.ts';

test('Ask Lastfind: collapsed, floating, pinned to the side and popped out, each reachable from the others', () => {
  let state = askPanel(ASK_PANEL_INITIAL, 'open');
  assert.deepEqual(state, { open: true, mode: 'floating' }, 'the button opens the floating panel');
  state = askPanel(state, 'dock');
  assert.deepEqual(state, { open: true, mode: 'docked' }, 'Pin to the side docks it as the right sidebar');
  state = askPanel(state, 'popout');
  assert.deepEqual(state, { open: false, mode: 'docked' }, 'a new window takes the conversation; this tab collapses and keeps the mode');
  assert.deepEqual(askPanel(state, 'open'), { open: true, mode: 'docked' }, 'back (the button, or the window coming back), it is pinned again');
  assert.deepEqual(askPanel({ open: true, mode: 'docked' }, 'float'), { open: true, mode: 'floating' }, 'Unpin floats it again');
  assert.deepEqual(askPanel({ open: true, mode: 'floating' }, 'popout'), { open: false, mode: 'floating' }, 'floating pops out too');
  assert.deepEqual(askPanel({ open: true, mode: 'floating' }, 'close'), { open: false, mode: 'floating' });
  assert.deepEqual(askPanel({ open: true, mode: 'docked' }, 'close'), { open: false, mode: 'docked' }, 'Close collapses it, pinned or not');
});

test("the popped-out window's way back is recognized by its type only", () => {
  assert.equal(isAskReturn({ type: ASK_WINDOW, project: 'p', conversation: null }), true);
  for (const data of [null, undefined, 'lastfind-ask', { type: 'other' }]) assert.equal(isAskReturn(data), false);
});

test('floating and pinned trade places in a view transition, and simply change with less motion', () => {
  const calls: string[] = [];
  const run = (reduce: boolean, transitions: boolean) => {
    Object.assign(globalThis, {
      window: { matchMedia: () => ({ matches: reduce }) },
      document: transitions ? { startViewTransition: (update: () => void) => (calls.push('transition'), update()) } : {},
    });
    morphAskPanel(
      () => calls.push('change'),
      (fn) => (calls.push('flush'), fn()),
    );
  };
  try {
    run(false, true);
    assert.deepEqual(calls.splice(0), ['transition', 'flush', 'change']);
    run(true, true);
    assert.deepEqual(calls.splice(0), ['change'], 'prefers-reduced-motion: no transition');
    run(false, false);
    assert.deepEqual(calls.splice(0), ['change'], 'no view transitions in the browser: it simply changes');
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
  }
});

test('a stored state reads back, anything else as the initial one', () => {
  assert.deepEqual(readAskPanel('{"open":true,"mode":"docked"}'), { open: true, mode: 'docked' });
  for (const raw of [null, '', 'nope', '{"open":"yes","mode":"side"}']) assert.deepEqual(readAskPanel(raw), ASK_PANEL_INITIAL);
});

test('the state is kept across navigation: one store for the tab, saved in sessionStorage', () => {
  const saved = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) };
  Object.assign(globalThis, { window: { sessionStorage } });
  try {
    let heard = 0;
    const stop = subscribeAskPanel(() => heard++);
    dispatchAskPanel('open');
    dispatchAskPanel('dock');
    dispatchAskPanel('dock');
    stop();
    assert.equal(heard, 2, 'listeners hear each change once, never a repeat');
    // A screen mounted after the navigation reads the same state; a reload reads it back from the tab's storage.
    assert.deepEqual(askPanelState(), { open: true, mode: 'docked' });
    assert.deepEqual(readAskPanel(saved.get('lastfind-ask-panel')), { open: true, mode: 'docked' });
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});
