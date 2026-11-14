'use client';
// New project (10/11/2026): the wizard of the June 2026 Lastfind in its steps, words and layout, drawn with the catalog and wired to today's creation (POST /api/onboarding:
// the project, its competitors, topics, prompts and AIs in one batch, the plan checked in it, the first collection at once).
// The competitors, topics and prompts are suggested by the model as in June (12/11/2026: POST /api/onboarding/suggestions,
// lib/new-project-ai.ts). Faster since 12/11/2026: leaving the Project step asks the competitors (a quick pass without web search
// and the searched one, at once) and the topics together; the prompts of the topics the model suggested are asked as soon as they
// land, one call per topic, each card filling on its own. Every suggestion can be edited in place (the cell is the field: Input and
// Textarea `variant="cell"`), removed or unselected, and anything can be added by hand. No template stands in when the model fails.
// Faster on 13/11/2026: competitors and topics are asked as soon as the brand and its domain are filled in (the Project step's pause),
// so they are usually on screen when the person gets there. Domains and aliases are badges (TagInput), the first domain the main one.
// Semantic Branding comes with the project unless the first step says no (13/11/2026): its attributes are asked once the competitors are
// known, reviewed and edited in a step of their own (the attributes' table of Settings, SemanticAttributesCard), saved with the project,
// and its first collection starts with it. Without it, the step is left out. The project's name may differ from the brand's.
// Each step opens at the top of the page. The optional Comparison step (12/11/2026) suggests the products the brand sells, their attributes and the personas
// who buy; what is picked goes with the creation (`comparison`, lib/comparison.ts), else Comparison is set up later on its own screen.
// Left out, because today's product has no backend for them: keyword volume per topic, brands to ignore, one-off and monthly frequencies.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Project, Workspace } from '@/lib/types';
import { countryLanguage, countryName, type CountryLocale } from '@/lib/countries';
import { engineUnavailable, type Engine } from '@/lib/engines';
import { MAX_COMPETITORS } from '@/lib/brand-decisions';
import { competitorIdentity } from '@/lib/competitor-identity';
import { normalizeDomain } from '@/lib/metrics';
import { requestJson } from '@/lib/client';
import { exampleTopic, languageName, wizardCountry } from '@/lib/new-project';
import type { SuggestedCompetitor, SuggestedPrompt, SuggestedTopic } from '@/lib/new-project-ai';
import { ATTRIBUTE_MAX } from '@/lib/semantic-attributes';
import { COMPARISON_LIMITS, type ComparisonSuggestions } from '@/lib/comparison';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TagInput } from '@/components/ui/tag-input';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectField } from '@/components/ui/select';
import { LiveLabel } from '@/components/ui/live-label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field';
import { ChevronRight } from 'lucide-react';
import { PageHeading } from '@/components/lastfind/presentation/page-heading';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { Note } from '@/components/lastfind/presentation/note';
import { WizardSteps } from '@/components/lastfind/presentation/wizard-steps';
import { CountrySelect, EngineAvailability } from './country-field';
import { EmptyState, ModelMark, SiteFavicon } from './shared';
import { LOADING_ROWS, line, oneLine, removeColumn as removeCell, selectColumn } from './wizard-cells';
import { SemanticAttributesCard, attributeProblem, type AttributeRow } from './semantic-attribute-wizard';
import { WizardComparisonStep, draftConfig, draftOf, draftProblem, type ComparisonDraft } from './wizard-comparison';
import './new-project-wizard.css';

type Copy = (en: string, pt: string) => string;
type StepId = 'project' | 'competitors' | 'topics' | 'prompts' | 'engines' | 'semantic' | 'comparison' | 'review';
const STEPS: { id: StepId; label: [string, string] }[] = [
  { id: 'project', label: ['Project', 'Projeto'] },
  { id: 'competitors', label: ['Competitors', 'Concorrentes'] },
  { id: 'topics', label: ['Topics', 'Tópicos'] },
  { id: 'prompts', label: ['Prompts', 'Prompts'] },
  { id: 'engines', label: ['AIs', 'IAs'] },
  { id: 'semantic', label: ['Semantic Branding', 'Semantic Branding'] },
  { id: 'comparison', label: ['Comparison', 'Comparação'] },
  { id: 'review', label: ['Review', 'Revisão'] },
];
/** One request carries at most this many prompts (POST /api/onboarding). */
const MAX_PROMPTS = 100;
/** Semantic Branding attributes that start selected (Settings' rule allows 3 to 10). */
const SEMANTIC_START = 5;
/**
 * `ai`: a suggestion the person has not edited (a new suggestion replaces it; an edited or typed row stays). `domains`: the main
 * domain first, then the competitor's other official domains.
 */
type Competitor = { key: string; name: string; domains: string[]; aliases: string[]; ai?: boolean };
type TopicRow = { key: string; name: string; selected: boolean; keyword?: string | null; seed?: string | null; ai?: boolean };
type PromptRow = { id: string; text: string; topic: string; selected: boolean; ai?: boolean };
type Suggestions = { competitors?: SuggestedCompetitor[]; topics?: SuggestedTopic[]; prompts?: SuggestedPrompt[]; comparison?: ComparisonSuggestions; attributes?: { name: string; description: string }[] };
const domainOf = (value: string) => {
  try {
    return normalizeDomain(value);
  } catch {
    return null;
  }
};
const named = (value: string) => value.trim().length >= 2 && !!competitorIdentity(value);
/** An alias badge: a name with letters or numbers, at most 80 characters. */
const aliasOf = (value: string) => (named(value) ? value.trim().slice(0, 80) : null);
const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function NewProjectWizard({
  workspace,
  project,
  locale,
  t,
  onCreated,
}: {
  workspace: Workspace;
  /** The project open when the wizard started: its country is the default market. */
  project: Project | null;
  locale: CountryLocale;
  t: Copy;
  onCreated: (id: string) => Promise<unknown>;
}) {
  const formId = useId();
  const requestId = useRef<string>(crypto.randomUUID());
  const allowed = workspace.capabilities.engines;
  const free = !!workspace.capabilities.free;
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [brand, setBrand] = useState('');
  const [projectName, setProjectName] = useState('');
  const [domain, setDomain] = useState('');
  // The open project's country, else the interface's on the server; once in the browser, without a project, its languages' region.
  const [location, setLocation] = useState(() => wizardCountry(project?.location_code, [], locale));
  const [language, setLanguage] = useState<'en' | 'pt'>(() => countryLanguage(location));
  // Once, when the wizard opens: a country chosen afterwards is never replaced.
  const regionRead = useRef(false);
  useEffect(() => {
    if (project || regionRead.current) return;
    regionRead.current = true;
    const code = wizardCountry(null, navigator.languages ?? [navigator.language], locale);
    queueMicrotask(() => {
      setLocation(code);
      setLanguage(countryLanguage(code));
    });
  }, [project, locale]);
  const [frequency, setFrequency] = useState<'24' | '168'>(free ? '168' : '24');
  const [aliases, setAliases] = useState<string[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([{ key: crypto.randomUUID(), name: '', selected: true }]);
  // The topics as they are now, for an answer that lands after the render that asked for it.
  const topicsNow = useRef(topics);
  useEffect(() => {
    topicsNow.current = topics;
  }, [topics]);
  const [manyTopics, setManyTopics] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<PromptRow[]>([]);
  // The AI suggestions in flight and why the last ask failed, by key: `competitors` (nothing arrived yet), `competitors:web` (the
  // searched pass), `topics`, `prompts:<topic>`. `asked`: what was asked on its own, once each.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const competitorsRun = useRef(0);
  const topicsRun = useRef(0);
  const [engines, setEngines] = useState<Engine[]>(allowed);
  const [semantic, setSemantic] = useState(true);
  const [attributes, setAttributes] = useState<AttributeRow[]>([]);
  // Comparison: the products, attributes and personas suggested and edited in place (wizard-comparison.tsx), what is selected sent.
  const [comparison, setComparison] = useState<ComparisonDraft | null>(null);
  const comparisonNow = useRef(comparison);
  useEffect(() => {
    comparisonNow.current = comparison;
  }, [comparison]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Semantic Branding's step only when it comes with the project.
  const steps = semantic ? STEPS : STEPS.filter((item) => item.id !== 'semantic');
  const id = steps[step].id;
  const label = (index: number) => t(...steps[index].label);
  // Each step opens at the top of the page (13/11/2026: Next left the person at the foot of the new step).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [id]);
  const promptRoom = Math.min(MAX_PROMPTS, workspace.capabilities.promptLimit == null ? MAX_PROMPTS : Math.max(0, workspace.capabilities.promptLimit - workspace.capacity.prompts));
  const topicRoom = workspace.capabilities.topicLimit == null ? Infinity : Math.max(0, workspace.capabilities.topicLimit - workspace.capacity.topics);
  const available = allowed.filter((engine) => !engineUnavailable(engine, location));
  const chosenEngines = engines.filter((engine) => available.includes(engine));
  const chosenTopics = topics.filter((topic) => topic.selected && topic.name.trim());
  const topicNames = chosenTopics.map((topic) => topic.name.trim());
  // The suggested and written prompts of the topics selected now (a topic unselected or renamed keeps its rows aside).
  const suggested = suggestions.filter((item) => topicNames.includes(item.topic));
  const prompts = suggested.filter((item) => item.selected && item.text.trim()).map((item) => ({ text: item.text.trim(), topic: item.topic }));
  const uniquePrompts = [...new Map(prompts.map((item) => [item.text.toLowerCase(), item])).values()];
  const comparisonLimit = Math.min(COMPARISON_LIMITS.products, workspace.capabilities.comparisonProducts ?? Infinity);
  // Each product is compared with the project's competitors: without any, nothing is sent.
  const chosenAttributes = attributes.filter((item) => item.selected);
  const brandNames = [brand, ...competitors.map((item) => item.name)].filter(named);
  const comparisonConfig = draftConfig(comparison, competitors.map((item) => ({ name: item.name.trim(), domain: item.domains[0] ?? '' })));

  // What stops each step, in the person's words (null: it can go on).
  const problem = ((): string | null => {
    if (id === 'project') {
      if (!named(brand)) return t('Enter the brand, with at least two letters or numbers.', 'Informe a marca, com pelo menos duas letras ou números.');
      if (projectName.trim() && projectName.trim().length < 2) return t('The project name has at least two characters, or leave it empty.', 'O nome do projeto tem pelo menos dois caracteres, ou deixe vazio.');
      if (!domainOf(domain)) return t('Enter a valid domain, such as yourbrand.com.', 'Informe um domínio válido, como suamarca.com.br.');
      return null;
    }
    if (id === 'competitors') {
      if (competitors.some((item) => !named(item.name) || !item.domains.length))
        return t('Fill in the name and at least one domain of every competitor, or remove the empty rows.', 'Preencha o nome e pelo menos um domínio de cada concorrente, ou remova as linhas vazias.');
      const names = [brand, ...competitors.map((item) => item.name)].map(competitorIdentity);
      if (new Set(names).size !== names.length) return t('Use different names for your brand and each competitor.', 'Use nomes diferentes para a sua marca e cada concorrente.');
      const domains = competitors.flatMap((item) => item.domains);
      if (new Set(domains).size !== domains.length || domains.includes(domainOf(domain) ?? '')) return t('Do not repeat a domain, yours or a competitor’s.', 'Não repita um domínio, seu ou de um concorrente.');
      return null;
    }
    if (id === 'topics') {
      if (!chosenTopics.length) return t('Select at least one topic with a name.', 'Selecione pelo menos um tópico com nome.');
      if (chosenTopics.some((topic) => topic.name.trim().length > 40)) return t('A topic has at most 40 characters.', 'Um tópico tem no máximo 40 caracteres.');
      if (new Set(topicNames.map((name) => name.toLowerCase())).size !== topicNames.length) return t('Do not repeat a topic.', 'Não repita um tópico.');
      if (chosenTopics.length > topicRoom) return t(`Your plan has room for ${topicRoom} more topics.`, `Seu plano tem espaço para mais ${topicRoom} tópicos.`);
      return null;
    }
    if (id === 'prompts') {
      if (!uniquePrompts.length) return t('Select or write at least one prompt.', 'Selecione ou escreva pelo menos um prompt.');
      if (uniquePrompts.some((item) => item.text.length < 5 || item.text.length > 1000)) return t('Each prompt has from 5 to 1,000 characters.', 'Cada prompt tem de 5 a 1.000 caracteres.');
      if (uniquePrompts.length > promptRoom) return t(`You selected more prompts than your plan has room for (${promptRoom}).`, `Você selecionou mais prompts do que o seu plano comporta (${promptRoom}).`);
      return null;
    }
    if (id === 'engines') return chosenEngines.length ? null : t('Select at least one AI to continue.', 'Selecione pelo menos uma IA para continuar.');
    if (id === 'semantic') {
      if (busy.attributes && !attributes.length) return t('The attributes are still being suggested. Wait a moment, or skip to set up Semantic Branding later.', 'Os atributos ainda estão sendo sugeridos. Aguarde um instante, ou pule para configurar o Semantic Branding depois.');
      return attributeProblem(attributes, brandNames, t);
    }
    if (id === 'comparison') return draftProblem(comparison, t);
    return null;
  })();

  const ask = (body: Record<string, unknown>) =>
    requestJson<Suggestions>('/api/onboarding/suggestions', 'POST', { brand: brand.trim(), domain: domain.trim(), location, language, ...body });
  const mark = (key: string, value: boolean) => setBusy((current) => ({ ...current, [key]: value }));
  const fail = (key: string, message: string) => setFailed((current) => ({ ...current, [key]: message }));

  // Competitors: the quick pass fills the table in seconds, the searched one replaces the rows the person has not touched.
  function applyCompetitors(found: SuggestedCompetitor[]) {
    setCompetitors((list) => {
      const kept = list.filter((item) => !item.ai && (item.name.trim() || item.domains.length));
      const taken = new Set(kept.flatMap((item) => [competitorIdentity(item.name), ...item.domains]));
      const added = found.filter((item) => !taken.has(competitorIdentity(item.name)) && !taken.has(item.domain));
      return [
        ...kept,
        ...added.slice(0, Math.max(0, MAX_COMPETITORS - kept.length)).map((item) => ({
          key: crypto.randomUUID(),
          name: item.name,
          domains: [item.domain, ...(item.domains ?? [])],
          aliases: item.aliases,
          ai: true,
        })),
      ];
    });
  }
  async function suggestCompetitors() {
    const run = ++competitorsRun.current;
    const current = () => run === competitorsRun.current;
    let searched = false;
    setBusy((value) => ({ ...value, competitors: true, 'competitors:web': true }));
    fail('competitors', '');
    const known = competitors.filter((item) => !item.ai && item.name.trim()).map((item) => item.name.trim());
    const quick = ask({ step: 'competitors', quick: true, competitors: known }).then((data) => {
      if (current() && !searched) applyCompetitors(data.competitors ?? []);
    });
    const web = ask({ step: 'competitors', competitors: known }).then((data) => {
      searched = true;
      if (current()) applyCompetitors(data.competitors ?? []);
    });
    void Promise.any([quick, web]).catch(() => {}).finally(() => current() && mark('competitors', false));
    const [first, second] = await Promise.allSettled([quick, web]);
    if (!current()) return;
    setBusy((value) => ({ ...value, competitors: false, 'competitors:web': false }));
    // Only when neither pass gave anything: a quick list already on screen stands when the search fails.
    if (first.status === 'rejected' && second.status === 'rejected') fail('competitors', reason(second.reason));
  }
  async function suggestTopics() {
    const run = ++topicsRun.current;
    mark('topics', true);
    fail('topics', '');
    try {
      const data = await ask({ step: 'topics' });
      // A brand or domain changed since: its own ask is on its way.
      if (run !== topicsRun.current) return;
      const kept = topicsNow.current.filter((item) => !item.ai && item.name.trim());
      const taken = new Set(kept.map((item) => item.name.trim().toLowerCase()));
      const first = !kept.some((item) => item.selected);
      const added = (data.topics ?? []).filter((item) => !taken.has(item.name.toLowerCase())).slice(0, Math.max(0, 10 - kept.length));
      // The wizard recommends one topic: the model's first is selected when none of the person's is.
      const next = [...kept, ...added.map((item, index) => ({ key: crypto.randomUUID(), name: item.name, keyword: item.keyword, seed: item.seed, selected: first && index === 0, ai: true }))];
      topicsNow.current = next;
      setTopics(next);
      // Its prompts are asked now, before the person reaches their step.
      prefetch(next);
    } catch (cause) {
      if (run === topicsRun.current) fail('topics', reason(cause));
    } finally {
      if (run === topicsRun.current) mark('topics', false);
    }
  }
  // Semantic Branding's attributes, from the brand and the competitors chosen (asked once they are known, before the AIs step).
  async function suggestAttributes() {
    asked.current.add('attributes');
    mark('attributes', true);
    fail('attributes', '');
    try {
      const body = { step: 'attributes', sites: competitors.filter((item) => named(item.name)).map((item) => ({ name: item.name.trim(), domain: item.domains[0] ?? '' })) };
      // The generation fails now and then (on a preview, 3 of 7 asks answered nothing usable): asked again once before saying so.
      const data = await ask(body).catch(() => ask(body));
      setAttributes((list) => {
        const kept = list.filter((item) => !item.ai && (item.name.trim() || item.description.trim()));
        const taken = new Set(kept.map((item) => item.name.trim().toLowerCase()));
        const start = Math.max(0, SEMANTIC_START - kept.filter((item) => item.selected).length);
        const added = (data.attributes ?? []).filter((item) => !taken.has(item.name.toLowerCase())).slice(0, Math.max(0, ATTRIBUTE_MAX - kept.length));
        return [...kept, ...added.map((item, index) => ({ key: crypto.randomUUID(), name: item.name, description: item.description, selected: index < start, ai: true }))];
      });
    } catch (cause) {
      fail('attributes', reason(cause));
    } finally {
      mark('attributes', false);
    }
  }
  async function suggestComparison() {
    mark('comparison', true);
    fail('comparison', '');
    try {
      // Every competitor chosen: the products are compared with them.
      const data = await ask({ step: 'comparison', competitors: competitors.filter((item) => item.name.trim()).map((item) => item.name.trim()) });
      // The first products start selected, within the plan's room (Free: 3); every persona is selected; the person's own rows stay.
      if (data.comparison) setComparison(draftOf(data.comparison as ComparisonSuggestions, comparisonLimit, comparisonNow.current));
    } catch (cause) {
      fail('comparison', reason(cause));
    } finally {
      mark('comparison', false);
    }
  }
  // How many suggested prompts of each topic start selected: the old wizard's 10, within the room the plan has.
  const selectedPerTopic = Math.min(10, Math.floor(promptRoom / Math.max(1, topicNames.length)));
  // One call per topic, all at once: each topic's card fills as its own answer lands.
  function suggestPrompts(rows: TopicRow[]) {
    for (const topic of rows) {
      const name = topic.name.trim();
      const key = `prompts:${name}`;
      asked.current.add(key);
      mark(key, true);
      fail(key, '');
      ask({ step: 'prompts', topics: [{ name, keyword: topic.keyword ?? null, seed: topic.seed ?? null }] })
        .then((data) => {
          // The model's best come first: they start selected.
          const found = (data.prompts ?? []).map((item, order) => ({ id: crypto.randomUUID(), text: item.text, topic: name, selected: order < selectedPerTopic, ai: true }));
          setSuggestions((list) => [...list.filter((item) => !item.ai || item.topic !== name), ...found]);
        }, (cause) => fail(key, reason(cause)))
        .finally(() => mark(key, false));
    }
  }
  // The prompts of a topic the model suggested and selected are asked as soon as it lands, before the person reaches the step.
  const prefetch = (rows: TopicRow[]) => suggestPrompts(rows.filter((topic) => topic.ai && topic.selected && topic.name.trim() && !asked.current.has(`prompts:${topic.name.trim()}`)));
  const selectTopic = (index: number, selected: boolean) => {
    const row = topics[index];
    setTopics((list) => list.map((item, at) => (at === index ? { ...item, selected } : item)));
    if (row && selected) prefetch([{ ...row, selected }]);
  };
  // A step opens with suggestions: once, when it has nothing yet (going back and forth never asks again).
  function suggestOnOpen(target: StepId) {
    if (target === 'competitors') askFirst();
    // The attributes, once the competitors are known: ready by their step.
    if (target !== 'project' && target !== 'competitors' && semantic && !asked.current.has('attributes')) void suggestAttributes();
    if (target === 'comparison' && !comparison && !asked.current.has('comparison')) {
      asked.current.add('comparison');
      void suggestComparison();
    }
    if (target === 'prompts') suggestPrompts(chosenTopics.filter((topic) => !suggestions.some((item) => item.topic === topic.name.trim()) && !asked.current.has(`prompts:${topic.name.trim()}`)));
  }
  // Competitors and topics are asked for the brand, domain and market as they are: on a pause in the Project step (they are
  // usually on screen when the person gets there), again when one changes. A row the person edited is never replaced.
  const subject = named(brand) && domainOf(domain) ? JSON.stringify([brand.trim(), domainOf(domain), location, language]) : '';
  const askedFor = useRef('');
  const askFirst = () => {
    if (!subject || askedFor.current === subject) return;
    askedFor.current = subject;
    void suggestCompetitors();
    // The topics do not depend on the competitors: asked together, they are ready when the person gets there.
    if (!topics.some((topic) => topic.name.trim() && !topic.ai)) void suggestTopics();
  };
  const early = useRef(askFirst);
  useEffect(() => {
    early.current = askFirst;
  });
  useEffect(() => {
    if (step !== 0 || !subject) return;
    // ponytail: a fixed pause; a person still typing the domain may cost one ask for a domain that changes after it.
    const timer = setTimeout(() => early.current(), 1200);
    return () => clearTimeout(timer);
  }, [step, subject]);
  const next = () => {
    if (problem) return setAttempted(true);
    setAttempted(false);
    const target = Math.min(step + 1, steps.length - 1);
    setStep(target);
    suggestOnOpen(steps[target].id);
  };
  const back = () => {
    setAttempted(false);
    setStep((value) => Math.max(value - 1, 0));
  };
  async function create() {
    setSubmitting(true);
    setError('');
    try {
      const created = await requestJson<{ id: string }>('/api/onboarding', 'POST', {
        request_id: requestId.current,
        name: brand.trim(),
        project_name: projectName.trim() || null,
        domain: domain.trim(),
        aliases,
        location_code: location,
        language_code: language,
        interval_hours: Number(frequency),
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // The first domain is the main one; the rest are the competitor's other official domains.
        competitors: competitors.map((item) => ({
          name: item.name.trim(),
          domain: item.domains[0],
          ...(item.aliases.length ? { aliases: item.aliases.slice(0, 10) } : {}),
          ...(item.domains.length > 1 ? { domains: item.domains.slice(0, 11) } : {}),
        })),
        engines: chosenEngines,
        prompts: uniquePrompts.map((item) => ({ text: item.text, tag: item.topic })),
        semantic,
        ...(semantic ? { semantic_attributes: chosenAttributes.map((item) => ({ name: item.name.trim(), description: item.description.trim() })) } : {}),
        ...(comparisonConfig ? { comparison: comparisonConfig } : {}),
      });
      await onCreated(created.id);
    } catch (cause) {
      setError(reason(cause));
      setSubmitting(false);
    }
  }

  if (submitting)
    return (
      <div className="new-project-wizard">
        <EmptyState
          tone="progress"
          title={t(`Preparing the analysis for ${brand.trim()}…`, `Preparando a análise de ${brand.trim()}…`)}
          description={t('We are creating the project and sending the prompts to the AIs.', 'Estamos criando o projeto e enviando os prompts às IAs.')}
        />
      </div>
    );

  // An edited suggestion is the person's from then on: a new suggestion never replaces it.
  const competitorRow = (index: number, patch: Partial<Competitor>) => setCompetitors((list) => list.map((item, at) => (at === index ? { ...item, ...patch, ai: false } : item)));
  const failure = (key: string) => (failed[key] ? <Note tone="danger" className="px-0">{failed[key]}</Note> : null);
  const removeColumn = <T,>(name: (row: T, index: number) => string, remove: (index: number) => void): DataColumn<T> => removeCell(t('Remove', 'Remover'), name, remove);
  const showProblem = attempted && problem ? <Note tone="danger" className="px-0">{problem}</Note> : null;

  const body: Record<StepId, ReactNode> = {
    project: (
      <SectionCard inset="padded" className="pt-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${formId}-brand`}>{t('Brand analyzed', 'Marca analisada')}</FieldLabel>
            <Input id={`${formId}-brand`} maxLength={80} autoComplete="organization" placeholder={t('Brand name', 'Nome da marca')} value={brand} aria-invalid={attempted && !named(brand) ? true : undefined} onChange={(event) => setBrand(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-domain`}>{t('Domain', 'Domínio')}</FieldLabel>
            <Input id={`${formId}-domain`} maxLength={253} inputMode="url" autoComplete="url" placeholder={t('yourbrand.com', 'suamarca.com.br')} value={domain} aria-invalid={attempted && named(brand) && !domainOf(domain) ? true : undefined} onChange={(event) => setDomain(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-name`}>{t('Project name', 'Nome do projeto')}</FieldLabel>
            <Input id={`${formId}-name`} maxLength={80} placeholder={brand.trim() || t('Same as the brand', 'Igual à marca')} value={projectName} aria-invalid={attempted && projectName.trim().length === 1 ? true : undefined} onChange={(event) => setProjectName(event.target.value)} />
            <FieldDescription>{t('Optional. How the project appears in your list; the brand stays the one measured.', 'Opcional. Como o projeto aparece na sua lista; a marca medida continua a mesma.')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-interval`}>{t('Update frequency', 'Frequência de atualização')}</FieldLabel>
            <SelectField<'24' | '168'>
              id={`${formId}-interval`}
              className="w-full"
              value={frequency}
              onValueChange={setFrequency}
              options={[
                { value: '24', label: free ? t('Daily (unavailable on your plan)', 'Diária (indisponível no seu plano)') : t('Daily', 'Diária'), disabled: free },
                { value: '168', label: t('Weekly', 'Semanal') },
              ]}
            />
            <FieldDescription>
              {t('The first collection starts when the project is created; then it follows this frequency, on the day and time set in Settings > Monitoring.', 'A primeira coleta começa ao criar o projeto; depois segue esta frequência, no dia e horário de Configurações > Monitoramento.')}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-market`}>{t('Market', 'Mercado')}</FieldLabel>
            <CountrySelect
              value={location}
              onValueChange={(code) => {
                setLocation(code);
                setLanguage(countryLanguage(code));
              }}
              engines={allowed}
              locale={locale}
              t={t}
            />
            <EngineAvailability engines={allowed} location={location} locale={locale} t={t} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${formId}-language`}>{t('Language', 'Idioma')}</FieldLabel>
            <SelectField<'en' | 'pt'>
              id={`${formId}-language`}
              value={language}
              onValueChange={setLanguage}
              options={[
                { value: 'en', label: 'English' },
                { value: 'pt', label: 'Português' },
              ]}
            />
            <FieldDescription>{t('Of the prompts and answers: English or Portuguese, set by the market.', 'Dos prompts e respostas: inglês ou português, definido pelo mercado.')}</FieldDescription>
          </Field>
          <FieldLabel htmlFor={`${formId}-semantic`} className="sm:col-span-2">
            <Field orientation="horizontal">
              <Checkbox id={`${formId}-semantic`} checked={semantic} onCheckedChange={(checked) => setSemantic(checked === true)} />
              <FieldContent>
                <FieldTitle>{t('Set up Semantic Branding with the project', 'Configurar o Semantic Branding com o projeto')}</FieldTitle>
                <FieldDescription>
                  {t(
                    'Recommended. The AIs score your brand and its competitors on the attributes you review in its step; its first collection starts with the project. Unselect to set it up later in Settings.',
                    'Recomendado. As IAs dão nota à sua marca e aos concorrentes nos atributos que você revisa na etapa dele; a primeira coleta começa com o projeto. Desmarque para configurar depois em Configurações.',
                  )}
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
          <Collapsible className="sm:col-span-2">
            <CollapsibleTrigger render={<Button variant="ghost" className="new-project-advanced text-muted-foreground" />}>
              <ChevronRight aria-hidden="true" />
              {t('Advanced settings', 'Configurações avançadas')}
              {aliases.length > 0 && <TagBadge tone="quiet">{aliases.length}</TagBadge>}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Field className="pt-3">
                <FieldLabel htmlFor={`${formId}-aliases`}>{t('Brand aliases', 'Apelidos da marca')}</FieldLabel>
                <TagInput id={`${formId}-aliases`} placeholder={t('Another brand name, then Enter or a comma', 'Outro nome da marca, depois Enter ou vírgula')} value={aliases} onChange={setAliases} normalize={aliasOf} removeLabel={(tag) => t(`Remove ${tag}`, `Remover ${tag}`)} />
                <FieldDescription>{t('Optional. Variations and abbreviations that also name your brand (improves recognition).', 'Opcional. Variações e abreviações que também representam a sua marca (melhora o reconhecimento).')}</FieldDescription>
              </Field>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </SectionCard>
    ),
    competitors: (
      <>
        <SectionCard
          title={t('Competitors to compare', 'Concorrentes para comparar')}
          description={busy['competitors:web'] && competitors.length ? <LiveLabel>{t('Confirming with a web search…', 'Confirmando com uma busca na web…')}</LiveLabel> : undefined}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-caption text-muted-foreground tabular-nums">{t(`${competitors.length} of ${MAX_COMPETITORS}`, `${competitors.length} de ${MAX_COMPETITORS}`)}</span>
              <Button variant="outline" pending={!!busy['competitors:web']} onClick={() => void suggestCompetitors()}>{t('Suggest competitors', 'Sugerir concorrentes')}</Button>
              <Button variant="outline" disabled={competitors.length >= MAX_COMPETITORS} onClick={() => setCompetitors((list) => [...list, { key: crypto.randomUUID(), name: '', domains: [], aliases: [] }])}>
                {t('Add competitor', 'Adicionar concorrente')}
              </Button>
            </div>
          }
        >
          {competitors.length || busy.competitors ? (
            <DataTable
              singleLine="wide"
              minWidth={0}
              loading={busy.competitors && !competitors.length ? LOADING_ROWS : undefined}
              ariaLabel={t('Competitors', 'Concorrentes')}
              rows={competitors}
              rowKey={(row) => row.key}
              columns={[
                {
                  key: 'name',
                  header: t('Competitor', 'Concorrente'),
                  mobile: 'title',
                  cell: (row, index) => (
                    <label htmlFor={`${formId}-competitor-${row.key}`}>
                      <SiteFavicon domain={row.domains[0] ?? ''} name={row.name || '?'} />
                      <Textarea {...oneLine} id={`${formId}-competitor-${row.key}`} aria-label={t(`Competitor ${index + 1}`, `Concorrente ${index + 1}`)} placeholder={t(`Competitor ${index + 1}`, `Concorrente ${index + 1}`)} maxLength={80} value={row.name} aria-invalid={attempted && !named(row.name) ? true : undefined} onChange={(event) => competitorRow(index, { name: line(event.target.value) })} />
                    </label>
                  ),
                },
                {
                  key: 'domains', mobile: 'wide',
                  header: t('Domains', 'Domínios'),
                  label: t('Domains', 'Domínios'),
                  cell: (row, index) => (
                    <TagInput
                      variant="cell"
                      spaces
                      inputMode="url"
                      aria-label={t(`Domains of competitor ${index + 1}, the main one first`, `Domínios do concorrente ${index + 1}, o principal primeiro`)}
                      placeholder={t('competitor.com', 'concorrente.com.br')}
                      value={row.domains}
                      normalize={domainOf}
                      aria-invalid={attempted && !row.domains.length ? true : undefined}
                      removeLabel={(tag) => t(`Remove ${tag}`, `Remover ${tag}`)}
                      onChange={(domains) => competitorRow(index, { domains })}
                    />
                  ),
                },
                {
                  key: 'aliases', mobile: 'wide',
                  header: t('Aliases', 'Apelidos'),
                  label: t('Aliases', 'Apelidos'),
                  cell: (row, index) => (
                    <TagInput
                      variant="cell"
                      aria-label={t(`Aliases of competitor ${index + 1}`, `Apelidos do concorrente ${index + 1}`)}
                      placeholder={t('None', 'Nenhum')}
                      value={row.aliases}
                      normalize={aliasOf}
                      removeLabel={(tag) => t(`Remove ${tag}`, `Remover ${tag}`)}
                      onChange={(aliases) => competitorRow(index, { aliases })}
                    />
                  ),
                },
                removeColumn<Competitor>((row, index) => t(`Remove competitor ${row.name || index + 1}`, `Remover concorrente ${row.name || index + 1}`), (index) => setCompetitors((list) => list.filter((_, at) => at !== index))),
              ]}
            />
          ) : (
            <EmptyState
              frame="bare"
              title={t('No competitors yet.', 'Nenhum concorrente ainda.')}
              description={t('Use “Suggest competitors” or add the ones you want to compare, now or later in Settings. Lastfind also suggests the brands it finds in the answers.', 'Use “Sugerir concorrentes” ou adicione os que quer comparar, agora ou depois em Configurações. O Lastfind também sugere as marcas que encontra nas respostas.')}
            />
          )}
        </SectionCard>
        {failure('competitors')}
      </>
    ),
    topics: (
      <>
        <SectionCard
          title={t('Project topics', 'Tópicos do projeto')}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" pending={!!busy.topics} onClick={() => void suggestTopics()}>{t('Suggest topics', 'Sugerir tópicos')}</Button>
              <Button variant="outline" disabled={topics.length >= 10} onClick={() => setTopics((list) => [...list, { key: crypto.randomUUID(), name: '', selected: false }])}>
                {t('Add topic', 'Adicionar tópico')}
              </Button>
            </div>
          }
        >
          <DataTable
            singleLine="wide"
            minWidth={0}
            loading={busy.topics && !topics.some((topic) => topic.name.trim()) ? LOADING_ROWS : undefined}
            ariaLabel={t('Topics', 'Tópicos')}
            rows={topics}
            rowKey={(row) => row.key}
            columns={[
              selectColumn<TopicRow>(<span className="sr-only">{t('Selected', 'Selecionado')}</span>, (row, index) => (
                <Checkbox
                  aria-label={t(`Select topic ${row.name || index + 1}`, `Selecionar tópico ${row.name || index + 1}`)}
                  checked={row.selected}
                  onCheckedChange={(checked) => {
                    if (checked && chosenTopics.length >= 1 && !row.selected) return setManyTopics(index);
                    selectTopic(index, checked);
                  }}
                />
              )),
              {
                key: 'topic',
                header: t('Topic', 'Tópico'),
                mobile: 'title',
                cell: (row, index) => (
                  <Textarea {...oneLine} aria-label={t(`Topic ${index + 1}`, `Tópico ${index + 1}`)} placeholder={t(`Topic ${index + 1}, e.g. ${exampleTopic(language)}`, `Tópico ${index + 1}, ex.: ${exampleTopic(language)}`)} maxLength={40} value={row.name} aria-invalid={attempted && row.selected && !row.name.trim() ? true : undefined} onChange={(event) => setTopics((list) => list.map((item, at) => (at === index ? { ...item, name: line(event.target.value), keyword: null, seed: null, ai: false } : item)))} />
                ),
              },
              removeColumn<TopicRow>((row, index) => t(`Remove topic ${row.name || index + 1}`, `Remover tópico ${row.name || index + 1}`), (index) => setTopics((list) => list.filter((_, at) => at !== index))),
            ]}
          />
        </SectionCard>
        {failure('topics')}
        <Note className="px-0 py-0">
          {t(
            `Write the topics in ${languageName(language, 'en')}, the project’s language: its prompts and answers are in it.`,
            `Escreva os tópicos em ${languageName(language, 'pt-BR')}, o idioma do projeto: os prompts e as respostas são nele.`,
          )}
        </Note>
        <ConfirmDialog
          open={manyTopics !== null}
          onOpenChange={(open) => { if (!open) setManyTopics(null); }}
          title={t('Configure more than one topic?', 'Configurar mais de um tópico?')}
          description={t('In the wizard, we recommend selecting only one topic. If you keep more than one, prompts are suggested for each topic.', 'No wizard, recomendamos selecionar apenas um tópico. Se mantiver mais de um, os prompts são sugeridos para cada tópico.')}
          cancelLabel={t('Keep only one topic', 'Ficar com apenas um tópico')}
          confirmLabel={t('Configure multiple topics', 'Configurar múltiplos tópicos')}
          onConfirm={() => {
            const index = manyTopics;
            setManyTopics(null);
            if (index !== null) selectTopic(index, true);
          }}
        />
      </>
    ),
    prompts: (
      <>
        {chosenTopics.map((topic) => {
          const name = topic.name.trim();
          const key = `prompts:${name}`;
          const rows = suggested.filter((item) => item.topic === name);
          const change = (rowId: string, patch: Partial<PromptRow>) => setSuggestions((list) => list.map((item) => (item.id === rowId ? { ...item, ...patch } : item)));
          const chosen = rows.filter((item) => item.selected);
          return (
            <div key={topic.key} className="grid gap-3">
              <SectionCard
                title={name}
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" pending={!!busy[key]} onClick={() => suggestPrompts([topic])}>{t('Suggest prompts', 'Sugerir prompts')}</Button>
                    <Button variant="outline" onClick={() => setSuggestions((list) => [...list, { id: crypto.randomUUID(), text: '', topic: name, selected: true }])}>{t('Add prompt', 'Adicionar prompt')}</Button>
                  </div>
                }
              >
                {rows.length || busy[key] ? (
                  <DataTable
                    singleLine="wide"
                    minWidth={0}
                    loading={busy[key] && !rows.length ? LOADING_ROWS : undefined}
                    ariaLabel={t(`Prompts of ${name}`, `Prompts de ${name}`)}
                    rows={rows}
                    rowKey={(row) => row.id}
                    columns={[
                      selectColumn<PromptRow>(
                        <Checkbox
                          aria-label={t(`Select all prompts of ${name}`, `Selecionar todos os prompts de ${name}`)}
                          checked={rows.length > 0 && chosen.length === rows.length}
                          indeterminate={chosen.length > 0 && chosen.length < rows.length}
                          onCheckedChange={(checked) => setSuggestions((list) => list.map((item) => (item.topic === name ? { ...item, selected: checked } : item)))}
                        />,
                        (row) => <Checkbox aria-label={t(`Select: ${row.text || 'new prompt'}`, `Selecionar: ${row.text || 'novo prompt'}`)} checked={row.selected} onCheckedChange={(checked) => change(row.id, { selected: checked })} />,
                      ),
                      {
                        key: 'prompt',
                        header: t('Prompt', 'Prompt'),
                        mobile: 'title',
                        cell: (row, index) => (
                          <Textarea variant="cell" rows={1} aria-label={t(`Prompt ${index + 1} of ${name}`, `Prompt ${index + 1} de ${name}`)} placeholder={t('Write a prompt', 'Escreva um prompt')} maxLength={1000} value={row.text} onChange={(event) => change(row.id, { text: event.target.value, ai: false })} />
                        ),
                      },
                      removeColumn<PromptRow>((_, index) => t(`Remove prompt ${index + 1} of ${name}`, `Remover prompt ${index + 1} de ${name}`), (index) => {
                        const removed = rows[index]?.id;
                        setSuggestions((list) => list.filter((item) => item.id !== removed));
                      }),
                    ]}
                  />
                ) : (
                  <EmptyState frame="bare" title={t('No prompts yet.', 'Nenhum prompt ainda.')} description={t('Use “Suggest prompts” to generate them from the brand and the topic, or add one.', 'Use “Sugerir prompts” para gerar a partir da marca e do tópico, ou adicione um.')} />
                )}
              </SectionCard>
              {failure(key)}
            </div>
          );
        })}
      </>
    ),
    engines: (
      <>
        <SectionCard inset="padded" title={t('AIs', 'IAs')} description={t('The AIs asked each prompt. Each one is one more collection of every prompt.', 'As IAs perguntadas em cada prompt. Cada uma é mais uma coleta de cada prompt.')}>
          <div className="grid gap-3">
            {allowed.map((engine) => {
              const off = !available.includes(engine);
              return (
                <FieldLabel key={engine} htmlFor={`${formId}-${engine}`}>
                  <Field orientation="horizontal" data-disabled={off || undefined}>
                    <Checkbox
                      id={`${formId}-${engine}`}
                      disabled={off}
                      checked={chosenEngines.includes(engine)}
                      onCheckedChange={(checked) => setEngines((list) => (checked ? [...new Set([...list, engine])] : list.filter((item) => item !== engine)))}
                    />
                    <FieldContent>
                      <FieldTitle><ModelMark model={engine} /></FieldTitle>
                      {off && <FieldDescription>{t(`Not available in ${countryName(location, locale)}.`, `Indisponível em ${countryName(location, locale)}.`)}</FieldDescription>}
                    </FieldContent>
                  </Field>
                </FieldLabel>
              );
            })}
          </div>
        </SectionCard>
      </>
    ),
    semantic: (
      <>
        <SemanticAttributesCard rows={attributes} onChange={setAttributes} onSuggest={() => void suggestAttributes()} suggesting={!!busy.attributes} brands={brandNames} showIssues={attempted} t={t} />
        {failure('attributes')}
      </>
    ),
    comparison: (
      <WizardComparisonStep
        draft={comparison}
        onChange={setComparison}
        onSuggest={() => void suggestComparison()}
        limit={comparisonLimit}
        loading={!!busy.comparison}
        failure={failure('comparison')}
        noCompetitors={!competitors.length}
        attempted={attempted}
        t={t}
      />
    ),
    review: (
      <SectionCard inset="padded" title={t('Review', 'Revisão')}>
        <dl className="new-project-review">
          {([
            [t('Brand', 'Marca'), brand.trim()],
            [t('Project name', 'Nome do projeto'), projectName.trim() || brand.trim()],
            [t('Domain', 'Domínio'), domainOf(domain) ?? domain],
            [t('Market', 'Mercado'), countryName(location, locale)],
            [t('Language', 'Idioma'), language === 'pt' ? 'Português' : 'English'],
            [t('Update frequency', 'Frequência de atualização'), frequency === '24' ? t('Daily', 'Diária') : t('Weekly', 'Semanal')],
            [t('Topics', 'Tópicos'), String(chosenTopics.length)],
            [t('Prompts', 'Prompts'), String(uniquePrompts.length)],
            [t('Competitors', 'Concorrentes'), String(competitors.length)],
            ['Semantic Branding', semantic ? t(`${chosenAttributes.length} attributes`, `${chosenAttributes.length} atributos`) : t('Set up later', 'Configurar depois')],
            [t('Comparison', 'Comparação'), comparisonConfig ? t(`${comparisonConfig.products.length} products, ${comparisonConfig.personas.length} personas`, `${comparisonConfig.products.length} produtos, ${comparisonConfig.personas.length} personas`) : t('Set up later', 'Configurar depois')],
          ] as const).map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {competitors.length > 0 && (
          <div className="new-project-group">
            <span>{t('Competitors', 'Concorrentes')}</span>
            <div>{competitors.map((item) => <TagBadge key={item.key}>{item.name.trim()}</TagBadge>)}</div>
          </div>
        )}
        <div className="new-project-group">
          <span>{t('AIs', 'IAs')}</span>
          <div>{chosenEngines.map((engine) => <TagBadge key={engine} tone="outline"><ModelMark model={engine} /></TagBadge>)}</div>
        </div>
        {workspace.capacity.projectsFull && (
          <Note tone="danger" className="mt-4 px-0">
            {t('Your plan has no room for another project. Archive or delete one in Settings to start this one.', 'Seu plano não tem espaço para outro projeto. Arquive ou exclua um em Configurações para começar este.')}
          </Note>
        )}
      </SectionCard>
    ),
  };

  const descriptions: Partial<Record<StepId, [string, string]>> = {
    competitors: ['The brands compared with yours in every answer: up to 10, each with its domain. Click a cell to edit it.', 'As marcas comparadas com a sua em cada resposta: até 10, cada uma com o seu domínio. Clique numa célula para editar.'],
    topics: ['Select the main topic for this project. The wizard recommends one topic; if you choose more than one, prompts are suggested per topic.', 'Selecione o tópico principal do projeto. O wizard recomenda um tópico; se escolher mais de um, os prompts são sugeridos por tópico.'],
    prompts: ['Choose and edit the prompts that will be created in the project. Click a prompt to edit it.', 'Escolha e edite os prompts que serão criados no projeto. Clique num prompt para editar.'],
    semantic: ['The attributes the AIs score your brand and each competitor on: 3 to 10, each with a neutral definition. Click a cell to edit it. Skip it to set it up later.', 'Os atributos em que as IAs dão nota à sua marca e a cada concorrente: de 3 a 10, cada um com uma definição neutra. Clique numa célula para editar. Pule para configurar depois.'],
    comparison: ['Optional. The products you sell, the attributes buyers compare and who buys: the AIs score your brand and each competitor on them. Click a cell to edit it. Skip it to set it up later.', 'Opcional. Os produtos que você vende, os atributos que os compradores comparam e quem compra: as IAs dão nota à sua marca e a cada concorrente neles. Clique numa célula para editar. Pule para configurar depois.'],
  };

  return (
    <div className="new-project-wizard">
      {id === 'project' ? (
        <PageHeading
          title={t('Configure your project in under 2 minutes', 'Configure seu projeto em menos de 2 minutos')}
          description={t('Enter the brand and domain, then the competitors, topics, prompts and AIs to measure your visibility in AI answers.', 'Informe marca e domínio, depois os concorrentes, tópicos, prompts e IAs para medir sua visibilidade nas respostas das IAs.')}
        />
      ) : (
        <>
          <p className="text-body text-muted-foreground">
            {t('Configure brand, competitors, topics, prompts and AIs to measure your generative visibility.', 'Configure marca, concorrentes, tópicos, prompts e IAs para medir sua visibilidade generativa.')}
          </p>
          <WizardSteps variant="progress" steps={steps.map((_, index) => label(index))} current={step} label={t('Steps', 'Passos')} />
          {id !== 'engines' && id !== 'review' && (
            <PageHeading
              title={label(step)}
              description={descriptions[id] ? t(...descriptions[id]!) : undefined}
              actions={id === 'prompts' ? <TagBadge tone={uniquePrompts.length > promptRoom ? 'danger' : 'quiet'}>{t(`${uniquePrompts.length} of ${promptRoom}`, `${uniquePrompts.length} de ${promptRoom}`)}</TagBadge> : undefined}
            />
          )}
          {(id === 'engines' || id === 'review') && <h1 className="sr-only">{label(step)}</h1>}
        </>
      )}
      {body[id]}
      {showProblem}
      {error && <Note tone="danger" className="px-0">{t('Could not create the project.', 'Não foi possível criar o projeto.')} {error}</Note>}
      <div className="new-project-nav">
        <Button variant="ghost" disabled={step === 0} onClick={back}>{t('Back', 'Voltar')}</Button>
        {id === 'review' ? (
          <Button disabled={workspace.capacity.projectsFull} onClick={() => void create()}>{t('Create project', 'Criar projeto')}</Button>
        ) : (
          <span className="flex items-center gap-2">
            {(id === 'comparison' || id === 'semantic') && (
              <Button
                variant="outline"
                onClick={() => {
                  setAttempted(false);
                  // Skipping Semantic Branding leaves it for later: its step leaves the list, and the next one takes its place.
                  if (id === 'semantic') {
                    setSemantic(false);
                    return suggestOnOpen(steps[step + 1].id);
                  }
                  // Skipping sends no Comparison: nothing stays selected (the rows stay, to pick again on the way back).
                  setComparison((draft) => draft && { ...draft, products: draft.products.map((item) => ({ ...item, selected: false })), personas: draft.personas.map((item) => ({ ...item, selected: false })) });
                  setStep((value) => Math.min(value + 1, steps.length - 1));
                }}
              >
                {t('Skip', 'Pular')}
              </Button>
            )}
            <Button onClick={next}>{t('Next', 'Avançar')}</Button>
          </span>
        )}
      </div>
    </div>
  );
}
