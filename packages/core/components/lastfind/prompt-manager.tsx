'use client';
import { useI18n } from '@/lib/i18n';
import { Card } from '@/components/ui/card';
import { useState } from 'react';
import {
  Search,
  Pencil,
  Pause,
  Play,
  Archive,
  RotateCcw,
  Tags,
  ArrowUpRight,
  Download,
  Folder,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableCell,
  TableBody,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { Topic } from '@/lib/types';
import type { Workspace } from '@/lib/types';
import { EngineBadge } from './identity-icons';
import { Choice } from './forms';
import { type Prompt, type Project, type Run } from '@/lib/types';
import { requestJson } from '@/lib/client';
import { PromptHistory } from './prompt-history';
import type { PromptReport } from '@/lib/report-types';
import { summarize } from '@/lib/metrics';
export function PromptManager({
  now,
  topics: savedTopics,
  capabilities,
  capacity,
  prompts,
  runs,
  statistics,
  reportBase,
  project,
  engine,
  demo,
  onReload,
  onAdd,
  onOpen,
}: {
  now: number;
  topics: Topic[];
  capabilities: Workspace['capabilities'];
  capacity: { prompts: number; topics: number };
  prompts: Prompt[];
  runs: Run[];
  statistics?: PromptReport;
  reportBase?: string;
  project: Project;
  engine: string;
  demo: boolean;
  onReload: () => Promise<void>;
  onAdd: () => void;
  onOpen: (r: Run) => void;
}) {
  const { t, locale, formatTime: formatMonitoringTime } = useI18n();
  const [view, setView] = useState('active'),
    [query, setQuery] = useState(''),
    [topic, setTopic] = useState('all'),
    [tag, setTag] = useState('all'),
    [sort, setSort] = useState('recent'),
    [ids, setIds] = useState<string[]>([]),
    [editing, setEditing] = useState<Prompt | null>(null),
    [organize, setOrganize] = useState(false),
    [archiveConfirm, setArchiveConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [topicDialog, setTopicDialog] = useState<{
      id?: string;
      name: string;
    } | null>(null),
    [historyPrompt, setHistoryPrompt] = useState<Prompt | null>(null),
    [promptPage, setPromptPage] = useState(1);
  const visible = prompts
    .filter(
      (p) =>
        (view === 'archived'
          ? p.archived
          : view === 'paused'
            ? !p.archived && !p.active
            : !p.archived && p.active) &&
        (engine === 'all' || p.engine === engine) &&
        (topic === 'all' || p.tag === topic) &&
        (tag === 'all' || p.tags.includes(tag)) &&
        `${p.text} ${p.tag} ${p.tags.join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.text.localeCompare(b.text)
        : b.created_at.localeCompare(a.created_at),
    );
  const topics = [
      ...new Set([
        ...savedTopics.map((t) => t.name),
        ...prompts.map((p) => p.tag),
      ]),
    ].sort(),
    tags = [...new Set(prompts.flatMap((p) => p.tags))].sort();
  async function act(fn: () => Promise<void>) {
    if (demo) {
      setMessage(t('Entre na sua conta para gerenciar seus próprios prompts.'));
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await onReload();
      setIds([]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t('Não foi possível concluir.'),
      );
    } finally {
      setBusy(false);
    }
  }
  async function bulk(action: string, extra: Record<string, unknown> = {}) {
    await act(async () => {
      const r = await requestJson<{ updated: number; skipped: number }>(
        '/api/prompts/bulk',
        'PATCH',
        { project_id: project.id, ids, action, ...extra },
      );
      setMessage(
        t('{count} prompts atualizados.', { count: r.updated }) +
          (r.skipped
            ? ' ' +
              t(
                '{count} não puderam ser restaurados por limite ou duplicidade.',
                { count: r.skipped },
              )
            : ''),
      );
      setOrganize(false);
      setArchiveConfirm(false);
    });
  }
  const selectView = (v: string) => {
    setView(v);
    setIds([]);
  };
  function exportPrompts() {
    const q = (v: string) => '"' + v.replace(/"/g, '""') + '"';
    const safe = (v: string) => (/^[\s]*[=+@-]/.test(v) ? "'" + v : v);
    const csv = [
      'prompt,engine,topic,tags',
      ...visible.map((p) =>
        [p.text, p.engine, p.tag, p.tags.join('|')]
          .map((x) => q(safe(x)))
          .join(','),
      ),
    ].join('\r\n');
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lastfind-prompts.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="prompt-layout">
      <aside className="topic-rail panel">
        <div className="topic-rail-title">
          <b>{t('Tópicos')}</b>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('Criar tópico')}
            onClick={() => {
              setError('');
              setTopicDialog({ name: '' });
            }}
            disabled={
              capabilities.topicLimit !== null &&
              capacity.topics >= capabilities.topicLimit
            }
          >
            <Plus size={16} />
          </Button>
        </div>
        <button
          className={topic === 'all' ? 'selected' : ''}
          onClick={() => {
            setTopic('all');
            setIds([]);
            setPromptPage(1);
          }}
        >
          <Folder size={16} />
          <span>{t('Todos os tópicos')}</span>
          <small>{prompts.filter((p) => !p.archived).length}</small>
        </button>
        {topics.map((t) => (
          <div className="topic-rail-row" key={t}>
            <button
              className={topic === t ? 'selected' : ''}
              onClick={() => {
                setTopic(t);
                setIds([]);
                setPromptPage(1);
              }}
            >
              <Folder size={16} />
              <span>{t}</span>
              <small>
                {prompts.filter((p) => p.tag === t && !p.archived).length}
              </small>
            </button>
            {savedTopics.some((s) => s.name === t) && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  locale === 'en'
                    ? `Manage topic ${t}`
                    : `Gerenciar tópico ${t}`
                }
                onClick={() => {
                  setError('');
                  setTopicDialog(savedTopics.find((s) => s.name === t)!);
                }}
              >
                <Pencil size={13} />
              </Button>
            )}
          </div>
        ))}
        <p>
          {capacity.topics} / {capabilities.topicLimit ?? '∞'}{' '}
          {t('tópicos na conta')}
        </p>
      </aside>
      <Card className="gap-0 py-0 ring-0 panel prompt-manager">
        <div className="table-toolbar">
          <Tabs value={view} onValueChange={(v) => selectView(String(v))}>
            <TabsList variant="line">
              <TabsTrigger value="active">
                {t('Ativos (')}
                {prompts.filter((p) => p.active && !p.archived).length})
              </TabsTrigger>
              <TabsTrigger value="paused">{t('Pausados')}</TabsTrigger>
              <TabsTrigger value="archived">{t('Arquivados')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <span>
            {capacity.prompts} / {capabilities.promptLimit ?? '∞'}{' '}
            {t('prompts na conta')}
          </span>
        </div>
        <div className="prompt-filters">
          <div className="search-input">
            <Search size={16} />
            <Input
              aria-label={t('Buscar prompts')}
              placeholder={t('Buscar perguntas, temas ou tags')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIds([]);
              }}
            />
          </div>
          <Choice
            label={t('Tema dos prompts')}
            value={topic}
            onChange={(v) => {
              setTopic(v);
              setIds([]);
            }}
            options={[
              { value: 'all', label: t('Todos os temas') },
              ...topics.map((t) => ({ value: t, label: t })),
            ]}
          />
          <Choice
            label={t('Tag dos prompts')}
            value={tag}
            onChange={(v) => {
              setTag(v);
              setIds([]);
            }}
            options={[
              { value: 'all', label: t('Todas as tags') },
              ...tags.map((t) => ({ value: t, label: t })),
            ]}
          />
          <Choice
            label={t('Ordenação dos prompts')}
            value={sort}
            onChange={setSort}
            options={[
              { value: 'recent', label: t('Mais recentes') },
              { value: 'name', label: t('Ordem alfabética') },
            ]}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={exportPrompts}
            aria-label={t('Exportar lista de prompts')}
          >
            <Download />
          </Button>
        </div>
        {ids.length > 0 && (
          <div className="bulk-toolbar">
            <b>
              {ids.length} {t('selecionados')}
            </b>
            {view === 'active' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void bulk('pause')}
              >
                <Pause />
                {t('Pausar')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void bulk(view === 'archived' ? 'restore' : 'resume')
                }
              >
                <Play />
                {view === 'archived' ? t('Restaurar') : t('Retomar')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOrganize(true)}
              disabled={busy}
            >
              <Tags />
              {t('Organizar')}
            </Button>
            {view !== 'archived' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setArchiveConfirm(true)}
              >
                <Archive />
                {t('Arquivar')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setIds([])}>
              {t('Limpar')}
            </Button>
          </div>
        )}
        {message && <output className="notice">{message}</output>}
        {error && (
          <p className="notice error-notice" role="alert">
            {error}
          </p>
        )}
        {visible.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Checkbox
                    aria-label={t('Selecionar até 100 prompts filtrados')}
                    checked={visible
                      .slice(0, 100)
                      .every((p) => ids.includes(p.id))}
                    onCheckedChange={(v) =>
                      setIds(v ? visible.slice(0, 100).map((p) => p.id) : [])
                    }
                  />
                </TableHead>
                <TableHead>{t('PERGUNTA')}</TableHead>
                <TableHead>{t('MOTOR')}</TableHead>
                <TableHead>{t('VISIBILIDADE')}</TableHead>
                <TableHead>{t('ATUALIZAÇÃO')}</TableHead>
                <TableHead>{t('AÇÕES')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible
                .slice(
                  (Math.min(
                    promptPage,
                    Math.max(1, Math.ceil(visible.length / 25)),
                  ) -
                    1) *
                    25,
                  Math.min(
                    promptPage,
                    Math.max(1, Math.ceil(visible.length / 25)),
                  ) * 25,
                )
                .map((p) => {
                  const rs = runs.filter((r) => r.prompt_id === p.id),
                    latest = statistics?.[p.id]?.latest ?? rs[0],
                    done = rs.filter((r) => r.status === 'complete'),
                    score =
                      statistics?.[p.id] ??
                      (demo ? summarize(done, project.name) : undefined),
                    working =
                      statistics?.[p.id]?.pending ??
                      rs.some((r) =>
                        ['pending', 'queued', 'submitting'].includes(r.status),
                      );
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={t('Selecionar {text}', { text: p.text })}
                          checked={ids.includes(p.id)}
                          disabled={!ids.includes(p.id) && ids.length >= 100}
                          onCheckedChange={(v) =>
                            setIds((prev) =>
                              v
                                ? [...prev, p.id]
                                : prev.filter((x) => x !== p.id),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="prompt-cell">
                        <button
                          className="prompt-question prompt-open"
                          onClick={() => setHistoryPrompt(p)}
                        >
                          {p.text}
                          {latest && <ArrowUpRight size={14} />}
                        </button>
                        <div className="prompt-tags">
                          <span className="topic-tag">{p.tag}</span>
                          {p.tags.map((t) => (
                            <span className="plain-tag" key={t}>
                              {t}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <EngineBadge engine={p.engine} />
                      </TableCell>
                      <TableCell>
                        {score?.responses
                          ? `${Math.round(score.visibility)}%`
                          : '—'}
                        <small className="cell-meta">
                          {score
                            ? t('{count} respostas', { count: score.responses })
                            : t('Aguardando estatísticas')}
                        </small>
                      </TableCell>
                      <TableCell>
                        <span className="cell-status">
                          {p.archived
                            ? t('Arquivado')
                            : !p.active
                              ? 'Pausado'
                              : working
                                ? 'Analisando…'
                                : !project.daily_enabled
                                  ? t('Projeto pausado')
                                  : latest?.status === 'failed'
                                    ? t('Tentativa sem resposta')
                                    : t('Automático')}
                        </span>
                        <small className="cell-meta">
                          {p.active && !p.archived && project.daily_enabled
                            ? Date.parse(p.next_run_at) <= now
                              ? t('Próxima: na fila')
                              : t('Próxima: {time}', {
                                  time: formatMonitoringTime(p.next_run_at),
                                })
                            : t('Histórico preservado')}
                        </small>
                      </TableCell>
                      <TableCell>
                        <div className="row-actions">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('Editar prompt')}: ${p.text}`}
                            onClick={() => setEditing(p)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={
                              p.archived
                                ? t('Restaurar prompt')
                                : p.active
                                  ? t('Pausar prompt')
                                  : t('Retomar prompt')
                            }
                            onClick={() =>
                              void act(async () => {
                                await requestJson(
                                  `/api/prompts/${p.id}`,
                                  'PATCH',
                                  p.archived
                                    ? { archived: false, active: true }
                                    : { active: !p.active },
                                );
                              })
                            }
                          >
                            {p.archived ? (
                              <RotateCcw />
                            ) : p.active ? (
                              <Pause />
                            ) : (
                              <Play />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        ) : (
          <div className="prompt-empty">
            <h3>
              {query || topic !== 'all' || tag !== 'all'
                ? t('Nenhum prompt corresponde aos filtros')
                : view === 'active'
                  ? t('Comece com uma boa pergunta')
                  : view === 'paused'
                    ? t('Nenhum prompt pausado')
                    : t('Nenhum prompt arquivado')}
            </h3>
            <p>
              {view === 'active'
                ? t(
                    'Adicione perguntas ou importe uma lista. O acompanhamento começa automaticamente.',
                  )
                : t('Seus prompts aparecem aqui quando você muda o status.')}
            </p>
            {view === 'active' && (
              <Button className="lf-primary" onClick={onAdd}>
                {t('Adicionar prompts')}
              </Button>
            )}
          </div>
        )}
        {visible.length > 25 && (
          <div className="table-pagination">
            <Button
              variant="outline"
              disabled={promptPage <= 1}
              onClick={() => setPromptPage((p) => p - 1)}
            >
              {t('Anterior')}
            </Button>
            <span>
              {Math.min(promptPage, Math.ceil(visible.length / 25))} /{' '}
              {Math.ceil(visible.length / 25)}
            </span>
            <Button
              variant="outline"
              disabled={promptPage >= Math.ceil(visible.length / 25)}
              onClick={() => setPromptPage((p) => p + 1)}
            >
              {t('Próxima')}
            </Button>
          </div>
        )}
        <div className="table-footnote">
          {t(
            'Atualizações diárias às 4h de Brasília. Pausar ou arquivar preserva o histórico.',
          )}
        </div>
        <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
          <DialogContent className="lf-dialog">
            <DialogTitle>{t('Editar prompt')}</DialogTitle>
            <DialogDescription>
              {t(
                'Alterações passam a valer nas próximas respostas. O histórico anterior é preservado.',
              )}
            </DialogDescription>
            {editing && (
              <form
                className="lf-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(async () => {
                    await requestJson(`/api/prompts/${editing.id}`, 'PATCH', {
                      text: f.get('text'),
                      tag: f.get('topic'),
                      tags: ((f.get('tags') as string) || '')
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    });
                    setEditing(null);
                  });
                }}
              >
                <label htmlFor="prompt-manager-input-1">
                  {t('Pergunta')}
                  <Textarea
                    id="prompt-manager-input-1"
                    name="text"
                    required
                    minLength={5}
                    maxLength={1000}
                    defaultValue={editing.text}
                  />
                </label>
                <label htmlFor="prompt-manager-input-2">
                  {t('Tópico')}
                  <Input
                    id="prompt-manager-input-2"
                    name="topic"
                    maxLength={40}
                    required
                    defaultValue={editing.tag}
                    list="manager-topics"
                  />
                </label>
                <label htmlFor="prompt-manager-input-3">
                  Tags
                  <Input
                    id="prompt-manager-input-3"
                    name="tags"
                    defaultValue={editing.tags.join(', ')}
                    placeholder={t('Separe por vírgulas')}
                  />
                </label>
                {error && (
                  <p role="alert" className="notice error-notice">
                    {error}
                  </p>
                )}
                <Button type="submit" className="lf-primary" disabled={busy}>
                  {t('Salvar alterações')}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
        <Dialog open={organize} onOpenChange={setOrganize}>
          <DialogContent className="lf-dialog">
            <DialogTitle>
              {t('Organizar')} {ids.length} prompts
            </DialogTitle>
            <DialogDescription>
              {t(
                'O tópico e as tags abaixo substituirão a organização dos prompts selecionados.',
              )}
            </DialogDescription>
            <form
              className="lf-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void bulk('organize', {
                  tag: f.get('topic'),
                  tags: ((f.get('tags') as string) || '')
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                });
              }}
            >
              <label htmlFor="prompt-manager-input-4">
                {t('Tópico')}
                <Input
                  id="prompt-manager-input-4"
                  name="topic"
                  required
                  maxLength={40}
                  defaultValue={
                    topic !== 'all'
                      ? topic
                      : (savedTopics[0]?.name ?? t('Geral'))
                  }
                  list="manager-topics"
                />
              </label>
              <label htmlFor="prompt-manager-input-5">
                Tags
                <Input
                  id="prompt-manager-input-5"
                  name="tags"
                  placeholder="Produto, Compra"
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <Button type="submit" className="lf-primary" disabled={busy}>
                {t('Aplicar organização')}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={archiveConfirm} onOpenChange={setArchiveConfirm}>
          <DialogContent className="lf-dialog">
            <DialogTitle>
              {t('Arquivar')} {ids.length} prompts?
            </DialogTitle>
            <DialogDescription>
              {t(
                'O acompanhamento será interrompido e os espaços liberados. As respostas ficam no histórico. Você pode restaurar os prompts depois.',
              )}
            </DialogDescription>
            <Button
              className="lf-primary"
              disabled={busy}
              onClick={() => void bulk('archive')}
            >
              {t('Arquivar selecionados')}
            </Button>
            <Button variant="ghost" onClick={() => setArchiveConfirm(false)}>
              {t('Cancelar')}
            </Button>
          </DialogContent>
        </Dialog>
        <datalist aria-label={t('Tópicos disponíveis')} id="manager-topics">
          {topics.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </datalist>
        <Dialog
          open={!!topicDialog}
          onOpenChange={(v) => !v && setTopicDialog(null)}
        >
          <DialogContent className="lf-dialog">
            <DialogTitle>
              {topicDialog?.id ? t('Gerenciar tópico') : t('Novo tópico')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'Organize perguntas relacionadas para comparar seu desempenho.',
              )}
            </DialogDescription>
            {topicDialog && (
              <form
                className="lf-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(async () => {
                    await requestJson(
                      '/api/topics',
                      topicDialog.id ? 'PATCH' : 'POST',
                      topicDialog.id
                        ? topicDialog
                        : { name: topicDialog.name, project_id: project.id },
                    );
                    setTopic(topicDialog.name);
                    setTopicDialog(null);
                  });
                }}
              >
                <label htmlFor="topic-name">
                  {t('Nome')}
                  <Input
                    id="topic-name"
                    required
                    maxLength={40}
                    value={topicDialog.name}
                    onChange={(e) =>
                      setTopicDialog({ ...topicDialog, name: e.target.value })
                    }
                  />
                </label>
                {error && (
                  <p role="alert" className="notice error-notice">
                    {error}
                  </p>
                )}
                <Button disabled={busy} type="submit">
                  {t('Salvar tópico')}
                </Button>
                {topicDialog.id && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await requestJson('/api/topics', 'DELETE', {
                          id: topicDialog.id,
                        });
                        setTopic('all');
                        setTopicDialog(null);
                      })
                    }
                  >
                    <Trash2 />
                    {t('Excluir tópico vazio')}
                  </Button>
                )}
              </form>
            )}
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!historyPrompt}
          onOpenChange={(v) => !v && setHistoryPrompt(null)}
        >
          <DialogContent className="lf-dialog prompt-history-dialog">
            <DialogTitle>{historyPrompt?.text}</DialogTitle>
            <DialogDescription>
              {t('Histórico e evidências deste prompt.')}
            </DialogDescription>
            {historyPrompt && (
              <>
                <div className="response-meta">
                  <EngineBadge engine={historyPrompt.engine} />
                  <span className="topic-tag">{historyPrompt.tag}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(historyPrompt);
                      setHistoryPrompt(null);
                    }}
                  >
                    <Pencil />
                    {t('Editar')}
                  </Button>
                </div>
                {reportBase ? (
                  <PromptHistory
                    key={historyPrompt.id}
                    reportBase={reportBase}
                    prompt={historyPrompt}
                    onOpen={(r) => {
                      setHistoryPrompt(null);
                      onOpen(r);
                    }}
                  />
                ) : (
                  <div className="prompt-history-list">
                    {runs.filter((r) => r.prompt_id === historyPrompt.id)
                      .length ? (
                      runs
                        .filter((r) => r.prompt_id === historyPrompt.id)
                        .map((r) => (
                          <button
                            key={r.id}
                            onClick={() => {
                              setHistoryPrompt(null);
                              onOpen(r);
                            }}
                          >
                            <span>
                              {formatMonitoringTime(r.created_at)}
                              <small>
                                {r.status === 'complete'
                                  ? r.mentions[r.brand_name]
                                    ? t('Sua marca foi mencionada')
                                    : t('Sua marca não foi mencionada')
                                  : r.status === 'failed'
                                    ? t('Coleta sem resposta')
                                    : t('Coleta em andamento')}
                              </small>
                            </span>
                            <span>
                              {r.sources.length} {t('citações')}
                              <ArrowUpRight size={16} />
                            </span>
                          </button>
                        ))
                    ) : (
                      <p>
                        {t('Primeira coleta prevista para')}{' '}
                        {formatMonitoringTime(historyPrompt.next_run_at)}
                        {t(', horário de Brasília.')}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </DialogContent>
        </Dialog>
      </Card>
    </div>
  );
}
