import { requireUser } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import {
  readAllHiddenColumns,
  readHiddenColumns,
  tableKey,
  writeHiddenColumns,
} from '@/lib/server/table-column-preferences';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const table = new URL(request.url).searchParams.get('table');
    // No table: every saved table at once (the app's one read per page, hooks/use-table-columns.ts).
    if (table === null) return json(await readAllHiddenColumns(user.id));
    return json(await readHiddenColumns(user.id, tableKey(table)));
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const input = await body(request);
    const key = tableKey(input.table);
    return json(await writeHiddenColumns(user.id, key, input.hidden));
  } catch (error) {
    return fail(error);
  }
}
