import type { Engine, Prompt } from './types';

/** Stable IDs belong to subscriptions; the original canonical ID identifies the question. */
export function promptUnits(prompts: Prompt[]): Prompt[] {
  const units = new Map<string, Prompt>();
  for (const prompt of prompts) {
    const id = prompt.unit_id || prompt.id;
    const existing = units.get(id);
    const subscribed =
      (prompt as Prompt & { subscribed?: number }).subscribed !== 0;
    if (!existing)
      units.set(id, {
        ...prompt,
        id,
        unit_id: id,
        active: Number(
          subscribed && !prompt.archived && Boolean(prompt.active),
        ),
        engines: subscribed ? [prompt.engine] : [],
        subscription_ids: [prompt.id],
        engines_override: JSON.parse(
          String(
            (prompt as Prompt & { engines_override_json?: string })
              .engines_override_json || 'null',
          ),
        ),
      });
    else {
      existing.subscription_ids!.push(prompt.id);
      existing.tags = [...new Set([...existing.tags, ...prompt.tags])];
      existing.archived = Number(Boolean(existing.archived && prompt.archived));
      existing.active = Number(
        Boolean(
          existing.active || (subscribed && !prompt.archived && prompt.active),
        ),
      );
      if (
        subscribed &&
        !existing.engines!.includes(prompt.engine)
      )
        existing.engines!.push(prompt.engine);
      if (prompt.id === id)
        Object.assign(existing, {
          text: prompt.text,
          tag: prompt.tag,
          engines_override: JSON.parse(
            String(
              (prompt as Prompt & { engines_override_json?: string })
                .engines_override_json || 'null',
            ),
          ),
        });
    }
  }
  return [...units.values()].map((unit) =>
    unit.archived && !unit.engines?.length
      ? { ...unit, engines: unit.engines_override ?? [unit.engine] }
      : unit,
  );
}
export function effectiveEngines(
  project: Engine[],
  topic: Engine[] | null | undefined,
  prompt: Engine[] | null | undefined,
): Engine[] {
  return prompt ?? topic ?? project;
}
