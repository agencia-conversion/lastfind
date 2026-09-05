import type { RawArchiveMetadata } from './raw-responses';
import type { Engine } from './engines';
export { ENGINE_LABELS } from './engines';
export type { Engine } from './engines';
export type Topic = { id: string; project_id: string; name: string };
export type BrandTarget = { name: string; domain: string };
export type Project = {
  id: string;
  name: string;
  domain: string;
  competitors: BrandTarget[];
  location_code: number;
  language_code: string;
  daily_enabled: number;
  interval_hours: number;
  category: string;
  audience: string;
  created_at: string;
};
export type Prompt = {
  id: string;
  project_id: string;
  text: string;
  engine: Engine;
  tag: string;
  tags: string[];
  archived: number;
  next_run_at: string;
  active: number;
  created_at: string;
};
export type Citation = { url: string; domain: string; title: string };
export type Run = {
  id: string;
  project_id: string;
  prompt_id: string;
  prompt_text: string;
  engine: Engine;
  status:
    | 'queued'
    | 'submitting'
    | 'pending'
    | 'complete'
    | 'failed'
    | 'unknown';
  mentions: Record<string, boolean>;
  brand_name: string;
  sources: Citation[];
  consulted_sources?: Citation[] | null;
  search_queries?: string[];
  response_available?: boolean;
  cost: number;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  answer?: string;
  model?: string;
  source_count?: number;
  consulted_source_count?: number | null;
  evidence_loaded?: boolean;
  raw_response?: RawArchiveMetadata;
};
export type Workspace = {
  user: { email: string; name: string };
  projects: Project[];
  prompts: Prompt[];
  topics: Topic[];
  capabilities: Capabilities;
  capacity: { prompts: number; topics: number };
  runs: Run[];
  selectedProjectId: string | null;
  monitoring?: { pending: number; last: string | null };
  usage: {
    used: number;
    limit: number | null;
    period: string;
    creditsUsed?: number;
    creditsLimit?: number | null;
  };
  config: {
    dataforseo: boolean;
    scheduling: boolean;
    schedulerLastSeen: string | null;
    providerSettings: boolean;
  };
};

export type Capabilities = {
  engines: Engine[];
  promptLimit: number | null;
  topicLimit: number | null;
};
