import type { CSSProperties } from 'react';

/** Outlined Jakarta 700 from the public site, with the official glass telescope.
 * The same SVG is also the source for the email PNG. No installed font is needed.
 */
export function LastfindLogo({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`lastfind-logo ${className}`}
      aria-hidden="true"
      style={{
        display: 'block',
        flexShrink: 0,
        width: 150,
        height: 48,
        ...style,
      }}
    >
      <svg
        viewBox="0 0 150 48"
        width="150"
        height="48"
        focusable="false"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <use href="/lastfind/brand/lastfind-logo.svg#logo" />
      </svg>
    </span>
  );
}
