import { requireActor } from '@/lib/server/auth';
import { reportContext } from '@/lib/server/reports';
import { runFromRow } from '@/lib/server/run-rows';
import { runsCsv } from '@/lib/metrics';
import { fail } from '@/lib/server/http';
import { ProjectStoreUnavailableError } from '@/lib/server/project-store-transport';
import { errorLocale } from '@/lib/server/errors-i18n';
import { providerSettings } from '@/lib/server/capabilities';
import {
  EFFECTIVE_MENTIONS_SQL,
  EFFECTIVE_TARGETS_SQL,
} from '@/lib/server/run-rows';
const PAGE = 1000;
const SMALL_PAGE = 100;
export async function GET(request: Request) {
  try {
    const user = await requireActor();
    const params = new URL(request.url).searchParams;
    const ctx = await reportContext(user.workspaceId, params);
    // Headers follow the interface language; the provider cost only where the owner pays the provider directly.
    const csvOptions = {
      locale: errorLocale(request.headers.get('cookie')),
      cost: providerSettings,
    };
    const database = ctx.database,
      encoder = new TextEncoder(),
      upper = new Date().toISOString();
    let cursor: { date: string; id: string } | null = null,
      first = true,
      pageSize = PAGE,
      stopped = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (stopped) return;
        try {
          if (first) {
            controller.enqueue(encoder.encode(runsCsv([], csvOptions) + '\r\n'));
            first = false;
          }
          const after = cursor;
          // Read once, so outside the report caches. A page is one store call; one whose answers carry so much evidence that
          // it passes the store's read size limit is read again in small pages.
          const page = async (limit: number) =>
            (
              await database
                .prepare(`${ctx.withClause} SELECT r.id,r.project_id,r.prompt_id,r.prompt_text,r.engine,r.status,${EFFECTIVE_TARGETS_SQL} AS targets_json,${EFFECTIVE_MENTIONS_SQL} AS mentions_json,r.sources_json,r.consulted_sources_json,r.search_queries_json,r.response_available,r.cost,r.error,r.created_at,r.completed_at
            FROM runs r WHERE ${ctx.where} AND r.created_at<=? ${after ? 'AND (r.created_at<? OR (r.created_at=? AND r.id<?))' : ''} ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit}`)
                .bind(
                  ctx.brandBinding,
                  ...ctx.bindings,
                  upper,
                  ...(after ? [after.date, after.date, after.id] : []),
                )
                .all<Record<string, unknown>>({ cache: false })
            ).results;
          const rows = await page(pageSize).catch((error) => {
            if (!(error instanceof ProjectStoreUnavailableError) || error.reason !== 'rejected' || pageSize === SMALL_PAGE) throw error;
            pageSize = SMALL_PAGE;
            return page(pageSize);
          });
          if (stopped) return;
          if (rows.length) {
            const csv = runsCsv(rows.map(runFromRow), csvOptions);
            controller.enqueue(
              encoder.encode(csv.slice(csv.indexOf('\r\n') + 2) + '\r\n'),
            );
            const last = rows.at(-1)!;
            cursor = { date: String(last.created_at), id: String(last.id) };
          }
          if (rows.length < pageSize) {
            stopped = true;
            controller.close();
          }
        } catch (e) {
          stopped = true;
          controller.error(e);
        }
      },
      cancel() {
        stopped = true;
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="lastfind-results.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return fail(e);
  }
}
