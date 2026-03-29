/**
 * WebSocket server – standalone module.
 *
 * Runs on a dedicated port (default: 3001) so that the WebSocket traffic is
 * separated from the Next.js HTTP server (port 3000).
 *
 * Message routing:
 *   - 'translation' / 'transcript' / 'status'
 *       Broadcast to every OTHER connected client (relay model).
 *   - 'control' { action: 'clear' }
 *       Broadcast the clear command to all clients including the sender so
 *       that the control panel UI also resets its local buffer.
 *   - 'control' { action: 'settings' }
 *       Broadcast the updated DisplaySettings to all connected clients so
 *       that every display view picks up the change immediately.
 *   - 'control' { action: 'start' | 'stop' }
 *       Relay to all other clients so the display knows the pipeline state.
 *
 * Exports:
 *   startWSServer()   – idempotent; safe to call multiple times.
 *   broadcastToAll()  – utility used by other server-side modules (e.g. STT).
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { WSMessage, ControlCommand } from '@/types';

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

    // Immediately tell the new client what the current server state is.
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
      // Log socket-level errors without crashing the server process.
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
 * Intended for use by other server-side modules (e.g. a future STT pipeline)
 * that need to push messages without an originating WebSocket client.
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

/**
 * Route an incoming message to the appropriate broadcast strategy.
 *
 * @param message - Parsed WSMessage received from a client.
 * @param sender  - The originating WebSocket connection.
 */
function handleMessage(message: WSMessage, sender: WebSocket): void {
  switch (message.type) {
    case 'translation':
    case 'transcript': {
      // Relay to every other connected client (the sender already has the data).
      broadcastExcluding(message, sender);
      break;
    }

    case 'control': {
      const command = message.payload as ControlCommand;
      switch (command.action) {
        case 'clear':
          // All clients (including the sender) must flush their display buffer.
          broadcastToAll(message);
          break;

        case 'settings':
          // Push updated display settings to every connected client.
          broadcastToAll(message);
          break;

        case 'start':
        case 'stop':
          // Let all other clients know the pipeline state changed.
          broadcastExcluding(message, sender);
          break;

        default:
          console.warn('[ws-server] Unknown control action:', (command as ControlCommand).action);
      }
      break;
    }

    case 'status': {
      // Status frames originate from the server; clients should not send them.
      // Log and discard rather than relaying to avoid loops.
      console.warn('[ws-server] Received unexpected status frame from client – ignoring');
      break;
    }

    default: {
      // Narrowing exhaustion guard: log unknown message types rather than
      // silently dropping them so they surface during development.
      console.warn('[ws-server] Unknown message type received:', (message as { type: string }).type);
    }
  }
}

/**
 * Send a message to every OPEN client except the one supplied in `exclude`.
 */
function broadcastExcluding(message: WSMessage, exclude: WebSocket): void {
  if (!wss) return;
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

/**
 * Serialise and send a message to a single client, swallowing any send
 * errors so one bad socket does not affect the others.
 */
function safeSend(ws: WebSocket, message: WSMessage): void {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  } catch (err) {
    console.error('[ws-server] safeSend error:', err);
  }
}
