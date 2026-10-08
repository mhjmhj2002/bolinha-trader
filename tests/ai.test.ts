import { describe, expect, it } from 'vitest';
import { buildPrompt, OpenRouterClient, parseAiContent } from '@bolinha/ai';
describe('AI parser', () => {
  it('parses valid JSON', () => expect(parseAiContent('{"acao":"BUY","valor_usdt":12,"confianca":0.7,"motivo":"x"}').action).toBe('BUY'));
  it('normalizes Portuguese and WAIT', () => {
    expect(parseAiContent('{"acao":"COMPRAR","valor_usdt":12,"confianca":0.7,"motivo":"x"}').action).toBe('BUY');
    expect(parseAiContent('{"acao":"WAIT","valor_usdt":0,"confianca":0.7,"motivo":"x"}').action).toBe('HOLD');
  });
  it('states that SELL always closes the whole position', () =>
    expect(buildPrompt({} as never, { initialBankUsdt: 20, cashUsdt: 10, realizedPnlUsdt: 0, aiCostUsd: 0 }, { quantity: .001, entryPrice: 10000, costUsdt: 10, openedAt: new Date() })).toMatch(/SELL significa fechar integralmente/));
  it('formats cash clearly with 2 decimals and provides clear buy/sell guidelines', () => {
    const prompt = buildPrompt(
      {} as never,
      { initialBankUsdt: 20, cashUsdt: 19.9999979, realizedPnlUsdt: 0, aiCostUsd: 0 },
      null
    );
    expect(prompt).toContain('caixa disponível para operar 20.00 USDT');
    expect(prompt).toContain('Você possui 20.00 USDT disponíveis integralmente para abrir nova posição caso decida por BUY.');
    expect(prompt).toContain('BUY: Proponha compra quando houver confluência técnica favorável');
    expect(prompt).toContain('SELL: Quando houver posição aberta e os indicadores apontarem perda de momentum');
    expect(prompt).not.toContain('Prefira HOLD sem sinal claro');
  });
  it('invalid or null becomes HOLD', () => {
    expect(parseAiContent(null).action).toBe('HOLD');
    expect(parseAiContent('{"acao":"BAD"}').action).toBe('HOLD');
  });
  it('uses fallback after invalid response', async () => {
    let n = 0;
    const fetchFn = async () => new Response(n++ === 0 ? '{"choices":[{"message":{"content":null}}]}' : '{"model":"two","choices":[{"message":{"content":"{\\"acao\\":\\"HOLD\\",\\"valor_usdt\\":0,\\"confianca\\":1,\\"motivo\\":\\"x\\"}"}}]}', { status: 200 });
    const result = await new OpenRouterClient('key', ['one', 'two'], fetchFn as typeof fetch).decide('x');
    expect(result.decision.action).toBe('HOLD');
    expect(result.usage.modelRequested).toBe('two');
  });
  it('respects custom timeout and handles abort', async () => {
    let receivedSignal: AbortSignal | undefined;
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      receivedSignal = init?.signal as AbortSignal;
      const error = new Error('The operation was aborted');
      error.name = 'TimeoutError';
      throw error;
    };
    const client = new OpenRouterClient('key', ['model-a'], fetchFn as typeof fetch, 45_000);
    const result = await client.decide('prompt');
    expect(receivedSignal).toBeDefined();
    expect(result.decision.action).toBe('HOLD');
    expect(result.usage.error).toContain('aborted');
  });
});
