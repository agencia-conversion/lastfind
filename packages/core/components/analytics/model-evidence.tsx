'use client';
import { formatPercent } from '@/lib/number-format';
import type { AnalysisRow } from '@/lib/report-types';
import type { DataColumn } from '@/components/lastfind/presentation/data-table';
import { Hint } from '@/components/ui/tooltip';

type Evidence = 'citationCoverage' | 'consultedCoverage';
type Translate = (en: string, pt: string) => string;

export function hasModelEvidence(row: AnalysisRow, field: Evidence) {
  return (
    row.responses > 0 &&
    typeof row[field] === 'number' &&
    Number.isFinite(row[field]) &&
    (field === 'citationCoverage' || row[field] > 0)
  );
}
/**
 * The Summary row of the models table: counts are added up, rates are weighted by the responses behind
 * each model. A rate nobody measured (no model with that evidence) is null: no honest aggregate.
 */
export function modelsSummaryValues(rows: AnalysisRow[]) {
  const weighted = (field: 'visibility' | Evidence, only: (row: AnalysisRow) => boolean) => {
    const used = rows.filter(only);
    const weight = used.reduce((total, row) => total + row.responses, 0);
    return weight ? used.reduce((total, row) => total + row[field] * row.responses, 0) / weight : null;
  };
  return {
    responses: rows.reduce((total, row) => total + row.responses, 0),
    mentions: rows.reduce((total, row) => total + row.mentions, 0),
    visibility: weighted('visibility', (row) => row.responses > 0),
    citationCoverage: weighted('citationCoverage', (row) => hasModelEvidence(row, 'citationCoverage')),
    consultedCoverage: weighted('consultedCoverage', (row) => hasModelEvidence(row, 'consultedCoverage')),
  };
}
export function modelEvidenceText(
  row: AnalysisRow,
  field: Evidence,
  locale: string,
  t: Translate,
) {
  if (!row.responses)
    return t('No responses in this period', 'Sem respostas neste período');
  if (typeof row[field] !== 'number' || !Number.isFinite(row[field]))
    return t('Not available', 'Indisponível');
  // The AI did not send the list at all (only some do): the column's hint explains it, the cell stays plain.
  if (field === 'consultedCoverage' && !row[field]) return '—';
  return formatPercent(locale, row[field]);
}
export function modelEvidenceColumns<T extends AnalysisRow>(
  rows: T[],
  locale: string,
  t: Translate,
): DataColumn<T>[] {
  return (['citationCoverage', 'consultedCoverage'] as const)
    .filter((field) => rows.some((row) => hasModelEvidence(row, field)))
    .map((field) => {
      const label =
        field === 'citationCoverage'
          ? t('Responses with citations', 'Respostas com citações')
          : t(
              'Consulted sources provided',
              'Fontes consultadas informadas',
            );
      const definition =
        field === 'citationCoverage'
          ? t(
              'Complete responses with at least one cited source ÷ complete responses × 100.',
              'Respostas completas com ao menos uma fonte citada ÷ respostas completas × 100.',
            )
          : t(
              'Complete responses with a consulted-source list provided (including empty lists) ÷ complete responses × 100. Not a query count. Only some AIs send this list; “—” means this AI did not provide it.',
              'Respostas completas com lista de fontes consultadas fornecida (incluindo listas vazias) ÷ respostas completas × 100. Não é contagem de consultas. Só algumas IAs enviam essa lista; “—” indica que esta IA não a forneceu.',
            );
      return {
        key: field,
        width: field === 'citationCoverage' ? 200 : 270,
        header: `${label} (%)`,
        info: definition,
        label,
        align: 'end',
        sortValue: (row) => (row.responses > 0 ? row[field] : null),
        cell: (row) => (
          <Hint
            text={
              field === 'citationCoverage' &&
              row.responses > 0 &&
              row[field] === 0
                ? t('No citations returned', 'Sem citações retornadas')
                : definition
            }
          >
          <span>
            {modelEvidenceText(row, field, locale, t)}
          </span>
          </Hint>
        ),
      };
    });
}
export function ModelEvidenceNotice({
  rows,
  t,
}: {
  rows: AnalysisRow[];
  t: Translate;
}) {
  const hasCitations = rows.some((row) =>
    hasModelEvidence(row, 'citationCoverage'),
  );
  if (hasCitations) return null;
  return (
    <p className="p-4 text-muted-foreground">
      {rows.some((row) => row.responses > 0)
        ? t(
            'Citation coverage is not available.',
            'Cobertura de citações indisponível.',
          )
        : t(
            'No responses in this period. Evidence coverage is not available.',
            'Sem respostas neste período. A cobertura de evidências está indisponível.',
          )}
    </p>
  );
}
