import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './eyebrow.css';

// Title kicker shared by the product pages and docs.
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn('lf-eyebrow', className)}>{children}</span>;
}
