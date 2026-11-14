// The New project wizard's pure rules (new-project-wizard.tsx): the country it starts on and the project's language in words. Its
// suggestions come from the model (new-project-ai.ts); there are no template prompts.
import { COUNTRY_CODES, countryIso } from './countries.ts';

const BRAZIL = 2076;
const UNITED_STATES = 2840;
const byIso = new Map(COUNTRY_CODES.map((code) => [countryIso(code)!, code]));

/**
 * The country a new project starts on: the open project's, else the person's (the region of the browser's languages, the
 * Accept-Language it already sends; nothing new is tracked), else the interface's (Brazil in pt-BR, the United States).
 */
export function wizardCountry(open: number | null | undefined, languages: readonly string[], locale: string): number {
  if (open && COUNTRY_CODES.includes(open)) return open;
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).region;
      const code = region && byIso.get(region.toUpperCase());
      if (code) return code;
    } catch {
      /* Not a language tag. */
    }
  }
  return locale === 'pt-BR' ? BRAZIL : UNITED_STATES;
}

/** An example topic in the project's language (never the interface's): the topics are written in it, and its prompts too. */
export const exampleTopic = (language: string) => (language.startsWith('pt') ? 'software de CRM' : 'CRM software');
/** The project's language by name, in the interface's language. */
export const languageName = (language: string, interfaceLocale: string) =>
  language.startsWith('pt')
    ? interfaceLocale === 'pt-BR' ? 'português' : 'Portuguese'
    : interfaceLocale === 'pt-BR' ? 'inglês' : 'English';

/** What a project is called in the switcher and the lists: its own name, else its brand's (12/11/2026: they may differ). */
export const projectLabel = (project: { name: string; display_name?: string | null }) => project.display_name || project.name;
