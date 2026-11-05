import { describe, expect, it } from 'vitest';
import {
  MISSING_REASON_FALLBACK,
  OpenRouterClient,
  buildB3Prompt,
  describeEntryConfluenceRule,
  normaliseConfidence,
  parseAiContent,
  resolveEntryGateRule,
  type BuyCapacityOptions,
} from '@bolinha/ai';
import { evaluateEntryConfluence, type IndicatorSet } from '@bolinha/market-data';
import { B3MarketDataService, B3PaperBroker, getB3SymbolRules } from '@bolinha/exchange';
import { applyB3Risk } from '@bolinha/risk-engine';

const wire = (payload: Record<string, unknown>): string => JSON.stringify(payload);

const jsonResponse = (content: string): string =>
  JSON.stringify({ model: 'mock/model', choices: [{ message: { content } }] });

describe('TASK-17: tolerant wire parsing (confidence normalisation)', () => {
  const table: Array<{ label: string; raw: unknown; expected: number }> = [
    { label: 'fraction 0.85', raw: 0.85, expected: 0.85 },
    { label: 'percent 85', raw: 85, expected: 0.85 },
    { label: 'literal 1 (upper fraction bound, must not become 0.01)', raw: 1, expected: 1 },
    { label: 'percent 100', raw: 100, expected: 1 },
    { label: 'zero', raw: 0, expected: 0 },
    { label: 'string "85"', raw: '85', expected: 0.85 },
    { label: 'string "85%"', raw: '85%', expected: 0.85 },
    { label: 'comma decimal "0,85"', raw: '0,85', expected: 0.85 },
  ];

  for (const { label, raw, expected } of table) {
    it(`normalises confidence given as ${label} -> ${expected}`, () => {
      expect(normaliseConfidence(raw)).toBe(expected);
      const decision = parseAiContent(
        wire({ acao: 'BUY', valor_usdt: 50, confianca: raw, motivo: 'confluencia ok' }),
      );
      expect(decision.action).toBe('BUY');
      expect(decision.parseFailed).toBe(false);
      expect(decision.confidence).toBe(expected);
    });
  }

  it('fails closed on out-of-range or non-numeric confidence', () => {
    for (const raw of [250, -5, 'alta']) {
      expect(normaliseConfidence(raw)).toBeNull();
      const decision = parseAiContent(wire({ acao: 'BUY', valor_usdt: 10, confianca: raw, motivo: 'x' }));
      expect(decision.action).toBe('HOLD');
      expect(decision.amountUsdt).toBe(0);
      expect(decision.parseFailed).toBe(true);
    }
    expect(normaliseConfidence(Number.NaN)).toBeNull();
    expect(normaliseConfidence(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('accepts the previous strict fraction payloads unchanged', () => {
    const decision = parseAiContent(wire({ acao: 'SELL', valor_usdt: 12.5, confianca: 0.7, motivo: 'stop' }));
    expect(decision).toMatchObject({ action: 'SELL', amountUsdt: 12.5, confidence: 0.7, parseFailed: false });
  });
});

describe('TASK-17: tolerant wire parsing (key aliases)', () => {
  it('maps English keys to the canonical decision', () => {
    const decision = parseAiContent(
      wire({ action: 'BUY', amount_usdt: 42.5, confidence: 0.9, reason: 'ema9 above ema21 on all frames' }),
    );
    expect(decision.action).toBe('BUY');
    expect(decision.amountUsdt).toBe(42.5);
    expect(decision.confidence).toBe(0.9);
    expect(decision.reason).toBe('ema9 above ema21 on all frames');
    expect(decision.parseFailed).toBe(false);
  });

  it('accepts value_usdt, percentage confidence and mixed casing/spacing', () => {
    const decision = parseAiContent(
      wire({ Action: 'COMPRAR', 'Value_USDT': 'R$ 12,50', Confidence: 85, Reason: 'rompimento' }),
    );
    expect(decision).toMatchObject({ action: 'BUY', amountUsdt: 12.5, confidence: 0.85, parseFailed: false });
  });

  it('defaults a missing motivo instead of discarding the decision', () => {
    const decision = parseAiContent(wire({ action: 'HOLD', amount_usdt: 0, confidence: 1 }));
    expect(decision.action).toBe('HOLD');
    expect(decision.parseFailed).toBe(false);
    expect(decision.reason).toBe(MISSING_REASON_FALLBACK);
  });
});

describe('TASK-17: fail-closed parsing with a machine-readable marker', () => {
  const invalidPayloads: Array<{ label: string; content: string | null; reasonMatch: RegExp }> = [
    { label: 'null content', content: null, reasonMatch: /empty content/ },
    { label: 'non-JSON text', content: 'the market looks bullish today', reasonMatch: /Invalid AI JSON/ },
    { label: 'unknown action word', content: wire({ acao: 'MAYBE', valor_usdt: 10, confianca: 1, motivo: 'x' }), reasonMatch: /Invalid AI action/ },
    { label: 'missing action', content: wire({ valor_usdt: 10, confianca: 1, motivo: 'x' }), reasonMatch: /Invalid AI response schema/ },
    { label: 'negative amount', content: wire({ acao: 'BUY', valor_usdt: -10, confianca: 1, motivo: 'x' }), reasonMatch: /Invalid AI amount/ },
  ];

  for (const { label, content, reasonMatch } of invalidPayloads) {
    it(`keeps HOLD with parseFailed=true for ${label}`, () => {
      const decision = parseAiContent(content);
      expect(decision.action).toBe('HOLD');
      expect(decision.amountUsdt).toBe(0);
      expect(decision.confidence).toBe(0);
      expect(decision.parseFailed).toBe(true);
      expect(decision.reason).toMatch(reasonMatch);
    });
  }

  it('a motivo starting with "Invalid" is accepted and never treated as a parse failure', () => {
    const decision = parseAiContent(
      wire({ acao: 'HOLD', valor_usdt: 0, confianca: 0.4, motivo: 'Invalidada a compra por falta de confluência em 15m' }),
    );
    expect(decision.parseFailed).toBe(false);
    expect(decision.action).toBe('HOLD');
    expect(decision.reason).toBe('Invalidada a compra por falta de confluência em 15m');
  });

  it('does not burn a retry when the motivo starts with "Invalid"', async () => {
    const requested: string[] = [];
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      requested.push(JSON.parse(String(init?.body)).model);
      return new Response(
        jsonResponse(
          wire({ acao: 'BUY', valor_usdt: 30, confianca: 0.75, motivo: 'Invalidados os riscos de queda, confluência total' }),
        ),
        { status: 200 },
      );
    };
    const client = new OpenRouterClient('key', ['model/a', 'model/b'], fetchFn as typeof fetch);
    const result = await client.decide('prompt');
    expect(requested).toEqual(['model/a']);
    expect(result.decision.action).toBe('BUY');
    expect(result.decision.parseFailed).toBe(false);
    expect(result.usage.fallbackUsed).toBe(false);
  });

  it('rotates models on a genuine parse failure and still returns fail-closed HOLD with amount 0', async () => {
    const requested: string[] = [];
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      requested.push(JSON.parse(String(init?.body)).model);
      return new Response(jsonResponse('{"acao":"MAYBE","valor_usdt":10}'), { status: 200 });
    };
    const client = new OpenRouterClient('key', ['model/a', 'model/b'], fetchFn as typeof fetch);
    const result = await client.decide('prompt');
    expect(requested).toEqual(['model/a', 'model/b']);
    expect(result.decision.action).toBe('HOLD');
    expect(result.decision.amountUsdt).toBe(0);
    expect(result.decision.parseFailed).toBe(true);
    expect(result.usage.error).toContain('Invalid AI action');
  });
});

describe('TASK-17: prompt mirrors the deterministic entry gate', () => {
  const prompt = (entryGate = {}): string =>
    buildB3Prompt({} as never, { initialBankBrl: 100, cashBrl: 100 }, null, 25, 0.012, 0.008, entryGate);

  it('describes RSI as applying to every configured entry timeframe, not only 5m', () => {
    const text = prompt({ rsiOverboughtThreshold: 70 });
    expect(text).not.toMatch(/RSI de 5m/);
    expect(text).not.toMatch(/RSI.*apenas.*5m/i);
    expect(text).toContain('RSI14 abaixo de 70');
    expect(text).toContain('(1m, 5m, 15m)');
    expect(text).toContain('o limite de RSI14 se aplica a cada um desses timeframes');
  });

  it('drops the phantom "volume não baixo" entry requirement', () => {
    expect(prompt()).not.toContain('volume não baixo');
    expect(prompt()).toContain('Volume não é verificado pelo motor de risco');
  });

  it('reflects a non-default timeframe list and RSI threshold', () => {
    const text = prompt({ timeframes: ['5m', '15m'], rsiOverboughtThreshold: 65, minConfluentTimeframes: 1 });
    expect(text).toContain('RSI14 abaixo de 65');
    expect(text).toContain('(5m, 15m)');
    expect(text).not.toContain('(1m, 5m, 15m)');
    expect(text).toContain('Confluência exigida: 1 de 2 timeframe(s)');
  });

  it('keeps the prompt gate sentence in sync with the gate implementation for non-default configs', () => {
    // Same inputs fed to both sides: any divergence shows up as a mismatch here.
    const timeframes = ['1m', '15m'] as const;
    const rsiOverboughtThreshold = 72;
    const options = { timeframes: [...timeframes], rsiOverboughtThreshold, minConfluentTimeframes: 2 };
    const rule = resolveEntryGateRule(options);
    expect(rule).toEqual({ timeframes: ['1m', '15m'], rsiOverboughtThreshold: 72, minConfluentTimeframes: 2 });

    // 1m overbought (RSI 76) but 15m fine: the gate rejects, and the prompt says RSI applies to 1m too.
    const overbought = (rsi14: number): IndicatorSet =>
      ({ ema9: 2, ema21: 1, rsi14 }) as unknown as IndicatorSet;
    const gate = evaluateEntryConfluence(
      { '1m': overbought(76.67), '15m': overbought(51.75) },
      options,
    );
    expect(gate.allowed).toBe(false);
    expect(gate.checks.find((check) => check.timeframe === '1m')?.rsiAcceptable).toBe(false);
    expect(describeEntryConfluenceRule(options)).toContain('RSI14 abaixo de 72');
    expect(describeEntryConfluenceRule(options)).toContain('(1m, 15m)');
  });

  it('exposes VWAP and distance percentage in prompt when present in snapshot', () => {
    const fakeSnapshot = {
      symbol: 'PETR4',
      capturedAt: new Date().toISOString(),
      vwap: 28.5,
      intervals: {
        '1m': { price: 29.0, vwap: 28.5 },
      },
    } as never;

    const text = buildB3Prompt(fakeSnapshot, { initialBankBrl: 100, cashBrl: 100 }, null, 29.0);
    expect(text).toContain('VWAP Intradiária: R$ 28.50');
    expect(text).toContain('+1.75%');
    expect(text).toContain('suporte institucional de referência');
    expect(text).toContain('BUY proibido se preço < VWAP');
  });
});

describe('TASK-21: prompt buy capacity is cost-aware and matches the risk engine', () => {
  const rules = getB3SymbolRules('PETR4');

  const promptFor = (cashBrl: number, currentPrice: number): string =>
    buildB3Prompt({} as never, { initialBankBrl: 100, cashBrl }, null, currentPrice);

  const approvedQty = (cashBrl: number, currentPrice: number): number => {
    const risk = applyB3Risk({
      action: 'BUY',
      requestedBrl: cashBrl,
      price: currentPrice,
      account: { initialBankBrl: cashBrl, cashBrl, realizedPnlBrl: 0 },
      position: null,
      rules,
      maxPositionPercent: 100,
      duplicateOrderPending: false,
    });
    return risk.action === 'BUY' ? risk.quantity : 0;
  };

  it('advertises 9 shares (not 10) for cash 100.00 / price 10.00, and that quantity is approved and filled', async () => {
    const prompt = promptFor(100, 10);
    expect(prompt).toContain('capacidade máxima de compra atual: 9 ação(ões)');
    expect(prompt).not.toContain('10 ação(ões)');
    expect(prompt).toContain('até 9 ações');

    expect(approvedQty(100, 10)).toBe(9);
    const marketData = new B3MarketDataService();
    marketData.setMockPrice('PETR4', 10);
    const broker = new B3PaperBroker('PETR4', 100, marketData);
    const order = await broker.placeMarketOrder('BUY', 9, 'task21-prompt-100-10');
    expect(order.status).toBe('FILLED');
    expect(order.executedQty).toBe(9);
  });

  it('advertises 3 shares for cash 100.97 / price 30.20', () => {
    const prompt = promptFor(100.97, 30.2);
    expect(prompt).toContain('capacidade máxima de compra atual: 3 ação(ões)');
    expect(prompt).toContain('máx R$ 90.60');
    expect(approvedQty(100.97, 30.2)).toBe(3);
  });

  it('states there is no buying capacity for cash 5.00 / price 10.00 without nonsense quantities', () => {
    const prompt = promptFor(5, 10);
    expect(prompt).toContain('capacidade máxima de compra atual: sem capacidade de compra no momento');
    expect(prompt).toContain('NÃO há capacidade de compra neste ciclo');
    expect(prompt).not.toContain('0 ação(ões)');
    expect(prompt).not.toContain('máx R$ 0,00');
    expect(prompt).not.toMatch(/-\d+ ação/);
    expect(prompt).not.toMatch(/NaN|Infinity/);
    expect(prompt).toContain('Ações permitidas agora: HOLD (caixa insuficiente para compra de 1 ação)');
    expect(approvedQty(5, 10)).toBe(0);
  });

  it('never advertises a max amount above the available cash', () => {
    for (const cash of [5, 9.99, 60, 100, 100.97, 250.5, 1_000]) {
      for (const price of [0.99, 3.17, 7.5, 10, 25, 30.2, 47.83]) {
        const prompt = promptFor(cash, price);
        const advertised = prompt.match(/capacidade máxima de compra atual: (\d+) ação/)?.[1];
        if (!advertised) {
          // Zero capacity: the sentence must be the explicit "no capacity" one.
          expect(prompt).toContain('sem capacidade de compra no momento');
          continue;
        }
        const quantity = Number(advertised);
        expect(Number((quantity * price).toFixed(2))).toBeLessThanOrEqual(cash);
        expect(quantity).toBe(approvedQty(cash, price));
      }
    }
  });

  it('accepts an optional buffer option defaulting to the worker-configured value', () => {
    // Zero buffer is the only case where the exact notional fits (free room for fees).
    const zeroBuffer: BuyCapacityOptions = { buyCostBufferPct: 0, costModel: { slippagePct: 0, feeRate: 0 } };
    const withZero = buildB3Prompt({} as never, { initialBankBrl: 100, cashBrl: 100 }, null, 10, 0.012, 0.008, {}, zeroBuffer);
    expect(withZero).toContain('capacidade máxima de compra atual: 10 ação(ões)');
    // Default (no option) applies the configured fail-closed headroom.
    expect(promptFor(100, 10)).toContain('capacidade máxima de compra atual: 9 ação(ões)');
  });
});
