'use client';
import { createContext, useContext,
  useEffect,
  useState, type ReactNode,
} from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  SearchX,
  Cpu,
  ChevronDown,
  Search,
  EllipsisVertical,
} from 'lucide-react';
import { ENGINE_META, ENGINE_LABELS, isEngine } from '@/lib/engines';
import { useI18n } from '@/lib/i18n';
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
  demoModels,
  type DemoBrand,
  type DemoModel,
} from './demo-data';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { FocusEvent } from 'react';

export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  fullWidth = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={`analytics-search${fullWidth ? ' full-width' : ''}`}>
      <Search aria-hidden="true" size={14} />
      <Input
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function CollectionToolbar({
  children,
  actions,
  className = '',
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const revealFocusedControl = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const container = event.currentTarget;
    const bounds = container.getBoundingClientRect();
    const focused = target.getBoundingClientRect();
    if (focused.left < bounds.left)
      container.scrollLeft += focused.left - bounds.left;
    else if (focused.right > bounds.right)
      container.scrollLeft += focused.right - bounds.right;
  };

  return (
    <div className={`analytics-collection-toolbar ${className}`}>
      <div
        onFocusCapture={revealFocusedControl}
        className="analytics-collection-controls"
      >
        {children}
      </div>
      {actions && <div className="analytics-collection-actions">{actions}</div>}
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
  const locale = language === 'pt-BR' ? 'pt-BR' : 'en-US';
  const number = (value: number, digits = 0) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  return {
    locale,
    number,
    percent: (value: number, digits = 1) => `${number(value, digits)}%`,
  };
}
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  icon,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Select
      disabled={disabled}
      value={value}
      onValueChange={(v) => v !== null && onChange(v)}
      items={options}
    >
      <SelectTrigger aria-label={label} className="bg-background text-sm">
        {icon}
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="start"
        side="bottom"
        sideOffset={6}
        alignItemWithTrigger={false}
        className="analytics-menu"
      >
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
          : String(selected.length);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            aria-label={label}
            className="multi-filter-trigger"
          />
        }
      >
        {icon}
        <span>
          {label}: {summary}
        </span>
        <ChevronDown />
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

export function ModelFilter({
  value,
  onChange,
}: {
  value: DemoModel[];
  onChange: (models: DemoModel[]) => void;
}) {
  const l = useCopy();
  const { number } = useNumbers();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            aria-label={l('AI models', 'Modelos de IA')}
            className="model-filter-trigger"
          />
        }
      >
        <Cpu />
        {value.length === demoModels.length
          ? l('All models', 'Todos os modelos')
          : value.length === 1
            ? value[0]
            : value.length === 0
              ? l('No models', 'Nenhum modelo')
              : l(
                  `${number(value.length)} models`,
                  `${number(value.length)} modelos`,
                )}
        <ChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="bottom"
        sideOffset={6}
        className="analytics-menu model-filter-menu"
      >
        <div className="menu-caption">
          {l('Include in analysis', 'Incluir na análise')}
        </div>
        {demoModels.map((model) => (
          <DropdownMenuCheckboxItem
            key={model}
            checked={value.includes(model)}
            closeOnClick={false}
            onCheckedChange={(checked) =>
              onChange(
                demoModels.filter((m) =>
                  m === model ? checked : value.includes(m),
                ),
              )
            }
          >
            <ModelMark model={model} />
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          closeOnClick={false}
          onClick={() =>
            onChange(value.length === demoModels.length ? [] : [...demoModels])
          }
        >
          {value.length === demoModels.length
            ? l('Clear selection', 'Limpar seleção')
            : l('Select all models', 'Selecionar todos os modelos')}
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

export function SiteFavicon({
  domain,
  name,
  className = '',
}: {
  domain: string;
  name?: string;
  className?: string;
}) {
  const favicons = useContext(SiteFaviconContext);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const host = domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase();
  const source =
    favicons[host] ??
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  const valid = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(host);
  if (!valid || failedSource === source) {
    return (
      <span aria-hidden="true" className={`site-favicon ${className}`}>
        {(name || host).slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // Favicons render directly, without a surrounding box or background.
    // eslint-disable-next-line next/no-img-element
    <img
      className={`site-favicon ${className}`}
      src={source}
      width={18}
      height={18}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      onError={() => setFailedSource(source)}
    />
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
}: {
  model: string;
  label?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* Local, tiny SVG identity assets do not require image optimization. */}
      {/* eslint-disable-next-line next/no-img-element */}
      <img
        src={`/icons/ai/${isEngine(model) ? ENGINE_META[model].icon : (modelIcons[model as DemoModel] ?? 'google-color')}.svg`}
        alt={label ? '' : model}
        width={17}
        height={17}
      />
      {label && <span>{isEngine(model) ? ENGINE_LABELS[model] : model}</span>}
    </span>
  );
}
export function Change({ value }: { value: number }) {
  const { number } = useNumbers();
  const l = useCopy();
  const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`metric-change ${value >= 0 ? 'positive' : 'negative'}`}>
      <Icon size={13} />
      {number(Math.abs(value), 1)}
      <span className="sr-only">
        {value >= 0 ? l('increase', 'aumento') : l('decrease', 'queda')}
      </span>
    </span>
  );
}
export function PanelHeading({
  title,
  description,
  action,
  onAction,
}: {
  title: string;
  description?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {onAction && (
        <Button variant="ghost" size="sm" onClick={onAction}>
          {action}
          <ChevronRight size={14} />
        </Button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="analytics-empty">
      <SearchX size={24} />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
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
        previousLabel={copy('Previous', 'Anterior')}
        nextLabel={copy('Next', 'Próxima')}
        label={`${label ? `${label} · ` : ''}${copy('Page', 'Página')} ${page} / ${pages} · ${items.length} ${copy('items', 'itens')}`}
      />
    ),
  };
}
export function CollectionPagination({
  page,
  pages,
  total,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  label,
  busy = false,
}: {
  page: number;
  pages?: number;
  total?: number;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel: string;
  nextLabel: string;
  label: string;
  busy?: boolean;
}) {
  if (total === 0) return null;
  return (
    <nav
      className="collection-pagination flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm"
      aria-label={label}
    >
      <span aria-live="polite">{label}</span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || page <= 1}
          onClick={onPrevious}
        >
          {previousLabel}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || (pages != null && page >= pages)}
          onClick={onNext}
        >
          {nextLabel}
        </Button>
      </div>
    </nav>
  );
}

export function TopicFilter({ topics, value, onChange, label }: { topics: { id: string; name: string }[]; value: string; onChange: (value: string) => void; label: string }) {
  return <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" aria-label={label} />}><ChevronDown size={14} />{value || label}</DropdownMenuTrigger><DropdownMenuContent className="analytics-menu"><DropdownMenuItem onClick={() => onChange('')}>{label}</DropdownMenuItem>{topics.map((topic) => <DropdownMenuItem key={topic.id} onClick={() => onChange(topic.name)}>{topic.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}

export function AnalyticsSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return <output aria-busy="true" aria-label={label} className="analytics-loading-skeleton"><span className="sr-only">{label}</span><div className="skeleton-heading" />{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><i /><i /><i /></div>)}</output>;
}
