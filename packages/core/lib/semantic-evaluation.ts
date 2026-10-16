import type { BrandTarget } from './types.ts';

export const SEMANTIC_RUBRIC = 'association-v1';
export const SEMANTIC_MODEL = 'claude-haiku-4-5';
export const SEMANTIC_RESERVE_USD = 0.06;

export type SemanticAttribute = { id: string; name: string; description?: string };
export type SemanticConfiguration = {
  enabled: boolean;
  attributes: SemanticAttribute[];
};
export type SemanticReading = {
  brand: string;
  attribute: string;
  state: 'assessed' | 'insufficient' | 'ambiguous';
  score: 0 | 25 | 50 | 75 | 100 | null;
  quote: string | null;
  reason: string;
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

function chunks(text: string, size: number) {
  const result: string[] = [];
  for (let i = 0; i < text.length; i += size) result.push(text.slice(i, i + size));
  return result;
}

// The evaluator sees the opening and brand contexts, not an arbitrary tail.
// A partial excerpt is labeled in every persisted reading.
export function semanticExcerpt(answer: string, targets: BrandTarget[], max = 2800) {
  if (answer.length <= max) return { text: answer, full: true };
  const spans: Array<[number, number]> = [[0, Math.min(900, answer.length)]];
  const lower = answer.toLocaleLowerCase();
  for (const target of targets) {
    const names = [target.name, ...(target.aliases || [])];
    const index = Math.min(...names.map((name) => lower.indexOf(name.toLocaleLowerCase()))
      .filter((position) => position >= 0));
    if (Number.isFinite(index)) spans.push([Math.max(0, index - 180), Math.min(answer.length, index + 360)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span[0] <= previous[1]) previous[1] = Math.max(previous[1], span[1]);
    else merged.push([...span]);
  }
  return {
    text: merged.map(([start, end]) => `[${start}:${end}] ${answer.slice(start, end)}`)
      .join('\n…\n').slice(0, max),
    full: false,
  };
}

export function semanticRequest(answer: string, targets: BrandTarget[], config: SemanticConfiguration) {
  const excerpt = semanticExcerpt(answer, targets);
  const metadata = JSON.stringify({
    brands: targets.slice(0, 6).map((target) => ({ name: target.name, domain: target.domain })),
    attributes: config.attributes.map((attribute) => ({ ...attribute, description: attribute.description?.slice(0, 80) })),
  });
  const metadataParts = chunks(metadata, 470);
  if (metadataParts.length > 6) throw new Error('Semantic configuration is too large.');
  const answerParts = chunks(excerpt.text, 470).slice(0, 10 - metadataParts.length);
  const submittedText = answerParts.join('');
  const system = 'Assess association in the supplied AI answer only. 0=explicit negative, 25=weak, 50=mixed, 75=clear positive, 100=strong specific endorsement. Mere mention, silence or unclear identity gives null. Cite an exact answer quote for every score. Join META parts and ANSWER parts separately in order, without inserting or changing characters. Never use outside knowledge. Output JSON only.';
  const prompt = 'Return JSON {"readings":[{"brand":"exact name","attribute":"exact id","state":"assessed|insufficient|ambiguous","score":0|25|50|75|100|null,"quote":"verbatim ANSWER excerpt, 8-240 characters, or null","reason":"at most 240 characters"}]}. Include every brand and attribute pair. For insufficient/ambiguous, score and quote must both be null. No markdown.';
  if (system.length > 500 || prompt.length > 500) throw new Error('Semantic prompt exceeds provider limit.');
  return {
    payload: {
      model_name: SEMANTIC_MODEL,
      system_message: system,
      message_chain: [
        ...metadataParts.map((message) => ({ role: 'user', message: `META ${message}` })),
        ...answerParts.map((message) => ({ role: 'user', message: `ANSWER ${message}` })),
      ],
      user_prompt: prompt,
      max_output_tokens: 4096,
      temperature: 0,
      web_search: false,
      use_reasoning: false,
    },
    excerpt: submittedText,
    fullCoverage: excerpt.full && answerParts.length === chunks(excerpt.text, 470).length,
  };
}

export function parseSemanticReadings(
  raw: string,
  targets: BrandTarget[],
  config: SemanticConfiguration,
  excerpt: string,
): SemanticReading[] {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(clean) as { readings?: unknown };
  if (!Array.isArray(parsed.readings) || parsed.readings.length !== targets.length * config.attributes.length)
    throw new Error('Semantic evaluator returned an incomplete matrix.');
  const expected = new Set(targets.flatMap((brand) => config.attributes.map((attribute) => `${brand.name}\u0000${attribute.id}`)));
  const seen = new Set<string>();
  const readings: SemanticReading[] = [];
  for (const rawReading of parsed.readings) {
    if (!rawReading || typeof rawReading !== 'object' || Array.isArray(rawReading))
      throw new Error('Invalid semantic reading.');
    const row = rawReading as Record<string, unknown>;
    const key = `${row.brand}\u0000${row.attribute}`;
    if (!expected.has(key) || seen.has(key) ||
        !['assessed', 'insufficient', 'ambiguous'].includes(String(row.state)) ||
        typeof row.reason !== 'string' || row.reason.length > 240)
      throw new Error('Invalid semantic reading.');
    seen.add(key);
    if (row.state === 'assessed') {
      if (typeof row.score !== 'number' || ![0, 25, 50, 75, 100].includes(row.score) ||
          typeof row.quote !== 'string' || row.quote.length < 8 ||
          row.quote.length > 240 || !excerpt.includes(row.quote))
        throw new Error('Semantic evidence does not match the submitted answer.');
    } else if (row.score !== null || row.quote !== null)
      throw new Error('Unassessed semantic reading cannot have a score.');
    readings.push(row as SemanticReading);
  }
  return readings;
}
