'use client';
import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

const FILTERS_SLOT = 'topbar-filters-slot';

// Compact analytics page title/action row. Replaces the earlier
// eyebrow + h1 + title-dot + description block: the sidebar breadcrumb
// already carries the project/section context, so the heading itself
// stays a single 24px title, an optional one-line description and the
// page-level actions, matching a dense product-analytics rhythm instead
// of a marketing hero.
export function PageHeading({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('page-heading', className)}>
      <div className="page-heading-text">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}

const subscribeNever = () => () => {};
const findSlot = () => document.getElementById(FILTERS_SLOT);

/**
 * The top bar's filter row: the global filters plus whatever the screen adds
 * with <PageFilters>. Labels stay visible; the row wraps when it does not fit
 * (no icon-compact mode). Horizontal scroll clipped under the breadcrumb.
 */
export function FilterBar({ children }: { children?: ReactNode }) {
  return (
    <div className="filter-main">
      {children}
      <span id={FILTERS_SLOT} className="topbar-filters-slot" />
    </div>
  );
}

/** Renders a screen's own filters in the top bar, next to the global ones. */
export function PageFilters({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(subscribeNever, findSlot, () => null);
  return slot ? createPortal(children, slot) : null;
}
