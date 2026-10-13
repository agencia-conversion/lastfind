import modelArtifact from './competitor-discovery-model.json' with { type: 'json' };
import { compareUnicodeCodePoints } from './competitor-discovery-primitives.ts';
import {
  COMPETITOR_FEATURE_ORDER,
  COMPETITOR_ENTITY_ROLE_TRANSFORM,
  extractCompetitorFeatureRows,
  type CompetitorCandidate,
  type CompetitorFeatureVector,
  type DiscoveryAnswer,
  type DiscoveryOptions,
  type DiscoverySeed,
  type RankerEntityRoleTransform,
} from './competitor-discovery-features.ts';

export * from './competitor-discovery-features.ts';

type ModelArtifact = {
  schemaVersion: number;
  classOrder?: number[];
  featureOrder: string[];
  intercept: number;
  coefficients: number[];
  decisionThreshold: number;
  provenance?: {
    entityRoleTransform?: RankerEntityRoleTransform;
  };
};

const model = modelArtifact as ModelArtifact;

export function validateCompetitorModelArtifact(artifact: ModelArtifact): void {
  if (artifact.schemaVersion !== 6)
    throw new Error('Unsupported competitor model schema');
  if (
    artifact.schemaVersion >= 2 &&
    (artifact.classOrder?.length !== 2 ||
      artifact.classOrder[0] !== 0 ||
      artifact.classOrder[1] !== 1)
  )
    throw new Error('Competitor model class schema does not match runtime');
  if (
    artifact.featureOrder.length !== COMPETITOR_FEATURE_ORDER.length ||
    new Set(artifact.featureOrder).size !== artifact.featureOrder.length ||
    artifact.featureOrder.some(
      (feature, index) => feature !== COMPETITOR_FEATURE_ORDER[index],
    )
  )
    throw new Error('Competitor model feature schema does not match runtime');
  if (
    artifact.coefficients.length !== artifact.featureOrder.length ||
    !Number.isFinite(artifact.intercept) ||
    artifact.coefficients.some(
      (coefficient) => !Number.isFinite(coefficient),
    ) ||
    !Number.isFinite(artifact.decisionThreshold) ||
    artifact.decisionThreshold < 0 ||
    artifact.decisionThreshold > 1
  )
    throw new Error('Competitor model contains invalid numeric values');
  if (
    JSON.stringify(artifact.provenance?.entityRoleTransform) !==
    JSON.stringify(COMPETITOR_ENTITY_ROLE_TRANSFORM)
  )
    throw new Error('Competitor model entity-role transform is incompatible');
}

validateCompetitorModelArtifact(model);

export function scoreCompetitorFeatureVector(
  features: CompetitorFeatureVector,
): number {
  const keys = Object.keys(features);
  const expected = new Set<string>(COMPETITOR_FEATURE_ORDER);
  if (
    keys.length !== COMPETITOR_FEATURE_ORDER.length ||
    keys.some((feature) => !expected.has(feature))
  )
    throw new Error('Competitor feature vector does not match model schema');
  let decision = model.intercept;
  for (let index = 0; index < model.featureOrder.length; index++) {
    const value = features[model.featureOrder[index]!];
    const coefficient = model.coefficients[index];
    if (
      value === undefined ||
      coefficient === undefined ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    )
      throw new Error(
        `Invalid competitor feature: ${model.featureOrder[index]}`,
      );
    decision += coefficient * value;
  }
  return 1 / (1 + Math.exp(-decision));
}

export function discoverCompetitors(
  answers: DiscoveryAnswer[],
  seeds: DiscoverySeed[],
  options: DiscoveryOptions = {},
): CompetitorCandidate[] {
  const candidates = extractCompetitorFeatureRows(answers, seeds, options)
    .map((row) => ({
      row,
      score: scoreCompetitorFeatureVector(row.features),
    }))
    .filter(({ score }) => score >= model.decisionThreshold)
    .map(({ row, score }) => ({
      name: row.name,
      domain: row.domain,
      domainEvidence: row.domainEvidence,
      score: Math.round(score * 1_000_000) / 1_000_000,
      answerCount: row.answerCount,
      evidence: row.evidence,
    }));

  const maxCandidates = Math.min(
    50,
    Math.max(1, Math.trunc(options.maxCandidates ?? 10)),
  );
  return candidates
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.answerCount - left.answerCount ||
        compareUnicodeCodePoints(left.name, right.name),
    )
    .slice(0, maxCandidates);
}
