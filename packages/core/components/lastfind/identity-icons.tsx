'use client';
import Image from 'next/image';
import { useState } from 'react';
import { Globe } from 'lucide-react';
import { ENGINE_META, ENGINE_LABELS, isEngine } from '@/lib/engines';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { Hint } from '@/components/ui/tooltip';
export function EngineIcon({
  engine,
  size = 18,
}: {
  engine: string;
  size?: number;
}) {
  if (!isEngine(engine)) return <Globe size={size} aria-hidden="true" />;
  return (
    <Image
      unoptimized
      src={`/icons/ai/${ENGINE_META[engine].icon}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="ai-icon"
    />
  );
}

/** Horizontal avatar stack for table cells: icons overlap; leftover becomes +N. */
export function CompactEngineIcons({
  engines,
  max = 6,
  size = 16,
}: {
  engines: string[];
  max?: number;
  size?: number;
}) {
  const list = engines.length ? engines : [];
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  const labels = list.map((engine) => (isEngine(engine) ? ENGINE_LABELS[engine] : engine));
  return (
    <Hint text={labels.join(', ')}>
    <div className="live-model-icons live-model-icons-compact">
      {shown.map((engine) => {
        const label = isEngine(engine) ? ENGINE_LABELS[engine] : engine;
        return (
          <span key={engine} aria-label={label}>
            <EngineIcon engine={engine} size={size} />
          </span>
        );
      })}
      {rest > 0 ? <span className="live-model-icons-more">+{rest}</span> : null}
    </div>
    </Hint>
  );
}
export function EngineBadge({ engine }: { engine: string }) {
  return (
    <TagBadge className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <EngineIcon engine={engine} />
      {isEngine(engine) ? ENGINE_LABELS[engine] : engine}
    </TagBadge>
  );
}
export function Favicon({
  domain,
  name,
  size = 28,
}: {
  domain: string;
  name?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  // A fixed favicon service avoids fetching arbitrary visitor-provided URLs
  // through our server. No cookies or referrer accompany this public domain.
  return (
    <span
      className="brand-favicon"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {failed || !domain ? (
        <span>{(name || domain || '?').slice(0, 1).toUpperCase()}</span>
      ) : (
        <Image
          unoptimized
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
          width={size}
          height={size}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
