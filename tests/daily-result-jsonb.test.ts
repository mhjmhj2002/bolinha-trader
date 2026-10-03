import { describe, expect, it } from 'vitest';
import { serializeJsonb } from '@bolinha/database';

describe('daily_result jsonb serialization', () => {
  it('makes model arrays valid JSON rather than PostgreSQL array syntax', () => {
    const models = ['poolside/laguna-s-2.1:free', 'qwen/qwen3.8-27b:free'];
    expect(serializeJsonb(models)).toBe('["poolside/laguna-s-2.1:free","qwen/qwen3.8-27b:free"]');
    expect(JSON.parse(serializeJsonb(models))).toEqual(models);
    expect(JSON.parse(serializeJsonb([]))).toEqual([]);
  });

  it('makes fee maps valid JSON, including empty maps', () => {
    const fees = { USDT: 0.01, BTC: 0.0000001 };
    expect(JSON.parse(serializeJsonb(fees))).toEqual(fees);
    expect(JSON.parse(serializeJsonb({}))).toEqual({});
  });
});
