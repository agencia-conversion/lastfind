'use client';
import { createContext, useContext,
  useEffect,
  useRef,
  useState, useSyncExternalStore, type KeyboardEvent, type ReactElement, type ReactNode,
} from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  SearchX,
  CircleAlert,
  Search,
  EllipsisVertical,
  ListFilter,
  LoaderCircle,
  Package,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cva } from 'class-variance-authority';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ENGINE_META, ENGINE_LABELS, isEngine } from '@/lib/engines';
import { MARGIN_OF_ERROR, withinMargin } from '@/lib/semantic-perception';
import { useI18n } from '@/lib/i18n';
import { formatNumber, formatPercent, numberLocale } from '@/lib/number-format';
import {
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import { FilterTrigger } from './filter-trigger';
import { Hint } from '@/components/ui/tooltip';
import { sortRows, type DataSort } from '@/components/lastfind/presentation/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  demoBrands,
  filterValues,
  type FilterSelection,
  type DemoBrand,
  type DemoModel,
} from './demo-data';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  fullWidth = false,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  fullWidth?: boolean;
  /** After the field's own keys (Esc clears first): a menu's search keeps its letters from the menu's type-ahead. */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const l = useCopy();
  const input = useRef<HTMLInputElement>(null);
  // Clearing keeps the focus in the field; Esc clears first and only an empty field lets it reach a dialog or menu.
  const clear = () => {
    onChange('');
    input.current?.focus();
  };
  return (
    <div className={`analytics-search${fullWidth ? ' full-width' : ''}`}>
      <Search aria-hidden="true" size={14} />
      <Input
        ref={input}
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key !== 'Escape' || !value) return;
          event.stopPropagation();
          clear();
        }}
      />
      {value && (
        <Button type="button" variant="ghost" size="icon-xs" className="analytics-search-clear" aria-label={l('Clear search', 'Limpar busca')}
          onMouseDown={(event) => event.preventDefault()} onClick={clear}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export function PrimaryMenuActions({
  action,
  label,
  children,
}: {
  action: ReactNode;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="analytics-action-group">
      {action}
      {children && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="analytics-action-menu"
                aria-label={label}
              />
            }
          >
            <EllipsisVertical size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="analytics-menu">
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
export function useCopy() {
  const { locale } = useI18n();
  return (en: string, pt: string) => (locale === 'pt-BR' ? pt : en);
}
export function useNumbers() {
  const { locale: language } = useI18n();
  return {
    locale: numberLocale(language),
    number: (value: number, digits = 0) => formatNumber(language, value, digits),
    percent: (value: number, digits = 1) => formatPercent(language, value, digits),
  };
}
/**
 * Table/toolbar filter. Multi-select by default (OR within the dimension); pass
 * `multiple={false}` for exclusive modes (cited/consulted, brand view, …).
 * Values are a single id or comma-separated ids; `all` / '' means no filter.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  icon,
  disabled,
  multiple = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** `disabled` on a choice that contradicts another active filter (single choice only). */
  options: { value: string; label: string; disabled?: boolean }[];
  icon?: ReactNode;
  disabled?: boolean;
  multiple?: boolean;
}) {
  const choices = options.filter((option) => option.value !== 'all');
  // One choice: the filter bar's own trigger and menu (as the models and brands filters), never a form's select box.
  if (!multiple) {
    const current = options.find((option) => option.value === value) ?? options[0];
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <FilterTrigger
              reserve={longestLabel(options.map((option) => option.label))}
              aria-label={`${label}: ${current?.label ?? ''}`}
            />
          }
        >
          {icon ?? <ListFilter className="filter-compact-icon" />}
          <span className="min-w-0 truncate">{current?.label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="bottom"
          sideOffset={6}
          className="analytics-menu"
        >
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const selected = !value || value === 'all' ? 'all' : value.split(',').filter(Boolean);
  return (
    <MultiFilter
      label={label}
      value={selected}
      onChange={(next) => {
        if (disabled) return;
        // From "All", the first click picks that option (it would otherwise uncheck it); later clicks add to it.
        if (selected === 'all' && Array.isArray(next) && next.length === choices.length - 1) {
          const kept = next;
          next = choices.filter((option) => !kept.includes(option.value)).map((option) => option.value);
        }
        if (next === 'all' || (Array.isArray(next) && next.length === choices.length)) onChange('all');
        else if (Array.isArray(next)) onChange(next.join(','));
        else onChange(next);
      }}
      options={choices}
      icon={icon ?? <ListFilter className="filter-compact-icon" />}
    />
  );
}
/** OR within this dimension; other dimensions continue to intersect. */
export function MultiFilter({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: FilterSelection;
  onChange: (value: FilterSelection) => void;
  options: { value: string; label: string }[];
  icon?: ReactNode;
}) {
  const l = useCopy();
  const { number } = useNumbers();
  const selected =
    value === 'all'
      ? options.map((option) => option.value)
      : filterValues(value);
  const summary =
    value === 'all'
      ? l('All', 'Todos')
      : selected.length === 0
        ? l('None', 'Nenhum')
        : selected.length === 1
          ? (options.find((option) => option.value === selected[0])?.label ??
            selected[0])
          : number(selected.length);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <FilterTrigger
            aria-label={label}
            className="multi-filter-trigger"
          />
        }
      >
        {icon}
        <span>
          {label}: {summary}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        sideOffset={6}
        className="analytics-menu multi-filter-menu"
      >
        <div className="menu-caption">
          {l('Match any selected option', 'Corresponder a qualquer opção')}
        </div>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            closeOnClick={false}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...new Set([...selected, option.value])]
                  : selected.filter((item) => item !== option.value),
              )
            }
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem closeOnClick={false} onClick={() => onChange('all')}>
          {l('Select all', 'Selecionar todos')}
        </DropdownMenuItem>
        <DropdownMenuItem closeOnClick={false} onClick={() => onChange([])}>
          {l('Clear selection', 'Limpar seleção')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SiteFaviconContext = createContext<Record<string, string>>({});
export function SiteFaviconProvider({
  favicons,
  children,
}: {
  favicons: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <SiteFaviconContext.Provider value={favicons}>
      {children}
    </SiteFaviconContext.Provider>
  );
}

/**
 * Where SiteFavicon reads a host's icon: our server (the app's `/api/favicon`, the public demo's `/api/demo/favicon`: the brand's
 * own site, then Google as a last resort, kept in our bucket and in the browser for 30 days). Without one (outside the app),
 * Google in the browser.
 */
const FaviconRouteContext = createContext<((host: string) => string) | null>(null);
export function FaviconRouteProvider({
  value,
  children,
}: {
  value: ((host: string) => string) | null;
  children: ReactNode;
}) {
  return (
    <FaviconRouteContext.Provider value={value}>
      {children}
    </FaviconRouteContext.Provider>
  );
}

/**
 * The icon sources this page has already loaded. Each SiteFavicon kept its own "loaded" flag and fetched lazily, so a brand's icon far
 * below the screen (a phone's long list) showed its initial while the same icon was already drawn above it. A source loaded once is
 * drawn everywhere, from the browser's cache: the icons already on screen with it are told (a store they subscribe to), not only the
 * ones drawn after (a row rendered while the first copy was still downloading kept its initial).
 */
const loadedFavicons = new Set<string>();
const faviconListeners = new Set<() => void>();
const subscribeFavicons = (listener: () => void) => {
  faviconListeners.add(listener);
  return () => void faviconListeners.delete(listener);
};
function markFaviconLoaded(source: string) {
  if (loadedFavicons.has(source)) return;
  loadedFavicons.add(source);
  for (const listener of faviconListeners) listener();
}

export function SiteFavicon({
  domain,
  name,
  className = '',
  title,
}: {
  domain: string;
  name?: string;
  className?: string;
  /** Marks an icon whose domain nobody confirmed. */
  title?: string;
}) {
  const favicons = useContext(SiteFaviconContext);
  const route = useContext(FaviconRouteContext);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const host = domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase();
  const local = favicons[host];
  const source =
    local ??
    route?.(host) ??
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  const valid = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host);
  // Another copy of this icon loaded (now or before): this one draws it too.
  const known = useSyncExternalStore(subscribeFavicons, () => loadedFavicons.has(source), () => false);
  const initial = (name || host).slice(0, 1).toUpperCase();
  const hint = (icon: ReactElement) => (title ? <Hint text={title}>{icon}</Hint> : icon);
  if (!valid || failedSource === source) {
    return hint(
      <span aria-hidden="true" className={`site-favicon ${className}`}>
        {initial}
      </span>
    );
  }
  const image = (props: { className?: string; ref?: (image: HTMLImageElement | null) => void; onLoad?: () => void }) => (
    // Favicons render directly, without a surrounding box or background.
    // eslint-disable-next-line next/no-img-element
    <img
      {...props}
      src={source}
      width={18}
      height={18}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      // Never on the render path: decoded off the main thread, fetched when near the viewport (at once when this page already
      // has it); a failure draws the initial.
      loading={known ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailedSource(source)}
    />
  );
  // A local asset (the public site's mock) is there at once, also without JavaScript.
  if (local) return hint(image({ className: `site-favicon ${className}` }));
  // Never blank: the initial, pulsing, holds the place while the icon is on its way; the icon replaces it once it has loaded.
  const loaded = known || loadedSource === source;
  const settle = () => {
    markFaviconLoaded(source);
    setLoadedSource(source);
  };
  return hint(
    <span aria-hidden="true" className={`site-favicon ${className}`} data-state={loaded ? 'loaded' : 'loading'}>
      {!loaded && initial}
      {image({
        // An icon the browser already had may finish before React listens.
        ref: (element) => {
          if (element?.complete && element.naturalWidth > 0 && !loaded) settle();
        },
        onLoad: settle,
      })}
    </span>
  );
}
/**
 * A product card's picture (Products): fixed size, loaded by the browser when near the screen and without a referrer, as
 * the favicons are (the server never fetches it); a neutral box when the card had none or it fails to load. `alt` is
 * empty where the product's name is written beside it.
 */
export function ProductThumb({ src, alt = '', large = false }: { src: string | null; alt?: string; large?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const box = `flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background text-muted-foreground ${large ? 'size-14' : 'size-8'}`;
  if (!src || failed === src)
    return (
      <span className={box} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
        <Package className={large ? 'size-6' : 'size-4'} aria-hidden="true" />
      </span>
    );
  return (
    <span className={box}>
      {/* eslint-disable-next-line next/no-img-element */}
      <img src={src} alt={alt} width={large ? 56 : 32} height={large ? 56 : 32} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-contain" onError={() => setFailed(src)} />
    </span>
  );
}
export function BrandMark({
  brand,
  small = false,
}: {
  brand: Pick<DemoBrand, 'initial' | 'id'> &
    Partial<Pick<DemoBrand, 'domain' | 'name'>>;
  small?: boolean;
}) {
  const identity = demoBrands.find((b) => b.id === brand.id);
  return (
    <SiteFavicon
      domain={brand.domain ?? identity?.domain ?? ''}
      name={brand.name ?? identity?.name ?? brand.initial}
      className={`brand-mark ${small ? 'small' : ''}`}
    />
  );
}
const modelIcons: Record<DemoModel, string> = {
  ChatGPT: 'openai',
  Perplexity: 'perplexity-color',
  Gemini: 'gemini-color',
  Claude: 'claude-color',
  'AI Overview': 'google-color',
};
export function ModelMark({
  model,
  label = true,
  truncate = false,
}: {
  model: string;
  label?: boolean;
  /** In a single-line cell: the name ends in an ellipsis where the cell does (the logo stays whole). */
  truncate?: boolean;
}) {
  return (
    <span className={truncate ? 'inline-flex max-w-full min-w-0 items-center gap-2' : 'inline-flex items-center gap-2'}>
      {/* Local, tiny SVG identity assets do not require image optimization. */}
      {/* eslint-disable-next-line next/no-img-element */}
      <img
        src={`/icons/ai/${isEngine(model) ? ENGINE_META[model].icon : (modelIcons[model as DemoModel] ?? 'google-color')}.svg`}
        alt={label ? '' : model}
        width={17}
        height={17}
        className="ai-icon shrink-0"
      />
      {label && <span className={truncate ? 'min-w-0 truncate' : undefined}>{isEngine(model) ? ENGINE_LABELS[model] : model}</span>}
    </span>
  );
}
/**
 * The comparison the header chose (date-range.ts): `dates` names the compared days, `custom` whether they were chosen. Off, no
 * period change is shown anywhere. Outside the app (catalog, site) there is none: the period right before, unnamed.
 */
export const ComparisonContext = createContext<{ off: boolean; custom: boolean; dates: string } | null>(null);
/** The comparison's copy; the app, which provides the context, uses it directly. */
export function comparisonCopy(l: (en: string, pt: string) => string, value: { off: boolean; custom: boolean; dates: string } | null) {
  return {
    off: value?.off ?? false,
    /** A change's tooltip: what it compares with. */
    title: value ? l(`Compared with ${value.dates}`, `Comparado a ${value.dates}`) : undefined,
    /** The compared period inside a sentence: "in {period}" / "no {period}". */
    period: value?.custom
      ? l(`the comparison period (${value.dates})`, `período de comparação (${value.dates})`)
      : l('the previous period of the same length', 'período anterior de igual duração'),
  };
}
/** `l`: the caller's own translator, when it has one (a screen given `t`). */
export function useComparison(l?: (en: string, pt: string) => string) {
  const copy = useCopy();
  return comparisonCopy(l ?? copy, useContext(ComparisonContext));
}

export function Change({ value, unit = '', locale, invert = false, period = true, margin = MARGIN_OF_ERROR }: { value: number; /** Appended to the figure, for example " pp". */ unit?: string; /** Number format of a caller that does not read the app's language. */ locale?: string; /** Lower is better (a position): the arrow follows the figure, the colour and the announcement follow the meaning. */ invert?: boolean; /** False: not the header's period comparison (a Semantic Branding round against the one before). */ period?: boolean; /** A change smaller than this is within the margin of error: neutral, never green or red. MARGIN_OF_ERROR by default, a position's change too; 0 for a count. */ margin?: number }) {
  const { number } = useNumbers();
  const l = useCopy();
  const comparison = useComparison();
  if (period && comparison.off) return null;
  const shown = locale ? formatNumber(locale, Math.abs(value), 1) : number(Math.abs(value), 1);
  // A change that rounds to zero is no change: neutral, never an arrow up.
  const flat = Math.round(Math.abs(value) * 10) === 0;
  const Icon = flat ? ArrowRight : value > 0 ? ArrowUpRight : ArrowDownRight;
  const good = invert ? value <= 0 : value >= 0;
  const within = !flat && withinMargin(value, margin);
  return (
    <Hint text={period ? comparison.title : undefined}>
    <span className={`metric-change ${flat || within ? 'neutral' : good ? 'positive' : 'negative'}`}>
      <Icon size={12} aria-hidden="true" />
      {shown}
      {unit}
      <span className="sr-only">
        {flat ? l('no change', 'sem variação') : good ? l('increase', 'aumento') : l('decrease', 'queda')}
        {within ? l(', within the margin of error', ', dentro da margem de erro') : ''}
        {period && comparison.title ? `, ${comparison.title}` : ''}
      </span>
    </span>
    </Hint>
  );
}
/** A list cell's figure with its change beside it (a `Change`, or nothing when there is no comparison), one text step smaller. */
export function WithChange({ children, change }: { children: ReactNode; change?: ReactNode }) {
  return change ? <span className="with-change inline-flex items-center justify-end gap-2">{children}{change}</span> : children;
}
// The only empty, unavailable, error and in-progress state (docs/design/shell.md section 9), on the catalog's Empty.
// `frame`: `card` is a card of its own, `bare` sits inside a SectionCard, `inline` is a short state in a list or a panel.
// `onRetry` draws the one retry button of the app; an error always shows CircleAlert.
/** The one retry wording of the app (EmptyState's button, a toast's or a strip's action): docs/design/shell.md section 9. */
export const RETRY_LABEL = ['Try again', 'Tentar novamente'] as const;

const emptyStateVariants = cva('analytics-empty rounded-none border-0', {
  variants: {
    frame: { card: 'analytics-panel py-12', bare: 'py-12', inline: 'py-6' },
    tone: { empty: '', error: '', progress: '' },
  },
  defaultVariants: { frame: 'card', tone: 'empty' },
});

export function EmptyState({
  title,
  description,
  action,
  tone = 'empty',
  frame,
  onRetry,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'empty' | 'error' | 'progress';
  frame?: 'card' | 'bare' | 'inline';
  /** In place of the tone's icon (a screen's own: the agent on a plan without it). */
  icon?: LucideIcon;
  onRetry?: () => void;
}) {
  const Icon = icon ?? (tone === 'error' ? CircleAlert : tone === 'progress' ? LoaderCircle : SearchX);
  return (
    <Empty
      className={emptyStateVariants({ frame: frame ?? 'card', tone })}
      role={tone === 'error' ? 'alert' : tone === 'progress' ? 'status' : undefined}
    >
      <EmptyHeader>
        <EmptyMedia className="mb-0 text-muted-foreground">
          <Icon size={16} aria-hidden="true" className={tone === 'progress' ? 'motion-safe:animate-spin' : undefined} />
        </EmptyMedia>
        <EmptyTitle className="text-body font-(--weight-label)">{title}</EmptyTitle>
        {description && <EmptyDescription className="text-body">{description}</EmptyDescription>}
      </EmptyHeader>
      {(action || onRetry) && (
        <EmptyContent>
          {action}
          {onRetry && <RetryButton onClick={onRetry} />}
        </EmptyContent>
      )}
    </Empty>
  );
}

/** The one retry action (its wording lives only here): in EmptyState, and beside an error note (the chat's). */
export function RetryButton({ onClick }: { onClick: () => void }) {
  const l = useCopy();
  return (
    <Button variant="outline" onClick={onClick}>
      {l(...RETRY_LABEL)}
    </Button>
  );
}

/** A brand in a table or list: its favicon and name, your brand in the strong weight (no "You" label, which broke the line). */
export function BrandName({ name, domain, own }: { name: string; domain: string; own: boolean }) {
  return (
    <span className="flex min-w-0 max-w-full items-center gap-2">
      <SiteFavicon domain={domain} name={name} />
      <span className={`min-w-0 truncate${own ? ' font-(--weight-strong)' : ''}`}>{name}</span>
    </span>
  );
}

export function collectionWindow<T>(
  items: T[],
  requestedPage: number,
  pageSize = 25,
) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.max(1, Math.min(requestedPage, pages));
  const offset = (page - 1) * pageSize;
  return { rows: items.slice(offset, offset + pageSize), offset, page, pages };
}
export function useCollectionPage<T>(
  items: T[],
  scope: string,
  pageSize = 25,
  translate?: (en: string, pt: string) => string,
  label = '',
  controlled?: { page: number; onPage: (page: number) => void },
) {
  const defaultCopy = useCopy();
  const { number } = useNumbers();
  const copy = translate ?? defaultCopy;
  const [state, setState] = useState({ scope, page: 1 });
  useEffect(() => {
    if (state.scope === scope || state.page === 1) return;
    queueMicrotask(() => setState({ scope, page: 1 }));
  }, [scope, state.scope, state.page]);
  const window = collectionWindow(
    items,
    controlled?.page ?? (state.scope === scope ? state.page : 1),
    pageSize,
  );
  const { page, pages } = window;
  return {
    ...window,
    controls: (
      <CollectionPagination
        page={page}
        pages={pages}
        total={items.length}
        onPrevious={() =>
          controlled
            ? controlled.onPage(page - 1)
            : setState({ scope, page: page - 1 })
        }
        onNext={() =>
          controlled
            ? controlled.onPage(page + 1)
            : setState({ scope, page: page + 1 })
        }
        onPage={(page) => controlled ? controlled.onPage(page) : setState({ scope, page })}
        previousLabel={copy('Previous', 'Anterior')}
        nextLabel={copy('Next', 'Próxima')}
        label={`${label ? `${label}, ` : ''}${copy('Page', 'Página')} ${number(page)} / ${number(pages)}, ${number(items.length)} ${copy('items', 'itens')}`}
      />
    ),
  };
}
/**
 * `useCollectionPage` for a sortable table: orders the whole list by the clicked column (`sortValue`s keyed
 * by column) before slicing the page, and goes back to page 1 when the order changes. Spread `sort` and
 * `onSortChange` onto the `DataTable`.
 */
export function useSortedPage<T>(
  items: T[],
  sortValues: Record<string, (row: T) => string | number | null | undefined>,
  scope: string,
  pageSize = 25,
  translate?: (en: string, pt: string) => string,
  label = '',
) {
  const [sort, onSortChange] = useState<DataSort>();
  const ordered = sortRows(items, Object.entries(sortValues).map(([key, sortValue]) => ({ key, sortValue })), sort);
  const page = useCollectionPage(ordered, `${scope}|${sort?.key}|${sort?.direction}`, pageSize, translate, label);
  return { ...page, sort, onSortChange };
}
/** The pager of a sorted list (useSortedPage) in its table's Summary row, as Brands and Opportunities show it. */
export function SummaryPager({ page, total, t }: { page: ReturnType<typeof useCollectionPage>; total: number; t: (en: string, pt: string) => string }) {
  const { number } = useNumbers();
  const [from, to] = [page.offset + 1, page.offset + page.rows.length];
  return (
    <CompactPagination
      {...page.controls.props}
      from={from}
      to={to}
      total={total}
      page={page.page}
      pages={page.pages}
      previousLabel={t('Previous page', 'Página anterior')}
      nextLabel={t('Next page', 'Próxima página')}
      pageLabel={t('Page', 'Página')}
      rangeLabel={t(`${number(from)} to ${number(to)} of ${number(total)}`, `${number(from)} a ${number(to)} de ${number(total)}`)}
    />
  );
}
/** Compact range + page select + arrows for a sticky Summary row ("1 to 25 of 100" / "1 a 25 de 100"). */
export function CompactPagination({
  from,
  to,
  total,
  page,
  pages,
  onPrevious,
  onNext,
  onPage,
  previousLabel,
  nextLabel,
  pageLabel,
  label,
  rangeLabel,
}: {
  from: number;
  to: number;
  total: number;
  page: number;
  pages: number;
  onPrevious: () => void;
  onNext: () => void;
  onPage?: (page: number) => void;
  previousLabel: string;
  nextLabel: string;
  /** Accessible name for the page picker (the app's Select; defaults to the pager's label). */
  pageLabel?: string;
  label: string;
  /** Pre-built "1 a 25 de 100" / "1 to 25 of 100". */
  rangeLabel: string;
}) {
  if (total === 0 || from > to) return null;
  return (
    <nav className="compact-pagination inline-flex items-center gap-0.5" aria-label={label}>
      <span className="px-1 text-caption tabular-nums text-muted-foreground whitespace-nowrap" aria-live="polite">
        {rangeLabel}
      </span>
      {onPage && pages > 1 ? (
        <Select value={String(page)} onValueChange={(value) => value !== null && onPage(Number(value))}>
          <SelectTrigger className="compact-pagination-page" aria-label={pageLabel ?? label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" side="top" sideOffset={4} alignItemWithTrigger={false}>
            {Array.from({ length: pages }, (_, index) => String(index + 1)).map((number) => (
              <SelectItem key={number} value={number} className="tabular-nums">
                {number}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={page <= 1}
        aria-label={previousLabel}
        onClick={onPrevious}
      >
        <ChevronLeft size={14} aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={page >= pages}
        aria-label={nextLabel}
        onClick={onNext}
      >
        <ChevronRight size={14} aria-hidden="true" />
      </Button>
    </nav>
  );
}

export function CollectionPagination({
  page,
  pages,
  total,
  onPrevious,
  onNext,
  onPage,
  selectablePages,
  previousLabel,
  nextLabel,
  label,
  busy = false,
}: {
  page: number;
  pages?: number;
  selectablePages?: number;
  total?: number;
  onPrevious: () => void;
  onNext: () => void;
  onPage?: (page: number) => void;
  previousLabel: string;
  nextLabel: string;
  label: string;
  busy?: boolean;
}) {
  const copy = useCopy();
  const lastPage = selectablePages ?? pages ?? page;
  const pageNumbers = [...new Set([1, page - 1, page, page + 1, lastPage])]
    .filter((number) => number >= 1 && number <= lastPage)
    .sort((a, b) => a - b)
    .flatMap((number, index, numbers) =>
      index > 0 && number - numbers[index - 1]! === 2
        ? [number - 1, number]
        : [number],
    );
  if (total === 0) return null;
  return (
    <nav
      className="collection-pagination flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-caption"
      aria-label={label}
    >
      <span aria-live="polite">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={busy || page <= 1}
          onClick={onPrevious}
        >
          {previousLabel}
        </Button>
        {onPage && (
          <PaginationContent>
            {pageNumbers.map((number, index) => (
              <PaginationItem key={number} className="flex items-center">
                {index > 0 && number - pageNumbers[index - 1]! > 1 && <PaginationEllipsis />}
                <PaginationLink
                  href="#"
                  isActive={number === page}
                  aria-label={`${copy('Page', 'Página')} ${number}`}
                  aria-disabled={busy || undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!busy) onPage(number);
                  }}
                >
                  {number}
                </PaginationLink>
              </PaginationItem>
            ))}
          </PaginationContent>
        )}
        <Button
          variant="outline"
          disabled={busy || (pages != null && page >= pages)}
          onClick={onNext}
        >
          {nextLabel}
        </Button>
      </div>
    </nav>
  );
}

/** The longest of the labels a filter shows, so its trigger keeps one width whatever is chosen. */
export const longestLabel = (labels: string[]) => labels.reduce((longest, label) => (label.length > longest.length ? label : longest), '');

/**
 * A top-bar filter over names (topics, tags), the selection summed up on the trigger like the models': any number checked,
 * up to `max`; `value` joins them with `separator` and none checked means all.
 */
export function NamesFilter({ icon, names, value, separator, max, onChange, label, count }: { icon: ReactNode; names: string[]; value: string; separator: string; max: number; onChange: (value: string) => void; label: string; count: (n: number) => string }) {
  const selected = value ? value.split(separator) : [];
  const listed = selected.join(', ');
  const summary = !selected.length ? label : selected.length === 1 ? selected[0] : count(selected.length);
  return (
    <DropdownMenu>
      {/* The width of the summaries only: a name can take 40 characters and would push the header to two lines; one selected
          name truncates, whole in its title. */}
      <DropdownMenuTrigger render={<FilterTrigger aria-label={`${label}: ${listed || label}`} title={listed || undefined} reserve={longestLabel([label, count(names.length)])} />}>
        {icon}
        <span className="min-w-0 truncate">{summary}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="analytics-menu">
        {names.map((name) => {
          const checked = selected.includes(name);
          return (
            <DropdownMenuCheckboxItem
              key={name}
              checked={checked}
              disabled={!checked && selected.length >= max}
              closeOnClick={false}
              onCheckedChange={(next) => onChange((next ? [...selected, name] : selected.filter((item) => item !== name)).join(separator))}
            >
              {name}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onChange('')}>{label}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

