'use client';
import type { ReactNode } from 'react';

// Shared dense toolbar rows for table-backed areas (Prompts, Sources,
// Responses): DataToolbar is the scope/status row (tabs or a status label,
// with an optional right-aligned count), DataToolbarFilters is the
// search/filter/action row below it. Both are pure layout — every call site
// still supplies its own real controls and data; nothing here invents a
// count, filter or action that the area doesn't already have.
export function DataToolbar({
  scope,
  meta,
}: {
  scope: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="data-toolbar">
      {scope}
      {meta != null && <span className="data-toolbar-meta">{meta}</span>}
    </div>
  );
}

export function DataToolbarFilters({
  search,
  children,
  actions,
}: {
  search?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="data-toolbar-filters">
      {search}
      {children}
      {actions && <div className="data-toolbar-filters-actions">{actions}</div>}
    </div>
  );
}
