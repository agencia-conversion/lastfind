import { runPositionEntries } from '../lib/run-positions.ts';
import {
  EFFECTIVE_MENTIONS_SQL,
  EFFECTIVE_POSITIONS_BASIS_SQL,
  EFFECTIVE_TARGETS_SQL,
} from '../lib/server/run-rows.ts';

/** The project store's run_positions for a fixture database (node:sqlite): the returned function saves the ranks of every complete answer. */
export function runPositionsFor(sqlite) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS run_positions(run_id TEXT NOT NULL,basis TEXT NOT NULL,entries_json TEXT NOT NULL,PRIMARY KEY(run_id,basis))');
  const save = sqlite.prepare('INSERT OR REPLACE INTO run_positions VALUES(?,?,?)');
  return async () => {
    const rows = sqlite
      .prepare(`SELECT r.id,r.answer,${EFFECTIVE_TARGETS_SQL} targets_json,${EFFECTIVE_MENTIONS_SQL} mentions_json,${EFFECTIVE_POSITIONS_BASIS_SQL} basis
        FROM runs r WHERE r.status='complete' AND r.response_available=1`)
      .all();
    for (const row of rows) save.run(row.id, row.basis, runPositionEntries(row.answer, String(row.targets_json), String(row.mentions_json)));
  };
}
