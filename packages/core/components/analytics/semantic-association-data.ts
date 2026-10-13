import {
  demoBrands,
  demoModels,
  demoSources,
  type DemoResponse,
  type DemoModel,
} from './demo-data.ts';
import type { BrandEntity, LocalizedText } from './semantic-data.ts';
import {
  defaultSemanticConfiguration,
  semanticAttributeFingerprint,
  type SemanticConfiguration,
} from './semantic-configuration.ts';

export type SemanticAssessment = {
  id: string;
  attributeId: string;
  attributeFingerprint: string;
  brandId: string;
  model: DemoModel;
  date: string;
  contextPromptId: string;
  cohortId: string;
  status: 'scored' | 'insufficient' | 'ambiguous';
  score: number | null;
  prompt: LocalizedText;
  explanation: LocalizedText;
  sourceUrls: string[];
};

// Independent, authored illustrative association grades. Never infer these from visibility,
// sentiment, citation counts or the legacy weighted Lastfind index. Not a provider result.
const fixtureGrades: Record<string, number[]> = {
  conversion: [89, 94, 82, 91, 87, 90],
  mestre: [93, 72, 80, 70, 85, 83],
  np: [84, 78, 91, 85, 92, 88],
  cadastra: [81, 76, 93, 74, 87, 89],
  v4: [70, 65, 79, 62, 82, 85],
  wsi: [78, 69, 86, 71, 80, 81],
};
const contextPrompts: Record<string, string[]> = {
  technical: ['p1', 'p2', 'p7'],
  ai: ['p3', 'p4', 'p8'],
  enterprise: ['p2', 'p7'],
  research: ['p8', 'p10'],
  content: ['p5', 'p9'],
  measurement: ['p5', 'p8', 'p10'],
};

const fixtureReasoning: Record<
  string,
  { en: string; pt: string; gapEn: string; gapPt: string }
> = {
  technical: {
    en: 'The evaluation connects the brand to crawling, indexing and technical implementation.',
    pt: 'A avaliação conecta a marca a rastreamento, indexação e implementação técnica.',
    gapEn:
      'The link between diagnosis and a documented implementation could be clearer.',
    gapPt:
      'A conexão entre diagnóstico e implementação documentada pode ficar mais clara.',
  },
  ai: {
    en: 'The evaluation connects the brand to understanding AI answers, testing prompts and investigating cited sources.',
    pt: 'A avaliação conecta a marca à leitura de respostas de IA, ao teste de prompts e à investigação de fontes citadas.',
    gapEn:
      'Evidence of a repeatable method matters more than generic claims about AI.',
    gapPt:
      'Evidências de um método repetível importam mais que afirmações genéricas sobre IA.',
  },
  enterprise: {
    en: 'The evaluation connects the brand to large site structures, complex teams and sustained organic growth.',
    pt: 'A avaliação conecta a marca a grandes estruturas de sites, equipes complexas e crescimento orgânico contínuo.',
    gapEn:
      'The association would be more specific with examples of scale and organizational complexity.',
    gapPt:
      'A associação ganha especificidade com exemplos de escala e complexidade organizacional.',
  },
  research: {
    en: 'The evaluation connects the brand to original studies, transparent methods and first-party data.',
    pt: 'A avaliação conecta a marca a estudos originais, métodos transparentes e dados próprios.',
    gapEn:
      'A study title alone is weaker evidence than an accessible method and dataset.',
    gapPt:
      'O título de um estudo é uma evidência mais fraca que um método e uma base acessíveis.',
  },
  content: {
    en: 'The evaluation connects the brand to useful content, search intent and consistent editorial planning.',
    pt: 'A avaliação conecta a marca a conteúdo útil, intenção de busca e planejamento editorial consistente.',
    gapEn:
      'The connection between editorial choices and the audience’s actual questions could be more explicit.',
    gapPt:
      'A conexão entre escolhas editoriais e perguntas reais do público pode ser mais explícita.',
  },
  measurement: {
    en: 'The evaluation connects the brand to clear indicators, comparable periods and traceable outcomes.',
    pt: 'A avaliação conecta a marca a indicadores claros, períodos comparáveis e resultados rastreáveis.',
    gapEn:
      'The interpretation should separate observed change from claims of causation.',
    gapPt:
      'A interpretação deve separar uma mudança observada de uma afirmação de causalidade.',
  },
};

/** A separate rubric fixture scoped by the same selected prompt/model/date cohort.
 * Context prompt IDs anchor filters; the evaluative prompt is always disclosed separately.
 * New projects and edited attributes have no synthetic assessment history. */
export function semanticAssessmentFixture(
  projectId: string,
  configuration: SemanticConfiguration,
  responses: DemoResponse[],
  identity?: { name: string; domain: string },
): SemanticAssessment[] {
  if (
    projectId !== 'conversion-web' ||
    !configuration.enabled ||
    (identity &&
      (identity.name !== 'Conversion' ||
        identity.domain !== 'conversion.com.br'))
  )
    return [];
  const defaults = [
    defaultSemanticConfiguration('en'),
    defaultSemanticConfiguration('pt'),
  ];
  const rows: SemanticAssessment[] = [];
  const contexts = [
    ...new Map(
      [...responses]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((response) => [
          `${response.promptId}/${response.model}`,
          response,
        ]),
    ).values(),
  ];
  for (const attribute of configuration.attributes) {
    const index = defaults[0].attributes.findIndex(
      (item) => item.id === attribute.id,
    );
    if (
      index < 0 ||
      !defaults.some((config) =>
        config.attributes.some(
          (item) =>
            semanticAttributeFingerprint(item) ===
            semanticAttributeFingerprint(attribute),
        ),
      )
    )
      continue;
    for (const response of contexts) {
      if (!contextPrompts[attribute.id]?.includes(response.promptId)) continue;
      for (const brand of demoBrands) {
        const modelOffset =
          [0, -3, 2, -1, -5][demoModels.indexOf(response.model)] ?? 0;
        const status =
          brand.id === 'wsi' &&
          attribute.id === 'research' &&
          response.model === 'AI Overview'
            ? 'insufficient'
            : brand.id === 'v4' &&
                attribute.id === 'ai' &&
                response.model === 'Claude'
              ? 'ambiguous'
              : 'scored';
        const score = Math.max(
          0,
          Math.min(100, fixtureGrades[brand.id][index] + modelOffset),
        );
        rows.push({
          id: `assessment/${response.id}/${attribute.id}/${brand.id}`,
          attributeId: attribute.id,
          attributeFingerprint: semanticAttributeFingerprint(attribute),
          brandId: brand.id,
          model: response.model,
          date: response.date,
          contextPromptId: response.promptId,
          cohortId: response.id,
          status,
          score: status === 'scored' ? score : null,
          prompt: {
            en: `Evaluate how strongly ${brand.name} (${brand.domain}), in the SEO services category, is associated with “${defaults[0].attributes[index].name}”. Explain the association on a 0–100 scale and identify missing evidence.`,
            pt: `Avalie a força da associação de ${brand.name} (${brand.domain}), na categoria de serviços de SEO, a “${defaults[1].attributes[index].name}”. Explique a associação na escala de 0–100 e identifique evidências ausentes.`,
          },
          explanation: {
            en:
              status === 'insufficient'
                ? 'This sample response does not provide enough evidence to assess this attribute. The missing grade is not a negative judgment.'
                : status === 'ambiguous'
                  ? 'The identity in this sample evaluation could not be disambiguated. A confirmed brand identity is needed before assigning a grade.'
                  : `${fixtureReasoning[attribute.id].en} ${fixtureReasoning[attribute.id].gapEn}`,
            pt:
              status === 'insufficient'
                ? 'Esta resposta de exemplo não oferece base suficiente para avaliar o atributo. A ausência de nota não representa uma avaliação negativa.'
                : status === 'ambiguous'
                  ? 'A identidade nesta avaliação de exemplo não pôde ser desambiguada. É preciso confirmar a marca antes de atribuir uma nota.'
                  : `${fixtureReasoning[attribute.id].pt} ${fixtureReasoning[attribute.id].gapPt}`,
          },
          sourceUrls: response.sourceIds.flatMap((id) => {
            const source = demoSources.find((item) => item.id === id);
            return source ? [source.url] : [];
          }),
        });
      }
    }
  }
  return rows;
}

const mean = (values: number[]): number | null =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

/** Compare fixed attribute sets, with the same model/context cohort for every ranked brand.
 * A missing or invalid grade is unavailable; it is never treated as zero or clamped. */
export function semanticAssociationReport(
  configuration: SemanticConfiguration,
  entities: BrandEntity[],
  assessments: SemanticAssessment[],
) {
  const attributes = configuration.enabled ? configuration.attributes : [];
  const scoped = assessments.filter((row) =>
    attributes.some(
      (attribute) =>
        row.attributeId === attribute.id &&
        row.attributeFingerprint === semanticAttributeFingerprint(attribute),
    ),
  );
  const valid = scoped.filter(
    (row) =>
      row.status === 'scored' &&
      row.score !== null &&
      Number.isFinite(row.score) &&
      row.score >= 0 &&
      row.score <= 100,
  );
  // A canonical merge cannot silently average independent brands into a new semantic identity.
  // Preserve original assessments, but mark merged/new identities as unassessed.
  const rows = entities.map((entity) => ({
    entity,
    attributes: attributes.map((attribute) => {
      const evidence =
        entity.members.length === 1
          ? valid.filter(
              (row) =>
                row.brandId === entity.members[0].id &&
                row.attributeId === attribute.id,
            )
          : [];
      const unique = [
        ...new Map(
          evidence.map((row) => [`${row.cohortId}/${row.model}`, row]),
        ).values(),
      ];
      return {
        attribute,
        evidence: unique,
        value: mean(unique.map((row) => row.score!)),
        denominator: unique.length,
        cohorts: unique.map((row) => `${row.cohortId}/${row.model}`).sort(),
      };
    }),
  }));
  // Share the cohort within each attribute, including partially assessed brands.
  // A brand missing an attribute remains unavailable there, without invalidating its peers.
  const cohorts = attributes.map((_, index) => {
    const available = rows.filter(
      (row) => row.attributes[index].evidence.length > 0,
    );
    return available.length
      ? available[0].attributes[index].cohorts.filter((key) =>
          available.every((row) => row.attributes[index].cohorts.includes(key)),
        )
      : [];
  });
  const brands = rows.map((row) => {
    const cells = row.attributes.map((cell, index) => {
      const evidence = cell.evidence.filter((item) =>
        cohorts[index].includes(`${item.cohortId}/${item.model}`),
      );
      return {
        ...cell,
        inconclusive: scoped.filter(
          (item) =>
            item.status !== 'scored' &&
            item.attributeId === cell.attribute.id &&
            row.entity.members.some((member) => member.id === item.brandId),
        ),
        evidence,
        value: mean(evidence.map((item) => item.score!)),
        denominator: evidence.length,
      };
    });
    const comparable =
      attributes.length > 0 && cells.every((cell) => cell.value !== null);
    return {
      entity: row.entity,
      attributes: cells,
      score: comparable ? mean(cells.map((cell) => cell.value!)) : null,
      assessedAttributes: cells.filter((cell) => cell.value !== null).length,
      comparable,
    };
  });
  const ranking = brands
    .filter((brand) => brand.score !== null)
    .sort(
      (a, b) =>
        b.score! - a.score! || a.entity.name.localeCompare(b.entity.name),
    );
  const own = brands.find((brand) =>
    brand.entity.members.some((member) => member.id === 'conversion'),
  );
  const leader = ranking[0];
  const reference = leader?.entity.id === own?.entity.id ? ranking[1] : leader;
  const ownValues = own?.attributes.filter((item) => item.value !== null) ?? [];
  const strongest = [...ownValues].sort((a, b) => b.value! - a.value!)[0];
  const priority = [...ownValues].sort((a, b) => a.value! - b.value!)[0];
  return {
    configuration,
    brands,
    ranking,
    own,
    leader,
    reference,
    strongest,
    priority,
    assessments: scoped,
    gap:
      own?.score != null && reference?.score != null
        ? own.score - reference.score
        : null,
    prompts: new Set(valid.map((row) => row.contextPromptId)).size,
    models: [...new Set(valid.map((row) => row.model))],
    date:
      valid
        .map((row) => row.date)
        .sort()
        .at(-1) ?? null,
    comparableAttributes: cohorts.filter((keys) => keys.length > 0).length,
  };
}
export type SemanticAssociationReport = ReturnType<
  typeof semanticAssociationReport
>;

export function semanticAssociationRows(
  report: SemanticAssociationReport,
): (string | number)[][] {
  const rows: (string | number)[][] = [
    [
      'Semantic configuration',
      'Enabled',
      'Boolean',
      String(report.configuration.enabled),
      '',
      'Session-only setup; no provider work submitted',
    ],
  ];
  for (const attribute of report.configuration.attributes)
    rows.push([
      'Semantic configuration',
      attribute.id,
      'Attribute',
      attribute.name,
      '',
      attribute.description,
    ]);
  for (const brand of report.brands) {
    rows.push([
      'Semantic score',
      brand.entity.name,
      'Mean attribute grade / 100',
      brand.score ?? '',
      report.configuration.attributes.length,
      `Domain ${brand.entity.domain}; assessed attributes ${brand.assessedAttributes}; comparable ${brand.comparable}; equally weighted configured attributes; missing is unavailable`,
    ]);
    for (const cell of brand.attributes)
      rows.push([
        'Semantic attribute',
        `${brand.entity.name} / ${cell.attribute.name}`,
        'Mean grade / 100',
        cell.value ?? '',
        cell.denominator,
        `Attribute ${cell.attribute.id}; model/context pairs; missing is unavailable`,
      ]);
  }
  for (const row of report.assessments) {
    rows.push([
      'Semantic assessment',
      row.id,
      'Grade / 100',
      row.score ?? '',
      100,
      `Status ${row.status}; brand ${row.brandId}; attribute ${row.attributeId}; fingerprint ${row.attributeFingerprint}; model ${row.model}; date ${row.date}; context prompt ${row.contextPromptId}; cohort ${row.cohortId}`,
    ]);
    rows.push([
      'Semantic evaluation prompt',
      row.id,
      'Text',
      row.prompt.en,
      '',
      'Authored synthetic rubric evaluation, separate from the context prompt',
    ]);
    rows.push([
      'Semantic explanation',
      row.id,
      'Text',
      row.explanation.en,
      '',
      'Synthetic; not a collected model response',
    ]);
    for (const url of row.sourceUrls)
      rows.push([
        'Semantic contextual source',
        row.id,
        'URL',
        url,
        '',
        'Aggregated context; not corroboration of this grade',
      ]);
  }
  return rows;
}
