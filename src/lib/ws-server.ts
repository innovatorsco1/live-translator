/**
 * WebSocket server – standalone module.
 *
 * Runs on a dedicated port (default: 3001) so that the WebSocket traffic is
 * separated from the Next.js HTTP server (port 3000).
 *
 * Optimised message routing:
 *   - 'translate_request'
 *       Server-side streaming translation.  The control panel sends raw text;
 *       the server translates via OpenAI streaming and pushes
 *       'translation_chunk' messages to all display clients as tokens arrive,
 *       followed by a final 'translation' message.
 *       This eliminates the HTTP round-trip through /api/translate.
 *
 *   - 'translation' / 'transcript' / 'status'
 *       Broadcast to every OTHER connected client (relay model).
 *
 *   - 'control' { action: 'clear' }
 *       Broadcast the clear command to all clients.
 *   - 'control' { action: 'settings' }
 *       Broadcast the updated DisplaySettings to all connected clients.
 *   - 'control' { action: 'start' | 'stop' }
 *       Relay to all other clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type {
  WSMessage,
  ControlCommand,
  TranslateRequest,
  TranslationMessage,
  TranslationChunk,
} from '@/types';
import { translateTextStream } from './translation';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WS_PORT = parseInt(process.env.WS_PORT || '3001', 10);

// ---------------------------------------------------------------------------
// Server singleton
// ---------------------------------------------------------------------------

let wss: WebSocketServer | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the WebSocket server.  If the server is already running the existing
 * instance is returned without creating a second one.
 */
export function startWSServer(): WebSocketServer {
  if (wss) return wss;

  wss = new WebSocketServer({ port: WS_PORT });

  console.log(`[ws-server] WebSocket server running on port ${WS_PORT}`);

  wss.on('connection', (ws: WebSocket) => {
    console.log('[ws-server] Client connected');

    safeSend(ws, {
      type: 'status',
      payload: { isListening: false, isConnected: true },
    });

    ws.on('message', (data: Buffer) => {
      let message: WSMessage;
      try {
        message = JSON.parse(data.toString()) as WSMessage;
      } catch (e) {
        console.error('[ws-server] Received unparseable message:', e);
        return;
      }

      handleMessage(message, ws);
    });

    ws.on('close', () => {
      console.log('[ws-server] Client disconnected');
    });

    ws.on('error', (err: Error) => {
      console.error('[ws-server] Socket error:', err.message);
    });
  });

  wss.on('error', (err: Error) => {
    console.error('[ws-server] Server error:', err.message);
  });

  return wss;
}

/**
 * Broadcast a message to ALL connected clients.
 */
export function broadcastToAll(message: WSMessage): void {
  if (!wss) return;
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function handleMessage(message: WSMessage, sender: WebSocket): void {
  switch (message.type) {
    case 'translate_request': {
      // Server-side streaming translation – the big latency win.
      handleTranslateRequest(message.payload, sender);
      break;
    }

    case 'translation':
    case 'transcript': {
      broadcastExcluding(message, sender);
      break;
    }

    case 'translation_chunk': {
      // Chunks originate from the server, not clients. Ignore if received.
      break;
    }

    case 'control': {
      const command = message.payload as ControlCommand;
      switch (command.action) {
        case 'clear':
          broadcastToAll(message);
          break;
        case 'settings':
          broadcastToAll(message);
          break;
        case 'start':
        case 'stop':
          broadcastExcluding(message, sender);
          break;
        default:
          console.warn('[ws-server] Unknown control action:', (command as ControlCommand).action);
      }
      break;
    }

    case 'status': {
      console.warn('[ws-server] Received unexpected status frame from client – ignoring');
      break;
    }

    default: {
      console.warn('[ws-server] Unknown message type received:', (message as { type: string }).type);
    }
  }
}

/**
 * Handle a translate_request: run streaming translation server-side and push
 * chunks + final result to all clients (including the sender so it can update
 * its history).
 */
async function handleTranslateRequest(
  req: TranslateRequest,
  sender: WebSocket,
): Promise<void> {
  const { id, text, timestamp } = req;

  // Immediately broadcast the transcript (original text) so the display
  // can show it while translation is in progress.
  const transcriptMsg: WSMessage = {
    type: 'transcript',
    payload: {
      id,
      originalText: text,
      translatedText: '…',
      timestamp,
      isFinal: false,
    },
  };
  broadcastToAll(transcriptMsg);

  try {
    const fullTranslation = await translateTextStream(
      text,
      (chunk: string, accumulated: string) => {
        // Stream each chunk to all clients.
        const chunkMsg: WSMessage = {
          type: 'translation_chunk',
          payload: {
            id,
            chunk,
            accumulated,
            originalText: text,
            done: false,
          } satisfies TranslationChunk,
        };
        broadcastToAll(chunkMsg);
      },
    );

    // Send the final complete translation.
    const finalMsg: WSMessage = {
      type: 'translation',
      payload: {
        id,
        originalText: text,
        translatedText: fullTranslation,
        timestamp,
        isFinal: true,
      } satisfies TranslationMessage,
    };
    broadcastToAll(finalMsg);

    // Send a done chunk so displays know streaming is complete for this id.
    const doneChunk: WSMessage = {
      type: 'translation_chunk',
      payload: {
        id,
        chunk: '',
        accumulated: fullTranslation,
        originalText: text,
        done: true,
      } satisfies TranslationChunk,
    };
    broadcastToAll(doneChunk);
  } catch (error) {
    console.error('[ws-server] Translation error for segment', id, error);

    // Send a failed translation so the UI doesn't hang.
    const errorMsg: WSMessage = {
      type: 'translation',
      payload: {
        id,
        originalText: text,
        translatedText: '[Translation failed]',
        timestamp,
        isFinal: true,
      },
    };
    broadcastToAll(errorMsg);
  }
}

function broadcastExcluding(message: WSMessage, exclude: WebSocket): void {
  if (!wss) return;
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function safeSend(ws: WebSocket, message: WSMessage): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  } catch (err) {
    console.error('[ws-server] safeSend error:', err);
  }
}
