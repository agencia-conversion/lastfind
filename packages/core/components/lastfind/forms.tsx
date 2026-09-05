'use client';
import { useI18n } from '@/lib/i18n';
import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  parsePromptCsv,
  suggestPrompts,
  type PromptDraft,
} from '@/lib/prompt-tools';
import { EngineIcon } from './identity-icons';
import {
  availableEngines,
  ENGINES,
  ENGINE_LABELS,
  isEngine,
} from '@/lib/engines';
import type { Workspace } from '@/lib/types';
const unrestrictedCapabilities: Workspace['capabilities'] = {
  engines: [...ENGINES],
  promptLimit: null,
  topicLimit: null,
};
import type { Topic } from '@/lib/types';
import type { Project } from '@/lib/types';
export function Choice({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger
        id={`choice-${label}`}
        aria-label={label}
        className="lf-select"
      >
        <SelectValue>
          {isEngine(value) ? (
            <span className="engine-choice">
              <EngineIcon engine={value} />
              {ENGINE_LABELS[value]}
            </span>
          ) : (
            options.find((o) => o.value === value)?.label
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem value={o.value} key={o.value} disabled={o.disabled}>
            {isEngine(o.value) && <EngineIcon engine={o.value} />} {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function ProjectDialog({
  open,
  setOpen,
  project,
  onSave,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  project?: Project;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="lf-dialog">
        <DialogTitle>
          {project ? t('Configurar projeto') : t('Sua marca, no radar.')}
        </DialogTitle>
        <DialogDescription>
          {project
            ? t('As configurações são aplicadas às próximas coletas.')
            : t('Comece com a marca e o mercado que você quer acompanhar.')}
        </DialogDescription>
        {open && <ProjectForm project={project} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}
function ProjectForm({
  project,
  onSave,
}: {
  project?: Project;
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [location, setLocation] = useState(
      String(project?.location_code ?? 2840),
    ),
    [language, setLanguage] = useState(project?.language_code ?? 'en'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const competitors = (
        typeof f.get('competitors') === 'string'
          ? (f.get('competitors') as string)
          : ''
      )
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const [name, ...domain] = x.split(',');
          return { name: name.trim(), domain: domain.join(',').trim() };
        });
      await onSave({
        name: f.get('name'),
        domain: f.get('domain'),
        competitors,
        category: f.get('category'),
        audience: f.get('audience'),
        location_code: Number(location),
        language_code: language,
      });
    } catch (e) {
      setError(
        e instanceof Error ? t(e.message) : t('Não foi possível salvar.'),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="lf-form compact-form project-form" onSubmit={submit}>
      <label htmlFor="field-name">
        {t('Nome da marca')}
        <Input
          id="field-name"
          name="name"
          placeholder="Ex.: Lastfind"
          required
          minLength={2}
          maxLength={80}
          defaultValue={project?.name}
        />
      </label>
      <label htmlFor="field-domain">
        {t('Domínio')}
        <Input
          id="field-domain"
          name="domain"
          placeholder="sua-marca.com"
          required
          defaultValue={project?.domain}
        />
      </label>
      <label htmlFor="forms-input-1">
        {t('Categoria')}
        <Input
          id="forms-input-1"
          name="category"
          defaultValue={project?.category}
          placeholder={t('Ex.: ferramentas de gestão de projetos')}
          maxLength={100}
        />
      </label>
      <label htmlFor="forms-input-2">
        {t('Público')}
        <Input
          id="forms-input-2"
          name="audience"
          defaultValue={project?.audience}
          placeholder={t('Ex.: pequenas empresas')}
          maxLength={100}
        />
      </label>
      <div className="form-row">
        <label htmlFor={`choice-${t('Mercado')}`}>
          {t('Mercado')}
          <Choice
            value={location}
            onChange={setLocation}
            label={t('Mercado')}
            options={[
              { value: '2076', label: t('Brasil') },
              { value: '2840', label: t('Estados Unidos') },
              { value: '2826', label: t('Reino Unido') },
            ]}
          />
        </label>
        <label htmlFor={`choice-${t('Idioma')}`}>
          {t('Idioma')}
          <Choice
            value={language}
            onChange={setLanguage}
            label={t('Idioma')}
            options={[
              { value: 'pt', label: t('Português') },
              { value: 'en', label: t('Inglês') },
            ]}
          />
        </label>
      </div>
      <label htmlFor="field-competitors">
        {t('Concorrentes')}
        <span className="optional">{t('opcional · até 5')}</span>
        <Textarea
          id="field-competitors"
          name="competitors"
          placeholder={'Orbit, orbit.com\nModo, modo.com'}
          rows={3}
          defaultValue={project?.competitors
            .map((c) => `${c.name}, ${c.domain}`)
            .join('\n')}
        />
        <small>{t('Um por linha, no formato Nome, domínio.')}</small>
      </label>
      <p className="form-hint">
        {t(
          'Os resultados respeitam o mercado e o idioma deste projeto. Gemini está disponível em inglês.',
        )}
      </p>
      {error && (
        <div role="alert" className="notice error-notice">
          {error}
        </div>
      )}
      <Button type="submit" className="lf-primary" disabled={busy}>
        {busy
          ? t('Salvando…')
          : project
            ? t('Salvar alterações')
            : t('Criar projeto')}
      </Button>
    </form>
  );
}
export function PromptDialog({
  open,
  setOpen,
  project,
  onSave,
  capabilities = unrestrictedCapabilities,
  topics = [],
  capacity,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  project?: Project;
  capabilities?: Workspace['capabilities'];
  topics?: Topic[];
  capacity?: { prompts: number; topics: number };
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="lf-dialog prompt-create-dialog">
        <DialogTitle>{t('Adicionar prompts')}</DialogTitle>
        <DialogDescription>
          {t(
            'Salve suas perguntas. A primeira coleta será na próxima janela das 4h de Brasília.',
          )}
        </DialogDescription>
        {open && project && (
          <PromptForm
            project={project}
            onSave={onSave}
            capabilities={capabilities}
            topics={topics}
            capacity={capacity}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function PromptForm({
  project,
  onSave,
  capabilities = unrestrictedCapabilities,
  topics = [],
  capacity,
}: {
  project: Project;
  capabilities?: Workspace['capabilities'];
  topics?: Topic[];
  capacity?: { prompts: number; topics: number };
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState('manual'),
    [engine, setEngine] = useState('chat_gpt'),
    [text, setText] = useState(''),
    [topic, setTopic] = useState(topics[0]?.name ?? t('Geral')),
    [tags, setTags] = useState(''),
    [imported, setImported] = useState<PromptDraft[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const prompts =
        mode === 'csv'
          ? imported
          : text
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean)
              .flatMap((text) =>
                (engine === 'all'
                  ? availableEngines(
                      capabilities.engines,
                      project.language_code,
                    )
                  : [engine]
                ).map((engine) => ({
                  text,
                  engine,
                  tag: topic || t('Geral'),
                  tags: tags
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                })),
              );
      if (!prompts.length || prompts.length > 100)
        throw new Error(
          t(
            'Adicione entre 1 e 100 prompts por vez. Cada motor conta como um prompt.',
          ),
        );
      if (
        capabilities.promptLimit !== null &&
        prompts.length + (capacity?.prompts ?? 0) > capabilities.promptLimit
      )
        throw new Error(
          t(
            'Seu workspace permite {count} prompts. Arquive perguntas para liberar espaço.',
            { count: capabilities.promptLimit },
          ),
        );
      if (
        prompts.some(
          (p) =>
            !capabilities.engines.includes(
              p.engine as (typeof ENGINES)[number],
            ),
        )
      )
        throw new Error(t('Este canal não está disponível neste workspace.'));
      await onSave({ project_id: project.id, prompts });
    } catch (e) {
      setError(
        e instanceof Error ? t(e.message) : t('Não foi possível salvar.'),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="lf-form compact-form" onSubmit={submit}>
      <Tabs
        value={mode}
        onValueChange={(v) => {
          setMode(String(v));
          setError('');
        }}
      >
        <TabsList>
          <TabsTrigger value="manual">{t('Escrever')}</TabsTrigger>
          <TabsTrigger
            value="suggested"
            onClick={() => {
              if (!text)
                setText(
                  suggestPrompts(project)
                    .map((p) => p.text)
                    .join('\n'),
                );
            }}
          >
            {t('Sugestões')}
          </TabsTrigger>
          <TabsTrigger value="csv">{t('Importar CSV')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {mode === 'csv' ? (
        <>
          <label htmlFor="forms-input-3">
            {t('Arquivo CSV')}
            <Input
              id="forms-input-3"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setImported([]);
                if (!file) return;
                try {
                  if (file.size > 100000)
                    throw new Error(t('Use um arquivo de até 100 KB.'));
                  setImported(parsePromptCsv(await file.text()));
                  setError('');
                } catch (e) {
                  setError(
                    e instanceof Error ? t(e.message) : t('Arquivo inválido.'),
                  );
                }
              }}
            />
            <small>
              {t(
                'Colunas: prompt, engine, topic, tags. Separe múltiplas tags com |.',
              )}
            </small>
          </label>
          <a href="/prompt-template.csv" download className="text-link">
            {t('Baixar modelo CSV')}
          </a>
          {imported.length > 0 && (
            <div className="csv-preview">
              <b>
                {imported.length} {t('prompts prontos para importar')}
              </b>
              <ol>
                {imported.slice(0, 10).map((p, i) => (
                  <li key={i}>
                    {p.text}
                    <small>
                      {isEngine(p.engine) ? ENGINE_LABELS[p.engine] : p.engine}{' '}
                      · {p.tag}
                    </small>
                  </li>
                ))}
              </ol>
              {imported.length > 10 && (
                <small>
                  {t('e mais')} {imported.length - 10} prompts.
                </small>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {mode === 'suggested' && (
            <p className="form-hint">
              {t(
                'Exemplos baseados na categoria e no público do seu projeto. Revise antes de acompanhar.',
              )}
            </p>
          )}
          <label htmlFor="forms-input-4">
            {t('Perguntas')}
            <Textarea
              id="forms-input-4"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              required
              placeholder={t('Quais são as melhores ferramentas para…')}
            />
            <small>
              {t('Uma pergunta por linha. Cole várias de uma vez.')}
            </small>
          </label>
          <label htmlFor={`choice-${t('Motor de IA')}`}>
            {t('Motor de IA')}
            <Choice
              label={t('Motor de IA')}
              value={engine}
              onChange={setEngine}
              options={[
                ...ENGINES.map((e) => ({
                  value: e,
                  label: ENGINE_LABELS[e],
                  disabled: !availableEngines(
                    capabilities.engines,
                    project.language_code,
                  ).includes(e),
                })),
                ...(capabilities.engines.length > 1
                  ? [{ value: 'all', label: t('Todas as IAs disponíveis') }]
                  : []),
              ]}
            />
            {project.language_code !== 'en' && (
              <small>
                {t('Gemini está disponível em projetos com idioma inglês.')}
              </small>
            )}
          </label>
          <div className="form-row">
            <label htmlFor="forms-input-5">
              {t('Tópico')}
              <Input
                id="forms-input-5"
                value={topic}
                list="prompt-topics"
                disabled={capabilities.topicLimit === 1 && topics.length > 0}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={40}
              />
            </label>
            <datalist aria-label={t('Tópicos disponíveis')} id="prompt-topics">
              {topics.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </datalist>
            <label htmlFor="forms-input-6">
              Tags
              <Input
                id="forms-input-6"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t('Produto, Decisão')}
              />
              <small>{t('Separe por vírgula. Até 8 tags.')}</small>
            </label>
          </div>
        </>
      )}
      <p className="form-hint">
        {t('Duplicados são ignorados. Cada plataforma conta como um prompt.')}{' '}
        {capabilities.promptLimit === null
          ? t('Seu workspace permite prompts ilimitados.')
          : t('Seu workspace inclui {prompts} prompts e {topics} tópicos.', {
              prompts: capabilities.promptLimit,
              topics: capabilities.topicLimit ?? '∞',
            })}
      </p>
      {error && (
        <div className="notice error-notice" role="alert">
          {error}
        </div>
      )}
      <Button
        type="submit"
        className="lf-primary"
        disabled={busy || (mode === 'csv' && !imported.length)}
      >
        {busy ? t('Salvando…') : t('Adicionar ao acompanhamento')}
      </Button>
    </form>
  );
}
