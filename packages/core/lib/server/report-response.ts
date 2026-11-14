import { waitUntil } from 'cloudflare:workers';
import { cachedAnalyticsQuery } from './analytics-query-cache';
import {
  reportContext,
  summaryReport,
  analysisReport,
  historyReport,
  promptReport,
  promptDetail,
  competitorsReport,
  sourceDetail,
  fanoutReport,
  fanoutDetail,
  opportunitiesReport,
  productsReport,
  type projectReadsById,
} from './reports';
import { intentRevisionStatement, projectIntents } from './fanout-intents';
import { ApiError } from './http';
import { digest } from './project-store-read';
import { SOURCE_TYPE_VIEWS, sourceTypeReads, sourceTypeStatements, sourceTypeView } from './source-types';
import { sentimentBandRuns } from './brand-research';

/**
 * A report view's response for the workspace owner (the caller has checked who asks): the copy the project store kept for this
 * request and its current data, else computed and kept. `kept` says which. The reports route and the first screens' warm-up
 * (first-screen-warm.ts) read through here.
 */
export async function reportResponse(workspaceId: string, q: URLSearchParams, early?: ReturnType<typeof projectReadsById>) {
  const view = q.get('view') || 'summary';
  const typed = (SOURCE_TYPE_VIEWS as readonly string[]).includes(view);
  const canonical = new URLSearchParams(q);
  canonical.sort();
  // A sentiment band (Responses): the answers whose reading of the brand is in it, from the readings in D1.
  const band = q.get('sentiment');
  const only = band ? await sentimentBandRuns(q.get('project') ?? '', workspaceId, q, q.get('brand'), band) : undefined;
  // The source-type reads (catalog revision, evaluator settings) ride in the one D1 trip of the context; the store's
  // status brings the response it kept for this request and its current data.
  // Query Fan Out and Opportunities group the searches by the project's intents: their revision rides in the same trip.
  const grouped = view === 'fanout' || view === 'opportunities';
  const more = typed
    ? sourceTypeStatements(q.get('project') ?? '', workspaceId, ['source-types', 'content-types'].includes(view))
    : grouped ? [intentRevisionStatement(q.get('project') ?? '')] : [];
  const ctx = await reportContext(workspaceId, q, more, early, undefined, ['reports', String(canonical)], only);
  const types = typed ? await sourceTypeReads(String(ctx.project.id), ctx.more) : null;
  const intentRevision = grouped ? String((ctx.more[0]?.results[0] as { value?: unknown } | undefined)?.value ?? '') : '';
  const revision = types?.revision ?? intentRevision;
  // What else the response depends on, read from D1 beside the status: kept with the response, compared before using it.
  const extras = await digest([ctx.semanticSources, ctx.previousSemanticSources, revision, types?.pending ?? null, types?.classifier ?? null, ...(only ? [only] : [])]);
  const kept = ctx.database.keptResponse(extras);
  if (kept) return { body: view === 'summary' ? askedPeriod(kept, ctx.filter) : kept, expires: Date.now() + KEPT_RESPONSE_TTL_MS, storage: ctx.database.mode, kept: true };
  let expires = 0;
  const report = await cachedAnalyticsQuery(
    `report:${ctx.database.cacheKey}:${canonical}:${JSON.stringify(ctx.project)}:${revision}`,
    async () => {
      let report;
      if (types) return sourceTypeView(view, workspaceId, ctx, q, false, types.pending, types.classifier);
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
        case 'fanout':
          report = await fanoutReport(ctx, q, await projectIntents(String(ctx.project.id), intentRevision));
          break;
        case 'opportunities':
          report = await opportunitiesReport(ctx, await projectIntents(String(ctx.project.id), intentRevision));
          break;
        case 'fanout-detail':
          report = await fanoutDetail(ctx, q);
          break;
        case 'products':
          report = await productsReport(ctx);
          break;
        case 'product-detail':
          report = await productsReport(ctx, (q.get('key') || '').trim());
          break;
        default:
      throw new ApiError(400, 'Invalid report.');
      }
      return report;
    },
    {
      keep: waitUntil,
      onExpiry: (value) => {
        expires = value;
      },
    },
  );
  const body = JSON.stringify(report);
  ctx.database.keepResponse(extras, body);
  return { body, expires, storage: ctx.database.mode, kept: false };
}

/** The summary echoes the period as asked now (the kept one was asked earlier; its bounds select the same answers). */
function askedPeriod(body: string, filter: { cutoff: string; previousCutoff: string; previousEnd: string; end: string }) {
  const report = JSON.parse(body) as { comparison: Record<string, unknown> };
  report.comparison = { ...report.comparison, currentStart: filter.cutoff, previousStart: filter.previousCutoff, previousEnd: filter.previousEnd, end: filter.end };
  return JSON.stringify(report);
}
/** How long the browser reuses a kept response before asking again (the same as a computed one, analytics-query-cache). */
const KEPT_RESPONSE_TTL_MS = 30_000;
