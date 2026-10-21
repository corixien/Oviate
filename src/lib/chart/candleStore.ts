import type { PineCandles } from '$lib/pine/types.ts';

/** Candles each chart ran its strategy on (not reactive: large typed arrays). The optimizer reads them. */
export const candleStore = new Map<string, PineCandles>();
