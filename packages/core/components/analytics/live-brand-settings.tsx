'use client';
import { useRef, useState } from 'react';
import type { Project } from '@/lib/types';
import { countryLanguage, type CountryLocale } from '@/lib/countries';
import type { Engine } from '@/lib/engines';
import { SelectField } from '@/components/ui/select';
import { SettingsBlock } from './settings-block';
import { CountrySelect, EngineAvailability } from './country-field';
import { AddressSettings } from './address-settings';
type Copy = (en: string, pt: string) => string;
export function LiveBrandSettings({
  project,
  addressBase,
  canEditAddress,
  save,
  onDirty,
  clearMutationError,
  mutationError,
  busy,
  engines,
  locale,
  t,
}: {
  project: Project;
  /** The address before the project's slug (`/app/<workspace>/`, or `/app/` in the independent edition). */
  addressBase: string;
  /** A workspace admin changes the project's address. */
  canEditAddress: boolean;
  /** The account's AIs, to offer the countries they collect in and say which cannot collect in the chosen one. */
  engines: readonly Engine[];
  locale: CountryLocale;
  save: (values: Record<string, unknown>) => Promise<boolean>;
  onDirty: (dirty: boolean) => void;
  clearMutationError: () => void;
  /** The server's reason when a save failed (a country an AI the project monitors cannot collect in, a repeated domain). */
  mutationError: string;
  busy: boolean;
  t: Copy;
}) {
  const drafts = useRef({ identity: false, market: false, address: false });
  // What the market block shows while it is edited (reset with the form).
  const [market, setMarket] = useState({ location: project.location_code, language: project.language_code });
  type Block = keyof typeof drafts.current;
  const [saving, setSaving] = useState<Block>('identity');
  const failure = (block: Block) =>
    mutationError && saving === block ? (
      <p role="alert" className="col-span-full text-body text-destructive">
        {mutationError}
      </p>
    ) : null;
  const changed = (block: Block, dirty: boolean) => {
    drafts.current[block] = dirty;
    onDirty(Object.values(drafts.current).some(Boolean));
  };
  const split = (value: FormDataEntryValue) =>
    String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  return (
    <div className="space-y-6">
      <SettingsBlock
        title={t('Brand identity', 'Identidade da marca')}
        description={t(
          'Help AI recognize your brand and its domains.',
          'Ajude a IA a reconhecer sua marca e seus domínios.',
        )}
        t={t}
        className="live-settings-brand"
        onCancel={clearMutationError}
        busy={busy}
        onDirty={(dirty) => changed('identity', dirty)}
        save={(data) => {
          setSaving('identity');
          return save({
            ...Object.fromEntries(data),
            aliases: split(data.get('aliases')!),
            additional_domains: split(data.get('additional_domains')!),
          });
        }}
      >
        <label>
          {t('Brand name', 'Nome da marca')}
          <input name="name" required defaultValue={project.name} />
        </label>
        {/* The project's own name (empty: the brand's); the brand above stays the one the answers are read for. */}
        <label>
          {t('Project name (optional)', 'Nome do projeto (opcional)')}
          <input name="display_name" maxLength={80} placeholder={project.name} defaultValue={project.display_name ?? ''} />
        </label>
        <label>
          {t('Primary domain', 'Domínio principal')}
          <input name="domain" required defaultValue={project.domain} />
        </label>
        <label>
          {t(
            'Name variations, comma separated',
            'Variações do nome, separadas por vírgula',
          )}
          <input name="aliases" defaultValue={project.aliases.join(', ')} />
        </label>
        <label>
          {t(
            'Additional domains, comma separated',
            'Domínios adicionais, separados por vírgula',
          )}
          <input
            name="additional_domains"
            defaultValue={project.additional_domains.join(', ')}
          />
        </label>
        {failure('identity')}
      </SettingsBlock>
      <SettingsBlock
        title={t('Market', 'Mercado')}
        description={t(
          'Define the market and audience used to understand your visibility.',
          'Defina o mercado e o público usados para entender sua visibilidade.',
        )}
        t={t}
        className="live-settings-brand"
        onCancel={() => {
          clearMutationError();
          setMarket({ location: project.location_code, language: project.language_code });
        }}
        busy={busy}
        onDirty={(dirty) => changed('market', dirty)}
        save={(data) => {
          setSaving('market');
          return save({
            ...Object.fromEntries(data),
            location_code: Number(data.get('location_code')),
          });
        }}
      >
        <div className="grid content-start gap-1.5">
          <label>
            {t('Country', 'País')}
            <CountrySelect
              name="location_code"
              defaultValue={project.location_code}
              onValueChange={(code) => {
                // The language follows the country; it can still be changed before saving.
                setMarket({ location: code, language: countryLanguage(code) });
              }}
              engines={engines}
              locale={locale}
              t={t}
            />
          </label>
          <EngineAvailability engines={engines} location={market.location} locale={locale} t={t} />
        </div>
        <div className="grid content-start gap-1.5">
          <label>
            {t('Language of prompts and answers', 'Idioma dos prompts e respostas')}
            <SelectField
              name="language_code"
              value={market.language}
              onValueChange={(language) => setMarket((current) => ({ ...current, language }))}
              options={[
                { value: 'en', label: 'English' },
                { value: 'pt', label: 'Português' },
              ]}
            />
          </label>
          <span className="text-caption text-muted-foreground">
            {t(
              'English or Portuguese. Choosing a country sets it: Portuguese in Portuguese-speaking countries, English elsewhere.',
              'Inglês ou português. Escolher o país define o idioma: português nos países de língua portuguesa, inglês nos demais.',
            )}
          </span>
        </div>
        <label>
          {t('Category', 'Categoria')}
          <input name="category" defaultValue={project.category} />
        </label>
        <label>
          {t('Audience', 'Público')}
          <input name="audience" defaultValue={project.audience} />
        </label>
        {failure('market')}
      </SettingsBlock>
      {/* The project's slug in the app's addresses: renaming the project keeps it; changing it here changes the link. */}
      <AddressSettings
        title={t('Project address', 'Endereço do projeto')}
        description={t('Opens this project for anyone with access to it. Renaming the project keeps it.', 'Abre este projeto para quem tem acesso a ele. Renomear o projeto o mantém.')}
        base={addressBase}
        slug={project.slug ?? ''}
        canEdit={canEditAddress}
        busy={busy}
        t={t}
        onDirty={(dirty) => changed('address', dirty)}
        onCancel={clearMutationError}
        error={mutationError && saving === 'address' ? mutationError : undefined}
        save={(slug) => {
          setSaving('address');
          return save({ slug });
        }}
      />
    </div>
  );
}
