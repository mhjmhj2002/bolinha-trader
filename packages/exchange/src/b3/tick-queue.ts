import { EventEmitter } from 'node:events';
import type { MarketTickEvent, MarketCandleEvent } from '@bolinha/core';

export interface TickQueueOptions {
  /** Capacidade máxima de eventos na fila para evitar vazamento de memória */
  maxQueueSize?: number;
  /** Se true, substitui ticks anteriores do mesmo ativo pelo mais recente quando houver congestionamento */
  deduplicateBySymbol?: boolean;
}

/**
 * Fila em memória desacoplada e concorrente para recepção e processamento de eventos de mercado em tempo real.
 * Permite que um receptor (ex: WebSocket listener ou polling assíncrono rápido) empilhe ticks
 * enquanto consumidores (ex: Risk Engine / Worker) processam saídas imediatas com latência mínima.
 */
export class TickEventQueue extends EventEmitter {
  private queue: (MarketTickEvent | MarketCandleEvent)[] = [];
  private readonly maxQueueSize: number;
  private readonly deduplicateBySymbol: boolean;
  private isProcessing = false;
  private isClosed = false;

  constructor(options: TickQueueOptions = {}) {
    super();
    this.maxQueueSize = options.maxQueueSize ?? 10_000;
    this.deduplicateBySymbol = options.deduplicateBySymbol ?? true;
  }

  /**
   * Enfileira um novo tick de preço.
   * Se a fila estiver cheia e a deduplicação estiver ativa, compacta ticks velhos do mesmo ativo.
   */
  enqueueTick(event: MarketTickEvent): boolean {
    if (this.isClosed) return false;
    if (!event.symbol || !Number.isFinite(event.price) || event.price <= 0) return false;

    if (this.queue.length >= this.maxQueueSize) {
      if (this.deduplicateBySymbol) {
        // Remove ticks mais antigos do mesmo ativo para liberar espaço sem perder a cotação mais recente
        const initialLen = this.queue.length;
        this.queue = this.queue.filter((item) => !('price' in item && item.symbol === event.symbol));
        if (this.queue.length === initialLen) {
          // Se ainda estiver cheia, descarta o mais antigo da cabeça (FIFO drop)
          this.queue.shift();
        }
      } else {
        this.queue.shift();
      }
    }

    this.queue.push(event);
    this.emit('enqueue', event);
    this.emit('tick', event);
    return true;
  }

  /**
   * Enfileira evento de fechamento de candle.
   */
  enqueueCandle(event: MarketCandleEvent): boolean {
    if (this.isClosed) return false;
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push(event);
    this.emit('enqueue', event);
    this.emit('candle', event);
    return true;
  }

  /**
   * Retira o próximo evento da fila (FIFO).
   */
  dequeue(): MarketTickEvent | MarketCandleEvent | undefined {
    return this.queue.shift();
  }

  /**
   * Retorna o tamanho atual da fila.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Limpa todos os eventos pendentes na fila.
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Fecha a fila e encerra a recepção.
   */
  close(): void {
    this.isClosed = true;
    this.clear();
    this.removeAllListeners();
  }
}
