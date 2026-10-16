import { brandProse, matchesBrand, sliceUnicode } from './metrics.ts';
import type { BrandTarget } from './types.ts';

export const BRAND_RESEARCH_RUBRIC = 'brand-context-v1';
export const SENTIMENTS = ['positive', 'neutral', 'negative', 'mixed'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export type ResearchProvider = 'jev' | 'decisions';
export type ResearchOption = {
  id: string;
  name: string;
  domain: string | null;
  kind: 'tracked' | 'candidate';
  aliases?: string[];
};
export type ResearchReading = {
  id: string;
  state: 'assessed' | 'insufficient' | 'ambiguous';
  sentiment: Sentiment | null;
  candidate: 'competitor' | 'other' | 'ambiguous' | null;
  evidence: string[];
};
export type ResearchInput = {
  excerpt: string;
  fullCoverage: boolean;
  options: ResearchOption[];
  category: string;
  rubric: string;
};

export function researchInput(
  answer: string,
  targets: BrandTarget[],
  candidates: { name: string; domain: string | null }[],
  category: string,
): ResearchInput {
  const prose = brandProse(answer).trim();
  const excerpt = sliceUnicode(prose, 0, 16000);
  const options: ResearchOption[] = targets
    .slice(0, 6)
    .map((target, index) => ({
      id: `b${index}`,
      name: target.name,
      domain: target.domain,
      aliases: target.aliases || [],
      kind: 'tracked',
    }));
  for (const candidate of candidates) {
    if (
      options.some(
        (option) =>
          option.name === candidate.name && option.domain === candidate.domain,
      ) ||
      !matchesBrand(excerpt, {
        name: candidate.name,
        domain: candidate.domain || '',
      })
    )
      continue;
    options.push({ id: `c${options.length}`, ...candidate, kind: 'candidate' });
    if (options.filter((option) => option.kind === 'candidate').length >= 10)
      break;
  }
  return {
    excerpt,
    fullCoverage: prose.length <= excerpt.length,
    options,
    category: sliceUnicode(category, 0, 300),
    rubric: BRAND_RESEARCH_RUBRIC,
  };
}

export function parseResearchReadings(
  value: unknown,
  input: ResearchInput,
): ResearchReading[] {
  if (typeof value === 'string') value = JSON.parse(value);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== 'readings')
  )
    throw new Error('Invalid research response.');
  const rows = (value as { readings?: unknown }).readings;
  if (!Array.isArray(rows) || rows.length !== input.options.length)
    throw new Error('Incomplete research response.');
  const ids = new Set<string>();
  return rows.map((raw) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (key) =>
          !['id', 'state', 'sentiment', 'candidate', 'evidence'].includes(key),
      )
    )
      throw new Error('Invalid research reading.');
    const row = raw as ResearchReading;
    const option = input.options.find((item) => item.id === row.id);
    if (
      !option ||
      ids.has(row.id) ||
      !['assessed', 'insufficient', 'ambiguous'].includes(row.state)
    )
      throw new Error('Unknown or repeated research identity.');
    ids.add(row.id);
    if (
      !Array.isArray(row.evidence) ||
      row.evidence.length > 3 ||
      row.evidence.some(
        (evidence) =>
          typeof evidence !== 'string' ||
          !evidence.trim() ||
          evidence.length > 1200 ||
          !input.excerpt.includes(evidence),
      )
    )
      throw new Error('Evidence does not match the answer.');
    if (row.state === 'assessed') {
      if (
        !SENTIMENTS.includes(row.sentiment as Sentiment) ||
        !row.evidence.length ||
        !row.evidence.some((evidence) =>
          matchesBrand(evidence, {
            name: option.name,
            domain: option.domain || '',
            aliases: option.aliases,
          }),
        )
      )
        throw new Error('Assessed sentiment requires identity evidence.');
    } else if (row.sentiment !== null || row.evidence.length)
      throw new Error('Unavailable sentiment must remain null.');
    if (
      option.kind === 'tracked'
        ? row.candidate !== null
        : !['competitor', 'other', 'ambiguous'].includes(
            row.candidate as string,
          )
    )
      throw new Error('Invalid candidate verdict.');
    return row;
  });
}

export type ResearchObservation = {
  runId: string;
  unitId: string;
  engine: string;
  createdAt: string;
  brand: string;
  mentioned: boolean;
  status: string;
  reading?: ResearchReading;
  fullCoverage: boolean;
};
export function summarizeSentiment(observations: ResearchObservation[]) {
  const latest = new Map<string, ResearchObservation>();
  for (const observation of observations) {
    const key = JSON.stringify([
      observation.brand,
      observation.unitId,
      observation.engine,
    ]);
    const old = latest.get(key);
    if (
      !old ||
      observation.createdAt > old.createdAt ||
      (observation.createdAt === old.createdAt && observation.runId > old.runId)
    )
      latest.set(key, observation);
  }
  const brands = new Map<
    string,
    {
      brand: string;
      prompts: number;
      assessed: number;
      absent: number;
      partial: number;
      pending: number;
      insufficient: number;
      ambiguous: number;
      failed: number;
      distribution: Record<Sentiment, number>;
    }
  >();
  const groups = new Map<string, ResearchObservation[]>();
  for (const observation of latest.values()) {
    const key = JSON.stringify([observation.brand, observation.unitId]);
    groups.set(key, [...(groups.get(key) || []), observation]);
  }
  for (const channels of groups.values()) {
    const name = channels[0].brand;
    const brand = brands.get(name) || {
      brand: name,
      prompts: 0,
      assessed: 0,
      absent: 0,
      partial: 0,
      pending: 0,
      insufficient: 0,
      ambiguous: 0,
      failed: 0,
      distribution: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
    };
    brand.prompts++;
    const mentioned = channels.filter((channel) => channel.mentioned);
    const assessed = mentioned.filter(
      (channel) => channel.reading?.state === 'assessed',
    );
    if (!mentioned.length) brand.absent++;
    else {
      if (
        mentioned.some(
          (channel) =>
            channel.status === 'pending' ||
            channel.status === 'submitting' ||
            channel.status === 'unassessed',
        )
      )
        brand.pending++;
      if (
        mentioned.some(
          (channel) =>
            channel.status === 'failed' || channel.status === 'unknown',
        )
      )
        brand.failed++;
      if (
        mentioned.some((channel) => channel.reading?.state === 'insufficient')
      )
        brand.insufficient++;
      if (mentioned.some((channel) => channel.reading?.state === 'ambiguous'))
        brand.ambiguous++;
      if (
        assessed.length !== mentioned.length ||
        channels.some((channel) => !channel.fullCoverage)
      )
        brand.partial++;
      if (assessed.length) {
        const sentiments = new Set(
          assessed.map((channel) => channel.reading!.sentiment!),
        );
        const sentiment =
          sentiments.has('mixed') ||
          (sentiments.has('positive') && sentiments.has('negative'))
            ? 'mixed'
            : sentiments.has('negative')
              ? 'negative'
              : sentiments.has('positive')
                ? 'positive'
                : 'neutral';
        brand.assessed++;
        brand.distribution[sentiment]++;
      }
    }
    brands.set(name, brand);
  }
  return { brands: [...brands.values()], observations: [...latest.values()] };
}
