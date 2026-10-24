import { kvGet, kvSet, type Tf } from './api';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { ChartType } from './chart/transforms';
import type { Drawing, DrawTool } from './chart/renderer';
import type { Lang } from './i18n';
import type { PineResult, TesterSettings } from './pine/types.ts';
import { library } from './library.svelte';

export interface ChartCfg {
  id: string;
  symbol: string;
  tf: Tf;
  type: ChartType;
  indicators: { uid: string; id: string; params: Record<string, number | string | boolean>; hidden?: boolean; showParams?: boolean; colors?: string[]; strategy?: boolean; account?: string }[];
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

/** Whole-app zoom steps (Ctrl +/-). */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

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
  /** Latest backtest per chart (for the Strategy Tester panel). */
  strategyResults = $state<Record<string, { uid: string; name: string; symbol: string; tf: string; result: PineResult; stepSec: number; firstClose: number; lastClose: number; closes: Float64Array }>>({});
  /** Strategy Tester settings (simulation only: not stored in strategies, not shown in chart drawings). */
  /** Strategy Tester equity chart: which lines are shown and the scale (remembered between sessions); buy & hold lines are off by default */
  eqView = $state<{ eq: boolean; bh: boolean; bhi: boolean; scale: 'equity' | 'all' }>({ eq: true, bh: false, bhi: false, scale: 'equity' });
  tester = $state<TesterSettings>({ initialCapital: 10000, commissionValue: 0, slippagePct: 0.1, fillOnClose: true });
  /** Request to reset the view of a chart (right-click menu, command bar). */
  resetReq = $state({ id: '', n: 0 });
  replayReq = $state({ id: '', n: 0 });
  /** Replay shared by the charts: `t` = time of the last visible bar (null while the start is being picked); with sync on every chart follows, else only the owner. */
  replay = $state<{ owner: string; t: number | null; playing: boolean; speed: number } | null>(null);
  /** AI indicator dialog (indicator from plain text). */
  aiDialog = $state<'indicators' | 'strategies' | null>(null);
  page = $state<'chart' | 'news' | 'editor' | 'calendar'>('chart');
  /** Script editor target: an existing script or a new one (name null). */
  /** name null = a new script; blank = nothing selected yet (opened with /ind or /strat) */
  editor = $state<{ kind: 'indicators' | 'strategies'; name: string | null; blank?: boolean; /** open in the visual builder instead of the code */ builder?: boolean }>({ kind: 'indicators', name: null });
  newsFocus = $state<{ symbol: string | null; id: string | null }>({ symbol: null, id: null });
  showNews = $state(true);
  /** calendar currencies resolved by the backend for symbols the bundled table does not know (session cache) */
  symRegions = $state<Record<string, string[]>>({});
  /** calendar event to select when the calendar page opens (from a chart marker) */
  calFocus = $state<{ id: string | null }>({ id: null });
  showParams = $state(false);
  indDialog = $state<{ uid: string; mode: 'settings' | 'code' } | null>(null);
  crossT = $state<{ t: number | null; y: number | null; from: string }>({ t: null, y: null, from: '' });
  view = $state<{ l: number; r: number; from: string } | null>(null);
  toast = $state('');
  ticks = $state<Record<string, { p: number; s: number; t: number }>>({});
  ready = $state(false);
  uiZoom = $state(1);

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

  replayChart() { this.replayReq = { id: this.chart.id, n: this.replayReq.n + 1 }; }
  resetChart() { this.resetReq = { id: this.chart.id, n: this.resetReq.n + 1 }; }

  /** Open the strategy editor in its visual builder view, on a saved strategy (name) or a new one. */
  openBuilder(name: string | null = null) { this.editor = { kind: 'strategies', name, builder: true }; this.page = 'editor'; }

  /** Open the code editor with nothing selected (what `/ind` and `/strat` do). */
  openEditor(kind: 'indicators' | 'strategies') {
    this.editor = { kind, name: null, blank: true };
    this.page = 'editor';
  }

  /** Put a strategy on the active chart (replacing the current one). */
  addStrategy(name: string) {
    const ch = this.chart;
    ch.indicators = [...ch.indicators.filter((i) => !i.strategy), { uid: crypto.randomUUID(), id: name, params: {}, strategy: true }];
  }

  openCalendar(id: string | null = null) {
    this.calFocus = { id };
    this.page = 'calendar';
  }

  openNews(symbol: string | null = null, id: string | null = null) {
    this.newsFocus = { symbol, id };
    this.page = 'news';
  }

  /** Zoom the whole UI to a factor (webview zoom in the app, CSS zoom in a plain browser). */
  setZoom(z: number) {
    this.uiZoom = Math.min(3, Math.max(0.5, z));
    this.applyZoom();
    this.persist();
  }
  zoomBy(dir: 1 | -1) {
    const z = this.uiZoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 1e-6) : [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6);
    if (next !== undefined) this.setZoom(next);
  }
  applyZoom() {
    const css = () => { document.documentElement.style.zoom = String(this.uiZoom); };
    try { getCurrentWebview().setZoom(this.uiZoom).catch(css); } catch { css(); }
  }

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
        this.showNews = s.showNews ?? true;
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
        this.uiZoom = s.uiZoom ?? 1;
        if (s.eqView) this.eqView = { ...this.eqView, ...s.eqView };
        if (s.tester) this.tester = { ...this.tester, initialCapital: s.tester.initialCapital ?? this.tester.initialCapital, commissionValue: s.tester.commissionValue ?? this.tester.commissionValue, slippagePct: s.tester.slippagePct ?? this.tester.slippagePct, fillOnClose: s.tester.fillOnClose ?? this.tester.fillOnClose }; // slippagePct is new: older saves (tick based) get the 0.1 default
        if (this.uiZoom !== 1) this.applyZoom();
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
        lang: this.lang, anim: this.anim, palette: this.palette, showNews: this.showNews, showParams: this.showParams, grid: this.grid, magnet: this.magnet, sync: this.sync,
        watchlists: $state.snapshot(this.watchlists), activeList: this.activeList, custom: $state.snapshot(this.custom), split: $state.snapshot(this.split), showWatchlist: this.showWatchlist, eqView: $state.snapshot(this.eqView), uiZoom: this.uiZoom, tester: $state.snapshot(this.tester)
      }));
    }, 400);
  }
}

export const app = new App();
