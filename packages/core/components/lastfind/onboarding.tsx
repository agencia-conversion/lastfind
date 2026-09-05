'use client';
import { useI18n } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Plus,
  X,
  Clock,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { availableEngines, ENGINES, ENGINE_LABELS } from '@/lib/engines';
import type { Workspace } from '@/lib/types';
import { Choice } from './forms';
import { suggestPrompts, type PromptDraft } from '@/lib/prompt-tools';
import { requestJson } from '@/lib/client';
const initial = {
  name: '',
  domain: '',
  category: '',
  audience: '',
  language_code: 'en',
  location_code: 2840,
};
export function Onboarding({
  onComplete,
  capabilities,
}: {
  capabilities: Workspace['capabilities'];
  onComplete: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(0),
    [profile, setProfile] = useState(initial),
    [competitors, setCompetitors] = useState<
      { name: string; domain: string }[]
    >([]),
    [prompts, setPrompts] = useState<PromptDraft[]>([]),
    [chosen, setChosen] = useState<number[]>([]),
    [engine, setEngine] = useState('chat_gpt'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [requestId, setRequestId] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setRequestId(crypto.randomUUID());
      try {
        const raw = sessionStorage.getItem('lastfind-onboarding');
        if (raw) {
          const p = JSON.parse(raw);
          setProfile({ ...initial, ...p });
        }
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  function update(key: string, value: string | number) {
    const next = { ...profile, [key]: value };
    setProfile(next);
    try {
      sessionStorage.setItem('lastfind-onboarding', JSON.stringify(next));
    } catch {}
  }
  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    if (step === 0) {
      setPrompts(suggestPrompts(profile));
      setChosen([0, 1, 2, 3, 4]);
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!chosen.length) {
        setError(t('Selecione ao menos uma pergunta.'));
        return;
      }
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      const engines =
        engine === 'all'
          ? availableEngines(capabilities.engines, profile.language_code)
          : [engine];
      if (
        capabilities.promptLimit !== null &&
        engines.length * chosen.length > capabilities.promptLimit
      )
        throw new Error(
          t('Seu workspace permite {count} prompts.', {
            count: capabilities.promptLimit,
          }),
        );
      const result = await requestJson<{ id: string }>(
        '/api/onboarding',
        'POST',
        {
          ...profile,
          request_id: requestId,
          competitors: competitors.filter((c) => c.name || c.domain),
          interval_hours: 24,
          prompts: chosen.flatMap((i) =>
            engines.map((engine) => ({
              ...prompts[i],
              engine,
              ...(capabilities.topicLimit === 1 ? { tag: t('Geral') } : {}),
            })),
          ),
        },
      );
      sessionStorage.removeItem('lastfind-onboarding');
      await onComplete(result.id);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t('Não foi possível criar seu projeto.'),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="setup-shell">
      <aside className="setup-aside">
        <span className="eyebrow">{t('BEM-VINDO AO LASTFIND')}</span>
        <h2>
          {t('Sua marca.')}
          <br />
          {t('Uma nova')}
          <br />
          <span>{t('perspectiva.')}</span>
        </h2>
        <p>
          {t(
            'Descubra onde você aparece nas respostas de IA. O acompanhamento acontece todos os dias às 4h de Brasília.',
          )}
        </p>
        <ol>
          {[
            t('Sua marca e seu público'),
            t('Perguntas para acompanhar'),
            t('Revisar e começar'),
          ].map((s, i) => (
            <li
              key={s}
              className={i === step ? 'current' : i < step ? 'done' : ''}
            >
              <span>{i < step ? <Check size={14} /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </aside>
      <form className="setup-form lf-form" onSubmit={submit}>
        <div className="setup-progress">
          <span>
            {t('Passo')} {step + 1} {t('de 3')}
          </span>
          <Progress value={((step + 1) / 3) * 100} />
        </div>
        {step === 0 ? (
          <>
            <h2>{t('Vamos conhecer sua marca')}</h2>
            <p className="muted">
              {t(
                'Essas informações ajudam a preparar suas primeiras perguntas.',
              )}
            </p>
            <div className="form-row">
              <label htmlFor="onboarding-input-1">
                {t('Nome da marca')}
                <Input
                  id="onboarding-input-1"
                  required
                  minLength={2}
                  maxLength={80}
                  value={profile.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Ex.: Notion"
                />
              </label>
              <label htmlFor="onboarding-input-2">
                {t('Site da marca')}
                <Input
                  id="onboarding-input-2"
                  required
                  value={profile.domain}
                  onChange={(e) => update('domain', e.target.value)}
                  placeholder="notion.so"
                />
              </label>
            </div>
            <label htmlFor="onboarding-input-3">
              {t('O que você oferece?')}
              <Input
                id="onboarding-input-3"
                required
                minLength={3}
                maxLength={100}
                value={profile.category}
                onChange={(e) => update('category', e.target.value)}
                placeholder={t('Ex.: ferramentas de gestão de projetos')}
              />
            </label>
            <label htmlFor="onboarding-input-4">
              {t('Para quem?')}
              <Input
                id="onboarding-input-4"
                required
                minLength={3}
                maxLength={100}
                value={profile.audience}
                onChange={(e) => update('audience', e.target.value)}
                placeholder={t('Ex.: pequenas empresas e equipes remotas')}
              />
            </label>
            <div className="form-row">
              <label htmlFor={`choice-${t('Mercado do projeto')}`}>
                {t('Mercado')}
                <Choice
                  label={t('Mercado do projeto')}
                  value={String(profile.location_code)}
                  onChange={(v) => update('location_code', Number(v))}
                  options={[
                    { value: '2076', label: t('Brasil') },
                    { value: '2840', label: t('Estados Unidos') },
                    { value: '2826', label: t('Reino Unido') },
                  ]}
                />
              </label>
              <label htmlFor={`choice-${t('Idioma do projeto')}`}>
                {t('Idioma')}
                <Choice
                  label={t('Idioma do projeto')}
                  value={profile.language_code}
                  onChange={(v) => {
                    update('language_code', v);
                    if (v === 'pt') setEngine('chat_gpt');
                  }}
                  options={[
                    { value: 'pt', label: t('Português') },
                    { value: 'en', label: t('Inglês') },
                  ]}
                />
              </label>
            </div>
          </>
        ) : step === 1 ? (
          <>
            <h2>{t('O que seu público pergunta?')}</h2>
            <p className="muted">
              {t(
                'Exemplos preparados com o perfil da marca. Edite e selecione os que fazem sentido para o seu negócio.',
              )}
            </p>
            <div className="suggestion-list">
              {prompts.map((p, i) => (
                <div className="suggestion-row" key={i}>
                  <Checkbox
                    aria-label={`Acompanhar pergunta ${i + 1}`}
                    checked={chosen.includes(i)}
                    onCheckedChange={(v) =>
                      setChosen((prev) =>
                        v ? [...prev, i] : prev.filter((x) => x !== i),
                      )
                    }
                  />
                  <div>
                    <Input
                      aria-label={`Pergunta ${i + 1}`}
                      required={chosen.includes(i)}
                      minLength={5}
                      maxLength={1000}
                      value={p.text}
                      onChange={(e) =>
                        setPrompts((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, text: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <small>{p.tag}</small>
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPrompts((prev) => [
                  ...prev,
                  { text: '', engine: 'chat_gpt', tag: t('Geral'), tags: [] },
                ]);
                setChosen((prev) => [...prev, prompts.length]);
              }}
              disabled={prompts.length >= 20}
            >
              <Plus />
              {t('Escrever outra pergunta')}
            </Button>
            <label htmlFor={`choice-${t('Motores do onboarding')}`}>
              {t('Onde acompanhar')}
              <Choice
                label={t('Motores do onboarding')}
                value={engine}
                onChange={setEngine}
                options={[
                  ...ENGINES.map((e) => ({
                    value: e,
                    label: ENGINE_LABELS[e],
                    disabled: !availableEngines(
                      capabilities.engines,
                      profile.language_code,
                    ).includes(e),
                  })),
                  ...(capabilities.engines.length > 1
                    ? [{ value: 'all', label: t('Todas as IAs disponíveis') }]
                    : []),
                ]}
              />
              <small>
                {t(
                  'Gemini está disponível em inglês. Você pode adicionar mais perguntas depois.',
                )}
              </small>
            </label>
          </>
        ) : (
          <>
            <h2>{t('Tudo pronto para acompanhar')}</h2>
            <p className="muted">
              {t(
                'As primeiras respostas chegam automaticamente. Você pode fechar esta página e voltar depois.',
              )}
            </p>
            <div className="setup-summary">
              <b>{profile.name}</b>
              <span>{profile.domain}</span>
              <div>
                <Sparkles size={16} />
                {chosen.length *
                  (engine === 'all'
                    ? availableEngines(
                        capabilities.engines,
                        profile.language_code,
                      ).length
                    : 1)}{' '}
                {t('prompts selecionados')}
              </div>
            </div>
            <div className="notice">
              <Clock size={18} />
              <span>
                {t('Coleta diária às')}
                <b>{t('4h de Brasília')}</b>
                {t('. Novos prompts entram na próxima janela.')}
              </span>
            </div>
            <div>
              {t('Concorrentes')}
              <span className="optional">{t('opcional · até 5')}</span>
            </div>
            {competitors.map((c, i) => (
              <div className="competitor-inputs" key={i}>
                <Input
                  aria-label={t('Nome do concorrente {count}', {
                    count: i + 1,
                  })}
                  placeholder={t('Marca')}
                  required
                  value={c.name}
                  onChange={(e) =>
                    setCompetitors((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={t('Domínio do concorrente {count}', {
                    count: i + 1,
                  })}
                  placeholder="dominio.com"
                  required
                  value={c.domain}
                  onChange={(e) =>
                    setCompetitors((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, domain: e.target.value } : x,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('Remover concorrente')}
                  onClick={() =>
                    setCompetitors((prev) => prev.filter((_, j) => i !== j))
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={competitors.length >= 5}
              onClick={() =>
                setCompetitors((prev) => [...prev, { name: '', domain: '' }])
              }
            >
              <Plus />
              {t('Adicionar concorrente')}
            </Button>
            <div className="setup-note">
              <Clock size={18} />
              <p>
                {t(
                  'Os primeiros resultados podem levar até 45 minutos. Depois, atualizamos diariamente às 4h, no horário de Brasília.',
                )}
              </p>
            </div>
          </>
        )}
        {error && (
          <div className="notice error-notice" role="alert">
            {error}
          </div>
        )}
        <div className="setup-actions">
          {step > 0 && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft />
              {t('Voltar')}
            </Button>
          )}
          <Button
            className="lf-primary"
            type="submit"
            disabled={busy || !requestId}
          >
            {busy
              ? t('Preparando seu projeto…')
              : step === 2
                ? t('Começar acompanhamento')
                : 'Continuar'}
            <ArrowRight />
          </Button>
        </div>
      </form>
    </section>
  );
}
