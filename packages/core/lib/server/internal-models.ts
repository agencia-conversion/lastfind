/**
 * Evaluator ids (`provider`, `sentimentProvider`) and model names are internal: only the Cloud Admin
 * section shows or chooses them. Every customer response that carries an evaluator goes through these helpers.
 */
export function withoutEvaluator<T extends object>(value: T) {
  const {
    provider: _p,
    sentimentProvider: _s,
    model: _m,
    ...rest
  } = value as T & {
    provider?: unknown;
    sentimentProvider?: unknown;
    model?: unknown;
  };
  return rest;
}

/** A report with a source-type `classifier`, minus its evaluator. */
export function publicClassifierView<T>(report: T): T {
  if (!report || typeof report !== "object" || !("classifier" in report))
    return report;
  const { classifier } = report as { classifier: object };
  return { ...report, classifier: withoutEvaluator(classifier) };
}

/**
 * The brand research report a customer reads: no evaluator, no model, and a failed job says only that it failed (the
 * provider's reply stays in the row, for Admin and the logs). Idempotent: a kept copy passes through it again.
 */
export function publicResearchReport<T extends { configuration?: object; jobs?: { error?: string | null }[] }>(
  report: T,
) {
  const rest = withoutEvaluator(report);
  const jobs = report.jobs?.map((job) => ({ ...job, error: job.error ? 'failed' : null }));
  return {
    ...rest,
    ...(report.configuration ? { configuration: withoutEvaluator(report.configuration) } : {}),
    ...(jobs ? { jobs } : {}),
  };
}
