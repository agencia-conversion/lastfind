'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { MODEL_PROVIDER_NAMES, type ModelProvider } from '@/lib/model-providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { AdminLoadError } from './admin-states';

type SecretKey = 'DATAFORSEO_LOGIN' | 'DATAFORSEO_PASSWORD' | 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'CLOUDFLARE_ANALYTICS_TOKEN' | 'CLOUDFLARE_ACCOUNT_ID';
/**
 * `source`: where the value in effect comes from (`stored`: saved here; `env`: the Worker's own secret). `worker`: hint of
 * the Worker's own value whenever it has one, also behind a saved one. `unreadable`: a saved value no credentials key can open.
 */
type Secret = { key: SecretKey; set: boolean; source: 'env' | 'stored' | 'unreadable' | null; hint: string | null; worker: string | null; unreadable: boolean };
type Audit = { at: string; actor: string; action: string; key: string };
/** `updatedAt`: when each value saved here was last written. */
export type ProvidersData = { providers: string[]; secrets: Secret[]; updatedAt?: Partial<Record<SecretKey, string>>; redirectUris: string[]; audit: Audit[]; models?: ModelsState };
/** The model providers' order and state (lib/server/admin-settings.ts, modelProvidersState). */
type ModelsState = {
  order: ModelProvider[];
  saved: boolean;
  configured: Record<ModelProvider, boolean>;
  today: { provider: ModelProvider; calls: number; failovers: number; costUsd: number; unpriced: number; lastAt: string | null; lastTask: string | null; lastModel: string | null; lastError: string | null; lastErrorAt: string | null; lastErrorTask: string | null }[];
  functions: { id: string; label: [string, string]; model: string; decisions: boolean; models: Record<ModelProvider, string | null>; servedBy: ModelProvider | null }[];
};
type Check =
  | { ok: true; balance: number | null }
  | { ok: false; reason: 'invalid' | 'unreachable' | 'unexpected' | 'permission'; status?: number };
type Copy = (en: string, pt: string) => string;

export const PROVIDERS: {
  id: 'dataforseo' | 'openai' | 'anthropic' | 'openrouter' | 'google' | 'cloudflare';
  name: string;
  keys: SecretKey[];
  required: boolean;
  /** Part of the guided first-time setup (the sign-in client is not: the app works without it). */
  setup: boolean;
  /** Has a free endpoint that confirms the credential; otherwise only its format is checked on save. */
  check: boolean;
  use: [string, string];
  /** What replacing the value in effect does to the whole installation (the confirmation's text). */
  impact: [string, string];
  where: [string, string];
  site: string;
  fields: Record<string, [string, string]>;
  /** Not secret: shown in full, and read-only when the deployment sets it (a Worker variable). */
  plain?: SecretKey[];
}[] = [
  {
    id: 'dataforseo',
    name: 'DataForSEO',
    keys: ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'],
    required: true,
    setup: true,
    check: true,
    use: ['Collects the AI answers that every report is built on. Required.', 'Coleta as respostas das IAs em que todos os relatórios se baseiam. Obrigatória.'],
    impact: ['Every project of this installation collects its answers with these credentials within a minute. A wrong value stops collection for everyone until it is fixed.', 'Todos os projetos desta instalação passam a coletar respostas com estas credenciais em até um minuto. Um valor errado para a coleta de todos até ser corrigido.'],
    where: ['In the DataForSEO dashboard open API Access: the login is the account email and the API password is generated there (it is not the site password).', 'No painel do DataForSEO abra API Access: o login é o e-mail da conta e a senha da API é gerada ali (não é a senha de entrada no site).'],
    site: 'https://app.dataforseo.com/api-access',
    fields: { DATAFORSEO_LOGIN: ['API login (email)', 'Login da API (e-mail)'], DATAFORSEO_PASSWORD: ['API password', 'Senha da API'] },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keys: ['OPENAI_API_KEY'],
    required: false,
    setup: true,
    check: true,
    use: ['Runs the agent, the wizards, the search intents and the learning review with OpenAI models, and the classifiers set to OpenAI\'s decision model, when it comes first in the order of model providers. Optional.', 'Roda o agente, os wizards, as intenções de busca e a revisão de aprendizado com modelos da OpenAI, e os classificadores definidos no modelo de decisão da OpenAI, quando vem primeiro na ordem dos provedores de modelo. Opcional.'],
    impact: ['Model calls in the order of model providers use this key within a minute, and their cost goes to its OpenAI organization. A wrong key moves those calls to the next provider in the order.', 'As chamadas de modelo na ordem dos provedores passam a usar esta chave em até um minuto, e o custo vai para a organização dela na OpenAI. Uma chave errada passa essas chamadas ao próximo provedor da ordem.'],
    where: [
      'Create a secret key at platform.openai.com/api-keys (it starts with sk-). To spend your ChatGPT subscription\'s API credits (Pro and Business plans, from 7 days after subscribing), link that subscription to the API organization first: ChatGPT, Settings, Billing, API credits, then create the key in that organization. Every key of the organization uses those credits before any purchased balance; unused credits expire at the end of each billing cycle. When they run out and there is no purchased balance, OpenAI refuses the calls and the next provider in the order answers them.',
      'Crie uma chave secreta em platform.openai.com/api-keys (ela começa com sk-). Para gastar os créditos de API da sua assinatura do ChatGPT (planos Pro e Business, a partir de 7 dias da assinatura), vincule antes a assinatura à organização da API: ChatGPT, Configurações, Faturamento, Créditos de API, e crie a chave nessa organização. Toda chave da organização usa esses créditos antes de qualquer saldo comprado; o que sobrar expira no fim de cada ciclo de cobrança. Quando acabam e não há saldo comprado, a OpenAI recusa as chamadas e o próximo provedor da ordem as responde.',
    ],
    site: 'https://platform.openai.com/api-keys',
    fields: { OPENAI_API_KEY: ['API key', 'Chave da API'] },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    keys: ['ANTHROPIC_API_KEY'],
    required: false,
    setup: true,
    check: true,
    use: ['Runs the agent, the wizards, the search intents and the learning review with Claude models when it comes before OpenRouter in the order of model providers. Anthropic has no decision model with probabilities: the classifiers never use it. Optional.', 'Roda o agente, os wizards, as intenções de busca e a revisão de aprendizado com modelos Claude quando vem antes do OpenRouter na ordem dos provedores de modelo. A Anthropic não tem modelo de decisão com probabilidades: os classificadores nunca a usam. Opcional.'],
    impact: ['Model calls in the order of model providers use this key within a minute, and their cost goes to its Console organization. A wrong key moves those calls to the next provider in the order.', 'As chamadas de modelo na ordem dos provedores passam a usar esta chave em até um minuto, e o custo vai para a organização dela no Console. Uma chave errada passa essas chamadas ao próximo provedor da ordem.'],
    where: [
      'Create a key in the Claude Console, Settings, API keys (it starts with sk-ant-). To spend your Claude plan\'s monthly API credits (Max, Ultra and Team plans, from 7 days after subscribing; not Pro), link the Console organization on claude.ai first: Settings, Billing, API credits, Link organization, then create the key in that organization. Every key of the organization draws from those credits first; unused credits expire at the end of each billing cycle. The usage limits of claude.ai and Claude Code are separate and never pay for these calls.',
      'Crie uma chave no Claude Console, Settings, API keys (ela começa com sk-ant-). Para gastar os créditos mensais de API do seu plano Claude (planos Max, Ultra e Team, a partir de 7 dias da assinatura; o Pro não tem), vincule antes a organização do Console no claude.ai: Configurações, Faturamento, Créditos de API, Vincular organização, e crie a chave nessa organização. Toda chave da organização usa esses créditos primeiro; o que sobrar expira no fim de cada ciclo de cobrança. Os limites de uso do claude.ai e do Claude Code são outros e nunca pagam estas chamadas.',
    ],
    site: 'https://platform.claude.com/settings/keys',
    fields: { ANTHROPIC_API_KEY: ['API key', 'Chave da API'] },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keys: ['OPENROUTER_API_KEY'],
    required: false,
    setup: true,
    check: true,
    use: ['Runs the classifiers (sentiment, roles per question, source types and brand domains: their decision models, Liquid and TypeSafe, are only there) and any model call the providers before it in the order cannot take. Optional; without it those readings stay pending.', 'Roda os classificadores (sentimento, papéis por pergunta, tipos de fonte e domínios de marca: os modelos de decisão deles, Liquid e TypeSafe, só existem lá) e toda chamada de modelo que os provedores antes dele na ordem não puderem atender. Opcional; sem ela essas leituras ficam pendentes.'],
    impact: ['Every project\'s classifiers (sentiment, roles per question, source types and brand domains) use this key within a minute, and their cost goes to its account. A wrong key leaves those readings pending for everyone until it is fixed.', 'Os classificadores de todos os projetos (sentimento, papéis por pergunta, tipos de fonte e domínios de marca) passam a usar esta chave em até um minuto, e o custo vai para a conta dela. Uma chave errada deixa essas leituras pendentes para todos até ser corrigida.'],
    where: ['Create a key at openrouter.ai/keys (it starts with sk-or-).', 'Crie uma chave em openrouter.ai/keys (ela começa com sk-or-).'],
    site: 'https://openrouter.ai/keys',
    fields: { OPENROUTER_API_KEY: ['API key', 'Chave da API'] },
  },
  {
    id: 'google',
    name: 'Google sign-in',
    keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    required: false,
    setup: false,
    check: false,
    use: ['The OAuth client behind "Continue with Google" on the login screen. Optional: without it the screen offers the email code only.', 'O cliente OAuth por trás de "Continuar com Google" na tela de entrada. Opcional: sem ele a tela oferece só o código por email.'],
    impact: ['"Continue with Google" uses this client for everyone within a minute. A wrong value stops Google sign-in until it is fixed; the email code keeps working.', '"Continuar com Google" passa a usar este cliente para todos em até um minuto. Um valor errado para a entrada com Google até ser corrigido; o código por email continua funcionando.'],
    where: ['Google Cloud console, APIs and Services, Credentials: an OAuth client ID of type Web application. Register every redirect URI listed below, exactly. There is no free check: the values are validated by format and confirmed by signing in with Google.', 'Console do Google Cloud, APIs e serviços, Credenciais: um ID do cliente OAuth do tipo Aplicativo da Web. Cadastre exatamente cada URI de redirecionamento listada abaixo. Não há verificação gratuita: os valores são validados pelo formato e confirmados entrando com o Google.'],
    site: 'https://console.cloud.google.com/apis/credentials',
    fields: { GOOGLE_CLIENT_ID: ['Client ID', 'ID do cliente'], GOOGLE_CLIENT_SECRET: ['Client secret', 'Segredo do cliente'] },
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    keys: ['CLOUDFLARE_ANALYTICS_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
    required: false,
    setup: false,
    check: true,
    use: ['Reads this Cloudflare account\'s usage and estimated cost in Admin, Usage and costs. Optional: without it that section says it is not configured.', 'Lê o uso e o custo estimado desta conta da Cloudflare em Admin, Uso e custos. Opcional: sem ele essa seção diz que não está configurada.'],
    impact: ['Usage and costs reads this account with this token from the next visit. A wrong token only leaves that section without numbers; nothing else changes.', 'Uso e custos passa a ler esta conta com este token a partir da próxima visita. Um token errado só deixa essa seção sem números; nada mais muda.'],
    where: ['In the Cloudflare dashboard open My Profile, API Tokens, Create Token, Custom token. Permissions: one row, Account, Account Analytics, Read. Account Resources: Include, this account only. No zone permission. The token only reads.', 'No painel da Cloudflare abra My Profile, API Tokens, Create Token, Custom token. Permissions: uma linha, Account, Account Analytics, Read. Account Resources: Include, só esta conta. Nenhuma permissão de zona. O token só lê.'],
    site: 'https://dash.cloudflare.com/profile/api-tokens',
    fields: { CLOUDFLARE_ANALYTICS_TOKEN: ['API token', 'Token da API'], CLOUDFLARE_ACCOUNT_ID: ['Account ID', 'ID da conta'] },
    plain: ['CLOUDFLARE_ACCOUNT_ID'],
  },
];
export const configured = (data: ProvidersData, keys: SecretKey[]) => keys.every((key) => data.secrets.find((secret) => secret.key === key)?.set);

async function patch(body: Record<string, unknown>) {
  const response = await fetch('/api/admin/providers', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response?.ok) throw new Error(typeof json?.error === 'string' ? json.error : `HTTP ${response?.status ?? 0}`);
  return json ?? {};
}

export function ProviderCard({ provider, data, step, onSaved, onSkip, t, locale }: { provider: (typeof PROVIDERS)[number]; data: ProvidersData; step: number | null; onSaved: () => Promise<void> | void; onSkip?: () => void; t: Copy; locale: string }) {
  const secrets = provider.keys.map((key) => data.secrets.find((secret) => secret.key === key)!);
  const ready = secrets.every((secret) => secret.set);
  const saved = secrets.some((secret) => secret.source === 'stored' || secret.unreadable);
  const unreadable = secrets.some((secret) => secret.unreadable);
  const fallback = secrets.every((secret) => secret.worker);
  const [values, setValues] = useState<Partial<Record<SecretKey, string>>>({});
  // Which action waits for confirmation: removing the saved value, or replacing a value in effect for everyone.
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'replace'; open: boolean }>({ kind: 'remove', open: false });
  const ask = (kind: 'remove' | 'replace') => setConfirm({ kind, open: true });
  const replaceAsked = confirm.kind === 'replace';
  // A provider already set shows what is in effect; its form opens only on Replace (and after its value is removed).
  const [replaceOpen, setEditing] = useState(false);
  const editing = replaceOpen || !ready;
  const firstField = useRef<HTMLInputElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'checking' | 'saving' | 'removing' | 'saved' | 'removed' | 'check' | 'error'; check?: Check; message?: string }>({ kind: 'idle' });
  const typed = (key: SecretKey) => !!values[key]?.trim();
  const typedAny = provider.keys.some(typed);
  // A plain value the deployment sets is shown, never typed over.
  const locked = (secret: Secret) => !!provider.plain?.includes(secret.key) && secret.source === 'env';
  // A pair is never left half set: every field is typed or already has a value in effect.
  const canSave = typedAny && secrets.every((secret) => typed(secret.key) || secret.set);
  // Saving over a value in effect (saved here or the Worker's) changes the whole installation: it asks first.
  const replacing = secrets.some((secret) => secret.set && typed(secret.key));
  const tested = state.kind === 'check' && state.check?.ok === true;
  const checkResult = (check: Check) =>
    check.ok
      ? check.balance === null
        ? t('Accepted by the provider.', 'Aceita pelo provedor.')
        : provider.id === 'dataforseo'
          ? t(`Accepted by the provider. Balance US$ ${check.balance.toFixed(2)}.`, `Aceita pelo provedor. Saldo US$ ${check.balance.toFixed(2)}.`)
          : t(`Accepted by the provider. Spending limit left US$ ${check.balance.toFixed(2)}.`, `Aceita pelo provedor. Limite de gasto restante US$ ${check.balance.toFixed(2)}.`)
      : check.reason === 'invalid'
        ? t('Not accepted by the provider. Check the value and try again.', 'Não aceita pelo provedor. Confira o valor e tente de novo.')
        : check.reason === 'permission'
          ? t('The token is valid but cannot read this account\'s analytics. Give it Account Analytics: Read on this account.', 'O token é válido, mas não lê a análise desta conta. Dê a ele Account Analytics: Read nesta conta.')
        : check.reason === 'unreachable'
          ? t('Could not reach the provider. Try again in a moment.', 'Não foi possível falar com o provedor. Tente de novo em instantes.')
          : t(`The provider answered unexpectedly (HTTP ${check.status ?? 0}).`, `O provedor respondeu de forma inesperada (HTTP ${check.status ?? 0}).`);
  const run = async (kind: 'checking' | 'saving' | 'removing') => {
    setConfirm((current) => ({ ...current, open: false }));
    setState({ kind });
    try {
      if (kind === 'checking') {
        const typedValues = Object.fromEntries(provider.keys.map((key) => [key, values[key] ?? '']));
        const { check } = (await patch({ action: 'check', provider: provider.id, ...typedValues })) as { check: Check };
        setState({ kind: 'check', check });
        return;
      }
      // One request per provider: the server checks every value before writing any.
      const changes = kind === 'removing' ? secrets.filter((secret) => secret.source === 'stored' || secret.unreadable).map((secret) => [secret.key, '']) : provider.keys.filter(typed).map((key) => [key, values[key]!.trim()]);
      await patch({ action: 'save', values: Object.fromEntries(changes) });
      setValues({});
      if (kind === 'saving') setEditing(false);
      await onSaved();
      setState({ kind: kind === 'removing' ? 'removed' : 'saved' });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  const busy = state.kind === 'checking' || state.kind === 'saving' || state.kind === 'removing';
  // Where each value in effect comes from, under its field: never the value, only its hint.
  const origin = (secret: Secret) =>
    locked(secret)
      ? t('Set by the deployment (Worker variable).', 'Definido na implantação (variável do Worker).')
      : secret.source === 'stored'
      ? secret.worker
        ? t(`In effect: saved here (${secret.hint}). The Worker secret (${secret.worker}) is the fallback.`, `Em uso: salva aqui (${secret.hint}). O secret do Worker (${secret.worker}) fica de reserva.`)
        : t(`In effect: saved here (${secret.hint}).`, `Em uso: salva aqui (${secret.hint}).`)
      : secret.source === 'env'
        ? t(`In effect: the Worker secret (${secret.hint}), set at deploy. Saving a value here replaces it.`, `Em uso: o secret do Worker (${secret.hint}), definido na implantação. Salvar um valor aqui o substitui.`)
        : t('Not set.', 'Não definida.');
  const day = (at: string) => new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  // The configured state: where the value in effect comes from and when it was saved, never the value.
  const summary = (secret: Secret) => {
    const at = data.updatedAt?.[secret.key];
    return secret.source === 'stored'
      ? [at ? t(`Saved here on ${day(at)}.`, `Salva aqui em ${day(at)}.`) : t('Saved here.', 'Salva aqui.'), secret.worker ? t('The Worker secret is the fallback.', 'O secret do Worker fica de reserva.') : ''].filter(Boolean).join(' ')
      : locked(secret)
        ? t('Worker variable, set at deploy.', 'Variável do Worker, definida na implantação.')
        : t('Worker secret, set at deploy.', 'Secret do Worker, definido na implantação.');
  };
  const cancelEdit = () => {
    setValues({});
    setState({ kind: 'idle' });
    setEditing(false);
    requestAnimationFrame(() => replaceButton.current?.focus());
  };
  return (
    <SectionCard
      id={`provider-${provider.id}`}
      className="scroll-mt-16"
      inset="padded"
      title={step ? `${t('Step', 'Passo')} ${step}: ${provider.name}` : provider.name}
      description={t(...provider.use)}
      action={
        <TagBadge tone={ready ? 'success' : unreadable ? 'danger' : provider.required ? 'warning' : 'neutral'}>
          {ready ? t('Set', 'Definida') : unreadable ? t('Unreadable', 'Ilegível') : t('Not set', 'Não definida')}
        </TagBadge>
      }
    >
      <div className="space-y-4">
        <p className="text-body text-muted-foreground">
          {t(...provider.where)}{' '}
          <a href={provider.site} target="_blank" rel="noreferrer" className="text-primary hover:underline">{t('Open the provider', 'Abrir o provedor')}</a>
        </p>
        {provider.id === 'google' && data.redirectUris.length > 0 && (
          <ul className="space-y-1 text-body">
            {data.redirectUris.map((uri) => <li key={uri}><code className="text-caption [overflow-wrap:anywhere]">{uri}</code></li>)}
          </ul>
        )}
        {unreadable && (
          <p role="alert" className="text-body text-destructive">
            {t('A value saved here cannot be opened with the current CREDENTIALS_KEY or SESSION_SECRET (one was rotated). Type it again and save, or remove it.', 'Um valor salvo aqui não abre com o CREDENTIALS_KEY nem com o SESSION_SECRET atuais (um deles foi trocado). Digite de novo e salve, ou remova.')}
          </p>
        )}
        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {secrets.map((secret, index) => locked(secret) ? (
              // Set by the deployment: shown as text, never a field to type over.
              <div key={secret.key} className="grid content-start gap-1.5 text-body">
                <span>{t(...provider.fields[secret.key])}</span>
                <code className="flex min-h-(--control-height) items-center [overflow-wrap:anywhere]">{secret.hint}</code>
                <span className="text-caption text-muted-foreground">{origin(secret)}</span>
              </div>
            ) : (
              <label key={secret.key} className="grid content-start gap-1.5 text-body">
                <span>{t(...provider.fields[secret.key])}</span>
                <Input
                  ref={index === 0 ? firstField : undefined}
                  type={secret.key === 'DATAFORSEO_LOGIN' ? 'email' : secret.key === 'GOOGLE_CLIENT_ID' || provider.plain?.includes(secret.key) ? 'text' : 'password'}
                  autoComplete={secret.key === 'DATAFORSEO_LOGIN' ? 'username' : secret.key === 'GOOGLE_CLIENT_ID' || provider.plain?.includes(secret.key) ? 'off' : 'new-password'}
                  spellCheck={false}
                  disabled={busy}
                  value={values[secret.key] ?? ''}
                  placeholder={secret.set ? t('Type a new value to replace it', 'Digite um novo valor para substituir') : ''}
                  aria-describedby={`${secret.key}-origin`}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, [secret.key]: event.target.value }));
                    setState({ kind: 'idle' });
                  }}
                />
                <span id={`${secret.key}-origin`} className="text-caption text-muted-foreground [overflow-wrap:anywhere]">{origin(secret)}</span>
              </label>
            ))}
          </div>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            {secrets.map((secret) => (
              <div key={secret.key} className="grid content-start gap-1 text-body">
                <dt className="text-muted-foreground">{t(...provider.fields[secret.key])}</dt>
                <dd className="[overflow-wrap:anywhere]"><code>{secret.hint}</code></dd>
                <dd className="text-caption text-muted-foreground">{summary(secret)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {provider.check && (
            <Button variant="outline" disabled={busy || !secrets.every((secret) => typed(secret.key) || secret.set)} onClick={() => void run('checking')}>
              {state.kind === 'checking' ? t('Testing', 'Testando') : typedAny ? t('Test typed values (free)', 'Testar valores digitados (grátis)') : t('Test connection (free)', 'Testar conexão (grátis)')}
            </Button>
          )}
          {editing ? (
            <Button disabled={busy || !canSave} onClick={() => (replacing ? ask('replace') : void run('saving'))}>
              {state.kind === 'saving' ? t('Saving', 'Salvando') : t('Save', 'Salvar')}
            </Button>
          ) : (
            <Button ref={replaceButton} variant="outline" disabled={busy} onClick={() => { setState({ kind: 'idle' }); setEditing(true); requestAnimationFrame(() => firstField.current?.focus()); }}>
              {t('Replace', 'Substituir')}
            </Button>
          )}
          {editing && ready && (
            <Button variant="ghost" disabled={busy} onClick={cancelEdit}>{t('Cancel', 'Cancelar')}</Button>
          )}
          {saved && !editing && (
            <Button variant="ghost" disabled={busy} onClick={() => ask('remove')}>
              {state.kind === 'removing' ? t('Removing', 'Removendo') : t('Remove saved value', 'Remover valor salvo')}
            </Button>
          )}
          {onSkip && !ready && (
            <Button variant="ghost" disabled={busy} onClick={onSkip}>{t('Skip for now', 'Pular por enquanto')}</Button>
          )}
        </div>
        <output className="block text-body text-muted-foreground" aria-live="polite">
          {state.kind === 'check' && state.check ? <span className={state.check.ok ? undefined : 'text-destructive'}>{checkResult(state.check)}</span>
            : state.kind === 'saved' ? (provider.check ? t('Saved. Every request uses it within a minute. Test the connection to confirm it.', 'Salvo. Todas as solicitações passam a usar em até um minuto. Teste a conexão para confirmar.') : t('Saved. Every request uses it within a minute.', 'Salvo. Todas as solicitações passam a usar em até um minuto.'))
            : state.kind === 'removed' ? (ready ? t('Removed. The Worker secret is in effect again.', 'Removido. O secret do Worker voltou a valer.') : t('Removed. Nothing is set now.', 'Removido. Agora não há nada definido.'))
            : state.kind === 'error' ? <span className="text-destructive">{state.message}</span>
            : null}
        </output>
      </div>
      <AlertDialog open={confirm.open} onOpenChange={(open) => setConfirm((current) => ({ ...current, open }))}>
        <AlertDialogContent>
          {replaceAsked ? (
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`Replace the ${provider.name} value in effect?`, `Substituir o valor do ${provider.name} em uso?`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {[t(...provider.impact), provider.check && !tested ? t('Test the typed values first; it is free.', 'Teste os valores digitados antes; é grátis.') : '', t('The change is logged with your name.', 'A alteração fica registrada com seu nome.')].filter(Boolean).join(' ')}
              </AlertDialogDescription>
            </AlertDialogHeader>
          ) : (
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`Remove the ${provider.name} value saved here?`, `Remover o valor do ${provider.name} salvo aqui?`)}</AlertDialogTitle>
              <AlertDialogDescription>
                {fallback
                  ? t('The Worker secret goes back into effect within a minute. The change is logged with your name.', 'O secret do Worker volta a valer em até um minuto. A alteração fica registrada com seu nome.')
                  : provider.required
                    ? t('There is no Worker secret to fall back to: collection stops until a new value is saved. The change is logged with your name.', 'Não há secret do Worker de reserva: a coleta para até um novo valor ser salvo. A alteração fica registrada com seu nome.')
                    : t('There is no Worker secret to fall back to: this provider stops being used. The change is logged with your name.', 'Não há secret do Worker de reserva: este provedor deixa de ser usado. A alteração fica registrada com seu nome.')}
              </AlertDialogDescription>
            </AlertDialogHeader>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel', 'Cancelar')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run(replaceAsked ? 'saving' : 'removing')}>
              {replaceAsked ? t('Replace', 'Substituir') : t('Remove', 'Remover')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

const MODEL_PROVIDER_IDS: string[] = ['openai', 'anthropic', 'openrouter'];

/**
 * The order the model calls follow (OpenAI, Anthropic, OpenRouter by default): each call goes to the first provider with a
 * key that serves it; no credit, a quota, a rate limit or a server error moves it to the next. With today's calls, failovers
 * and cost per provider, and the model each provider runs for each function.
 */
export function ModelProvidersCard({ data, onSaved, t, locale }: { data: ProvidersData; onSaved: () => Promise<void> | void; t: Copy; locale: string }) {
  const models = data.models;
  const savedOrder = models?.order.join(',') ?? '';
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' });
  // The order being edited; null shows the saved one (a save or another admin's change shows at once).
  const [draft, setOrder] = useState<ModelProvider[] | null>(null);
  const order = draft ?? models?.order ?? [];
  if (!models) return null;
  const changed = order.join(',') !== savedOrder;
  const busy = state.kind === 'saving';
  const name = (provider: ModelProvider) => MODEL_PROVIDER_NAMES[provider];
  const move = (index: number, by: -1 | 1) => {
    const next = [...order];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    setOrder(next);
    setState({ kind: 'idle' });
  };
  const save = async () => {
    setState({ kind: 'saving' });
    try {
      await patch({ action: 'order', order });
      await onSaved();
      setOrder(null);
      setState({ kind: 'saved' });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  const when = (at: string | null) => (at ? new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '');
  const usd = (value: number) => value.toLocaleString(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2 });
  const functionName = (id: string) => models.functions.find((fn) => fn.id === id)?.label;
  const taskName = (task: string | null) => (task === 'decisions' ? t('decision models', 'modelos de decisão') : task ? ((label) => (label ? t(...label) : task))(functionName(task)) : '');
  const none = !MODEL_PROVIDER_IDS.some((provider) => models.configured[provider as ModelProvider]);
  return (
    <>
      <SectionCard
        id="model-order"
        className="scroll-mt-16"
        inset="padded"
        title={t('Order of the model providers', 'Ordem dos provedores de modelo')}
        info={t(
          'Each model call goes to the first provider in this order that has a key and serves it. When it refuses the call (no credit left, quota, rate limit, a server error or a rejected key), the call moves to the next one at once, nothing is billed for the refusal, and the provider rests for a while in that server. The reason is recorded below; users never see it.',
          'Cada chamada de modelo vai para o primeiro provedor desta ordem que tem chave e a atende. Quando ele recusa a chamada (sem crédito, cota, limite de taxa, erro do servidor ou chave recusada), ela passa na hora para o próximo, nada é cobrado pela recusa e o provedor descansa um tempo naquele servidor. O motivo fica registrado abaixo; o usuário nunca vê.',
        )}
      >
        <div className="space-y-4">
          <ol className="divide-y divide-border rounded-lg border border-border" aria-label={t('Order of the model providers', 'Ordem dos provedores de modelo')}>
            {order.map((provider, index) => (
              <li key={provider} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="text-body text-muted-foreground tabular-nums">{index + 1}</span>
                <span className="text-body font-(--weight-label)">{name(provider)}</span>
                <TagBadge tone={models.configured[provider] ? 'success' : 'neutral'}>{models.configured[provider] ? t('Key set', 'Chave definida') : t('No key: skipped', 'Sem chave: pulado')}</TagBadge>
                <span className="ml-auto flex gap-1">
                  <Button variant="outline" size="icon" aria-label={t(`Move ${name(provider)} up`, `Subir ${name(provider)}`)} disabled={busy || index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button variant="outline" size="icon" aria-label={t(`Move ${name(provider)} down`, `Descer ${name(provider)}`)} disabled={busy || index === order.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy || !changed} onClick={() => void save()}>{busy ? t('Saving', 'Salvando') : t('Save order', 'Salvar ordem')}</Button>
            {changed && (
              <Button variant="ghost" disabled={busy} onClick={() => setOrder(null)}>{t('Cancel', 'Cancelar')}</Button>
            )}
            <output className="text-body text-muted-foreground" aria-live="polite">
              {state.kind === 'saved' ? t('Saved. Every server follows the new order within a minute.', 'Salvo. Todos os servidores seguem a nova ordem em até um minuto.') : state.kind === 'error' ? <span className="text-destructive">{state.message}</span> : !models.saved ? t('Default order.', 'Ordem padrão.') : null}
            </output>
          </div>
          {none && (
            <Note tone="danger">{t('No model provider has a key: the classifiers, the agent and the wizards wait until one is added below.', 'Nenhum provedor de modelo tem chave: os classificadores, o agente e os wizards esperam até uma ser adicionada abaixo.')}</Note>
          )}
          <DataTable
            singleLine="wide"
            ariaLabel={t('Model calls today', 'Chamadas de modelo hoje')}
            rows={models.order.map((provider) => models.today.find((row) => row.provider === provider)!).filter(Boolean)}
            rowKey={(row) => row.provider}
            columns={[
              { key: 'provider', header: t('Today (UTC)', 'Hoje (UTC)'), mobile: 'title', cell: (row) => name(row.provider) },
              { key: 'calls', header: t('Calls answered', 'Chamadas respondidas'), label: t('Calls answered', 'Chamadas respondidas'), align: 'end', cell: (row) => row.calls.toLocaleString(locale) },
              { key: 'cost', header: t('Cost', 'Custo'), label: t('Cost', 'Custo'), align: 'end', cell: (row) => usd(row.costUsd) },
              { key: 'last', header: t('Last call', 'Última chamada'), label: t('Last call', 'Última chamada'), cell: (row) => (row.lastAt ? `${when(row.lastAt)}, ${taskName(row.lastTask)}` : t('None today', 'Nenhuma hoje')) },
              { key: 'failovers', header: t('Moved to the next', 'Passadas ao próximo'), label: t('Moved to the next', 'Passadas ao próximo'), align: 'end', cell: (row) => row.failovers.toLocaleString(locale) },
              { key: 'error', header: t('Last refusal', 'Última recusa'), label: t('Last refusal', 'Última recusa'), cell: (row) => (row.lastErrorAt ? `${when(row.lastErrorAt)}, ${row.lastError}` : '') },
            ]}
          />
        </div>
      </SectionCard>
      <SectionCard
        title={t('Model per function and provider', 'Modelo por função e provedor')}
        info={t(
          'The model saved in Admin, Classifiers runs as it is on OpenRouter, and directly on OpenAI or Anthropic when it is one of theirs. For the agent, the wizards, the search intents and the learning review, a provider whose models the saved one is not runs a model of its own (shown here). A decision model never changes: OpenAI\'s runs on OpenAI\'s key, Liquid\'s and TypeSafe\'s only on OpenRouter, and Anthropic serves none.',
          'O modelo salvo em Admin, Classificadores roda como está no OpenRouter, e direto na OpenAI ou na Anthropic quando é deles. Para o agente, os wizards, as intenções de busca e a revisão de aprendizado, um provedor de quem o modelo salvo não é roda um modelo próprio (mostrado aqui). Um modelo de decisão nunca muda: o da OpenAI roda na chave da OpenAI, os da Liquid e da TypeSafe só no OpenRouter, e a Anthropic não atende nenhum.',
        )}
      >
        <DataTable
          singleLine="wide"
          ariaLabel={t('Model per function and provider', 'Modelo por função e provedor')}
          rows={models.functions}
          rowKey={(row) => row.id}
          columns={[
            { key: 'function', header: t('Function', 'Função'), mobile: 'title', shrinkTo: '12rem', width: '16rem', cell: (row) => t(...row.label) },
            ...models.order.map((provider) => ({
              key: provider,
              header: name(provider),
              label: name(provider),
              cell: (row: ModelsState['functions'][number]) => (row.models[provider] ? <code className="text-caption">{row.models[provider]}</code> : <span className="text-muted-foreground">{row.decisions ? t('No decision model', 'Sem modelo de decisão') : t('Not served', 'Não atende')}</span>),
            })),
            { key: 'now', header: t('Answers now', 'Responde agora'), label: t('Answers now', 'Responde agora'), cell: (row) => (row.servedBy ? name(row.servedBy) : <TagBadge tone="warning">{t('No provider', 'Nenhum provedor')}</TagBadge>) },
          ]}
        />
      </SectionCard>
    </>
  );
}

/** Admin > Providers: the credentials in effect (never their values), a guided first-time setup and the audit trail. */
export function AdminProviders() {
  const { locale } = useI18n();
  const t: Copy = (en, pt) => (locale === 'pt-BR' ? pt : en);
  const [data, setData] = useState<ProvidersData | null>(null);
  const [failed, setFailed] = useState(false);
  // The guided setup starts when the required provider is missing on the first read and ends when the optional one
  // is set or skipped.
  const [initiallyMissing, setInitiallyMissing] = useState<boolean | null>(null);
  const [skipped, setSkipped] = useState(false);
  const load = useCallback(
    () =>
      fetch('/api/admin/providers')
        .then((response) => (response.ok ? (response.json() as Promise<ProvidersData>) : Promise.reject(new Error(String(response.status)))))
        .then((value) => {
          setData(value);
          setInitiallyMissing((current) => current ?? !configured(value, ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD']));
        }, () => setFailed(true)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // A link to one provider (Usage and costs links to Cloudflare's) lands on its card once the cards are drawn.
  const loaded = !!data;
  useEffect(() => {
    if (loaded && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [loaded]);
  const setup = !initiallyMissing || !data ? 'none' : skipped || PROVIDERS.every((provider) => !provider.setup || configured(data, provider.keys)) ? 'done' : 'active';
  if (failed) return <AdminLoadError />;
  if (!data)
    return (
      <div className="space-y-6" aria-busy="true">
        <span className="sr-only">{t('Loading providers', 'Carregando provedores')}</span>
        {[0, 1].map((index) => (
          <SectionCard key={index} inset="padded" title={<Skeleton inline className="h-lh w-40 align-top" />} description={<Skeleton inline className="h-lh w-96 max-w-full align-top" />}>
            <div className="space-y-4" aria-hidden="true">
              <Skeleton className="h-4 w-3/4" />
              <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((field) => <div key={field} className="grid gap-1.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-9 w-full" /><Skeleton className="h-3 w-48" /></div>)}</div>
              <Skeleton className="h-8 w-48" />
            </div>
          </SectionCard>
        ))}
        <SectionCard loading lines={3} />
      </div>
    );
  return (
    <>
      {setup === 'active' && (
        <Note className="px-0 py-0">
          {t('First-time setup: DataForSEO is required, the model providers are optional. Each key is tested on a free endpoint of its provider; nothing is charged. Values are sealed in the database and never shown again.', 'Primeira configuração: o DataForSEO é obrigatório, os provedores de modelo são opcionais. Cada chave é testada num endpoint gratuito do provedor; nada é cobrado. Os valores ficam selados no banco e nunca aparecem de novo.')}
        </Note>
      )}
      {setup === 'done' && (
        <Note status className="px-0 py-0">{t('Setup is complete: collection can run. The classifiers run once a model provider\'s key is set (OpenRouter for the Liquid and TypeSafe decision models).', 'Configuração completa: a coleta pode rodar. Os classificadores rodam quando a chave de um provedor de modelo estiver definida (OpenRouter para os modelos de decisão da Liquid e da TypeSafe).')}</Note>
      )}
      {PROVIDERS.filter((provider) => data.providers.includes(provider.id)).map((provider, index) => (
        <Fragment key={provider.id}>
          {/* The order sits above the first model provider's card. */}
          {provider.id === 'openai' && setup !== 'active' && <ModelProvidersCard data={data} onSaved={load} t={t} locale={locale} />}
          <ProviderCard
            provider={provider}
            data={data}
            step={setup === 'active' && provider.setup ? index + 1 : null}
            onSaved={load}
            onSkip={setup === 'active' && provider.setup && !provider.required ? () => setSkipped(true) : undefined}
            t={t}
            locale={locale}
          />
        </Fragment>
      ))}
      <SectionCard title={t('Precedence and storage', 'Precedência e armazenamento')} inset="padded">
        <ul className="list-disc space-y-1 pl-5 text-body text-muted-foreground">
          <li>{t('A value saved here wins over the Worker secret of the same name (set at deploy with wrangler or npm run setup). Remove the saved value to go back to the Worker secret.', 'Um valor salvo aqui vence o secret do Worker de mesmo nome (definido na implantação com wrangler ou npm run setup). Remova o valor salvo para voltar ao secret do Worker.')}</li>
          <li>{t('A change reaches every server within a minute. Testing a connection is free: it calls only the provider\'s free endpoint.', 'Uma alteração chega a todos os servidores em até um minuto. Testar a conexão é grátis: chama só o endpoint gratuito do provedor.')}</li>
          <li>{t('Saved values are sealed with AES-GCM under a key derived from CREDENTIALS_KEY (SESSION_SECRET where it is not set). A value saved before CREDENTIALS_KEY existed still opens; save it again to move it to the new key before rotating SESSION_SECRET.', 'Valores salvos são selados com AES-GCM sob uma chave derivada de CREDENTIALS_KEY (SESSION_SECRET onde ele não existe). Um valor salvo antes do CREDENTIALS_KEY continua abrindo; salve de novo para passá-lo à nova chave antes de trocar o SESSION_SECRET.')}</li>
          <li>{t('Every change is logged below with who and when, never the value.', 'Toda alteração fica registrada abaixo com quem e quando, nunca o valor.')}</li>
        </ul>
      </SectionCard>
      <SectionCard title={t('Recent changes', 'Alterações recentes')} inset={!data.audit.length ? 'padded' : undefined}>
        {data.audit.length ? (
          <DataTable
            ariaLabel={t('Recent changes', 'Alterações recentes')}
            rows={data.audit}
            rowKey={(row, index) => `${row.at}:${index}`}
            columns={[
              { key: 'at', header: t('When', 'Quando'), mobile: 'title', cell: (row) => new Date(row.at).toLocaleString(locale) },
              { key: 'actor', header: t('Who', 'Quem'), label: t('Who', 'Quem'), cell: (row) => row.actor },
              { key: 'action', header: t('Action', 'Ação'), label: t('Action', 'Ação'), cell: (row) => (row.action === 'clear' ? t('Removed', 'Removeu') : t('Set', 'Definiu')) },
              { key: 'key', header: t('Setting', 'Configuração'), label: t('Setting', 'Configuração'), cell: (row) => <code className="text-caption">{row.key}</code> },
            ]}
          />
        ) : (
          <p className="text-body text-muted-foreground">{t('No change yet.', 'Nenhuma alteração ainda.')}</p>
        )}
      </SectionCard>
    </>
  );
}
