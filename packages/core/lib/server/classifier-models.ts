import { classifierEngines, classifierFunction, CLASSIFIER_FUNCTIONS, FIXED_CLASSIFIERS, type Classifier, type ClassifierFunction } from '@/lib/classifier-models';
import { RESEARCH_MODELS } from '@/lib/brand-research-provider';
import { AGENT_MODEL } from '@/lib/agent';
import { ATTRIBUTE_MODEL } from '@/lib/semantic-attributes';
import { BRAIN_WIZARD_MODEL } from '@/lib/brain-wizard';
import { WIZARD_MODEL } from '@/lib/new-project-ai';
import { READING_MODEL } from '@/lib/semantic-panel-provider';
import { COMPARISON_READER_MODEL } from '@/lib/comparison';
import { setting } from './env';
import { CLASSIFIER_SETTING_PREFIX } from './platform-settings';
import { storedSetting } from './stored-settings';

/** The model Admin saved for a function (`platform_settings`), or null. */
export const storedClassifierModel = (fn: ClassifierFunction | null) =>
  (fn && storedSetting(`${CLASSIFIER_SETTING_PREFIX}${fn}`)) || null;

/**
 * The model a classifier runs and the previous engine it falls back to (null when the default is configured):
 * the model saved in Admin for its function, else `LASTFIND_CLASSIFIER_MODELS`, else the code default.
 */
export const classifierModels = (id: Classifier, current: string) =>
  classifierEngines(setting('LASTFIND_CLASSIFIER_MODELS'), id, current, console.warn, storedClassifierModel(classifierFunction(id)));

/** The code default of each function: the model a project with no evaluator choice of its own runs. */
const DEFAULTS: Record<ClassifierFunction, { id: Classifier; model: string }> = {
  sentiment: { id: 'brand_research_liquid', model: RESEARCH_MODELS.liquid },
  source_types: { id: 'source_types', model: RESEARCH_MODELS.jev },
  brand_roles: { id: 'brand_roles', model: RESEARCH_MODELS.liquid },
  // The roles' model until the offline gate picks another (classifierFunctionStatus reads the roles' one in effect).
  brand_mentions: { id: 'brand_mentions', model: RESEARCH_MODELS.liquid },
  // The own brand's tie-breaker, a stronger reader than the questions' model (offline: the only one of three that
  // settled own-brand mentions both ways at 0.9 and 0.1 from the excerpt alone).
  brand_mentions_tiebreak: { id: 'brand_mentions_tiebreak', model: RESEARCH_MODELS.jev },
  // The own brand's reader and its one search for same-named businesses: a chat model (it quotes the text), the agent's.
  brand_mentions_reader: { id: 'brand_mentions_reader', model: AGENT_MODEL },
  // The own brand's second reader (v14): another family than the reader, so "a same-named business" is final only when two
  // independent readers say it (offline: Claude Haiku agreed on 10 of the 13 queued homonym rows, none of them a true mention).
  brand_mentions_confirm: { id: 'brand_mentions_confirm', model: 'anthropic/claude-haiku-5.5' },
  brand_domain: { id: 'brand_domain', model: RESEARCH_MODELS.liquid },
  agent: { id: 'agent', model: AGENT_MODEL },
  // Intents need written names and descriptions: the agent's chat model, not a Decisions model.
  fanout_intents: { id: 'fanout_intents', model: AGENT_MODEL },
  semantic_attributes: { id: 'semantic_attributes', model: ATTRIBUTE_MODEL },
  // The reading of an answer in prose: the provider's reader by default; a decision model when Admin names one (8/11/2026).
  semantic_reader: { id: 'semantic_reader', model: READING_MODEL },
  brain_wizard: { id: 'brain_wizard', model: BRAIN_WIZARD_MODEL },
  // A chat model with a known price (the reserve is computed from it): the agent's own.
  agent_curator: { id: 'agent_curator', model: AGENT_MODEL },
  project_wizard: { id: 'project_wizard', model: WIZARD_MODEL },
  // The scores and facts of an answer: a chat model that copies them (a decision model cannot quote), one call per answer.
  comparison_reader: { id: 'comparison_reader', model: COMPARISON_READER_MODEL },
};
/**
 * The model mention checks run (lib/server/brand-mention-checks.ts), never with a fallback: the one saved for
 * `brand_mentions`, else the server setting, else the roles' model in effect.
 */
/** The own brand's tie-breaker model (lib/server/brand-mention-checks.ts), never with a fallback. */
export const mentionTiebreakModel = () => classifierModels('brand_mentions_tiebreak', DEFAULTS.brand_mentions_tiebreak.model).model;
/** The own brand's reader model (lib/server/brand-mention-checks.ts), never with a fallback. */
export const mentionReaderModel = () => classifierModels('brand_mentions_reader', DEFAULTS.brand_mentions_reader.model).model;
/** The own brand's second reader model (lib/server/brand-mention-checks.ts), never with a fallback. */
export const mentionConfirmModel = () => classifierModels('brand_mentions_confirm', DEFAULTS.brand_mentions_confirm.model).model;
/** The model that reads an answer in prose (lib/server/semantic-panel-worker.ts), never with a fallback: READING_MODEL is the provider's reader. */
export const overviewReaderModel = () => classifierModels('semantic_reader', DEFAULTS.semantic_reader.model).model;
/**
 * The chat model that reads a Comparison answer (lib/server/comparison-worker.ts), never with a fallback: a reading is tied to its model.
 * Fixed (FIXED_CLASSIFIERS): a model saved for it before 13/11/2026, or the server setting, is not used.
 */
export const comparisonReaderModel = () => DEFAULTS.comparison_reader.model;
export const mentionModel = () => classifierModels('brand_mentions', classifierModels('brand_roles', DEFAULTS.brand_roles.model).model).model;
/** Admin > Classifiers: each function with the model in effect and where it comes from. */
export function classifierFunctionStatus() {
  return CLASSIFIER_FUNCTIONS.map((fn) => {
    const { id } = DEFAULTS[fn.id];
    const model = fn.id === 'brand_mentions' ? classifierModels('brand_roles', DEFAULTS.brand_roles.model).model : DEFAULTS[fn.id].model;
    // A fixed function's model is the code's: nothing saved or set on the server counts, and Admin offers no choice.
    if (FIXED_CLASSIFIERS.includes(fn.id)) return { ...fn, default: model, stored: null, env: null, effective: model, source: 'fixed' as const };
    const stored = storedClassifierModel(fn.id);
    const env = classifierEngines(setting('LASTFIND_CLASSIFIER_MODELS'), id, model, () => {}).model;
    const effective = classifierModels(id, model).model;
    return {
      ...fn,
      default: model,
      stored,
      env: env === model ? null : env,
      effective,
      source: stored ? ('stored' as const) : env !== model ? ('env' as const) : ('default' as const),
    };
  });
}
