'use client';
import type { ReactNode } from 'react';

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
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="page-heading-text">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </div>
  );
}
