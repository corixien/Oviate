import { kvGet, kvSet, type Tf } from './api';
import type { ChartType } from './chart/transforms';
import type { Drawing, DrawTool } from './chart/renderer';
import type { Lang } from './i18n';

export interface ChartCfg {
  id: string;
  symbol: string;
  tf: Tf;
  type: ChartType;
  indicators: { uid: string; id: string; params: Record<string, number>; hidden?: boolean; showParams?: boolean; colors?: string[] }[];
  drawings: Drawing[];
  log: boolean;
  volume: boolean;
  volumeVisible?: boolean;
}

export interface Watchlist { id: string; name: string; symbols: string[] }

export interface CustomColors {
  upBody: string; upBorder: string; upWick: string;
  downBody: string; downBorder: string; downWick: string;
}
export const DEFAULT_CUSTOM: CustomColors = {
  upBody: '#22e5ff', upBorder: '#22e5ff', upWick: '#22e5ff',
  downBody: '#ff2d95', downBorder: '#ff2d95', downWick: '#ff2d95'
};

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
  palette = $state<'neon' | 'mono' | 'classic' | 'custom'>('neon');
  custom = $state<CustomColors>({ ...DEFAULT_CUSTOM });
  grid = $state(true);
  magnet = $state(false);
  sync = $state(true);
  watchlists = $state<Watchlist[]>([{ id: 'default', name: 'Main', symbols: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'BTC/USD', 'ETH/USD'] }]);
  activeList = $state('default');
  /** Grid split fractions (first column / first row) and side column sizes. */
  split = $state({ c: 0.5, r: 0.5, rightW: 290, listFrac: 0.4 });
  showWatchlist = $state(true);
  tool = $state<DrawTool>('cursor');
  spotlight = $state<{ open: boolean; seed: string }>({ open: false, seed: '' });
  settingsOpen = $state(false);
  showParams = $state(false);
  indDialog = $state<{ uid: string; mode: 'settings' | 'code' } | null>(null);
  crossT = $state<{ t: number | null; from: string }>({ t: null, from: '' });
  toast = $state('');
  ticks = $state<Record<string, { p: number; s: number; t: number }>>({});
  ready = $state(false);

  get chart(): ChartCfg { return this.charts[this.active]; }
  get list(): Watchlist { return this.watchlists.find((w) => w.id === this.activeList) ?? this.watchlists[0]; }

  /** Switch layout; charts that become visible start with the active chart's indicators (copied, not synced). */
  setLayout(l: LayoutId) {
    const from = this.count, src = this.chart;
    this.layout = l;
    for (let i = from; i < LAYOUT_COUNT[l]; i++) {
      const c = this.charts[i];
      c.indicators = $state.snapshot(src.indicators).map((x) => ({ ...x, uid: crypto.randomUUID() }));
      c.volume = src.volume;
      c.volumeVisible = src.volumeVisible;
      c.type = src.type;
      c.tf = src.tf;
    }
    if (this.active >= this.count) this.active = 0;
    this.persist();
  }
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
        this.showParams = s.showParams ?? false;
        this.palette = s.palette ?? 'neon';
        this.grid = s.grid ?? true;
        this.magnet = s.magnet ?? false;
        this.sync = s.sync ?? true;
        if (Array.isArray(s.watchlists) && s.watchlists.length) this.watchlists = s.watchlists;
        else if (Array.isArray(s.watchlist)) this.watchlists = [{ id: 'default', name: 'Main', symbols: s.watchlist }];
        this.activeList = s.activeList ?? this.watchlists[0].id;
        if (s.custom) this.custom = { ...DEFAULT_CUSTOM, ...s.custom };
        if (s.split) this.split = { ...this.split, ...s.split };
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
        lang: this.lang, anim: this.anim, palette: this.palette, showParams: this.showParams, grid: this.grid, magnet: this.magnet, sync: this.sync,
        watchlists: $state.snapshot(this.watchlists), activeList: this.activeList, custom: $state.snapshot(this.custom), split: $state.snapshot(this.split), showWatchlist: this.showWatchlist
      }));
    }, 400);
  }
}

export const app = new App();
