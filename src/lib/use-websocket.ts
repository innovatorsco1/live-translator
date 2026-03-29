'use client';

/**
 * React hook that manages a WebSocket connection to the live-translation server.
 *
 * Features
 * --------
 * - Automatic reconnection with exponential back-off (1 s → 2 s → 4 s → … → 10 s max).
 * - Typed message parsing via the shared `WSMessage` discriminated union.
 * - Sliding window of the last 50 `TranslationMessage` items.
 * - `sendMessage` helper that safely serialises outbound payloads.
 * - Safe for React Strict Mode (double-mount handled via intentional-close flag).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StatusUpdate, TranslationMessage, WSMessage } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 50;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UseWebSocketReturn {
  /** Ordered list of received translation messages (newest last). */
  messages: TranslationMessage[];
  /** Latest status snapshot broadcast by the server. */
  status: StatusUpdate;
  /** Send a typed `WSMessage` to the server. No-op when not connected. */
  sendMessage: (message: WSMessage) => void;
  /** `true` while the WebSocket is in the OPEN state. */
  isConnected: boolean;
}

// ---------------------------------------------------------------------------
// Default / initial values
// ---------------------------------------------------------------------------

const DEFAULT_STATUS: StatusUpdate = {
  isListening: false,
  isConnected: false,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Connect to a WebSocket server at `url` and receive live translation messages.
 *
 * @param url - Full WebSocket URL, e.g. `"ws://localhost:3001"`.
 *
 * @example
 * ```tsx
 * const { messages, isConnected, sendMessage } = useWebSocket('ws://localhost:3001');
 * ```
 */
export function useWebSocket(url: string): UseWebSocketReturn {
  const [messages, setMessages] = useState<TranslationMessage[]>([]);
  const [status, setStatus] = useState<StatusUpdate>(DEFAULT_STATUS);
  const [isConnected, setIsConnected] = useState(false);

  // Refs so that the connect closure can always read the latest values without
  // being recreated, which would restart the connection needlessly.
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Suppresses state updates after the component unmounts.
  const isMountedRef = useRef(true);
  // Set to true during cleanup so onclose does not schedule another reconnect.
  const isIntentionalCloseRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Message handler
  // ---------------------------------------------------------------------------

  const handleMessage = useCallback((event: MessageEvent<string>) => {
    let parsed: WSMessage;

    try {
      parsed = JSON.parse(event.data) as WSMessage;
    } catch {
      console.warn('[useWebSocket] Received non-JSON message:', event.data);
      return;
    }

    switch (parsed.type) {
      case 'translation':
      case 'transcript': {
        const incoming = parsed.payload;
        setMessages((prev) => {
          // Replace an existing interim message sharing the same id, or append.
          const idx = prev.findIndex((m) => m.id === incoming.id);
          const next =
            idx >= 0
              ? prev.map((m, i) => (i === idx ? incoming : m))
              : [...prev, incoming];
          // Trim to the most recent MAX_MESSAGES entries.
          return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
        });
        break;
      }

      case 'control': {
        if (parsed.payload.action === 'clear') {
          setMessages([]);
        }
        break;
      }

      case 'status': {
        setStatus(parsed.payload);
        break;
      }

      default: {
        // Exhaustiveness guard: TypeScript will error here if a new WSMessage
        // variant is added without being handled above.
        const _exhaustive: never = parsed;
        console.warn('[useWebSocket] Unhandled message type:', _exhaustive);
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  const connect = useCallback(() => {
    // Tear down any dangling socket before opening a new one.
    if (socketRef.current) {
      socketRef.current.onclose = null; // Prevent re-entrant reconnect logic.
      socketRef.current.close();
      socketRef.current = null;
    }

    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) return;
      reconnectAttemptRef.current = 0;
      setIsConnected(true);
      setStatus((prev) => ({ ...prev, isConnected: true, error: undefined }));
    };

    ws.onmessage = handleMessage;

    ws.onerror = (event) => {
      // onerror is always followed by onclose in the browser WebSocket API, so
      // reconnect logic lives entirely in onclose.
      console.error('[useWebSocket] WebSocket error:', event);
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;

      setIsConnected(false);
      setStatus((prev) => ({ ...prev, isConnected: false }));
      socketRef.current = null;

      if (isIntentionalCloseRef.current) return;

      // Exponential back-off capped at MAX_RECONNECT_DELAY_MS.
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptRef.current),
        MAX_RECONNECT_DELAY_MS,
      );
      reconnectAttemptRef.current += 1;

      console.info(
        `[useWebSocket] Disconnected. Reconnecting in ${delay} ms ` +
          `(attempt ${reconnectAttemptRef.current}).`,
      );

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (isMountedRef.current && !isIntentionalCloseRef.current) {
          connect();
        }
      }, delay);
    };
  }, [url, handleMessage]);

  // ---------------------------------------------------------------------------
  // Effect: open on mount / url change, close on unmount.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    isMountedRef.current = true;
    isIntentionalCloseRef.current = false;

    connect();

    return () => {
      isMountedRef.current = false;
      isIntentionalCloseRef.current = true;

      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      if (socketRef.current) {
        socketRef.current.onclose = null; // Prevent stale reconnect on unmount.
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect]);

  // ---------------------------------------------------------------------------
  // Outbound messaging
  // ---------------------------------------------------------------------------

  const sendMessage = useCallback((message: WSMessage) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[useWebSocket] Cannot send – socket is not open.');
      return;
    }
    ws.send(JSON.stringify(message));
  }, []);

  return { messages, status, sendMessage, isConnected };
}
