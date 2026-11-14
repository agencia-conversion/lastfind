import {
  defaultSemanticConfiguration,
  type SemanticConfiguration,
} from './semantic-configuration.ts';
import {
  semanticAssociationReport,
  semanticAssessmentFixture,
  semanticAssociationRows,
  type SemanticAssociationReport,
} from './semantic-association-data.ts';
import {
  demoBrands,
  filterLabel,
  demoModels,
  demoSources,
  type DemoFilters,
  type DemoPrompt,
  type DemoResponse,
} from './demo-data.ts';

export type LocalizedText = { en: string; pt: string };
export type SemanticAttribute = {
  id: string;
  label: LocalizedText;
  kind: 'topic' | 'capability' | 'audience' | 'proof';
  promptIds: string[];
};
export const semanticAttributes: SemanticAttribute[] = [
  {
    id: 'technical',
    label: { en: 'Technical SEO', pt: 'SEO técnico' },
    kind: 'capability',
    promptIds: ['p1', 'p2', 'p7'],
  },
  {
    id: 'ai',
    label: { en: 'AI search expertise', pt: 'Especialista em busca com IA' },
    kind: 'capability',
    promptIds: ['p3', 'p4', 'p8'],
  },
  {
    id: 'enterprise',
    label: { en: 'Enterprise growth', pt: 'Crescimento enterprise' },
    kind: 'audience',
    promptIds: ['p2', 'p7'],
  },
  {
    id: 'research',
    label: { en: 'Original research', pt: 'Pesquisa original' },
    kind: 'proof',
    promptIds: ['p8', 'p10'],
  },
  {
    id: 'content',
    label: { en: 'Content strategy', pt: 'Estratégia de conteúdo' },
    kind: 'topic',
    promptIds: ['p5', 'p9'],
  },
  {
    id: 'measurement',
    label: { en: 'Measurable outcomes', pt: 'Resultados mensuráveis' },
    kind: 'proof',
    promptIds: ['p5', 'p8', 'p10'],
  },
];

export type BrandEntity = {
  id: string;
  name: string;
  domain: string;
  members: { id: string; name: string; domain: string; aliases: string[] }[];
};

export function initialBrandEntities(
  name = 'Conversion',
  domain = 'conversion.com.br',
  competitors?: { name: string; domain: string }[],
): BrandEntity[] {
  const brands =
    competitors === undefined
      ? demoBrands
      : [
          { id: 'conversion', name, domain },
          ...competitors.map((brand, index) => ({
            ...brand,
            id: `configured-${index + 1}`,
          })),
        ];
  return brands.map((brand) => {
    const identity =
      brand.id === 'conversion' ? { ...brand, name, domain } : brand;
    return {
      id: brand.id,
      name: identity.name,
      domain: identity.domain,
      members: [
        {
          id: brand.id,
          name: identity.name,
          domain: identity.domain,
          aliases:
            brand.id === 'conversion'
              ? [name, domain]
              : brand.id === 'np'
                ? ['NP Digital', 'Neil Patel Digital']
                : [brand.name, brand.domain],
        },
      ],
    };
  });
}

/** Local entity edits preserve every raw identity so a split is lossless. */
export function mergeBrandEntities(
  entities: BrandEntity[],
  targetId: string,
  sourceId: string,
): BrandEntity[] {
  const target = entities.find((entity) => entity.id === targetId);
  const source = entities.find((entity) => entity.id === sourceId);
  if (!target || !source || targetId === sourceId) return entities;
  return entities
    .filter((entity) => entity.id !== sourceId)
    .map((entity) =>
      entity.id !== targetId
        ? entity
        : {
            ...entity,
            members: [
              ...target.members,
              ...source.members.filter(
                (member) =>
                  !target.members.some((existing) => existing.id === member.id),
              ),
            ],
          },
    );
}

export function splitBrandEntity(
  entities: BrandEntity[],
  entityId: string,
): BrandEntity[] {
  const entity = entities.find((item) => item.id === entityId);
  if (!entity || entity.members.length < 2) return entities;
  return entities.flatMap((item) =>
    item.id !== entityId
      ? [item]
      : item.members.map((member) => ({
          id: member.id,
          name: member.name,
          domain: member.domain,
          members: [{ ...member, aliases: [...member.aliases] }],
        })),
  );
}

export function canonicalBrandIds(
  response: Pick<DemoResponse, 'brandIds'>,
  entities: BrandEntity[],
): string[] {
  return [
    ...new Set(
      response.brandIds.map(
        (id) =>
          entities.find((entity) =>
            entity.members.some((member) => member.id === id),
          )?.id ?? id,
      ),
    ),
  ];
}

const ratio = (part: number, total: number) =>
  total ? (part / total) * 100 : 0;
const hash = (value: string) =>
  [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
export function semanticSentiment(
  response: DemoResponse,
): 'positive' | 'neutral' | 'alert' {
  return response.sentiment >= 85
    ? 'positive'
    : response.sentiment >= 75
      ? 'neutral'
      : 'alert';
}

/** Annotations are deterministic illustrative labels, not an NLP inference service. */
export function attributeEvidence(
  responses: DemoResponse[],
  attribute: SemanticAttribute,
  entity: BrandEntity,
) {
  return responses.filter(
    (response) =>
      attribute.promptIds.includes(response.promptId) &&
      entity.members.some(
        (member) =>
          response.brandIds.includes(member.id) &&
          hash(`${response.id}/${attribute.id}/${member.id}`) % 10 <
            (member.id === 'mestre' && attribute.id === 'technical' ? 9 : 7),
      ),
  );
}

export function scoreComponents(input: {
  coverage: number;
  associations: number;
  sentiment: number;
  sourceDiversity: number;
}) {
  const bounded = (value: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const parts = [
    { id: 'coverage', weight: 0.35, value: bounded(input.coverage) },
    { id: 'associations', weight: 0.3, value: bounded(input.associations) },
    { id: 'sentiment', weight: 0.2, value: bounded(input.sentiment) },
    {
      id: 'sourceDiversity',
      weight: 0.15,
      value: bounded(input.sourceDiversity),
    },
  ];
  return {
    parts,
    score: parts.reduce((total, part) => total + part.value * part.weight, 0),
  };
}

export const semanticSourceMetadata: Record<
  string,
  { type: string; format: string; confidence: number }
> = {
  s1: { type: 'Review', format: 'Ranking', confidence: 96 },
  s2: { type: 'Corporate', format: 'Research', confidence: 98 },
  s3: { type: 'Community', format: 'Discussion', confidence: 92 },
  s4: { type: 'Editorial', format: 'Guide', confidence: 95 },
  s5: { type: 'Community', format: 'Comparison', confidence: 78 },
  s6: { type: 'Corporate', format: 'Service page', confidence: 98 },
  s7: { type: 'Reference', format: 'Definition', confidence: 99 },
};

export function semanticSummary(
  responses: DemoResponse[],
  entities: BrandEntity[],
  ownId = 'conversion',
) {
  const own = entities.find((entity) =>
    entity.members.some((member) => member.id === ownId),
  );
  const mentioned = (response: DemoResponse) =>
    !!own && canonicalBrandIds(response, entities).includes(own.id);
  const mentions = responses.filter(mentioned);
  const sourceIds = new Set(mentions.flatMap((response) => response.sourceIds));
  const sourceTypes = new Set(
    [...sourceIds]
      .map((id) => semanticSourceMetadata[id]?.type)
      .filter(Boolean),
  );
  const associations = semanticAttributes.map((attribute) => {
    const eligible = responses.filter((response) =>
      attribute.promptIds.includes(response.promptId),
    );
    const evidence = own ? attributeEvidence(responses, attribute, own) : [];
    const leaders = entities
      .map((entity) => ({
        entity,
        value: ratio(
          attributeEvidence(responses, attribute, entity).length,
          eligible.length,
        ),
      }))
      .sort((a, b) => b.value - a.value);
    const value = ratio(evidence.length, eligible.length);
    return {
      ...attribute,
      evidence,
      eligible: eligible.length,
      value,
      leader: leaders[0],
      gap: Math.max(0, (leaders[0]?.value ?? 0) - value),
      confidence: evidence.length ? 82 + (hash(attribute.id) % 15) : 0,
    };
  });
  const availableAssociations = associations.filter(
    (attribute) => attribute.eligible > 0,
  );
  const coverage = ratio(mentions.length, responses.length);
  const sentiment = mentions.length
    ? mentions.reduce((sum, response) => sum + response.sentiment, 0) /
      mentions.length
    : 0;
  const score = scoreComponents({
    coverage,
    sentiment,
    associations: availableAssociations.length
      ? availableAssociations.reduce(
          (sum, attribute) => sum + attribute.value,
          0,
        ) / availableAssociations.length
      : 0,
    sourceDiversity: ratio(sourceTypes.size, 5),
  });
  const canonicalMentions = responses.reduce(
    (sum, response) => sum + canonicalBrandIds(response, entities).length,
    0,
  );
  const ownDomains = new Set(
    own?.members.map((member) => member.domain.replace(/^www\./, '')) ?? [],
  );
  const linked = responses.filter((response) =>
    response.sourceIds.some((id) =>
      ownDomains.has(
        demoSources.find((source) => source.id === id)?.domain ?? '',
      ),
    ),
  );
  const consulted = responses.filter(
    (response) => response.consultedSourceIds !== null,
  );
  const consultedOwn = consulted.filter((response) =>
    response.consultedSourceIds?.some((id) =>
      ownDomains.has(
        demoSources.find((source) => source.id === id)?.domain ?? '',
      ),
    ),
  );
  const engines = demoModels.map((model) => {
    const rows = responses.filter((response) => response.model === model);
    const branded = rows.filter(mentioned);
    const leaders = entities
      .map((entity) => ({
        name: entity.name,
        domain: entity.domain,
        value: ratio(
          rows.filter((response) =>
            canonicalBrandIds(response, entities).includes(entity.id),
          ).length,
          rows.length,
        ),
      }))
      .sort((a, b) => b.value - a.value);
    return {
      model,
      total: rows.length,
      mentions: branded.length,
      coverage: ratio(branded.length, rows.length),
      leader: leaders[0],
      gap: Math.max(
        0,
        (leaders[0]?.value ?? 0) - ratio(branded.length, rows.length),
      ),
      positive: branded.filter(
        (response) => semanticSentiment(response) === 'positive',
      ).length,
      neutral: branded.filter(
        (response) => semanticSentiment(response) === 'neutral',
      ).length,
      alert: branded.filter(
        (response) => semanticSentiment(response) === 'alert',
      ).length,
      position: branded.length
        ? branded.reduce(
            (sum, response) =>
              sum + canonicalBrandIds(response, entities).indexOf(own!.id) + 1,
            0,
          ) / branded.length
        : 0,
    };
  });
  const sources = demoSources
    .map((source) => {
      const cited = responses.filter((response) =>
        response.sourceIds.includes(source.id),
      );
      const associated = cited.filter(mentioned);
      return {
        ...source,
        ...semanticSourceMetadata[source.id],
        citations: cited.length,
        associated: associated.length,
        association: ratio(associated.length, cited.length),
        consulted: responses.filter((response) =>
          response.consultedSourceIds?.includes(source.id),
        ).length,
        engines: Object.fromEntries(
          demoModels.map((model) => [
            model,
            cited.filter((response) => response.model === model).length,
          ]),
        ),
        evidence: cited,
      };
    })
    .filter((source) => source.citations > 0 || source.consulted > 0)
    .sort((a, b) => b.citations - a.citations);
  return {
    own,
    mentions,
    coverage,
    sentiment,
    canonicalMentions,
    eligibleAttributes: availableAssociations.length,
    shareOfVoice: ratio(mentions.length, canonicalMentions),
    linked: linked.length,
    consulted: consultedOwn.length,
    consultedAvailable: consulted.length,
    score,
    associations,
    engines,
    sources,
    sourceTypes: sourceTypes.size,
  };
}

export function semanticPromptSuggestions(segment: string): LocalizedText[] {
  const topic = segment.trim() || 'SEO';
  return [
    {
      en: `Which ${topic} companies are recommended for enterprise teams?`,
      pt: `Quais empresas de ${topic} são recomendadas para grandes equipes?`,
    },
    {
      en: `What should I compare when choosing a ${topic} partner?`,
      pt: `O que comparar ao escolher um parceiro de ${topic}?`,
    },
    {
      en: `Which ${topic} brands publish reliable original research?`,
      pt: `Quais marcas de ${topic} publicam pesquisas originais confiáveis?`,
    },
  ];
}

export function evidenceExcerpt(
  response: DemoResponse,
  attribute: SemanticAttribute,
  brand: string,
  prompts: DemoPrompt[],
): LocalizedText {
  const topic =
    prompts.find((prompt) => prompt.id === response.promptId)?.topic ?? 'SEO';
  return {
    en: `${brand} is associated with ${attribute.label.en.toLowerCase()} in this illustrative ${topic} answer. Review the underlying sample and its citations before interpreting the association.`,
    pt: `${brand} aparece associado a ${attribute.label.pt.toLowerCase()} nesta resposta ilustrativa sobre ${topic}. Revise a amostra e suas citações antes de interpretar a associação.`,
  };
}

/** A report owns its inputs: later filters, prompt edits and identity merges cannot rewrite history. */
export type SemanticSnapshot = {
  id: string;
  date: string;
  title: string;
  project: { id: string; name: string; domain: string };
  from: string;
  to: string;
  filters: DemoFilters;
  entities: BrandEntity[];
  questions: {
    id: string;
    text: string;
    country: string;
    topic: string;
    tags: string[];
    brandRequested: boolean;
    responses: number;
    missingModels: string[];
  }[];
  evidence: DemoResponse[];
  summary: ReturnType<typeof semanticSummary>;
  score: number;
  responses: number;
  models: string[];
  pending: number;
  missingPairs: number;
  association: SemanticAssociationReport;
  semanticLanguage?: 'en-US' | 'pt-BR';
};
export type SemanticSessionState = {
  entities: BrandEntity[];
  snapshots: SemanticSnapshot[];
  completed: string[];
};

export function parseSemanticQuestions(
  input: string,
  existing: Pick<DemoPrompt, 'text'>[],
) {
  const normalize = (value: string) =>
    value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  const known = new Set(existing.map((prompt) => normalize(prompt.text)));
  const seen = new Set<string>();
  const questions = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = normalize(line);
      if (known.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    questions,
    error:
      questions.length > 20
        ? 'limit'
        : questions.some((line) => line.length < 5 || line.length > 1000)
          ? 'length'
          : null,
  };
}

export function createSemanticSnapshot(input: {
  id: string;
  date: string;
  title: string;
  project: { id: string; name: string; domain: string };
  from: string;
  to: string;
  filters: DemoFilters;
  entities: BrandEntity[];
  prompts: (Pick<DemoPrompt, 'id' | 'text'> &
    Partial<Pick<DemoPrompt, 'country' | 'topic' | 'tags'>>)[];
  customQuestions?: string[];
  responses: DemoResponse[];
  semanticConfiguration?: SemanticConfiguration;
  semanticLanguage?: 'en-US' | 'pt-BR';
}): SemanticSnapshot {
  const prompts: typeof input.prompts = [
    ...input.prompts,
    ...(input.customQuestions ?? []).map((text, index) => ({
      id: `pending-${index}`,
      text,
    })),
  ];
  const evidence = input.responses.filter(
    (response) =>
      input.prompts.some((prompt) => prompt.id === response.promptId) &&
      input.filters.models.includes(response.model) &&
      response.date.slice(0, 10) >= input.from &&
      response.date.slice(0, 10) <= input.to,
  );
  const questions = prompts.map((prompt) => ({
    ...prompt,
    country: prompt.country ?? filterLabel(input.filters.country),
    topic: prompt.topic ?? filterLabel(input.filters.topic),
    tags: prompt.tags ?? [],
    brandRequested:
      (prompt.tags ?? []).includes('Branded') ||
      prompt.text
        .toLocaleLowerCase('en')
        .includes(input.project.name.toLocaleLowerCase('en')),
    responses: evidence.filter((response) => response.promptId === prompt.id)
      .length,
    missingModels: input.filters.models.filter(
      (model) =>
        !evidence.some(
          (response) =>
            response.promptId === prompt.id && response.model === model,
        ),
    ),
  }));
  const summary = semanticSummary(evidence, input.entities);
  const configuration =
    input.semanticConfiguration ??
    (input.project.id === 'conversion-web'
      ? defaultSemanticConfiguration()
      : { enabled: false, attributes: [] });
  const association = semanticAssociationReport(
    configuration,
    input.entities,
    semanticAssessmentFixture(
      input.project.id,
      configuration,
      evidence,
      input.project,
    ),
  );
  return structuredClone({
    association,
    ...input,
    questions,
    evidence,
    summary,
    score: summary.score.score,
    responses: evidence.length,
    models: input.filters.models,
    pending: questions.filter((question) => question.responses === 0).length,
    missingPairs: questions.reduce(
      (sum, question) => sum + question.missingModels.length,
      0,
    ),
  });
}

/** A rectangular CSV includes the full audit trail; empty metrics remain unavailable. */
export function semanticSnapshotRows(
  snapshot: SemanticSnapshot,
): (string | number)[][] {
  const { summary, evidence, filters } = snapshot;
  const rows: (string | number)[][] = [
    ['Section', 'Item', 'Metric', 'Value', 'Denominator', 'Detail'],
  ];
  const add = (
    section: string,
    item: string,
    metric: string,
    value: string | number,
    denominator: string | number = '',
    detail = '',
  ) => rows.push([section, item, metric, value, denominator, detail]);
  add(
    'Report',
    snapshot.title,
    'Dataset',
    'Synthetic sample',
    '',
    'Synthetic data; no collection submitted. Changes persist only in this browser session.',
  );
  add('Report', snapshot.project.name, 'Domain', snapshot.project.domain);
  add('Report', snapshot.id, 'Created', snapshot.date);
  add(
    'Report',
    snapshot.id,
    'Research language',
    snapshot.semanticLanguage ?? 'unspecified',
  );
  add('Filters', 'Period', 'From / to', `${snapshot.from} / ${snapshot.to}`);
  for (const key of ['models', 'country', 'topic', 'tag'] as const)
    add(
      'Filters',
      key,
      'Selection',
      Array.isArray(filters[key]) ? filters[key].join(' | ') : filters[key],
    );
  add('Filters', 'tagMode', 'Selection', filters.tagMode ?? 'any');
  add(
    'Summary',
    'Lastfind score',
    'Points / 100',
    evidence.length ? summary.score.score : '',
    100,
  );
  add(
    'Summary',
    'Visibility',
    'Percent',
    evidence.length ? summary.coverage : '',
    evidence.length,
    `${summary.mentions.length} responses mention the canonical brand`,
  );
  add(
    'Summary',
    'Share of voice',
    'Percent',
    summary.canonicalMentions ? summary.shareOfVoice : '',
    summary.canonicalMentions,
    `${summary.mentions.length} canonical brand mentions`,
  );
  add(
    'Summary',
    'Own domain cited',
    'Responses',
    summary.linked,
    evidence.length,
  );
  add(
    'Summary',
    'Own domain consulted',
    'Responses',
    summary.consultedAvailable ? summary.consulted : '',
    summary.consultedAvailable,
    'Unavailable evidence is not inferred from citations.',
  );
  add(
    'Coverage',
    'Questions with no responses',
    'Questions',
    snapshot.pending,
    snapshot.questions.length,
  );
  add(
    'Coverage',
    'Question / engine pairs with no responses',
    'Pairs',
    snapshot.missingPairs,
    snapshot.questions.length * snapshot.models.length,
  );
  for (const part of summary.score.parts)
    add(
      'Method',
      part.id,
      'Weighted contribution',
      evidence.length ? part.value * part.weight : '',
      part.weight,
      `${part.value} input points; weights 35% coverage, 30% association, 20% sentiment, 15% source diversity`,
    );
  add(
    'Method',
    'Associations',
    'Eligible attributes',
    summary.eligibleAttributes,
    6,
    'Unweighted mean of eligible attribute rates; illustrative annotations preserved per original identity.',
  );
  add(
    'Method',
    'Source diversity',
    'Source types with brand co-occurrence',
    summary.sourceTypes,
    5,
    'Distinct types among citations in answers mentioning the brand; not independent verification.',
  );
  for (const attribute of summary.associations) {
    add(
      'Associations',
      attribute.label.en,
      'Percent',
      attribute.eligible ? attribute.value : '',
      attribute.eligible,
      `${attribute.evidence.length} annotated responses; illustrative confidence ${attribute.confidence}%; leader ${attribute.leader?.entity.name ?? ''}; gap ${attribute.gap} pp`,
    );
    for (const response of attribute.evidence)
      add(
        'Attribute evidence',
        attribute.id,
        'Response ID',
        response.id,
        '',
        response.model,
      );
  }
  for (const engine of summary.engines)
    add(
      'Engines',
      engine.model,
      'Coverage percent',
      engine.total ? engine.coverage : '',
      engine.total,
      `${engine.mentions} mentions; position ${engine.mentions ? engine.position : 'unavailable'}; positive ${engine.positive}, neutral ${engine.neutral}, alert ${engine.alert}; leader ${engine.total ? (engine.leader?.name ?? '') : 'unavailable'}`,
    );
  for (const source of summary.sources) {
    add(
      'Sources',
      source.url,
      'Cited responses',
      source.citations,
      evidence.length,
      `${source.type} / ${source.format}; illustrative confidence ${source.confidence}%`,
    );
    add(
      'Sources',
      source.url,
      'Consulted responses',
      summary.consultedAvailable ? source.consulted : '',
      summary.consultedAvailable,
    );
    for (const model of snapshot.models)
      add(
        'Formats by engine',
        source.format,
        model,
        Number(source.engines[model] ?? 0),
        summary.sources.reduce(
          (sum, item) => sum + Number(item.engines[model] ?? 0),
          0,
        ),
        source.url,
      );
    add(
      'Sources',
      source.url,
      'Brand co-occurrence percent',
      source.citations ? source.association : '',
      source.citations,
      `${source.associated} responses; does not prove the page mentions the brand`,
    );
  }
  for (const entity of snapshot.entities) {
    const competitor = semanticSummary(evidence, snapshot.entities, entity.id);
    add(
      'Competitors',
      entity.name,
      'Visibility percent',
      evidence.length ? competitor.coverage : '',
      evidence.length,
      `${competitor.mentions.length} mentions; share of voice ${competitor.canonicalMentions ? competitor.shareOfVoice : 'unavailable'}%`,
    );
  }
  for (const entity of snapshot.entities)
    for (const member of entity.members)
      add(
        'Identities',
        entity.name,
        'Original identity',
        member.name,
        '',
        `${member.id}; ${member.domain}; aliases ${member.aliases.join(' | ')}`,
      );
  for (const question of snapshot.questions)
    add(
      'Questions',
      question.text,
      'Responses',
      question.responses,
      '',
      `ID ${question.id}; country ${question.country}; topic ${question.topic}; tags ${question.tags.join(' | ')}; explicitly requested brand ${question.brandRequested}; missing engines ${question.missingModels.join(' | ') || 'none'}`,
    );
  for (const response of evidence) {
    add(
      'Responses',
      response.id,
      'Prompt',
      snapshot.questions.find((question) => question.id === response.promptId)
        ?.text ?? response.promptId,
      '',
      `${response.date}; ${response.model}; raw brands ${response.brandIds.join(' | ')}; sentiment ${response.sentiment}`,
    );
    for (const id of response.sourceIds)
      add(
        'Cited evidence',
        response.id,
        'Source URL',
        demoSources.find((source) => source.id === id)?.url ?? id,
      );
    if (response.consultedSourceIds === null)
      add('Consulted evidence', response.id, 'Status', 'unavailable');
    else if (!response.consultedSourceIds.length)
      add(
        'Consulted evidence',
        response.id,
        'Status',
        'available; no consulted sources',
      );
    else
      for (const id of response.consultedSourceIds)
        add(
          'Consulted evidence',
          response.id,
          'Source URL',
          demoSources.find((source) => source.id === id)?.url ?? id,
        );
  }
  if (snapshot.association)
    rows.push(...semanticAssociationRows(snapshot.association));
  return rows;
}

/** Reconcile current project identity without rewriting previously captured reports or merge membership. */
export function reconcileSemanticProject(
  state: SemanticSessionState,
  project: { name: string; domain: string },
): SemanticSessionState {
  const primary = state.entities
    .flatMap((entity) => entity.members)
    .find((member) => member.id === 'conversion');
  if (
    !primary ||
    (primary.name === project.name && primary.domain === project.domain)
  )
    return state;
  return {
    ...state,
    entities: state.entities.map((entity) => {
      if (!entity.members.some((member) => member.id === 'conversion'))
        return entity;
      return {
        ...entity,
        ...(entity.id === 'conversion'
          ? { name: project.name, domain: project.domain }
          : {}),
        members: entity.members.map((member) =>
          member.id !== 'conversion'
            ? member
            : {
                ...member,
                name: project.name,
                domain: project.domain,
                aliases: [
                  ...new Set([
                    ...member.aliases.map((alias) =>
                      alias === member.name
                        ? project.name
                        : alias === member.domain
                          ? project.domain
                          : alias,
                    ),
                    project.name,
                    project.domain,
                  ]),
                ],
              },
        ),
      };
    }),
  };
}
