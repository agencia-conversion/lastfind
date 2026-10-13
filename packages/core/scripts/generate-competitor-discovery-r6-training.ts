#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPETITOR_FEATURE_ORDER,
  extractCompetitorFeatureRowsWithEntityScores,
  type CompetitorDecodeAudit,
  type CompetitorDiscoveryAudit,
  type DiscoveryAnswer,
  type DiscoverySeed,
  type RankerEntityRoleTransform,
} from '../lib/competitor-discovery-features.ts';
import { competitorIdentity } from '../lib/competitor-identity.ts';

type Partition = 'train' | 'validation' | 'test';
type CorpusBundle = {
  id: string;
  family: string;
  locale: 'en' | 'pt-BR';
  partition: Partition;
  seeds: DiscoverySeed[];
  answers: DiscoveryAnswer[];
  referenceAnswers?: DiscoveryAnswer[];
  annotations: {
    answerId: string;
    start: number;
    end: number;
    name: string;
    label: 0 | 1 | 'ambiguous';
  }[];
};
type Corpus = {
  schemaVersion: 2;
  datasetVersion: string;
  bundles: CorpusBundle[];
};

function normalized(value: string): string {
  return competitorIdentity(value);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function pythonFloatJson(value: number): string {
  assert.ok(Number.isFinite(value));
  if (Object.is(value, -0)) return '-0.0';
  if (Number.isInteger(value)) return value.toFixed(1);
  let serialized = String(value);
  if (!/[eE]/u.test(serialized) && Math.abs(value) < 1e-4)
    serialized = value.toExponential();
  if (!/[eE]/u.test(serialized)) return serialized;
  const [mantissa, rawExponent = '0'] = serialized.toLowerCase().split('e');
  const sign = rawExponent.startsWith('-') ? '-' : '+';
  const exponent = rawExponent.replace(/^[-+]/u, '').padStart(2, '0');
  return `${mantissa}e${sign}${exponent}`;
}

function pythonCanonicalRoleParametersSha256(value: {
  schemaVersion: number;
  featureVocabulary: string[];
  intercept: number;
  coefficients: number[];
  decisionThreshold: number;
  segmentPenalty: number;
}): string {
  const fields = [
    `"coefficients":[${value.coefficients.map(pythonFloatJson).join(',')}]`,
    `"decisionThreshold":${pythonFloatJson(value.decisionThreshold)}`,
    `"featureVocabulary":${JSON.stringify(value.featureVocabulary)}`,
    `"intercept":${pythonFloatJson(value.intercept)}`,
    `"schemaVersion":${value.schemaVersion}`,
    `"segmentPenalty":${pythonFloatJson(value.segmentPenalty)}`,
  ];
  return sha256(`{${fields.join(',')}}\n`);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const corpusPath = resolve(
  process.argv[2] ??
    resolve(scriptDirectory, 'competitor-discovery-training-corpus.json'),
);
const primitivePath = resolve(
  process.argv[3] ??
    resolve(scriptDirectory, 'competitor-entity-role-primitives.json'),
);
const scorePath = resolve(
  process.argv[4] ??
    resolve(scriptDirectory, 'competitor-entity-role-scores.json'),
);
const outputPath = resolve(
  process.argv[5] ??
    resolve(scriptDirectory, 'competitor-discovery-training-vectors.json'),
);
const corpusSource = await readFile(corpusPath, 'utf8');
const primitiveSource = await readFile(primitivePath, 'utf8');
const scoreSource = await readFile(scorePath, 'utf8');
const featureSourcePath = resolve(
  scriptDirectory,
  '../lib/competitor-discovery-features.ts',
);
const featureSource = await readFile(featureSourcePath, 'utf8');
const primitiveImplementationPath = resolve(
  scriptDirectory,
  '../lib/competitor-discovery-primitives.ts',
);
const primitiveImplementationSource = await readFile(
  primitiveImplementationPath,
  'utf8',
);
const identityImplementationPath = resolve(
  scriptDirectory,
  '../lib/competitor-identity.ts',
);
const identityImplementationSource = await readFile(
  identityImplementationPath,
  'utf8',
);
const entityRoleModelPath = resolve(
  scriptDirectory,
  '../lib/competitor-entity-role-model.json',
);
const entityRoleModelSource = await readFile(entityRoleModelPath, 'utf8');
const corpus = JSON.parse(corpusSource) as Corpus;
const primitives = JSON.parse(primitiveSource) as {
  datasetVersion: string;
  corpusSha256: string;
  primitiveSourceSha256: string;
  testSealSha256: string;
  rows: {
    id: string;
    bundleId: string;
    component: string;
    partition: Partition;
  }[];
};
const scores = JSON.parse(scoreSource) as {
  schemaVersion: number;
  datasetVersion: string;
  primitiveVectorsSha256: string;
  entityRoleModelParametersSha256: string;
  decisionThreshold: number;
  segmentPenalty: number;
  testSealSha256: string;
  rankerEntityRoleTransform: RankerEntityRoleTransform;
  rows: { id: string; logit: number; score: number; source: string }[];
};
const entityRoleModel = JSON.parse(entityRoleModelSource) as {
  schemaVersion: number;
  featureVocabulary: string[];
  intercept: number;
  coefficients: number[];
  decisionThreshold: number;
  segmentPenalty: number;
  rankerEntityRoleTransform: RankerEntityRoleTransform;
};
const entityRoleModelParameters = {
  schemaVersion: entityRoleModel.schemaVersion,
  featureVocabulary: entityRoleModel.featureVocabulary,
  intercept: entityRoleModel.intercept,
  coefficients: entityRoleModel.coefficients,
  decisionThreshold: entityRoleModel.decisionThreshold,
  segmentPenalty: entityRoleModel.segmentPenalty,
};

assert.equal(
  primitives.corpusSha256,
  sha256(corpusSource),
  'Entity-role primitives do not match the training corpus bytes',
);
assert.equal(
  primitives.primitiveSourceSha256,
  sha256(primitiveImplementationSource),
  'Entity-role primitives do not match the primitive implementation bytes',
);
assert.equal(
  scores.primitiveVectorsSha256,
  sha256(primitiveSource),
  'Entity-role scores do not match the primitive artifact bytes',
);
assert.equal(
  scores.decisionThreshold,
  entityRoleModel.decisionThreshold,
  'Entity-role score threshold differs from the runtime role model',
);
assert.equal(
  scores.segmentPenalty,
  entityRoleModel.segmentPenalty,
  'Entity-role segment penalty differs from the runtime role model',
);
assert.deepEqual(
  scores.rankerEntityRoleTransform,
  entityRoleModel.rankerEntityRoleTransform,
  'Entity-role transform differs between score and model artifacts',
);

const bundlePartition = new Map(
  corpus.bundles.map((bundle) => [bundle.id, bundle.partition]),
);
const primitiveById = new Map(
  primitives.rows.map((row) => [row.id, row]),
);
assert.equal(
  primitiveById.size,
  primitives.rows.length,
  'Entity-role primitives contain duplicate ids',
);
const scoreById = new Map(scores.rows.map((row) => [row.id, row]));
assert.equal(
  scoreById.size,
  scores.rows.length,
  'Entity-role scores contain duplicate ids',
);
assert.equal(
  scoreById.size,
  primitiveById.size,
  'Entity-role score coverage differs from primitive rows',
);
for (const primitive of primitives.rows) {
  assert.equal(
    primitive.partition,
    bundlePartition.get(primitive.bundleId),
    `Primitive partition differs from its bundle: ${primitive.id}`,
  );
  const score = scoreById.get(primitive.id);
  assert.ok(score, `Entity-role score is missing: ${primitive.id}`);
  assert.ok(
    Number.isFinite(score.logit) &&
      Number.isFinite(score.score) &&
      score.score >= 0 &&
      score.score <= 1,
    `Entity-role score is invalid: ${primitive.id}`,
  );
  const expectedSource =
    primitive.partition === 'train'
      ? 'oof'
      : primitive.partition === 'validation'
        ? 'final'
        : 'final-sealed-test-label-blind';
  assert.equal(
    score.source,
    expectedSource,
    `Entity-role score source differs from its partition: ${primitive.id}`,
  );
}
assert.equal(
  scores.entityRoleModelParametersSha256,
  pythonCanonicalRoleParametersSha256(entityRoleModelParameters),
  'Entity-role scores do not match the runtime role-model parameters',
);

assert.equal(corpus.schemaVersion, 2);
assert.equal(scores.schemaVersion, 1);
assert.equal(corpus.datasetVersion, primitives.datasetVersion);
assert.equal(corpus.datasetVersion, scores.datasetVersion);
assert.equal(scores.primitiveVectorsSha256, sha256(primitiveSource));
assert.equal(scores.testSealSha256, primitives.testSealSha256);
assert.deepEqual(
  scores.rankerEntityRoleTransform,
  entityRoleModel.rankerEntityRoleTransform,
  'entity-role transform differs between score and role artifacts',
);

const componentByBundle = new Map(
  primitives.rows.map((row) => [row.bundleId, row.component]),
);
const scoreByFullId = new Map(
  scores.rows.map((row) => [row.id, { logit: row.logit, score: row.score }]),
);
const rows: {
  id: string;
  documentId: string;
  family: string;
  component: string;
  locale: string;
  partition: Partition;
  candidate: string;
  label: 0 | 1 | 'sealed';
  features: Record<string, number>;
  candidateFeed: {
    primitiveId: string;
    runId: string;
    start: number;
    end: number;
    surface: string;
    selectionOrigin: 'mwis-primary' | 'zone-recovery';
    roleLogit: number;
    roleScore: number;
  }[];
}[] = [];
let expectedPositives = 0;
let recoveredPositives = 0;

function emptyDecodeAudit(): CompetitorDecodeAudit {
  return {
    scoredSpans: 0,
    zones: 0,
    mwisPrimaryBeforeCutoff: 0,
    primaryDroppedByCutoff: 0,
    primaryDroppedByCap: 0,
    selectedPrimary: 0,
    zonesWithoutPrimary: 0,
    recoveryZoneCandidates: 0,
    recoveryDroppedByCutoff: 0,
    recoveryBlockedByOverlap: 0,
    recoveryDroppedByCap: 0,
    selectedRecovery: 0,
  };
}

const candidateFeedAudit = Object.fromEntries(
  (['train', 'validation', 'test'] as const).map((partition) => [
    partition,
    {
      inputAnswers: 0,
      processedAnswers: 0,
      answersDroppedByCap: 0,
      answersSkippedEmpty: 0,
      answersSkippedNoSeedContext: 0,
      decoder: emptyDecodeAudit(),
      selectedSpanLabels: {
        mwisPrimary: { positive: 0, negative: 0, ambiguous: 0, sealed: 0 },
        zoneRecovery: { positive: 0, negative: 0, ambiguous: 0, sealed: 0 },
      },
      rankerRows: { positive: 0, negative: 0, sealed: 0 },
    },
  ]),
) as Record<
  Partition,
  CompetitorDiscoveryAudit & {
    selectedSpanLabels: Record<
      'mwisPrimary' | 'zoneRecovery',
      Record<'positive' | 'negative' | 'ambiguous' | 'sealed', number>
    >;
    rankerRows: Record<'positive' | 'negative' | 'sealed', number>;
  }
>;

for (const bundle of corpus.bundles) {
  assert.ok(
    bundle.partition !== 'train' || !(bundle.referenceAnswers?.length ?? 0),
    `TRAIN reference answers require component-safe OOF role scores: ${bundle.id}`,
  );
  const prefix = `${bundle.id}:`;
  const roleScores = new Map<string, { logit: number; score: number }>();
  for (const [fullId, score] of scoreByFullId)
    if (fullId.startsWith(prefix))
      roleScores.set(fullId.slice(prefix.length), score);
  const bundleAudit: CompetitorDiscoveryAudit = {
    inputAnswers: 0,
    processedAnswers: 0,
    answersDroppedByCap: 0,
    answersSkippedEmpty: 0,
    answersSkippedNoSeedContext: 0,
    decoder: emptyDecodeAudit(),
  };
  const featureRows = extractCompetitorFeatureRowsWithEntityScores(
    bundle.answers,
    bundle.seeds,
    roleScores,
    { referenceAnswers: bundle.referenceAnswers, audit: bundleAudit },
  );
  const partitionAudit = candidateFeedAudit[bundle.partition];
  partitionAudit.inputAnswers += bundleAudit.inputAnswers;
  partitionAudit.processedAnswers += bundleAudit.processedAnswers;
  partitionAudit.answersDroppedByCap += bundleAudit.answersDroppedByCap;
  partitionAudit.answersSkippedEmpty += bundleAudit.answersSkippedEmpty;
  partitionAudit.answersSkippedNoSeedContext +=
    bundleAudit.answersSkippedNoSeedContext;
  for (const key of Object.keys(bundleAudit.decoder) as Array<
    keyof CompetitorDecodeAudit
  >)
    partitionAudit.decoder[key] += bundleAudit.decoder[key];
  const annotationBySpan =
    bundle.partition === 'test'
      ? null
      : new Map(
          bundle.annotations.map((annotation) => [
            `${annotation.answerId}:${annotation.start}:${annotation.end}`,
            annotation.label,
          ]),
        );
  const positiveNames =
    bundle.partition === 'test'
      ? new Set<string>()
      : new Set(
          bundle.annotations
            .filter((annotation) => annotation.label === 1)
            .map((annotation) => normalized(annotation.name)),
        );
  const ambiguousNames =
    bundle.partition === 'test'
      ? new Set<string>()
      : new Set(
          bundle.annotations
            .filter((annotation) => annotation.label === 'ambiguous')
            .map((annotation) => normalized(annotation.name)),
        );
  if (bundle.partition !== 'test') expectedPositives += positiveNames.size;
  for (const row of featureRows) {
    const name = normalized(row.name);
    if (ambiguousNames.has(name)) continue;
    const label =
      bundle.partition === 'test'
        ? ('sealed' as const)
        : positiveNames.has(name)
          ? 1
          : 0;
    if (label === 1) recoveredPositives++;
    partitionAudit.rankerRows[
      label === 'sealed' ? 'sealed' : label === 1 ? 'positive' : 'negative'
    ]++;
    for (const span of row.spans) {
      let labelKey: 'positive' | 'negative' | 'ambiguous' | 'sealed';
      if (bundle.partition === 'test') labelKey = 'sealed';
      else {
        const spanKey = `${span.runId}:${span.start}:${span.end}`;
        assert.ok(annotationBySpan);
        assert.ok(
          annotationBySpan.has(spanKey),
          `Selected span is missing an explicit annotation: ${bundle.id}:${spanKey}`,
        );
        const annotation = annotationBySpan.get(spanKey);
        assert.ok(
          annotation === 0 || annotation === 1 || annotation === 'ambiguous',
        );
        labelKey =
          annotation === 1
            ? 'positive'
            : annotation === 'ambiguous'
              ? 'ambiguous'
              : 'negative';
      }
      const originKey =
        span.selectionOrigin === 'mwis-primary'
          ? 'mwisPrimary'
          : 'zoneRecovery';
      partitionAudit.selectedSpanLabels[originKey][labelKey]++;
    }
    assert.deepEqual(Object.keys(row.features), [...COMPETITOR_FEATURE_ORDER]);
    rows.push({
      id: `${bundle.id}:${name}`,
      documentId: bundle.id,
      family: bundle.family,
      component: componentByBundle.get(bundle.id) ?? bundle.id,
      locale: bundle.locale,
      partition: bundle.partition,
      candidate: row.name,
      label,
      features: row.features,
      candidateFeed: row.spans,
    });
  }
}

const signalDistribution = Object.fromEntries(
  (['train', 'validation', 'test'] as const).map((partition) => [
    partition,
    Object.fromEntries(
      (partition === 'test' ? (['all'] as const) : ([0, 1] as const)).map(
        (label) => {
          const selected = rows.filter(
            (row) =>
              row.partition === partition &&
              (label === 'all' || row.label === label),
          );
          const summarize = (
            feature: 'context_similarity' | 'seed_proximity',
          ) => {
            const values = selected
              .map((row) => row.features[feature] ?? 0)
              .sort((left, right) => left - right);
            return {
              rows: values.length,
              nonzero: values.filter((value) => value > 0).length,
              mean: values.length
                ? values.reduce((sum, value) => sum + value, 0) / values.length
                : 0,
              p50: values.length
                ? values[Math.floor((values.length - 1) * 0.5)]
                : 0,
              p90: values.length
                ? values[Math.floor((values.length - 1) * 0.9)]
                : 0,
            };
          };
          return [
            String(label),
            {
              contextSimilarity: summarize('context_similarity'),
              seedProximity: summarize('seed_proximity'),
            },
          ];
        },
      ),
    ),
  ]),
);

const output = {
  schemaVersion: 6,
  datasetVersion: corpus.datasetVersion,
  generatedBy:
    'packages/core/scripts/generate-competitor-discovery-r6-training.ts',
  sourceCorpus:
    'packages/core/scripts/competitor-discovery-training-corpus.json',
  corpusSha256: sha256(corpusSource),
  primitiveVectors:
    'packages/core/scripts/competitor-entity-role-primitives.json',
  primitiveVectorsSha256: sha256(primitiveSource),
  entityRoleScores: 'packages/core/scripts/competitor-entity-role-scores.json',
  entityRoleScoresSha256: sha256(scoreSource),
  entityRoleModel: 'packages/core/lib/competitor-entity-role-model.json',
  entityRoleModelParametersSha256: pythonCanonicalRoleParametersSha256(
    entityRoleModelParameters,
  ),
  entityRoleTransform: entityRoleModel.rankerEntityRoleTransform,
  featureSource: 'packages/core/lib/competitor-discovery-features.ts',
  featureSourceSha256: sha256(featureSource),
  primitiveImplementation:
    'packages/core/lib/competitor-discovery-primitives.ts',
  primitiveImplementationSha256: sha256(primitiveImplementationSource),
  identityImplementation: 'packages/core/lib/competitor-identity.ts',
  identityImplementationSha256: sha256(identityImplementationSource),
  candidateFeedPolicy: {
    schemaVersion: 1,
    name: 'mwis-primary-plus-zone-recovery',
    primary:
      'MWIS over roleLogit minus the trained segment penalty; primary spans are capped first by descending contribution with code-point tie breaks.',
    recovery:
      'The highest-logit span from each zone without a retained primary is ordered by raw role logit, then longer span, lower UTF-16 start, and normalized-name code points. Non-overlapping spans fill only the capacity left by primaries.',
    oneRecoveryPerZone: true,
    recoveredSpansMustNotOverlapRetainedSpans: true,
    rankerFeedCutoff: false,
    implicitPrimaryFloor:
      'MWIS excludes a span when roleLogit minus segmentPenalty is negative; with zero penalty this is a roleLogit floor of zero.',
    maxSelectedPerAnswer: 256,
    maxAnswersPerExtraction: 20,
  },
  candidateFeedAudit,
  featureOrder: COMPETITOR_FEATURE_ORDER,
  signalAblation: {
    schemaVersion: 1,
    name: 'primary-context-interaction',
    removedFeature: 'primary_context_similarity',
    matchedCandidateFeed: true,
  },
  testSealSha256: primitives.testSealSha256,
  testEvaluationCount: 0,
  metrics: {
    expectedPositives,
    recoveredPositives,
    candidateRecall: expectedPositives
      ? recoveredPositives / expectedPositives
      : 0,
    candidateRecallScope: 'train-and-validation-only',
    sealedTestLabelsRead: false,
    signalDistribution,
  },
  rows,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify(
    { output: outputPath, rows: rows.length, metrics: output.metrics },
    null,
    2,
  ),
);
