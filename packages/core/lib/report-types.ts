import type { Citation, Engine, Run } from './types';
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
export type HistoryPage = { runs: Run[]; nextCursor: string | null };
export type PromptScore = { responses: number; mentions: number; visibility: number };
export type PromptReport = Record<string, {
  responses: number; mentions: number; visibility: number; pending: number; latest?: Run;
  previous: PromptScore; delta: PromptScore; brands: string[];
}>;
export type PromptDetail = {
  daily: { date: string; responses: number; mentions: number; visibility: number }[];
  platforms: { engine: Engine; responses: number; mentions: number; visibility: number }[];
  sources: { domain: string; responses: number }[];
  history: HistoryPage;
};
export type CompetitorMatrixRow = {
  name: string; domain: string; responses: number; mentions: number; visibility: number;
  cells: Record<string, { responses: number; mentions: number; visibility: number }>;
};
export type CompetitorsReport = {
  platforms: CompetitorMatrixRow[]; topics: CompetitorMatrixRow[];
  competitorOnly: { prompt: string; label: string; responses: number; engine: Engine; topic: string }[];
};
export type SourceRow = {
  key: string;
  domain: string;
  title: string;
  responses: number;
  pages: number;
  engines: Engine[];
  mentions: number;
  visibility: number;
  ownership: 'own' | 'competitor' | 'third-party';
};
export type SourcesPage = {
  rows: SourceRow[];
  hasMore: boolean;
  available: number;
  complete: number;
};
export type SourceDetail = {
  sources: Citation[];
  /** Cursor for source URLs; independent from the matching-response cursor. */
  nextSourceCursor: string | null;
  runs: Run[];
  hasMore: boolean;
  nextCursor: string | null;
};
export type OpportunityRow = {
  id: string;
  type: 'competitor-gap' | 'uncited-brand';
  title: string;
  detail: string;
  responses: number;
  source?: string;
  prompt?: string;
  engine?: Engine;
};
export type OpportunitiesReport = { rows: OpportunityRow[]; hasMore: boolean };
