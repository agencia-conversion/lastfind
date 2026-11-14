// Data retention (11/11/2026): how long a project keeps the raw form of its answers (the answer text, the
// provider's original response and the excerpts and texts the decision models read). The numbers the reports count (each
// answer's brands, positions, citations, sentiment readings, Semantic Branding scores) are kept for good, so trends survive.
// `null` keeps everything (every project that existed before this setting, until its owner or the operator chooses).

/** The choices, in days. The shortest is the longest report period (90 days), so no period a screen reads loses its text. */
export const RETENTION_DAYS = [90, 180, 365, 730] as const;
/** A new project's retention (the migration's column default; existing projects keep everything until someone chooses). */
export const DEFAULT_RETENTION_DAYS = 90;

export function validRetention(value: unknown): value is (typeof RETENTION_DAYS)[number] | null {
  return value === null || (RETENTION_DAYS as readonly unknown[]).includes(value);
}

/** Answers created before this instant have their raw form removed. */
export function retentionCutoff(days: number, at: number) {
  return new Date(at - days * 86_400_000).toISOString();
}
