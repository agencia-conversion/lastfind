'use client';

import { useState } from 'react';

/** Shared uploaded/imported/initials presentation for the app and public header. */
export function AccountAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      {initials}
      {src && src !== failedSource && (
        // Avatar bytes come from a local upload or the authenticated same-origin proxy.
        // eslint-disable-next-line next/no-img-element
        <img
          src={src}
          alt=""
          width={32}
          height={32}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: loadedSource === src ? 1 : 0,
          }}
          onLoad={() => setLoadedSource(src)}
          onError={() => setFailedSource(src)}
        />
      )}
    </span>
  );
}
