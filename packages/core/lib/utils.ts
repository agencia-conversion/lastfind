import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The app's type scale (tokens.css) is font sizes: without this, `text-body` beside a colour (`text-primary-foreground`)
// reads as two colours and the size is dropped.
const twMerge = extendTailwindMerge({ extend: { theme: { text: ['caption', 'menu', 'body', 'section', 'title', 'metric'] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
