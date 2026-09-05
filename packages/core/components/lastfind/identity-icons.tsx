'use client';
import Image from 'next/image';
import { useState } from 'react';
import { Globe } from 'lucide-react';
import { ENGINE_META, ENGINE_LABELS, isEngine } from '@/lib/engines';
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
export function EngineBadge({ engine }: { engine: string }) {
  return (
    <span className="engine-badge">
      <EngineIcon engine={engine} />
      {isEngine(engine) ? ENGINE_LABELS[engine] : engine}
    </span>
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
