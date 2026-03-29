/**
 * Custom Next.js server entry point.
 *
 * Responsibilities:
 *  1. Boot the Next.js application (handles all HTTP traffic on PORT, default 3000).
 *  2. Start the standalone WebSocket server (WS_PORT, default 3001) so that
 *     real-time translation messages can flow between the control panel and
 *     the display view without going through the Next.js request cycle.
 *
 * Usage:
 *   npx ts-node --project tsconfig.server.json server.ts
 *   # or via the npm script:  npm run dev:server
 *
 * Environment variables (see .env.example):
 *   PORT     – HTTP port for the Next.js app.  Defaults to 3000.
 *   WS_PORT  – WebSocket server port.          Defaults to 3001.
 *   NODE_ENV – Set to 'production' for a production build.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import next from 'next';
import { startWSServer } from './src/lib/ws-server';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

// ---------------------------------------------------------------------------
// Next.js application bootstrap
// ---------------------------------------------------------------------------

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    // -----------------------------------------------------------------------
    // 1. Start the WebSocket server on its own port BEFORE accepting HTTP
    //    connections so that clients that connect immediately after server
    //    start find the WS endpoint already available.
    // -----------------------------------------------------------------------
    startWSServer();

    // -----------------------------------------------------------------------
    // 2. Create the HTTP server and delegate every request to Next.js.
    // -----------------------------------------------------------------------
    const httpServer = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        try {
          // `parse` returns a Url object; Next.js handle() needs the query
          // object to be populated so set `true` as the second argument.
          const parsedUrl = parse(req.url ?? '/', true);
          await handle(req, res, parsedUrl);
        } catch (err) {
          console.error('[server] Error handling request', req.url, err);
          res.statusCode = 500;
          res.end('Internal server error');
        }
      },
    );

    // -----------------------------------------------------------------------
    // 3. Graceful shutdown – close both servers cleanly on SIGTERM / SIGINT.
    // -----------------------------------------------------------------------
    const shutdown = (signal: string) => {
      console.log(`\n[server] Received ${signal}. Shutting down gracefully…`);
      httpServer.close(() => {
        console.log('[server] HTTP server closed.');
        process.exit(0);
      });
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));

    // -----------------------------------------------------------------------
    // 4. Start listening.
    // -----------------------------------------------------------------------
    httpServer.listen(port, hostname, () => {
      console.log(`[server] Next.js ready   → http://${hostname}:${port}`);
      console.log(`[server] WebSocket ready → ws://${hostname}:${process.env.WS_PORT ?? '3001'}`);
    });
  })
  .catch((err: Error) => {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  });
