'use client';
// Agent > Contents and Agent > Brain (both editions). Contents are the project's artifacts of kind content (articles,
// pages, posts): the same list and page as Agent > Artifacts, and a way to start one, with the wizard or in the chat (the
// project's members choose it each time, or once for all in Settings > Agent). The Brain is the project's one artifact of
// what the team taught the agent: its tone of voice, audience, products, facts and words to avoid; every turn reads it,
// and the agent adds to it when told something lasting (lib/server/agent.ts). Only catalog components.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { WizardSteps } from '@/components/lastfind/presentation/wizard-steps';
import { ArrowLeft, ChevronDown, ListOrdered, MessagesSquare } from 'lucide-react';
import { requestJson } from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import type { Project } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Textarea } from '@/components/ui/textarea';
import { Hint } from '@/components/ui/tooltip';
import { DetailBody, DetailBodySkeleton, DetailHeader, DetailPage } from '@/components/lastfind/presentation/detail-page';
import { Note } from '@/components/lastfind/presentation/note';
import { AgentArtifactView, AgentArtifacts, ArtifactBarsSkeleton, ArtifactTitleSkeleton, prepareAgentRequest, readParam, writeParam } from './agent-screen';
import { SectionLayout, SectionSidebar } from './section-sidebar';
import { BrainWizard } from './brain-wizard';
import { sameBrainFile } from '@/lib/brain-wizard';
import { SettingsBlock } from './settings-block';
import { CurationBudget, HistoryButton, VersionHistory } from './agent-learning';
import { EmptyState, useCopy } from './shared';

type T = (en: string, pt: string) => string;
export type ContentMode = 'wizard' | 'chat';
/** Sent when the page's Create content button opens the wizard (it writes `?new=1` first). */
export const NEW_CONTENT_EVENT = 'lastfind:new-content';

// ---------------------------------------------------------------- starting a piece of content

/**
 * Agent > Contents' button: the wizard or the chat. With the project's choice it goes straight there (its arrow still
 * offers the other); without, it asks, and can remember the answer for the whole project.
 */
export function CreateContentButton({ mode, onStart, onRemember, disabled }: { mode: ContentMode | null; onStart: (mode: ContentMode) => void; onRemember: (mode: ContentMode) => void; disabled?: boolean }) {
  const t = useCopy();
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const choose = (next: ContentMode) => {
    setOpen(false);
    if (remember) onRemember(next);
    onStart(next);
  };
  const label = t('Create content', 'Criar conteúdo');
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <ButtonGroup>
        <Button disabled={disabled} onClick={() => (mode ? onStart(mode) : setOpen(true))}>
          {label}
        </Button>
        <DropdownMenuTrigger render={<Button disabled={disabled} size="icon" aria-label={t('Ways to create content', 'Formas de criar conteúdo')} />}>
          <ChevronDown />
        </DropdownMenuTrigger>
      </ButtonGroup>
      <DropdownMenuContent align="end" className="agent-create-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('How do you want to create it?', 'Como você quer criar?')}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => choose('wizard')}>
            <ListOrdered aria-hidden="true" />
            <span className="grid">
              <span>{t('With the wizard', 'Com o assistente')}</span>
              <span className="text-caption text-muted-foreground">{t('Format, subject and details, step by step', 'Formato, assunto e detalhes, passo a passo')}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => choose('chat')}>
            <MessagesSquare aria-hidden="true" />
            <span className="grid">
              <span>{t('In the chat', 'Pelo chat')}</span>
              <span className="text-caption text-muted-foreground">{t('Tell the agent what you need', 'Diga ao agente o que você precisa')}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={remember} onCheckedChange={setRemember} closeOnClick={false}>
          {mode ? t('Make my choice the default', 'Tornar minha escolha o padrão') : t('Remember my choice', 'Lembrar minha escolha')}
        </DropdownMenuCheckboxItem>
        <p className="agent-create-note text-caption text-muted-foreground">{t('You can change it in Settings, Agent.', 'Você muda isso em Configurações, Agente.')}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const FORMATS: { id: string; label: [string, string]; hint: [string, string] }[] = [
  { id: 'article', label: ['Blog article', 'Artigo de blog'], hint: ['Answers a question in depth, to rank and be cited', 'Responde uma pergunta a fundo, para ranquear e ser citado'] },
  { id: 'page', label: ['Landing page', 'Página de destino'], hint: ['Presents a product or service and leads to a contact', 'Apresenta um produto ou serviço e leva ao contato'] },
  { id: 'faq', label: ['FAQ', 'Perguntas frequentes'], hint: ['Short, direct answers the AIs can quote', 'Respostas curtas e diretas que as IAs podem citar'] },
  { id: 'comparison', label: ['Comparison', 'Comparativo'], hint: ['Puts the brand next to the alternatives, fairly', 'Coloca a marca ao lado das alternativas, com equilíbrio'] },
  { id: 'social', label: ['Social post', 'Post para redes sociais'], hint: ['A short post for LinkedIn or Instagram', 'Um post curto para LinkedIn ou Instagram'] },
  { id: 'email', label: ['Newsletter', 'Newsletter'], hint: ['An email to the brand’s list', 'Um email para a lista da marca'] },
];
const LENGTHS: { id: string; label: [string, string]; words: string }[] = [
  // By default the agent sizes the text like the pages that rank for it (their depth and length).
  { id: 'serp', label: ['As the top results', 'Como os primeiros resultados'], words: '' },
  { id: 'short', label: ['Short', 'Curto'], words: '400–700' },
  { id: 'medium', label: ['Medium', 'Médio'], words: '900–1,400' },
  { id: 'long', label: ['Long', 'Longo'], words: '1,800–2,500' },
];

type Brief = { format: string; subject: string; keywords: string; audience: string; length: string; tone: string };

/** What the wizard asks the agent: plain words, in the person's language (the agent answers in it). */
export function contentRequest(brief: Brief, t: T) {
  const format = FORMATS.find((item) => item.id === brief.format) ?? FORMATS[0];
  const length = LENGTHS.find((item) => item.id === brief.length) ?? LENGTHS[0];
  const lines = [
    t(`Write a ${format.label[0].toLowerCase()} about: ${brief.subject.trim()}`, `Escreva um conteúdo do tipo ${format.label[1].toLowerCase()} sobre: ${brief.subject.trim()}`),
    brief.keywords.trim() && t(`Keywords: ${brief.keywords.trim()}.`, `Palavras-chave: ${brief.keywords.trim()}.`),
    brief.audience.trim() && t(`Audience: ${brief.audience.trim()}.`, `Público: ${brief.audience.trim()}.`),
    format.id === 'social' || format.id === 'faq'
      ? ''
      : length.id === 'serp'
        ? t('Length: as the top three results for its main keyword, in depth and in words.', 'Tamanho: como os três primeiros resultados da palavra-chave principal, em profundidade e em palavras.')
        : t(`Length: ${length.label[0].toLowerCase()}, about ${length.words} words.`, `Tamanho: ${length.label[1].toLowerCase()}, cerca de ${length.words.replace(',', '.')} palavras.`),
    brief.tone === 'formal'
      ? t('Tone: more formal than usual.', 'Tom: mais formal que o habitual.')
      : brief.tone === 'friendly'
        ? t('Tone: friendlier than usual.', 'Tom: mais próximo que o habitual.')
        : t('Tone: the one in the project’s Brain.', 'Tom: o do Cérebro do projeto.'),
    t('Use this project’s data where it helps, and save it as content.', 'Use os dados deste projeto onde ajudarem, e salve como conteúdo.'),
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * The wizard, on a page of its own in the main content: the format, then the subject (an opportunity can bring it), then
 * the details. It hands the request to the chat, which starts the conversation and writes the content beside it.
 */
export function ContentWizard({ brief: initial, onCancel, onSubmit }: { brief: string; onCancel: () => void; onSubmit: (request: string, title: string) => void }) {
  const t = useCopy();
  const [step, setStep] = useState(0);
  const [brief, setBrief] = useState<Brief>({ format: 'article', subject: initial, keywords: '', audience: '', length: 'serp', tone: 'brain' });
  const set = (key: keyof Brief) => (value: string) => setBrief((now) => ({ ...now, [key]: value }));
  const steps: [string, string][] = [
    ['Format', 'Formato'],
    ['Subject', 'Assunto'],
    ['Details', 'Detalhes'],
  ];
  const ready = step !== 1 || brief.subject.trim().length >= 3;
  const last = step === steps.length - 1;
  return (
    <DetailPage className="agent-wizard">
      <DetailHeader
        leading={
          <>
            <SidebarTrigger className="md:hidden" aria-label={t('Toggle navigation', 'Alternar navegação')} />
            <Hint text={t('Back to the contents', 'Voltar aos conteúdos')}>
              <Button variant="ghost" size="icon" aria-label={t('Back to the contents', 'Voltar aos conteúdos')} onClick={onCancel}>
                <ArrowLeft />
              </Button>
            </Hint>
          </>
        }
        title={<h1>{t('New content', 'Novo conteúdo')}</h1>}
        meta={t(`Step ${step + 1} of ${steps.length}: ${steps[step][0]}`, `Passo ${step + 1} de ${steps.length}: ${steps[step][1]}`)}
        actions={
          <Button variant="ghost" disabled={brief.subject.trim().length < 3} onClick={() => onSubmit(contentRequest(brief, t), brief.subject.trim())}>
            {t('Continue in the chat', 'Continuar no chat')}
          </Button>
        }
      />
      <DetailBody>
        <form
          className="agent-wizard-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            if (last) onSubmit(contentRequest(brief, t), brief.subject.trim());
            else setStep(step + 1);
          }}
        >
          <WizardSteps steps={steps.map((name) => t(...name))} current={step} label={t('Steps', 'Passos')} />
          {step === 0 && (
            <FieldSet>
              <FieldLegend>{t('What do you want to create?', 'O que você quer criar?')}</FieldLegend>
              <RadioGroup value={brief.format} onValueChange={(value) => set('format')(String(value))} className="agent-wizard-formats">
                {FORMATS.map((format) => (
                  <FieldLabel key={format.id} htmlFor={`format-${format.id}`}>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>{t(...format.label)}</FieldTitle>
                        <FieldDescription>{t(...format.hint)}</FieldDescription>
                      </FieldContent>
                      <RadioGroupItem value={format.id} id={`format-${format.id}`} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
          {step === 1 && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="content-subject">{t('Subject', 'Assunto')}</FieldLabel>
                <Textarea id="content-subject" rows={5} required minLength={3} maxLength={2000} value={brief.subject} onChange={(event) => set('subject')(event.target.value)} placeholder={t('What it should be about, the question it answers, the opportunity behind it', 'Sobre o que deve ser, a pergunta que responde, a oportunidade por trás')} />
              </Field>
              <Field>
                <FieldLabel htmlFor="content-keywords">{t('Keywords (optional)', 'Palavras-chave (opcional)')}</FieldLabel>
                <Input id="content-keywords" maxLength={300} value={brief.keywords} onChange={(event) => set('keywords')(event.target.value)} placeholder={t('Separated by commas', 'Separadas por vírgula')} />
                <FieldDescription>{t('Leave it blank and the agent researches them.', 'Deixe em branco e o agente pesquisa.')}</FieldDescription>
              </Field>
            </FieldGroup>
          )}
          {step === 2 && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="content-audience">{t('Audience (optional)', 'Público (opcional)')}</FieldLabel>
                <Input id="content-audience" maxLength={300} value={brief.audience} onChange={(event) => set('audience')(event.target.value)} placeholder={t('Who reads it; blank follows the Brain', 'Quem vai ler; em branco segue o Cérebro')} />
              </Field>
              {brief.format !== 'social' && brief.format !== 'faq' && (
                <Field>
                  <FieldLabel htmlFor="content-length">{t('Length', 'Tamanho')}</FieldLabel>
                  <SelectField
                    id="content-length"
                    value={brief.length}
                    onValueChange={set('length')}
                    options={LENGTHS.map((length) => ({ value: length.id, label: length.words ? t(`${length.label[0]}, ${length.words} words`, `${length.label[1]}, ${length.words.replace(',', '.')} palavras`) : t(...length.label) }))}
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="content-tone">{t('Tone of voice', 'Tom de voz')}</FieldLabel>
                <SelectField
                  id="content-tone"
                  value={brief.tone}
                  onValueChange={set('tone')}
                  options={[
                    { value: 'brain', label: t('The one in the Brain', 'O do Cérebro') },
                    { value: 'formal', label: t('More formal', 'Mais formal') },
                    { value: 'friendly', label: t('Friendlier', 'Mais próximo') },
                  ]}
                />
              </Field>
              <Note>{t('The agent writes it in the chat and saves it in Contents, where you edit it.', 'O agente escreve no chat e salva em Conteúdos, onde você edita.')}</Note>
            </FieldGroup>
          )}
          <div className="agent-wizard-actions">
            <Button type="button" variant="outline" onClick={() => (step ? setStep(step - 1) : onCancel())}>
              {step ? t('Back', 'Voltar') : t('Cancel', 'Cancelar')}
            </Button>
            <Button type="submit" disabled={!ready}>
              {last ? t('Create content', 'Criar conteúdo') : t('Next', 'Próximo')}
            </Button>
          </div>
        </form>
      </DetailBody>
    </DetailPage>
  );
}

/**
 * Agent > Contents: the project's contents, or the wizard (`?new=`: `1` starts blank, any other text is the brief an
 * opportunity brought). A project that writes in the chat sends an opportunity's brief straight to it.
 */
export function AgentContents({
  projectId,
  canEdit,
  mode,
  action,
  onOpenConversation,
}: {
  projectId: string;
  canEdit: boolean;
  mode: ContentMode | null;
  /** Create content, in the list's toolbar (the list is the page, as Brands'). */
  action?: ReactNode;
  onOpenConversation: (id: string) => void;
}) {
  const [brief, setBrief] = useState<string | null>(() => readParam('new'));
  useEffect(() => {
    const read = () => setBrief(readParam('new'));
    window.addEventListener('popstate', read);
    window.addEventListener(NEW_CONTENT_EVENT, read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener(NEW_CONTENT_EVENT, read);
    };
  }, []);
  const t = useCopy();
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * A content starts as its own page: an empty content, opened with its chat beside it holding the request (the wizard's, sent at once;
   * otherwise in the box to finish). The chat writes it there, with its outline and research.
   */
  const startContent = async (request: string, send: boolean, title: string) => {
    setFailure(null);
    try {
      const made = await requestJson<{ artifact: { id: string } }>('/api/agent/artifacts', 'POST', { project: projectId, title: title || t('New content', 'Novo conteúdo'), kind: 'content' });
      prepareAgentRequest(request, send, made.artifact.id);
      writeParam('new', null);
      writeParam('artifact', made.artifact.id, true);
      setBrief(null);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    }
  };
  // A project that writes in the chat starts the content at once, the request (an opportunity's brief) in its box to finish.
  const startRef = useRef(startContent);
  useEffect(() => {
    startRef.current = startContent;
  });
  // `?new=chat`: the chat chosen this time; a project that always writes in the chat starts every content that way.
  const viaChat = brief === 'chat' || (brief !== null && mode === 'chat');
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (brief === null || !viaChat || !canEdit || started.current === brief) return;
    started.current = brief;
    void startRef.current(brief === '1' || brief === 'chat' ? t('Write a piece of content about ', 'Escreva um conteúdo sobre ') : brief, false, '');
  }, [brief, viaChat, canEdit, t]);
  if (brief !== null && canEdit && !viaChat)
    return (
      <ContentWizard
        brief={brief === '1' ? '' : brief}
        onCancel={() => {
          writeParam('new', null);
          setBrief(null);
        }}
        onSubmit={(request, title) => void startContent(request, true, title)}
      />
    );
  return (
    <>
      {failure && (
        <Note tone="danger" className="m-4">
          {failure}
        </Note>
      )}
      <AgentArtifacts key={brief ?? 'list'} projectId={projectId} canEdit={canEdit} onOpenConversation={onOpenConversation} scope="contents" action={action} />
    </>
  );
}

// ---------------------------------------------------------------- the Brain

type BrainFile = { id: string; title: string; updated_at: string; blank?: boolean };
type BrainState = { files: BrainFile[]; site?: string; language?: string } | { failure: string } | null;

/** The Brain's own top bar over its files, as the chat's over its conversations: the app's toggle, a divider and the name. */
function BrainBar({ t }: { t: T }) {
  return (
    <DetailHeader
      className="static"
      leading={
        <>
          <SidebarTrigger aria-label={t('Toggle navigation', 'Alternar navegação')} />
          <span className="topbar-divider" />
        </>
      }
      title={<h2>{t('Brain', 'Cérebro')}</h2>}
    />
  );
}

/** The Brain while it loads: the same second sidebar with its rows as skeletons, beside a file's page (title, its line, the text). */
export function BrainSkeleton() {
  const t = useCopy();
  return (
    <div className="section-layout agent-brain" aria-busy="true" aria-label={t('Loading the Brain', 'Carregando o Cérebro')} data-screen-skeleton="">
      <SectionSidebar
        surface="sidebar"
        label={t('Brain files', 'Arquivos do Cérebro')}
        header={
          <>
            <BrainBar t={t} />
            <div aria-hidden="true">
              {['w-3/4', 'w-1/2', 'w-5/6', 'w-2/3', 'w-3/4', 'w-1/3'].map((width, index) => (
                <div key={index} className="flex h-(--nav-row-height) items-center px-2">
                  <Skeleton inline className={`h-lh ${width}`} />
                </div>
              ))}
            </div>
          </>
        }
        groups={[]}
        value=""
        onChange={() => {}}
      />
      <div className="section-content">
        {/* A file as a member opens it (agent-screen.tsx): its title and line, its actions, the editor's bar and the text. */}
        <DetailPage className="agent-artifact" data-place="page">
          <div className="agent-artifact-main">
            <DetailHeader
              leading={<SidebarTrigger className="md:hidden" aria-label={t('Toggle navigation', 'Alternar navegação')} />}
              title={<ArtifactTitleSkeleton editable />}
              meta={<Skeleton inline className="h-lh w-32" />}
              actions={['w-24', 'w-12', 'w-8', 'w-8'].map((width, index) => (
                <Skeleton key={index} className={`h-(--control-height) ${width}`} />
              ))}
            >
              <div className="agent-artifact-subheader">
                <div className="agent-artifact-bars">
                  <ArtifactBarsSkeleton />
                </div>
              </div>
            </DetailHeader>
            <DetailBodySkeleton label={t('Loading the file', 'Carregando o arquivo')} lines={3} />
          </div>
        </DetailPage>
      </div>
    </div>
  );
}

/**
 * Agent > Brain: the project's files (made from the template the first time a member opens it), listed beside the one
 * open, as the files of a project's brain; members add, rename and delete them (the last one stays), and generate them
 * with AI from the project's site (`?wizard=1`, brain-wizard.tsx), offered first while every file is still blank.
 */
export function AgentBrain({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const t = useCopy();
  const { locale } = useI18n();
  const [state, setState] = useState<BrainState>(null);
  // A change note's History link opens a file's history (`?file=<id>&history=1`).
  const [open, setOpen] = useState<string | null>(() => readParam('file'));
  const [history, setHistory] = useState(() => readParam('history') === '1');
  const [adding, setAdding] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [wizard, setWizard] = useState(() => readParam('wizard') === '1');
  useEffect(() => {
    const read = () => setWizard(readParam('wizard') === '1');
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  useEffect(() => {
    let current = true;
    requestJson<BrainState & object>(`/api/agent/brain?project=${encodeURIComponent(projectId)}&locale=${locale}`).then(
      (data) => current && setState(data),
      (cause) => current && setState({ failure: cause instanceof Error ? cause.message : String(cause) }),
    );
    return () => {
      current = false;
    };
  }, [projectId, locale, generation]);
  const reload = () => setGeneration((value) => value + 1);
  const showWizard = (on: boolean) => {
    writeParam('wizard', on ? '1' : null, on);
    setWizard(on);
  };
  const files = state && 'files' in state ? state.files : [];
  const blank = files.length > 0 && files.every((file) => file.blank);
  const active = files.find((file) => file.id === open) ?? (blank && canEdit ? undefined : files[0]);
  const add = async () => {
    setAdding(true);
    await requestJson<{ id: string }>('/api/agent/brain', 'POST', { project: projectId, title: t('New file', 'Novo arquivo') })
      .then((made) => {
        setOpen(made.id);
        reload();
      })
      .catch(() => {})
      .finally(() => setAdding(false));
  };
  const generate = canEdit && (
    <Hint text={t("Write the files from the project's site and the web", 'Escrever os arquivos a partir do site do projeto e da web')}>
      <Button variant="ghost" onClick={() => showWizard(true)}>
        {t('Generate with AI', 'Gerar com IA')}
      </Button>
    </Hint>
  );
  if (wizard && canEdit && state && 'files' in state)
    return (
      <BrainWizard
        projectId={projectId}
        site={state.site ?? ''}
        language={state.language ?? 'en'}
        files={files}
        onClose={() => showWizard(false)}
        onSaved={(title) => {
          showWizard(false);
          setState(null);
          requestJson<BrainState & object>(`/api/agent/brain?project=${encodeURIComponent(projectId)}&locale=${locale}`).then(
            (data) => {
              setState(data);
              if ('files' in data) setOpen(data.files.find((file) => sameBrainFile(file.title, title))?.id ?? null);
            },
            (cause) => setState({ failure: cause instanceof Error ? cause.message : String(cause) }),
          );
        }}
      />
    );
  if (files.length)
    return (
      <SectionLayout
        className="agent-brain"
        surface="sidebar"
        label={t('Brain files', 'Arquivos do Cérebro')}
        header={<BrainBar t={t} />}
        groups={[{ id: 'files', items: files.map((file) => ({ id: file.id, label: file.title })) }]}
        value={active?.id ?? ''}
        onChange={(id) => {
          setOpen(id);
          setHistory(false);
        }}
        footer={
          canEdit && (
            <Button variant="ghost" className="w-full justify-start px-2" pending={adding} pendingLabel={t('Adding…', 'Adicionando…')} onClick={() => void add()}>
              {t('New file', 'Novo arquivo')}
            </Button>
          )
        }
      >
        {active && history ? (
          <VersionHistory key={`history:${active.id}`} source={{ artifact: active.id }} title={active.title} onBack={() => setHistory(false)} onRestored={reload} t={t} />
        ) : active ? (
          <AgentArtifactView
            key={active.id}
            id={active.id}
            variant="brain"
            canEdit={canEdit}
            place="page"
            headerAction={
              <>
                <HistoryButton onClick={() => setHistory(true)} t={t} />
                {generate}
              </>
            }
            onChanged={reload}
            onDelete={() => {
              setOpen(null);
              reload();
            }}
            t={t}
          />
        ) : (
          // A Brain nobody wrote yet: the wizard first, on a page like a file's.
          <DetailPage>
            <DetailHeader
              leading={<SidebarTrigger className="md:hidden" aria-label={t('Toggle navigation', 'Alternar navegação')} />}
              title={<h1>{t('Brain', 'Cérebro')}</h1>}
              meta={t('What the agent knows about this project', 'O que o agente sabe sobre este projeto')}
            />
            <DetailBody>
              <EmptyState
                frame="bare"
                title={t('The Brain is empty', 'O Cérebro está vazio')}
                description={t(
                  "Let the AI write it from the project's site and what the web says about the brand, then review each file. Or write the files yourself.",
                  'Deixe a IA escrever a partir do site do projeto e do que a web diz da marca, depois revise cada arquivo. Ou escreva os arquivos você mesmo.',
                )}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => showWizard(true)}>{t('Generate with AI', 'Gerar com IA')}</Button>
                    <Button variant="outline" onClick={() => setOpen(files[0].id)}>
                      {t('Write it myself', 'Escrever eu mesmo')}
                    </Button>
                  </div>
                }
              />
            </DetailBody>
          </DetailPage>
        )}
      </SectionLayout>
    );
  if (!state) return <BrainSkeleton />;
  return 'failure' in state ? (
    <EmptyState tone="error" title={t('Could not open the Brain', 'Não foi possível abrir o Cérebro')} description={state.failure} onRetry={reload} />
  ) : (
    <EmptyState
      title={t('Nobody wrote the Brain yet', 'Ninguém escreveu o Cérebro ainda')}
      description={t('A member of the workspace starts it: the tone of voice, audience, products and facts the agent follows.', 'Um membro do workspace começa: o tom de voz, o público, os produtos e os fatos que o agente segue.')}
    />
  );
}

// ---------------------------------------------------------------- Settings > Agent

export function AgentSettings({ project, busy, onSave, onDirty }: { project: Project; busy: boolean; onSave: (mode: ContentMode | null) => Promise<boolean>; onDirty: (dirty: boolean) => void }) {
  const t = useCopy();
  return (
    <>
    <SettingsBlock
      title={t('Creating content', 'Criação de conteúdo')}
      description={t('How Create content starts in Agent, Contents, for everyone in this project.', 'Como Criar conteúdo começa em Agente, Conteúdos, para todos neste projeto.')}
      busy={busy}
      onDirty={onDirty}
      t={t}
      save={async (values) => {
        const mode = values.get('agent_content_mode');
        return onSave(mode === 'wizard' || mode === 'chat' ? mode : null);
      }}
    >
      <FieldSet>
        <FieldLegend variant="label">{t('Create content with', 'Criar conteúdo com')}</FieldLegend>
        <RadioGroup name="agent_content_mode" defaultValue={project.agent_content_mode ?? 'ask'}>
          {(
            [
              ['ask', ['Ask each time', 'Perguntar sempre'], ['The button offers the wizard and the chat.', 'O botão oferece o assistente e o chat.']],
              ['wizard', ['The wizard', 'O assistente'], ['Format, subject and details, step by step.', 'Formato, assunto e detalhes, passo a passo.']],
              ['chat', ['The chat', 'O chat'], ['The person tells the agent what they need.', 'A pessoa diz ao agente o que precisa.']],
            ] as const
          ).map(([value, label, hint]) => (
            <Field key={value} orientation="horizontal">
              <RadioGroupItem value={value} id={`agent-content-${value}`} />
              <FieldContent>
                <FieldLabel htmlFor={`agent-content-${value}`}>{t(label[0], label[1])}</FieldLabel>
                <FieldDescription>{t(hint[0], hint[1])}</FieldDescription>
              </FieldContent>
            </Field>
          ))}
        </RadioGroup>
      </FieldSet>
    </SettingsBlock>
    <CurationBudget projectId={project.id} t={t} />
    </>
  );
}
