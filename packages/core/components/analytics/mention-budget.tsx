'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { requestJson } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { Switch } from '@/components/ui/switch';
import { Note } from '@/components/lastfind/presentation/note';
import { SettingsBlock } from './settings-block';
import { EmptyState } from './shared';

type T = (en: string, pt: string) => string;
type BaseBudget = { cap: number | null; custom: boolean; spent: number; defaultUsd: number; adminMaxUsd: number; canSet: boolean; canUnlimited: boolean; platformCap: boolean; disabled?: boolean };
type Budget = {
  cap: number | null;
  custom: boolean;
  spent: number;
  defaultUsd: number;
  adminMaxUsd: number;
  canSet: boolean;
  canUnlimited: boolean;
  platformCap: boolean;
  exhausted: boolean;
  alarm: boolean;
  pending: number | null;
  daysLeft: number | null;
  modelAvailable?: boolean;
};

/**
 * Settings › Competitors: what checking the mentions of monitored names that are also common words ("Conversion" the
 * agency or the word) may spend in this project each month. At the limit nothing more is asked and those mentions wait, not
 * counted: this block says so, with how many wait.
 */
export function MentionBudget({ projectId, t }: { projectId: string; t: T }) {
  return (
    <MonthlyBudget<Budget>
      t={t}
      id="mention-checks"
      scope={projectId}
      read={() => requestJson<Budget>(`/api/projects/${encodeURIComponent(projectId)}/brand-mentions`)}
      write={(value) => requestJson<Budget>(`/api/projects/${encodeURIComponent(projectId)}/brand-mentions`, 'PUT', { monthly_usd: value })}
      title={t('Checking names that are also common words', 'Checagem de nomes que também são palavras comuns')}
      description={t(
        'When a monitored name is also an ordinary word, the text settles most mentions for free. The rest go to a decision model, a fraction of a cent each, and count only once it says they name the brand.',
        'Quando um nome monitorado também é uma palavra comum, o texto resolve a maioria das menções de graça. As demais vão a um modelo de decisão, uma fração de centavo cada, e só contam quando ele diz que são a marca.',
      )}
      failed={t('Could not load the checks budget', 'Não foi possível carregar o orçamento das checagens')}
      zero={t('0 stops the checks: those mentions are not counted.', '0 para as checagens: essas menções não são contadas.')}
      notes={(budget) =>
        budget.modelAvailable === false ? (
          <Note>
            {t(
              'No decision model key is set: these names count as the text finds them, as before, and nothing is spent. An admin adds the key in the Providers section of Admin and reprocesses brand detection for the model to settle them.',
              'Nenhuma chave de modelo de decisão está configurada: esses nomes contam como o texto os encontra, como antes, e nada é gasto. Um admin adiciona a chave em a seção Provedores do Admin e reprocessa a detecção de marcas para o modelo resolvê-los.',
            )}
          </Note>
        ) : budget.exhausted ? (
          <Note tone="danger">
            {t(
              `This month's limit is used up. ${budget.pending ? `${budget.pending} mentions wait, not counted, ` : 'New mentions that need the model wait, not counted, '}until next month or a higher limit.`,
              `O limite deste mês acabou. ${budget.pending ? `${budget.pending} menções aguardam, sem contar, ` : 'Menções novas que precisam do modelo aguardam, sem contar, '}até o próximo mês ou um limite maior.`,
            )}
          </Note>
        ) : budget.alarm ? (
          <Note>{t(`Over 80% of this month's limit is used${budget.daysLeft !== null ? `, about ${budget.daysLeft} days left at the last 7 days' rate` : ''}.`, `Mais de 80% do limite deste mês foi usado${budget.daysLeft !== null ? `, cerca de ${budget.daysLeft} dias restantes no ritmo dos últimos 7 dias` : ''}.`)}</Note>
        ) : budget.pending ? (
          <p className="text-body text-muted-foreground">{t(`${budget.pending} mentions wait for the model, not counted yet.`, `${budget.pending} menções aguardam o modelo, ainda sem contar.`)}</p>
        ) : null
      }
    />
  );
}

/**
 * A project's monthly spending limit for one paid background job, as a Settings block (the agent's learning, the common-word
 * brand checks): unlimited (a Lastfind admin only), an amount, or empty for the default; what it spent this month.
 */
function MonthlyBudget<B extends BaseBudget>({
  t,
  id,
  scope,
  read,
  write,
  title,
  description,
  failed,
  zero,
  notes,
}: {
  t: T;
  id: string;
  /** What the limit belongs to (the project): a new one is read again. */
  scope: string;
  read: () => Promise<B>;
  write: (value: number | null | 'default') => Promise<B>;
  title: string;
  description: string;
  failed: string;
  zero: string;
  notes?: (budget: B) => ReactNode;
}) {
  const { locale } = useI18n();
  const [budget, setBudget] = useState<B | { failure: string } | null>(null);
  const [unlimited, setUnlimited] = useState(false);
  const [amount, setAmount] = useState('');
  const [generation, setGeneration] = useState(0);
  const shown = (value: B) => {
    setBudget(value);
    setUnlimited(value.cap === null);
    setAmount(value.custom && value.cap !== null ? String(value.cap) : '');
  };
  const reader = useRef(read);
  useEffect(() => {
    reader.current = read;
  });
  useEffect(() => {
    let current = true;
    reader.current().then(
      (value) => {
        if (current) shown(value);
      },
      (cause) => current && setBudget({ failure: cause instanceof Error ? cause.message : String(cause) }),
    );
    return () => {
      current = false;
    };
  }, [scope, generation]);
  const money = (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  if (!budget) return <SectionCard loading title={title} />;
  if ('failure' in budget)
    return <EmptyState tone="error" title={failed} description={budget.failure} onRetry={() => (setBudget(null), setGeneration((value) => value + 1))} />;
  const locked = !budget.canSet;
  const dirty = unlimited !== (budget.cap === null) || amount !== (budget.custom && budget.cap !== null ? String(budget.cap) : '');
  return (
    <SettingsBlock
      title={title}
      description={description}
      busy={locked}
      dirty={dirty}
      onCancel={() => shown(budget)}
      // ponytail: this block's unsaved state is not reported to Settings' leave warning; join it with the content block's if needed.
      onDirty={() => {}}
      t={t}
      save={async () => {
        const raw = amount.replace(',', '.').trim();
        const value = unlimited ? null : raw === '' ? 'default' : Number(raw);
        if (value !== null && value !== 'default' && !Number.isFinite(value)) return false;
        shown(await write(value));
        return true;
      }}
    >
      {notes?.(budget)}
      {budget.canUnlimited && (
        <Field orientation="horizontal">
          <Switch id={`${id}-unlimited`} checked={unlimited} disabled={locked} onCheckedChange={(on) => setUnlimited(on)} />
          <FieldLabel htmlFor={`${id}-unlimited`}>{t('Unlimited', 'Ilimitado')}</FieldLabel>
        </Field>
      )}
      {!unlimited && (
        <Field>
          <FieldLabel htmlFor={`${id}-usd`}>{t('Monthly limit (US$)', 'Limite mensal (US$)')}</FieldLabel>
          <Input
            id={`${id}-usd`}
            name={`${id}_usd`}
            type="number"
            inputMode="decimal"
            min={0}
            max={budget.canUnlimited ? undefined : budget.adminMaxUsd}
            step="0.5"
            className="w-40"
            disabled={locked}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={String(budget.defaultUsd)}
          />
          <FieldDescription>
            {`${zero} ${t(`Empty uses the default, ${money(budget.defaultUsd)}.`, `Vazio usa o padrão, ${money(budget.defaultUsd)}.`)}`}
            {!budget.canUnlimited && ` ${t(`Above ${money(budget.adminMaxUsd)}, a Lastfind admin sets it.`, `Acima de ${money(budget.adminMaxUsd)}, um admin do Lastfind define.`)}`}
          </FieldDescription>
        </Field>
      )}
      <p className="text-body text-muted-foreground">{t(`Spent this month: ${money(budget.spent)}`, `Gasto neste mês: ${money(budget.spent)}`)}</p>
      {locked && (
        <p className="text-caption text-muted-foreground">
          {budget.platformCap ? t('A Lastfind admin set this limit: only a Lastfind admin changes it.', 'Um admin do Lastfind definiu este limite: só um admin do Lastfind muda.') : t('Only workspace admins change it.', 'Só admins do workspace mudam isto.')}
        </p>
      )}
    </SettingsBlock>
  );
}

