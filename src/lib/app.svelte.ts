import { kvGet, kvSet, type Tf } from './api';
import type { ChartType } from './chart/transforms';
import type { Drawing, DrawTool } from './chart/renderer';
import type { Lang } from './i18n';

export interface ChartCfg {
  id: string;
  symbol: string;
  tf: Tf;
  type: ChartType;
  indicators: { uid: string; id: string; params: Record<string, number> }[];
  drawings: Drawing[];
  log: boolean;
  volume: boolean;
}

export type LayoutId = '1' | '2v' | '2h' | '3' | '4';
export const LAYOUT_COUNT: Record<LayoutId, number> = { '1': 1, '2v': 2, '2h': 2, '3': 3, '4': 4 };

export function newChart(symbol = 'AAPL', tf: Tf = '1d'): ChartCfg {
  return { id: crypto.randomUUID(), symbol, tf, type: 'candles', indicators: [], drawings: [], log: false, volume: true };
}

class App {
  layout = $state<LayoutId>('1');
  charts = $state<ChartCfg[]>([newChart('AAPL'), newChart('MSFT'), newChart('BTC/USD'), newChart('SPY')]);
  active = $state(0);
  theme = $state<'dark' | 'light'>('dark');
  lang = $state<Lang>('en');
  anim = $state(true);
  grid = $state(true);
  magnet = $state(false);
  sync = $state(true);
  watchlist = $state<string[]>(['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'BTC/USD', 'ETH/USD']);
  showWatchlist = $state(true);
  tool = $state<DrawTool>('cursor');
  spotlight = $state<{ open: boolean; seed: string }>({ open: false, seed: '' });
  settingsOpen = $state(false);
  crossT = $state<{ t: number | null; from: string }>({ t: null, from: '' });
  toast = $state('');
  ready = $state(false);

  get chart(): ChartCfg { return this.charts[this.active]; }
  get count() { return LAYOUT_COUNT[this.layout]; }

  notify(msg: string) {
    this.toast = msg;
    setTimeout(() => { if (this.toast === msg) this.toast = ''; }, 2200);
  }

  async load() {
    try {
      const raw = await kvGet('workspace');
      if (raw) {
        const s = JSON.parse(raw);
        this.layout = s.layout ?? this.layout;
        if (Array.isArray(s.charts) && s.charts.length === 4) this.charts = s.charts;
        this.active = Math.min(s.active ?? 0, 3);
        this.theme = s.theme ?? 'dark';
        this.lang = s.lang ?? 'en';
        this.anim = s.anim ?? true;
        this.grid = s.grid ?? true;
        this.magnet = s.magnet ?? false;
        this.sync = s.sync ?? true;
        this.watchlist = s.watchlist ?? this.watchlist;
        this.showWatchlist = s.showWatchlist ?? true;
      }
    } catch { /* corrupt state: keep defaults */ }
    this.ready = true;
  }

  private timer: ReturnType<typeof setTimeout> | undefined;
  persist() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      kvSet('workspace', JSON.stringify({
        layout: this.layout, charts: $state.snapshot(this.charts), active: this.active, theme: this.theme,
        lang: this.lang, anim: this.anim, grid: this.grid, magnet: this.magnet, sync: this.sync,
        watchlist: this.watchlist, showWatchlist: this.showWatchlist
      }));
    }, 400);
  }
}

export const app = new App();
