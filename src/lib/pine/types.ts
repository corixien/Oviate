// Shared types for the Pine engine.

export interface PineCandles {
  n: number;
  t: Float64Array; // unix seconds
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  v: Float64Array;
}

export interface PineInput {
  id: string;
  title: string;
  type: 'int' | 'float' | 'bool' | 'string' | 'color' | 'source' | 'timeframe' | 'symbol';
  def: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: (number | string)[];
  group?: string;
  tooltip?: string;
}

export interface PlotOut {
  id: number;
  title: string;
  values: Float64Array;
  color: string;
  /** Per-bar colors when the script computes the color series. */
  colors?: (string | undefined)[];
  style: string;
  linewidth: number;
  offset: number;
  histbase: number;
}

export interface ShapeOut {
  id: number;
  title: string;
  style: string;
  location: string;
  color: string;
  textColor: string;
  text: string;
  size: string;
  /** 1 where the shape is drawn. */
  flags: Uint8Array;
  colors?: (string | undefined)[];
  offset: number;
}

export interface HLineOut { id: number; price: number; title: string; color: string; style: string; linewidth: number }

export interface FillRef { kind: 'plot' | 'hline'; id: number }
export interface FillOut { a: FillRef; b: FillRef; color: string; colors?: (string | undefined)[] }

export interface PineMeta {
  kind: 'indicator' | 'strategy' | 'library';
  title: string;
  shorttitle: string;
  overlay: boolean;
  initialCapital?: number;
  defaultQtyType?: string;
  defaultQtyValue?: number;
  commissionType?: string;
  commissionValue?: number;
  pyramiding?: number;
  slippage?: number;
  /** price precision hint from the script, if any */
  precision?: number;
}

export interface PineResult {
  meta: PineMeta;
  inputs: PineInput[];
  plots: PlotOut[];
  shapes: ShapeOut[];
  hlines: HLineOut[];
  fills: FillOut[];
  bgcolors: (string | undefined)[];
  barcolors: (string | undefined)[];
  warnings: string[];
  error?: { message: string; line?: number };
  strategy?: StrategyResult;
}

export interface TradeRec {
  id: string;
  dir: 'long' | 'short';
  qty: number;
  entryBar: number;
  entryTime: number;
  entryPrice: number;
  exitBar: number;
  exitTime: number;
  exitPrice: number;
  pnl: number;
  commission: number;
  entryComment: string;
  exitComment: string;
  open: boolean;
  /** max favorable / adverse excursion (price distance * qty) */
  mfe: number;
  mae: number;
}

export interface StrategyResult {
  trades: TradeRec[];
  equity: Float64Array;
  /** realised + unrealised equity per bar */
  netProfit: number;
  initialCapital: number;
  openPosition: { dir: 'long' | 'short'; qty: number; avg: number } | null;
}
