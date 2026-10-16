import type { SemanticAggregate } from '@/lib/semantic-report';
import type { SemanticAssociationReport } from './semantic-association-data';
import type { SemanticConfiguration } from './semantic-configuration';

/** Presentation adapter: all grades and cohort sizes come from full server aggregates. */
export function measuredAssociationReport(
  configuration: SemanticConfiguration,
  aggregate: SemanticAggregate,
): SemanticAssociationReport {
  const attributes = configuration.enabled ? configuration.attributes : [];
  const brands = aggregate.brands.map((target) => {
    const entity = {
      id: target.name,
      ...target,
      members: [{ id: target.name, ...target, aliases: [] }],
    };
    const cells = attributes.map((attribute) => {
      const cell = aggregate.cells.find(
        (cell) => cell.brand === target.name && cell.attribute === attribute.id,
      );
      return {
        attribute,
        value: cell?.score ?? null,
        denominator: cell?.samples ?? 0,
        observedValue: cell?.observedScore ?? null,
        observedDenominator: cell?.observedSamples ?? 0,
        cohorts: [],
        evidence: [],
        inconclusive: [],
      };
    });
    const comparable =
      cells.length > 0 && cells.every((cell) => cell.value !== null);
    return {
      entity,
      attributes: cells,
      comparable,
      assessedAttributes: cells.filter((cell) => cell.value !== null).length,
      score: comparable
        ? cells.reduce((sum, cell) => sum + cell.value!, 0) / cells.length
        : null,
    };
  });
  const ranking = brands
    .filter((brand) => brand.score !== null)
    .sort(
      (a, b) =>
        b.score! - a.score! || a.entity.name.localeCompare(b.entity.name),
    );
  const own = brands.find((brand) => brand.entity.name === aggregate.ownBrand);
  const leader = ranking[0],
    reference = leader?.entity.id === own?.entity.id ? ranking[1] : leader;
  const ownCells =
    own?.attributes.filter((cell) => cell.observedValue !== null) ?? [];
  return {
    configuration,
    brands,
    ranking,
    own,
    leader,
    reference,
    strongest: [...ownCells].sort(
      (a, b) => b.observedValue! - a.observedValue!,
    )[0],
    priority: [...ownCells].sort(
      (a, b) => a.observedValue! - b.observedValue!,
    )[0],
    gap:
      own?.score != null && reference?.score != null
        ? own.score - reference.score
        : null,
    assessments: [],
    prompts: aggregate.prompts,
    models: aggregate.engines,
    date: aggregate.date,
    comparableAttributes: attributes.filter((attribute) =>
      aggregate.cells.some(
        (cell) => cell.attribute === attribute.id && cell.score !== null,
      ),
    ).length,
  };
}
