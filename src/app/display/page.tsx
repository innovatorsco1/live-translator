'use client';

/**
 * Display Page  –  /display
 *
 * The audience-facing fullscreen subtitle projector view.
 *
 * Layout overview:
 * ┌──────────────────────────────────────────────────────┐
 * │  [connection dot]                          top-right │
 * │                                                      │
 * │          (original line, small, gray)                │
 * │        TRANSLATED LINE  (large, accent)              │
 * │        TRANSLATED LINE  (large, white)               │
 * │                                          center area │
 * └──────────────────────────────────────────────────────┘
 *
 * URL search param overrides (all optional):
 *   ?fontSize=64          – base px size for translated text
 *   ?maxLines=2           – max translated lines shown at once
 *   ?showOriginal=false   – hide the English source line
 *   ?theme=light          – use light background palette
 *
 * WebSocket messages consumed (via useWebSocket hook):
 *   WSMessage { type: 'translation' | 'transcript', payload: TranslationMessage }
 *   WSMessage { type: 'control', payload: { action: 'clear' | 'settings', settings? } }
 *   WSMessage { type: 'status', payload: StatusUpdate }
 */

import React, {
  CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useWebSocket } from '@/lib/use-websocket';
import type { DisplaySettings, TranslationMessage } from '@/types';
import SubtitleLine from '@/components/SubtitleLine';

// ---------------------------------------------------------------------------
// Constants & defaults
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: DisplaySettings = {
  fontSize: 48,
  maxLines: 3,
  showOriginal: true,
  theme: 'dark',
};

// ---------------------------------------------------------------------------
// URL param helpers
// ---------------------------------------------------------------------------

function parseSettingsFromParams(
  params: URLSearchParams,
): Partial<DisplaySettings> {
  const overrides: Partial<DisplaySettings> = {};

  const fontSize = params.get('fontSize');
  if (fontSize !== null) {
    const parsed = parseInt(fontSize, 10);
    if (!isNaN(parsed) && parsed > 0) overrides.fontSize = parsed;
  }

  const maxLines = params.get('maxLines');
  if (maxLines !== null) {
    const parsed = parseInt(maxLines, 10);
    if (!isNaN(parsed) && parsed > 0) overrides.maxLines = parsed;
  }

  const showOriginal = params.get('showOriginal');
  if (showOriginal !== null) {
    overrides.showOriginal = showOriginal.toLowerCase() !== 'false';
  }

  const theme = params.get('theme');
  if (theme === 'dark' || theme === 'light') overrides.theme = theme;

  return overrides;
}

// ---------------------------------------------------------------------------
// Colour tokens (by theme)
// ---------------------------------------------------------------------------

const THEME_TOKENS = {
  dark: {
    gradient:
      'radial-gradient(ellipse at center bottom, #0a0a0a 0%, #000000 70%)',
    vignette:
      'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)',
    dotConnected: '#22C55E',
    dotDisconnected: '#EF4444',
    dotConnecting: '#F59E0B',
    dotBg: 'rgba(0,0,0,0.55)',
    dotBorder: 'rgba(255,255,255,0.08)',
    dotLabel: 'rgba(255,255,255,0.7)',
    divider: 'rgba(255,255,255,0.07)',
    waiting: 'rgba(255,255,255,0.2)',
  },
  light: {
    gradient:
      'radial-gradient(ellipse at center bottom, #f9fafb 0%, #ffffff 70%)',
    vignette:
      'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.06) 100%)',
    dotConnected: '#16A34A',
    dotDisconnected: '#DC2626',
    dotConnecting: '#D97706',
    dotBg: 'rgba(255,255,255,0.65)',
    dotBorder: 'rgba(0,0,0,0.08)',
    dotLabel: 'rgba(0,0,0,0.6)',
    divider: 'rgba(0,0,0,0.07)',
    waiting: 'rgba(0,0,0,0.2)',
  },
} as const;

// ---------------------------------------------------------------------------
// Connection status type derived from hook booleans
// ---------------------------------------------------------------------------

type VisualStatus = 'connecting' | 'connected' | 'disconnected';

function deriveVisualStatus(
  isConnected: boolean,
  wsUrl: string,
): VisualStatus {
  if (wsUrl === '') return 'connecting';
  return isConnected ? 'connected' : 'disconnected';
}

// ---------------------------------------------------------------------------
// Sub-component: ConnectionDot
// ---------------------------------------------------------------------------

interface ConnectionDotProps {
  visualStatus: VisualStatus;
  theme: 'dark' | 'light';
}

function ConnectionDot({
  visualStatus,
  theme,
}: ConnectionDotProps): React.JSX.Element {
  const tokens = THEME_TOKENS[theme];

  const dotColour =
    visualStatus === 'connected'
      ? tokens.dotConnected
      : visualStatus === 'connecting'
        ? tokens.dotConnecting
        : tokens.dotDisconnected;

  const label =
    visualStatus === 'connected'
      ? 'Connected'
      : visualStatus === 'connecting'
        ? 'Connecting'
        : 'Disconnected';

  const containerStyle: CSSProperties = {
    position: 'fixed',
    top: 20,
    right: 20,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: tokens.dotBg,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: 20,
    padding: '6px 12px 6px 10px',
    border: `1px solid ${tokens.dotBorder}`,
  };

  const circleStyle: CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: '50%',
    backgroundColor: dotColour,
    flexShrink: 0,
    boxShadow:
      visualStatus === 'connected'
        ? `0 0 6px 2px ${dotColour}66`
        : 'none',
    animation:
      visualStatus === 'connecting'
        ? 'dotPulse 1.2s ease-in-out infinite'
        : 'none',
  };

  const labelStyle: CSSProperties = {
    fontSize: 11,
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: 500,
    color: tokens.dotLabel,
    letterSpacing: '0.04em',
    userSelect: 'none',
  };

  return (
    <div style={containerStyle} role="status" aria-label={label} title={label}>
      <div style={circleStyle} />
      <span style={labelStyle}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: NoContentMessage
// ---------------------------------------------------------------------------

interface NoContentMessageProps {
  theme: 'dark' | 'light';
}

function NoContentMessage({
  theme,
}: NoContentMessageProps): React.JSX.Element {
  const style: CSSProperties = {
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 18,
    fontWeight: 400,
    color: THEME_TOKENS[theme].waiting,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    userSelect: 'none',
  };

  return <span style={style}>Waiting for speech…</span>;
}

// ---------------------------------------------------------------------------
// Helper: derive display lines from the hook's message list
// ---------------------------------------------------------------------------

interface DisplayLine {
  id: string;
  originalText: string;
  translatedText: string;
  isInterim: boolean;
}

function deriveDisplayLines(
  messages: TranslationMessage[],
  maxLines: number,
): DisplayLine[] {
  if (messages.length === 0) return [];

  // Build a de-duplicated ordered list: final messages kept as-is; interim
  // (isFinal=false) messages show as the "live" line.
  const byId = new Map<string, TranslationMessage>();
  for (const m of messages) {
    // Later entries for the same id overwrite earlier (interim → final).
    byId.set(m.id, m);
  }

  // Re-establish insertion order from the original array.
  const ordered: TranslationMessage[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      // Use the latest version of this id from the map.
      ordered.push(byId.get(m.id)!);
    }
  }

  const lines: DisplayLine[] = ordered.map((m) => ({
    id: m.id,
    originalText: m.originalText,
    translatedText: m.translatedText,
    isInterim: !m.isFinal,
  }));

  // Trim to the last maxLines entries.
  return lines.slice(-maxLines);
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function DisplayPage(): React.JSX.Element {
  // ---- Settings state (defaults + URL param overrides + WS overrides) ----
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);

  // Apply URL search param overrides once on mount (client-side only).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const overrides = parseSettingsFromParams(params);
    if (Object.keys(overrides).length > 0) {
      setSettings((prev) => ({ ...prev, ...overrides }));
    }
  }, []);

  // ---- WebSocket URL (derived client-side to access window.location) ------
  const [wsUrl, setWsUrl] = useState<string>('');

  useEffect(() => {
    setWsUrl(`ws://${window.location.hostname}:3001`);
  }, []);

  // ---- WebSocket connection ------------------------------------------------
  const { messages, isConnected, remoteSettings } = useWebSocket(
    wsUrl !== '' ? wsUrl : 'ws://localhost:3001',
  );

  // Apply remote settings pushed by the control panel.
  useEffect(() => {
    if (remoteSettings) {
      setSettings((prev) => ({ ...prev, ...remoteSettings }));
    }
  }, [remoteSettings]);

  // ---- Derive display lines -----------------------------------------------
  const displayLines = useMemo(
    () => deriveDisplayLines(messages, settings.maxLines),
    [messages, settings.maxLines],
  );

  const hasContent = displayLines.length > 0;
  const latestLineId = displayLines[displayLines.length - 1]?.id ?? null;

  // ---- Connection visual status -------------------------------------------
  const visualStatus = deriveVisualStatus(isConnected, wsUrl);

  // ---- Keyframe injection for connection dot animation --------------------
  const dotKeyframesInjectedRef = useRef(false);
  useEffect(() => {
    if (dotKeyframesInjectedRef.current) return;
    dotKeyframesInjectedRef.current = true;

    const id = 'display-page-keyframes';
    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes dotPulse {
        0%, 100% { opacity: 1;   transform: scale(1);    }
        50%       { opacity: 0.4; transform: scale(0.85); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // ---- Styles -------------------------------------------------------------
  const tokens = THEME_TOKENS[settings.theme];

  const pageStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: tokens.gradient,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // Vignette overlay softens edges for projector environments.
  const vignetteStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: tokens.vignette,
    pointerEvents: 'none',
    zIndex: 1,
  };

  // Subtitle stage sits above the vignette.
  const stageStyle: CSSProperties = {
    position: 'relative',
    zIndex: 2,
    width: '90vw',
    maxWidth: 1400,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: '4vh',
    paddingBottom: '8vh',
    gap: 0,
  };

  // ---- Render -------------------------------------------------------------

  return (
    <main style={pageStyle}>
      {/* Ambient vignette */}
      <div style={vignetteStyle} aria-hidden="true" />

      {/* Connection status indicator */}
      <ConnectionDot visualStatus={visualStatus} theme={settings.theme} />

      {/* Subtitle stage */}
      <div
        style={stageStyle}
        role="region"
        aria-label="Live subtitle display"
        aria-live="polite"
        aria-atomic="false"
      >
        {!hasContent ? (
          <NoContentMessage theme={settings.theme} />
        ) : (
          displayLines.map((line, index) => {
            const isLatest = line.id === latestLineId;

            // Key strategy: append '-interim' while the segment is in-progress
            // so React re-mounts the component (re-triggering the fade-in
            // animation) when it transitions from interim to final.
            const lineKey = line.isInterim
              ? `${line.id}-interim`
              : line.id;

            return (
              <React.Fragment key={lineKey}>
                {/* Original (English) line */}
                {settings.showOriginal &&
                  line.originalText.trim().length > 0 && (
                    <SubtitleLine
                      key={`${lineKey}-orig`}
                      text={line.originalText}
                      isLatest={isLatest}
                      isOriginal={true}
                      fontSize={settings.fontSize}
                      theme={settings.theme}
                    />
                  )}

                {/* Translated (Spanish) line */}
                <SubtitleLine
                  key={`${lineKey}-trans`}
                  text={line.translatedText}
                  isLatest={isLatest}
                  isOriginal={false}
                  fontSize={settings.fontSize}
                  theme={settings.theme}
                />

                {/* Subtle divider between segments (not after last) */}
                {index < displayLines.length - 1 && (
                  <div
                    aria-hidden="true"
                    style={{
                      width: '60%',
                      height: 1,
                      margin: '0.5em auto',
                      background: tokens.divider,
                      borderRadius: 1,
                      flexShrink: 0,
                    }}
                  />
                )}
              </React.Fragment>
            );
          })
        )}
      </div>
    </main>
  );
}
