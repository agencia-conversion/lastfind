import { competitorIdentity } from '@/lib/competitor-identity';
import { MAX_COMPETITORS } from '@/lib/brand-decisions';
import { normalizeDomain } from '@/lib/metrics';
import { countryLanguage, isCountryCode } from '@/lib/countries';
import { ApiError, textField } from './http';
import type { BrandTarget } from '@/lib/types';
export function projectInput(data: Record<string, unknown>) {
  const name = textField(data.name, 'Marca', 2, 80);
  if (!competitorIdentity(name))
    throw new ApiError(400, 'Marca: use pelo menos uma letra ou número.');
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
  if (!isCountryCode(location)) throw new ApiError(400, 'Mercado inválido.');
  const language = data.language_code ?? countryLanguage(location);
  if (typeof language !== 'string' || !['pt', 'en'].includes(language))
    throw new ApiError(400, 'Idioma inválido.');
  const raw = data.competitors ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_COMPETITORS)
    throw new ApiError(400, `Adicione no máximo ${MAX_COMPETITORS} concorrentes.`);
  const competitors: BrandTarget[] = raw.map((c) => {
    if (!c || typeof c !== 'object')
      throw new ApiError(400, 'Concorrente inválido.');
    try {
      const competitorName = textField(c.name, 'Concorrente', 2, 80);
      if (!competitorIdentity(competitorName))
        throw new ApiError(
          400,
          'Concorrente: use pelo menos uma letra ou número.',
        );
      // Name variations come from brand decisions (merged aliases) and must
      // survive every settings save.
      const aliasInput: unknown[] = Array.isArray(c.aliases) ? c.aliases.slice(0, 10) : [];
      const competitorAliases: string[] = [
        ...new Set(aliasInput.map((alias) => textField(alias, 'Variação de nome', 2, 253))),
      ].filter((alias) => competitorIdentity(alias) !== competitorIdentity(competitorName));
      const competitorDomain = normalizeDomain(textField(c.domain, 'Domínio do concorrente', 3, 253));
      // Its other official domains (12/11/2026, the wizard suggests them): stored with the main one first, as the brand's own
      // snapshot keeps them (target-snapshot.mjs), so an answer citing any of them is the competitor's.
      const domainInput: unknown[] = Array.isArray(c.domains) ? c.domains.slice(0, 11) : [];
      const aliasDomains = [...new Set(domainInput.map((value) => normalizeDomain(textField(value, 'Domínio do concorrente', 3, 253))))].filter((value) => value !== competitorDomain).slice(0, 10);
      return {
        name: competitorName,
        domain: competitorDomain,
        ...(competitorAliases.length ? { aliases: competitorAliases } : {}),
        ...(aliasDomains.length ? { domains: [competitorDomain, ...aliasDomains] } : {}),
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
      [name, ...competitors.map((c) => c.name)].map((x) =>
        competitorIdentity(x),
      ),
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
  const values = (
    value: unknown,
    field: string,
    max: number,
    message: string,
  ) => {
    if (!Array.isArray(value) || value.length > max)
      throw new ApiError(400, message);
    return [
      ...new Set(value.map((item) => textField(item, field, 2, 253).trim())),
    ];
  };
  const aliases = values(
    data.aliases ?? [],
    'variações de nome',
    10,
    'Use up to 10 name variations.',
  );
  if (aliases.some((alias) => !competitorIdentity(alias)))
    throw new ApiError(
      400,
      'Variação de nome: use pelo menos uma letra ou número.',
    );
  const additionalDomains = values(
    data.additional_domains ?? [],
    'domínios adicionais',
    10,
    'Use up to 10 additional domains.',
  ).map((value) => {
    try {
      return normalizeDomain(value);
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error ? error.message : 'Domínio inválido',
      );
    }
  });
  const names = [name, ...aliases].map((value) => competitorIdentity(value));
  if (new Set(names).size !== names.length)
    throw new ApiError(400, 'Não repita o nome da marca nas variações.');
  const competitorNames = new Set(
    competitors.map((competitor) => competitorIdentity(competitor.name)),
  );
  if (aliases.some((alias) => competitorNames.has(competitorIdentity(alias))))
    throw new ApiError(400, 'Não use o nome de um concorrente como variação.');
  const domains = [domain, ...additionalDomains];
  if (new Set(domains).size !== domains.length)
    throw new ApiError(
      400,
      'Não repita o domínio principal nos domínios adicionais.',
    );
  const everyCompetitorDomain = competitors.flatMap((competitor) => competitor.domains ?? [competitor.domain]);
  const competitorDomains = new Set(everyCompetitorDomain);
  if (competitorDomains.size !== everyCompetitorDomain.length)
    throw new ApiError(400, 'Do not repeat competitor domains.');
  if (competitors.some((competitor) => competitor.domains?.slice(1).includes(domain)))
    throw new ApiError(400, 'Não use o domínio da marca como domínio de um concorrente.');
  if (additionalDomains.some((additional) => competitorDomains.has(additional)))
    throw new ApiError(
      400,
      'Não use o domínio de um concorrente como domínio adicional.',
    );
  return {
    name,
    domain,
    aliases,
    additionalDomains,
    location,
    language,
    competitors,
    category,
    audience,
  };
}

/** A project's own name (`display_name`, 12/11/2026): 2 to 80 characters, or nothing for the brand's name. */
export function projectNameInput(value: unknown): string | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  return textField(value, 'Nome do projeto', 2, 80);
}

