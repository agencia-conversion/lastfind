import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import './animated-telescope.css';

const source = (tone: string, kind: 'mp4' | 'webp') => `/lastfind/brand/telescope/${tone}.${kind}`;

// The Lastfind telescope in an endless loop: a Higgsfield animation of the
// approved render (the tube scans the sky, the star twinkles) that starts and
// ends on the same frame. Filmed on the colour it sits on and blended into it,
// so it needs no alpha: `light` on white (public site, catalog), `dark` on the
// night sky of the app's loading state. The poster is that frame, the approved
// mark; under reduced motion no source matches and the poster stays.
// Decorative. Shared by the public site and the app's loading state.
export function AnimatedTelescope({
  size = 64,
  tone = 'light',
  eager = false,
  className,
}: {
  /** Rendered width and height in CSS px (CSS may override --telescope-size). */
  size?: number;
  /** The backdrop it sits on: white (`light`) or the night sky (`dark`). */
  tone?: 'light' | 'dark';
  /** Play at once (a loading screen). Otherwise the page plays it when it nears the viewport. */
  eager?: boolean;
  className?: string;
}) {
  return (
    <video
      className={cn('animated-telescope', className)}
      data-tone={tone}
      style={{ '--telescope-size': `${size}px` } as CSSProperties}
      width={size}
      height={size}
      poster={source(tone, 'webp')}
      autoPlay={eager}
      muted
      loop
      playsInline
      disablePictureInPicture
      preload={eager ? 'auto' : 'none'}
      aria-hidden="true"
    >
      <source src={source(tone, 'mp4')} type="video/mp4" media="(prefers-reduced-motion: no-preference)" />
    </video>
  );
}
