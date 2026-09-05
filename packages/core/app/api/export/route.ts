import { requireUser } from '@/lib/server/auth';
import { reportContext } from '@/lib/server/reports';
import { runFromRow } from '@/lib/server/run-rows';
import { runsCsv } from '@/lib/metrics';
import { fail } from '@/lib/server/http';
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      ctx = await reportContext(user.id, new URL(request.url).searchParams);
    const database = ctx.database,
      encoder = new TextEncoder(),
      upper = new Date().toISOString();
    let cursor: { date: string; id: string } | null = null,
      first = true,
      stopped = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (stopped) return;
        try {
          if (first) {
            controller.enqueue(encoder.encode(runsCsv([]) + '\r\n'));
            first = false;
          }
          const after = cursor;
          const rows = (
            await database
              .prepare(`${ctx.withClause} SELECT r.id,r.project_id,r.prompt_id,r.prompt_text,r.engine,r.status,r.targets_json,r.mentions_json,r.sources_json,r.consulted_sources_json,r.search_queries_json,r.response_available,r.cost,r.error,r.created_at,r.completed_at
            FROM runs r WHERE ${ctx.where} AND r.created_at<=? ${after ? 'AND (r.created_at<? OR (r.created_at=? AND r.id<?))' : ''} ORDER BY r.created_at DESC,r.id DESC LIMIT 100`)
              .bind(
                ctx.brandBinding,
                ...ctx.bindings,
                upper,
                ...(after ? [after.date, after.date, after.id] : []),
              )
              .all<Record<string, unknown>>()
          ).results;
          if (stopped) return;
          if (rows.length) {
            const csv = runsCsv(rows.map(runFromRow));
            controller.enqueue(
              encoder.encode(csv.slice(csv.indexOf('\r\n') + 2) + '\r\n'),
            );
            const last = rows.at(-1)!;
            cursor = { date: String(last.created_at), id: String(last.id) };
          }
          if (rows.length < 100) {
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
