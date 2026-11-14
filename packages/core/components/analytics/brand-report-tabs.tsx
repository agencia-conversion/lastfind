'use client';
import type { ReactNode } from 'react';
// `general` is the list with every brand that is not rejected; the monitored ones are the header's Brands filter.
export type BrandReportView = 'general' | 'discovered' | 'rejected';
const VIEWS: readonly string[] = ['discovered', 'rejected'];
export function parseBrandReportView(value: unknown): BrandReportView {
  return typeof value === 'string' && VIEWS.includes(value) ? (value as BrandReportView) : 'general';
}
export function syncBrandReportView(
  query: URLSearchParams,
  view: BrandReportView,
  active: boolean,
) {
  if (active && view !== 'general') query.set('brandView', view);
  else query.delete('brandView');
}
/** The Brands screen's lists, chosen in the header's Brands filter on that screen (before, a select of their own). */
export const BRAND_REPORT_VIEWS: [BrandReportView, [string, string]][] = [
  ['general', ['Every brand listed', 'Todas as marcas listadas']],
  ['discovered', ['Discovered, to decide', 'Descobertas, para decidir']],
  ['rejected', ['Rejected', 'Rejeitadas']],
];
export function BrandReportTabs({ value, children }: { value: BrandReportView; children: ReactNode }) {
  return (
    <section data-view={value} className="min-w-0 space-y-6">
      {children}
    </section>
  );
}
