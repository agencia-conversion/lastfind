'use client';
// A step of the agent in detail (both editions): opened from its line in the trace, over the chat, which keeps answering
// behind it. A dialog, not a page: it inspects one step of a conversation still under way and closes back to it (Esc
// returns the focus to the step). What it shows comes from lib/agent-steps.ts. Only catalog components.
import { ExternalLink } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { TOOL_LABELS, type ToolStep } from '@/lib/agent';
import { stepDetail, stepSummary } from '@/lib/agent-steps';
import { skillTitle } from '@/lib/agent-learning';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item';

type T = (en: string, pt: string) => string;

/**
 * The step's name as the trace says it (a skill by its name): the gerund while it runs ("Searching the web"), the past
 * once done ("Searched the web"); a failed or declined change by the action the person was asked to approve.
 */
export function stepLabel(step: ToolStep, locale: string) {
  const pt = locale === 'pt-BR';
  const done = step.state === 'done';
  // The skill it activated, by name.
  if (step.skill) {
    const name = skillTitle(step.skill, pt);
    return pt ? `${done ? 'Usou' : 'Usando'} a skill: ${name}` : `${done ? 'Used' : 'Using'} the skill: ${name}`;
  }
  const copy = TOOL_LABELS[step.name];
  if (!copy) return step.name;
  const words = done ? copy.done : step.state === 'running' ? copy.running : (copy.action ?? copy.running);
  return pt ? words[1] : words[0];
}

export function AgentStepDetail({ step, onClose, t }: { step: ToolStep | null; onClose: () => void; t: T }) {
  const { locale } = useI18n();
  const detail = step && stepDetail(step, t, locale);
  const summary = step && stepSummary(step, t, locale);
  return (
    <Dialog open={!!step} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="agent-step-detail">
        <DialogHeader>
          <DialogTitle>{step ? stepLabel(step, locale) : ''}</DialogTitle>
          <DialogDescription>{summary || (step?.state === 'running' ? t('Still running.', 'Ainda em andamento.') : t('Nothing more to show for this step.', 'Nada mais a mostrar deste passo.'))}</DialogDescription>
        </DialogHeader>
        {detail && (
          <div className="agent-step-detail-body">
            {detail.facts.length > 0 && (
              <dl className="agent-step-facts">
                {detail.facts.map((fact) => (
                  <div key={fact.label}>
                    <dt className="text-caption text-muted-foreground">{fact.label}</dt>
                    <dd className="text-body">
                      {fact.href ? (
                        <a href={fact.href} target="_blank" rel="noopener noreferrer">
                          {fact.value}
                        </a>
                      ) : (
                        fact.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {detail.lists.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3 className="text-caption text-muted-foreground">{group.title}</h3>
                <ItemGroup>
                  {group.items.map((item, index) => (
                    <Item key={`${index}-${item.text}`} size="sm" render={item.href ? <a href={item.href} target="_blank" rel="noopener noreferrer" aria-label={item.text} /> : undefined}>
                      <ItemContent>
                        <ItemTitle className="agent-step-item">{item.text}</ItemTitle>
                      </ItemContent>
                      {item.href && <ExternalLink aria-hidden="true" className="size-4 text-muted-foreground" />}
                    </Item>
                  ))}
                </ItemGroup>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
