import { isAdmin } from '@edition/lib/admin-access';
import { currentUser, requireActor } from '@/lib/server/auth';
import { db } from '@/lib/server/env';
import { rawResponsesBucket } from '@/lib/server/raw-responses';
import { rawArchiveKey, validRawArchiveObject } from '@/lib/raw-responses';
import { fail, ApiError } from '@/lib/server/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireActor(),
      { id } = await params;
    // The provider's own JSON (its metadata and cost) is for whoever runs the installation, never a Cloud customer.
    if (!isAdmin(await currentUser())) throw new ApiError(404, 'Response not found.');
    const row = await db()
      // A project that moved workspace keeps its archives under the owner it had when they were written.
      .prepare(`SELECT r.id,r.workspace_id,r.project_id,r.raw_response_status,r.raw_response_key,r.raw_response_sha256,r.raw_response_bytes,
      (SELECT json_extract(m.value,'$.fromWorkspaceId') FROM system_state m WHERE m.key='project_move:'||r.project_id AND json_extract(m.value,'$.toWorkspaceId')=r.workspace_id) moved_from
      FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.workspace_id=? AND p.workspace_id=? AND p.archived=0`)
      .bind(id, user.workspaceId, user.workspaceId)
      .first<Record<string, unknown>>();
    if (!row) throw new ApiError(404, 'Response not found.');
    if (row.raw_response_status !== 'archived')
      throw new ApiError(
        404,
        'The original provider JSON was not archived for this response.',
      );
    const expected = {
      key: String(row.raw_response_key),
      sha256: String(row.raw_response_sha256),
      bytes: Number(row.raw_response_bytes),
    };
    const owners = [user.workspaceId, ...(row.moved_from ? [String(row.moved_from)] : [])];
    const scope = {
      workspaceId: owners.find((workspaceId) => expected.key === rawArchiveKey({ workspaceId, projectId: String(row.project_id), runId: id }, expected.sha256)) ?? user.workspaceId,
      projectId: String(row.project_id),
      runId: id,
    };
    // Refuse an incorrect database pointer before making any object-store read.
    if (
      !/^[a-f0-9]{64}$/.test(expected.sha256) ||
      expected.key !== rawArchiveKey(scope, expected.sha256)
    )
      throw new ApiError(
        409,
        'The response archive failed its integrity check.',
      );
    const bucket = rawResponsesBucket();
    if (!bucket)
      throw new ApiError(
        503,
        'The response archive is temporarily unavailable.',
      );
    const object = await bucket.get(expected.key);
    if (!object)
      throw new ApiError(
        404,
        'The archived provider JSON is no longer available.',
      );
    if (!validRawArchiveObject(scope, expected, object))
      throw new ApiError(
        409,
        'The response archive failed its integrity check.',
      );
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="lastfind-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json"`,
        'Content-Length': String(object.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Content-SHA256': expected.sha256,
        ETag: object.httpEtag,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
