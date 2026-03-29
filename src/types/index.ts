/**
 * Core shared types for the live translation system.
 *
 * These types are consumed by both the Next.js server (API routes / WebSocket
 * handler) and the React client (hooks, components), so they must not import
 * anything that is environment-specific.
 */

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

/**
 * A single unit of translated speech captured from the STT pipeline.
 *
 * - `isFinal` distinguishes interim (in-progress) results from committed ones.
 *   Interim messages may be replaced by a later message with the same `id`.
 */
export interface TranslationMessage {
  /** Stable UUID for this speech segment. */
  id: string;
  /** Raw text as recognised by the speech-to-text engine. */
  originalText: string;
  /** Text after translation. Empty string while translation is pending. */
  translatedText: string;
  /** Unix epoch milliseconds – set when the segment is first created. */
  timestamp: number;
  /**
   * `true` once the STT engine has committed the segment and the translation
   * is complete. `false` for in-flight / interim results.
   */
  isFinal: boolean;
}

// ---------------------------------------------------------------------------
// WebSocket message envelope
// ---------------------------------------------------------------------------

/**
 * Discriminated union used for every message sent over the WebSocket channel.
 *
 * Consumers should switch on `type` and then narrow `payload` accordingly.
 */
export type WSMessage =
  | { type: 'transcript'; payload: TranslationMessage }
  | { type: 'translation'; payload: TranslationMessage }
  | { type: 'control'; payload: ControlCommand }
  | { type: 'status'; payload: StatusUpdate };

// ---------------------------------------------------------------------------
// Control commands (client → server)
// ---------------------------------------------------------------------------

/**
 * Command sent by the control UI to manage the translation session.
 *
 * - `start` / `stop` toggle the STT pipeline.
 * - `clear` flushes the display buffer on all connected clients.
 * - `settings` pushes updated `DisplaySettings` to all display clients.
 */
export interface ControlCommand {
  action: 'start' | 'stop' | 'clear' | 'settings';
  /** Only present when `action === 'settings'`. */
  settings?: DisplaySettings;
}

// ---------------------------------------------------------------------------
// Display configuration
// ---------------------------------------------------------------------------

/**
 * Persisted display preferences that the control panel can push to the
 * display view at runtime.
 */
export interface DisplaySettings {
  /** Base font size in pixels (e.g. 24, 32, 48). */
  fontSize: number;
  /** Maximum number of translation lines visible at once before scrolling. */
  maxLines: number;
  /** When `true` the original (English) text is rendered above the translation. */
  showOriginal: boolean;
  /** Visual theme applied to the display view. */
  theme: 'dark' | 'light';
}

// ---------------------------------------------------------------------------
// Status updates (server → client)
// ---------------------------------------------------------------------------

/**
 * Periodic health/state snapshot broadcast by the server to all clients.
 */
export interface StatusUpdate {
  /** Whether the STT engine is currently capturing audio. */
  isListening: boolean;
  /** Whether the WebSocket connection to the server is alive. */
  isConnected: boolean;
  /** Human-readable error description if something went wrong. */
  error?: string;
}
