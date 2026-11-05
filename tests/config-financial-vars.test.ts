import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  config,
  configSchema,
  DEFAULT_INITIAL_BANK_BRL,
  DEFAULT_MAX_POSITION_PERCENT,
  validateStartupConfiguration,
} from '@bolinha/core';
import { B3PaperBroker, B3MarketDataService, createBrokerGateway } from '@bolinha/exchange';

describe('TASK-18: financial config variables in the Zod schema', () => {
  describe('configSchema parsing and coercion', () => {
    it('coerces INITIAL_BANK_BRL, INITIAL_BANK_USDT and MAX_POSITION_PERCENT from strings', () => {
      const parsed = configSchema.parse({
        INITIAL_BANK_BRL: '250.50',
        INITIAL_BANK_USDT: '300',
        MAX_POSITION_PERCENT: '35',
      });

      expect(parsed.INITIAL_BANK_BRL).toBe(250.5);
      expect(parsed.INITIAL_BANK_USDT).toBe(300);
      expect(parsed.MAX_POSITION_PERCENT).toBe(35);
    });

    it('applies the safe defaults when the variables are absent', () => {
      const parsed = configSchema.parse({});

      expect(parsed.INITIAL_BANK_BRL).toBe(DEFAULT_INITIAL_BANK_BRL);
      expect(parsed.INITIAL_BANK_BRL).toBe(100);
      expect(parsed.MAX_POSITION_PERCENT).toBe(DEFAULT_MAX_POSITION_PERCENT);
      expect(parsed.MAX_POSITION_PERCENT).toBe(100);
      expect(parsed.INITIAL_BANK_USDT).toBeUndefined();
    });

    it('consolidates the legacy INITIAL_BANK_USDT alias into the canonical INITIAL_BANK_BRL', () => {
      const legacyOnly = configSchema.parse({ INITIAL_BANK_USDT: '420' });
      expect(legacyOnly.INITIAL_BANK_BRL).toBe(420);

      const canonicalWins = configSchema.parse({ INITIAL_BANK_BRL: '180', INITIAL_BANK_USDT: '420' });
      expect(canonicalWins.INITIAL_BANK_BRL).toBe(180);
    });

    it.each([
      ['zero bank', { INITIAL_BANK_BRL: '0' }],
      ['negative bank', { INITIAL_BANK_BRL: '-100' }],
      ['non-numeric bank', { INITIAL_BANK_BRL: 'abc' }],
      ['infinite bank', { INITIAL_BANK_BRL: 'Infinity' }],
      ['zero legacy bank', { INITIAL_BANK_USDT: '0' }],
      ['negative legacy bank', { INITIAL_BANK_USDT: '-5' }],
    ])('rejects an invalid bank value: %s', (_label, input) => {
      expect(() => configSchema.parse(input)).toThrow();
    });

    it.each([
      ['zero percent', '0'],
      ['negative percent', '-10'],
      ['over 100 percent', '100.5'],
      ['non-numeric percent', 'lots'],
    ])('rejects an invalid MAX_POSITION_PERCENT: %s', (_label, value) => {
      expect(() => configSchema.parse({ MAX_POSITION_PERCENT: value })).toThrow();
    });

    it('accepts the inclusive MAX_POSITION_PERCENT bounds of 1 and 100', () => {
      expect(configSchema.parse({ MAX_POSITION_PERCENT: '1' }).MAX_POSITION_PERCENT).toBe(1);
      expect(configSchema.parse({ MAX_POSITION_PERCENT: '100' }).MAX_POSITION_PERCENT).toBe(100);
    });
  });

  describe('OPENROUTER_API_KEY startup validation', () => {
    const captureLogger = () => {
      const calls: Array<{ context: unknown; message: unknown }> = [];
      return {
        calls,
        logger: { warn: (context: unknown, message: unknown) => calls.push({ context, message }) },
      };
    };

    it('emits a loud WARN and does not throw when OPENROUTER_API_KEY is empty', () => {
      const { calls, logger } = captureLogger();
      const result = validateStartupConfiguration({ OPENROUTER_API_KEY: '' }, logger);

      expect(result.openRouterApiKeyConfigured).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/OPENROUTER_API_KEY/);
      expect(result.warnings[0]).toMatch(/HOLD/);
      expect(calls).toHaveLength(1);
      expect(calls[0].context).toMatchObject({ event: 'openrouter_api_key_missing', decisions: 'HOLD' });
      expect(calls[0].message).toMatch(/every decision will be HOLD/);
    });

    it('treats a whitespace-only OPENROUTER_API_KEY as missing', () => {
      const { calls, logger } = captureLogger();
      const result = validateStartupConfiguration({ OPENROUTER_API_KEY: '   ' }, logger);

      expect(result.openRouterApiKeyConfigured).toBe(false);
      expect(calls).toHaveLength(1);
    });

    it('stays silent when OPENROUTER_API_KEY is configured', () => {
      const { calls, logger } = captureLogger();
      const result = validateStartupConfiguration({ OPENROUTER_API_KEY: 'sk-or-v1-test' }, logger);

      expect(result.openRouterApiKeyConfigured).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(calls).toHaveLength(0);
    });
  });
});

describe('TASK-18: createBrokerGateway derives the starting capital from config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const loadWithEnv = async (env: Record<string, string>) => {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const exchange = await import('@bolinha/exchange');
    return exchange;
  };

  it('uses the configured INITIAL_BANK_BRL instead of the hardcoded 100.0', async () => {
    const exchange = await loadWithEnv({ INITIAL_BANK_BRL: '250' });
    const marketData = new exchange.B3MarketDataService();
    const broker = exchange.createBrokerGateway('PETR4', marketData);

    expect(broker).toBeInstanceOf(exchange.B3PaperBroker);
    const account = (broker as InstanceType<typeof exchange.B3PaperBroker>).getAccount();
    expect(account.initialBankBrl).toBe(250);
    expect(account.cashBrl).toBe(250);
    expect(account.initialBankBrl).not.toBe(100);
  });

  it('always derives the bank from the loaded config, never from a hardcoded literal', async () => {
    const exchange = await loadWithEnv({ INITIAL_BANK_BRL: '12.34' });
    const core = await import('@bolinha/core');
    const marketData = new exchange.B3MarketDataService();
    const broker = exchange.createBrokerGateway('PETR4', marketData);

    expect(core.config.INITIAL_BANK_BRL).toBe(12.34);
    expect((broker as InstanceType<typeof exchange.B3PaperBroker>).getAccount().cashBrl).toBe(
      core.config.INITIAL_BANK_BRL,
    );
  });

  it('falls back to the schema default bank when INITIAL_BANK_BRL is absent', async () => {
    const previous = process.env.INITIAL_BANK_BRL;
    delete process.env.INITIAL_BANK_BRL;
    try {
      const exchange = await loadWithEnv({});
      const marketData = new exchange.B3MarketDataService();
      const broker = exchange.createBrokerGateway('PETR4', marketData);

      expect((broker as InstanceType<typeof exchange.B3PaperBroker>).getAccount().cashBrl).toBe(
        DEFAULT_INITIAL_BANK_BRL,
      );
    } finally {
      if (previous !== undefined) process.env.INITIAL_BANK_BRL = previous;
    }
  });

  it('still accepts an explicit bank for callers that know the operational configuration', () => {
    const marketData = new B3MarketDataService();
    const broker = createBrokerGateway('PETR4', marketData, 77.5);

    expect(broker).toBeInstanceOf(B3PaperBroker);
    expect((broker as B3PaperBroker).getAccount().cashBrl).toBe(77.5);
  });

  it('keeps the one-argument call signature working (backward compatibility)', () => {
    const broker = createBrokerGateway('VALE3');

    expect(broker).toBeInstanceOf(B3PaperBroker);
    expect((broker as B3PaperBroker).getAccount().initialBankBrl).toBeGreaterThan(0);
  });
});

describe('C-1: B3PaperBroker constructor derives its default bank from config', () => {
  it('defaults initialBankBrl to config.INITIAL_BANK_BRL instead of a hardcoded literal', () => {
    const broker = new B3PaperBroker();

    expect(broker.getAccount().initialBankBrl).toBe(config.INITIAL_BANK_BRL);
    expect(broker.getAccount().cashBrl).toBe(config.INITIAL_BANK_BRL);
    expect(broker.getAccount().initialBankBrl).toBe(DEFAULT_INITIAL_BANK_BRL);
  });

  it('lets an explicit initialBankBrl still win over the config default', () => {
    const explicitBank = config.INITIAL_BANK_BRL + 42.5;
    const broker = new B3PaperBroker('PETR4', explicitBank);

    expect(broker.getAccount().initialBankBrl).toBe(explicitBank);
    expect(broker.getAccount().cashBrl).toBe(explicitBank);
    expect(broker.getAccount().initialBankBrl).not.toBe(config.INITIAL_BANK_BRL);
  });
});
