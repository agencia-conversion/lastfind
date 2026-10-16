'use client';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';

/**
 * A destination inside the signed-in app. Unset keys keep the current value;
 * `null` clears it. The period, models, topic and tag filters always travel
 * with the link, so a drill down never loses the period the user was reading.
 */
export type DrillTarget = {
  tab?: string;
  entity?: { kind: 'domain' | 'url'; key: string } | null;
  run?: string | null;
  prompt?: string | null;
  brand?: string | null;
  mention?: 'all' | 'mentioned' | 'missing';
  engine?: string;
  type?: string | null;
  group?: 'domain' | 'url';
  kind?: 'cited' | 'consulted';
  section?: string;
  brandView?: 'general' | 'sentiment';
};
export type Linker = (target: DrillTarget) => {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/** In-app anchor: a real link (new tab, copy address) that navigates without a reload on a plain click. */
export function DrillLink({
  link,
  to,
  children,
  className,
  disabled,
  ...rest
}: { link: Linker; to: DrillTarget; children: ReactNode; disabled?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'>) {
  // Nothing to open (for example a citation without a domain): same layout, no link.
  if (disabled) return <a {...rest} className={`drill-link${className ? ` ${className}` : ''}`}>{children}</a>;
  const { href, onClick } = link(to);
  return (
    <a {...rest} href={href} onClick={onClick} className={`drill-link${className ? ` ${className}` : ''}`}>
      {children}
    </a>
  );
}
