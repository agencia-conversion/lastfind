'use client';
import { LASTFIND_APP_ICON } from '@/lib/lastfind-brand';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCheck,
  Compass,
  Globe,
  Lightbulb,
  ListChecks,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  FilterSelect,
  ModelMark,
  SiteFavicon,
  useCopy,
  useNumbers,
} from './shared';
import { demoModels } from './demo-data';
import { workspaceRole, type DemoSession } from './workspace-data';
import {
  completeOnboarding,
  createOnboardingDraft,
  initializeOnboardingPositioning,
  normalizeOnboardingDomain,
  onboardingIntents,
  onboardingSegments,
  promptIsDuplicate,
  refreshOnboardingSuggestions,
  validateOnboarding,
  type OnboardingError,
  type OnboardingPrompt,
  type OnboardingResult,
  type PromptIntent,
} from './onboarding-data';
import './onboarding.css';

export type { OnboardingResult } from './onboarding-data';

export function OnboardingView({
  session,
  onComplete,
  onCancel,
}: {
  session: DemoSession;
  onComplete: (result: OnboardingResult) => void;
  onCancel: () => void;
}) {
  const l = useCopy();
  const { number, locale } = useNumbers();
  const workspace = session.workspaces.find(
    (item) => item.id === session.workspaceId,
  )!;
  const role = workspaceRole(session);
  const canCreate = role === 'owner' || role === 'admin';
  const [draft, setDraft] = useState(() => createOnboardingDraft(locale));
  const [step, setStep] = useState(0);
  const [competitorsOpen, setCompetitorsOpen] = useState(false);
  const [error, setError] = useState<OnboardingError | 'complete' | null>(null);
  const [intent, setIntent] = useState<PromptIntent>('discovery');
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customTopic, setCustomTopic] = useState('');
  const [customIntent, setCustomIntent] = useState<PromptIntent>('discovery');
  const [customError, setCustomError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const selected = draft.prompts.filter((prompt) => prompt.selected);
  const visiblePrompts = draft.prompts.filter(
    (prompt) => prompt.intent === intent,
  );
  const domain = normalizeOnboardingDomain(draft.domain);
  const competitors = draft.competitors.filter(
    (item) => item.name.trim() || item.domain.trim(),
  );
  const segmentLabel = onboardingSegments.find(
    (item) => item.value === draft.segment,
  );
  const localizedSegment = segmentLabel
    ? l(segmentLabel.en, segmentLabel.pt)
    : draft.segment;
  const countryLabel =
    draft.country === 'Brazil'
      ? l('Brazil', 'Brasil')
      : l('United States', 'Estados Unidos');
  const intentName = (value: PromptIntent) =>
    ({
      discovery: l('Discovery', 'Descoberta'),
      comparison: l('Comparison', 'Comparação'),
      purchase: l('Purchase', 'Compra'),
      branded: l('Branded', 'Sua marca'),
    })[value];
  const intentDescription = {
    discovery: l(
      'Find out whether AI recommends you when people explore your category.',
      'Descubra se a IA recomenda você quando as pessoas exploram sua categoria.',
    ),
    comparison: l(
      'See who appears when customers compare alternatives, support and value.',
      'Veja quem aparece quando clientes comparam alternativas, suporte e custo-benefício.',
    ),
    purchase: l(
      'Follow questions from people who are close to choosing a provider.',
      'Acompanhe perguntas de quem está perto de escolher um fornecedor.',
    ),
    branded: l(
      'Explore what AI says about your brand. These questions measure perception, not spontaneous discovery.',
      'Explore o que a IA diz sobre sua marca. Estas perguntas medem percepção, não descoberta espontânea.',
    ),
  };
  const steps = [
    l('Your brand', 'Sua marca'),
    l('Positioning', 'Posicionamento'),
    l('Prompts', 'Prompts'),
    l('Review', 'Revisão'),
  ];
  const titles = [
    l('Let’s put your brand on the map.', 'Vamos colocar sua marca no mapa.'),
    l(
      'What should your brand be known for?',
      'Pelo que sua marca deve ser lembrada?',
    ),
    l('Start with the right questions.', 'Comece pelas perguntas certas.'),
    l('Your first project is ready.', 'Seu primeiro projeto está pronto.'),
  ];
  const descriptions = [
    l(
      'A little context helps you choose the questions that matter.',
      'Um pouco de contexto ajuda a escolher as perguntas que importam.',
    ),
    l(
      'Choose the associations you want to build. Then compare them with what AI actually says.',
      'Escolha as associações que quer construir. Depois, compare com o que a IA realmente diz.',
    ),
    l(
      'Review the starter set, make it your own, and choose what to follow.',
      'Revise o conjunto inicial, adapte ao seu negócio e escolha o que acompanhar.',
    ),
    l(
      'Review your questions, brand attributes and AI models in one place.',
      'Confira suas perguntas, os atributos da marca e os modelos de IA em um só lugar.',
    ),
  ];
  const errorCopy: Record<OnboardingError | 'complete', string> = {
    brand: l(
      'Enter a brand name with 2–80 characters.',
      'Informe um nome de marca com 2 a 80 caracteres.',
    ),
    domain: l(
      'Enter a valid website, such as yourbrand.com.',
      'Informe um site válido, como suamarca.com.br.',
    ),
    segment: l(
      'Describe your category using 2–100 characters.',
      'Descreva sua categoria com 2 a 100 caracteres.',
    ),
    country: l(
      'Choose a country for your audience.',
      'Escolha o país do seu público.',
    ),
    language: l(
      'Choose the language of your research.',
      'Escolha o idioma da sua pesquisa.',
    ),
    'semantic-count': l(
      'Keep 1–10 attributes, or choose to configure Semantic Branding later.',
      'Mantenha de 1 a 10 atributos ou escolha configurar o Branding Semântico depois.',
    ),
    'semantic-id': l(
      'Remove the invalid attribute and add it again.',
      'Remova o atributo inválido e adicione-o novamente.',
    ),
    'semantic-name': l(
      'Name each attribute using 2–60 characters.',
      'Dê um nome de 2 a 60 caracteres a cada atributo.',
    ),
    'semantic-duplicate': l(
      'Use a different name for each attribute.',
      'Use um nome diferente para cada atributo.',
    ),
    'semantic-description': l(
      'Keep each attribute description within 240 characters.',
      'Use até 240 caracteres na descrição de cada atributo.',
    ),
    'competitor-name': l(
      'Complete the name of each competitor, or remove its row.',
      'Preencha o nome de cada concorrente ou remova a linha.',
    ),
    'competitor-domain': l(
      'Enter a valid website for each competitor.',
      'Informe um site válido para cada concorrente.',
    ),
    'competitor-duplicate': l(
      'Each competitor needs a different name and domain from your brand and the other competitors.',
      'Cada concorrente precisa ter nome e domínio diferentes da sua marca e dos outros concorrentes.',
    ),
    'competitors-limit': l(
      'Start with up to 5 competitors.',
      'Comece com até 5 concorrentes.',
    ),
    'prompts-empty': l(
      'Select at least one prompt to continue.',
      'Selecione pelo menos um prompt para continuar.',
    ),
    'prompts-limit': l(
      'Start with up to 10 selected prompts. Deselect one to add another.',
      'Comece com até 10 prompts selecionados. Desmarque um para incluir outro.',
    ),
    'prompt-invalid': l(
      'Each selected prompt needs 10–1,000 characters and a topic with up to 60 characters.',
      'Cada prompt selecionado precisa ter 10 a 1.000 caracteres e um tópico com até 60 caracteres.',
    ),
    'prompt-duplicate': l(
      'Two selected prompts repeat the same question. Edit one or deselect it.',
      'Dois prompts selecionados repetem a mesma pergunta. Edite um deles ou desmarque-o.',
    ),
    'models-empty': l(
      'Select at least one AI model.',
      'Selecione pelo menos um modelo de IA.',
    ),
    complete: l(
      'Could not create the project. Your draft is still here; please try again.',
      'Não foi possível criar o projeto. Seu rascunho continua aqui; tente novamente.',
    ),
  };

  function goTo(next: number) {
    setError(null);
    setStep(next);
    setEditingPrompt(null);
  }
  function advance() {
    const issue = validateOnboarding(draft, step);
    if (issue) {
      if (issue.startsWith('competitor')) setCompetitorsOpen(true);
      setError(issue);
      return;
    }
    if (step < 3) {
      if (step === 0) setDraft(initializeOnboardingPositioning);
      if (step === 1)
        setDraft((current) => ({
          ...current,
          prompts: refreshOnboardingSuggestions(current, locale),
          promptHistory: [
            ...current.prompts,
            ...current.promptHistory.filter(
              (prompt) =>
                !current.prompts.some((item) => item.id === prompt.id),
            ),
          ],
        }));
      goTo(step + 1);
      return;
    }
    if (!canCreate || submitting) return;
    for (let previous = 0; previous < 4; previous++) {
      const problem = validateOnboarding(draft, previous);
      if (problem) {
        goTo(previous);
        setError(problem);
        return;
      }
    }
    setSubmitting(true);
    try {
      onComplete(completeOnboarding(draft));
    } catch {
      setError('complete');
      setSubmitting(false);
    }
  }
  function updatePrompt(id: string, update: Partial<OnboardingPrompt>) {
    setDraft((current) => ({
      ...current,
      prompts: current.prompts.map((prompt) =>
        prompt.id === id ? { ...prompt, ...update } : prompt,
      ),
    }));
    setError(null);
  }
  function addCustomPrompt() {
    const text = customText.trim();
    const topic = customTopic.trim() || intentName(customIntent);
    if (text.length < 10 || text.length > 1000 || topic.length > 60) {
      setCustomError(errorCopy['prompt-invalid']);
      return;
    }
    if (selected.length >= 10 || draft.prompts.length >= 30) {
      setCustomError(errorCopy['prompts-limit']);
      return;
    }
    if (promptIsDuplicate(text, draft.prompts)) {
      setCustomError(
        l(
          'This question is already in the list. Select or edit the existing prompt.',
          'Esta pergunta já está na lista. Selecione ou edite o prompt existente.',
        ),
      );
      return;
    }
    const tags = {
      discovery: 'Discovery',
      comparison: 'Comparison',
      purchase: 'High intent',
      branded: 'Branded',
    };
    setDraft((current) => ({
      ...current,
      prompts: [
        ...current.prompts,
        {
          id: `custom-${crypto.randomUUID()}`,
          text,
          topic,
          intent: customIntent,
          country: current.country,
          tags:
            customIntent === 'branded'
              ? ['Branded']
              : [tags[customIntent], 'Non-branded'],
          selected: true,
          edited: true,
          origin: 'custom',
          status: 'active',
        },
      ],
    }));
    setIntent(customIntent);
    setCustomText('');
    setCustomTopic('');
    setCustomError('');
    setCustomOpen(false);
  }

  return (
    <section
      className="onboarding-root"
      aria-label={l('Project setup', 'Configuração do projeto')}
    >
      <header className="onboarding-header">
        <div className="onboarding-brand">
          {/* eslint-disable-next-line next/no-img-element */}
          <img src={LASTFIND_APP_ICON.src} width={42} height={42} alt="" />
          <span>
            lastfind<span className="text-primary">.</span>
          </span>
        </div>
        <div className="onboarding-header-actions">
          <Badge variant="outline">
            <Building2 size={12} />
            {workspace.name}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={l('Exit setup', 'Sair da configuração')}
            onClick={onCancel}
          >
            <X size={16} />
          </Button>
        </div>
      </header>
      <div className="onboarding-body">
        <ol
          className="onboarding-steps"
          aria-label={l('Setup progress', 'Progresso da configuração')}
        >
          {steps.map((label, index) => (
            <li
              key={label}
              data-current={index === step}
              data-complete={index < step}
            >
              <button
                type="button"
                disabled={index > step}
                aria-current={index === step ? 'step' : undefined}
                onClick={() => goTo(index)}
              >
                <span>
                  {index < step ? <Check size={13} /> : number(index + 1)}
                </span>
                <b>{label}</b>
              </button>
            </li>
          ))}
        </ol>
        <div className="onboarding-intro">
          <p>
            {l(
              'A clearer view of AI search',
              'Um novo olhar para a busca por IA',
            )}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {titles[step]}
          </h1>
          <span>{descriptions[step]}</span>
        </div>
        <div className="onboarding-layout">
          <form
            className="onboarding-sheet"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              advance();
            }}
          >
            {!canCreate && (
              <div className="onboarding-notice">
                <ShieldCheck size={17} />
                <p>
                  {l(
                    'Only workspace owners and admins can create projects. You can explore this setup and ask an admin to create your project.',
                    'Somente proprietários e administradores podem criar projetos. Você pode explorar a configuração e pedir a um administrador para criar seu projeto.',
                  )}
                </p>
              </div>
            )}
            {step === 0 && (
              <div className="onboarding-fields">
                <div className="onboarding-field">
                  <Label htmlFor="onboarding-brand-name">
                    {l('Brand name', 'Nome da marca')}
                  </Label>
                  <Input
                    id="onboarding-brand-name"
                    value={draft.brandName}
                    maxLength={80}
                    autoComplete="organization"
                    placeholder={l('e.g. Conversion', 'Ex.: Conversion')}
                    aria-invalid={error === 'brand'}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        brandName: event.target.value,
                      }))
                    }
                  />
                  <small>
                    {l(
                      'Use the name your customers recognize.',
                      'Use o nome pelo qual seus clientes conhecem sua marca.',
                    )}
                  </small>
                </div>
                <div className="onboarding-field">
                  <Label htmlFor="onboarding-domain">
                    {l('Website', 'Site')}
                  </Label>
                  <div className="onboarding-domain-input">
                    {domain ? (
                      <SiteFavicon domain={domain} name={draft.brandName} />
                    ) : (
                      <Globe size={17} />
                    )}
                    <Input
                      id="onboarding-domain"
                      value={draft.domain}
                      maxLength={500}
                      autoComplete="url"
                      inputMode="url"
                      placeholder="yourbrand.com"
                      aria-invalid={error === 'domain'}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          domain: event.target.value,
                        }))
                      }
                      onBlur={() => {
                        if (domain)
                          setDraft((current) => ({ ...current, domain }));
                      }}
                    />
                  </div>
                </div>
                <div className="onboarding-field">
                  <Label htmlFor="onboarding-segment">
                    {l(
                      'What category do you compete in?',
                      'Em qual categoria você compete?',
                    )}
                  </Label>
                  <Input
                    id="onboarding-segment"
                    value={localizedSegment}
                    maxLength={100}
                    aria-invalid={error === 'segment'}
                    placeholder={l(
                      'e.g. SEO agencies, CRM software',
                      'Ex.: agências de SEO, software de CRM',
                    )}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        segment: event.target.value,
                      }))
                    }
                  />
                  <div className="onboarding-segment-options">
                    {onboardingSegments.map((item) => (
                      <Button
                        key={item.value}
                        type="button"
                        size="sm"
                        variant={
                          draft.segment === item.value ? 'secondary' : 'outline'
                        }
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            segment: item.value,
                          }))
                        }
                      >
                        {l(item.en, item.pt)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="onboarding-field">
                  <Label>
                    {l('Where is your audience?', 'Onde está seu público?')}
                  </Label>
                  <FilterSelect
                    label={l('Audience country', 'País do público')}
                    value={draft.country}
                    onChange={(country) =>
                      setDraft((current) => ({ ...current, country }))
                    }
                    options={[
                      { value: 'Brazil', label: l('Brazil', 'Brasil') },
                      {
                        value: 'United States',
                        label: l('United States', 'Estados Unidos'),
                      },
                    ]}
                  />
                  <small>
                    {l(
                      'Choose the market you want to understand.',
                      'Escolha o mercado que quer entender.',
                    )}
                  </small>
                </div>
                <div className="onboarding-field">
                  <Label>{l('Research language', 'Idioma da pesquisa')}</Label>
                  <FilterSelect
                    label={l('Research language', 'Idioma da pesquisa')}
                    value={draft.language}
                    onChange={(language) =>
                      setDraft((current) => ({
                        ...current,
                        language: language as 'en-US' | 'pt-BR',
                      }))
                    }
                    options={[
                      { value: 'pt-BR', label: 'Português (Brasil)' },
                      { value: 'en-US', label: 'English' },
                    ]}
                  />
                  <small>
                    {l(
                      'Sets the language of suggested questions. Your interface language stays the same.',
                      'Define o idioma das perguntas sugeridas. O idioma da interface continua o mesmo.',
                    )}
                  </small>
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="onboarding-fields">
                <div className="onboarding-positioning">
                  <div className="onboarding-section-label">
                    <h2>{l('Semantic Branding', 'Branding Semântico')}</h2>
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <p className="onboarding-muted">
                    {l(
                      'An attribute is an idea people should associate with your brand: expertise, reliability, or a distinctive experience. It is a goal, not a measured result.',
                      'Um atributo é uma ideia que você quer associar à marca: especialização, confiança ou uma experiência própria. É um objetivo, não um resultado medido.',
                    )}
                  </p>
                  <label
                    className="onboarding-semantic-toggle"
                    htmlFor="onboarding-semantic-enabled"
                  >
                    <Checkbox
                      id="onboarding-semantic-enabled"
                      checked={draft.semantic.enabled}
                      onCheckedChange={(enabled) =>
                        setDraft((current) => ({
                          ...current,
                          semantic: { ...current.semantic, enabled },
                        }))
                      }
                    />
                    <span>
                      {l(
                        'Include Semantic Branding in this project',
                        'Incluir Branding Semântico neste projeto',
                      )}
                    </span>
                  </label>
                  <p className="onboarding-muted">
                    {l(
                      'Uncheck to configure it later.',
                      'Desmarque para configurar depois.',
                    )}
                  </p>
                  {draft.semantic.enabled ? (
                    <>
                      <p className="onboarding-muted">
                        {l(
                          'Start with three editable ideas for your category. Keep only what represents your positioning; add up to ten.',
                          'Comece com três ideias editáveis para sua categoria. Mantenha o que representa seu posicionamento; adicione até dez.',
                        )}
                      </p>
                      <div className="onboarding-attributes">
                        {draft.semantic.attributes.map((attribute, index) => (
                          <div
                            className="onboarding-attribute"
                            key={attribute.id}
                          >
                            <div className="onboarding-field">
                              <Label
                                htmlFor={`onboarding-attribute-${attribute.id}`}
                              >
                                {l('Attribute', 'Atributo')} {number(index + 1)}
                              </Label>
                              <Input
                                id={`onboarding-attribute-${attribute.id}`}
                                value={attribute.name}
                                maxLength={60}
                                placeholder={l(
                                  'e.g. Reliable delivery',
                                  'Ex.: Entrega confiável',
                                )}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    semantic: {
                                      ...current.semantic,
                                      attributes:
                                        current.semantic.attributes.map(
                                          (item) =>
                                            item.id === attribute.id
                                              ? {
                                                  ...item,
                                                  name: event.target.value,
                                                }
                                              : item,
                                        ),
                                    },
                                  }))
                                }
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={l(
                                `Remove attribute ${index + 1}`,
                                `Remover atributo ${index + 1}`,
                              )}
                              onClick={() =>
                                setDraft((current) => ({
                                  ...current,
                                  semantic: {
                                    ...current.semantic,
                                    attributes:
                                      current.semantic.attributes.filter(
                                        (item) => item.id !== attribute.id,
                                      ),
                                  },
                                }))
                              }
                            >
                              <Trash2 size={14} />
                            </Button>
                            <details className="onboarding-attribute-description">
                              <summary>
                                {l(
                                  'Add context (optional)',
                                  'Adicionar contexto (opcional)',
                                )}
                              </summary>
                              <div className="onboarding-field">
                                <Label
                                  htmlFor={`onboarding-attribute-description-${attribute.id}`}
                                >
                                  {l(
                                    'What does this mean for your brand?',
                                    'O que isso significa para sua marca?',
                                  )}
                                </Label>
                                <Textarea
                                  id={`onboarding-attribute-description-${attribute.id}`}
                                  value={attribute.description}
                                  maxLength={240}
                                  placeholder={l(
                                    'e.g. Delivering on the agreed date and keeping customers informed.',
                                    'Ex.: Cumprir a data combinada e manter o cliente informado.',
                                  )}
                                  onChange={(event) =>
                                    setDraft((current) => ({
                                      ...current,
                                      semantic: {
                                        ...current.semantic,
                                        attributes:
                                          current.semantic.attributes.map(
                                            (item) =>
                                              item.id === attribute.id
                                                ? {
                                                    ...item,
                                                    description:
                                                      event.target.value,
                                                  }
                                                : item,
                                          ),
                                      },
                                    }))
                                  }
                                />
                              </div>
                            </details>
                          </div>
                        ))}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="onboarding-add-competitor"
                        disabled={draft.semantic.attributes.length >= 10}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            semantic: {
                              ...current.semantic,
                              attributes: [
                                ...current.semantic.attributes,
                                {
                                  id: `attribute-${crypto.randomUUID()}`,
                                  name: '',
                                  description: '',
                                },
                              ],
                            },
                          }))
                        }
                      >
                        <Plus size={14} />
                        {l('Add attribute', 'Adicionar atributo')}
                      </Button>
                    </>
                  ) : (
                    <p className="onboarding-muted">
                      {l(
                        'You can configure these associations later. Your attributes stay here if you change your mind.',
                        'Você pode configurar essas associações depois. Seus atributos continuam aqui se mudar de ideia.',
                      )}
                    </p>
                  )}
                </div>
                <details
                  className="onboarding-competitor-disclosure"
                  open={competitorsOpen}
                  onToggle={(event) =>
                    setCompetitorsOpen(event.currentTarget.open)
                  }
                >
                  <summary>
                    <span>
                      {l(
                        'Compare with competitors',
                        'Comparar com concorrentes',
                      )}
                    </span>
                    <Badge variant="secondary">
                      {competitors.length
                        ? number(competitors.length)
                        : l('Optional', 'Opcional')}
                    </Badge>
                  </summary>
                  <div className="onboarding-fields">
                    <div className="onboarding-section-label">
                      <h2>{l('Your competitors', 'Seus concorrentes')}</h2>
                      <Badge variant="secondary">
                        {l('Optional', 'Opcional')}
                      </Badge>
                    </div>
                    {draft.competitors.length === 0 && (
                      <div className="onboarding-empty">
                        <Target size={23} />
                        <p>
                          {l(
                            'Add two or three names you usually compete with.',
                            'Adicione dois ou três nomes com os quais você costuma competir.',
                          )}
                        </p>
                        <small>
                          {l(
                            'The same competitors inform visibility and brand associations. None are added automatically.',
                            'Os mesmos concorrentes orientam a visibilidade e as associações da marca. Nenhum é adicionado automaticamente.',
                          )}
                        </small>
                      </div>
                    )}
                    <div className="onboarding-competitors">
                      {draft.competitors.map((competitor, index) => (
                        <div className="onboarding-competitor" key={index}>
                          <div className="onboarding-competitor-icon">
                            {normalizeOnboardingDomain(competitor.domain) ? (
                              <SiteFavicon
                                domain={normalizeOnboardingDomain(
                                  competitor.domain,
                                )!}
                                name={competitor.name}
                              />
                            ) : (
                              <Globe size={16} />
                            )}
                          </div>
                          <div className="onboarding-field">
                            <Label
                              htmlFor={`onboarding-competitor-name-${index}`}
                            >
                              {l('Name', 'Nome')} {number(index + 1)}
                            </Label>
                            <Input
                              id={`onboarding-competitor-name-${index}`}
                              placeholder={l('Brand name', 'Nome da marca')}
                              maxLength={80}
                              value={competitor.name}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  competitors: current.competitors.map(
                                    (item, at) =>
                                      at === index
                                        ? { ...item, name: event.target.value }
                                        : item,
                                  ),
                                }))
                              }
                            />
                          </div>
                          <div className="onboarding-field">
                            <Label
                              htmlFor={`onboarding-competitor-domain-${index}`}
                            >
                              {l('Website', 'Site')}
                            </Label>
                            <Input
                              id={`onboarding-competitor-domain-${index}`}
                              placeholder="competitor.com"
                              maxLength={500}
                              value={competitor.domain}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  competitors: current.competitors.map(
                                    (item, at) =>
                                      at === index
                                        ? {
                                            ...item,
                                            domain: event.target.value,
                                          }
                                        : item,
                                  ),
                                }))
                              }
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={l(
                              `Remove competitor ${index + 1}`,
                              `Remover concorrente ${index + 1}`,
                            )}
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                competitors: current.competitors.filter(
                                  (_, at) => at !== index,
                                ),
                              }))
                            }
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="onboarding-add-competitor"
                      disabled={draft.competitors.length >= 5}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          competitors: [
                            ...current.competitors,
                            { name: '', domain: '' },
                          ],
                        }))
                      }
                    >
                      <Plus size={14} />
                      {l('Add competitor', 'Adicionar concorrente')}
                    </Button>
                  </div>
                </details>
              </div>
            )}
            {step === 2 && (
              <div className="onboarding-prompt-step">
                <div className="onboarding-section-label">
                  <h2>
                    {l(
                      'A starter set for your category',
                      'Um ponto de partida para sua categoria',
                    )}
                  </h2>
                  <Badge variant="secondary">
                    {number(selected.length)} / {number(10)}{' '}
                    {l('selected', 'selecionados')}
                  </Badge>
                </div>
                <p className="onboarding-muted">
                  {l(
                    'Editable examples from your context and attributes. Each association has a question without your brand name and another that names it. Compare the two separately.',
                    'Exemplos editáveis a partir do contexto e dos atributos. Cada associação tem uma pergunta sem o nome da marca e outra que o inclui. Compare as duas separadamente.',
                  )}
                </p>
                <div
                  className="onboarding-intents"
                  aria-label={l('Prompt intent', 'Intenção dos prompts')}
                >
                  {onboardingIntents.map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={intent === value}
                      onClick={() => {
                        setIntent(value);
                        setEditingPrompt(null);
                      }}
                    >
                      <b>{intentName(value)}</b>
                      <span>
                        {number(
                          draft.prompts.filter(
                            (prompt) =>
                              prompt.intent === value && prompt.selected,
                          ).length,
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <p
                  className={`onboarding-intent-help ${intent === 'branded' ? 'is-branded' : ''}`}
                >
                  {intentDescription[intent]}
                </p>
                <p className="onboarding-selection-note">
                  {l(
                    'Start with up to 10 questions. Additional attributes offer more options; choose the ones that matter most.',
                    'Comece com até 10 perguntas. Mais atributos oferecem mais opções; escolha as que mais importam.',
                  )}
                </p>
                {visiblePrompts.length === 0 && (
                  <p className="onboarding-muted">
                    {l(
                      'No questions in this group yet. Write your own prompt below.',
                      'Ainda não há perguntas neste grupo. Escreva seu prompt abaixo.',
                    )}
                  </p>
                )}
                <div className="onboarding-prompts">
                  {visiblePrompts.map((prompt) => (
                    <div
                      key={prompt.id}
                      className="onboarding-prompt-row"
                      data-selected={prompt.selected}
                    >
                      <Checkbox
                        id={`onboarding-select-${prompt.id}`}
                        checked={prompt.selected}
                        disabled={!prompt.selected && selected.length >= 10}
                        aria-label={l(
                          `Track: ${prompt.text}`,
                          `Acompanhar: ${prompt.text}`,
                        )}
                        onCheckedChange={(checked) =>
                          updatePrompt(prompt.id, { selected: checked })
                        }
                      />
                      <div className="onboarding-prompt-content">
                        {editingPrompt === prompt.id ? (
                          <div className="onboarding-field">
                            <Textarea
                              aria-label={l(
                                'Edit prompt question',
                                'Editar pergunta do prompt',
                              )}
                              value={prompt.text}
                              maxLength={1000}
                              onChange={(event) =>
                                updatePrompt(prompt.id, {
                                  text: event.target.value,
                                  edited: true,
                                })
                              }
                            />
                            <Input
                              aria-label={l('Prompt topic', 'Tópico do prompt')}
                              maxLength={60}
                              value={prompt.topic}
                              onChange={(event) =>
                                updatePrompt(prompt.id, {
                                  topic: event.target.value,
                                  edited: true,
                                })
                              }
                            />
                          </div>
                        ) : (
                          <>
                            <Label htmlFor={`onboarding-select-${prompt.id}`}>
                              {prompt.text}
                            </Label>
                            <span className="onboarding-prompt-meta">
                              {prompt.topic}
                              <span>·</span>
                              {prompt.origin === 'custom'
                                ? l('Your prompt', 'Seu prompt')
                                : prompt.semanticAttributeId
                                  ? l(
                                      'Brand association',
                                      'Associação de marca',
                                    )
                                  : l('Suggested example', 'Exemplo sugerido')}
                            </span>
                          </>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={
                          editingPrompt === prompt.id
                            ? l('Finish editing', 'Concluir edição')
                            : l(
                                `Edit prompt: ${prompt.text}`,
                                `Editar prompt: ${prompt.text}`,
                              )
                        }
                        onClick={() =>
                          setEditingPrompt(
                            editingPrompt === prompt.id ? null : prompt.id,
                          )
                        }
                      >
                        {editingPrompt === prompt.id ? (
                          <Check size={14} />
                        ) : (
                          <Pencil size={13} />
                        )}
                      </Button>
                      {prompt.origin === 'custom' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={l(
                            `Remove prompt: ${prompt.text}`,
                            `Remover prompt: ${prompt.text}`,
                          )}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              prompts: current.prompts.filter(
                                (item) => item.id !== prompt.id,
                              ),
                            }))
                          }
                        >
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="onboarding-prompt-actions">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setCustomOpen((open) => !open);
                      setCustomIntent(intent);
                      setCustomError('');
                    }}
                  >
                    <Plus size={13} />
                    {l('Write my own prompt', 'Escrever meu prompt')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        prompts: current.prompts.map((prompt, index) => ({
                          ...prompt,
                          selected: selected.length === 0 && index < 10,
                        })),
                      }))
                    }
                  >
                    {selected.length > 0
                      ? l('Deselect all', 'Desmarcar todos')
                      : l('Select up to 10', 'Selecionar até 10')}
                  </Button>
                </div>
                {customOpen && (
                  <div className="onboarding-custom">
                    <div className="onboarding-field">
                      <Label htmlFor="onboarding-custom-prompt">
                        {l(
                          'What would your customer ask?',
                          'O que seu cliente perguntaria?',
                        )}
                      </Label>
                      <Textarea
                        id="onboarding-custom-prompt"
                        value={customText}
                        maxLength={1000}
                        placeholder={l(
                          'Which option would you recommend for someone choosing for the first time?',
                          'Qual opção você recomenda para quem está escolhendo pela primeira vez?',
                        )}
                        onChange={(event) => setCustomText(event.target.value)}
                      />
                    </div>
                    <div className="onboarding-custom-details">
                      <div className="onboarding-field">
                        <Label>{l('Intent', 'Intenção')}</Label>
                        <FilterSelect
                          label={l(
                            'Custom prompt intent',
                            'Intenção do novo prompt',
                          )}
                          value={customIntent}
                          onChange={(value) =>
                            setCustomIntent(value as PromptIntent)
                          }
                          options={onboardingIntents.map((value) => ({
                            value,
                            label: intentName(value),
                          }))}
                        />
                      </div>
                      <div className="onboarding-field">
                        <Label htmlFor="onboarding-custom-topic">
                          {l('Topic', 'Tópico')}
                        </Label>
                        <Input
                          id="onboarding-custom-topic"
                          maxLength={60}
                          value={customTopic}
                          placeholder={intentName(customIntent)}
                          onChange={(event) =>
                            setCustomTopic(event.target.value)
                          }
                        />
                      </div>
                    </div>
                    {customError && (
                      <p role="alert" className="onboarding-error">
                        {customError}
                      </p>
                    )}
                    <Button type="button" size="sm" onClick={addCustomPrompt}>
                      <Plus size={13} />
                      {l('Add to my prompts', 'Adicionar aos meus prompts')}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {step === 3 && (
              <div className="onboarding-fields">
                <div className="onboarding-review-brand">
                  {domain && (
                    <SiteFavicon domain={domain} name={draft.brandName} />
                  )}
                  <div>
                    <h2>{draft.brandName}</h2>
                    <span>{domain}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => goTo(0)}
                  >
                    <Pencil size={13} />
                    {l('Edit', 'Editar')}
                  </Button>
                </div>
                <div className="onboarding-review-counts">
                  {[
                    [number(selected.length), l('prompts', 'prompts')],
                    [
                      number(competitors.length),
                      l('competitors', 'concorrentes'),
                    ],
                    [countryLabel, l('audience', 'público')],
                  ].map(([value, label]) => (
                    <div key={label}>
                      <strong>{value}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="onboarding-field">
                  <Label>
                    {l('AI models to include', 'Modelos de IA para incluir')}
                  </Label>
                  <p className="onboarding-muted">
                    {l(
                      'Choose the models you want to compare. Keep at least one selected.',
                      'Escolha os modelos que quer comparar. Mantenha pelo menos um selecionado.',
                    )}
                  </p>
                  <div className="onboarding-models">
                    {demoModels.map((model) => (
                      <label
                        key={model}
                        htmlFor={`onboarding-model-${model.replace(/\s+/g, '-')}`}
                        data-selected={draft.models.includes(model)}
                      >
                        <Checkbox
                          id={`onboarding-model-${model.replace(/\s+/g, '-')}`}
                          checked={draft.models.includes(model)}
                          onCheckedChange={(checked) =>
                            setDraft((current) => ({
                              ...current,
                              models: demoModels.filter((item) =>
                                item === model
                                  ? checked
                                  : current.models.includes(item),
                              ),
                            }))
                          }
                        />
                        <ModelMark model={model} />
                      </label>
                    ))}
                  </div>
                </div>
                <section className="onboarding-review-semantic">
                  <div className="onboarding-section-label">
                    <h2>{l('Semantic Branding', 'Branding Semântico')}</h2>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => goTo(1)}
                    >
                      <Pencil size={13} />
                      {l('Edit', 'Editar')}
                    </Button>
                  </div>
                  {draft.semantic.enabled ? (
                    <>
                      <p className="onboarding-muted">
                        {l(
                          'Desired associations to compare with the evidence:',
                          'Associações desejadas para comparar com as evidências:',
                        )}
                      </p>
                      <div className="onboarding-review-attributes">
                        {draft.semantic.attributes.map((attribute) => (
                          <Badge key={attribute.id} variant="secondary">
                            {attribute.name}
                          </Badge>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="onboarding-muted">
                      {l(
                        'You chose to configure brand associations later.',
                        'Você escolheu configurar as associações da marca depois.',
                      )}
                    </p>
                  )}
                  <p className="onboarding-muted">
                    {l('Research language', 'Idioma da pesquisa')}:{' '}
                    <strong>
                      {draft.language === 'pt-BR'
                        ? 'Português (Brasil)'
                        : 'English'}
                    </strong>
                  </p>
                </section>
                <div className="onboarding-review-period">
                  <ListChecks size={18} />
                  <div>
                    <b>
                      {l(
                        'Your configuration is ready',
                        'Sua configuração está pronta',
                      )}
                    </b>
                    <small>
                      {l(
                        'This frontend keeps the project in the current session. No AI collection starts, and no measured scores are created.',
                        'Este frontend mantém o projeto na sessão atual. Nenhuma coleta de IA é iniciada e nenhuma nota medida é criada.',
                      )}
                    </small>
                  </div>
                </div>
                <div className="onboarding-review-intents">
                  {onboardingIntents.map((value) => (
                    <span key={value}>
                      <i />
                      {intentName(value)}
                      <b>
                        {number(
                          selected.filter((prompt) => prompt.intent === value)
                            .length,
                        )}
                      </b>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="onboarding-error">
                {errorCopy[error]}
              </p>
            )}
            <footer className="onboarding-footer">
              <div>
                {step > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => goTo(step - 1)}
                  >
                    <ArrowLeft size={14} />
                    {l('Back', 'Voltar')}
                  </Button>
                ) : (
                  <span>{l('About 3 minutes', 'Cerca de 3 minutos')}</span>
                )}
              </div>
              <Button
                type="submit"
                disabled={submitting || (step === 3 && !canCreate)}
              >
                {step === 3
                  ? l('Open my project', 'Abrir meu projeto')
                  : l('Continue', 'Continuar')}
                <ArrowRight size={14} />
              </Button>
            </footer>
          </form>
          <aside className="onboarding-coach">
            <div className="onboarding-coach-icon">
              {step === 0 ? (
                <Compass size={21} />
              ) : step === 1 ? (
                <Target size={21} />
              ) : step === 2 ? (
                <Lightbulb size={21} />
              ) : (
                <CheckCheck size={21} />
              )}
            </div>
            <h2>
              {
                [
                  l('Start small. See more.', 'Comece simples. Enxergue mais.'),
                  l(
                    'Context makes numbers useful.',
                    'Contexto dá sentido aos números.',
                  ),
                  l('Think like your customer.', 'Pense como seu cliente.'),
                  l(
                    'Make your next move clearer.',
                    'Enxergue seu próximo passo.',
                  ),
                ][step]
              }
            </h2>
            <p>
              {
                [
                  l(
                    'You don’t need the perfect setup. Start with one category and the audience you know best.',
                    'Você não precisa da configuração perfeita. Comece com uma categoria e o público que conhece melhor.',
                  ),
                  l(
                    'Separate what you want your brand to stand for from what the answers actually show. Competitors add context to both.',
                    'Separe o que você quer que a marca represente do que as respostas mostram. Concorrentes dão contexto aos dois.',
                  ),
                  l(
                    'A useful prompt combines a real question, an audience and a decision. Add details that change the recommendation.',
                    'Um bom prompt combina uma pergunta real, um público e uma decisão. Acrescente detalhes que mudam a recomendação.',
                  ),
                  l(
                    'Explore visibility, compare brands and understand which sources shape AI answers.',
                    'Explore a visibilidade, compare marcas e entenda quais fontes influenciam as respostas da IA.',
                  ),
                ][step]
              }
            </p>
            {step === 2 ? (
              <div className="onboarding-coach-example">
                <span>{l('FROM A KEYWORD', 'DE UMA PALAVRA-CHAVE')}</span>
                <p>“{localizedSegment}”</p>
                <ArrowRight size={16} />
                <span>{l('TO A REAL QUESTION', 'PARA UMA PERGUNTA REAL')}</span>
                <b>
                  “
                  {l(
                    `Which ${localizedSegment.toLowerCase()} brands would you recommend, and why?`,
                    `Quais marcas de ${localizedSegment.toLowerCase()} você recomenda, e por quê?`,
                  )}
                  ”
                </b>
                <small>
                  {l(
                    'Keep discovery questions unbranded. Use the Branded group to explore perception.',
                    'Use perguntas sem marca para descoberta. O grupo Sua marca serve para explorar percepção.',
                  )}
                </small>
              </div>
            ) : (
              <ul>
                <li>
                  <Check size={14} />
                  {l('Review before continuing', 'Revise antes de continuar')}
                </li>
                <li>
                  <Check size={14} />
                  {l(
                    'Organized by topic and intent',
                    'Organizado por tópico e intenção',
                  )}
                </li>
                <li>
                  <Check size={14} />
                  {l(
                    'One workspace for your team',
                    'Um workspace para sua equipe',
                  )}
                </li>
              </ul>
            )}
            <div className="onboarding-demo-note">
              <Search size={14} />
              <p>
                {l(
                  'A hands-on preview. Suggestions are editable examples; no site scanning or AI generation is performed.',
                  'Uma prévia para explorar. As sugestões são exemplos editáveis; não há leitura de sites ou geração por IA.',
                )}
              </p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
