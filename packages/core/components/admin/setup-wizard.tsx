'use client';
// The independent edition's first run (/app/setup, apps/selfhost): an empty installation opens here before the project wizard,
// and a finished one never again (apps/selfhost/lib/setup-state.ts). Same look and steps as the New project wizard (its layout
// classes, WizardSteps, SectionCard, Field, the nav row). Whoever installs is the installation's admin, so providers are named;
// predicted costs are never shown. Steps: the admin account, the provider keys (the Providers card itself, each with its free
// test), the defaults (interface language, workspace time zone, the installation's monthly cap), then the hand-off to a first project.
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { requestJson } from '@/lib/client';
import { numberLocale } from '@/lib/number-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectField } from '@/components/ui/select';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { PageHeading } from '@/components/lastfind/presentation/page-heading';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { Note } from '@/components/lastfind/presentation/note';
import { WizardSteps } from '@/components/lastfind/presentation/wizard-steps';
import { LastfindLogo } from '@/components/lastfind/lastfind-logo';
import { LanguageMenu } from '@/components/lastfind/public-menu';
import { CopyField } from '@/components/analytics/api-access-settings';
import { SearchSelect, timeZoneOptions } from '@/components/analytics/country-field';
import { AdminLoadError } from './admin-states';
import { configured, PROVIDERS, ProviderCard, type ProvidersData } from './admin-providers';
import '@/components/analytics/new-project-wizard.css';

type Copy = (en: string, pt: string) => string;
type StepId = 'admin' | 'providers' | 'defaults' | 'start';
const STEPS: { id: StepId; label: [string, string] }[] = [
  { id: 'admin', label: ['Admin account', 'Conta de admin'] },
  { id: 'providers', label: ['Providers', 'Provedores'] },
  { id: 'defaults', label: ['Defaults', 'Padrões'] },
  { id: 'start', label: ['Start', 'Começar'] },
];
// Search data first, then the model providers in the order calls follow by default.
const SETUP_PROVIDERS = ['dataforseo', 'openai', 'anthropic', 'openrouter'].map((id) => PROVIDERS.find((provider) => provider.id === id)!);
/** The installation's monthly cap the wizard suggests (US$): a ceiling the admin chooses, not an estimate. */
const RECOMMENDED_CAP = '100';
// A random access key, as the installer makes one: 32 bytes, base64url (43 characters).
const newAccessKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export function SetupWizard({ stage }: { stage: 'admin' | 'setup' }) {
  const { locale, setLocale } = useI18n();
  const t: Copy = (en, pt) => (locale === 'pt-BR' ? pt : en);
  const formId = useId();
  // Once the admin exists the wizard opens on the providers and never goes back to the admin step.
  const first = stage === 'admin' ? 0 : 1;
  const [step, setStep] = useState(first);
  const [setupToken, setSetupToken] = useState('');
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [providers, setProviders] = useState<ProvidersData | null>(null);
  const [providersFailed, setProvidersFailed] = useState(false);
  const [zone, setZone] = useState('UTC');
  const [cap, setCap] = useState(RECOMMENDED_CAP);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    // Only in the browser: the key and the zone are the person's, never rendered on the server.
    queueMicrotask(() => {
      setKey(newAccessKey());
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    });
  }, []);
  const loadProviders = useCallback(
    () =>
      fetch('/api/admin/providers', { cache: 'no-store' })
        .then((response) => (response.ok ? (response.json() as Promise<ProvidersData>) : Promise.reject(new Error(String(response.status)))))
        .then((data) => {
          setProviders(data);
          setProvidersFailed(false);
        }, () => setProvidersFailed(true)),
    [],
  );
  const id = STEPS[step].id;
  useEffect(() => {
    if (id === 'providers' && !providers) void loadProviders();
  }, [id, providers, loadProviders]);
  const zones = useMemo(() => timeZoneOptions(numberLocale(locale), zone), [locale, zone]);

  const capValue = cap.trim() === '' ? null : Number(cap);
  const problem = ((): string | null => {
    if (id === 'admin') {
      if (!setupToken.trim()) return t('Enter the setup token of this installation.', 'Informe o token de configuração desta instalação.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return t('Enter a valid email.', 'Informe um e-mail válido.');
      if (!keySaved) return t('Confirm that you saved the access key.', 'Confirme que você guardou a chave de acesso.');
    }
    if (id === 'defaults' && capValue !== null && (!Number.isFinite(capValue) || capValue < 0 || capValue > 10_000_000))
      return t('Enter a cap of 0 or more, or leave it empty for no cap.', 'Informe um teto de 0 ou mais, ou deixe vazio para não ter teto.');
    return null;
  })();
  const go = (target: number) => {
    setAttempted(false);
    setError('');
    setStep(target);
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  };
  const submit = async (send: () => Promise<unknown>, then: () => void) => {
    if (problem) return setAttempted(true);
    setBusy(true);
    setError('');
    try {
      await send();
      then();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const next = () => {
    if (id === 'admin') return void submit(() => requestJson('/api/setup', 'POST', { action: 'admin', setupToken: setupToken.trim(), email: email.trim(), key }), () => go(1));
    if (id === 'defaults')
      return void submit(() => requestJson('/api/setup', 'POST', { action: 'complete', timeZone: zone, monthUsd: capValue }), () => go(3));
    go(step + 1);
  };
  const searchReady = !!providers && configured(providers, SETUP_PROVIDERS[0].keys);
  // The classifiers' decision models are only on OpenRouter: the one model provider the wizard recommends.
  const openrouterReady = !!providers && configured(providers, SETUP_PROVIDERS[3].keys);

  const body: Record<StepId, ReactNode> = {
    admin: (
      <SectionCard inset="padded" className="pt-5">
        <div className="grid gap-5">
          <Field>
            <FieldLabel htmlFor={`${formId}-token`}>{t('Setup token', 'Token de configuração')}</FieldLabel>
            <Input id={`${formId}-token`} type="password" autoComplete="off" spellCheck={false} maxLength={256} value={setupToken} aria-invalid={attempted && !setupToken.trim() ? true : undefined} onChange={(event) => setSetupToken(event.target.value)} />
            <FieldDescription>
              {t('Proves you deployed this installation. It is the SETUP_TOKEN secret you set on the Worker, or, without one, the token printed once to the Worker log on the first visit (read it with wrangler tail).', 'Prova que foi você quem publicou esta instalação. É o secret SETUP_TOKEN que você definiu no Worker ou, sem ele, o token impresso uma vez no log do Worker na primeira visita (leia com wrangler tail).')}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-email`}>{t('Your email', 'Seu e-mail')}</FieldLabel>
            <Input id={`${formId}-email`} type="email" autoComplete="email" maxLength={254} value={email} aria-invalid={attempted && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? true : undefined} onChange={(event) => setEmail(event.target.value)} />
            <FieldDescription>{t('The admin of this installation: it shows in Admin and in the change log.', 'O admin desta instalação: aparece no Admin e no registro de alterações.')}</FieldDescription>
          </Field>
          {key ? (
            <CopyField id={`${formId}-key`} label={t('Access key', 'Chave de acesso')} value={key} t={t} />
          ) : (
            <SectionCard loading lines={1} />
          )}
          <Note className="px-0 py-0">
            {t('You sign in with this key. It is shown only now: copy it into your password manager. Lastfind keeps only a hash of it.', 'Você entra com esta chave. Ela aparece só agora: copie-a para o seu gerenciador de senhas. O Lastfind guarda só um hash dela.')}
          </Note>
          <Field orientation="horizontal">
            <Checkbox id={`${formId}-saved`} checked={keySaved} aria-invalid={attempted && !keySaved ? true : undefined} onCheckedChange={(checked) => setKeySaved(checked === true)} />
            <FieldLabel htmlFor={`${formId}-saved`}>{t('I saved the access key', 'Guardei a chave de acesso')}</FieldLabel>
          </Field>
        </div>
      </SectionCard>
    ),
    providers: providersFailed ? (
      <AdminLoadError />
    ) : !providers ? (
      <>
        <SectionCard loading lines={4} />
        <SectionCard loading lines={3} />
      </>
    ) : (
      <>
        {SETUP_PROVIDERS.filter((provider) => providers.providers.includes(provider.id)).map((provider) => (
          <ProviderCard key={provider.id} provider={provider} data={providers} step={null} onSaved={loadProviders} t={t} locale={locale} />
        ))}
        <Note className="px-0">
          {[
            searchReady
              ? ''
              : t('Recommended: add the DataForSEO credentials now. Without them collection waits; you can add them later in Admin > Providers.', 'Recomendado: adicione as credenciais do DataForSEO agora. Sem elas a coleta espera; você pode adicioná-las depois em Admin > Provedores.'),
            openrouterReady
              ? ''
              : t('Recommended: an OpenRouter key, the one provider of the classifiers. OpenAI and Anthropic are optional; model calls try OpenAI, then Anthropic, then OpenRouter.', 'Recomendado: uma chave do OpenRouter, o único provedor dos classificadores. OpenAI e Anthropic são opcionais; as chamadas de modelo tentam a OpenAI, depois a Anthropic, depois o OpenRouter.'),
          ].filter(Boolean).join(' ') || t('Everything recommended is set. Change keys or their order later in Admin > Providers.', 'Tudo o que é recomendado está definido. Troque chaves ou a ordem depois em Admin > Provedores.')}
        </Note>
      </>
    ),
    defaults: (
      <SectionCard inset="padded" className="pt-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${formId}-language`}>{t('Interface language', 'Idioma da interface')}</FieldLabel>
            <SelectField<'en' | 'pt-BR'>
              id={`${formId}-language`}
              value={locale === 'pt-BR' ? 'pt-BR' : 'en'}
              onValueChange={setLocale}
              options={[
                { value: 'en', label: 'English' },
                { value: 'pt-BR', label: 'Português (Brasil)' },
              ]}
            />
            <FieldDescription>{t('Recommended: the language you work in. New projects suggest their market from it.', 'Recomendado: o idioma em que você trabalha. Novos projetos sugerem o mercado a partir dele.')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-zone`}>{t('Time zone', 'Fuso horário')}</FieldLabel>
            <SearchSelect id={`${formId}-zone`} value={zone} defaultValue={zone} onValueChange={setZone} options={zones} locale={locale} search={t('Search a time zone', 'Busque um fuso horário')} empty={t('No time zone found.', 'Nenhum fuso horário encontrado.')} />
            <FieldDescription>{t('Recommended: yours. Collections run on the day and hour of each project in this zone.', 'Recomendado: o seu. As coletas rodam no dia e no horário de cada projeto neste fuso.')}</FieldDescription>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor={`${formId}-cap`}>{t('Monthly cap for the installation (US$)', 'Teto mensal da instalação (US$)')}</FieldLabel>
            <Input id={`${formId}-cap`} className="w-full sm:max-w-xs" inputMode="decimal" value={cap} aria-invalid={attempted && !!problem ? true : undefined} onChange={(event) => setCap(event.target.value)} />
            <FieldDescription>
              {t(`Recommended: US$ ${RECOMMENDED_CAP} to start. When the month reaches it, paid work pauses until the next month or until you raise it in Admin > Usage and costs. Each project also keeps its own budget in Settings > Monitoring. Leave empty for no cap.`, `Recomendado: US$ ${RECOMMENDED_CAP} para começar. Quando o mês chega a ele, o trabalho pago pausa até o mês seguinte ou até você aumentá-lo em Admin > Uso e custos. Cada projeto também tem o próprio orçamento em Configurações > Monitoramento. Deixe vazio para não ter teto.`)}
            </FieldDescription>
          </Field>
        </div>
      </SectionCard>
    ),
    start: (
      <SectionCard title={t('What is set', 'O que está definido')}>
        <DataTable
          singleLine="wide"
          ariaLabel={t('What is set', 'O que está definido')}
          rows={SETUP_PROVIDERS.filter((provider) => !providers || providers.providers.includes(provider.id))}
          rowKey={(row) => row.id}
          columns={[
            { key: 'name', header: t('Provider', 'Provedor'), mobile: 'title', cell: (row) => row.name },
            {
              key: 'state',
              header: t('State', 'Estado'),
              label: t('State', 'Estado'),
              align: 'end',
              cell: (row) => {
                const set = !!providers && configured(providers, row.keys);
                return <TagBadge tone={set ? 'success' : 'neutral'}>{set ? t('Set', 'Definida') : t('Not set', 'Não definida')}</TagBadge>;
              },
            },
          ]}
        />
        <Note>
          {t('Language, time zone, keys and the monthly cap change in Admin and Settings at any time. This setup does not open again.', 'Idioma, fuso, chaves e o teto mensal mudam no Admin e em Configurações quando quiser. Esta configuração não abre de novo.')}
        </Note>
      </SectionCard>
    ),
  };
  const descriptions: Record<StepId, [string, string]> = {
    admin: ['The account that administers this installation. You sign in with the access key below.', 'A conta que administra esta instalação. Você entra com a chave de acesso abaixo.'],
    providers: ['Search data collects the AI answers; a model provider reads them. Each key is tested for free before you save it, and is stored sealed.', 'Os dados de busca coletam as respostas das IAs; um provedor de modelo as lê. Cada chave é testada de graça antes de salvar e fica guardada selada.'],
    defaults: ['Starting points for this installation. Each one changes later in Admin or Settings.', 'Pontos de partida desta instalação. Cada um muda depois no Admin ou em Configurações.'],
    start: ['Your installation is ready. Next, create the first project: brand, competitors, topics, prompts and AIs.', 'Sua instalação está pronta. Agora crie o primeiro projeto: marca, concorrentes, tópicos, prompts e IAs.'],
  };

  return (
    // `live-app` and `live-content`: the pane the catalog's tables measure, so on a phone the summary stacks as cards as in the app.
    <main className="live-app mx-auto w-full max-w-5xl px-(--content-gutter) py-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <LastfindLogo style={{ height: 32, width: 101 }} />
        <LanguageMenu locale={locale} instance="setup" onSelect={setLocale} />
      </div>
      <div className="new-project-wizard live-content">
        {id === 'admin' ? (
          <PageHeading
            title={t('Set up your Lastfind installation', 'Configure a sua instalação do Lastfind')}
            description={t('Create the admin account, connect the providers and choose the defaults. It takes a few minutes; then you create your first project.', 'Crie a conta de admin, conecte os provedores e escolha os padrões. Leva poucos minutos; depois você cria o primeiro projeto.')}
          />
        ) : (
          <p className="text-body text-muted-foreground">
            {t('Set up the admin account, providers and defaults of this installation.', 'Configure a conta de admin, os provedores e os padrões desta instalação.')}
          </p>
        )}
        <WizardSteps variant="progress" steps={STEPS.map((item) => t(...item.label))} current={step} label={t('Steps', 'Passos')} />
        {id !== 'admin' && <PageHeading title={t(...STEPS[step].label)} description={t(...descriptions[id])} />}
        {body[id]}
        {attempted && problem && <Note tone="danger" className="px-0">{problem}</Note>}
        {error && <Note tone="danger" className="px-0">{error}</Note>}
        <div className="new-project-nav">
          <Button variant="ghost" disabled={step <= 1 || id === 'start' || busy} onClick={() => go(step - 1)}>{t('Back', 'Voltar')}</Button>
          {id === 'start' ? (
            <Button nativeButton={false} render={<a href="/app" aria-label={t('Create your first project', 'Criar o primeiro projeto')} />}>{t('Create your first project', 'Criar o primeiro projeto')}</Button>
          ) : (
            <Button pending={busy} onClick={next}>
              {id === 'admin' ? t('Create admin', 'Criar admin') : id === 'defaults' ? t('Finish setup', 'Concluir configuração') : t('Next', 'Avançar')}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
