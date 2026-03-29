/**
 * Display layout
 *
 * Wraps the audience-facing subtitle display.  Intentionally bare: no chrome,
 * no padding, no margin – just a viewport-filling black canvas ready for the
 * display page to paint on.
 */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: 'Live Translator - Display',
  description: 'Live subtitle display for in-person translation events.',
  // Prevent search engines from indexing the live display endpoint.
  robots: { index: false, follow: false },
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface DisplayLayoutProps {
  children: ReactNode;
}

export default function DisplayLayout({
  children,
}: DisplayLayoutProps): React.JSX.Element {
  return (
    <html lang="en">
      {/*
        body styles are set inline here so this layout is fully self-contained
        and does not depend on any global CSS file that may not exist.
      */}
      <body
        style={{
          margin: 0,
          padding: 0,
          overflow: 'hidden',
          // Ensure the body itself never grows a scrollbar even if child
          // content momentarily overflows during an animation frame.
          maxHeight: '100dvh',
          maxWidth: '100dvw',
          // A sensible font rendering default for projection environments.
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        }}
      >
        {children}
      </body>
    </html>
  );
}
