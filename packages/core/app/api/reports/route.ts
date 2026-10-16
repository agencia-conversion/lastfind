import { cachedAnalyticsQuery } from '@/lib/server/analytics-query-cache';
import { requireUser } from '@/lib/server/auth';
import {
  reportContext,
  summaryReport,
  analysisReport,
  historyReport,
  promptReport,
  promptDetail,
  competitorsReport,
  sourceDetail,
  opportunitiesReport,
} from '@/lib/server/reports';
import { json, fail, ApiError } from '@/lib/server/http';
import { SOURCE_TYPE_VIEWS, sourceTypeRevision, sourceTypeView } from '@/lib/server/source-types';
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      q = new URL(request.url).searchParams;
    const ctx = await reportContext(user.id, q);
    const canonical = new URLSearchParams(q);
    canonical.sort();
    let expires = 0;
    const view = q.get('view') || 'summary';
    const typed = (SOURCE_TYPE_VIEWS as readonly string[]).includes(view);
    const revision = typed ? await sourceTypeRevision(String(ctx.project.id), user.id) : '';
    const report = await cachedAnalyticsQuery(
      `report:${ctx.database.cacheKey}:${canonical}:${JSON.stringify(ctx.project)}:${revision}`,
      async () => {
        let report;
        if (typed) return sourceTypeView(view, user.id, ctx, q);
        switch (view) {
          case 'summary':
        report = await summaryReport(ctx);
        break;
          case 'analysis':
        report = await analysisReport(ctx, q);
        break;
          case 'history':
        report = await historyReport(ctx, q);
        break;
          case 'prompts':
            report = await promptReport(ctx, q.get('compact') === '1');
            break;
          case 'prompt-detail':
        report = await promptDetail(ctx, q);
        break;
          case 'competitors':
        report = await competitorsReport(ctx, q);
        break;
          case 'source-detail':
        report = await sourceDetail(ctx, q);
        break;
          case 'opportunities':
        report = await opportunitiesReport(ctx, q);
        break;
          default:
        throw new ApiError(400, 'Invalid report.');
        }
        return report;
      },
      Date.now,
      (value) => {
        expires = value;
      },
    );
    const response = json(report);
    response.headers.set('X-Lastfind-Cache-Expires', String(expires));
    response.headers.set('X-Lastfind-Storage', ctx.database.mode);
    return response;
  } catch (e) {
    return fail(e);
  }
}
