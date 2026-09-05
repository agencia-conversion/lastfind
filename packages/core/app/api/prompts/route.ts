import { requireUser } from '@/lib/server/auth';
import {
  body,
  sameOrigin,
  json,
  fail,
  textField,
  ApiError,
} from '@/lib/server/http';
import { addPrompts } from '@/lib/server/prompts';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      data = await body(request);
    const projectId = textField(data.project_id, 'Projeto', 1, 100);
    const inputs = data.prompts ?? [data];
    if (
      !Array.isArray(inputs) ||
      inputs.some((p) => !p || typeof p !== 'object' || Array.isArray(p))
    )
      throw new ApiError(400, 'Prompts inválidos.');
    return json(await addPrompts(u.id, projectId, inputs), 201);
  } catch (e) {
    return fail(e);
  }
}
