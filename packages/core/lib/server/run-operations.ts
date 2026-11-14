/** How the project operations of an edition run, one after another (no imports: the edition policies import it). */
// Each operation runs on its own: one that throws (even on every tick) is logged and recorded, and the next still runs. Past the
// deadline the rest wait for the next invocation, well inside the operations lease (OPERATIONS_LEASE, 270 s). After the first
// (notifications, kept first so a digest is never late) the order rotates each invocation, so an operation that always eats the
// deadline no longer starves the ones after it. The names of the operations that failed are returned (./operations writes them).
export const OPERATIONS_DEADLINE_MS = 120_000;
export async function runOperations(ops: [string, () => Promise<number>][], deadlineMs = OPERATIONS_DEADLINE_MS, now = Date.now, turn = Math.floor(now() / 300_000)) {
  const end = now() + deadlineMs;
  let total = 0;
  const failed: string[] = [];
  const [first, ...rest] = ops;
  const shift = rest.length ? turn % rest.length : 0;
  const ordered = first ? [first, ...rest.slice(shift), ...rest.slice(0, shift)] : [];
  for (const [name, op] of ordered) {
    if (now() >= end) break;
    try {
      total += await op();
    } catch (error) {
      failed.push(name);
      // The cause is logged (bounded): an unexplained failure is what hid the 23/10 credit outage. Logs are private to the account.
      console.error(`Project operation ${name} failed (${error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : 'unknown'}).`);
    }
  }
  return { total, failed };
}

