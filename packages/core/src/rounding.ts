/**
 * Arredondamento para o múltiplo inteiro de `step` imediatamente ABAIXO do valor.
 * Vive em módulo próprio (e não no `index.ts` de `@bolinha/core`) para que
 * `b3-costs.ts` possa usá-lo sem importar o `index.ts` (o que criaria um ciclo
 * `index -> b3-costs -> index`).
 */
export const roundStepDown = (value: number, step: number) => Math.floor((value + 1e-12) / step) * step;
