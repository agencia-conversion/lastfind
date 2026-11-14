'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import './wizard-steps.css';

/**
 * The only step indicator of a wizard (docs/design/shell.md section 12). `inline`: numbered names in one wrapping row (the
 * Brain's and Contents' wizards). `progress`: the New project wizard's bar with a numbered circle per step, done ones with
 * a check, each name under its own step; when a name does not fit its step's column (a phone, many steps) only the current one
 * shows, still under its own step (the others stay for screen readers).
 */
export function WizardSteps({
  steps,
  current,
  label,
  variant = 'inline',
  className,
}: {
  steps: string[];
  /** Index of the current step. */
  current: number;
  /** The list's accessible name ("Steps"). */
  label: string;
  variant?: 'inline' | 'progress';
  className?: string;
}) {
  const state = (index: number) => (index === current ? 'current' : index < current ? 'done' : undefined);
  const track = useRef<HTMLOListElement>(null);
  const [fits, setFits] = useState(true);
  const names = steps.join('\n');
  useLayoutEffect(() => {
    const element = track.current;
    if (variant !== 'progress' || !element) return;
    // A name's own width (scrollWidth, also while hidden) against its step's column: the same answer in both modes, so it never flips.
    const measure = () => setFits([...element.querySelectorAll<HTMLElement>('.wizard-step-name')].every((name) => name.scrollWidth <= name.parentElement!.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [variant, names]);
  const list = (
    <ol ref={track} data-fit={variant === 'progress' && !fits ? 'current' : undefined} className={variant === 'progress' ? 'wizard-steps-track' : cn('wizard-steps', className)} aria-label={label}>
      {steps.map((name, index) => (
        <li key={name} data-state={state(index)} aria-current={index === current ? 'step' : undefined}>
          <span className="wizard-step-number">
            {variant === 'progress' && index < current ? <Check aria-hidden="true" /> : index + 1}
          </span>
          <span className="wizard-step-name">{name}</span>
        </li>
      ))}
    </ol>
  );
  if (variant === 'inline') return list;
  return (
    <div className={cn('wizard-steps-progress', className)}>
      <Progress value={steps.length > 1 ? (current / (steps.length - 1)) * 100 : 100} aria-label={label} />
      {list}
    </div>
  );
}
