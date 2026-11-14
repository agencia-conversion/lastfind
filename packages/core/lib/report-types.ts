import type { Citation, Engine, Run } from './types';
import type { DomainType, PageType, SourceOwner, PublicSourceTypeClassifier, SourceTypeKind, UNCLASSIFIED } from './source-types.ts';
/** Cached type of a cited domain or URL; `unclassified` means no result exists for the active evaluator. */
export type SourceTypeValue = DomainType | PageType | typeof UNCLASSIFIED;
export type Metrics = {
  responses: number;
  visibility: number;
  shareOfVoice: number;
  /** Valid answers that cite a domain registered for the selected brand. */
  citationPresence: number;
  /** Mean rank of the first textual brand mention; zero means unavailable. */
  mentionPosition: number;
  citedDomains: number;
  mentions: number;
  totalMentions: number;
  cost: number;
};
export type ReportDrilldown = {
  engine?: Engine | 'all';
  topic?: string;
  /** Comma-separated prompt tags, kept serializable for URL state. */
  tags?: string;
  prompt?: string;
  brand?: string;
  mention?: 'all' | 'mentioned' | 'missing';
  citation?: 'all' | 'missing-own';
  source?: string;
  sourceKind?: 'cited' | 'consulted';
  sourceGroup?: 'domain' | 'url';
  own?: '1';
  sourceQuery?: string;
  gap?: 'all' | 'competitor-only';
};
export type SummaryReport = {
  metrics: Metrics;
  /** The current period per model that answered in it; `null` is not measured in that model, never a zero. */
  channels?: {
    engine: Engine;
    visibility: number | null;
    shareOfVoice: number | null;
    citationPresence: number | null;
    mentionPosition: number | null;
  }[];
  /** The current period per topic (prompt tag) with answers in it; `null` is not measured there, never a zero. */
  topics?: {
    topic: string; responses: number; visibility: number | null; shareOfVoice: number | null;
    /** Among the monitored brands, by the topic's answers that name each; null when the brand is not named in the topic. */
    position?: number | null;
    /** The best placed other monitored brand named in the topic (the leader, or the runner-up when the brand leads). */
    rival?: { name: string; domain: string; visibility: number | null; shareOfVoice: number | null } | null;
  }[];
  /** Observed logical question × model combinations in each complete-answer cohort.
   * Repeated daily collections count once; these are not raw response counts. */
  samples: { current: number; previous: number };
  /** Per-metric sample sizes and availability. Zero is unavailable, not a measured zero. */
  availability: Record<
    'visibility' | 'shareOfVoice' | 'citationPresence' | 'mentionPosition',
    { current: number | null; previous: number | null }
  >;
  comparison: {
    previous: Metrics;
    /** Absolute differences. Visibility and share of voice use percentage points. */
    delta: Metrics;
    /** False when the effective target cohorts differ across the selected periods. */
    comparable: boolean;
    hasPreviousData: boolean;
    currentStart: string;
    previousStart: string;
    /** End of the comparison (exclusive): `currentStart` unless a comparison period was chosen (absent in older kept reports). */
    previousEnd?: string;
    end: string;
  };
  leaderboard: {
    name: string;
    domain: string;
    count: number;
    visibility: number;
    color: string;
  }[];
  /** `null` values (e.g. `sov`/`sovC{i}`) are a gap: no tracked brand had a
   *  mention that day, not a measured zero share. */
  /** Daily additive counts/sums support weighted UTC calendar buckets without answer text. */
  daily: Record<string, string | number | null>[];
};
export type AnalysisRow = {
  key: string;
  label: string;
  attempts: number;
  responses: number;
  mentions: number;
  visibility: number;
  /** Valid AI answers that mention another tracked brand but omit the selected brand. */
  opportunities: number;
  citationCoverage: number;
  consultedCoverage: number;
  pending: number;
  failed: number;
  noAnswer: number;
};
export type AnalysisReport = {
  channels: (AnalysisRow & { key: Engine })[];
  topics: AnalysisRow[];
  prompts: (AnalysisRow & { engine: Engine; topic: string })[];
  hasMoreTopics: boolean;
  hasMorePrompts: boolean;
};
/** Shared size of the server-paged competitor-only questions table. */
export const COMPETITOR_ONLY_PAGE = 10;
export type HistoryPage = { runs: Run[]; nextCursor: string | null };
export type PromptScore = { responses: number; mentions: number; visibility: number; totalMentions?: number; /** Mentions in the answers the brand analysis read: share of voice's numerator. */ voiceMentions?: number; shareOfVoice?: number | null; position?: number | null };
export type PromptReport = Record<string, {
  responses: number; mentions: number; visibility: number; totalMentions: number; voiceMentions?: number; shareOfVoice: number | null; pending: number; position?: number | null; positionSamples?: number; latest?: Run;
  /** Complete answers of the period that cite a domain of the selected brand. */
  cited?: number;
  /** The question's topic factor (lib/topic-weights): the Summary row weighs its counts by it. 1 without topic weights. */
  weight?: number;
  previous: PromptScore; delta: PromptScore; brands: string[];
  channels?: Partial<Record<Engine, { responses: number; mentions: number; visibility: number; position: number | null }>>;
}>;
export type PromptDetail = {
  metrics?: PromptScore & { position: number | null };
  /** Same prompt and filters over the previous period of equal length. */
  previous?: PromptScore & { position: number | null };
  hasMoreSources?: boolean;
  daily: { date: string; responses: number; mentions: number; visibility: number }[];
  platforms: {
    engine: Engine;
    responses: number;
    mentions: number;
    visibility: number;
    position?: number | null;
    /** Newest complete response of this model in the period, independent of the history page. */
    latestRunId?: string;
    latestAt?: string;
  }[];
  sources: { domain: string; responses: number }[];
  history: HistoryPage;
};
export type CompetitorMatrixRow = {
  name: string;
  domain: string;
  responses: number;
  mentions: number;
  visibility: number;
  shareOfVoice?: number | null;
  cells: Record<string, { responses: number; mentions: number; visibility: number }>;
  /** The comparison period; absent when the brand had no complete answer in it. */
  previous?: { responses: number; mentions: number; visibility: number; shareOfVoice: number | null };
};
export type CompetitorsReport = {
  hasMoreCompetitorOnly?: boolean;
  /**
   * Every brand the brand analysis discovered in the period's answers, by its group key (a merged name counts with the
   * brand it joined), under the report's filters: answers that mention it now and in the comparison, and whether share of
   * voice counts it (a settled competitor, not rejected). Empty until the analysis has stored each answer's discoveries.
   */
  discovered?: Record<string, { mentions: number; previous: number; counted: boolean; weightedMentions: number; weightedPrevious: number }>;
  /**
   * The period's complete answers and the mentions of every identified brand (share of voice's denominator), now and
   * before, real and topic-weighted (lib/topic-weights; the rates divide the weighted ones).
   */
  totals?: {
    responses: number; mentions: number; previousResponses: number; previousMentions: number;
    weightedResponses: number; weightedMentions: number; weightedPreviousResponses: number; weightedPreviousMentions: number;
    /** Answers the brand analysis read in each period (absent in reports kept before it). */
    analysed?: number; previousAnalysed?: number; weightedAnalysed?: number; weightedPreviousAnalysed?: number;
  };
  platforms: CompetitorMatrixRow[];
  topics: CompetitorMatrixRow[];
  competitorOnly: {
    prompt: string;
    label: string;
    responses: number;
    engine: Engine;
    topic: string
    engines?: Engine[];
    brands?: { name: string; domain: string; }[];
  }[];
};
export type SourceRow = {
  /** Mean score per semantic response, counted once even when it cites several pages of this domain. */
  averageScore?: number | null;
  key: string;
  domain: string;
  title: string;
  responses: number;
  /** Times the source is cited, counting repeats inside one response. */
  citations: number;
  pages: number;
  engines: Engine[];
  mentions: number;
  /** Prompt responses only; null when this source has no prompt mention measurement. */
  visibility: number | null;
  ownership: SourceOwner;
  /** Site type (domain grouping) or content type (URL grouping); ownership is a separate mark. */
  sourceType?: SourceTypeValue;
  /** URL grouping only: the type of the page's domain. */
  domainType?: SourceTypeValue;
  /** Whether any answer cited it; false means only consulted (`kind=all|uncited`). Absent on a consulted-only list without evidence. */
  cited?: boolean;
  /** Whether any answer consulted it (`kind=all|uncited`, or `evidence=1`); false is also a model that does not report consultations. */
  consulted?: boolean;
  presence?: SourcePresence;
  /**
   * The list's rows when asked (`change=1`): the presence in the comparison period, over the same combinations; 0 when its
   * answers never listed the source, null when it has no answer.
   */
  previousPresence?: number | null;
};
/** Version 1: each logical question × model is weighted by hits / eligible collections. */
export type SourcePresence = {
  presence: number;
  slots: number;
  questions: number;
  /** Stability counts require at least two collections of the combination. */
  steady: number;
  once: number;
  single: number;
};
export type SourcePresenceBase = { slots: number; questions: number; models: number };
export type SourcesPage = {
  origin?: 'all' | 'prompts' | 'semantic-branding';
  presenceVersion?: 1;
  totals?: SourcePresenceBase;
  leaders?: { ranking: SourceRow[]; widest: SourceRow };
  rows: SourceRow[];
  hasMore: boolean;
  available: number;
  complete: number;
  classifier?: PublicSourceTypeClassifier;
};
export type SourceTypeShare = { type: SourceTypeValue; citations: number; domains: number; share: number };
export type ContentTypeShare = { type: SourceTypeValue; citations: number; urls: number; share: number };
export type SourceTypesReport = {
  classifier: PublicSourceTypeClassifier;
  /** Responses citing a domain, summed over domains: one citation per response and domain. */
  citations: number;
  classified: number;
  unclassified: number;
  types: SourceTypeShare[];
  /** Domains beyond the aggregation ceiling count as unclassified. */
  truncated: boolean;
  pendingBatches: number;
};
/** Citations by content (page) type of the cited URLs; the part without a type is declared. */
export type ContentTypesReport = {
  classifier: PublicSourceTypeClassifier;
  /** Responses citing a URL, summed over URLs: one citation per response and URL. */
  citations: number;
  classified: number;
  unclassified: number;
  types: ContentTypeShare[];
  /** URLs beyond the aggregation ceiling count as unclassified. */
  truncated: boolean;
  pendingBatches: number;
};
export type SourceEntityDetail = {
  origin?: 'all' | 'prompts' | 'semantic-branding';
  averageScore?: number | null;
  kind: SourceTypeKind;
  key: string;
  domain: string;
  title: string | null;
  ownership: SourceOwner;
  sourceType: SourceTypeValue;
  /** URL detail: the type of its domain. */
  domainType?: SourceTypeValue;
  classifier: PublicSourceTypeClassifier;
  presenceVersion: 1;
  presence: SourcePresence | null;
  totals: SourcePresenceBase;
  sourceKind: 'cited' | 'consulted';
  metrics: { citing: number; total: number; rate: number; pages: number };
  daily: { date: string; citing: number; total: number; rate: number; presence: number; denominator: number; slots: number; questions: number }[];
  platforms: { engine: Engine; citing: number; total: number; rate: number; presence: number; denominator: number; slots: number; questions: number }[];
  prompts: { prompt: string; text: string; topic: string; responses: number; presence: number; slots: number; denominator: number }[];
  urls: { url: string; title: string; responses: number; pageType: SourceTypeValue; presence: number; slots: number; denominator: number; cited?: boolean; consulted?: boolean }[];
  brands: { name: string; domain: string; responses: number }[];
  history: HistoryPage;
};
export type SourceDetail = {
  sources: Citation[];
  /** Cursor for source URLs; independent from the matching-response cursor. */
  nextSourceCursor: string | null;
  runs: Run[];
  hasMore: boolean;
  nextCursor: string | null;
};
// Prototype: Query Fan Out. `occurrences` counts a query once per response.
export type FanoutQueryRow = {
  key: string;
  text: string;
  kind: 'search' | 'site';
  occurrences: number;
  prompts: number;
  /** Topic (prompt tag) of most of the responses that produced the query. */
  topic: string;
  engines: Engine[];
  /** Share of the responses that produced the query that mention the brand. */
  mentionedRate: number;
  /** Share of those responses that cite the brand's own domain. */
  citedRate: number;
  /** Its search intent (FanoutIntent id); '' when it fits none, null while it waits to be classified. */
  intent: string | null;
};
/** What an intent's searches name: the service or category, a place, who it is for, a brand or product, a modifier (price, comparison...). */
export type FanoutEntityType = 'service' | 'location' | 'audience' | 'brand' | 'modifier';
export type FanoutEntity = { type: FanoutEntityType; value: string };
/** A search intent of a project: what several searches of the AIs want to find out (lib/fanout-intents.ts). */
export type FanoutIntent = { id: string; name: string; description: string; entities: FanoutEntity[] };
/** An intent in the period: its searches counted like the query table (an occurrence is one search in one response). */
export type FanoutIntentRow = FanoutIntent & {
  queries: number;
  occurrences: number;
  prompts: number;
  engines: Engine[];
  mentionedRate: number;
  citedRate: number;
};
/** A word in the searches, per day and AI. `change` compares the period with the one right before it, same length; null when that one has no searches with the word. */
export type FanoutPhrase = {
  term: string;
  /** 1 for a word, 2 or 3 for a phrase. */
  words: number;
  count: number;
  rate: number;
  with: { term: string; count: number }[];
};
export type FanoutTermTrend = {
  term: string;
  count: number;
  change: number | null;
  daily: { date: string; counts: Partial<Record<Engine, number>> }[];
};
/** A word in an AI's searches next to responses that do not mention the brand. Rates are per AI, never averaged. */
export type QueryGap = {
  term: string;
  engine: Engine;
  /** Responses whose searches contain the word. */
  responses: number;
  missing: number;
  /** Share of those responses that mention the brand. */
  rate: number;
  /** Share of all this AI's responses with searches that mention the brand. */
  baseline: number;
};
export type FanoutReport = {
  responses: number;
  withFanout: number;
  occurrences: number;
  distinct: number;
  engines: { engine: Engine; responses: number; withFanout: number; occurrences: number; distinct: number }[];
  daily: { date: string; counts: Partial<Record<Engine, number>> }[];
  queries: FanoutQueryRow[];
  hasMoreQueries: boolean;
  /**
   * Words and phrases (2 to 3 words) the AI searches beyond the prompt, up to 30 of each, most searches first (a word a longer
   * listed phrase holds almost whole is left to it): searches with it, their share of all searches, and the listed terms in the
   * same searches.
   */
  phrases: FanoutPhrase[];
  brands: { name: string; own: boolean; count: number }[];
  sites: { site: string; count: number }[];
  topics: { topic: string; occurrences: number; distinct: number; mentionedRate: number }[];
  /** Words the AI adds to the prompt: share of all searches that carry the word and the prompt did not. */
  added: { term: string; count: number; rate: number }[];
  termTrend: FanoutTermTrend[];
  /** The AIs that ever returned searches for the project: the only ones the screen offers. */
  fanoutEngines: Engine[];
  /** True when the period holds more responses with fan-out than the prototype reads. */
  truncated: boolean;
  /** The period's intents, most occurrences first, over every search (not only the listed ones). */
  intents: FanoutIntentRow[];
  /** Distinct searches of the period that fit no intent, and the ones still waiting to be classified. */
  unassigned: { other: number; pending: number };
};
/**
 * An intent where the brand is missing (Opportunities): the answers to the prompts whose searches fall in it, where at least
 * two AIs never name the brand while competitors appear. `impact` weighs those answers by the project's topic weights.
 */
export type OpportunityRow = {
  intent: FanoutIntent;
  impact: number;
  /** Answers to the intent's prompts, and those that skip the brand but name a competitor. */
  answers: number;
  gapAnswers: number;
  /** The AIs that answer these prompts without ever naming the brand while competitors appear. */
  missing: Engine[];
  engines: { engine: Engine; answers: number; mentioned: number; gap: number }[];
  prompts: { id: string; text: string; gap: number }[];
  promptCount: number;
  queries: { key: string; text: string; occurrences: number }[];
  queryCount: number;
  competitors: { name: string; answers: number }[];
  /** Domains cited in the newest answers without the brand. */
  sources: { domain: string; count: number }[];
};
export type OpportunitiesReport = {
  /** Complete answers in the period, and those with searches. */
  responses: number;
  withFanout: number;
  /** Distinct searches of the period, those with a decision (an intent or none) and the intents they fall in. */
  queries: number;
  classified: number;
  intents: number;
  opportunities: OpportunityRow[];
  /** True when the period holds more answers than the report reads (the newest are read). */
  truncated: boolean;
};
export type FanoutDetail = {
  key: string;
  variants: string[];
  runs: {
    id: string;
    prompt_text: string;
    /** The search of this response, as the AI wrote it. */
    query_text: string;
    engine: Engine;
    created_at: string;
    mentioned: boolean;
    cited: boolean;
  }[];
  /** Domains cited / consulted in those responses, by number of responses. */
  cited: { domain: string; count: number }[];
  consulted: { domain: string; count: number }[] | null;
};
/** One answer a product (or a brand's product) appeared in, at its first card there. */
export type ProductAnswer = {
  run: string;
  engine: Engine;
  prompt: string;
  date: string;
  /** Its card's place among the answer's cards, from 1. */
  position: number;
  /** The card's price and its currency; null when the card has none. */
  price: number | null;
  currency: string | null;
  store: string | null;
  /** The AI's own label on the card ("Best overall"). */
  label: string | null;
  /** The card's title (a brand's page: which of its products). */
  title: string;
};
/** Answers it appeared in (once each), those where it was the first card, and its mean place (1 is the first card). */
export type ProductPlace = { answers: number; first: number; position: number };
export type ProductRow = ProductPlace & {
  key: string;
  title: string;
  /** The monitored brand named in the title; null when it names none. */
  brand: string | null;
  own: boolean;
  /** The newest picture its cards showed (an https address); null when none did. */
  image: string | null;
  engines: Engine[];
  /** Lowest and highest price shown, in the currency most cards use; null when no card showed one. */
  price: { min: number; max: number; currency: string } | null;
  stores: string[];
  labels: string[];
  rating: number | null;
};
/** A monitored brand in the cards: its answers (at its first card in each), its cards and its distinct products. */
export type ProductBrandRow = ProductPlace & { name: string; own: boolean; domain: string; cards: number; products: number };
export type ProductStoreRow = { name: string; cards: number; products: number };
/** Products (lib/products.ts buildProducts): the product cards of the period's answers. */
export type ProductsReport = {
  /** Complete answers of the AIs that can show cards, and those that showed at least one. */
  responses: number;
  withProducts: number;
  /** Cards read (the base of a brand's share of the cards). */
  cards: number;
  /** Answers with a card of the project's own brand, and those where it was the first card. */
  ownAnswers: number;
  ownFirst: number;
  engines: { engine: Engine; responses: number; withProducts: number }[];
  brands: ProductBrandRow[];
  stores: ProductStoreRow[];
  products: ProductRow[];
  /** True when the period holds more cards than the report reads (the newest are read). */
  truncated: boolean;
};
/** A product's or a brand's page in Products (lib/products.ts buildProductDetail, view=product-detail). */
export type ProductDetailReport = {
  /** Answers with cards and cards read in the period: the bases of its shares. */
  withProducts: number;
  cards: number;
  /** The product (a product's page) or the brand (a brand's page); null when the period has none of its cards. */
  product: ProductRow | null;
  brand: ProductBrandRow | null;
  /** A brand's products. */
  products: ProductRow[];
  engines: (ProductPlace & { engine: Engine })[];
  /** Per day with an appearance: its place, overall and per AI. */
  days: (ProductPlace & { date: string; engines: Partial<Record<Engine, number>> })[];
  prompts: (ProductPlace & { promptId: string; prompt: string; engines: Engine[] })[];
  /** Where its cards send buyers, with the prices shown there. */
  stores: (ProductStoreRow & { price: ProductRow['price'] })[];
  /** A product's page: the products shown in the same answers, by the answers they share. */
  beside: (ProductRow & { together: number })[];
  /** The newest of its answers (`answered` in all). */
  answers: ProductAnswer[];
  answered: number;
  truncated: boolean;
};
