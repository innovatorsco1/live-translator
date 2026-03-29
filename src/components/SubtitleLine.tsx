'use client';

/**
 * SubtitleLine
 *
 * Renders a single line of subtitle text for the display view.
 *
 * Visual contract:
 * - isLatest  → fade-in animation + accent colour (yellow in dark theme)
 * - isOriginal → smaller font (60 % of fontSize) + muted colour (gray)
 * - Text shadow applied to all variants for projection legibility
 *
 * Animations are injected once into the document <head> via a shared
 * <style> tag so the keyframes are available for inline animation values.
 */

import React, { CSSProperties, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubtitleLineProps {
  /** The text to display. */
  text: string;
  /** True when this line is the most recent (non-final or latest final) entry. */
  isLatest: boolean;
  /** True when this line shows the original source language. */
  isOriginal?: boolean;
  /** Base font size in pixels; isOriginal lines are rendered at 60 % of this. */
  fontSize: number;
  /** Controls colour palette.  Defaults to 'dark'. */
  theme?: 'dark' | 'light';
}

// ---------------------------------------------------------------------------
// Keyframe injection (idempotent)
// ---------------------------------------------------------------------------

const KEYFRAME_ID = 'subtitle-line-keyframes';

function injectKeyframes(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAME_ID)) return;

  const style = document.createElement('style');
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes subtitleFadeIn {
      0%   { opacity: 0; transform: translateY(8px); }
      100% { opacity: 1; transform: translateY(0);   }
    }

    @keyframes subtitlePulse {
      0%, 100% { opacity: 1;    }
      50%       { opacity: 0.75; }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Colour tokens
// ---------------------------------------------------------------------------

const DARK_THEME = {
  latest: '#FFE55C',       // vivid yellow – immediately draws the eye
  latestShadow: '0 0 24px rgba(255, 229, 92, 0.45), 0 2px 8px rgba(0,0,0,0.9)',
  normal: '#FFFFFF',
  normalShadow: '0 2px 8px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1)',
  original: '#9CA3AF',     // cool gray-400
  originalShadow: '0 1px 4px rgba(0,0,0,0.9)',
} as const;

const LIGHT_THEME = {
  latest: '#1A56DB',       // rich blue accent on white
  latestShadow: '0 0 16px rgba(26, 86, 219, 0.25), 0 2px 6px rgba(0,0,0,0.15)',
  normal: '#111827',       // near-black
  normalShadow: '0 1px 3px rgba(0,0,0,0.2)',
  original: '#6B7280',
  originalShadow: '0 1px 2px rgba(0,0,0,0.1)',
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SubtitleLine({
  text,
  isLatest,
  isOriginal = false,
  fontSize,
  theme = 'dark',
}: SubtitleLineProps): React.JSX.Element {
  // Inject shared keyframes once on first render.
  useEffect(() => {
    injectKeyframes();
  }, []);

  const colours = theme === 'dark' ? DARK_THEME : LIGHT_THEME;

  // Resolve visual properties based on variant priority:
  //   isOriginal (source language) → muted style
  //   isLatest + translated         → accent + animation
  //   otherwise                     → standard white/black
  let colour: string;
  let textShadow: string;
  let animationName: string | undefined;
  let animationDuration: string | undefined;
  let animationTimingFunction: string | undefined;
  let animationFillMode: string | undefined;

  if (isOriginal) {
    colour = colours.original;
    textShadow = colours.originalShadow;
    // Originals still fade in so the eye isn't jarred.
    animationName = 'subtitleFadeIn';
    animationDuration = '0.4s';
    animationTimingFunction = 'ease-out';
    animationFillMode = 'both';
  } else if (isLatest) {
    colour = colours.latest;
    textShadow = colours.latestShadow;
    animationName = 'subtitleFadeIn';
    animationDuration = '0.35s';
    animationTimingFunction = 'ease-out';
    animationFillMode = 'both';
  } else {
    colour = colours.normal;
    textShadow = colours.normalShadow;
  }

  const resolvedFontSize = isOriginal
    ? Math.round(fontSize * 0.6)
    : fontSize;

  const style: CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'center',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: `${resolvedFontSize}px`,
    fontWeight: isOriginal ? 400 : 700,
    lineHeight: 1.25,
    letterSpacing: isOriginal ? '0.01em' : '0.02em',
    color: colour,
    textShadow,
    // Prevent long single words from escaping the container.
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
    // Padding creates breathing room between stacked lines.
    paddingTop: isOriginal ? '0' : '0.15em',
    paddingBottom: isOriginal ? '0.05em' : '0.15em',
    // Smooth transitions for colour changes as a line moves from latest → older.
    transition: 'color 0.6s ease, text-shadow 0.6s ease',
    // Animation (only when set above).
    ...(animationName !== undefined && {
      animationName,
      animationDuration,
      animationTimingFunction,
      animationFillMode,
    }),
  };

  return (
    <span style={style} aria-live={isLatest ? 'polite' : undefined}>
      {text}
    </span>
  );
}

export default SubtitleLine;
