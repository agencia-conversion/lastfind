export const USAGE_CREDITS_SQL = `MAX(budget_credits, CAST(cost / 0.0012 + 0.99999999 AS INTEGER))`;
export function reservationSql(budgetCondition: string) {
  return `INSERT OR IGNORE INTO runs (id,owner_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,created_at,budget_credits)
    SELECT ?,?,?,?,?,?,?,?,?,?,'queued',?,?,?
    WHERE (SELECT COUNT(*) FROM runs WHERE owner_id=? AND created_at>=?)<?
    AND (SELECT COUNT(*) FROM runs WHERE created_at>=?)<?
    AND (${budgetCondition})
    AND NOT EXISTS(SELECT 1 FROM runs WHERE prompt_id=? AND status IN ('queued','submitting','pending'))
    AND EXISTS(SELECT 1 FROM prompts JOIN projects ON projects.id=prompts.project_id WHERE prompts.id=? AND prompts.active=1 AND prompts.archived=0 AND projects.archived=0 AND projects.daily_enabled=1 AND prompts.next_run_at<=?)`;
}
