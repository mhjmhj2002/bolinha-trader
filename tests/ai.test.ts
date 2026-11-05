import { describe, expect, it } from 'vitest';
import { OpenRouterClient, parseAiContent } from '@bolinha/ai';
describe('AI parser', () => {
  it('parses valid JSON', () => expect(parseAiContent('{"acao":"BUY","valor_usdt":12,"confianca":0.7,"motivo":"x"}').action).toBe('BUY'));
  it('normalizes Portuguese and WAIT', () => {
    expect(parseAiContent('{"acao":"COMPRAR","valor_usdt":12,"confianca":0.7,"motivo":"x"}').action).toBe('BUY');
    expect(parseAiContent('{"acao":"WAIT","valor_usdt":0,"confianca":0.7,"motivo":"x"}').action).toBe('HOLD');
  });
  it('invalid or null becomes HOLD', () => {
    expect(parseAiContent(null).action).toBe('HOLD');
    expect(parseAiContent('{"acao":"BAD"}').action).toBe('HOLD');
  });
  it('uses fallback after invalid response and captures fallbackReason', async () => {
    let n = 0;
    const fetchFn = async () =>
      new Response(
        n++ === 0
          ? '{"choices":[{"message":{"content":null}}]}'
          : '{"model":"google/gemini-2.0-flash-001","choices":[{"message":{"content":"{\\"acao\\":\\"HOLD\\",\\"valor_usdt\\":0,\\"confianca\\":1,\\"motivo\\":\\"x\\"}"}}]}',
        { status: 200 },
      );
    const client = new OpenRouterClient('key', ['google/gemini-2.5-flash', 'google/gemini-2.0-flash-001'], fetchFn as typeof fetch);
    const result = await client.decide('x');
    expect(result.decision.action).toBe('HOLD');
    expect(result.usage.modelRequested).toBe('google/gemini-2.0-flash-001');
    expect(result.usage.fallbackUsed).toBe(true);
    expect(result.usage.fallbackReason).toContain('Triggered after prior model failure');
  });

  it('respects custom timeout and handles abort', async () => {
    let receivedSignal: AbortSignal | undefined;
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      receivedSignal = init?.signal as AbortSignal;
      const error = new Error('The operation was aborted');
      error.name = 'TimeoutError';
      throw error;
    };
    const client = new OpenRouterClient('key', ['google/gemini-2.5-flash'], fetchFn as typeof fetch, 45_000);
    const result = await client.decide('prompt');
    expect(receivedSignal).toBeDefined();
    expect(result.decision.action).toBe('HOLD');
    expect(result.usage.error).toContain('aborted');
  });

  it('retries on HTTP 429 with backoff and succeeds on subsequent attempt', async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      if (attempts === 1) {
        return new Response('Rate limited', {
          status: 429,
          headers: { 'retry-after': '0' },
        });
      }
      return new Response(
        '{"model":"google/gemini-2.5-flash","choices":[{"message":{"content":"{\\"acao\\":\\"BUY\\",\\"valor_usdt\\":50,\\"confianca\\":0.85,\\"motivo\\":\\"tendencia confirmada\\"}"}}]}',
        { status: 200 },
      );
    };

    const client = new OpenRouterClient(
      'key',
      ['google/gemini-2.5-flash'],
      fetchFn as typeof fetch,
      30_000,
      { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 },
    );

    const result = await client.decide('test prompt');
    expect(attempts).toBe(2);
    expect(result.decision.action).toBe('BUY');
    expect(result.usage.retriesUsed).toBe(1);
    expect(result.usage.rateLimit429Hit).toBe(true);
    expect(result.usage.fallbackUsed).toBe(false);
  });

  it('falls back to second model when primary model exhausts 429 retries', async () => {
    let attempts = 0;
    const fetchFn = async (_url: unknown, init?: RequestInit) => {
      attempts++;
      const body = JSON.parse(init?.body as string);
      if (body.model === 'primary-model') {
        return new Response('Too many requests', {
          status: 429,
          headers: { 'retry-after': '0' },
        });
      }
      return new Response(
        '{"model":"fallback-model","choices":[{"message":{"content":"{\\"acao\\":\\"BUY\\",\\"valor_usdt\\":50,\\"confianca\\":0.55,\\"motivo\\":\\"fallback signal\\"}"}}]}',
        { status: 200 },
      );
    };

    const client = new OpenRouterClient(
      'key',
      ['primary-model', 'fallback-model'],
      fetchFn as typeof fetch,
      30_000,
      { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5 },
    );

    const result = await client.decide('test prompt');
    // Primary was attempted twice (initial + 1 retry), then fallback succeeded on first try
    expect(attempts).toBe(3);
    expect(result.decision.action).toBe('BUY');
    expect(result.usage.modelRequested).toBe('fallback-model');
    expect(result.usage.fallbackUsed).toBe(true);
    expect(result.usage.rateLimit429Hit).toBe(true);
  });
});
