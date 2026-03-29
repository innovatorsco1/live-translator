'use client';

/**
 * Control Panel – Operator Interface
 *
 * Data flow (OPTIMISED):
 *  Browser microphone
 *    -> useSpeechRecognition (Web Speech API)
 *    -> WebSocket 'translate_request' (server-side streaming translation)
 *    -> Server streams 'translation_chunk' -> 'translation' to all clients
 *
 * Key latency improvements vs. original:
 *  - Eliminated HTTP roundtrip (POST /api/translate)
 *  - Server translates and broadcasts directly
 *  - Streaming chunks show partial translations in real-time
 *  - gpt-4o-mini model (~5x faster than gpt-4)
 *  - LRU cache avoids re-translating repeated phrases
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSpeechRecognition } from '@/lib/use-speech-recognition';
import { useWebSocket } from '@/lib/use-websocket';
import type {
  TranslationMessage,
  WSMessage,
  DisplaySettings,
} from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY_ITEMS = 10;

const DEFAULT_SETTINGS: DisplaySettings = {
  fontSize: 48,
  maxLines: 3,
  showOriginal: true,
  theme: 'dark',
};

const WS_PORT = 3001;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RecordingDot() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        borderRadius: '50%',
        backgroundColor: '#e94560',
        animation: 'pulse 1.2s ease-in-out infinite',
        flexShrink: 0,
      }}
    />
  );
}

interface CardProps {
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}
function Card({ title, children, style }: CardProps) {
  return (
    <section
      style={{
        backgroundColor: '#16213e',
        borderRadius: 10,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        ...style,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#7b8ab8',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function ControlPage() {
  // ---- WebSocket ----
  const [wsUrl, setWsUrl] = useState<string>('');
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_SETTINGS);
  const [pendingSettings, setPendingSettings] =
    useState<DisplaySettings>(DEFAULT_SETTINGS);
  const [translationHistory, setTranslationHistory] = useState<
    TranslationMessage[]
  >([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWsUrl(`ws://${window.location.hostname}:${WS_PORT}`);
      setIsSpeechSupported(
        window.SpeechRecognition !== undefined ||
          (window as Window & { webkitSpeechRecognition?: unknown })
            .webkitSpeechRecognition !== undefined,
      );
    }
  }, []);

  const { isConnected, messages, sendMessage } = useWebSocket(
    wsUrl || 'ws://localhost:3001',
  );

  // ---- Speech recognition ----
  const {
    isListening,
    transcript,
    interimTranscript,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechRecognition();

  useEffect(() => {
    if (speechError) {
      setLastError(`Microphone error: ${speechError}`);
    }
  }, [speechError]);

  // Track active translation IDs to show translating state
  const activeTranslationsRef = useRef(new Set<string>());

  /**
   * Update local history from WS messages (including streaming chunks).
   * The server broadcasts translation/translation_chunk/transcript to all
   * clients including the sender.
   */
  useEffect(() => {
    if (messages.length === 0) return;

    setTranslationHistory((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      let changed = false;

      for (const msg of messages) {
        const existing = byId.get(msg.id);
        if (!existing || existing.translatedText !== msg.translatedText || existing.isFinal !== msg.isFinal) {
          byId.set(msg.id, msg);
          changed = true;
        }
      }

      if (!changed) return prev;

      // Sort by timestamp descending (newest first) for the history view.
      const sorted = Array.from(byId.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_HISTORY_ITEMS);

      // Update translating state
      const hasInFlight = sorted.some((m) => !m.isFinal);
      setIsTranslating(hasInFlight);

      return sorted;
    });
  }, [messages]);

  /**
   * Send a translate_request to the WS server instead of making an HTTP call.
   * The server handles translation and broadcasts results.
   */
  const translateAndBroadcast = useCallback(
    (segment: string) => {
      if (!segment.trim()) return;

      setIsTranslating(true);
      setLastError(null);

      const id = generateId();
      const timestamp = Date.now();

      // Add to local history immediately with pending state
      const pending: TranslationMessage = {
        id,
        originalText: segment,
        translatedText: '…',
        timestamp,
        isFinal: false,
      };
      setTranslationHistory((prev) =>
        [pending, ...prev].slice(0, MAX_HISTORY_ITEMS),
      );

      activeTranslationsRef.current.add(id);

      // Send translate_request to server (no HTTP roundtrip!)
      const msg: WSMessage = {
        type: 'translate_request',
        payload: { id, text: segment, timestamp },
      };
      sendMessage(msg);
    },
    [sendMessage],
  );

  /**
   * Watch `transcript` for new committed text.
   */
  const prevTranscriptRef = useRef('');
  useEffect(() => {
    const prev = prevTranscriptRef.current;
    if (transcript && transcript !== prev) {
      const newSegment = prev
        ? transcript.slice(prev.length).trimStart()
        : transcript;
      prevTranscriptRef.current = transcript;

      if (newSegment.trim()) {
        translateAndBroadcast(newSegment.trim());
      }
    }

    if (!transcript && prev) {
      prevTranscriptRef.current = '';
    }
  }, [transcript, translateAndBroadcast]);

  const historyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = 0;
    }
  }, [translationHistory.length]);

  // ---- Handlers ----
  const handleToggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      prevTranscriptRef.current = '';
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleApplySettings = useCallback(() => {
    setSettings(pendingSettings);
    const msg: WSMessage = {
      type: 'control',
      payload: {
        action: 'settings',
        settings: pendingSettings,
      },
    };
    sendMessage(msg);
  }, [pendingSettings, sendMessage]);

  const handleClearDisplay = useCallback(() => {
    const msg: WSMessage = {
      type: 'control',
      payload: { action: 'clear' },
    };
    sendMessage(msg);
  }, [sendMessage]);

  const connectionColor = isConnected ? '#22c55e' : '#e94560';
  const connectionLabel = isConnected ? 'Connected' : 'Disconnected';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(1.3); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0f3460; border-radius: 3px; }
        ::-webkit-scrollbar-thumb { background: #7b8ab8; border-radius: 3px; }
      `}</style>

      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          backgroundColor: '#0f3460',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#e8eaf6',
        }}
      >
        {/* ================================================================
            SIDEBAR
        ================================================================ */}
        <aside
          style={{
            width: 220,
            flexShrink: 0,
            backgroundColor: '#1a1a2e',
            display: 'flex',
            flexDirection: 'column',
            padding: '24px 16px',
            gap: 8,
            borderRight: '1px solid #0f3460',
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#7b8ab8',
                marginBottom: 4,
              }}
            >
              Live Translator
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#e8eaf6',
                lineHeight: 1.2,
              }}
            >
              Control Panel
            </div>
          </div>

          {['Audio', 'Translations', 'Settings'].map((label) => (
            <div
              key={label}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 14,
                color: '#b0b8d8',
                cursor: 'default',
              }}
            >
              {label}
            </div>
          ))}

          <div style={{ flex: 1 }} />

          {/* Connection badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              backgroundColor: '#0f3460',
              borderRadius: 8,
            }}
            title={`WebSocket: ${wsUrl || 'not set'}`}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: connectionColor,
                flexShrink: 0,
                transition: 'background-color 0.3s',
              }}
            />
            <span style={{ fontSize: 13, color: connectionColor, fontWeight: 500 }}>
              {connectionLabel}
            </span>
          </div>

          {/* Pipeline badge */}
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#0f3460',
              borderRadius: 8,
              fontSize: 11,
              color: '#22c55e',
              textAlign: 'center',
              letterSpacing: '0.04em',
            }}
          >
            STREAMING MODE
          </div>

          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#0f3460',
              borderRadius: 8,
              fontSize: 12,
              color: '#7b8ab8',
              textAlign: 'center',
            }}
          >
            EN &rarr; ES
          </div>
        </aside>

        {/* ================================================================
            MAIN CONTENT
        ================================================================ */}
        <main
          style={{
            flex: 1,
            padding: '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            overflowY: 'auto',
            maxWidth: 960,
          }}
        >
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
                Operator Dashboard
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#7b8ab8' }}>
                English &rarr; Spanish real-time subtitles (streaming)
              </p>
            </div>

            <button
              onClick={handleClearDisplay}
              disabled={!isConnected}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid #7b8ab8',
                backgroundColor: 'transparent',
                color: isConnected ? '#e8eaf6' : '#7b8ab8',
                fontSize: 14,
                fontWeight: 500,
                cursor: isConnected ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (isConnected)
                  (e.target as HTMLButtonElement).style.backgroundColor = '#0f3460';
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.backgroundColor = 'transparent';
              }}
              aria-label="Clear subtitles on audience display"
            >
              Clear Display
            </button>
          </header>

          {/* Error banner */}
          {lastError !== null && (
            <div
              role="alert"
              style={{
                backgroundColor: 'rgba(233, 69, 96, 0.15)',
                border: '1px solid #e94560',
                borderRadius: 8,
                padding: '10px 16px',
                fontSize: 13,
                color: '#e94560',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span>{lastError}</span>
              <button
                onClick={() => setLastError(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#e94560',
                  fontSize: 18,
                  cursor: 'pointer',
                  lineHeight: 1,
                  padding: '0 4px',
                  flexShrink: 0,
                }}
                aria-label="Dismiss error"
              >
                &times;
              </button>
            </div>
          )}

          {/* Two-column grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 20,
            }}
          >
            {/* AUDIO CONTROL */}
            <Card title="Audio Control" style={{ gridColumn: '1 / -1' }}>
              {!isSpeechSupported && (
                <p
                  style={{
                    color: '#e94560',
                    fontSize: 13,
                    margin: 0,
                    padding: '8px 12px',
                    backgroundColor: 'rgba(233, 69, 96, 0.1)',
                    borderRadius: 6,
                  }}
                >
                  Web Speech API is not supported in this browser. Please use
                  Google Chrome or Microsoft Edge.
                </p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <button
                  onClick={handleToggleListening}
                  disabled={!isSpeechSupported}
                  aria-label={isListening ? 'Stop speech recognition' : 'Start speech recognition'}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    border: 'none',
                    backgroundColor: isListening ? '#e94560' : '#22c55e',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    cursor: isSpeechSupported ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                    transition: 'background-color 0.2s, transform 0.1s',
                    boxShadow: isListening
                      ? '0 0 0 6px rgba(233, 69, 96, 0.25)'
                      : '0 0 0 6px rgba(34, 197, 94, 0.15)',
                  }}
                  onMouseDown={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.93)';
                  }}
                  onMouseUp={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                  }}
                >
                  {isListening ? 'STOP' : 'START'}
                </button>

                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 14,
                      fontWeight: 500,
                      color: isListening ? '#e94560' : '#7b8ab8',
                    }}
                  >
                    {isListening ? (
                      <RecordingDot />
                    ) : (
                      <span
                        style={{
                          display: 'inline-block',
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          backgroundColor: '#7b8ab8',
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {isListening ? 'Listening…' : 'Microphone off'}
                  </div>

                  {isTranslating && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 13,
                        color: '#a78bfa',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          border: '2px solid #a78bfa',
                          borderTopColor: 'transparent',
                          animation: 'spin 0.7s linear infinite',
                          flexShrink: 0,
                        }}
                      />
                      Streaming translation…
                    </div>
                  )}
                </div>
              </div>

              {/* Transcript display */}
              <div
                style={{
                  backgroundColor: '#0f3460',
                  borderRadius: 8,
                  padding: '12px 16px',
                  minHeight: 72,
                  fontSize: 15,
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                }}
                aria-live="polite"
                aria-label="Current transcript"
              >
                {transcript ? (
                  <span style={{ color: '#e8eaf6' }}>{transcript}</span>
                ) : (
                  <span style={{ color: '#4a5580' }}>
                    Transcript will appear here…
                  </span>
                )}
                {interimTranscript && (
                  <span style={{ color: '#7b8ab8' }}> {interimTranscript}</span>
                )}
              </div>
            </Card>

            {/* TRANSLATION HISTORY */}
            <Card title={`Translations (last ${MAX_HISTORY_ITEMS})`}>
              <div
                ref={historyRef}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  maxHeight: 340,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
                aria-live="polite"
                aria-label="Translation history"
              >
                {translationHistory.length === 0 ? (
                  <p
                    style={{
                      color: '#4a5580',
                      fontSize: 13,
                      margin: 0,
                      textAlign: 'center',
                      padding: '20px 0',
                    }}
                  >
                    No translations yet. Press START to begin.
                  </p>
                ) : (
                  translationHistory.map((item) => (
                    <TranslationHistoryItem key={item.id} item={item} />
                  ))
                )}
              </div>
            </Card>

            {/* SETTINGS PANEL */}
            <Card title="Display Settings">
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                <SettingRow label={`Font size: ${pendingSettings.fontSize}px`}>
                  <input
                    type="range"
                    min={24}
                    max={96}
                    step={4}
                    value={pendingSettings.fontSize}
                    onChange={(e) =>
                      setPendingSettings((s) => ({
                        ...s,
                        fontSize: Number(e.target.value),
                      }))
                    }
                    style={{ width: '100%', accentColor: '#e94560' }}
                    aria-label="Font size"
                  />
                </SettingRow>

                <SettingRow label="Max lines">
                  <select
                    value={pendingSettings.maxLines}
                    onChange={(e) =>
                      setPendingSettings((s) => ({
                        ...s,
                        maxLines: Number(e.target.value),
                      }))
                    }
                    style={{
                      backgroundColor: '#0f3460',
                      color: '#e8eaf6',
                      border: '1px solid #4a5580',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 14,
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    aria-label="Maximum lines"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? 'line' : 'lines'}
                      </option>
                    ))}
                  </select>
                </SettingRow>

                <SettingRow label="Show original (English)">
                  <ToggleSwitch
                    checked={pendingSettings.showOriginal}
                    onChange={(val) =>
                      setPendingSettings((s) => ({ ...s, showOriginal: val }))
                    }
                    id="show-original"
                    aria-label="Show original English text"
                  />
                </SettingRow>

                <SettingRow label="Display theme">
                  <ToggleSwitch
                    checked={pendingSettings.theme === 'dark'}
                    onChange={(val) =>
                      setPendingSettings((s) => ({
                        ...s,
                        theme: val ? 'dark' : 'light',
                      }))
                    }
                    id="theme-toggle"
                    labelOn="Dark"
                    labelOff="Light"
                    aria-label="Display theme"
                  />
                </SettingRow>

                <div
                  style={{
                    fontSize: 12,
                    color: '#7b8ab8',
                    backgroundColor: '#0f3460',
                    borderRadius: 6,
                    padding: '8px 10px',
                    lineHeight: 1.5,
                  }}
                >
                  Applied: {settings.fontSize}px &bull; {settings.maxLines} lines &bull;{' '}
                  {settings.showOriginal ? 'with original' : 'translation only'} &bull;{' '}
                  {settings.theme} theme
                </div>

                <button
                  onClick={handleApplySettings}
                  disabled={!isConnected}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: isConnected ? '#e94560' : '#4a5580',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: isConnected ? 'pointer' : 'not-allowed',
                    transition: 'background-color 0.15s',
                    alignSelf: 'flex-start',
                  }}
                  onMouseEnter={(e) => {
                    if (isConnected)
                      (e.target as HTMLButtonElement).style.backgroundColor = '#c73652';
                  }}
                  onMouseLeave={(e) => {
                    if (isConnected)
                      (e.target as HTMLButtonElement).style.backgroundColor = '#e94560';
                  }}
                  aria-label="Apply settings and push to display"
                >
                  Apply Settings
                </button>
              </div>
            </Card>
          </div>
        </main>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// TranslationHistoryItem
// ---------------------------------------------------------------------------

interface TranslationHistoryItemProps {
  item: TranslationMessage;
}

function TranslationHistoryItem({ item }: TranslationHistoryItemProps) {
  return (
    <div
      style={{
        backgroundColor: '#0f3460',
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        borderLeft: `3px solid ${item.isFinal ? '#22c55e' : '#a78bfa'}`,
        opacity: item.isFinal ? 1 : 0.75,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 11, color: '#7b8ab8' }}>
          {formatTimestamp(item.timestamp)}
        </span>
        {!item.isFinal && (
          <span
            style={{
              fontSize: 10,
              color: '#a78bfa',
              backgroundColor: 'rgba(167, 139, 250, 0.1)',
              padding: '2px 6px',
              borderRadius: 10,
              fontWeight: 600,
              letterSpacing: '0.05em',
            }}
          >
            STREAMING
          </span>
        )}
      </div>

      <div style={{ fontSize: 13, color: '#b0b8d8', lineHeight: 1.4 }}>
        <span style={{ color: '#7b8ab8', marginRight: 4 }}>EN</span>
        {item.originalText}
      </div>

      <div style={{ fontSize: 14, color: '#e8eaf6', lineHeight: 1.4, fontWeight: 500 }}>
        <span style={{ color: '#7b8ab8', marginRight: 4 }}>ES</span>
        {item.translatedText === '[Translation failed]' ? (
          <span style={{ color: '#e94560' }}>{item.translatedText}</span>
        ) : (
          item.translatedText
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingRow
// ---------------------------------------------------------------------------

interface SettingRowProps {
  label: string;
  children: React.ReactNode;
}

function SettingRow({ label, children }: SettingRowProps) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <label
        style={{ fontSize: 13, color: '#b0b8d8', fontWeight: 500 }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToggleSwitch
// ---------------------------------------------------------------------------

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  id: string;
  labelOn?: string;
  labelOff?: string;
  'aria-label'?: string;
}

function ToggleSwitch({
  checked,
  onChange,
  id,
  labelOn = 'On',
  labelOff = 'Off',
}: ToggleSwitchProps) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 10 }}
    >
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative',
          width: 44,
          height: 24,
          borderRadius: 12,
          border: 'none',
          backgroundColor: checked ? '#e94560' : '#4a5580',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 22 : 2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            backgroundColor: '#fff',
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}
        />
        <span className="sr-only">{checked ? labelOn : labelOff}</span>
      </button>
      <span style={{ fontSize: 13, color: '#b0b8d8', userSelect: 'none' }}>
        {checked ? labelOn : labelOff}
      </span>
    </div>
  );
}
