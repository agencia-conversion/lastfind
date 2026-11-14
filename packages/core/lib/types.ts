import type { RawArchiveMetadata } from './raw-responses';
import type { Engine } from './engines';
export { ENGINE_LABELS } from './engines';
export type { Engine } from './engines';
export type Topic = { id: string; project_id: string; name: string; engines_override?: Engine[] | null };
export type BrandTarget = {
  name: string;
  domain: string;
  /** Variantes captured with a run; never retroactively rewrite history. */
  aliases?: string[];
  /** The primary domain plus verified additional domains for this snapshot. */
  domains?: string[];
};
export type Project = {
  id: string;
  name: string;
  domain: string;
  aliases: string[];
  additional_domains: string[];
  competitors: BrandTarget[];
  location_code: number;
  language_code: string;
  engines?: Engine[];
  daily_enabled: number;
  /** 24 daily, 168 weekly (on `collection_day`); a weekly-only plan is weekly whatever it says. */
  interval_hours: number;
  /** Hour of the collection (0 to 23) in the workspace's time zone; absent means the default, 4. */
  collection_hour?: number;
  /** Weekday of a weekly collection (0 Sunday to 6 Saturday); absent means Monday. */
  collection_day?: number;
  category: string;
  audience: string;
  created_at: string;
  /** Its segment in the app's addresses (`/app/<workspace>/<slug>`): from its name, unique in the workspace, editable in Settings (app-routes.ts). */
  slug?: string;
  /** Relative weight per topic name in the aggregate metrics (lib/topic-weights); absent or null: every answer the same. */
  topic_weights?: Record<string, number> | null;
  /** How members start a piece of content in Agent > Contents; absent asks each time. */
  agent_content_mode?: 'wizard' | 'chat' | null;
  /** Its own name in the switcher and lists (lib/new-project.ts projectLabel); null or absent: the brand's `name`. */
  display_name?: string | null;
  /** Days the project keeps its answers' text and original responses (lib/retention.ts); null keeps everything. */
  raw_retention_days?: number | null;
};
export type Prompt = {
  id: string;
  unit_id?: string;
  engines?: Engine[];
  engines_override?: Engine[] | null;
  subscription_ids?: string[];
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
  /** The answer is older than the project's data retention: its numbers stay, its text was removed (lib/retention.ts). */
  textRemoved?: boolean;
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
  /** Collection snapshot, present only when a full answer is loaded. */
  targets?: BrandTarget[];
  sources: Citation[];
  consulted_sources?: Citation[] | null;
  search_queries?: string[];
  response_available?: boolean;
  /** Provider cost and internal error text: server-side and in the independent owner's reads only, never in a list item or a Cloud response. */
  cost?: number;
  created_at: string;
  completed_at: string | null;
  error?: string | null;
  answer?: string;
  model?: string;
  source_count?: number;
  consulted_source_count?: number | null;
  evidence_loaded?: boolean;
  /** List rows only: the brand keys of the discovered competitors the answer names, once per group. */
  discovered?: string[];
  raw_response?: RawArchiveMetadata;
  /** Response detail only: every brand the answer names and what it is to the project (answerBrands). */
  brands?: AnswerBrand[];
};
/** `tracked`: a monitored brand; `pending`: named as an item, the decision model has not answered yet. */
export type AnswerBrand = { name: string; role: 'tracked' | 'competitor' | 'client' | 'supplier' | 'partner' | 'ambiguous' | 'pending'; /** Other spellings of a counted discovery (the answer view marks them too). */ aliases?: string[] };
/** Cloud workspace roles (Settings › Members); the independent installation has only its owner. */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
/** A workspace the signed-in account can open: its own, or one it is a member of. `id` is the owner's account id. */
/**
 * `slug`: the workspace's segment in the app's addresses (Cloud, app-routes.ts). `unnamed`: the signed-in account's own
 * workspace, not named yet by its owner: the workspace wizard opens.
 */
/** `free`: on the Free plan (Cloud). */
export type WorkspaceChoice = { id: string; slug: string; name: string; role: WorkspaceRole; current: boolean; unnamed?: true; free?: true };
/**
 * Whether the person may create another workspace (Cloud: one free workspace per person). Closed, it names their free workspace
 * and how to lift the limit: `subscribe` it to a paid plan, or ask a Lastfind `admin` while payments are off.
 */
export type NewWorkspaceGate = { allowed: true } | { allowed: false; free: { id: string; name: string; slug: string }; upgrade: 'subscribe' | 'admin' };
export type Workspace = {
  user: { email: string; name: string; engines_override?: Engine[] | null };
  /** The signed-in account's role in this workspace (absent in the demo). */
  role?: WorkspaceRole;
  /** Cloud only: every workspace this account can switch to. Absent in the independent installation. */
  workspaces?: WorkspaceChoice[];
  /** Cloud only: whether a new workspace can be created now. */
  newWorkspace?: NewWorkspaceGate;
  projects: Project[];
  prompts: Prompt[];
  topics: Topic[];
  capabilities: Capabilities;
  /** `projectsFull`: the plan has no room for another project (Free's one), so New project is disabled with the reason. */
  capacity: { prompts: number; topics: number; projectsFull?: boolean };
  /** The workspace's IANA time zone for the collection schedule; null until its first project (the default zone applies). */
  timeZone?: string | null;
  runs: Run[];
  selectedProjectId: string | null;
  /** `collectionBlocked`: a limit stopped this project's collection in the last hours. */
  /** The open project's collection: runs in flight, the last answer, and `unpublished`, answers collected but not yet in its reports. */
  monitoring?: { pending: number; last: string | null; unpublished?: boolean; collectionBlocked?: { reason: string; at: string } | null };
  usage: {
    used: number;
    limit: number | null;
    period: string;
    creditsUsed?: number;
    creditsLimit?: number | null;
  };
  config: {
    dataforseo: boolean;
    /** Whether the installation holds an OpenRouter key (evaluations); never its value. */
    openrouter?: boolean;
    scheduling: boolean;
    schedulerLastSeen: string | null;
    providerSettings: boolean;
    /** A new prompt is collected right away (the independent edition), not at the project's next scheduled collection (Cloud). */
    collectsNow?: boolean;
  };
};

export type Capabilities = {
  engines: Engine[];
  promptLimit: number | null;
  topicLimit: number | null;
  /** The in-app agent: every Cloud plan with AI credits (Free's 1,000 a month included) and the independent edition. */
  agent?: boolean;
  /** The plan's name as the edition sells it, heading the account menu's plan rows; absent ("Your plan") where none is sold. */
  plan?: string;
  /** A weekly-only plan (for example once a week, on the workspace's collection day); never inferred from a number. */
  free?: boolean;
  /** Semantic Branding's frequency when the plan fixes it (for example monthly); absent, the project chooses. */
  panelFrequency?: 'daily' | 'weekly' | 'monthly' | null;
  /** Comparison: the most products a project compares (Free: 3); absent or null, the edition's sanity bound only. */
  comparisonProducts?: number | null;
};
