import { DETECTOR_VERSION } from './competitor-discovery.ts';
import { POSITIONS_VERSION } from './run-positions.ts';
import { BRAND_RESEARCH_RUBRIC } from './brand-research.ts';
import { RESEARCH_ADAPTER_VERSION, SENTIMENT_QUESTIONS_VERSION } from './brand-research-provider.ts';
import { QUESTION_ROLE_CONTEXT, ROLE_ADAPTER_VERSION } from './brand-roles.ts';
import { SOURCE_TYPE_DOMAIN_PROMPT, SOURCE_TYPE_RUBRIC } from './source-types.ts';
import { SOURCE_TYPE_RULES_VERSION } from './source-type-rules.ts';
import { MENTION_CHECK_CONTEXT, MENTION_OWN_PROMPT_VERSION, MENTION_PROMPT_VERSION } from './brand-mention-check.ts';

/**
 * The version every module shows (Admin > Algorithms). It is a product label, separate from each module's internal
 * basis key below: those keys identify stored results (the detector of an analysis, the basis of `run_positions`, the
 * rubric of a catalog row) and must not change when the label does, or existing data would be marked stale.
 */
export const ALGORITHM_VERSION = '0.1';

/**
 * The analysis modules, the version each one shows and the internal key its stored results carry (ARCHITECTURE.md,
 * "Algorithm versions"). A new basis applies to new work only: results made by an older one stay until an admin
 * reprocesses them. The PR that changes an algorithm bumps its basis constant and sets `reprocessRecommended` when the
 * change improves past results enough to redo them. `paid` modules call a provider to reprocess; from Admin, the free ones
 * and sentiment (its own section, with an estimate first) can be reprocessed.
 */
export const ALGORITHMS = [
  { id: 'detector', version: ALGORITHM_VERSION, basis: DETECTOR_VERSION, paid: false, reprocessRecommended: true, label: ['Brand detection', 'Detecção de marcas'] },
  { id: 'positions', version: ALGORITHM_VERSION, basis: `v${POSITIONS_VERSION}`, paid: false, reprocessRecommended: false, label: ['Brand positions', 'Posições das marcas'] },
  { id: 'sentiment', version: ALGORITHM_VERSION, basis: `${BRAND_RESEARCH_RUBRIC}/${RESEARCH_ADAPTER_VERSION}/${SENTIMENT_QUESTIONS_VERSION}`, paid: true, reprocessRecommended: true, label: ['Sentiment', 'Sentimento'] },
  // The mentions of names that are also common words that the detector's text could not settle; the scheduler asks
  // them by itself after a detection, within each project's monthly budget (MENTION_CHECK_MONTHLY_USD by default).
  { id: 'mention-checks', version: ALGORITHM_VERSION, basis: `${MENTION_CHECK_CONTEXT}/${MENTION_PROMPT_VERSION}/${MENTION_OWN_PROMPT_VERSION}`, paid: true, reprocessRecommended: false, label: ['Common-word brand checks', 'Checagem de marcas com nome comum'] },
  { id: 'question-roles', version: ALGORITHM_VERSION, basis: `${QUESTION_ROLE_CONTEXT}/${ROLE_ADAPTER_VERSION}`, paid: true, reprocessRecommended: false, label: ['Roles per question', 'Papéis por pergunta'] },
  // The rules apply at once to every read; the domains typed with the older question wait for the admin reclassification.
  { id: 'source-types', version: ALGORITHM_VERSION, basis: `${SOURCE_TYPE_RUBRIC}/${SOURCE_TYPE_DOMAIN_PROMPT}/${SOURCE_TYPE_RULES_VERSION}`, paid: true, reprocessRecommended: true, label: ['Source types', 'Tipos de fonte'] },
] as const satisfies readonly { id: string; version: string; basis: string; paid: boolean; reprocessRecommended: boolean; label: readonly [string, string] }[];
