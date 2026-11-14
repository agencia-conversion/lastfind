import { brandKey, deriveState, type DecisionEvent, type DecisionKind, type DecisionPayload } from '@/lib/brand-decisions';
import { db } from './env';

const MAX_EVENTS = 5000;

export type DecisionEventRow = {
  id: string;
  seq: number;
  kind: DecisionKind;
  brand_key: string;
  undoes: string | null;
  payload_json: string;
  author: string;
  created_at: string;
};

/** The read behind {@link loadDecisionEvents}, for a caller that sends it in one `db().batch` with other reads. */
export const decisionEventsStatement = (projectId: string) =>
  db()
    .prepare(
      'SELECT id,seq,kind,brand_key,undoes,payload_json,author,created_at FROM brand_decision_events WHERE project_id=? ORDER BY seq LIMIT ?',
    )
    .bind(projectId, MAX_EVENTS);

export async function loadDecisionEvents(projectId: string): Promise<DecisionEvent[]> {
  return decisionEventsFrom((await decisionEventsStatement(projectId).all<DecisionEventRow>()).results);
}

export function decisionEventsFrom(results: DecisionEventRow[]): DecisionEvent[] {
  return results.map((row) => ({
    id: row.id,
    seq: Number(row.seq),
    kind: row.kind,
    brandKey: row.brand_key,
    undoes: row.undoes,
    payload: JSON.parse(row.payload_json) as DecisionPayload,
    author: row.author,
    createdAt: row.created_at,
  }));
}

/** Suggestions without the brands this project rejected or merged into another. */
export async function withoutDecided<T extends { name: string; key?: string }>(
  projectId: string,
  suggestions: T[],
  // Read ahead by a caller that still waits for the suggestions: saves a round trip in sequence.
  events: Promise<DecisionEvent[]> = loadDecisionEvents(projectId),
): Promise<T[]> {
  const state = deriveState(await events);
  return suggestions.filter((item) => {
    const key = item.key ?? brandKey(item.name);
    return !state.rejected[key] && !state.mergedInto[key];
  });
}
