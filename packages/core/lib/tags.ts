// A list typed as badges (components/ui/tag-input.tsx, 13/11/2026): how typed or pasted text becomes values.

/** What separates values: a comma, a semicolon or a line break, and a space when `spaces` is set (domains; never names). */
export const tagSeparator = (spaces: boolean) => (spaces ? /[,;\s]+/ : /[,;\n]+/);

/**
 * `value` with every value of `text` added in order: each cleaned by `normalize` (null refuses it), a repeat (case ignored) dropped.
 * `left`: the refused parts, which stay in the field.
 */
export function addTags(value: readonly string[], text: string, normalize: (text: string) => string | null, spaces: boolean) {
  const next = [...value];
  const left: string[] = [];
  for (const part of text.split(tagSeparator(spaces))) {
    if (!part.trim()) continue;
    const clean = normalize(part);
    if (clean === null) left.push(part.trim());
    else if (!next.some((tag) => tag.toLowerCase() === clean.toLowerCase())) next.push(clean);
  }
  return { next, left: left.join(spaces ? ' ' : ', ') };
}
