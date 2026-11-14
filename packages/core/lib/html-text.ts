const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const ENTITY = /&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|quot|apos|lt|gt|nbsp);/giu;

/**
 * Provider text that arrives HTML-escaped ("CI&amp;T", "MS&#124;UX", "Web &amp;amp; Mobile") as the characters it means.
 * Escaped more than once is decoded until nothing changes (three passes at most); an unknown entity stays as written.
 */
export function decodeEntities(text: string) {
  let value = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = value.replace(ENTITY, (match, entity: string) => {
      if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()]!;
      const code = /^#x/iu.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
    if (next === value) break;
    value = next;
  }
  return value;
}
