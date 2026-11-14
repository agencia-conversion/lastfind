'use client';
// The documentation of both editions: an index (/docs) and one page per section (/docs/<section>), each with the
// sidebar of sections, the reading column, "On this page" and the previous/next pager. Each edition passes its own
// header, footer and sections; the product guide is shared (product-docs.tsx).
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Menu } from 'lucide-react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { useI18n } from '@/lib/i18n';
import './docs.css';

export type Translate = (en: string, pt: string) => string;

export type DocsSection = {
  /** The page's slug (/docs/<id>), the same in every language. */
  id: string;
  group: string;
  /** Its label in the sidebar, the pager and the breadcrumb. */
  name: string;
  /** The page's h1 and, without its final period, its document title. */
  title: string;
  /** The lead under the h1 and the meta description (one or two sentences, up to about 160 characters). */
  description: string;
  /** The page's parts (h2), listed in "On this page". */
  subs: { id: string; label: string }[];
  body: ReactNode;
  /** Sections that continue this one, linked at its end (ids missing from an edition are skipped). */
  related?: string[];
};

/** The page's place in the site, the last item being the page itself (mirrored in the Cloud page's JSON-LD). */
export type DocsCrumb = { name: string; path: string };

/** The section that holds an anchor of the old one-page docs (/docs#<id>): a section id or one of its parts. */
export const docsAnchorSection = (sections: DocsSection[], anchor: string) =>
  sections.find((s) => s.id === anchor || s.subs.some((x) => x.id === anchor));

/** Where "On this page" marks a heading as being read: just under the headings' scroll margin (docs.css). */
const READING_LINE = 120;

/**
 * The heading being read, by the headings' tops on screen (in page order): the last one above the reading line; at the
 * end of the page, where a short last part never reaches that line, the last one on screen. -1 before the first.
 */
export function headingInView(tops: number[], { end, height }: { end: boolean; height: number }) {
  let current = -1;
  tops.forEach((top, index) => {
    if (top <= READING_LINE || (end && top < height)) current = index;
  });
  return current;
}

function Heading({ id, as: Tag, label, children }: { id: string; as: 'h2' | 'h3'; label: string; children: ReactNode }) {
  return (
    <Tag id={id}>
      {children}
      <a className="docs-anchor" href={`#${id}`} aria-label={label}>
        #
      </a>
    </Tag>
  );
}

/** A part of a section page (h2 under the page's h1), listed in "On this page". */
export function DocsH2({ id, children }: { id: string; children: ReactNode }) {
  const { locale } = useI18n();
  return (
    <Heading id={id} as="h2" label={locale === 'en' ? 'Link to this heading' : 'Link para este título'}>
      {children}
    </Heading>
  );
}

export function DocsCode({ code }: { code: string }) {
  const { locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const label = locale === 'en' ? 'Copy code' : 'Copiar código';
  const done = locale === 'en' ? 'Copied' : 'Copiado';
  return (
    <div className="docs-code">
      <pre>
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label={copied ? done : label}
        onClick={() => {
          navigator.clipboard
            ?.writeText(code)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        <span aria-live="polite">{copied ? done : label}</span>
      </button>
    </div>
  );
}

/**
 * A screenshot of the public demo project, in the reader’s language (1280x800 webp under public/docs), with its alt
 * text. `priority` marks a page's first one, on screen at load: fetched eagerly and first; the others load lazily.
 * Its width and height keep its place before it loads.
 */
export function DocsFigure({ shot, alt, caption, priority = false }: { shot: string; alt: string; caption?: string; priority?: boolean }) {
  const { locale } = useI18n();
  const src = `/docs/${shot}.${locale === 'en' ? 'en' : 'pt-br'}.webp`;
  return (
    <figure className="docs-figure">
      {/* Opens the full-size image, readable on a phone. */}
      <a href={src} target="_blank" rel="noopener">
        {/* A static, already optimized webp served from public/docs in both editions. */}
        {/* eslint-disable-next-line next/no-img-element */}
        <img
          src={src}
          width={1280}
          height={800}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
        />
      </a>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

/** A labelled path in the app, e.g. Settings > Monitoring > Budget. */
export function DocsPath({ children }: { children: ReactNode }) {
  return <span className="docs-path">{children}</span>;
}

export function DocsLayout({
  base,
  section,
  hero,
  groups,
  sections,
  header,
  footer,
  breadcrumbs,
}: {
  /** The docs' root in this language: /docs, /pt-br/docs. Section pages are under it. */
  base: string;
  /** The section page shown; omitted on the index. */
  section?: string;
  /** The index's h1 and lead. */
  hero: { title: ReactNode; lead: ReactNode };
  groups: { id: string; label: string }[];
  sections: DocsSection[];
  header?: ReactNode;
  footer?: ReactNode;
  breadcrumbs: DocsCrumb[];
}) {
  const { locale } = useI18n();
  const l: Translate = (en, pt) => (locale === 'en' ? en : pt);
  const page = section ? sections.find((s) => s.id === section) : undefined;
  const position = page ? sections.indexOf(page) : -1;
  const prev = page ? sections[position - 1] : undefined;
  const next = page ? sections[position + 1] : undefined;
  const related = page ? (page.related ?? []).flatMap((id) => sections.find((x) => x.id === id) ?? []) : [];
  const href = (id: string) => `${base}/${id}`;
  // "On this page": a section's parts, or the index's groups.
  const toc = page ? page.subs : groups.map((g) => ({ id: `group-${g.id}`, label: g.label }));
  const tocKey = toc.map((x) => x.id).join(' ');
  const [active, setActive] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  const pin = useRef<() => void>(() => undefined);

  useEffect(() => {
    // Open on wide screens (always visible); collapsed behind a button on narrow ones.
    if (matchMedia('(max-width: 899px)').matches && menu.current) menu.current.open = false;
  }, []);

  useEffect(() => {
    if (page) return;
    // An anchor of the old one-page docs (/docs#metrics, /docs#visibility) opens the section page that holds it.
    const anchor = decodeURIComponent(location.hash.slice(1));
    const owner = anchor ? docsAnchorSection(sections, anchor) : undefined;
    if (owner) location.replace(`${base}/${owner.id}${owner.id === anchor ? '' : `#${anchor}`}`);
  }, [page, sections, base]);

  useEffect(() => {
    // Scroll spy (headingInView). A heading the reader jumped to (a link, "On this page", the address's #anchor) stays
    // marked until they scroll themselves, even when the page cannot scroll it up to the reading line.
    const headings = tocKey
      .split(' ')
      .flatMap((id) => document.getElementById(id) ?? []);
    let pinned = '';
    let pinnedY = 0;
    const update = () => {
      if (pinned && Math.abs(scrollY - pinnedY) < 2) return setActive(pinned);
      pinned = '';
      const end = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      const index = headingInView(
        headings.map((el) => el.getBoundingClientRect().top),
        { end, height: innerHeight },
      );
      setActive(headings[index]?.id ?? '');
    };
    pin.current = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (headings.some((el) => el.id === id)) {
        pinned = id;
        pinnedY = scrollY;
      }
      update();
    };
    pin.current();
    const jumped = () => pin.current();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    window.addEventListener('hashchange', jumped);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('hashchange', jumped);
    };
  }, [tocKey]);
  return (
    <>
      {header}
      <main className="docs-page">
        <div className="docs-layout">
          <aside className="docs-sidebar">
            <details className="docs-menu" ref={menu} open>
              <summary>
                <Menu size={18} aria-hidden="true" />
                {page ? page.name : l('Documentation menu', 'Menu da documentação')}
              </summary>
              <nav aria-label={l('Documentation sections', 'Seções da documentação')}>
                <a className="docs-home" href={base} aria-current={page ? undefined : 'page'}>
                  {l('Documentation home', 'Início da documentação')}
                </a>
                {/* One group open at a time (the current page's; the first on the index), so the menu fits the screen
                    without its own scroll bar (docs/design/site.md section 10). Native disclosure: no script. */}
                {groups.map((group, index) => (
                  <details
                    className="docs-group"
                    key={group.id}
                    name="docs-groups"
                    open={page ? page.group === group.id : index === 0}
                  >
                    <summary>
                      {group.label}
                      <ChevronDown size={16} aria-hidden="true" />
                    </summary>
                    {sections
                      .filter((s) => s.group === group.id)
                      .map((s) => (
                        <a key={s.id} href={href(s.id)} aria-current={s.id === page?.id ? 'page' : undefined}>
                          {s.name}
                        </a>
                      ))}
                  </details>
                ))}
              </nav>
            </details>
          </aside>
          <div className="docs-main">
            <div className="docs-hero">
              <Breadcrumb aria-label={l('Breadcrumb', 'Caminho da página')}>
                <BreadcrumbList>
                  {breadcrumbs.map((crumb, index) => (
                    <Fragment key={crumb.path}>
                      {index > 0 ? <BreadcrumbSeparator /> : null}
                      <BreadcrumbItem>
                        {index === breadcrumbs.length - 1 ? (
                          <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink href={crumb.path}>{crumb.name}</BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
              <h1>{page ? page.title : hero.title}</h1>
              <p>{page ? page.description : hero.lead}</p>
            </div>
            <article className="docs-content">
              {page ? (
                <>
                  {page.body}
                  {related.length ? (
                    <nav className="docs-related" aria-label={`${l('Related to', 'Relacionado a')} ${page.name}`}>
                      <p>{l('Related', 'Relacionado')}</p>
                      <ul>
                        {related.map((x) => (
                          <li key={x.id}>
                            <a className="text-link" href={href(x.id)}>
                              {x.name}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  ) : null}
                  <nav className="docs-pager" aria-label={l('Previous and next', 'Anterior e próximo')}>
                    {prev ? (
                      <a href={href(prev.id)} rel="prev">
                        <small>
                          <ArrowLeft size={14} aria-hidden="true" />
                          {l('Previous', 'Anterior')}
                        </small>
                        {prev.name}
                      </a>
                    ) : (
                      <span />
                    )}
                    {next ? (
                      <a href={href(next.id)} rel="next">
                        <small>
                          {l('Next', 'Próximo')}
                          <ArrowRight size={14} aria-hidden="true" />
                        </small>
                        {next.name}
                      </a>
                    ) : (
                      <span />
                    )}
                  </nav>
                </>
              ) : (
                groups.map((group) => (
                  <section className="docs-index-group" key={group.id} aria-labelledby={`group-${group.id}`}>
                    <Heading id={`group-${group.id}`} as="h2" label={l('Link to this section', 'Link para esta seção')}>
                      {group.label}
                    </Heading>
                    <dl className="docs-index">
                      {sections
                        .filter((s) => s.group === group.id)
                        .map((s) => (
                          <div key={s.id}>
                            <dt>
                              <a href={href(s.id)}>{s.name}</a>
                            </dt>
                            <dd>{s.description}</dd>
                          </div>
                        ))}
                    </dl>
                  </section>
                ))
              )}
            </article>
          </div>
          {toc.length ? (
            <nav className="docs-toc" aria-label={l('On this page', 'Nesta página')}>
              <p>{l('On this page', 'Nesta página')}</p>
              {toc.map((x) => (
                <a
                  key={x.id}
                  href={`#${x.id}`}
                  aria-current={active === x.id ? 'location' : undefined}
                  // Clicking the heading already in the address fires no hashchange.
                  onClick={() => setTimeout(() => pin.current())}
                >
                  {x.label}
                </a>
              ))}
            </nav>
          ) : null}
        </div>
      </main>
      {footer}
    </>
  );
}
