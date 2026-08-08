import * as React from 'react';

/**
 * A tiny confetti burst shown inside an icon span when a copy action
 * succeeds ("Copied!" state). Pure CSS — 10 small colored pieces that launch
 * outward from the icon and fade, driven by per-piece CSS custom properties.
 * Falls back to invisible under `prefers-reduced-motion` (see layout.css).
 *
 * Parent must be `position: relative` (the icon spans already are, e.g.
 * .fw-aitoolmenu-icon / .fw-page-action-menu-icon).
 */
const CONFETTI_COLORS = [
  'var(--fw-primary)',
  '#f59e0b',
  '#ec4899',
  '#22c55e',
  '#3b82f6',
];

export function Confetti() {
  return (
    <span className="fw-confetti" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => {
        const angle = (i / 10) * Math.PI * 2;
        const dist = 14 + (i % 3) * 5;
        const style = {
          '--tx': `${Math.cos(angle) * dist}px`,
          '--ty': `${Math.sin(angle) * dist}px`,
          '--rot': `${(i % 2 ? 1 : -1) * (40 + (i % 5) * 18)}deg`,
          '--delay': `${(i % 4) * 35}ms`,
          '--color': CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          '--size': `${2 + (i % 2)}px`,
        } as React.CSSProperties;
        return <span key={i} className="fw-confetti-piece" style={style} />;
      })}
    </span>
  );
}
