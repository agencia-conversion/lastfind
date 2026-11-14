// Deterministic, synthetic fixtures. This module never talks to the monitoring API.
import {
  dateKey,
  DEMO_TODAY,
  getDateRange,
  parseISODate,
} from './date-range.ts';

export type DemoModel =
  | 'ChatGPT'
  | 'Perplexity'
  | 'Gemini'
  | 'Claude'
  | 'AI Overview';
export type DemoStatus = 'active' | 'suggested' | 'inactive' | 'archived';
export type DemoPrompt = {
  id: string;
  text: string;
  topic: string;
  tags: string[];
  country: string;
  status: DemoStatus;
};
export type FilterSelection = string | string[];

/** Legacy singleton values remain readable; arrays express OR, [] means none. */
export function filterValues(value: FilterSelection): string[] {
  return Array.isArray(value) ? value : value === 'all' ? [] : [value];
}
export function matchesSelection(
  selection: FilterSelection,
  values: string | string[],
) {
  return (
    selection === 'all' ||
    filterValues(selection).some((value) =>
      (Array.isArray(values) ? values : [values]).includes(value),
    )
  );
}
export function promptMatchesFilters(prompt: DemoPrompt, filters: DemoFilters) {
  return (
    matchesSelection(filters.country, prompt.country) &&
    matchesSelection(filters.topic, prompt.topic) &&
    (filters.tagMode === 'all' && filters.tag !== 'all'
      ? filterValues(filters.tag).length > 0 &&
        filterValues(filters.tag).every((tag) => prompt.tags.includes(tag))
      : matchesSelection(filters.tag, prompt.tags))
  );
}
export function filterLabel(selection: FilterSelection): string {
  return Array.isArray(selection) ? selection.join(' | ') || 'none' : selection;
}

export type DemoFilters = {
  days: string;
  from?: string;
  to?: string;
  models: DemoModel[];
  country: FilterSelection;
  topic: FilterSelection;
  tag: FilterSelection;
  tagMode?: 'any' | 'all';
};
export const defaultFilters: DemoFilters = {
  days: '28',
  models: ['ChatGPT', 'Perplexity', 'Gemini', 'Claude', 'AI Overview'],
  country: 'all',
  topic: 'all',
  tag: 'all',
};
export const demoModels: DemoModel[] = [
  'ChatGPT',
  'Perplexity',
  'Gemini',
  'Claude',
  'AI Overview',
];
export const demoTopics = ['SEO agencies', 'AI search', 'Content strategy'];
export const demoBrands = [
  {
    id: 'conversion',
    name: 'Conversion',
    domain: 'conversion.com.br',
    initial: 'c',
    color: '#1649FF',
  },
  {
    id: 'mestre',
    name: 'Agência Mestre',
    domain: 'agenciamestre.com',
    initial: 'm',
    color: '#0D9488',
  },
  {
    id: 'np',
    name: 'NP Digital',
    domain: 'npdigital.com',
    initial: 'NP',
    color: '#8B5CF6',
  },
  {
    id: 'cadastra',
    name: 'Cadastra',
    domain: 'cadastra.com',
    initial: 'c.',
    color: '#D97706',
  },
  {
    id: 'v4',
    name: 'V4 Company',
    domain: 'v4company.com',
    initial: 'V4',
    color: '#DB5275',
  },
  {
    id: 'wsi',
    name: 'WSI',
    domain: 'wsiworld.com',
    initial: 'w',
    color: '#64748B',
  },
];
export type DemoBrand = (typeof demoBrands)[number];
export const demoPrompts: DemoPrompt[] = [
  {
    id: 'p1',
    text: 'What are the best SEO agencies in Brazil?',
    topic: 'SEO agencies',
    tags: ['Discovery', 'High intent'],
    country: 'Brazil',
    status: 'active',
  },
  {
    id: 'p2',
    text: 'Which SEO agency is best for enterprise companies?',
    topic: 'SEO agencies',
    tags: ['Comparison'],
    country: 'Brazil',
    status: 'active',
  },
  {
    id: 'p3',
    text: 'Which agencies help brands appear in AI search?',
    topic: 'AI search',
    tags: ['Discovery'],
    country: 'Brazil',
    status: 'active',
  },
  {
    id: 'p4',
    text: 'Who are the leading generative engine optimization agencies?',
    topic: 'AI search',
    tags: ['High intent'],
    country: 'United States',
    status: 'active',
  },
  {
    id: 'p5',
    text: 'What is the best agency for a data-driven content strategy?',
    topic: 'Content strategy',
    tags: ['Discovery'],
    country: 'Brazil',
    status: 'active',
  },
  {
    id: 'p6',
    text: 'Conversion vs Agência Mestre: which SEO agency should I choose?',
    topic: 'SEO agencies',
    tags: ['Comparison', 'Branded'],
    country: 'Brazil',
    status: 'active',
  },
  {
    id: 'p7',
    text: 'How do I choose a technical SEO partner?',
    topic: 'SEO agencies',
    tags: ['High intent'],
    country: 'United States',
    status: 'active',
  },
  {
    id: 'p8',
    text: 'Which agencies measure brand visibility in ChatGPT?',
    topic: 'AI search',
    tags: ['Discovery'],
    country: 'Brazil',
    status: 'active',
  },
  {
    id: 'p9',
    text: 'Best content marketing agencies for organic growth',
    topic: 'Content strategy',
    tags: ['High intent'],
    country: 'United States',
    status: 'active',
  },
  {
    id: 'p10',
    text: 'Which agencies publish original SEO research?',
    topic: 'Content strategy',
    tags: ['Discovery'],
    country: 'Brazil',
    status: 'active',
  },
  {
    id: 'p11',
    text: 'How can an agency improve my visibility in Perplexity?',
    topic: 'AI search',
    tags: ['Discovery'],
    country: 'Brazil',
    status: 'suggested',
  },
  {
    id: 'p12',
    text: 'What should an enterprise SEO audit include?',
    topic: 'SEO agencies',
    tags: ['High intent'],
    country: 'Brazil',
    status: 'suggested',
  },
  {
    id: 'p13',
    text: 'Which content agencies specialize in ecommerce?',
    topic: 'Content strategy',
    tags: ['Discovery'],
    country: 'United States',
    status: 'suggested',
  },
  {
    id: 'p14',
    text: 'How much does an SEO retainer cost in Brazil?',
    topic: 'SEO agencies',
    tags: ['High intent'],
    country: 'Brazil',
    status: 'inactive',
  },
  {
    id: 'p15',
    text: 'Which agencies offer link building services?',
    topic: 'SEO agencies',
    tags: ['Discovery'],
    country: 'Brazil',
    status: 'archived',
  },
];
export const demoSources = [
  {
    id: 's1',
    domain: 'clutch.co',
    initial: 'C',
    type: 'Editorial',
    title: 'Top SEO companies in Brazil',
    url: 'https://clutch.co/br/seo-firms',
  },
  {
    id: 's2',
    domain: 'conversion.com.br',
    initial: 'c',
    type: 'Corporate',
    title: 'SEO and AI search insights',
    url: 'https://www.conversion.com.br/blog/',
  },
  {
    id: 's3',
    domain: 'reddit.com',
    initial: 'r',
    type: 'Community',
    title: 'Choosing an SEO agency',
    url: 'https://www.reddit.com/r/SEO/',
  },
  {
    id: 's4',
    domain: 'searchenginejournal.com',
    initial: 'SEJ',
    type: 'Editorial',
    title: 'The future of organic search',
    url: 'https://www.searchenginejournal.com/seo/',
  },
  {
    id: 's5',
    domain: 'linkedin.com',
    initial: 'in',
    type: 'Community',
    title: 'SEO agency recommendations',
    url: 'https://www.linkedin.com/',
  },
  {
    id: 's6',
    domain: 'agenciamestre.com',
    initial: 'm',
    type: 'Corporate',
    title: 'SEO strategy and services',
    url: 'https://www.agenciamestre.com/',
  },
  {
    id: 's7',
    domain: 'wikipedia.org',
    initial: 'W',
    type: 'Reference',
    title: 'Search engine optimization',
    url: 'https://en.wikipedia.org/wiki/Search_engine_optimization',
  },
];
export type DemoSource = (typeof demoSources)[number];
export type DemoResponse = {
  id: string;
  promptId: string;
  date: string;
  model: DemoModel;
  brandIds: string[];
  sentiment: number;
  sourceIds: string[];
  consultedSourceIds: string[] | null;
};
const sourcePool = [
  's1',
  's1',
  's1',
  's1',
  's2',
  's2',
  's2',
  's3',
  's3',
  's3',
  's4',
  's4',
  's5',
  's5',
  's6',
  's7',
  's4',
];
export const demoResponses: DemoResponse[] = Array.from(
  { length: 56 },
  (_, day) =>
    demoPrompts
      .filter((p) => p.status === 'active')
      .flatMap((prompt, p) =>
        demoModels.map((model, m) => {
          const seed = day * 97 + p * 41 + m * 23;
          const brandIds = demoBrands
            .filter(
              (_, b) =>
                (seed * (b + 3) + b * 17) % 100 <
                [42 + day * 0.48, 55, 45, 34, 25, 16][b],
            )
            .map((b) => b.id);
          if (seed % 3 === 0) brandIds.reverse();
          return {
            id: `r-${day}-${p}-${m}`,
            promptId: prompt.id,
            date: new Date(Date.UTC(2026, 6, 16 + day, 7)).toISOString(),
            model,
            brandIds,
            sentiment: 72 + (seed % 25),
            sourceIds: [
              ...new Set([
                sourcePool[seed % sourcePool.length],
                sourcePool[(seed * 3 + 5) % sourcePool.length],
              ]),
            ],
            consultedSourceIds: m === 0 ? [`s${1 + ((seed + 3) % 7)}`] : null,
          };
        }),
      ),
).flat();
export const demoEnd = parseISODate(DEMO_TODAY)!.getTime();
export function selectResponses(
  prompts: DemoPrompt[],
  filters: DemoFilters,
  previous = false,
) {
  const range = getDateRange(filters);
  const end = previous ? range.start : range.end;
  const start = previous ? range.start - range.days * 86400000 : range.start;
  const ids = new Set(
    prompts
      .filter((p) => p.status === 'active' && promptMatchesFilters(p, filters))
      .map((p) => p.id),
  );
  return demoResponses.filter(
    (r) =>
      ids.has(r.promptId) &&
      Date.parse(r.date) >= start &&
      Date.parse(r.date) < end &&
      filters.models.includes(r.model),
  );
}
export function brandMetrics(responses: DemoResponse[], brandId: string) {
  const mentions = responses.filter((r) => r.brandIds.includes(brandId));
  return {
    mentions: mentions.length,
    visibility: responses.length
      ? (mentions.length / responses.length) * 100
      : 0,
    sentiment: mentions.length
      ? mentions.reduce((n, r) => n + r.sentiment, 0) / mentions.length
      : 0,
    position: mentions.length
      ? mentions.reduce((n, r) => n + r.brandIds.indexOf(brandId) + 1, 0) /
        mentions.length
      : 0,
  };
}
export function getDemoReport(prompts: DemoPrompt[], filters: DemoFilters) {
  const range = getDateRange(filters);
  const responses = selectResponses(prompts, filters);
  const previous = selectResponses(prompts, filters, true);
  const brands = demoBrands
    .map((brand) => ({
      ...brand,
      ...brandMetrics(responses, brand.id),
      change:
        brandMetrics(responses, brand.id).visibility -
        brandMetrics(previous, brand.id).visibility,
    }))
    .sort((a, b) => b.visibility - a.visibility);
  const trend = Array.from({ length: range.days }, (_, i) => {
    const date = dateKey(new Date(range.start + i * 86400000));
    const daily = responses.filter((r) => r.date.startsWith(date));
    return {
      date,
      ...Object.fromEntries(
        demoBrands.map((b) => [b.id, brandMetrics(daily, b.id).visibility]),
      ),
    };
  });
  return { responses, previous, brands, trend };
}
export type DemoReport = ReturnType<typeof getDemoReport>;
export function exportDemoCsv(filename: string, rows: (string | number)[][]) {
  const escape = (v: string | number) =>
    `"${String(v)
      .replace(/^\s*[=+@-]/, "'$&")
      .replaceAll('"', '""')}"`;
  const blob = new Blob(
    ['\uFEFF' + rows.map((row) => row.map(escape).join(',')).join('\r\n')],
    { type: 'text/csv;charset=utf-8' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
