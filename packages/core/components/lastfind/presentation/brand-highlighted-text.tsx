'use client';
import { useI18n } from '@/lib/i18n';

// Highlights brand/alias mentions inside an evidence answer's raw text.
// Extracted from workspace-app.tsx; used by the response evidence sheet.
export function BrandHighlightedText({
  text,
  names,
}: {
  text: string;
  names: string[];
}) {
  const { t } = useI18n();
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!unique.length) return <>{text}</>;
  // \p{M} (combining marks) must join \p{L}/\p{N} in both boundary classes:
  // otherwise a decomposed grapheme (base letter + combining accent) reads
  // its own accent as a "boundary", letting the bare base letters match as
  // a whole word and highlighting only part of the grapheme.
  const expression = new RegExp(
    `(?<![\\p{L}\\p{N}\\p{M}])(${unique
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})(?![\\p{L}\\p{N}\\p{M}])`,
    'giu',
  );
  return (
    <>
      {text.split(expression).map((part, index) =>
        unique.some(
          (name) => name.localeCompare(part, undefined, { sensitivity: 'accent' }) === 0,
        ) ? (
          <mark
            className="brand-inline-highlight"
            key={`${part}-${index}`}
            aria-label={t('Marca mencionada: {name}', { name: part })}
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
