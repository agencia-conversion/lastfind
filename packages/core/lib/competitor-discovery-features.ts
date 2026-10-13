import roleModelArtifact from './competitor-entity-role-model.json' with { type: 'json' };
import { competitorIdentity } from './competitor-identity.ts';
import {
  compareUnicodeCodePoints,
  competitorBundleCasing,
  enumerateCompetitorSpans,
  MAX_DISCOVERY_SELECTED_PER_ANSWER,
  preparedCompetitorDiscoveryAnswer,
  type CompetitorSpanPrimitive,
} from './competitor-discovery-primitives.ts';

export type DiscoveryAnswer = {
  id: string;
  answer: string;
  sources: { url: string; domain: string; title: string }[];
  createdAt: string;
};

export type DiscoverySeed = {
  name: string;
  domain: string;
  aliases?: string[];
  domains?: string[];
};

export type CompetitorCandidate = {
  name: string;
  domain: string | null;
  domainEvidence: 'none' | 'unique' | 'conflict';
  score: number;
  answerCount: number;
  evidence: { runId: string; excerpt: string; createdAt: string }[];
};

type Structure = 'table' | 'list' | 'heading' | 'emphasis' | 'link' | 'prose';

type Occurrence = {
  start: number;
  end: number;
  surface: string;
  structure: Structure;
  linkedDomain: string | null;
  citationLike: boolean;
  inReferenceSection: boolean;
  extractionPriority: number;
};

type ParsedLink = {
  label: string;
  labelStart: number;
  labelEnd: number;
  rawUrl: string;
  start: number;
  end: number;
};

type ParsedEmphasis = {
  value: string;
  start: number;
  end: number;
};

type ParsedLine = {
  text: string;
  start: number;
  end: number;
  structure: Structure;
  links: ParsedLink[];
  emphasis: ParsedEmphasis[];
};

type ParsedAnswer = {
  visibleText: string;
  lines: ParsedLine[];
  links: ParsedLink[];
};

export type CompetitorFeatureVector = Record<string, number>;

export type RankerEntityRoleTransform = {
  schemaVersion: 1;
  name: 'clipped-affine-logit-percentile';
  source: 'oof-train';
  percentileMethod: 'numpy.percentile(method=linear)';
  lowerPercentile: 1;
  upperPercentile: 99;
  roundingDecimals: 6;
  zLo: number;
  zHi: number;
  formula: 'clip((z-zLo)/(zHi-zLo),0,1)';
  selectedRows: number;
  inputSha256: string;
};

export const COMPETITOR_FEATURE_ORDER = [
  'context_similarity',
  'primary_context_similarity',
  'seed_proximity',
  'structure_similarity',
  'list_table_role',
  'comparison_language',
  'repeated_mention',
  'name_quality',
  'direct_domain',
  'source_only',
  'heading_only',
  'generic_entity',
  'publisher_citation',
  'answer_support',
  'distinct_link_domains_per_surface',
  'link_label_only',
  'mwis_primary_fraction',
  'entity_role',
] as const;

export type CompetitorFeatureRow = {
  name: string;
  domain: string | null;
  domainEvidence: 'none' | 'unique' | 'conflict';
  features: CompetitorFeatureVector;
  answerCount: number;
  occurrenceCount: number;
  spans: {
    primitiveId: string;
    runId: string;
    start: number;
    end: number;
    surface: string;
    selectionOrigin: 'mwis-primary' | 'zone-recovery';
    roleLogit: number;
    roleScore: number;
  }[];
  evidence: { runId: string; excerpt: string; createdAt: string }[];
};

export function competitorMwisPrimaryFraction(
  spans: readonly { selectionOrigin?: unknown }[],
): number {
  if (!spans.length)
    throw new Error('Competitor candidate feed must contain at least one span');
  let primary = 0;
  for (const span of spans) {
    if (
      span.selectionOrigin !== 'mwis-primary' &&
      span.selectionOrigin !== 'zone-recovery'
    )
      throw new Error('Invalid competitor candidate selection origin');
    if (span.selectionOrigin === 'mwis-primary') primary++;
  }
  return primary / spans.length;
}

export type CompetitorDecodeAudit = {
  scoredSpans: number;
  zones: number;
  mwisPrimaryBeforeCutoff: number;
  primaryDroppedByCutoff: number;
  primaryDroppedByCap: number;
  selectedPrimary: number;
  zonesWithoutPrimary: number;
  recoveryZoneCandidates: number;
  recoveryDroppedByCutoff: number;
  recoveryBlockedByOverlap: number;
  recoveryDroppedByCap: number;
  selectedRecovery: number;
};

export type CompetitorDiscoveryAudit = {
  inputAnswers: number;
  processedAnswers: number;
  answersDroppedByCap: number;
  answersSkippedEmpty: number;
  answersSkippedNoSeedContext: number;
  decoder: CompetitorDecodeAudit;
};

/**
 * Optional, opt-in counters on the answer x seed axis. Kept separate from
 * CompetitorDiscoveryAudit so serialized audits (candidateFeedAudit in the
 * training vectors) keep their exact shape. Counters only move when a caller
 * supplies the object; they never influence a decision, an order or a value.
 */
export type CompetitorDiscoveryWorkAudit = {
  seedAnswerScans: number;
  normalizedAnswerComputations: number;
  normalizedCharacters: number;
};

type SeedOccurrence = {
  start: number;
  end: number;
  structure: Structure;
  context: string;
  contextText: string;
  answer: DiscoveryAnswer;
  local: boolean;
  answerId: string;
};

type RoleModelArtifact = {
  schemaVersion: number;
  modelType: string;
  classOrder: number[];
  featureVocabulary: string[];
  intercept: number;
  coefficients: number[];
  decisionThreshold: number;
  segmentPenalty: number;
  rankerEntityRoleTransform: RankerEntityRoleTransform;
  provenance: {
    datasetVersion: string;
    primitiveSourceSha256: string;
    corpusSha256: string;
    primitiveVectorsSha256: string;
    splitPolicy: string;
    testEvaluationCount: number;
  };
  parityVectors: {
    id: string;
    features: Record<string, number>;
    logit: number;
    score: number;
  }[];
};

const roleModel = roleModelArtifact as unknown as RoleModelArtifact;

function validateRoleModelArtifact(artifact: RoleModelArtifact): void {
  const rankerTransform = artifact.rankerEntityRoleTransform;
  const expectedTransformFields = [
    'schemaVersion',
    'name',
    'source',
    'percentileMethod',
    'lowerPercentile',
    'upperPercentile',
    'roundingDecimals',
    'zLo',
    'zHi',
    'formula',
    'selectedRows',
    'inputSha256',
  ].sort(compareUnicodeCodePoints);
  if (
    artifact.schemaVersion !== 1 ||
    artifact.modelType !== 'sklearn.linear_model.LogisticRegression' ||
    artifact.classOrder.length !== 2 ||
    artifact.classOrder[0] !== 0 ||
    artifact.classOrder[1] !== 1
  )
    throw new Error('Unsupported competitor entity-role model schema');
  if (
    artifact.featureVocabulary.length === 0 ||
    artifact.featureVocabulary.length > 12_000 ||
    artifact.featureVocabulary.length !== artifact.coefficients.length ||
    new Set(artifact.featureVocabulary).size !==
      artifact.featureVocabulary.length ||
    artifact.featureVocabulary.some((feature) =>
      feature.startsWith('candidate'),
    ) ||
    artifact.featureVocabulary.some(
      (feature, index) =>
        index > 0 &&
        compareUnicodeCodePoints(
          feature,
          artifact.featureVocabulary[index - 1]!,
        ) <= 0,
    ) ||
    !Number.isFinite(artifact.intercept) ||
    artifact.coefficients.some(
      (coefficient) => !Number.isFinite(coefficient),
    ) ||
    !Number.isFinite(artifact.decisionThreshold) ||
    artifact.decisionThreshold < 0 ||
    artifact.decisionThreshold > 1 ||
    !Number.isFinite(artifact.segmentPenalty) ||
    artifact.segmentPenalty < 0 ||
    rankerTransform?.schemaVersion !== 1 ||
    Object.keys(rankerTransform)
      .sort(compareUnicodeCodePoints)
      .join('\u0000') !== expectedTransformFields.join('\u0000') ||
    rankerTransform.name !== 'clipped-affine-logit-percentile' ||
    rankerTransform.source !== 'oof-train' ||
    rankerTransform.percentileMethod !== 'numpy.percentile(method=linear)' ||
    rankerTransform.lowerPercentile !== 1 ||
    rankerTransform.upperPercentile !== 99 ||
    rankerTransform.roundingDecimals !== 6 ||
    typeof rankerTransform.zLo !== 'number' ||
    typeof rankerTransform.zHi !== 'number' ||
    !Number.isFinite(rankerTransform.zLo) ||
    !Number.isFinite(rankerTransform.zHi) ||
    rankerTransform.zHi <= rankerTransform.zLo ||
    rankerTransform.formula !== 'clip((z-zLo)/(zHi-zLo),0,1)' ||
    !Number.isSafeInteger(rankerTransform.selectedRows) ||
    rankerTransform.selectedRows < 1 ||
    !/^[a-f0-9]{64}$/u.test(rankerTransform.inputSha256)
  )
    throw new Error('Competitor entity-role model artifact is invalid');
}

validateRoleModelArtifact(roleModel);
export const COMPETITOR_ENTITY_ROLE_TRANSFORM =
  roleModel.rankerEntityRoleTransform;

export function transformCompetitorEntityRoleLogit(logit: number): number {
  if (!Number.isFinite(logit))
    throw new Error('Invalid competitor entity-role logit');
  const { zLo, zHi } = COMPETITOR_ENTITY_ROLE_TRANSFORM;
  return Math.min(1, Math.max(0, (logit - zLo) / (zHi - zLo)));
}
const roleVocabulary = new Map(
  roleModel.featureVocabulary.map((feature, index) => [feature, index]),
);

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'before',
  'by',
  'com',
  'da',
  'das',
  'de',
  'deles',
  'delas',
  'do',
  'dos',
  'e',
  'em',
  'during',
  'for',
  'from',
  'in',
  'is',
  'it',
  'its',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'of',
  'os',
  'ou',
  'para',
  'por',
  'que',
  'seu',
  'sua',
  'the',
  'their',
  'to',
  'um',
  'uma',
  'with',
  'durante',
]);

const GENERIC_WORDS = new Set([
  'agency',
  'agencia',
  'agencias',
  'analysis',
  'analise',
  'atendimento',
  'audit',
  'auditoria',
  'audits',
  'best',
  'choosing',
  'consulting',
  'crescimento',
  'conclusion',
  'conclusao',
  'consultadas',
  'consultoria',
  'conteudo',
  'content',
  'coverage',
  'delivery',
  'editorial',
  'estrategia',
  'features',
  'ferramenta',
  'ferramentas',
  'fonte',
  'fontes',
  'growth',
  'market',
  'mercado',
  'organic',
  'organico',
  'overview',
  'personalizado',
  'personalized',
  'plano',
  'platform',
  'platforms',
  'precos',
  'pricing',
  'principais',
  'quality',
  'qualidade',
  'recursos',
  'recommended',
  'referencias',
  'references',
  'relatorio',
  'report',
  'resources',
  'service',
  'services',
  'servico',
  'servicos',
  'solucao',
  'solution',
  'solutions',
  'software',
  'sources',
  'strategy',
  'strategic',
  'estrategica',
  'estrategico',
  'support',
  'tool',
  'tools',
  'technical',
  'tecnica',
  'tecnico',
]);

const GENERIC_PHRASES = new Set([
  'conclusao',
  'consideracoes finais',
  'customer support',
  'estrategia de geo',
  'estrategia de geo aeo',
  'estrategia de seo',
  'fontes',
  'fontes consultadas',
  'market overview',
  'plano de crescimento',
  'principais recursos',
  'recursos e precos',
  'references',
  'sources',
]);

const COMPARISON_RE =
  /\b(?:alternative|alternatives|alternativa|alternativas|compare|compared|compares|comparar|compare|compara|competitor|competitors|concorrente|concorrentes|leading|lideres|líderes|opcao|opcoes|opção|opções|player|players|versus|\bvs\.?\b)\b/iu;
const GENERIC_CATEGORY_RE =
  /^(?:agency|ag[eê]ncia|consultancy|consultoria|platform|plataforma|provider|provedor|service|servi[cç]o|solution|solu[cç][aã]o|software|tool|ferramenta)\s+(?:da|de|do|for|of)\s+.{2,60}$/iu;
// Stored answers are already bounded to 180k. Repeated mentions saturate the
// model after three occurrences, so larger samples add CPU cost but no signal.
const MAX_ANSWER_CHARACTERS = 180_000;
const MAX_DISCOVERY_ANSWERS = 20;
const MAX_SEED_CONTEXTS_PER_ANSWER = 24;
const MAX_REFERENCE_SEED_CONTEXTS = 32;

function normalizedText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizedName(value: string): string {
  return competitorIdentity(value);
}

function words(value: string): string[] {
  return normalizedText(value).match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

function structureForLine(line: string): Structure {
  if (/^\s*#{1,6}\s+\d+[.)]\s*/u.test(line)) return 'list';
  if (/^\s*#{1,6}\s+/u.test(line)) return 'heading';
  if ((line.match(/\|/gu) ?? []).length >= 2) return 'table';
  if (/^\s*(?:[-+*•]|\d+[.)])\s+/u.test(line)) return 'list';
  return 'prose';
}

function safeDomain(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

function parsedAnswer(answer: DiscoveryAnswer): ParsedAnswer {
  return preparedCompetitorDiscoveryAnswer(answer);
}

function clauseAt(text: string, start: number, end: number): string {
  const boundaryAt = (index: number) => {
    const character = text[index] ?? '';
    if (/[\n!?;]/u.test(character)) return true;
    return (
      character === '.' &&
      (index + 1 >= text.length || /\s/u.test(text[index + 1] ?? ''))
    );
  };
  let clauseStart = start;
  let clauseEnd = end;
  const floor = Math.max(0, start - 320);
  const ceiling = Math.min(text.length, end + 320);
  while (clauseStart > floor && !boundaryAt(clauseStart - 1)) clauseStart--;
  while (clauseEnd < ceiling && !boundaryAt(clauseEnd)) clauseEnd++;
  return text.slice(clauseStart, clauseEnd);
}

function contextualClauseAt(
  answer: DiscoveryAnswer,
  contextText: string,
  start: number,
  end: number,
  includeHeadingDescription = true,
): string {
  const base = clauseAt(contextText, start, end);
  if (!includeHeadingDescription) return base;
  const parsed = parsedAnswer(answer);
  const lineIndex = parsed.lines.findIndex(
    (line) => start >= line.start && start <= line.end,
  );
  const line = parsed.lines[lineIndex];
  if (
    !line ||
    !/^\s*#{1,6}\s+\d+[.)]\s*/u.test(line.text) ||
    lineIndex + 1 >= parsed.lines.length
  )
    return base;
  let nextIndex = lineIndex + 1;
  while (
    nextIndex < parsed.lines.length &&
    !parsed.lines[nextIndex]!.text.trim()
  )
    nextIndex++;
  const next = parsed.lines[nextIndex];
  if (!next || next.structure !== 'prose') return base;
  const description = clauseAt(
    contextText,
    next.start,
    Math.min(next.end, next.start + 1),
  ).trim();
  return `${base.trim()} ${description}`.trim().slice(0, 320);
}

function contextTokens(text: string, maskedTokens: Set<string>): string[] {
  const terms: string[] = [];
  for (const token of words(text)) {
    if (STOP_WORDS.has(token) || maskedTokens.has(token)) continue;
    terms.push(`word:${token}`);
    // Character bigrams preserve a small amount of morphological similarity
    // across Portuguese/English inflections while remaining portable sparse
    // evidence. They are context terms, never a candidate allow/deny rule.
    for (let index = 0; index + 2 <= token.length; index++)
      terms.push(`char2:${token.slice(index, index + 2)}`);
  }
  return terms;
}

type TokenVector = {
  counts: Map<string, number>;
  norm: number;
};

function tokenVector(tokens: string[]): TokenVector {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let squaredNorm = 0;
  for (const value of counts.values()) squaredNorm += value * value;
  return { counts, norm: Math.sqrt(squaredNorm) };
}

function cosineVectors(left: TokenVector, right: TokenVector): number {
  if (!left.norm || !right.norm) return 0;
  const [smaller, larger] =
    left.counts.size <= right.counts.size
      ? [left.counts, right.counts]
      : [right.counts, left.counts];
  let dot = 0;
  for (const [token, value] of smaller) dot += value * (larger.get(token) ?? 0);
  return Math.min(1, Math.max(0, dot / (left.norm * right.norm)));
}

function normalizedWithOffsets(
  value: string,
  workAudit?: CompetitorDiscoveryWorkAudit,
): {
  text: string;
  starts: number[];
  ends: number[];
} {
  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let sourceOffset = 0;
  let previousWasSpace = true;
  for (const sourceCharacter of value) {
    const sourceEnd = sourceOffset + sourceCharacter.length;
    const normalized = sourceCharacter
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
    let emittedForSource = false;
    for (const normalizedCharacter of normalized) {
      const emitted = /[\p{L}\p{N}]/u.test(normalizedCharacter)
        ? normalizedCharacter
        : ' ';
      if (emitted === ' ' && previousWasSpace) {
        if (ends.length) ends[ends.length - 1] = sourceEnd;
        continue;
      }
      for (let unit = 0; unit < emitted.length; unit++) {
        characters.push(emitted[unit] ?? '');
        starts.push(sourceOffset);
        ends.push(sourceEnd);
      }
      emittedForSource = true;
      previousWasSpace = emitted === ' ';
    }
    if (!emittedForSource && /\p{M}/u.test(sourceCharacter) && ends.length)
      ends[ends.length - 1] = sourceEnd;
    sourceOffset = sourceEnd;
  }
  if (characters.at(-1) === ' ') {
    characters.pop();
    starts.pop();
    ends.pop();
  }
  const text = characters.join('');
  if (workAudit) {
    workAudit.normalizedAnswerComputations += 1;
    workAudit.normalizedCharacters += text.length;
  }
  return { text, starts, ends };
}

type NormalizedAnswerOffsets = ReturnType<typeof normalizedWithOffsets>;

const normalizedAnswerCache = new WeakMap<
  DiscoveryAnswer,
  NormalizedAnswerOffsets
>();

function normalizedAnswerOffsets(
  answer: DiscoveryAnswer,
  workAudit?: CompetitorDiscoveryWorkAudit,
): NormalizedAnswerOffsets {
  const cached = normalizedAnswerCache.get(answer);
  if (cached) return cached;
  const normalized = normalizedWithOffsets(answer.answer, workAudit);
  normalizedAnswerCache.set(answer, normalized);
  return normalized;
}

function positionallyMaskedContext(
  answer: DiscoveryAnswer,
  seeds: DiscoverySeed[],
  selected: readonly {
    start: number;
    end: number;
    selectionOrigin?: 'mwis-primary' | 'zone-recovery';
  }[],
  workAudit?: CompetitorDiscoveryWorkAudit,
): string {
  const parsed = parsedAnswer(answer);
  const masked = parsed.visibleText.split('');
  const ranges = new Set<string>();
  for (const span of selected)
    if (span.selectionOrigin === 'mwis-primary')
      ranges.add(`${span.start}:${span.end}`);

  const normalizedAnswer = normalizedAnswerOffsets(answer, workAudit);
  for (const seed of seeds) {
    for (const name of [seed.name, ...(seed.aliases ?? [])]) {
      const needle = normalizedText(name);
      if (!needle) continue;
      let normalizedStart = normalizedAnswer.text.indexOf(needle);
      while (normalizedStart >= 0) {
        const before = normalizedAnswer.text[normalizedStart - 1] ?? ' ';
        const after =
          normalizedAnswer.text[normalizedStart + needle.length] ?? ' ';
        if (before === ' ' && after === ' ') {
          const start = normalizedAnswer.starts[normalizedStart];
          const end =
            normalizedAnswer.ends[normalizedStart + needle.length - 1];
          if (start !== undefined && end !== undefined)
            ranges.add(`${start}:${end}`);
        }
        normalizedStart = normalizedAnswer.text.indexOf(
          needle,
          normalizedStart + Math.max(1, needle.length),
        );
      }
    }
  }

  for (const range of ranges) {
    const [start, end] = range.split(':').map(Number);
    if (
      start === undefined ||
      end === undefined ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > masked.length
    )
      throw new Error('Invalid competitor context mask range');
    for (let index = start; index < end; index++) masked[index] = ' ';
  }
  return masked.join('');
}

function positionallyMaskRange(
  text: string,
  start: number,
  end: number,
): string {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > text.length
  )
    throw new Error('Invalid competitor self-mask range');
  return `${text.slice(0, start)}${' '.repeat(end - start)}${text.slice(end)}`;
}

function findSeedOccurrences(
  answer: DiscoveryAnswer,
  seeds: DiscoverySeed[],
  local = true,
  contextText = parsedAnswer(answer).visibleText,
  includeHeadingDescription = true,
  workAudit?: CompetitorDiscoveryWorkAudit,
  normalizedAnswer = normalizedAnswerOffsets(answer, workAudit),
): SeedOccurrence[] {
  const parsed = parsedAnswer(answer);
  const ranges = parsed.lines;
  const found: SeedOccurrence[] = [];
  const seen = new Set<number>();
  for (const seed of seeds) {
    if (workAudit) workAudit.seedAnswerScans += 1;
    for (const name of [seed.name, ...(seed.aliases ?? [])]) {
      const needle = normalizedText(name);
      if (!needle) continue;
      let normalizedStart = normalizedAnswer.text.indexOf(needle);
      while (
        normalizedStart >= 0 &&
        found.length < MAX_SEED_CONTEXTS_PER_ANSWER
      ) {
        const before = normalizedAnswer.text[normalizedStart - 1] ?? ' ';
        const after =
          normalizedAnswer.text[normalizedStart + needle.length] ?? ' ';
        const bounded = before === ' ' && after === ' ';
        const start = normalizedAnswer.starts[normalizedStart] ?? 0;
        const end =
          normalizedAnswer.ends[normalizedStart + needle.length - 1] ?? start;
        if (bounded && !seen.has(start)) {
          const line = ranges.find(
            (range) => start >= range.start && start <= range.end,
          );
          found.push({
            start,
            end,
            structure: line ? structureForLine(line.text) : 'prose',
            context: contextualClauseAt(
              answer,
              contextText,
              start,
              end,
              includeHeadingDescription,
            ),
            contextText,
            answer,
            local,
            answerId: answer.id,
          });
          seen.add(start);
        }
        normalizedStart = normalizedAnswer.text.indexOf(
          needle,
          normalizedStart + Math.max(1, needle.length),
        );
      }
      if (found.length >= MAX_SEED_CONTEXTS_PER_ANSWER) return found;
    }
  }
  return found;
}

function collectSeedContexts(
  answers: DiscoveryAnswer[],
  seeds: DiscoverySeed[],
  limit: number,
  local: boolean,
  contextTextByAnswer?: WeakMap<DiscoveryAnswer, string>,
  includeHeadingDescription = true,
  workAudit?: CompetitorDiscoveryWorkAudit,
): SeedOccurrence[] {
  const answerBucketsBySeed = seeds.map(() => [] as SeedOccurrence[][]);
  for (const answer of answers) {
    const normalizedAnswer = normalizedAnswerOffsets(answer, workAudit);
    for (let seedIndex = 0; seedIndex < seeds.length; seedIndex++)
      answerBucketsBySeed[seedIndex].push(
        findSeedOccurrences(
          answer,
          [seeds[seedIndex]],
          local,
          contextTextByAnswer?.get(answer),
          includeHeadingDescription,
          workAudit,
          normalizedAnswer,
        ),
      );
  }
  const queues = answerBucketsBySeed.map((answerBuckets) => {
    const queue: SeedOccurrence[] = [];
    for (let occurrenceIndex = 0; ; occurrenceIndex++) {
      let found = false;
      for (const bucket of answerBuckets) {
        const occurrence = bucket[occurrenceIndex];
        if (!occurrence) continue;
        queue.push(occurrence);
        found = true;
      }
      if (!found) break;
    }
    return queue;
  });
  const selected: SeedOccurrence[] = [];
  for (let occurrenceIndex = 0; selected.length < limit; occurrenceIndex++) {
    let found = false;
    for (const queue of queues) {
      const occurrence = queue[occurrenceIndex];
      if (!occurrence) continue;
      selected.push(occurrence);
      found = true;
      if (selected.length >= limit) break;
    }
    if (!found) break;
  }
  return selected;
}

function nameQuality(name: string): number {
  const tokens = name.trim().split(/\s+/);
  const contentTokens = words(name).filter((token) => !STOP_WORDS.has(token));
  const genericCount = contentTokens.filter((token) =>
    GENERIC_WORDS.has(token),
  ).length;
  const titleCount = tokens.filter((token) => /^\p{Lu}/u.test(token)).length;
  let quality = tokens.length > 1 ? 0.76 : 0.62;
  if (titleCount >= Math.ceil(tokens.length / 2)) quality += 0.16;
  if (/[A-Z].*[A-Z]|\d|[a-z][A-Z]/.test(name)) quality += 0.08;
  quality -=
    Math.max(0, genericCount / Math.max(1, contentTokens.length) - 0.45) * 0.8;
  return Math.min(1, Math.max(0, quality));
}

function genericEntity(name: string, wholeLabel = true): number {
  const normalized = normalizedName(name);
  if (GENERIC_PHRASES.has(normalized) || GENERIC_CATEGORY_RE.test(name))
    return 1;
  const tokens = words(name).filter((token) => !STOP_WORDS.has(token));
  if (!tokens.length) return 1;
  const ratio =
    tokens.filter((token) => GENERIC_WORDS.has(token)).length / tokens.length;
  return wholeLabel ? (ratio === 1 ? 1 : 0) : Math.min(1, ratio);
}

function chooseName(names: Map<string, number>): string {
  return (
    [...names.entries()].sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount - leftCount ||
        nameQuality(right) - nameQuality(left) ||
        right.length - left.length ||
        compareUnicodeCodePoints(left, right),
    )[0]?.[0] ?? ''
  );
}

function excerpt(answer: string, occurrence: Occurrence): string {
  return answer
    .slice(
      Math.max(0, occurrence.start - 90),
      Math.min(answer.length, occurrence.end + 150),
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_~`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

export function scoreCompetitorEntityRoleFeatures(
  features: Record<string, number>,
): { logit: number; score: number } {
  let logit = roleModel.intercept;
  for (const [feature, value] of Object.entries(features)) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error(`Invalid competitor entity-role feature: ${feature}`);
    const index = roleVocabulary.get(feature);
    if (index !== undefined) {
      const coefficient = roleModel.coefficients[index];
      if (coefficient === undefined || !Number.isFinite(coefficient))
        throw new Error('Competitor entity-role coefficient schema drifted');
      logit += coefficient * value;
    }
  }
  return { logit, score: 1 / (1 + Math.exp(-logit)) };
}

type ScoredSpan = CompetitorSpanPrimitive & {
  roleLogit: number;
  roleScore: number;
  selectionOrigin?: 'mwis-primary' | 'zone-recovery';
};

function orderedSelection(spans: ScoredSpan[]): ScoredSpan[] {
  return [...spans].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      compareUnicodeCodePoints(left.normalizedName, right.normalizedName),
  );
}

function compareSelections(left: ScoredSpan[], right: ScoredSpan[]): number {
  const orderedLeft = orderedSelection(left);
  const orderedRight = orderedSelection(right);
  const length = Math.min(orderedLeft.length, orderedRight.length);
  for (let index = 0; index < length; index++) {
    const leftSpan = orderedLeft[index]!;
    const rightSpan = orderedRight[index]!;
    const comparison =
      leftSpan.start - rightSpan.start ||
      -(leftSpan.end - leftSpan.start) + (rightSpan.end - rightSpan.start) ||
      compareUnicodeCodePoints(
        leftSpan.normalizedName,
        rightSpan.normalizedName,
      );
    if (comparison) return comparison;
  }
  return orderedLeft.length - orderedRight.length;
}

function orderedRecoverySample(
  spans: ScoredSpan[],
  primary: ScoredSpan[],
  limit: number,
): {
  selected: ScoredSpan[];
  blockedByOverlap: number;
  droppedByCap: number;
} {
  const selected: ScoredSpan[] = [];
  let blockedByOverlap = 0;
  let droppedByCap = 0;
  const ordered = [...spans].sort(
    (left, right) =>
      right.roleLogit - left.roleLogit ||
      right.end - right.start - (left.end - left.start) ||
      left.start - right.start ||
      compareUnicodeCodePoints(left.normalizedName, right.normalizedName),
  );
  for (const span of ordered) {
    if (
      [...primary, ...selected].some(
        (retained) => span.start < retained.end && retained.start < span.end,
      )
    ) {
      blockedByOverlap++;
      continue;
    }
    if (selected.length >= limit) {
      droppedByCap++;
      continue;
    }
    selected.push(span);
  }
  return { selected, blockedByOverlap, droppedByCap };
}

function primaryContributionOrder(left: ScoredSpan, right: ScoredSpan): number {
  return (
    right.roleLogit -
      roleModel.segmentPenalty -
      (left.roleLogit - roleModel.segmentPenalty) ||
    right.end - right.start - (left.end - left.start) ||
    left.start - right.start ||
    compareUnicodeCodePoints(left.normalizedName, right.normalizedName)
  );
}

export function decodeCompetitorEntitySpans(
  primitives: CompetitorSpanPrimitive[],
  scores?: Map<string, { logit: number; score: number }>,
  options: {
    applyCutoff?: boolean;
    retainBestPerZone?: boolean;
    audit?: CompetitorDecodeAudit;
  } = {},
): ScoredSpan[] {
  const intervals = primitives
    .map((primitive) => {
      const externalScore = scores?.get(primitive.id);
      if (scores && !externalScore)
        throw new Error(
          `Missing competitor entity-role score: ${primitive.id}`,
        );
      const scored =
        externalScore ?? scoreCompetitorEntityRoleFeatures(primitive.features);
      if (!Number.isFinite(scored.logit) || !Number.isFinite(scored.score))
        throw new Error(
          `Invalid competitor entity-role score: ${primitive.id}`,
        );
      return {
        ...primitive,
        roleLogit: scored.logit,
        roleScore: scored.score,
      };
    })
    .sort(
      (left, right) =>
        left.end - right.end ||
        left.start - right.start ||
        right.end - right.start - (left.end - left.start) ||
        compareUnicodeCodePoints(left.normalizedName, right.normalizedName),
    );
  const previous: number[] = [];
  for (let index = 0; index < intervals.length; index++) {
    let low = 0;
    let high = index - 1;
    let found = -1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (intervals[middle]!.end <= intervals[index]!.start) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    previous.push(found);
  }
  const states: { weight: number; spans: ScoredSpan[] }[] = [
    { weight: 0, spans: [] },
  ];
  for (let index = 0; index < intervals.length; index++) {
    const interval = intervals[index]!;
    const predecessor = states[(previous[index] ?? -1) + 1]!;
    const intervalWeight = interval.roleLogit - roleModel.segmentPenalty;
    const include = {
      weight: predecessor.weight + intervalWeight,
      spans: [...predecessor.spans, interval],
    };
    const exclude = states[index]!;
    if (include.weight > exclude.weight + 1e-12) states.push(include);
    else if (exclude.weight > include.weight + 1e-12) states.push(exclude);
    else {
      states.push(
        compareSelections(include.spans, exclude.spans) < 0 ? include : exclude,
      );
    }
  }
  const applyCutoff = options.applyCutoff ?? true;
  const mwisPrimary = states.at(-1)!.spans;
  const eligiblePrimary = mwisPrimary.filter(
    (span) => !applyCutoff || span.roleScore >= roleModel.decisionThreshold,
  );
  const primary = eligiblePrimary
    .sort(primaryContributionOrder)
    .slice(0, MAX_DISCOVERY_SELECTED_PER_ANSWER)
    .map((span) => ({ ...span, selectionOrigin: 'mwis-primary' as const }));
  const decoded: ScoredSpan[] = [...primary];
  const allZones = new Set(
    intervals.map(
      (span) => `${span.answerId}:${span.zoneStart}:${span.zoneEnd}`,
    ),
  );
  let recoveryZoneCandidates = 0;
  let recoveryDroppedByCutoff = 0;
  let recoveryBlockedByOverlap = 0;
  let recoveryDroppedByCap = 0;
  if (options.retainBestPerZone) {
    const selectedZones = new Set(
      decoded.map(
        (span) => `${span.answerId}:${span.zoneStart}:${span.zoneEnd}`,
      ),
    );
    const byZone = new Map<string, ScoredSpan[]>();
    for (const interval of intervals) {
      const key = `${interval.answerId}:${interval.zoneStart}:${interval.zoneEnd}`;
      if (selectedZones.has(key)) continue;
      const candidates = byZone.get(key) ?? [];
      candidates.push(interval);
      byZone.set(key, candidates);
    }
    const fallback: ScoredSpan[] = [];
    for (const candidates of byZone.values()) {
      const best = candidates.sort(
        (left, right) =>
          right.roleLogit - left.roleLogit ||
          right.end - right.start - (left.end - left.start) ||
          left.start - right.start ||
          compareUnicodeCodePoints(left.normalizedName, right.normalizedName),
      )[0];
      if (best) fallback.push({ ...best, selectionOrigin: 'zone-recovery' });
    }
    recoveryZoneCandidates = fallback.length;
    const eligibleRecovery = fallback.filter(
      (span) => !applyCutoff || span.roleScore >= roleModel.decisionThreshold,
    );
    recoveryDroppedByCutoff = fallback.length - eligibleRecovery.length;
    const recovery = orderedRecoverySample(
      eligibleRecovery,
      primary,
      Math.max(0, MAX_DISCOVERY_SELECTED_PER_ANSWER - primary.length),
    );
    recoveryBlockedByOverlap = recovery.blockedByOverlap;
    recoveryDroppedByCap = recovery.droppedByCap;
    decoded.push(...recovery.selected);
  }
  const selected = decoded
    .sort(
      (left, right) =>
        left.start - right.start ||
        right.end - right.start - (left.end - left.start) ||
        compareUnicodeCodePoints(left.normalizedName, right.normalizedName),
    )
    .slice(0, MAX_DISCOVERY_SELECTED_PER_ANSWER);
  if (options.audit) {
    const selectedPrimary = selected.filter(
      (span) => span.selectionOrigin === 'mwis-primary',
    ).length;
    const selectedRecovery = selected.length - selectedPrimary;
    Object.assign(options.audit, {
      scoredSpans: intervals.length,
      zones: allZones.size,
      mwisPrimaryBeforeCutoff: mwisPrimary.length,
      primaryDroppedByCutoff: mwisPrimary.length - eligiblePrimary.length,
      primaryDroppedByCap: Math.max(
        0,
        eligiblePrimary.length - MAX_DISCOVERY_SELECTED_PER_ANSWER,
      ),
      selectedPrimary,
      zonesWithoutPrimary:
        allZones.size -
        new Set(
          primary.map(
            (span) => `${span.answerId}:${span.zoneStart}:${span.zoneEnd}`,
          ),
        ).size,
      recoveryZoneCandidates,
      recoveryDroppedByCutoff,
      recoveryBlockedByOverlap,
      recoveryDroppedByCap,
      selectedRecovery,
    });
  }
  return selected;
}

export type DiscoveryOptions = {
  maxCandidates?: number;
  maxEvidencePerCandidate?: number;
  referenceAnswers?: DiscoveryAnswer[];
  audit?: CompetitorDiscoveryAudit;
  workAudit?: CompetitorDiscoveryWorkAudit;
};

type OccurrenceSignals = {
  contextSimilarity: number;
  seedProximity: number;
  structureSimilarity: number;
  listTableRole: number;
  comparisonLanguage: number;
  entityRole: number;
  entityRoleLogit: number;
};

function signalUtility(signal: OccurrenceSignals): number {
  return (
    signal.entityRole * 3 +
    signal.contextSimilarity +
    signal.seedProximity * 0.35 +
    signal.structureSimilarity * 0.25 +
    signal.comparisonLanguage * 0.25
  );
}

function learnedOccurrenceSignals(
  answer: DiscoveryAnswer,
  contextText: string,
  occurrence: Occurrence,
  seedContexts: SeedOccurrence[],
  maskedTokens: Set<string>,
  candidateName: string,
  roleLogit: number,
  roleScore: number,
  contextVectorCache: Map<string, TokenVector>,
  seedVectorCache: Map<string, TokenVector>,
  currentRepresentation: boolean,
): OccurrenceSignals {
  const occurrenceContextText = currentRepresentation
    ? positionallyMaskRange(contextText, occurrence.start, occurrence.end)
    : contextText;
  const context = contextualClauseAt(
    answer,
    occurrenceContextText,
    occurrence.start,
    occurrence.end,
    currentRepresentation,
  );
  // All spans selected from the same clause and entity reuse one sparse vector;
  // every seed context is vectorized once per answer as well. Cosine remains an
  // always-computed signal without rebuilding token-frequency maps per pair.
  const contextKey = `${normalizedName(candidateName)}\u0000${context}`;
  const candidateVector =
    contextVectorCache.get(contextKey) ??
    tokenVector(
      contextTokens(
        context,
        currentRepresentation
          ? new Set()
          : new Set([...maskedTokens, ...words(candidateName)]),
      ),
    );
  contextVectorCache.set(contextKey, candidateVector);
  const comparisonLanguage = COMPARISON_RE.test(context) ? 1 : 0;
  let best: OccurrenceSignals = {
    contextSimilarity: 0,
    seedProximity: 0,
    structureSimilarity: 0,
    listTableRole:
      occurrence.structure === 'list' || occurrence.structure === 'table'
        ? 1
        : 0,
    comparisonLanguage,
    entityRole: roleScore,
    entityRoleLogit: roleLogit,
  };
  let bestUtility = -1;
  for (const seed of seedContexts) {
    const sameAnswer = seed.answerId === answer.id;
    const seedContext =
      currentRepresentation && sameAnswer
        ? contextualClauseAt(
            seed.answer,
            positionallyMaskRange(
              seed.contextText,
              occurrence.start,
              occurrence.end,
            ),
            seed.start,
            seed.end,
          )
        : seed.context;
    const cacheKey = `${seed.answerId}:${seed.start}:${seed.end}:${
      currentRepresentation && sameAnswer
        ? `${occurrence.start}:${occurrence.end}`
        : ''
    }`;
    const seedVector =
      seedVectorCache.get(cacheKey) ??
      tokenVector(
        contextTokens(
          seedContext,
          currentRepresentation ? new Set() : maskedTokens,
        ),
      );
    seedVectorCache.set(cacheKey, seedVector);
    const contextSimilarity = cosineVectors(candidateVector, seedVector);
    const seedProximity =
      sameAnswer && seed.local
        ? Math.exp(-Math.abs(occurrence.start - seed.start) / 500)
        : 0;
    const structureSimilarity = occurrence.structure === seed.structure ? 1 : 0;
    const utility =
      roleScore * 3 +
      contextSimilarity +
      seedProximity * 0.35 +
      structureSimilarity * 0.25 +
      comparisonLanguage * 0.25;
    if (utility > bestUtility) {
      bestUtility = utility;
      best = {
        contextSimilarity,
        seedProximity,
        structureSimilarity,
        listTableRole:
          occurrence.structure === 'list' || occurrence.structure === 'table'
            ? 1
            : 0,
        comparisonLanguage,
        entityRole: roleScore,
        entityRoleLogit: roleLogit,
      };
    }
  }
  return best;
}

function equivalentEntityLabel(left: string, right: string): boolean {
  const legalSuffixes = new Set([
    'corp',
    'corporation',
    'inc',
    'incorporated',
    'ltda',
    'llc',
    'limited',
    'sa',
  ]);
  const normalize = (value: string) => {
    const tokens = words(value);
    while (tokens.length > 1 && legalSuffixes.has(tokens.at(-1)!)) tokens.pop();
    return tokens.join(' ');
  };
  return normalize(left) === normalize(right);
}

function sourceTitleIdentifies(name: string, title: string): boolean {
  const titleHead = title.split(/\s(?:[-—–|:·])\s/u)[0] ?? title;
  return equivalentEntityLabel(name, titleHead);
}

function evidenceDomain(
  name: string,
  spans: ScoredSpan[],
  answer: DiscoveryAnswer,
): { domain: string | null; conflict: boolean } {
  const plausible = new Set<string>();
  for (const span of spans) {
    if (
      span.linkedDomain &&
      span.linkedUrl &&
      equivalentEntityLabel(name, span.name)
    )
      plausible.add(span.linkedDomain);
  }
  for (const source of answer.sources) {
    const domain = safeDomain(source.url);
    if (!domain || !sourceTitleIdentifies(name, source.title)) continue;
    plausible.add(domain);
  }
  return {
    domain: plausible.size === 1 ? [...plausible][0]! : null,
    conflict: plausible.size > 1,
  };
}

function extractCompetitorFeatureRowsR6(
  answers: DiscoveryAnswer[],
  seeds: DiscoverySeed[],
  options: DiscoveryOptions = {},
  entityScores?: Map<string, { logit: number; score: number }>,
  representation: 'current' | 'ci-baseline' = 'current',
): CompetitorFeatureRow[] {
  const currentRepresentation = representation === 'current';
  const usableSeeds = seeds.filter((seed) => seed.name.trim());
  const maskedTokens = new Set(
    usableSeeds.flatMap((seed) =>
      [seed.name, ...(seed.aliases ?? [])].flatMap(words),
    ),
  );
  const boundedAnswers = answers
    .slice(0, MAX_DISCOVERY_ANSWERS)
    .filter((answer) => answer.answer.trim())
    .map((answer) => ({
      ...answer,
      answer: answer.answer.slice(0, MAX_ANSWER_CHARACTERS),
    }));
  if (options.audit) {
    options.audit.inputAnswers = answers.length;
    options.audit.processedAnswers = 0;
    options.audit.answersDroppedByCap = Math.max(
      0,
      answers.length - MAX_DISCOVERY_ANSWERS,
    );
    options.audit.answersSkippedEmpty =
      Math.min(answers.length, MAX_DISCOVERY_ANSWERS) - boundedAnswers.length;
    options.audit.answersSkippedNoSeedContext = 0;
    Object.assign(options.audit.decoder, {
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
    });
  }
  if (!usableSeeds.length || !boundedAnswers.length) {
    if (options.audit)
      options.audit.answersSkippedNoSeedContext = boundedAnswers.length;
    return [];
  }
  const boundedReferences = (options.referenceAnswers ?? [])
    .slice(0, MAX_DISCOVERY_ANSWERS)
    .map((answer) => ({
      ...answer,
      answer: answer.answer.slice(0, MAX_ANSWER_CHARACTERS),
    }));
  const unmaskedCurrentSeedContexts = collectSeedContexts(
    boundedAnswers,
    usableSeeds,
    MAX_REFERENCE_SEED_CONTEXTS * 2,
    false,
    undefined,
    false,
    options.workAudit,
  );
  const unmaskedReferenceSeedContexts = collectSeedContexts(
    boundedReferences,
    usableSeeds,
    MAX_REFERENCE_SEED_CONTEXTS,
    false,
    undefined,
    false,
    options.workAudit,
  );
  if (
    !unmaskedCurrentSeedContexts.length &&
    !unmaskedReferenceSeedContexts.length
  ) {
    if (options.audit)
      options.audit.answersSkippedNoSeedContext = boundedAnswers.length;
    return [];
  }
  const bundleCasingByToken = competitorBundleCasing(boundedAnswers);
  const contextTextByAnswer = new WeakMap<DiscoveryAnswer, string>();
  const decodedAnswers = boundedAnswers.map((boundedAnswer, answerIndex) => {
    const primitives = enumerateCompetitorSpans(
      boundedAnswer,
      usableSeeds,
      answerIndex,
      { bundleCasingByToken },
    ).spans;
    const answerAudit = options.audit
      ? ({} as CompetitorDecodeAudit)
      : undefined;
    const selected = decodeCompetitorEntitySpans(primitives, entityScores, {
      applyCutoff: false,
      retainBestPerZone: true,
      audit: answerAudit,
    });
    if (answerAudit && options.audit)
      for (const key of Object.keys(answerAudit) as Array<
        keyof CompetitorDecodeAudit
      >)
        options.audit.decoder[key] += answerAudit[key];
    contextTextByAnswer.set(
      boundedAnswer,
      currentRepresentation
        ? positionallyMaskedContext(
            boundedAnswer,
            usableSeeds,
            selected,
            options.workAudit,
          )
        : parsedAnswer(boundedAnswer).visibleText,
    );
    return { boundedAnswer, selected };
  });
  const currentSeedContexts = collectSeedContexts(
    boundedAnswers,
    usableSeeds,
    MAX_REFERENCE_SEED_CONTEXTS * 2,
    false,
    contextTextByAnswer,
    currentRepresentation,
    options.workAudit,
  );
  const referenceCasingByToken = competitorBundleCasing(boundedReferences);
  for (const [referenceIndex, reference] of boundedReferences.entries()) {
    const referencePrimitives = enumerateCompetitorSpans(
      reference,
      usableSeeds,
      referenceIndex,
      { bundleCasingByToken: referenceCasingByToken },
    ).spans;
    const referenceSelected = decodeCompetitorEntitySpans(referencePrimitives, undefined, {
      applyCutoff: false,
      retainBestPerZone: true,
    });
    contextTextByAnswer.set(
      reference,
      currentRepresentation
        ? positionallyMaskedContext(
            reference,
            usableSeeds,
            referenceSelected,
            options.workAudit,
          )
        : parsedAnswer(reference).visibleText,
    );
  }
  const referenceSeedContexts = collectSeedContexts(
    boundedReferences,
    usableSeeds,
    MAX_REFERENCE_SEED_CONTEXTS,
    false,
    contextTextByAnswer,
    currentRepresentation,
    options.workAudit,
  );
  if (!currentSeedContexts.length && !referenceSeedContexts.length)
    throw new Error('Masked competitor seed context unexpectedly disappeared');
  if (options.audit) options.audit.processedAnswers = boundedAnswers.length;

  const aggregate = new Map<
    string,
    {
      names: Map<string, number>;
      evidencePool: { answer: DiscoveryAnswer; occurrence: Occurrence }[];
      answerCount: number;
      domains: Map<string, number>;
      domainConflict: boolean;
      spans: CompetitorFeatureRow['spans'];
      bestSignals: OccurrenceSignals;
      bestUtility: number;
      occurrenceCount: number;
      referenceCount: number;
      publisherCount: number;
      headingOnly: boolean;
      linkLabelOnly: boolean;
      linkDomains: Set<string>;
    }
  >();

  for (const { boundedAnswer, selected } of decodedAnswers) {
    const contextText = contextTextByAnswer.get(boundedAnswer);
    if (contextText === undefined)
      throw new Error('Competitor context mask was not prepared');
    const contextVectorCache = new Map<string, TokenVector>();
    const seedVectorCache = new Map<string, TokenVector>();
    const localSeedContexts = collectSeedContexts(
      [boundedAnswer],
      usableSeeds,
      MAX_SEED_CONTEXTS_PER_ANSWER,
      true,
      contextTextByAnswer,
      currentRepresentation,
      options.workAudit,
    );
    const seedContexts = [
      ...localSeedContexts,
      ...currentSeedContexts.filter(
        (occurrence) => occurrence.answerId !== boundedAnswer.id,
      ),
      ...referenceSeedContexts,
    ];
    const byName = new Map<string, ScoredSpan[]>();
    for (const span of selected) {
      const identity = competitorIdentity(span.name);
      const list = byName.get(identity) ?? [];
      list.push(span);
      byName.set(identity, list);
    }
    for (const [key, candidateSpans] of byName) {
      const name =
        [...candidateSpans].sort(
          (left, right) =>
            right.roleScore - left.roleScore ||
            right.name.length - left.name.length ||
            compareUnicodeCodePoints(left.name, right.name),
        )[0]?.name ?? key;
      const domainEvidence = evidenceDomain(
        name,
        candidateSpans,
        boundedAnswer,
      );
      const item = aggregate.get(key) ?? {
        names: new Map<string, number>(),
        evidencePool: [],
        answerCount: 0,
        domains: new Map<string, number>(),
        domainConflict: false,
        spans: [],
        bestSignals: {
          contextSimilarity: 0,
          seedProximity: 0,
          structureSimilarity: 0,
          listTableRole: 0,
          comparisonLanguage: 0,
          entityRole: 0,
          entityRoleLogit: Number.NEGATIVE_INFINITY,
        },
        bestUtility: -1,
        occurrenceCount: 0,
        referenceCount: 0,
        publisherCount: 0,
        headingOnly: true,
        linkLabelOnly: true,
        linkDomains: new Set<string>(),
      };
      for (const span of candidateSpans) {
        if (
          span.selectionOrigin !== 'mwis-primary' &&
          span.selectionOrigin !== 'zone-recovery'
        )
          throw new Error('Decoded competitor span is missing its origin');
        item.names.set(span.name, (item.names.get(span.name) ?? 0) + 1);
        item.spans.push({
          primitiveId: span.id,
          runId: boundedAnswer.id,
          start: span.start,
          end: span.end,
          surface: span.name,
          selectionOrigin: span.selectionOrigin,
          roleLogit: span.roleLogit,
          roleScore: span.roleScore,
        });
        const occurrence: Occurrence = {
          start: span.start,
          end: span.end,
          surface: span.name,
          structure: span.structure,
          linkedDomain: span.linkedDomain,
          citationLike: span.citationLike,
          inReferenceSection: span.inReferenceSection,
          extractionPriority: span.extractionPriority,
        };
        const signals = learnedOccurrenceSignals(
          boundedAnswer,
          contextText,
          occurrence,
          seedContexts,
          maskedTokens,
          name,
          span.roleLogit,
          span.roleScore,
          contextVectorCache,
          seedVectorCache,
          currentRepresentation,
        );
        const utility = signalUtility(signals);
        if (utility > item.bestUtility) {
          item.bestUtility = utility;
          item.bestSignals = signals;
        }
        item.occurrenceCount++;
        if (span.inReferenceSection || span.citationLike) item.referenceCount++;
        if (span.inReferenceSection || span.citationLike) item.publisherCount++;
        if (span.structure !== 'heading') item.headingOnly = false;
        if (span.structure !== 'link') item.linkLabelOnly = false;
        if (span.linkedDomain) item.linkDomains.add(span.linkedDomain);
        item.evidencePool.push({ answer: boundedAnswer, occurrence });
      }
      item.answerCount++;
      item.evidencePool.sort(
        (left, right) =>
          Date.parse(right.answer.createdAt) -
            Date.parse(left.answer.createdAt) ||
          compareUnicodeCodePoints(left.answer.id, right.answer.id) ||
          left.occurrence.start - right.occurrence.start,
      );
      if (item.evidencePool.length > 10) item.evidencePool.length = 10;
      if (domainEvidence.conflict) item.domainConflict = true;
      if (domainEvidence.domain)
        item.domains.set(
          domainEvidence.domain,
          (item.domains.get(domainEvidence.domain) ?? 0) + 1,
        );
      aggregate.set(key, item);
    }
  }

  const maxEvidence = Math.min(
    10,
    Math.max(1, Math.trunc(options.maxEvidencePerCandidate ?? 3)),
  );
  return [...aggregate.values()]
    .map((item): CompetitorFeatureRow => {
      const name = chooseName(item.names).normalize('NFC');
      const domainEvidence =
        item.domainConflict || item.domains.size > 1
          ? 'conflict'
          : item.domains.size === 1
            ? 'unique'
            : 'none';
      const domain =
        domainEvidence === 'unique'
          ? (item.domains.keys().next().value ?? null)
          : null;
      return {
        name,
        domain,
        domainEvidence,
        features: {
          context_similarity: item.bestSignals.contextSimilarity,
          primary_context_similarity:
            competitorMwisPrimaryFraction(item.spans) *
            item.bestSignals.contextSimilarity,
          seed_proximity: item.bestSignals.seedProximity,
          structure_similarity: item.bestSignals.structureSimilarity,
          list_table_role: item.bestSignals.listTableRole,
          comparison_language: item.bestSignals.comparisonLanguage,
          repeated_mention: Math.min(
            Math.max(item.occurrenceCount - 1, 0) / 2,
            1,
          ),
          name_quality: nameQuality(name),
          direct_domain: domain ? 1 : 0,
          source_only: item.referenceCount === item.occurrenceCount ? 1 : 0,
          heading_only: item.headingOnly ? 1 : 0,
          generic_entity: genericEntity(name, currentRepresentation),
          publisher_citation: item.publisherCount / item.occurrenceCount,
          answer_support: Math.min(Math.max(item.answerCount - 1, 0) / 3, 1),
          distinct_link_domains_per_surface: item.linkDomains.size > 1 ? 1 : 0,
          link_label_only: item.linkLabelOnly ? 1 : 0,
          mwis_primary_fraction: competitorMwisPrimaryFraction(item.spans),
          entity_role: transformCompetitorEntityRoleLogit(
            item.bestSignals.entityRoleLogit,
          ),
        },
        answerCount: item.answerCount,
        occurrenceCount: item.occurrenceCount,
        spans: item.spans,
        evidence: item.evidencePool
          .slice(0, maxEvidence)
          .map(({ answer, occurrence }) => ({
            runId: answer.id,
            excerpt: excerpt(answer.answer, occurrence),
            createdAt: answer.createdAt,
          })),
      };
    })
    .sort((left, right) => compareUnicodeCodePoints(left.name, right.name));
}

export function extractCompetitorFeatureRows(
  answers: DiscoveryAnswer[],
  seeds: DiscoverySeed[],
  options: DiscoveryOptions = {},
): CompetitorFeatureRow[] {
  return extractCompetitorFeatureRowsR6(answers, seeds, options);
}

export function extractCompetitorFeatureRowsWithEntityScores(
  answers: DiscoveryAnswer[],
  seeds: DiscoverySeed[],
  scores: Map<string, { logit: number; score: number }>,
  options: DiscoveryOptions = {},
): CompetitorFeatureRow[] {
  return extractCompetitorFeatureRowsR6(answers, seeds, options, scores);
}

export function extractCompetitorFeatureRowsRepresentationAblation(
  answers: DiscoveryAnswer[],
  seeds: DiscoverySeed[],
  scores: Map<string, { logit: number; score: number }>,
  options: DiscoveryOptions = {},
): CompetitorFeatureRow[] {
  return extractCompetitorFeatureRowsR6(
    answers,
    seeds,
    options,
    scores,
    'ci-baseline',
  );
}
