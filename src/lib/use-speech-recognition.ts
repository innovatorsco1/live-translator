'use client';

/**
 * React hook for the browser Web Speech API.
 *
 * Features
 * --------
 * - `continuous: true` – keeps the session alive across utterance boundaries.
 * - `interimResults: true` – surfaces in-progress transcripts for real-time display.
 * - Auto-restart: if the session ends unexpectedly while `isListening` is true
 *   the hook silently reopens it (handles Chrome's ~60 s session limit).
 * - Safe for SSR: all `window` access is deferred to effect/callback time.
 * - Vendor prefix handled: tries `SpeechRecognition` then `webkitSpeechRecognition`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Browser type augmentation (webkit prefix + missing lib types)
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a single recognition result entry.
 * The browser exposes `SpeechRecognitionAlternative` but TypeScript's lib may
 * not include it when targeting older environments.
 */
interface SpeechAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

/**
 * A single recognised phrase, which is either final or interim.
 * Modelled after the W3C SpeechRecognitionResult interface.
 */
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternative;
}

/**
 * Array-like list of recognition results returned in each event.
 */
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

/**
 * Normalised interface covering both the standard and webkit-prefixed
 * SpeechRecognition constructors.
 */
interface WebSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type WebSpeechRecognitionConstructor = new () => WebSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: WebSpeechRecognitionConstructor;
    webkitSpeechRecognition?: WebSpeechRecognitionConstructor;
  }
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface UseSpeechRecognitionReturn {
  /** `true` while the recognition session is active. */
  isListening: boolean;
  /** Accumulated committed (final) transcript text since the last start. */
  transcript: string;
  /** In-progress partial text for the utterance currently being spoken. */
  interimTranscript: string;
  /** Start capturing audio. No-op if already listening or unsupported. */
  startListening: () => void;
  /** Stop capturing audio. */
  stopListening: () => void;
  /**
   * Human-readable description of the last recognition error, or `null` when
   * there is no error.
   */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Wrap the browser Web Speech API in a React-friendly hook.
 *
 * @example
 * ```tsx
 * const { isListening, transcript, interimTranscript, startListening, stopListening, error } =
 *   useSpeechRecognition();
 * ```
 */
export function useSpeechRecognition(): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  // shouldBeListening tracks user intent independently of the browser session
  // state so we can auto-restart when the engine stops unexpectedly.
  const shouldBeListeningRef = useRef(false);
  // Holds the active recognition instance.
  const recognitionRef = useRef<WebSpeechRecognition | null>(null);

  // ---------------------------------------------------------------------------
  // Resolve the constructor once (client-side only)
  // ---------------------------------------------------------------------------

  const getConstructor = useCallback((): WebSpeechRecognitionConstructor | null => {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
  }, []);

  // ---------------------------------------------------------------------------
  // Build and wire up a recognition instance
  // ---------------------------------------------------------------------------

  const createAndStart = useCallback(() => {
    const Constructor = getConstructor();

    if (!Constructor) {
      setError('Web Speech API is not supported in this browser.');
      return;
    }

    // Abort any existing session before creating a new one.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null; // Prevent re-entrant auto-restart.
        recognitionRef.current.abort();
      } catch {
        // Ignore errors from aborting an already-stopped session.
      }
      recognitionRef.current = null;
    }

    const recognition = new Constructor();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let finalSegment = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';

        if (result.isFinal) {
          finalSegment += text;
        } else {
          interim += text;
        }
      }

      if (finalSegment) {
        // Append committed text with a space separator.
        setTranscript((prev) => (prev ? `${prev} ${finalSegment.trim()}` : finalSegment.trim()));
      }

      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // 'aborted' fires when we call stop()/abort() ourselves – not a user-facing error.
      if (event.error === 'aborted') return;

      // 'no-speech' is benign; the engine will auto-restart via onend.
      if (event.error === 'no-speech') return;

      console.error('[useSpeechRecognition] Error:', event.error, event.message);
      setError(event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');

      // Auto-restart if the user still intends to listen.
      // This handles Chrome's hard ~60 s session limit and network blips.
      if (shouldBeListeningRef.current) {
        try {
          recognition.start();
        } catch {
          // start() throws if the session is already in the process of starting.
          // The next onstart event will set isListening back to true.
        }
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      console.error('[useSpeechRecognition] Failed to start:', err);
      setError('Failed to start speech recognition.');
    }
  }, [getConstructor]);

  // ---------------------------------------------------------------------------
  // Public controls
  // ---------------------------------------------------------------------------

  const startListening = useCallback(() => {
    if (shouldBeListeningRef.current) return; // Already active.

    shouldBeListeningRef.current = true;
    // Reset accumulated transcript when starting a new session.
    setTranscript('');
    setInterimTranscript('');
    setError(null);

    createAndStart();
  }, [createAndStart]);

  const stopListening = useCallback(() => {
    shouldBeListeningRef.current = false;
    setIsListening(false);
    setInterimTranscript('');

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null; // Prevent auto-restart.
        recognitionRef.current.stop();
      } catch (err) {
        console.error('[useSpeechRecognition] Failed to stop:', err);
      }
      recognitionRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      shouldBeListeningRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.abort();
        } catch {
          // Ignore – component is unmounting.
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    error,
  };
}
