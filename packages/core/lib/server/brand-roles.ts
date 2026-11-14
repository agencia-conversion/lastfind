import { brandKey, type Suggestion } from '@/lib/brand-decisions';
import { aggregateRole, isNameFragment, questionKey, ROLE_PENDING_REASON, ROLE_LABELS, verdictModel, type BrandRole, type RoleChoice } from '@/lib/brand-roles';
import { RESEARCH_MODELS } from '@/lib/brand-research-provider';
import { db, setting } from './env';
import { classifierModels } from './classifier-models';
import { decisionKeyConfigured } from './model-routes';

/** The model that decides roles, and the previous engine it falls back to (null when the default is configured). */
export const roleModels = () => classifierModels('brand_roles', RESEARCH_MODELS.liquid);

export const roleKey = (suggestion: Suggestion) => suggestion.key ?? brandKey(suggestion.name);
/** The keys a verdict may be kept under: the name's own, then its aliases' (a sub-brand settled before the family folded). */
const roleKeys = (suggestion: Suggestion) => [roleKey(suggestion), ...(suggestion.aliases ?? []).map(brandKey)];

type RoleRow = { brand_key: string; role: RoleChoice; model: string };
type QuestionRow = { brand_key: string; role: RoleChoice; n: number; current?: number };
/** A name's role for the project; `support` says, for names settled per question, in how many questions it is a competitor. */
export type DecidedRoles = Map<string, RoleChoice> & { support?: Map<string, { competitor: number; questions: number; ambiguous: number }> };

/**
 * The `model` values verdicts are read under, for the model and its fallback: the current criteria's (verdictModel), and
 * the older criteria's (the bare model), which count only until the name is decided again (v4).
 */
export function verdictModels() {
  const { model, fallback } = roleModels();
  const engines = [model, fallback ?? model];
  return { current: engines.map(verdictModel), legacy: engines };
}

/**
 * The reads behind {@link decidedRoles}, for a caller that sends them in one `db().batch` with other reads: the per-name
 * verdicts (`brand_role_decisions`) and the per-question ones counted by role (`brand_question_roles`). `current` reads
 * only the verdicts of the current criteria: what is still to ask.
 */
export function roleDecisionsStatements(projectId: string, { current = false } = {}) {
  const { current: now, legacy } = verdictModels();
  const read = [...now, ...(current ? now : legacy)];
  return [
    db().prepare('SELECT brand_key,role,model FROM brand_role_decisions WHERE project_id=? AND model IN (?,?,?,?)').bind(projectId, ...read),
    db()
      .prepare('SELECT brand_key,role,COUNT(*) n,model IN (?,?) current FROM brand_question_roles WHERE project_id=? AND model IN (?,?,?,?) GROUP BY brand_key,role,current')
      .bind(...now, projectId, ...read),
  ];
}

/** Answers kept for the project and the current model (and its fallback); per-question verdicts win over the older per-name one. */
export async function decidedRoles(projectId: string, options: { current?: boolean } = {}) {
  const [names, questions] = await db().batch(roleDecisionsStatements(projectId, options));
  return rolesFrom(names.results as RoleRow[], questions.results as QuestionRow[]);
}

/**
 * Weakest first: the older criteria's verdicts, then the current ones'; within each, the fallback's per-name verdict, the
 * model's, then the per-question ones (a name's role from what the model said in each question that names it).
 */
export function rolesFrom(rows: RoleRow[], questionRows: QuestionRow[] = []): DecidedRoles {
  const { model } = roleModels();
  const current = new Set(verdictModels().current);
  const roles: DecidedRoles = new Map<string, RoleChoice>();
  for (const level of [0, 1]) {
    const own = rows.filter((row) => Number(current.has(row.model)) === level);
    for (const row of own) if (row.model !== model && row.model !== verdictModel(model)) roles.set(row.brand_key, row.role);
    for (const row of own) if (row.model === model || row.model === verdictModel(model)) roles.set(row.brand_key, row.role);
    const counts = new Map<string, Partial<Record<RoleChoice, number>>>();
    for (const row of questionRows)
      if (Number(row.current ?? 1) === level) counts.set(row.brand_key, { ...counts.get(row.brand_key), [row.role]: Number(row.n) });
    if (counts.size) roles.support ??= new Map();
    for (const [key, count] of counts) {
      roles.set(key, aggregateRole(count));
      const questions = Object.entries(count).reduce((sum, [role, n]) => sum + (role === 'ambiguous' ? 0 : (n ?? 0)), 0);
      roles.support!.set(key, { competitor: count.competitor ?? 0, questions, ambiguous: count.ambiguous ?? 0 });
    }
  }
  return roles;
}

/**
 * The roles for one answer (its response detail): what the model said in the answers to its question, else the
 * project's role of the name. A read only; nothing is asked here.
 */
export async function answerRoles(projectId: string, question: string | null | undefined) {
  const roles = new Map<string, RoleChoice>(await decidedRoles(projectId));
  if (!question) return roles;
  const { current, legacy } = verdictModels();
  const { results } = await db()
    .prepare('SELECT brand_key,role FROM brand_question_roles WHERE project_id=? AND question_key=? AND model IN (?,?,?,?) ORDER BY model IN (?,?)')
    .bind(projectId, await questionKey(question), ...current, ...legacy, ...current)
    .all<{ brand_key: string; role: RoleChoice }>();
  // The current criteria's verdict comes last and wins.
  for (const row of results) roles.set(row.brand_key, row.role);
  return roles;
}

const withReason = (suggestion: Suggestion, reason: string) => ({
  ...suggestion,
  ambiguous: true,
  reasons: [...new Set([...(suggestion.reasons ?? []), reason])],
});

/**
 * What the decision model said each discovered name is to the project, read from the
 * answers it kept. It never calls the provider: the analysis job asks (brand-role-jobs.ts),
 * so a page load costs nothing and waits for nothing. With a key configured, a name without
 * a settled answer (not asked yet, a failed call, or "ambiguous") is never trusted as a
 * competitor: it waits in review, out of the ranking, with the reason. Without a key no
 * model can answer (the independent edition's default): the detector's own conclusion and
 * textual client/supplier clue stand, as before the model existed. A competitor verdict
 * settles what the text only hinted (a "client" clue, a name met only in prose) and enters
 * the ranking; any other role goes to review. A per-question verdict adds its evidence
 * ("Competitor in 3 of 4 questions…") to the reasons. A name the model found to be no brand at all (a title, a
 * person, a heading) leaves the list here and in the store's exclusion, and stays out on later analyses: the
 * verdict is kept per project and name.
 */
export async function withModelRoles(
  projectId: string,
  suggestions: Suggestion[],
  // Read ahead by a caller that still waits for the suggestions: saves a round trip in sequence.
  decided?: Promise<DecidedRoles>,
): Promise<Suggestion[]> {
  if (!suggestions.length) return suggestions;
  const roles = await (decided ?? decidedRoles(projectId));
  // A preview has no model but carries production's verdicts (preview import): a name without one waits in review, as in production.
  const asked = !!decisionKeyConfigured() || setting('PREVIEW_MODE') === 'true';
  const evidence = (key: string) => {
    const support = roles.support?.get(key);
    return support?.questions ? [`Competitor in ${support.competitor} of ${support.questions} questions the decision model read.`] : [];
  };
  return suggestions.flatMap((suggestion) => {
    // A name cut from a longer one ("Wh", "EarFun&") is no brand, whatever an older verdict said.
    if (isNameFragment(suggestion.name, suggestion.domain)) return [];
    // A family folded by the detector ("Accenture" with "Accenture Song") keeps a verdict given to any of its names; it
    // is no brand at all only when no name of it is one ("Rank" with "Rank Certo" stays, "Taylor" with "Taylor Swift" goes).
    const verdicts = roleKeys(suggestion).map((key) => roles.get(key)).filter((found): found is RoleChoice => !!found);
    const role = verdicts.find((found) => found !== 'ambiguous' && found !== 'not_brand') ?? verdicts.find((found) => found !== 'ambiguous') ?? verdicts[0];
    if (role === 'not_brand') return [];
    if (!role) return asked ? withReason(suggestion, ROLE_PENDING_REASON) : suggestion;
    if (role === 'ambiguous') return withReason(suggestion, ROLE_PENDING_REASON);
    if (role === 'competitor') {
      // The model read the excerpts: its verdict settles the doubts the text alone left (a name only in prose, a place).
      const { role: _clue, ...rest } = suggestion;
      return {
        ...rest,
        ambiguous: false,
        reasons: [...(rest.reasons ?? []).filter((reason) => !reason.endsWith('human review required.')), ...evidence(roleKey(suggestion))],
      };
    }
    const reviewed = withReason(
      suggestion,
      `The decision model says this is a ${ROLE_LABELS[role as Exclude<BrandRole, 'competitor'>][0].toLowerCase()}, not a competitor of the tracked brands.`,
    );
    return { ...reviewed, reasons: [...reviewed.reasons, ...evidence(roleKey(suggestion))], role: role as BrandRole };
  });
}
