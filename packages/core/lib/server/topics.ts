import { db } from './env';
export function syncTopics(project: string, owner: string) {
  return db()
    .prepare(`INSERT OR IGNORE INTO topics(id,project_id,name,created_at)
    SELECT lower(hex(randomblob(16))),project_id,tag,MIN(created_at) FROM prompts
    WHERE project_id=? AND archived=0 AND EXISTS(SELECT 1 FROM projects WHERE id=prompts.project_id AND owner_id=?) GROUP BY project_id,tag`)
    .bind(project, owner);
}
