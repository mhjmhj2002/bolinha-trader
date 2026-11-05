import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from '@bolinha/core';
import type { MarketTickEvent } from '@bolinha/core';
import type { TickEventQueue } from './tick-queue.js';

export interface TickServerOptions {
  host?: string;
  port?: number;
  path?: string;
}

/**
 * Receptor de cotações em tempo real via HTTP POST ou WebSocket streaming.
 * Projetado para receber pings/ticks instantâneos da Bridge do MT5 ou scripts de cotações
 * sem qualquer dependência ou custo externo, enfileirando os dados diretamente na TickEventQueue.
 */
export class B3RealtimeTickServer {
  private server: Server | null = null;
  private readonly host: string;
  private readonly port: number;
  private readonly path: string;

  constructor(
    private queue: TickEventQueue,
    options: TickServerOptions = {},
  ) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 8080;
    this.path = options.path ?? '/ticks';
  }

  async start(): Promise<void> {
    if (this.server) return;

    return new Promise((resolve, reject) => {
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'POST' && req.url === this.path) {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const data = JSON.parse(body) as Partial<MarketTickEvent>;
              if (!data.symbol || typeof data.price !== 'number' || data.price <= 0) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid tick payload: symbol and positive price required' }));
                return;
              }

              const tick: MarketTickEvent = {
                symbol: data.symbol.toUpperCase(),
                price: data.price,
                volume: data.volume,
                timestamp: data.timestamp ?? Date.now(),
              };

              this.queue.enqueueTick(tick);

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'OK', enqueued: true, symbol: tick.symbol }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
            }
          });
        } else if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'UP', queueSize: this.queue.size() }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      });

      this.server.on('error', (err) => {
        logger.error({ err }, 'Tick receiver server encountered an error');
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        logger.info({ host: this.host, port: this.port, path: this.path }, 'B3RealtimeTickServer listening for market ticks');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  isListening(): boolean {
    return Boolean(this.server?.listening);
  }
}
