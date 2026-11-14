'use client';
// The public menus: the site header's (features, language, account) and the language menu of every page outside the
// app (sign-in, profile, AI app consent, the independent installation's docs). One component, so the language reads
// the same everywhere: flag, code and the chevron beside them (docs/design/site.md section 4). No i18n provider or
// router import: the Astro site renders it too.
import { useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import './public-menu.css';

export type PublicMenuLocale = 'en' | 'pt-BR';

// The language menu is as wide as its longest language, never a fixed column.
const widths = { features: 380, language: null, account: 280 } as const;

export function PublicMenuContent({
  variant,
  className,
  style,
  ...props
}: ComponentProps<typeof DropdownMenuContent> & { variant: keyof typeof widths }) {
  return (
    <DropdownMenuContent
      align="end"
      side="bottom"
      sideOffset={8}
      {...props}
      positionerClassName="lf-public-menu-positioner"
      className={`lf-public-menu lf-public-${variant}-menu w-auto min-w-0 p-2 ring-0 outline-none ${className ?? ''}`}
      style={{ ...style, width: widths[variant] ? `min(${widths[variant]}px, calc(100vw - 32px))` : 'max-content', minWidth: 0 }}
    />
  );
}

/** A labelled trigger that opens on hover and on keyboard focus, with its menu under it. */
export function PublicMenu({
  label,
  ariaLabel,
  instance,
  variant = 'features',
  children,
  container,
  align = 'start',
}: {
  label: ReactNode;
  ariaLabel?: string;
  instance: string;
  variant?: keyof typeof widths;
  children: ReactNode;
  container?: RefObject<HTMLElement | null>;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const suppress = useRef(false);
  return (
    <DropdownMenu
      modal={false}
      open={open}
      triggerId={`lf-public-${instance}-trigger`}
      onOpenChange={(next, details) => {
        if (!next && (details.reason === 'escape-key' || details.reason === 'outside-press')) suppress.current = true;
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger
        id={`lf-public-${instance}-trigger`}
        className="lf-public-menu-trigger"
        aria-label={ariaLabel}
        openOnHover
        delay={0}
        closeDelay={140}
        onBlur={() => {
          suppress.current = false;
        }}
        onFocus={(event) => {
          if (
            !open &&
            !suppress.current &&
            event.currentTarget.matches(':focus-visible') &&
            !(event.relatedTarget instanceof Element && event.relatedTarget.closest('.lf-public-menu'))
          )
            // Open through Base UI's trigger so keyboard navigation and
            // outside dismissal receive the same interaction context as Enter.
            event.currentTarget.click();
        }}
      >
        {label}
        <ChevronDown size={12} aria-hidden="true" />
      </DropdownMenuTrigger>
      <PublicMenuContent
        id={`lf-public-${instance}-menu`}
        variant={variant}
        align={align}
        portalContainer={container}
        finalFocus={(interaction) => interaction === 'keyboard'}
      >
        {children}
      </PublicMenuContent>
    </DropdownMenu>
  );
}

const languages = [
  // The flag says the country: the name is the language alone.
  ['pt-BR', '🇧🇷', 'PT', 'Português'],
  ['en', '🇺🇸', 'EN', 'English'],
] as const;

/**
 * The language menu. With `targets` each language is a link to its page (the site, where every page has a URL per
 * language) and the choice is kept in the lastfind_locale cookie; without them `onSelect` switches the page in place
 * (sign-in, profile, consent: what was typed stays).
 */
export function LanguageMenu({
  locale,
  instance,
  targets,
  onSelect,
  container,
}: {
  locale: PublicMenuLocale;
  instance: string;
  targets?: Record<PublicMenuLocale, string>;
  onSelect?: (locale: PublicMenuLocale) => void;
  container?: RefObject<HTMLElement | null>;
}) {
  const current = languages.find(([code]) => code === locale) ?? languages[1];
  return (
    <PublicMenu
      instance={`language-${instance}`}
      variant="language"
      label={
        <>
          <span className="lf-public-flag" aria-hidden="true">
            {current[1]}
          </span>
          {current[2]}
        </>
      }
      ariaLabel={`${locale === 'en' ? 'Interface language' : 'Idioma da interface'}: ${current[2]}`}
      align="end"
      container={container}
    >
      {languages.map(([next, flag, , label]) => (
        <DropdownMenuItem
          key={next}
          closeOnClick={!targets}
          render={targets ? <a href={targets[next]} hrefLang={next} aria-label={label} /> : undefined}
          aria-current={locale === next ? 'true' : undefined}
          onClick={() => {
            if (targets)
              document.cookie = `lastfind_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
            else onSelect?.(next);
          }}
        >
          <span aria-hidden="true">{flag}</span>
          <span>{label}</span>
          {locale === next && <Check size={16} aria-hidden="true" />}
        </DropdownMenuItem>
      ))}
    </PublicMenu>
  );
}
