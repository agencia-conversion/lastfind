'use client';
import { Search, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from '@/components/ui/empty';

// Shared empty-state block (no runs, no prompts, no matches) with an
// optional primary action. Extracted from workspace-app.tsx's inline
// `EmptyBlock` helper.
export function EmptyState({
  title,
  description,
  action,
  label,
}: {
  title: string;
  description: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <Empty className="lf-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Search />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && (
        <Button variant="outline" className="lf-outline" onClick={action}>
          <Plus />
          {label}
        </Button>
      )}
    </Empty>
  );
}
