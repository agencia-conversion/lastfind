'use client';
import { Children, useEffect, useRef, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import './detail-page.css';

/**
 * A page that takes the whole main content (an artifact, a content wizard): its own header, sticky at the top, with the
 * way back (or, on a page of its own, the logo), the title and its details, the actions, and what goes under them (a menu
 * bar); then the body. Inside the app the top bar and the screen's heading step aside for it (detail-page.css), so a
 * detail reads the same in the app and at its own address, there without the sidebar and the way back.
 */
export function DetailPage({ className, children, ...props }: React.ComponentProps<'div'>) {
  // Its header's height, for what sticks under it (a panel beside the body): `--detail-header-height`.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = ref.current?.querySelector<HTMLElement>(':scope > .detail-header');
    if (!header) return;
    const observer = new ResizeObserver(() => ref.current?.style.setProperty('--detail-header-height', `${header.offsetHeight}px`));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} data-slot="detail-page" className={cn('detail-page', className)} {...props}>
      {children}
    </div>
  );
}

/**
 * The one header of a full-page detail (docs/design/shell.md section 4): `--header-height`, the way back or the logo, the
 * title at body size with its meta inline, the actions; under it, only when there is something to show, a second row (a
 * menu bar, a toolbar). `compact` (the chat panel, the side artifact panel) has no way back.
 */
export function DetailHeader({
  leading,
  title,
  meta,
  actions,
  children,
  density = 'default',
  className,
}: {
  /** The way back, or the logo. */
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Under the title, at its left edge (a menu bar, a toolbar), as in Google Docs. */
  children?: ReactNode;
  density?: 'default' | 'compact';
  className?: string;
}) {
  const second = Children.toArray(children).length > 0;
  return (
    <header data-slot="detail-header" data-density={density} className={cn('detail-header', className)}>
      {leading && density === 'default' && <div className="detail-header-leading">{leading}</div>}
      <div className="detail-header-title">
        {title}
        {meta && <p className="detail-header-meta">{meta}</p>}
      </div>
      {actions && <div className="detail-header-actions">{actions}</div>}
      {second && <div className="detail-header-below">{children}</div>}
    </header>
  );
}

/** `wide`: a body of data (cards and tables, an opportunity) takes the content width of the app's screens, not a form's. */
export function DetailBody({ className, wide, ...props }: React.ComponentProps<'div'> & { wide?: boolean }) {
  return <div data-slot="detail-body" data-wide={wide || undefined} className={cn('detail-body', className)} {...props} />;
}

/** A detail's body while it loads: its title and a few paragraph lines, in the place of the text that arrives. */
export function DetailBodySkeleton({ label, lines = 6, wide }: { label: string; lines?: number; wide?: boolean }) {
  return (
    <DetailBody wide={wide} aria-busy="true" aria-label={label}>
      <div className="grid gap-3">
        <Skeleton inline className="h-lh w-64 max-w-full" />
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} inline className={cn('h-lh', index % 3 === 2 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    </DetailBody>
  );
}
