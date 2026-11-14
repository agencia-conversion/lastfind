-- Brain wizard generations of 01/11/2026 that OpenRouter answered with a 5xx were kept as `unknown`, holding their whole reserve, by
-- the reader of that day, which treated a server error as possibly billed. An error answer carries no completion and is not billed
-- (lib/server/decision-jobs.ts since the next day): they are settled as failed at no cost, as a new one is. Only those rows: the
-- Brain wizard, a 5xx answer, no cost reported, that day. Harmless where there are none.
UPDATE brand_research_jobs SET status='failed', reserved_usd=0
WHERE context_key LIKE 'brain-wizard:%' AND status='unknown' AND cost_usd=0 AND error LIKE 'OpenRouter returned HTTP 5__.'
  AND requested_at>='2026-11-01T00:00:00.000Z' AND requested_at<'2026-11-02T00:00:00.000Z';
