'use client';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Workspace, Project, Engine, Topic } from '@/lib/types';
import { ENGINE_LABELS } from '@/lib/engines';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Hint } from '@/components/ui/tooltip';
import { SelectField } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { PanelFrequency } from '@/lib/semantic-panel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from './shared';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { SettingsBlock } from './settings-block';
import { SemanticAttributeWizard } from './semantic-attribute-wizard';
import { EngineAvailability } from './country-field';
import { useI18n } from '@/lib/i18n';
import { CollectionSchedule, ProviderKeys, SpendingLimits } from './project-settings-panels';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { topicShares, topicWeight } from '@/lib/topic-weights';
import { formatNumber, formatPercent } from '@/lib/number-format';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import type { requestJson } from '@/lib/client';

type Props = {
  onDirty: (dirty: boolean) => void;
  workspace: Workspace;
  project: Project;
  engines: Engine[];
  busy: boolean;
  mutationError: string;
  clearMutationError: () => void;
  t: (en: string, pt: string) => string;
  save: (path: string, method: string, value: unknown) => Promise<unknown>;
  request: typeof requestJson;
  semantic?: boolean;
  demo?: boolean;
  /** Where the project's brands are edited (the attribute wizard links to it). */
  brandsLink?: { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
};
type Configuration = {
  revision: number;
  enabled: boolean;
  attributes: { id: string; name: string; description?: string }[];
};
export function LiveMonitoringSettings({
  workspace,
  onDirty,
  project,
  engines,
  busy,
  mutationError,
  clearMutationError,
  t,
  save,
  request,
  semantic,
  demo,
  brandsLink,
}: Props) {
  const { locale } = useI18n();
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null,
  );
  const [savedConfiguration, setSavedConfiguration] =
    useState<Configuration | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const dirtyCallback = useRef(onDirty);
  useEffect(() => {
    dirtyCallback.current = onDirty;
  }, [onDirty]);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [showTopics, setShowTopics] = useState(false);
  const [editor, setEditor] = useState<{
    topic: Topic;
    inherit: boolean;
    selected: Engine[];
    /** The topic's weight as typed ('' keeps it unset). */
    weight: string;
  } | null>(null);
  // Topic weights (lib/topic-weights): a topic without one counts with the smallest weight set.
  const weights = project.topic_weights ? new Map(Object.entries(project.topic_weights)) : null;
  const shares = weights ? topicShares(workspace.topics.map((topic) => topic.name), weights) : null;
  const savedWeight = (topic: Topic) => (project.topic_weights?.[topic.name] ?? null);
  const typedWeight = editor?.weight.trim() ? Number(editor.weight) : null;
  const weightInvalid = typedWeight !== null && (!Number.isFinite(typedWeight) || typedWeight < 0 || typedWeight > 1000);
  const topicDirty =
    editor !== null &&
    (typedWeight !== savedWeight(editor.topic) ||
      editor.inherit !== (editor.topic.engines_override == null) ||
      (!editor.inherit &&
        JSON.stringify(editor.selected) !==
          JSON.stringify(
            editor.topic.engines_override ?? project.engines ?? ['chat_gpt'],
          )));
  useEffect(() => {
    dirtyCallback.current(formDirty || topicDirty || scheduleDirty);
  }, [formDirty, topicDirty, scheduleDirty]);
  useEffect(() => () => dirtyCallback.current(false), []);
  // How often Semantic Branding asks the AIs (and draws its periods); only the owner of the project changes it.
  const [frequency, setFrequency] = useState<{
    value: PanelFrequency;
    /** The plan fixes it (for example a plan that only allows monthly). */
    fixed: boolean;
    collecting: boolean;
  } | null>(null);
  const [frequencySaving, setFrequencySaving] = useState(false);
  const [frequencyError, setFrequencyError] = useState('');
  const [frequencyRetry, setFrequencyRetry] = useState(0);
  const [pendingFrequency, setPendingFrequency] = useState<PanelFrequency | null>(
    null,
  );
  const panelPath = `/api/projects/${encodeURIComponent(project.id)}/semantic/panel`;
  const semanticPath = demo
    ? `/api/demo/semantic?project=${encodeURIComponent(project.id)}`
    : `/api/projects/${encodeURIComponent(project.id)}/semantic`;
  useEffect(() => {
    if (!semantic) return;
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setConfiguration(null);
        setError('');
      }
    });
    request<{ configuration: Configuration }>(semanticPath)
      .then((report) => {
        if (active) {
          setConfiguration(report.configuration);
          setSavedConfiguration(report.configuration);
        }
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [semantic, semanticPath, request, retry]);
  useEffect(() => {
    if (!semantic || demo) return;
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setFrequency(null);
        setFrequencyError('');
      }
    });
    request<{ frequency: PanelFrequency; fixed?: boolean; collecting: boolean }>(
      `${panelPath}?view=settings`,
    )
      .then((settings) => {
        if (active)
          setFrequency({
            value: settings.frequency,
            fixed: !!settings.fixed,
            collecting: settings.collecting,
          });
      })
      .catch((cause) => {
        if (active) setFrequencyError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [semantic, demo, panelPath, request, frequencyRetry]);
  const chooseFrequency = (value: PanelFrequency) => {
    if (!frequency || frequencySaving || value === frequency.value) return;
    setPendingFrequency(value);
  };
  const applyFrequency = async (value: PanelFrequency) => {
    if (!frequency || frequencySaving) return;
    setPendingFrequency(null);
    setFrequencyError('');
    setFrequencySaving(true);
    try {
      await request(panelPath, 'PATCH', { frequency: value });
      setFrequency({ ...frequency, value });
    } catch (cause) {
      setFrequencyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFrequencySaving(false);
    }
  };
  // The attribute wizard takes the whole main content, with its own header and the way back (a page, not a dialog).
  if (semantic && wizardOpen && brandsLink && savedConfiguration)
    return (
      <SemanticAttributeWizard
        key={savedConfiguration.revision}
        onClose={() => setWizardOpen(false)}
        configuration={savedConfiguration}
        brands={[{ name: project.name, domain: project.domain }, ...project.competitors.map((brand) => ({ name: brand.name, domain: brand.domain }))]}
        brandsLink={brandsLink}
        path={semanticPath}
        request={request}
        t={t}
        onSaved={(saved) => {
          setConfiguration((now) => (now ? { ...now, revision: saved.revision, attributes: saved.attributes } : now));
          setSavedConfiguration({ ...savedConfiguration, revision: saved.revision, attributes: saved.attributes });
        }}
      />
    );
  if (semantic)
    return (
      <div className="min-w-0 space-y-6">
        {error ? (
          <SectionCard
            inset="padded"
            title={t('Activation and attributes', 'Ativação e atributos')}
          >
            <EmptyState frame="inline" tone="error" title={error} onRetry={() => setRetry(retry + 1)} />
          </SectionCard>
        ) : !configuration ? (
          // The first card that arrives, with its own title: the page heading already says Semantic Branding.
          <SectionCard
            loading
            lines={4}
            title={t('Activation and attributes', 'Ativação e atributos')}
          />
        ) : demo ? (
          <SectionCard
            inset="padded"
            title={t('Semantic Branding', 'Semantic Branding')}
          >
            <div className="live-settings-note">
              <span className="block font-(--weight-label)">
                {t(
                  'Demo configuration (read only)',
                  'Configuração da demo (somente leitura)',
                )}
              </span>
              <p>
                {t(
                  'Semantic Branding is read only in the demo to protect the published study. Create your own account and project to turn it on or off, define your attributes and choose how often the AI models are asked.',
                  'O Semantic Branding é somente leitura na demo para proteger o estudo publicado. Crie sua própria conta e projeto para ativá-lo ou desativá-lo, definir seus atributos e escolher a frequência das consultas às IAs.',
                )}
              </p>
            </div>
            <div className="live-settings-state">
              <div>
                <h3>
                  {t(
                    'Evaluate brand associations',
                    'Avaliar associações da marca',
                  )}
                </h3>
                <p>
                  {t(
                    'Configuration state only. Results appear in Semantic Branding as the AI models are asked.',
                    'Este é o estado da configuração. Os resultados aparecem em Semantic Branding conforme os modelos de IA são consultados.',
                  )}
                </p>
              </div>
              <TagBadge>
                {configuration.enabled
                  ? t('Configured on', 'Configurada como ativa')
                  : t('Configured off', 'Configurada como inativa')}
              </TagBadge>
            </div>
            <h3 className="mt-8">
              {t('Brand attributes', 'Atributos da marca')}
            </h3>
            <dl className="live-semantic-attributes">
              {configuration.attributes.map((attribute) => (
                <div key={attribute.id}>
                  <dt>{attribute.name}</dt>
                  <dd>
                    {attribute.description ||
                      t(
                        'Measures this association in the collected answers.',
                        'Mede esta associação nas respostas coletadas.',
                      )}
                  </dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        ) : (
          <SettingsBlock
            title={t('Activation and attributes', 'Ativação e atributos')}
            t={t}
            busy={busy}
            dirty={
              JSON.stringify(configuration) !==
              JSON.stringify(savedConfiguration)
            }
            onDirty={setFormDirty}
            onCancel={() => {
              setConfiguration(savedConfiguration);
              clearMutationError();
            }}
            save={async () => {
              const success = await save(semanticPath, 'PATCH', {
                ...configuration,
                expectedRevision: configuration.revision,
              });
              if (success) {
                const next = {
                  ...configuration,
                  revision: configuration.revision + 1,
                };
                setConfiguration(next);
                setSavedConfiguration(next);
              }
              return Boolean(success);
            }}
          >
            <div className="live-settings-state">
              <div>
                <label htmlFor="semantic-evaluation-enabled">
                  {t(
                    'Evaluate brand associations',
                    'Avaliar associações da marca',
                  )}
                </label>
                <p id="semantic-evaluation-help">
                  {t(
                    'Ask the AI models about these attributes, with one question that covers all your brands. One AI model is enough. Saving does not run a collection at once: the next scheduled run does.',
                    'Pergunte aos modelos de IA sobre estes atributos, com uma pergunta que cobre todas as suas marcas. Basta um modelo de IA. Salvar não faz uma coleta na hora: a próxima execução agendada faz.',
                  )}
                </p>
              </div>
              <Switch
                id="semantic-evaluation-enabled"
                aria-describedby="semantic-evaluation-help"
                checked={configuration.enabled}
                onCheckedChange={(enabled) =>
                  setConfiguration({ ...configuration, enabled })
                }
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3>{t('Brand attributes', 'Atributos da marca')}</h3>
              {brandsLink && workspace.role !== 'viewer' && (
                <Button type="button" variant="outline" onClick={() => setWizardOpen(true)}>
                  {configuration.attributes.length
                    ? t('Edit or generate attributes', 'Editar ou gerar atributos')
                    : t('Generate attributes', 'Gerar atributos')}
                </Button>
              )}
            </div>
            {configuration.attributes.length ? (
              <dl className="live-semantic-attributes">
                {configuration.attributes.map((attribute) => (
                  <div key={attribute.id}>
                    <dt>{attribute.name}</dt>
                    <dd>
                      {attribute.description ||
                        t('No definition yet. Edit the attributes to add one.', 'Sem definição ainda. Edite os atributos para incluir uma.')}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>
                {t(
                  'No attributes yet. Generate them with the wizard: one AI suggests the attributes of your segment, and you choose.',
                  'Nenhum atributo ainda. Gere pelo wizard: uma IA sugere os atributos do seu segmento e você escolhe.',
                )}
              </p>
            )}
          </SettingsBlock>
        )}
        {configuration && !demo && !error && (
          <SectionCard
            inset="padded"
            title={t('Collection frequency', 'Frequência da coleta')}
          >
            <div
              className="live-settings-state"
              data-testid="semantic-frequency"
            >
              <div>
                <h3 id="semantic-frequency-label" className="sr-only">
                  {t('Collection frequency', 'Frequência da coleta')}
                </h3>
                <p>
                  {t(
                    'How often the AIs this project monitors are asked. It also sets the periods of the Semantic Branding chart. Daily is the default; weekly costs about a seventh as much. Saved as soon as you choose.',
                    'Com que frequência as IAs que este projeto monitora são consultadas. Ela também define os períodos do gráfico do Semantic Branding. Diária é o padrão; semanal custa cerca de um sétimo. Salva assim que você escolhe.',
                  )}
                </p>
                {frequency?.fixed && (
                  <p className="text-caption text-muted-foreground">
                    {t('Your plan collects Semantic Branding once a month.', 'Seu plano coleta o Semantic Branding uma vez por mês.')}
                  </p>
                )}
                {frequency && !frequency.collecting && (
                  <p>
                    {t(
                      'Collection is not running in this installation: it needs the search data key, and it is switched off otherwise.',
                      'A coleta não está rodando nesta instalação: ela precisa da chave de dados de busca e fica desligada sem ela.',
                    )}
                  </p>
                )}
                {frequencyError && (
                  <EmptyState frame="inline" tone="error" title={frequencyError} onRetry={() => setFrequencyRetry(frequencyRetry + 1)} />
                )}
              </div>
              <ToggleGroup
                multiple={false}
                size="sm"
                variant="outline"
                spacing={0}
                disabled={!frequency || frequency.fixed || frequencySaving}
                value={frequency ? [frequency.value] : []}
                onValueChange={(next) =>
                  next[0] && chooseFrequency(next[0] as PanelFrequency)
                }
                aria-labelledby="semantic-frequency-label"
              >
                <ToggleGroupItem value="daily">
                  {t('Daily', 'Diária')}
                </ToggleGroupItem>
                <ToggleGroupItem value="weekly">
                  {t('Weekly', 'Semanal')}
                </ToggleGroupItem>
                <ToggleGroupItem value="monthly">
                  {t('Monthly', 'Mensal')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </SectionCard>
        )}
        <Dialog
          open={pendingFrequency !== null}
          onOpenChange={(open) => {
            if (!open) setPendingFrequency(null);
          }}
        >
          <DialogContent className="live-settings-dialog">
            <DialogHeader>
              <DialogTitle className="pr-8">
                {t(
                  'Save this collection frequency now?',
                  'Salvar esta frequência de coleta agora?',
                )}
              </DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPendingFrequency(null)}
              >
                {t('Cancel', 'Cancelar')}
              </Button>
              <Button
                disabled={pendingFrequency === null || frequencySaving}
                onClick={() =>
                  pendingFrequency && void applyFrequency(pendingFrequency)
                }
              >
                {t('Save', 'Salvar')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  const options = (selected: Engine[]) =>
    engines.map((engine) => (
      <label key={engine} className="live-model-option">
        <input
          type="checkbox"
          name="engines"
          value={engine}
          defaultChecked={selected.includes(engine)}
        />
        <EngineIcon engine={engine} />
        {ENGINE_LABELS[engine]}
      </label>
    ));
  return (
    <div className="min-w-0 space-y-6">
      <CollectionSchedule workspace={workspace} project={project} busy={busy} t={t} save={save} onDirty={setScheduleDirty} />
      <SettingsBlock
        title={t('Default AI models', 'Modelos de IA padrão')}
        t={t}
        busy={busy}
        onDirty={setFormDirty}
        onCancel={clearMutationError}
        save={async (data) =>
          Boolean(
            await save(
              `/api/projects/${encodeURIComponent(project.id)}`,
              'PATCH',
              { engines: data.getAll('engines') },
            ),
          )
        }
      >
        <fieldset className="live-settings-models">
          <legend className="sr-only">
            {t('Default AI models', 'Modelos de IA padrão')}
          </legend>
          <p>
            {t(
              'Questions inherit these models unless their topic or the question itself has an override.',
              'As perguntas herdam estes modelos, exceto quando o tópico ou a própria pergunta tem uma seleção específica.',
            )}
          </p>
          <div className="live-model-options">
            {options(project.engines ?? ['chat_gpt'])}
          </div>
          <EngineAvailability engines={workspace.capabilities.engines} location={project.location_code} locale={locale} t={t} />
        </fieldset>
      </SettingsBlock>
      <SectionCard
        inset="padded"
        title={t('Topics: weight and models', 'Tópicos: peso e modelos')}
      >
        <div className="live-settings-topic-section">
          <div className="live-section-head">
            <div>
              <p className="text-muted-foreground">
                {t(
                  'Weight: how much each topic counts in the overall rates (visibility, share of voice, position, citations, sentiment, source presence); a topic without a weight takes the smallest one. Models: a prompt override wins over a topic override, and a topic override wins over the project defaults.',
                  'Peso: quanto cada tópico conta nas taxas gerais (visibilidade, share of voice, posição, citações, sentimento, presença das fontes); um tópico sem peso fica com o menor. Modelos: a escolha do prompt vale sobre a do tópico, e a do tópico sobre o padrão do projeto.',
                )}
              </p>
            </div>
            <Button
              variant="outline"
              aria-expanded={showTopics}
              onClick={() => setShowTopics(!showTopics)}
            >
              {showTopics
                ? t('Hide topics', 'Ocultar tópicos')
                : t('Manage topics', 'Gerenciar tópicos')}
              <ChevronDown
                size={15}
                className={showTopics ? 'rotate-180' : ''}
              />
            </Button>
          </div>
          {showTopics && (
            <div className="mt-5">
              <DataTable
                singleLine
                rows={workspace.topics}
                rowKey={(topic) => topic.id}
                columns={[
                  {
                    key: 'topic',
                    header: t('Topic', 'Tópico'),
                    sortValue: (topic) => topic.name,
                    mobile: 'title',
                    cell: (topic) => topic.name,
                  },
                  {
                    key: 'weight',
                    header: t('Weight', 'Peso'),
                    label: t('Weight', 'Peso'),
                    align: 'end',
                    sortValue: (topic) => (weights ? topicWeight(weights, topic.name) : null),
                    cell: (topic) =>
                      weights ? (
                        <span>
                          {formatNumber(locale, topicWeight(weights, topic.name), 0)}
                          <span className="text-muted-foreground"> ({formatPercent(locale, shares?.get(topic.name) ?? 0)})</span>
                        </span>
                      ) : (
                        <Hint text={t('No weights: every answer counts the same.', 'Sem pesos: toda resposta conta igual.')}>
                          <span className="text-muted-foreground">—</span>
                        </Hint>
                      ),
                  },
                  {
                    key: 'selection',
                    header: t('Model selection', 'Seleção de modelos'),
                    sortValue: (topic) => topic.engines_override == null ? t('Inherits project', 'Herda do projeto') : t('Topic override', 'Seleção do tópico'),
                    label: t('Model selection', 'Seleção de modelos'),
                    cell: (topic) =>
                      topic.engines_override == null
                        ? t('Inherits project', 'Herda do projeto')
                        : t('Topic override', 'Seleção do tópico'),
                  },
                  {
                    key: 'models',
                    header: t('AI models', 'Modelos de IA'),
                    sortValue: (topic) => (topic.engines_override ?? project.engines ?? ['chat_gpt']).map((engine) => ENGINE_LABELS[engine]).join(', '),
                    label: t('AI models', 'Modelos de IA'),
                    cell: (topic) => (
                      <span className="live-model-icons">
                        {(
                          topic.engines_override ??
                          project.engines ?? ['chat_gpt']
                        ).map((engine) => (
                          <Hint key={engine} text={ENGINE_LABELS[engine]}>
                          <span>
                            <EngineIcon engine={engine} />
                            <span className="sr-only">{ENGINE_LABELS[engine]}</span>
                          </span>
                          </Hint>
                        ))}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: t('Actions', 'Ações'),
                    align: 'end',
                    cell: (topic) => (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          clearMutationError();
                          setEditor({
                            topic,
                            inherit: topic.engines_override == null,
                            selected: topic.engines_override ??
                              project.engines ?? ['chat_gpt'],
                            weight: savedWeight(topic) == null ? '' : String(savedWeight(topic)),
                          });
                        }}
                      >
                        {t('Manage', 'Gerenciar')}
                      </Button>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </div>
      </SectionCard>
      {/* Costs are for the workspace's admins and owner (the route refuses anyone else). */}
      {(workspace.role === undefined || workspace.role === 'owner' || workspace.role === 'admin') && <SpendingLimits project={project} workspace={workspace} request={request} t={t} demo={demo} />}
      <ProviderKeys workspace={workspace} t={t} />
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent className="live-settings-dialog">
          <DialogHeader>
            <DialogTitle>
              {editor?.topic.name}
            </DialogTitle>
            <DialogDescription>
              {t(
                'Applies to questions that inherit their models. Questions with their own override keep their selection.',
                'Aplica-se às perguntas que herdam modelos. Perguntas com seleção própria mantêm sua configuração.',
              )}
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <form
              className="live-form"
              onSubmit={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (
                  await save('/api/topics', 'PATCH', {
                    id: editor.topic.id,
                    engines: editor.inherit ? null : editor.selected,
                    weight: typedWeight,
                  })
                )
                  setEditor(null);
              }}
            >
              <label>
                {t('Weight', 'Peso')}
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={1000}
                  step="any"
                  value={editor.weight}
                  placeholder={weights ? String(Math.min(...weights.values())) : ''}
                  aria-invalid={weightInvalid || undefined}
                  onChange={(event) => setEditor({ ...editor, weight: event.target.value })}
                />
                <span className="text-caption text-muted-foreground">
                  {t(
                    'Relative to the other topics (e.g. 50, 30, 10, 5). Empty: the smallest weight set.',
                    'Relativo aos outros tópicos (ex.: 50, 30, 10, 5). Vazio: o menor peso definido.',
                  )}
                </span>
              </label>
              <label>
                {t('Model selection', 'Seleção de modelos')}
                <SelectField
                  value={editor.inherit ? 'inherit' : 'custom'}
                  onValueChange={(mode) => setEditor({ ...editor, inherit: mode === 'inherit' })}
                  options={[
                    { value: 'inherit', label: t('Inherit project defaults', 'Herdar padrão do projeto') },
                    { value: 'custom', label: t('Choose models for this topic', 'Escolher modelos para este tópico') },
                  ]}
                />
              </label>
              <fieldset disabled={editor.inherit}>
                <legend>{t('AI models', 'Modelos de IA')}</legend>
                <div className="live-model-options">
                  {engines.map((engine) => (
                    <label className="live-model-option" key={engine}>
                      <input
                        type="checkbox"
                        checked={(editor.inherit
                          ? (project.engines ?? ['chat_gpt'])
                          : editor.selected
                        ).includes(engine)}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            selected: event.target.checked
                              ? [...editor.selected, engine]
                              : editor.selected.filter(
                                  (value) => value !== engine,
                                ),
                          })
                        }
                      />
                      <EngineIcon engine={engine} />
                      {ENGINE_LABELS[engine]}
                    </label>
                  ))}
                </div>
              </fieldset>
              {mutationError && (
                <p role="alert" className="text-body text-destructive">
                  {mutationError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditor(null)}
                >
                  {t('Cancel', 'Cancelar')}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !topicDirty ||
                    weightInvalid ||
                    (!editor.inherit && !editor.selected.length)
                  }
                >
                  {busy
                    ? t('Saving…', 'Salvando…')
                    : t('Save topic', 'Salvar tópico')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
