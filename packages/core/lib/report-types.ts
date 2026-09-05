import type { Citation, Engine, Run } from './types';
export type Metrics = {
  responses: number;
  visibility: number;
  shareOfVoice: number;
  citedDomains: number;
  mentions: number;
  cost: number;
};
export type ReportDrilldown = {
  engine?: Engine | 'all';
  topic?: string;
  prompt?: string;
  brand?: string;
  mention?: 'all' | 'mentioned' | 'missing';
  source?: string;
  sourceKind?: 'cited' | 'consulted';
  sourceGroup?: 'domain' | 'url';
  gap?: 'all' | 'competitor-only';
};
export type SummaryReport = {
  metrics: Metrics;
  comparison: {
    previous: Metrics;
    /** Absolute differences. Visibility and share of voice use percentage points. */
    delta: Metrics;
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
  daily: Record<string, string | number>[];
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
export type PromptReport = Record<
  string,
  { responses: number; visibility: number; pending: number; latest?: Run }
>;
export type SourceRow = {
  key: string;
  domain: string;
  title: string;
  responses: number;
  pages: number;
  engines: Engine[];
  mentions: number;
  visibility: number;
};
export type SourcesPage = {
  rows: SourceRow[];
  hasMore: boolean;
  available: number;
  complete: number;
};
export type SourceDetail = {
  sources: Citation[];
  runs: Run[];
  hasMore: boolean;
  nextCursor: string | null;
};
