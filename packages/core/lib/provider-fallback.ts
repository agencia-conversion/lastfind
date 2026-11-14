/** Key, credit, permission or rate-limit errors hit every model alike: no other model is tried and nothing is resent. */
export const SYSTEMIC_PROVIDER_STATUSES = [401, 402, 403, 429];

/**
 * Whether a failed first Decisions call may be retried on the fallback model. A request that may have been served and billed
 * (a timeout, a reset connection, an unusable 2xx answer) is not resent, to the fallback neither; a 5xx answer is the
 * provider saying this model failed. A first call that already cost something keeps the whole one-call reservation.
 */
export const mayUseFallback = (error: { unknown: boolean; status: number; cost: number | null }) =>
  !((error.unknown && error.status < 500) || SYSTEMIC_PROVIDER_STATUSES.includes(error.status) || (error.cost ?? 0) > 0);
