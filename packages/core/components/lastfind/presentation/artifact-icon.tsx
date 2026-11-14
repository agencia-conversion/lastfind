import { useId } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * The kinds an artifact can be (lib/agent.ts ARTIFACT_KINDS), each with its own colour token (tokens.css `--artifact-*`),
 * and a skill (Agent > Skills), drawn in the same family: one icon for every skill.
 */
type Kind = 'document' | 'report' | 'table' | 'brief' | 'content' | 'skill';

const artifactIconVariants = cva('inline-block shrink-0 align-middle', {
  variants: {
    // 16px in a list row or a chip, 20px in a card or a header, 32px in a large tile.
    size: { sm: 'size-4', default: 'size-5', lg: 'size-8' },
  },
  defaultVariants: { size: 'default' },
});

// The glyph on the page, in white: a document's heading over its paragraph, a content's lines of text, a report's bars, a table's cells, a brief's checklist, a skill's bolt.
const GLYPHS: Record<Kind, React.ReactNode> = {
  document: (
    <>
      <rect x="6" y="8.2" width="5" height="1.8" rx="0.9" />
      <rect x="6" y="11.3" width="8" height="1.1" rx="0.55" opacity="0.85" />
      <rect x="6" y="13.4" width="8" height="1.1" rx="0.55" opacity="0.85" />
      <rect x="6" y="15.5" width="5.5" height="1.1" rx="0.55" opacity="0.85" />
    </>
  ),
  content: (
    <>
      <rect x="6" y="8.5" width="8" height="1.3" rx="0.65" />
      <rect x="6" y="11" width="8" height="1.3" rx="0.65" />
      <rect x="6" y="13.5" width="5" height="1.3" rx="0.65" />
    </>
  ),
  report: (
    <>
      <rect x="6.3" y="12.3" width="1.9" height="3.4" rx="0.5" />
      <rect x="9.05" y="10.3" width="1.9" height="5.4" rx="0.5" />
      <rect x="11.8" y="8.3" width="1.9" height="7.4" rx="0.5" />
    </>
  ),
  table: (
    <>
      <rect x="6" y="8.5" width="3.6" height="1.9" rx="0.4" />
      <rect x="10.4" y="8.5" width="3.6" height="1.9" rx="0.4" />
      <rect x="6" y="11.1" width="3.6" height="1.9" rx="0.4" opacity="0.8" />
      <rect x="10.4" y="11.1" width="3.6" height="1.9" rx="0.4" opacity="0.8" />
      <rect x="6" y="13.7" width="3.6" height="1.9" rx="0.4" opacity="0.8" />
      <rect x="10.4" y="13.7" width="3.6" height="1.9" rx="0.4" opacity="0.8" />
    </>
  ),
  skill: <path d="M10.9 7.6 6.9 12.6h2.7l-.6 3.8 4.1-5h-2.7Z" />,
  brief: (
    <>
      <circle cx="6.9" cy="9.15" r="0.9" />
      <rect x="8.6" y="8.5" width="5.4" height="1.3" rx="0.65" />
      <circle cx="6.9" cy="11.65" r="0.9" />
      <rect x="8.6" y="11" width="5.4" height="1.3" rx="0.65" />
      <circle cx="6.9" cy="14.15" r="0.9" />
      <rect x="8.6" y="13.5" width="3.6" height="1.3" rx="0.65" />
    </>
  ),
};

/**
 * An artifact's type as a document icon in the system's style (iOS, macOS): a page with a folded corner in its type's colour,
 * lit from the top, and a white glyph. Readable at 16px, in light and dark (each `--artifact-*` token has its dark pair).
 * Decorative beside the name; give `label` when it stands alone.
 */
function ArtifactIcon({ kind, size, label, className }: { kind: Kind; label?: string; className?: string } & VariantProps<typeof artifactIconVariants>) {
  const id = useId();
  const color = `var(--artifact-${kind})`;
  return (
    <svg
      data-slot="artifact-icon"
      data-kind={kind}
      viewBox="0 0 20 20"
      className={cn(artifactIconVariants({ size }), className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-page`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: `color-mix(in oklab, ${color}, white 18%)` }} />
          <stop offset="1" style={{ stopColor: `color-mix(in oklab, ${color}, black 14%)` }} />
        </linearGradient>
      </defs>
      {/* The page, its edge a shade darker so it keeps its shape on a tint of its own colour. */}
      <path
        d="M5.5 1.5H12l4.5 4.5v10.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"
        fill={`url(#${id}-page)`}
        style={{ stroke: `color-mix(in oklab, ${color}, black 22%)` }}
        strokeWidth="0.5"
      />
      {/* The folded corner, lighter, as a sheet turned over. */}
      <path d="M12 1.5v3a1.5 1.5 0 0 0 1.5 1.5h3Z" fill="white" fillOpacity="0.5" />
      <g fill="white">{GLYPHS[kind]}</g>
    </svg>
  );
}

export { ArtifactIcon, artifactIconVariants };
