'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import { DataTable, skeletonColumns } from '@/components/lastfind/presentation/data-table';
import { Note } from '@/components/lastfind/presentation/note';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { AdminLoadError } from './admin-states';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';

type Fn = {
  id: string;
  label: [string, string];
  decides: [string, string];
  rerun: boolean;
  default: string;
  stored: string | null;
  env: string | null;
  effective: string;
  source: 'stored' | 'env' | 'default' | 'fixed';
};
type Legacy = { projectId: string; name: string; domain: string | null; sentiment: string; sourceTypes: string; automatic: boolean; revision: number };
export type ClassifiersData = { functions: Fn[]; legacy: Legacy[]; learningDisabled?: boolean; decisionModelKey?: boolean };
type Copy = (en: string, pt: string) => string;
const KNOWN_MODELS_LIST = 'admin-known-models';

async function patch(body: Record<string, unknown>) {
  const response = await fetch('/api/admin/classifiers', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  const json = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response?.ok) throw new Error(typeof json?.error === 'string' ? json.error : `HTTP ${response?.status ?? 0}`);
  return json as ClassifiersData;
}

function ModelEditor({ fn, pt, t, onSaved }: { fn: Fn; pt: boolean; t: Copy; onSaved: (data: ClassifiersData) => void }) {
  // The draft while typing; cleared on save, so the row shows the model now in effect.
  const [draft, setDraft] = useState<string | null>(null);
  const model = draft ?? fn.effective;
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' });
  const save = async (value: string) => {
    setState({ kind: 'saving' });
    try {
      onSaved(await patch({ id: fn.id, model: value }));
      setDraft(null);
      setState({ kind: 'saved' });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  const changed = model.trim() !== fn.effective;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          list={KNOWN_MODELS_LIST}
          aria-label={`${t('Model', 'Modelo')}: ${fn.label[pt ? 1 : 0]}`}
          className="w-64 max-w-full font-mono text-caption"
          spellCheck={false}
          value={model}
          disabled={state.kind === 'saving'}
          onChange={(event) => {
            setDraft(event.target.value);
            setState({ kind: 'idle' });
          }}
        />
        <Button disabled={!changed || !model.trim() || state.kind === 'saving'} onClick={() => void save(model)}>
          {state.kind === 'saving' ? t('Saving', 'Salvando') : t('Save', 'Salvar')}
        </Button>
        {fn.stored && (
          <Button variant="ghost" disabled={state.kind === 'saving'} onClick={() => void save('')}>{t('Use default', 'Usar padrão')}</Button>
        )}
      </div>
      <output className="block text-caption text-muted-foreground">
        {state.kind === 'saved' ? t('Saved. New work uses it from the next request.', 'Salvo. Trabalho novo usa a partir da próxima solicitação.')
          : state.kind === 'error' ? <span className="text-destructive">{state.message}</span>
          : null}
      </output>
    </div>
  );
}

/** One project that chose its evaluators before the global setting: shown with what it runs and a confirmed reset. */
function LegacyRow({ row, t, onSaved }: { row: Legacy; t: Copy; onSaved: (data: ClassifiersData) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'error'; message?: string }>({ kind: 'idle' });
  const reset = async () => {
    setConfirm(false);
    setState({ kind: 'saving' });
    try {
      onSaved(await patch({ action: 'reset-evaluators', projectId: row.projectId, expectedRevision: row.revision }));
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <div className="grid gap-1">
      <Button variant="outline" disabled={state.kind === 'saving'} onClick={() => setConfirm(true)}>
        {state.kind === 'saving' ? t('Resetting', 'Redefinindo') : t('Reset to defaults', 'Voltar ao padrão')}
      </Button>
      {state.kind === 'error' && <output className="block text-caption text-destructive">{state.message}</output>}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`Reset the evaluators of ${row.name}?`, `Voltar os avaliadores de ${row.name} ao padrão?`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('The project goes back to the default sentiment and source-type evaluators, the ones every other project uses when no global model is saved. Pending work queued for the old evaluator is cancelled. Sentiment readings the old evaluator made count as out of date until they are evaluated again (an automatic project does that under its monthly ceiling, at a cost); source types are kept, the catalog is global. The change is logged with your name.', 'O projeto volta aos avaliadores padrão de sentimento e tipos de fonte, os que todos os outros projetos usam quando não há modelo global salvo. Trabalho pendente na fila do avaliador antigo é cancelado. Leituras de sentimento feitas pelo avaliador antigo contam como desatualizadas até serem avaliadas de novo (um projeto automático faz isso sob o teto mensal, com custo); tipos de fonte ficam, o catálogo é global. A alteração fica registrada com seu nome.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel', 'Cancelar')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void reset()}>{t('Reset', 'Redefinir')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The agent's learning (its curator) for every project: off stops every paid run at once, nothing else changes. */
function LearningSwitch({ disabled, t, onSaved }: { disabled: boolean; t: Copy; onSaved: (data: ClassifiersData) => void }) {
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'error'; message?: string }>({ kind: 'idle' });
  const toggle = async (on: boolean) => {
    setState({ kind: 'saving' });
    try {
      onSaved(await patch({ action: 'learning', disabled: !on }));
      setState({ kind: 'idle' });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <SectionCard
      inset="padded"
      title={t('Agent learning', 'Aprendizado do agente')}
      description={t("The learning review reads finished conversations and ratings and keeps what the team taught the agent, under each project's monthly cap. Off stops every run in every project; what it already changed stays, with its history.", 'A revisão de aprendizado lê conversas terminadas e avaliações e guarda o que o time ensinou ao agente, sob o teto mensal de cada projeto. Desligado, nenhuma revisão roda em nenhum projeto; o que ela já mudou fica, com o histórico.')}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Switch id="agent-learning" checked={!disabled} disabled={state.kind === 'saving'} onCheckedChange={(on) => void toggle(on)} />
        <label htmlFor="agent-learning" className="text-body">{disabled ? t('Off for every project', 'Desligado em todos os projetos') : t('On, under each project’s cap', 'Ligado, sob o teto de cada projeto')}</label>
        {state.kind === 'error' && <output className="text-caption text-destructive">{state.message}</output>}
      </div>
    </SectionCard>
  );
}

/** Admin > Classifiers: one model per function, for every project. */
export function AdminClassifiers() {
  const { locale } = useI18n();
  const pt = locale === 'pt-BR';
  const t: Copy = (en, ptText) => (pt ? ptText : en);
  const [data, setData] = useState<ClassifiersData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch('/api/admin/classifiers')
      .then((response) => (response.ok ? (response.json() as Promise<ClassifiersData>) : Promise.reject(new Error(String(response.status)))))
      .then(setData, () => setFailed(true));
  }, []);
  const title = t('Model per function', 'Modelo por função');
  const description = t('Every project runs the model chosen here. Saving never starts an evaluation; new work uses the new model and earlier results stay until they are redone.', 'Todos os projetos usam o modelo escolhido aqui. Salvar nunca inicia uma avaliação; trabalho novo usa o novo modelo e resultados anteriores ficam até serem refeitos.');
  if (failed) return <AdminLoadError />;
  if (!data)
    return (
      <>
        <SectionCard title={title} description={description}>
          <div className="live-table-scroll"><DataTable loading={4} ariaLabel={title} rows={[]} rowKey={String} columns={skeletonColumns(4)} /></div>
        </SectionCard>
        <SectionCard loading lines={2} />
      </>
    );
  const known = [...new Set(data.functions.flatMap((fn) => [fn.default, fn.env, fn.stored, fn.effective]).filter((value): value is string => !!value))].sort();
  const source = (fn: Fn) =>
    fn.source === 'stored' ? t('Saved here', 'Salvo aqui') : fn.source === 'env' ? t('Server variable', 'Variável do servidor') : fn.source === 'fixed' ? t('Fixed in the code', 'Fixo no código') : t('Code default', 'Padrão do código');
  return (
    <>
      <SectionCard
        title={title}
        description={description}
      >
        <datalist id={KNOWN_MODELS_LIST}>{known.map((model) => <option key={model} value={model}>{model}</option>)}</datalist>
        <div className="live-table-scroll">
          <DataTable
            ariaLabel={title}
            rows={data.functions}
            rowKey={(fn) => fn.id}
            columns={[
              { key: 'function', header: t('Function', 'Função'), mobile: 'title', headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal', cell: (fn) => <span className="font-medium">{fn.label[pt ? 1 : 0]}</span> },
              { key: 'decides', header: t('Decides', 'Decide'), label: t('Decides', 'Decide'), headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal text-muted-foreground', cell: (fn) => fn.decides[pt ? 1 : 0] },
              { key: 'model', header: t('Model', 'Modelo'), label: t('Model', 'Modelo'), mobile: 'wide', headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal', cell: (fn) => (fn.source === 'fixed' ? <code className="text-caption">{fn.effective}</code> : <ModelEditor key={fn.id} fn={fn} pt={pt} t={t} onSaved={setData} />) },
              { key: 'source', header: t('Source', 'Origem'), label: t('Source', 'Origem'), headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal', cell: (fn) => <TagBadge tone={fn.source === 'stored' ? 'primary' : fn.source === 'env' ? 'neutral' : 'quiet'}>{source(fn)}</TagBadge> },
            ]}
          />
        </div>
        {data.decisionModelKey === false && (
          <Note>
            {t(
              'No OpenRouter key is set, so no model here is asked. Monitored names that are also common words ("Conversion" the agency or the word) count as the text matcher finds them, as before. Add the key in the Providers section of Admin and reprocess brand detection for the decision model to settle them.',
              'Nenhuma chave do OpenRouter está configurada, então nenhum modelo daqui é perguntado. Nomes monitorados que também são palavras comuns ("Conversion" a agência ou a palavra) contam como o texto os encontra, como antes. Adicione a chave na seção Provedores do Admin e reprocesse a detecção de marcas para o modelo de decisão resolvê-los.',
            )}
          </Note>
        )}
        <Note>
          {t('Order: a model saved here, else the server variable LASTFIND_CLASSIFIER_MODELS, else the code default. The code default is also the model a failed call falls back to once.', 'Ordem: o modelo salvo aqui, senão a variável do servidor LASTFIND_CLASSIFIER_MODELS, senão o padrão do código. O padrão do código também é o modelo em que uma chamada com falha é repetida uma vez.')}
        </Note>
        <Note>
          {t('Sentiment and roles keep their model in each reading: after a change, earlier readings count as out of date until they are evaluated again. Source types and brand domains are cached by key and are never reclassified by a model change. Projects that chose a sentiment or source-type evaluator before this setting existed keep it only as their default: a model saved here applies to them too.', 'Sentimento e papéis guardam o modelo em cada leitura: depois de uma troca, leituras anteriores contam como desatualizadas até serem avaliadas de novo. Tipos de fonte e domínios de marca ficam em cache por chave e nunca são reclassificados por troca de modelo. Projetos que escolheram um avaliador de sentimento ou de tipos de fonte antes desta configuração existir mantêm a escolha só como padrão: um modelo salvo aqui vale para eles também.')}
        </Note>
      </SectionCard>
      <LearningSwitch disabled={!!data.learningDisabled} t={t} onSaved={setData} />
      <SectionCard
        title={t('Projects with their own evaluator choice', 'Projetos com avaliador próprio')}
        description={t('Chosen per project before this setting existed. They run these models only while no global model is saved for the function; a global model applies to them too. Nothing is migrated by itself: resetting changes what the project runs and marks its sentiment readings out of date, so it is a decision per project.', 'Escolhidos por projeto antes desta configuração existir. Eles usam estes modelos só enquanto não houver modelo global salvo para a função; um modelo global vale para eles também. Nada é migrado sozinho: redefinir muda o que o projeto roda e marca as leituras de sentimento como desatualizadas, então é uma decisão por projeto.')}
        inset={!data.legacy.length ? 'padded' : undefined}
      >
        {data.legacy.length ? (
          <div className="live-table-scroll">
            <DataTable
              ariaLabel={t('Projects with their own evaluator choice', 'Projetos com avaliador próprio')}
              rows={data.legacy}
              rowKey={(row) => row.projectId}
              columns={[
                { key: 'project', header: t('Project', 'Projeto'), mobile: 'title', headerClassName: 'whitespace-normal', cellClassName: 'whitespace-normal', cell: (row) => <span className="min-w-0 [overflow-wrap:anywhere]"><span className="block font-medium">{row.name}</span>{row.domain && <span className="block text-caption text-muted-foreground">{row.domain}</span>}</span> },
                { key: 'sentiment', header: t('Sentiment', 'Sentimento'), label: t('Sentiment', 'Sentimento'), cell: (row) => <code className="text-caption">{row.sentiment}</code> },
                { key: 'source', header: t('Source types', 'Tipos de fonte'), label: t('Source types', 'Tipos de fonte'), cell: (row) => <code className="text-caption">{row.sourceTypes}</code> },
                { key: 'mode', header: t('Mode', 'Modo'), label: t('Mode', 'Modo'), cell: (row) => <TagBadge tone={row.automatic ? 'primary' : 'neutral'}>{row.automatic ? t('Automatic', 'Automático') : t('Manual', 'Manual')}</TagBadge> },
                { key: 'actions', header: <span className="sr-only">{t('Actions', 'Ações')}</span>, mobile: 'actions', cell: (row) => <LegacyRow key={`${row.projectId}:${row.revision}`} row={row} t={t} onSaved={setData} /> },
              ]}
            />
          </div>
        ) : (
          <p className="text-body text-muted-foreground">{t('Every project runs the default evaluators.', 'Todos os projetos usam os avaliadores padrão.')}</p>
        )}
      </SectionCard>
      <SectionCard inset="padded" title={t('Without a model', 'Sem modelo')} description={t('Brand detection and brand positions run in code, free. They have no model to choose.', 'Detecção de marcas e posições das marcas rodam em código, de graça. Não têm modelo a escolher.')}>
        <p className="text-body text-muted-foreground">{t('Their versions are listed in Algorithms.', 'As versões deles estão em Algoritmos.')}</p>
      </SectionCard>
    </>
  );
}
