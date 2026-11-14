import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion';

import { cn } from '@/lib/utils';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

// variant="rows": each item a rounded bordered row with its own inset, never tinted (Semantic Branding justifications); the open
// item's content sits under a divider. The project's own brand is told by a label in its trigger, not by a colour.
function Accordion({ className, variant = 'default', ...props }: AccordionPrimitive.Root.Props & { variant?: 'default' | 'rows' }) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      data-variant={variant}
      className={cn('group/accordion flex w-full flex-col data-[variant=rows]:gap-2', className)}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn(
        'not-last:border-b group-data-[variant=rows]/accordion:rounded-lg group-data-[variant=rows]/accordion:border',
        className,
      )}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          '**:data-[slot=accordion-trigger-icon]:text-muted-foreground rounded-lg py-2.5 text-left text-sm font-medium hover:underline **:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 group/accordion-trigger relative flex flex-1 items-start justify-between border border-transparent transition-all aria-disabled:pointer-events-none aria-disabled:opacity-50 group-data-[variant=rows]/accordion:min-h-12 group-data-[variant=rows]/accordion:cursor-pointer group-data-[variant=rows]/accordion:items-center group-data-[variant=rows]/accordion:gap-3 group-data-[variant=rows]/accordion:px-4 group-data-[variant=rows]/accordion:hover:no-underline',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          data-slot="accordion-trigger-icon"
          className="pointer-events-none shrink-0 group-aria-expanded/accordion-trigger:hidden"
        />
        <ChevronUpIcon
          data-slot="accordion-trigger-icon"
          className="pointer-events-none hidden shrink-0 group-aria-expanded/accordion-trigger:inline"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="data-open:animate-accordion-down data-closed:animate-accordion-up text-sm overflow-hidden"
      {...props}
    >
      <div
        className={cn(
          'pt-0 pb-2.5 h-(--accordion-panel-height) data-ending-style:h-0 data-starting-style:h-0 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4 group-data-[variant=rows]/accordion:px-4 group-data-[variant=rows]/accordion:border-t group-data-[variant=rows]/accordion:pt-4 group-data-[variant=rows]/accordion:pb-4 group-data-[variant=rows]/accordion:[&_a]:no-underline',
          className,
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
