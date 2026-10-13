'use client';
import { useI18n } from '@/lib/i18n';
import { ArrowUpRight, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Favicon } from '../identity-icons';

export type RankedBrand = {
  name: string;
  domain: string;
  count: number;
  visibility: number;
  color?: string;
};

// Compact brand ranking table for Overview's narrow side panel: rank,
// brand, visibility and share of voice as plain numbers instead of a
// 130px-minimum progress bar the panel has no room for, abbreviated
// headers with full accessible labels (sr-only text, not just aria-label),
// and a gracefully truncated domain (title attribute keeps the full value
// reachable). Share of voice is derived from the same `count` totals the
// report already computes — no new metric. The optional `onInvestigate`
// callback reuses the existing report drilldown (filtering Responses by
// brand), never a fabricated per-brand detail view.
export function BrandRankingTable({
  brands,
  primaryName,
  onInvestigate,
}: {
  brands: RankedBrand[];
  primaryName: string;
  onInvestigate?: (name: string) => void;
}) {
  const { t, locale } = useI18n();
  const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 });
  const total = brands.reduce((sum, b) => sum + b.count, 0);
  const share = (count: number) => (total ? (count / total) * 100 : 0);
  return (
    <Table className="brand-ranking-table">
      <TableHeader>
        <TableRow>
          <TableHead className="rank-header">#</TableHead>
          <TableHead>{t('MARCA')}</TableHead>
          <TableHead>
            <span aria-hidden="true">{t('VIS.')}</span>
            <span className="sr-only">{t('VISIBILIDADE')}</span>
          </TableHead>
          <TableHead>
            <span className="table-head-info">
              <span aria-hidden="true">SOV</span>
              <span className="sr-only">{t('PARTICIPAÇÃO EM MENÇÕES')}</span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="kpi-strip-info"
                      aria-label={t('Definição de {label}', {
                        label: t('Participação em menções'),
                      })}
                    />
                  }
                >
                  <Info size={12} />
                </TooltipTrigger>
                <TooltipContent>
                  {t(
                    'Menções únicas desta marca divididas pela soma de menções de todas as marcas monitoradas.',
                  )}
                </TooltipContent>
              </Tooltip>
            </span>
          </TableHead>
          {onInvestigate && (
            <TableHead>
              <span className="sr-only">{t('Investigar')}</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {brands.map((b, i) => (
          <TableRow key={b.name}>
            <TableCell className="rank-cell">{i + 1}</TableCell>
            <TableCell>
              <span className="brand-table-name">
                {b.color ? (
                  <i
                    className="series-swatch"
                    style={{ background: b.color }}
                    aria-hidden="true"
                  />
                ) : null}
                <Favicon domain={b.domain} name={b.name} />
                <span>
                  <b>{b.name}</b>
                  {b.domain && <small title={b.domain}>{b.domain}</small>}
                </span>
                {b.name === primaryName && (
                  <span className="subtle-tag">{t('Sua marca')}</span>
                )}
              </span>
            </TableCell>
            <TableCell className="rank-number-cell">{fmt(b.visibility)}%</TableCell>
            <TableCell className="rank-number-cell">{fmt(share(b.count))}%</TableCell>
            {onInvestigate && (
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('Investigar {name}', { name: b.name })}
                  onClick={() => onInvestigate(b.name)}
                >
                  <ArrowUpRight />
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
