import { db, setting } from '@/lib/server/env';
import { json } from '@/lib/server/http';
import { monitoringStorageStatus } from '@/lib/server/monitoring-storage';
export async function GET() {
  const storage = monitoringStorageStatus();
  let database = false;
  try {
    await db().prepare('SELECT 1 AS ok').first();
    database = true;
  } catch {
    // Health describes capabilities without exposing database errors or secrets.
  }
  const ok = database && storage.ready;
  const preview = setting('PREVIEW_MODE') === 'true';
  return json(
    {
      ok,
      service: 'lastfind',
      database,
      rawArchive: storage.rawArchive,
      projectStorage: storage.projectStorage,
      ...(preview ? { previewSha: setting('PREVIEW_SHA') || null } : {}),
    },
    ok ? 200 : 503,
  );
}
