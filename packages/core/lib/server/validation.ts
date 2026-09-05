import { normalizeDomain } from '@/lib/metrics';
import { ApiError, textField } from './http';
import type { BrandTarget } from '@/lib/types';
export function projectInput(data: Record<string, unknown>) {
  const name = textField(data.name, 'Marca', 2, 80);
  let domain: string;
  try {
    domain = normalizeDomain(textField(data.domain, 'Domínio', 3, 253));
  } catch (e) {
    throw new ApiError(
      400,
      e instanceof Error ? e.message : 'Domínio inválido',
    );
  }
  const location = Number(data.location_code ?? 2076);
  if (![2076, 2840, 2826].includes(location))
    throw new ApiError(400, 'Mercado inválido.');
  const language = data.language_code ?? 'pt';
  if (typeof language !== 'string' || !['pt', 'en'].includes(language))
    throw new ApiError(400, 'Idioma inválido.');
  const raw = data.competitors ?? [];
  if (!Array.isArray(raw) || raw.length > 5)
    throw new ApiError(400, 'Adicione no máximo 5 concorrentes.');
  const competitors: BrandTarget[] = raw.map((c) => {
    if (!c || typeof c !== 'object')
      throw new ApiError(400, 'Concorrente inválido.');
    try {
      return {
        name: textField(c.name, 'Concorrente', 2, 80),
        domain: normalizeDomain(
          textField(c.domain, 'Domínio do concorrente', 3, 253),
        ),
      };
    } catch (e) {
      throw new ApiError(
        400,
        e instanceof Error ? e.message : 'Concorrente inválido',
      );
    }
  });
  if (
    new Set(
      [name, ...competitors.map((c) => c.name)].map((x) => x.toLowerCase()),
    ).size !==
    competitors.length + 1
  )
    throw new ApiError(
      400,
      'Use nomes diferentes para a marca e seus concorrentes.',
    );
  const category =
    typeof data.category === 'string' ? data.category.trim().slice(0, 100) : '';
  const audience =
    typeof data.audience === 'string' ? data.audience.trim().slice(0, 100) : '';
  return { name, domain, location, language, competitors, category, audience };
}
