import { brandProse, matchesBrand, sliceUnicode } from './metrics.ts';
import { topicFactors, type TopicWeights } from './topic-weights.ts';
import type { BrandTarget } from './types.ts';

/**
 * The sentiment rule (31/10, criteria): in each answer the evaluator answers yes or no to fixed criteria for each
 * brand, and the score is 50 plus their points, 0 to 100 (`criteriaScore`). A new rule applies to answers read from then on;
 * readings of an earlier rule (`LEGACY_RESEARCH_RUBRICS`) stay saved and keep their answers from being evaluated again until
 * an admin reprocesses everything (`sentimentReprocessKey`), and they are never counted (the report drops their score).
 */
export const BRAND_RESEARCH_RUBRIC = 'brand-criteria-v1';
/**
 * The version of the criterion questions (lib/brand-research-provider.ts CRITERION_QUESTIONS), carried by every input
 * (`questions`; absent on a reading made before the stamp, which is q1). It keys the saved window readings and is not part
 * of a reading's context: a reading of an earlier version keeps counting, and a sentiment reprocess asked after it reads its
 * answer again (lib/server/brand-research.ts `scope`). q2 (11/11/2026): the negative criteria ask for something concrete.
 */
export const SENTIMENT_QUESTIONS_VERSION = 'q2';
/** brand-nps-v1: a 0–10 score per brand. brand-context-v1: positive, neutral, negative or mixed, with no score. */
export const LEGACY_RESEARCH_RUBRICS = ['brand-nps-v1', 'brand-context-v1'] as const;
/** `system_state` key whose presence (with the current rubric) makes a project's legacy readings stop counting: its answers are read again. */
export const sentimentReprocessKey = (projectId: string) => `sentiment-reprocess:${projectId}`;
/**
 * The criteria and their fixed points (31/10): a brand the answer only names keeps 50; recommended, presented as the
 * best or the leader and praised with a concrete fact reach 100 together; criticized and advised against reach 0.
 */
export const SENTIMENT_CRITERIA = {
  recommended: 20,
  leader: 15,
  praised: 15,
  reservation: -15,
  criticized: -20,
  against: -30,
} as const;
export type SentimentCriterion = keyof typeof SENTIMENT_CRITERIA;
export const CRITERIA = Object.keys(SENTIMENT_CRITERIA) as SentimentCriterion[];
/** The score of the criteria met: 50 plus their points, clamped to 0–100. */
export const criteriaScore = (met: readonly string[]) =>
  Math.max(0, Math.min(100, met.reduce((score, criterion) => score + (SENTIMENT_CRITERIA[criterion as SentimentCriterion] ?? 0), 50)));
/** The bands of the 0–100 score: promoter 60–100 (`positive`), neutral 40–59, detractor 0–39 (`negative`). */
export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export const sentimentBand = (score: number): Sentiment => (score >= 60 ? 'positive' : score >= 40 ? 'neutral' : 'negative');
export type ResearchProvider = 'liquid' | 'jev' | 'decisions';
export type ResearchOption = {
  id: string;
  name: string;
  domain: string | null;
  kind: 'tracked' | 'candidate';
  aliases?: string[];
  /** Set by the sentiment cascade (lib/brand-research-provider.ts): the identity is known (no identity question)... */
  known?: boolean;
  /** ...or the brand's reading is settled without the model (no question at all). */
  settled?: boolean;
};
export type ResearchReading = {
  id: string;
  state: 'assessed' | 'insufficient' | 'ambiguous';
  /** The band of `score`; a legacy reading (no score) may also say `mixed`. */
  sentiment: Sentiment | 'mixed' | null;
  /** 0–100, assessed readings of the current rule only (`criteriaScore` of `criteria`). */
  score?: number | null;
  candidate: 'competitor' | 'other' | 'ambiguous' | null;
  evidence: string[];
  /** The criteria met, each with the `evidence` quote that shows it (its index); none met: a plain mention, 50. */
  criteria?: Partial<Record<SentimentCriterion, number>>;
};
export type ResearchInput = {
  excerpt: string;
  fullCoverage: boolean;
  options: ResearchOption[];
  category: string;
  rubric: string;
  /** The criterion questions it is read with (SENTIMENT_QUESTIONS_VERSION); absent: q1. */
  questions?: string;
  /** The question the answer replies to (untrusted text, like the answer). */
  question?: string;
  /** Read for every brand the answer names; absent on a reading of the earlier, shorter list. */
  everyBrand?: boolean;
  /** A discovered name's role is the roles classifier's, not asked here (8/11/2026). Absent on an input built before: it asks it. */
  withoutRoles?: boolean;
  /** An admin's reprocess: read by the model again, its saved window readings not reused (9/11/2026). */
  fresh?: boolean;
};

/**
 * Every brand an answer names is read (30/10): the monitored ones and every discovery of the Brands list the brand
 * analysis found in it; such a reading is marked `everyBrand`. A reading made before was of the own brand and the next five
 * monitored brands (EVALUATED_BRANDS) and the 20 most mentioned discoveries (GUARANTEED_DISCOVERIES): it still covers its
 * answer for those until an admin asks to reprocess the project for every brand.
 */
export const EVALUATED_BRANDS = 6;

/**
 * The sentiment index, 0 to 100: the mean of the 0–100 scores. Each question counts once (its score is the mean of its
 * models' scores, `scoreTotal` adds them up). Absence (no scored question) has no index, never 0.
 */
export function sentimentScore(row: { assessed: number; scoreTotal?: number }) {
  return row.assessed > 0 && Number.isFinite(row.scoreTotal) ? Math.round(row.scoreTotal! / row.assessed) : null;
}
export const GUARANTEED_DISCOVERIES = 20;
/** Loose names an answer may add to its discoveries, so a cheap read stays cheap. */
const LOOSE_CANDIDATES = 10;

const sameName = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();
const answerExcerpt = (answer: string) => sliceUnicode(brandProse(answer).trim(), 0, 16000);

const namedIn = <T extends { name: string; domain: string | null; aliases?: string[] }>(excerpt: string, brands: T[]) =>
  brands.filter((item) => matchesBrand(excerpt, { name: item.name, domain: item.domain || '', aliases: item.aliases }));
/** The brands the evaluator reads in this answer: the ones its excerpt names (the test `researchInput` applies), aliases included. */
export function matchedDiscoveries<T extends { name: string; domain: string | null; aliases?: string[] }>(answer: string, brands: T[]): T[] {
  return brands.length ? namedIn(answerExcerpt(answer), brands) : [];
}

export function researchInput(
  answer: string,
  targets: BrandTarget[],
  candidates: { name: string; domain: string | null }[],
  category: string,
  discoveries: { name: string; domain: string | null }[] = [],
  question = '',
  /** Whether a monitored brand is read (the scheduler: its effective mention is on); every brand the excerpt names by default. */
  read: (target: BrandTarget) => boolean = () => true,
): ResearchInput {
  const prose = brandProse(answer).trim();
  const excerpt = sliceUnicode(prose, 0, 16000);
  // Every monitored brand the excerpt names (its id keeps the brand's place in the list), then every discovery it names.
  const options: ResearchOption[] = namedIn(excerpt, targets.map((target, index) => ({ ...target, index })).filter((target) => read(target))).map((target) => ({
    id: `b${target.index}`,
    name: target.name,
    domain: target.domain,
    aliases: target.aliases || [],
    kind: 'tracked',
  }));
  // The discoveries come first: loose words of the answer only take the places they leave.
  for (const discovery of namedIn(excerpt, discoveries))
    options.push({ id: `c${options.length}`, name: discovery.name, domain: discovery.domain, kind: 'candidate' });
  const guaranteed = options.filter((option) => option.kind === 'candidate').length;
  for (const candidate of candidates) {
    if (guaranteed + LOOSE_CANDIDATES <= options.filter((option) => option.kind === 'candidate').length) break;
    if (
      options.some(
        (option) =>
          (option.name === candidate.name && option.domain === candidate.domain) ||
          (candidate.domain === null && option.kind === 'candidate' && sameName(option.name, candidate.name)),
      ) ||
      !matchesBrand(excerpt, {
        name: candidate.name,
        domain: candidate.domain || '',
      })
    )
      continue;
    options.push({ id: `c${options.length}`, ...candidate, kind: 'candidate' });
  }
  return {
    excerpt,
    fullCoverage: prose.length <= excerpt.length,
    options,
    category: sliceUnicode(category, 0, 300),
    rubric: BRAND_RESEARCH_RUBRIC,
    questions: SENTIMENT_QUESTIONS_VERSION,
    question: sliceUnicode(question.trim(), 0, 2000),
    everyBrand: true,
    withoutRoles: true,
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
  // A brand the model left out has no reading (shown as not evaluated, never asked again); an answer with none is a failure.
  if (!Array.isArray(rows) || !rows.length || rows.length > input.options.length)
    throw new Error('Incomplete research response.');
  const ids = new Set<string>();
  return rows.map((raw) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (key) =>
          !['id', 'state', 'sentiment', 'score', 'candidate', 'evidence', 'criteria'].includes(key),
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
      const criteria = row.criteria;
      if (
        !criteria ||
        typeof criteria !== 'object' ||
        Array.isArray(criteria) ||
        Object.entries(criteria).some(
          ([criterion, index]) => !Object.hasOwn(SENTIMENT_CRITERIA, criterion) || !Number.isInteger(index) || index < 0 || index >= row.evidence.length,
        ) ||
        row.score !== criteriaScore(Object.keys(criteria)) ||
        row.sentiment !== sentimentBand(row.score) ||
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
    } else if (row.sentiment !== null || row.score != null || row.evidence.length || row.criteria != null)
      throw new Error('Unavailable sentiment must remain null.');
    if (
      option.kind === 'tracked' || input.withoutRoles
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
/**
 * `weighting` (topic weights, lib/topic-weights): each assessed question counts its topic's share of the weights in the
 * brand's index and bands; `assessed` stays the real count of questions.
 */
export function summarizeSentiment(
  observations: ResearchObservation[],
  weighting?: { topicOf: ReadonlyMap<string, string>; weights: TopicWeights | null },
) {
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
      /** Sum of the assessed questions' scores (0–100 each): `sentimentScore` makes the index of it. */
      scoreTotal: number;
    }
  >();
  // Each assessed question's topic and score, per brand: weighted at the end.
  const scored = new Map<string, { topic: string; score: number }[]>();
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
      distribution: { positive: 0, neutral: 0, negative: 0 },
      scoreTotal: 0,
    };
    brand.prompts++;
    const mentioned = channels.filter((channel) => channel.mentioned);
    // Only readings of the current rule have a score: a legacy one counts as not assessed (partial), never as a guess.
    const assessed = mentioned.filter(
      (channel) => channel.reading?.state === 'assessed' && typeof channel.reading.score === 'number',
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
        // The question's score is the mean of its models' scores; its band is the band of that mean.
        const score = assessed.reduce((sum, channel) => sum + channel.reading!.score!, 0) / assessed.length;
        brand.assessed++;
        brand.scoreTotal += score;
        brand.distribution[sentimentBand(score)]++;
        scored.set(name, [...(scored.get(name) ?? []), { topic: weighting?.topicOf.get(channels[0].unitId) ?? '', score }]);
      }
    }
    brands.set(name, brand);
  }
  if (weighting?.weights)
    for (const [name, questions] of scored) {
      const counts = new Map<string, number>();
      for (const { topic } of questions) counts.set(topic, (counts.get(topic) ?? 0) + 1);
      const factors = topicFactors(counts, weighting.weights);
      const brand = brands.get(name)!;
      brand.scoreTotal = 0;
      brand.distribution = { positive: 0, neutral: 0, negative: 0 };
      for (const { topic, score } of questions) {
        const factor = factors.get(topic) ?? 0;
        brand.scoreTotal += factor * score;
        brand.distribution[sentimentBand(score)] += factor;
      }
    }
  return { brands: [...brands.values()], observations: [...latest.values()] };
}

/** One brand's composed verdict per question (assessed questions only), the same composition the brand's score adds up. */
export function sentimentByUnit(observations: ResearchObservation[], brand: string | undefined) {
  const units = new Map<string, ResearchObservation[]>();
  for (const observation of observations)
    if (observation.brand === brand) units.set(observation.unitId, [...(units.get(observation.unitId) ?? []), observation]);
  const result: Record<string, { assessed: number; distribution: Record<Sentiment, number>; scoreTotal: number }> = {};
  for (const [unit, rows] of units) {
    const { assessed, distribution, scoreTotal } = summarizeSentiment(rows).brands[0];
    if (assessed) result[unit] = { assessed, distribution, scoreTotal };
  }
  return result;
}
