'use client';
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type KpiItem = {
  label: string;
  value: string;
  definition: string;
  icon: ReactNode;
  delta?: number;
  deltaSuffix?: string;
  sample?: number;
  onClick?: () => void;
};

// Compact continuous 4-KPI strip (one bordered row, divided by internal
// borders) replacing four tall, detached metric cards — the definition text
// moves into an accessible info tooltip so the row stays dense (~100-120px
// tall) instead of tall separate cards. Value, delta and sample are still
// all shown inline; nothing is dropped, only the long definition sentence
// is deferred to the tooltip.
export function KpiStrip({ items }: { items: KpiItem[] }) {
  const { t, locale } = useI18n();
  return (
    // Card composes a div; role="group" is what gives the aria-label
    // semantic effect in the accessibility tree (a plain div with just an
    // aria-label is not exposed as a named group by most screen readers).
    <Card
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      className="kpi-strip gap-0 py-0 ring-0"
      aria-label={t('Indicadores principais')}
    >
      {items.map((item) => {
        const content = (
          <>
            <div className="kpi-strip-label">
              <span className="kpi-strip-icon">{item.icon}</span>
              <span className="kpi-strip-label-text">{item.label}</span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="kpi-strip-info"
                      aria-label={t('Definição de {label}', { label: item.label })}
                    />
                  }
                >
                  <Info size={12} />
                </TooltipTrigger>
                <TooltipContent>{item.definition}</TooltipContent>
              </Tooltip>
            </div>
            <div className="kpi-strip-value-row">
              <strong>{item.value}</strong>
              {item.delta !== undefined && (
                <small className="metric-delta">
                  {item.delta > 0 ? '+' : ''}
                  {item.delta.toLocaleString(locale, { maximumFractionDigits: 1 })}
                  {item.deltaSuffix ?? ' p.p.'}
                </small>
              )}
            </div>
            {item.sample != null && (
              <small className="kpi-strip-sample">
                {t('Amostra: {count}', { count: item.sample.toLocaleString(locale) })}
              </small>
            )}
          </>
        );

        return item.onClick ? (
          <button
            key={item.label}
            type="button"
            className="kpi-strip-item kpi-strip-item-clickable"
            onClick={item.onClick}
            aria-label={t('Explorar {label}', { label: item.label })}
          >
            {content}
          </button>
        ) : (
          <div className="kpi-strip-item" key={item.label}>
            {content}
          </div>
        );
      })}
    </Card>
  );
}
