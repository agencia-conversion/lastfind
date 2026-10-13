#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  competitorBundleCasing,
  enumerateCompetitorSpans,
  type DiscoveryPrimitiveAnswer,
  type DiscoveryPrimitiveSeed,
} from '../lib/competitor-discovery-primitives.ts';

type Partition = 'train' | 'validation' | 'test';
type AnnotationLabel = 0 | 1 | 'ambiguous';
type SpanLabel = AnnotationLabel | 'sealed';

type Annotation = {
  answerId: string;
  start: number;
  end: number;
  name: string;
  label: AnnotationLabel;
  stratum?: string;
  rationale: string;
};

type CorpusBundle = {
  id: string;
  family: string;
  relations: string[];
  lineage: string;
  locale: 'en' | 'pt-BR';
  partition: Partition;
  seeds: DiscoveryPrimitiveSeed[];
  answers: DiscoveryPrimitiveAnswer[];
  declaredPositiveSpans: Omit<Annotation, 'label'>[];
  annotations: Annotation[];
};

type Corpus = {
  schemaVersion: 2;
  datasetVersion: string;
  description: string;
  noHumanAnnotation: true;
  bundles: CorpusBundle[];
};

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function shingles(bundle: CorpusBundle): Set<string> {
  const tokens = normalized(
    bundle.answers.map((answer) => answer.answer).join(' '),
  ).split(' ');
  return new Set(
    Array.from({ length: Math.max(0, tokens.length - 4) }, (_, index) =>
      tokens.slice(index, index + 5).join(' '),
    ),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const corpusPath = resolve(
  process.argv[2] ??
    resolve(scriptDirectory, 'competitor-discovery-training-corpus.json'),
);
const outputPath = resolve(
  process.argv[3] ??
    resolve(scriptDirectory, 'competitor-entity-role-primitives.json'),
);
const primitiveSourcePath = resolve(
  scriptDirectory,
  '../lib/competitor-discovery-primitives.ts',
);
const corpusSource = await readFile(corpusPath, 'utf8');
const primitiveSource = await readFile(primitiveSourcePath, 'utf8');
const corpus = JSON.parse(corpusSource) as Corpus;

assert.equal(corpus.schemaVersion, 2);
assert.equal(corpus.noHumanAnnotation, true);
assert.ok(
  corpus.bundles.length >= 120,
  'R6 corpus requires at least 120 bundles',
);
assert.ok(
  corpus.bundles.filter((bundle) => bundle.locale === 'en').length >= 60 &&
    corpus.bundles.filter((bundle) => bundle.locale === 'pt-BR').length >= 60,
  'R6 corpus requires at least 60 bundles per locale',
);

const parents = new Map(corpus.bundles.map((bundle) => [bundle.id, bundle.id]));
const find = (id: string): string => {
  const parent = parents.get(id);
  assert.ok(parent, `unknown bundle ${id}`);
  if (parent === id) return id;
  const root = find(parent);
  parents.set(id, root);
  return root;
};
const union = (left: string, right: string) => {
  const leftRoot = find(left);
  const rightRoot = find(right);
  if (leftRoot === rightRoot) return;
  if (leftRoot.localeCompare(rightRoot) <= 0) parents.set(rightRoot, leftRoot);
  else parents.set(leftRoot, rightRoot);
};
const relationOwner = new Map<string, string>();
const edges: { left: string; right: string; reason: string }[] = [];
for (const bundle of corpus.bundles) {
  const positiveNames =
    bundle.partition === 'test'
      ? []
      : bundle.annotations
          .filter((annotation) => annotation.label === 1)
          .map((annotation) => normalized(annotation.name));
  const keys = [
    `family:${bundle.family}`,
    `lineage:${bundle.lineage}`,
    ...bundle.relations.map((relation) => `relation:${relation}`),
    ...bundle.seeds.flatMap((seed) =>
      [seed.name, ...(seed.aliases ?? [])].map(
        (name) => `seed:${normalized(name)}`,
      ),
    ),
    ...positiveNames.map((name) => `positive:${name}`),
  ];
  // Repeated negative/generic surfaces intentionally do not form edges.
  for (const key of keys) {
    const owner = relationOwner.get(key);
    if (owner) {
      union(owner, bundle.id);
      edges.push({ left: owner, right: bundle.id, reason: key });
    } else relationOwner.set(key, bundle.id);
  }
}
const shingleSets = new Map(
  corpus.bundles.map((bundle) => [bundle.id, shingles(bundle)]),
);
for (let leftIndex = 0; leftIndex < corpus.bundles.length; leftIndex++)
  for (
    let rightIndex = leftIndex + 1;
    rightIndex < corpus.bundles.length;
    rightIndex++
  ) {
    const left = corpus.bundles[leftIndex]!;
    const right = corpus.bundles[rightIndex]!;
    const similarity = jaccard(
      shingleSets.get(left.id)!,
      shingleSets.get(right.id)!,
    );
    if (similarity < 0.72) continue;
    union(left.id, right.id);
    edges.push({
      left: left.id,
      right: right.id,
      reason: `near-duplicate:${similarity.toFixed(6)}`,
    });
  }

const componentPartitions = new Map<string, Set<Partition>>();
for (const bundle of corpus.bundles) {
  const component = find(bundle.id);
  const partitions = componentPartitions.get(component) ?? new Set<Partition>();
  partitions.add(bundle.partition);
  componentPartitions.set(component, partitions);
}
for (const [component, partitions] of componentPartitions)
  assert.equal(partitions.size, 1, `component ${component} crosses partitions`);

const rows: {
  id: string;
  bundleId: string;
  component: string;
  family: string;
  locale: string;
  partition: Partition;
  answerId: string;
  start: number;
  end: number;
  zoneStart: number;
  zoneEnd: number;
  candidate: string;
  normalizedName: string;
  label: SpanLabel;
  strata: string[];
  structure: string;
  features: Record<string, number>;
}[] = [];
let declaredPositiveCount = 0;
let recoveredPositiveCount = 0;
const annotationCounts = new Map<string, number>();

for (const bundle of corpus.bundles) {
  const bundleCasingByToken = competitorBundleCasing(bundle.answers);
  const answers = new Map(bundle.answers.map((answer) => [answer.id, answer]));
  const annotations = new Map<string, Annotation>();
  for (const annotation of bundle.partition === 'test'
    ? []
    : bundle.annotations) {
    const answer = answers.get(annotation.answerId);
    assert.ok(
      answer,
      `${bundle.id}: annotation has unknown answer ${annotation.answerId}`,
    );
    assert.equal(
      answer.answer.slice(annotation.start, annotation.end),
      annotation.name,
      `${bundle.id}: annotation span drifted for ${annotation.name}`,
    );
    const key = `${annotation.answerId}:${annotation.start}:${annotation.end}`;
    assert.ok(
      !annotations.has(key),
      `${bundle.id}: duplicate annotation ${key}`,
    );
    annotations.set(key, annotation);
  }
  if (bundle.partition !== 'test')
    declaredPositiveCount += bundle.declaredPositiveSpans.length;
  for (const positive of bundle.partition === 'test'
    ? []
    : bundle.declaredPositiveSpans) {
    const answer = answers.get(positive.answerId);
    assert.ok(
      answer,
      `${bundle.id}: positive has unknown answer ${positive.answerId}`,
    );
    assert.equal(
      answer.answer.slice(positive.start, positive.end),
      positive.name,
    );
  }

  for (
    let answerIndex = 0;
    answerIndex < bundle.answers.length;
    answerIndex++
  ) {
    const answer = bundle.answers[answerIndex]!;
    const enumerated = enumerateCompetitorSpans(
      answer,
      bundle.seeds,
      answerIndex,
      { bundleCasingByToken },
    ).spans;
    for (const span of enumerated) {
      const key = `${span.answerId}:${span.start}:${span.end}`;
      const annotation =
        bundle.partition === 'test' ? undefined : annotations.get(key);
      if (bundle.partition !== 'test') {
        assert.ok(
          annotation,
          `${bundle.id}: enumerated span lacks explicit annotation: ${key} ${span.name}`,
        );
        assert.equal(
          annotation.name,
          span.name,
          `${bundle.id}: annotation surface differs for ${key}`,
        );
        const countKey = `${bundle.id}:${key}`;
        annotationCounts.set(
          countKey,
          (annotationCounts.get(countKey) ?? 0) + 1,
        );
      }
      rows.push({
        id: `${bundle.id}:${span.id}`,
        bundleId: bundle.id,
        component: find(bundle.id),
        family: bundle.family,
        locale: bundle.locale,
        partition: bundle.partition,
        answerId: span.answerId,
        start: span.start,
        end: span.end,
        zoneStart: span.zoneStart,
        zoneEnd: span.zoneEnd,
        candidate: span.name,
        normalizedName: span.normalizedName,
        label: annotation?.label ?? 'sealed',
        strata: annotation?.stratum ? [annotation.stratum] : [],
        structure: span.structure,
        features: span.features,
      });
    }
  }
  for (const annotation of bundle.partition === 'test'
    ? []
    : bundle.annotations)
    assert.equal(
      annotationCounts.get(
        `${bundle.id}:${annotation.answerId}:${annotation.start}:${annotation.end}`,
      ),
      1,
      `${bundle.id}: annotation was not enumerated exactly once: ${annotation.name}`,
    );
  for (const positive of bundle.partition === 'test'
    ? []
    : bundle.declaredPositiveSpans)
    if (
      bundle.annotations.some(
        (annotation) =>
          annotation.answerId === positive.answerId &&
          annotation.start === positive.start &&
          annotation.end === positive.end &&
          annotation.label === 1,
      )
    )
      recoveredPositiveCount++;
}

const ambiguousCount = rows.filter((row) => row.label === 'ambiguous').length;
const labeledRowCount = rows.filter((row) => row.partition !== 'test').length;
const positiveCount = rows.filter((row) => row.label === 1).length;
const negativeStrata = Object.fromEntries(
  [
    'functional',
    'verbal-prefix',
    'publisher',
    'category-service',
    'boundary',
  ].map((stratum) => [
    stratum,
    rows.filter((row) => row.label === 0 && row.strata.includes(stratum))
      .length,
  ]),
);
assert.ok(
  positiveCount >= 150,
  'R6 corpus requires at least 150 positive spans',
);
for (const [stratum, count] of Object.entries(negativeStrata))
  assert.ok(count >= 40, `R6 corpus requires at least 40 ${stratum} negatives`);
assert.ok(
  ambiguousCount / labeledRowCount <= 0.05,
  'ambiguous spans exceed 5% of labeled train/validation rows',
);

const testBundles = corpus.bundles
  .filter((bundle) => bundle.partition === 'test')
  .sort((left, right) => left.id.localeCompare(right.id));
const testSealSha256 = sha256(`${JSON.stringify(testBundles)}\n`);
const output = {
  schemaVersion: 1,
  datasetVersion: corpus.datasetVersion,
  generatedBy:
    'packages/core/scripts/generate-competitor-entity-role-primitives.ts',
  sourceCorpus:
    'packages/core/scripts/competitor-discovery-training-corpus.json',
  corpusSha256: sha256(corpusSource),
  primitiveSource: 'packages/core/lib/competitor-discovery-primitives.ts',
  primitiveSourceSha256: sha256(primitiveSource),
  splitPolicy: testBundles.length
    ? 'Connected components over family, declared relations, lineage, seed identity, and five-token near duplicates at 0.72 for every partition. Positive-company identity creates edges only in labeled train/validation partitions; sealed test gold is not consulted. Negative surfaces never create component edges.'
    : 'Connected components over family, declared relations, lineage, seed identity, positive-company identity, and five-token near duplicates at 0.72. Negative surfaces never create component edges.',
  splitAudit: {
    edges: edges.sort(
      (left, right) =>
        left.left.localeCompare(right.left) ||
        left.right.localeCompare(right.right) ||
        left.reason.localeCompare(right.reason),
    ),
    components: Object.fromEntries(
      [...componentPartitions.keys()].sort().map((component) => [
        component,
        corpus.bundles
          .filter((bundle) => find(bundle.id) === component)
          .map((bundle) => bundle.id)
          .sort(),
      ]),
    ),
  },
  testSealSha256,
  testEvaluationCount: 0,
  metrics: {
    bundles: corpus.bundles.length,
    rows: rows.length,
    positives: positiveCount,
    declaredPositiveCount,
    recoveredPositiveCount,
    enumeratorRecall: declaredPositiveCount
      ? recoveredPositiveCount / declaredPositiveCount
      : 0,
    ambiguous: ambiguousCount,
    negativeStrata,
  },
  rows,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify(
    { output: outputPath, metrics: output.metrics, testSealSha256 },
    null,
    2,
  ),
);
