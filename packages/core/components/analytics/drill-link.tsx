'use client';
import type { AnchorHTMLAttributes, MouseEvent, ReactElement, ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Hint } from '@/components/ui/tooltip';
import { buttonVariants } from '@/components/ui/button';

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
  /** The display name of `brand` when it is a discovered brand's key (the filter's label). */
  brandLabel?: string | null;
  /** Responses whose reading of the brand is in this sentiment band; `null` clears it. */
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  mention?: 'all' | 'mentioned' | 'missing';
  /** Responses citing the brand's own domain ('own'), this domain or this page (a URL); `null` clears it. */
  cites?: string | null;
  /** A chart's day, week or month (both dates included): the period becomes that range. */
  range?: { start: string; end: string };
  engine?: string;
  /** Topic (prompt tag) filter; `null` clears it. */
  topic?: string | null;
  tags?: string;
  query?: string;
  type?: string | null;
  /** Owner mark filter: own | competitor | third-party. */
  owner?: string | null;
  group?: 'domain' | 'url';
  /** Sources evidence filter: every source, the cited ones, the consulted ones. */
  kind?: 'all' | 'cited' | 'consulted';
  origin?: 'all' | 'prompts' | 'semantic-branding';
  section?: string;
  /** Brands: open the page of this brand (its key); `null` goes back to the list. */
  brandPage?: string | null;
  brandView?: 'general' | 'tracked' | 'discovered' | 'rejected' | 'sentiment';
  /** Products: open a product's page (its slug) or a brand's (`brands/<slug>`); `null` goes back to the list. */
  productDetail?: string | null;
  /** Comparison: open its Products, Attributes or Personas page; `null` goes back to its overview. */
  comparisonView?: string | null;
  /** Traffic (the AI bots section): open its AI Bots or AI Traffic page, with a drill down (`ai?llm=chatgpt`); `null` goes back to its overview. */
  aiBotsView?: string | null;
  /** Query Fan Out: open the screen on this word of the searches (`null` clears it). */
  fanoutTerm?: string | null;
  /** Query Fan Out: open the page of this search (its key). */
  fanoutQuery?: string;
};
export type Linker = (target: DrillTarget) => {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/** Overview "View all" / "see these sources" arrow, one size everywhere. */
export function DrillArrow() {
  return <ArrowUpRight size={14} aria-hidden="true" />;
}

/**
 * In-app anchor: a real link (new tab, copy address) that navigates without a reload on a plain click.
 * `plain` is for anchors drawn as buttons; underline on hover comes only from link-hover.css (links in running text).
 * `title` shows in the catalog's dark balloon (Hint), never the browser's.
 */
export function DrillLink({
  link,
  to,
  children,
  className,
  disabled,
  plain,
  title,
  ...rest
}: { link: Linker; to: DrillTarget; children: ReactNode; disabled?: boolean; plain?: boolean } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'>) {
  // Nothing to open (for example a citation without a domain): same layout, no link.
  const classes = `drill-link${plain ? ' drill-link-plain' : ''}${className ? ` ${className}` : ''}`;
  const hint = (anchor: ReactElement) => (title ? <Hint text={title}>{anchor}</Hint> : anchor);
  if (disabled) return hint(<a {...rest} className={classes}>{children}</a>);
  const { href, onClick } = link(to);
  return hint(
    <a {...rest} href={href} onClick={onClick} className={classes}>
      {children}
    </a>,
  );
}

/**
 * The one "View all" of a card header (docs/design/shell.md section 7): a ghost link to the full screen, with the arrow. On a
 * phone only the arrow shows (its words stay its name), so the card's title keeps its one line.
 */
export function ViewAllAction({ link, to, children }: { link: Linker; to: DrillTarget; children: ReactNode }) {
  return (
    <DrillLink link={link} to={to} plain className={`${buttonVariants({ variant: 'ghost' })} view-all-action`}>
      <span className="view-all-label">{children}</span>
      <DrillArrow />
    </DrillLink>
  );
}
