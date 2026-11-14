type ShortcutEvent = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; target: EventTarget | null };

/**
 * ⌘K (Ctrl+K off a Mac) opens and closes the conversations, on Agent > Chat only: nothing else in the app uses it, and the
 * browsers' own Ctrl+K (the address bar's search) gives way to a page that handles it, as in GitHub, Slack or Linear.
 * Never while the person types in a field of its own (a rename, a search, the artifact's text): only from the message box
 * (`composer`) or from outside any field.
 */
export function isConversationsShortcut(event: ShortcutEvent, composer: unknown) {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  const typing = !!target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  return !typing || target === composer;
}

/** The shortcut as this device writes it. */
export const conversationsShortcutLabel = (userAgent: string) => (/Mac|iPhone|iPad/.test(userAgent) ? '⌘K' : 'Ctrl K');
