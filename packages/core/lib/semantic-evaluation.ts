export type SemanticAttribute = { id: string; name: string; description?: string };
export type SemanticConfiguration = {
  enabled: boolean;
  attributes: SemanticAttribute[];
};
export function validateSemanticConfiguration(value: unknown): SemanticConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid semantic configuration.');
  const input = value as Record<string, unknown>;
  if (typeof input.enabled !== 'boolean' || !Array.isArray(input.attributes) ||
      input.attributes.length > 10 || (input.enabled && input.attributes.length === 0))
    throw new Error('Choose one to ten semantic attributes.');
  const attributes = input.attributes.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid semantic attribute.');
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) || name.length < 2 || name.length > 60 ||
        description.length > 240)
      throw new Error('Invalid semantic attribute.');
    return { id, name, ...(description ? { description } : {}) };
  });
  if (new Set(attributes.map((a) => a.id)).size !== attributes.length ||
      new Set(attributes.map((a) => a.name.toLocaleLowerCase())).size !== attributes.length)
    throw new Error('Semantic attributes must be unique.');
  return { enabled: input.enabled, attributes };
}
