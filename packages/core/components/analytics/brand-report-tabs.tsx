'use client';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { Smile, Users } from 'lucide-react';
import { SectionLayout } from './section-sidebar';
export type BrandReportView = 'general' | 'sentiment';
export function parseBrandReportView(value: unknown): BrandReportView {
  return value === 'sentiment' ? 'sentiment' : 'general';
}
export function syncBrandReportView(
  query: URLSearchParams,
  view: BrandReportView,
  active: boolean,
) {
  if (active && view === 'sentiment') query.set('brandView', 'sentiment');
  else query.delete('brandView');
}
export function BrandReportTabs({
  value,
  onChange,
  children,
}: {
  value: BrandReportView;
  onChange: (value: BrandReportView) => void;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const en = locale === 'en';
  return (
    <SectionLayout
      label={en ? 'Brand reports' : 'Relatórios de marcas'}
      groups={[
        {
          id: 'reports',
          items: [
            { id: 'general', label: en ? 'General' : 'Geral', icon: <Users /> },
            { id: 'sentiment', label: en ? 'Sentiment' : 'Sentimentos', icon: <Smile /> },
          ],
        },
      ]}
      value={value}
      onChange={(next) => onChange(parseBrandReportView(next))}
    >
      <section data-view={value} className="min-w-0 space-y-6">
        {children}
      </section>
    </SectionLayout>
  );
}
