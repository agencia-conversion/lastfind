import { requireUser } from '@/lib/server/auth';
import {
  reportContext,
  summaryReport,
  analysisReport,
  historyReport,
  promptReport,
  sourcesReport,
  sourceDetail,
} from '@/lib/server/reports';
import { json, fail, ApiError } from '@/lib/server/http';
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      q = new URL(request.url).searchParams;
    const ctx = await reportContext(user.id, q);
    let report;
    switch (q.get('view') || 'summary') {
      case 'summary':
        report = await summaryReport(ctx);
        break;
      case 'analysis':
        report = await analysisReport(ctx);
        break;
      case 'history':
        report = await historyReport(ctx, q);
        break;
      case 'prompts':
        report = await promptReport(ctx);
        break;
      case 'sources':
        report = await sourcesReport(ctx, q);
        break;
      case 'source-detail':
        report = await sourceDetail(ctx, q);
        break;
      default:
        throw new ApiError(400, 'Invalid report.');
    }
    const response = json(report);
    response.headers.set('X-Lastfind-Storage', ctx.database.mode);
    return response;
  } catch (e) {
    return fail(e);
  }
}
