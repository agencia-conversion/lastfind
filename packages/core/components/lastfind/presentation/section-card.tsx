'use client';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';

// Shared panel shell for the dense analytics surfaces (Overview, Competitors,
// Sources, Opportunities, Responses): a bordered card with a compact
// title/description header and an optional right-aligned action, so every
// table/chart panel gets the same header rhythm instead of each call site
// re-declaring `<Card className="gap-0 py-0 ring-0 panel">` + a hand-rolled
// `.panel-title` block.
export function SectionCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={`gap-0 py-0 ring-0 panel${className ? ` ${className}` : ''}`}>
      {(title || description || action) && (
        <div className="panel-title">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </Card>
  );
}
