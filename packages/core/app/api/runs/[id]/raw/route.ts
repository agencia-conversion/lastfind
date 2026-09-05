import { requireUser } from '@/lib/server/auth';
import { db } from '@/lib/server/env';
import { rawResponsesBucket } from '@/lib/server/raw-responses';
import { rawArchiveKey, validRawArchiveObject } from '@/lib/raw-responses';
import { fail, ApiError } from '@/lib/server/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(),
      { id } = await params;
    const row = await db()
      .prepare(`SELECT r.id,r.owner_id,r.project_id,r.raw_response_status,r.raw_response_key,r.raw_response_sha256,r.raw_response_bytes
      FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.owner_id=? AND p.owner_id=? AND p.archived=0`)
      .bind(id, user.id, user.id)
      .first<Record<string, unknown>>();
    if (!row) throw new ApiError(404, 'Response not found.');
    if (row.raw_response_status !== 'archived')
      throw new ApiError(
        404,
        'The original provider JSON was not archived for this response.',
      );
    const scope = {
      ownerId: user.id,
      projectId: String(row.project_id),
      runId: id,
    };
    const expected = {
      key: String(row.raw_response_key),
      sha256: String(row.raw_response_sha256),
      bytes: Number(row.raw_response_bytes),
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
