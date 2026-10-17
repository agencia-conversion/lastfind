'use client';
import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Workspace, Project, Engine, Topic } from '@/lib/types';
import { ENGINE_LABELS } from '@/lib/engines';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AnalyticsSkeleton } from './shared';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import type { requestJson } from '@/lib/client';

type Props = {
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
};
type Configuration = {
  revision: number;
  enabled: boolean;
  attributes: { id: string; name: string; description?: string }[];
};
export function LiveMonitoringSettings({
  workspace,
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
}: Props) {
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null,
  );
  const [error, setError] = useState('');
  const [showTopics, setShowTopics] = useState(false);
  const [editor, setEditor] = useState<{
    topic: Topic;
    inherit: boolean;
    selected: Engine[];
  } | null>(null);
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
        if (active) setConfiguration(report.configuration);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [semantic, semanticPath, request]);
  if (semantic)
    return (
      <SectionCard
        className="live-settings-panel"
        title={t('Semantic Branding', 'Semantic Branding')}
        action={configuration && !demo && !error ? (
          <Button disabled={busy} type="submit" form="semantic-settings-form">
            {t('Save attributes', 'Salvar atributos')}
          </Button>
        ) : undefined}
        description={t(
            'Measure how collected answers associate your brand with the attributes that matter to you.',
            'Meça como as respostas coletadas associam sua marca aos atributos que importam para você.',
          )}
      >
        {error ? (
          <p role="alert">{error}</p>
        ) : !configuration ? (
          <AnalyticsSkeleton
            label={t('Loading attributes…', 'Carregando atributos…')}
            rows={4}
          />
        ) : demo ? (
          <>
            <div className="live-settings-note">
              <span className="block font-medium">
                {t(
                  'Demo configuration · Read only',
                  'Configuração da demo · Somente leitura',
                )}
              </span>
              <p>
                {t(
                  'Semantic Branding is read only in the demo to protect the published study. Create your own account and project to turn association evaluation on or off and define your attributes.',
                  'O Semantic Branding é somente leitura na demo para proteger o estudo publicado. Crie sua própria conta e projeto para ativar ou desativar a avaliação de associações e definir seus atributos.',
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
                    'Configuration state only. Evaluation results appear in Semantic Branding as collected answers are assessed.',
                    'Este é o estado da configuração. Os resultados aparecem em Semantic Branding conforme as respostas coletadas são avaliadas.',
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
          </>
        ) : (
          <form
            className="live-form live-settings-form"
            id="semantic-settings-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const success = await save(semanticPath, 'PATCH', {
                ...configuration,
                expectedRevision: configuration.revision,
              });
              if (success) {
                try {
                  const result = await request<{
                    configuration: Configuration;
                  }>(semanticPath);
                  setConfiguration(result.configuration);
                } catch (cause) {
                  setError(String(cause));
                }
              }
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
                    'Use these attributes when eligible collected answers are evaluated. Saving this configuration does not mean evaluations have completed.',
                    'Use estes atributos na avaliação de respostas coletadas elegíveis. Salvar esta configuração não significa que as avaliações já foram concluídas.',
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
              <Button
                type="button"
                variant="outline"
                disabled={configuration.attributes.length >= 10}
                onClick={() =>
                  setConfiguration({
                    ...configuration,
                    attributes: [
                      ...configuration.attributes,
                      { id: crypto.randomUUID(), name: '', description: '' },
                    ],
                  })
                }
              >
                {t('Add attribute', 'Adicionar atributo')}
              </Button>
            </div>
            <div className="live-semantic-editors">
              {configuration.attributes.map((attribute, index) => (
                <fieldset key={attribute.id} className="live-semantic-editor">
                  <legend>
                    {t('Attribute', 'Atributo')} {index + 1}
                  </legend>
                  <label>
                    {t('Name', 'Nome')}
                    <input
                      value={attribute.name}
                      required
                      minLength={2}
                      maxLength={60}
                      onChange={(event) =>
                        setConfiguration({
                          ...configuration,
                          attributes: configuration.attributes.map((item, i) =>
                            i === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    {t(
                      'What this attribute means',
                      'O que este atributo significa',
                    )}
                    <textarea
                      value={attribute.description ?? ''}
                      maxLength={240}
                      onChange={(event) =>
                        setConfiguration({
                          ...configuration,
                          attributes: configuration.attributes.map((item, i) =>
                            i === index
                              ? { ...item, description: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setConfiguration({
                        ...configuration,
                        attributes: configuration.attributes.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    {t('Remove attribute', 'Remover atributo')}
                  </Button>
                </fieldset>
              ))}
            </div>
            {!configuration.attributes.length && (
              <p>
                {t(
                  'No attributes configured yet.',
                  'Nenhum atributo configurado ainda.',
                )}
              </p>
            )}
          </form>
        )}
      </SectionCard>
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
    <SectionCard
      className="live-settings-panel"
      title={t('Monitoring', 'Monitoramento')}
      action={(
        <Button disabled={busy} type="submit" form="monitoring-models-form">
          {t('Save default models', 'Salvar modelos padrão')}
        </Button>
      )}
      description={t(
          'Set the default models and collection schedule for this project.',
          'Defina os modelos padrão e a frequência de coleta deste projeto.',
        )}
    >
      <div className="live-settings-state">
        <div>
          <h3>{t('Collection frequency', 'Frequência de coleta')}</h3>
          <p>
            {workspace.capabilities.promptLimit === 10
              ? t(
                  'Weekly, Mondays at 4 am São Paulo',
                  'Semanal, segundas às 4h de São Paulo',
                )
              : t('Daily at 4 am São Paulo', 'Diário às 4h de São Paulo')}{' '}
            ·{' '}
            {project.daily_enabled
              ? t('Enabled', 'Ativa')
              : t('Paused', 'Pausada')}
          </p>
          <p>
            {workspace.capacity.prompts} /{' '}
            {workspace.capabilities.promptLimit ?? '∞'}{' '}
            {t('questions in this workspace', 'perguntas neste workspace')}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void save(
              `/api/projects/${encodeURIComponent(project.id)}`,
              'PATCH',
              { daily_enabled: !project.daily_enabled },
            )
          }
        >
          {project.daily_enabled
            ? t('Pause monitoring', 'Pausar monitoramento')
            : t('Resume monitoring', 'Retomar monitoramento')}
        </Button>
      </div>
      <form
        className="live-form live-settings-form"
        id="monitoring-models-form"
        key={`${project.id}|${project.engines?.join()}`}
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            `/api/projects/${encodeURIComponent(project.id)}`,
            'PATCH',
            { engines: new FormData(event.currentTarget).getAll('engines') },
          );
        }}
      >
        <fieldset className="live-settings-models">
          <legend>{t('Default AI models', 'Modelos de IA padrão')}</legend>
          <p>
            {t(
              'Questions inherit these models unless their topic or the question itself has an override.',
              'As perguntas herdam estes modelos, exceto quando o tópico ou a própria pergunta tem uma seleção específica.',
            )}
          </p>
          <div className="live-model-options">
            {options(project.engines ?? ['chat_gpt'])}
          </div>
        </fieldset>
      </form>
      <div className="live-settings-topic-section">
        <div className="live-section-head">
          <div>
            <h3>{t('Topic overrides', 'Modelos específicos por tópico')}</h3>
            <p className="text-muted-foreground">
              {t(
                'Project defaults → topic override → prompt override. The most specific selection applies.',
                'Padrão do projeto → seleção do tópico → seleção do prompt. A configuração mais específica prevalece.',
              )}
            </p>
          </div>
          <Button
            variant="outline"
            aria-expanded={showTopics}
            onClick={() => setShowTopics(!showTopics)}
          >
            {showTopics
              ? t('Hide topic overrides', 'Ocultar modelos por tópico')
              : t('Manage topic overrides', 'Gerenciar modelos por tópico')}
            <ChevronDown size={15} className={showTopics ? 'rotate-180' : ''} />
          </Button>
        </div>
        {showTopics && (
          <div className="live-settings-table">
            <DataTable
              rows={workspace.topics}
              rowKey={(topic) => topic.id}
              columns={[
                { key: 'topic', header: t('Topic', 'Tópico'), mobile: 'title', cell: (topic) => topic.name },
                {
                  key: 'selection',
                  header: t('Model selection', 'Seleção de modelos'),
                  label: t('Model selection', 'Seleção de modelos'),
                  cell: (topic) =>
                    topic.engines_override == null
                      ? t('Inherits project', 'Herda do projeto')
                      : t('Topic override', 'Seleção do tópico'),
                },
                {
                  key: 'models',
                  header: t('AI models', 'Modelos de IA'),
                  label: t('AI models', 'Modelos de IA'),
                  cell: (topic) => (
                    <span className="live-model-icons">
                      {(topic.engines_override ?? project.engines ?? ['chat_gpt']).map((engine) => (
                        <span key={engine} title={ENGINE_LABELS[engine]}>
                          <EngineIcon engine={engine} />
                        </span>
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
                          selected: topic.engines_override ?? project.engines ?? ['chat_gpt'],
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
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent className="live-settings-dialog">
          <DialogHeader>
            <DialogTitle className="text-section leading-6 font-medium">{editor?.topic.name}</DialogTitle>
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
                if (
                  await save('/api/topics', 'PATCH', {
                    id: editor.topic.id,
                    engines: editor.inherit ? null : editor.selected,
                  })
                )
                  setEditor(null);
              }}
            >
              <label>
                {t('Model selection', 'Seleção de modelos')}
                <select
                  value={editor.inherit ? 'inherit' : 'custom'}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      inherit: event.target.value === 'inherit',
                    })
                  }
                >
                  <option value="inherit">
                    {t('Inherit project defaults', 'Herdar padrão do projeto')}
                  </option>
                  <option value="custom">
                    {t(
                      'Choose models for this topic',
                      'Escolher modelos para este tópico',
                    )}
                  </option>
                </select>
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
                    busy || (!editor.inherit && !editor.selected.length)
                  }
                >
                  {t('Save topic models', 'Salvar modelos do tópico')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
