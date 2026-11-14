/**
 * Topic weights: how much each topic counts in a project's aggregate metrics, so the products that matter most
 * weigh what they should (Conversion: SEO 50, GEO 30, PR 10, the others 5). Weights are relative numbers kept on the
 * project (`projects.topic_weights_json`, `{topic name: weight}`); the shares are each weight over their sum. A project
 * without weights counts every answer the same, as before. A topic without a weight takes the smallest weight set, so a
 * new topic starts at the least important share and the others keep theirs.
 */
export type TopicWeights = Map<string, number>;

export const MAX_TOPIC_WEIGHT = 1000;

/** The weights a project keeps, or null when none is set (or the value cannot be read). */
export function readTopicWeights(json: unknown): TopicWeights | null {
  if (typeof json !== 'string' || !json) return null;
  try {
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0,
    );
    return entries.length ? new Map(entries) : null;
  } catch {
    return null;
  }
}

/** A topic's weight: its own, else the smallest one set. */
export function topicWeight(weights: TopicWeights, topic: string) {
  return weights.get(topic) ?? Math.min(...weights.values());
}

/**
 * The factor each answer of a topic is counted with so that a sum over answers becomes topic-weighted: each topic present
 * in the cohort weighs its share of the weights, spread over its answers, and the factors keep the cohort's size (the
 * weighted answers add up to the real ones). `answers` is the cohort's answers per topic. Without weights every factor is 1.
 */
export function topicFactors(answers: ReadonlyMap<string, number>, weights: TopicWeights | null): Map<string, number> {
  const present = [...answers].filter(([, count]) => count > 0);
  if (!weights) return new Map(present.map(([topic]) => [topic, 1]));
  const total = present.reduce((sum, [, count]) => sum + count, 0);
  const weightSum = present.reduce((sum, [topic]) => sum + topicWeight(weights, topic), 0);
  return new Map(
    present.map(([topic, count]) => [topic, weightSum ? (topicWeight(weights, topic) / weightSum) * (total / count) : 0]),
  );
}

/** Each topic's share (0–100) of the weights, over the given topics. */
export function topicShares(topics: string[], weights: TopicWeights) {
  const sum = topics.reduce((total, topic) => total + topicWeight(weights, topic), 0);
  return new Map(topics.map((topic) => [topic, sum ? (topicWeight(weights, topic) / sum) * 100 : 0]));
}
