import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({ resolve: { alias: {
  '@bolinha/core': resolve('packages/core/src/index.ts'),
  '@bolinha/market-data': resolve('packages/market-data/src/index.ts'),
  '@bolinha/ai': resolve('packages/ai/src/index.ts'),
  '@bolinha/risk-engine': resolve('packages/risk-engine/src/index.ts'),
  '@bolinha/exchange': resolve('packages/exchange/src/index.ts'),
  '@bolinha/database': resolve('packages/database/src/index.ts')
} } });
