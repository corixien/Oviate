import { app, newChart } from '$lib/app.svelte';
import { TIMEFRAMES } from '$lib/api';
import { CHART_TYPES } from '$lib/chart/transforms';
import { library } from '$lib/library.svelte';
import { paper } from '$lib/paper/paper.svelte';
import { DRAW_TOOLS } from '$lib/chart/renderer';
import { t } from '$lib/i18n';

export interface Command { id: string; key: string; title: string; sub?: string; tag: string; run: () => void }
type Raw = Omit<Command, 'id'> & { id?: string };

/** The command-bar commands. `id` is stable (shortcuts and renamed commands are stored by it); `key` is the searchable command text (editable in Keybinds). */
export function buildCommands(): Command[] {
  const list: Raw[] = [
    { key: 'ind indicator indicators editor code pine files', title: 'Indicator code editor', sub: 'Open your indicators (search, edit, save)', tag: 'indicator', run: () => { app.openEditor('indicators'); } },
    { key: 'visual builder strategy conditions indicators no code build', title: 'Visual strategy builder', sub: 'Build a strategy from indicator conditions, no code', tag: 'strategy', run: () => { app.openBuilder(null); } },
    { key: 'strat strategy strategies editor code pine files', title: 'Strategy code editor', sub: 'Open your strategies (search, edit, save)', tag: 'strategy', run: () => { app.openEditor('strategies'); } },
    ...TIMEFRAMES.map((tf) => ({ key: `tf ${tf}`, title: `Timeframe ${tf}`, tag: 'tf', run: () => { app.chart.tf = tf; } })),
    ...CHART_TYPES.map((ct) => ({ key: `type ${ct}`, title: `Chart type: ${ct}`, tag: 'type', run: () => { app.chart.type = ct; } })),
    { key: 'ind add new create pine script editor', title: 'New indicator (Pine editor)', sub: 'Paste Pine code, saved as .pine', tag: 'indicator', run: () => { app.editor = { kind: 'indicators', name: null }; app.page = 'editor'; } },
    { key: 'strat add new create pine strategy editor', title: 'New strategy (Pine editor)', sub: 'Paste Pine code, saved as .pine', tag: 'strategy', run: () => { app.editor = { kind: 'strategies', name: null }; app.page = 'editor'; } },
    ...library.indicators.map((f) => ({ key: `ind add ${f.name} ${f.title}`, title: `Add ${f.title}`, sub: f.name, tag: 'indicator',
      run: () => { app.chart.indicators = [...app.chart.indicators, { uid: crypto.randomUUID(), id: f.name, params: {} }]; } })),
    { key: 'ind add ai text describe generate plain words new', title: 'New indicator from text (AI)', sub: 'Describe it in words, the AI writes the Pine code', tag: 'indicator', run: () => { app.aiDialog = 'indicators'; } },
    ...library.strategies.map((f) => ({ key: `strat add ${f.name} ${f.title}`, title: `Add strategy: ${f.title}`, sub: f.name, tag: 'strategy',
      run: () => { app.addStrategy(f.name); paper.panelOpen = true; paper.panelTab = 'tester'; paper.persist(); } })),
    { key: 'strat add ai text describe generate plain words new', title: 'New strategy from text (AI)', sub: 'Describe it in words, the AI writes the Pine strategy', tag: 'strategy', run: () => { app.aiDialog = 'strategies'; } },
    { key: 'strat remove delete strategy', title: 'Remove strategy from chart', tag: 'strategy', run: () => { app.chart.indicators = app.chart.indicators.filter((i) => !i.strategy); } },
    { key: 'paper new account create', title: 'New paper account', tag: 'paper', run: () => { paper.accountDialog = true; } },
    { key: 'paper panel toggle trading', title: 'Toggle paper trading panel', tag: 'paper', run: () => { paper.panelOpen = !paper.panelOpen; paper.persist(); } },
    { id: 'paper:buy', key: `buy ${app.chart.symbol} paper order`, title: `Buy ${app.chart.symbol}`, tag: 'paper', run: () => { paper.orderDialog = { open: true, side: 'buy', symbol: app.chart.symbol }; } },
    { id: 'paper:sell', key: `sell ${app.chart.symbol} paper order`, title: `Sell ${app.chart.symbol}`, tag: 'paper', run: () => { paper.orderDialog = { open: true, side: 'sell', symbol: app.chart.symbol }; } },
    { key: 'optimizer optimize strategy parameters tune', title: 'Open Strategy Optimizer', sub: 'Find the best parameters of the chart strategy', tag: 'paper', run: () => { paper.panelTab = 'optimizer'; paper.panelOpen = true; paper.persist(); } },
    { key: 'journal trading journal trades calendar pnl diary', title: 'Open Trading Journal', sub: 'Trades table and P&L calendar per paper account', tag: 'paper', run: () => { paper.panelTab = 'journal'; paper.panelOpen = true; paper.persist(); } },
    { key: 'paper tester strategy panel', title: 'Open Strategy Tester', tag: 'paper', run: () => { paper.panelTab = 'tester'; paper.panelOpen = true; paper.persist(); } },
    ...paper.accounts.map((a) => ({ key: `paper account ${a.name}`, title: `Paper account: ${a.name}`, tag: 'paper', run: () => { paper.activeId = a.id; paper.panelTab = 'paper'; paper.panelOpen = true; paper.persist(); } })),
    { key: 'ind clear remove all indicators', title: 'Remove all indicators', tag: 'indicator', run: () => { app.chart.indicators = []; } },
    ...(['1', '2v', '2h', '3', '4'] as const).map((l) => ({ key: `layout ${l}`, title: `Layout: ${l === '1' ? 'single chart' : l === '2v' ? '2 charts side by side' : l === '2h' ? '2 charts stacked' : l + ' charts'}`, tag: 'layout', run: () => { app.setLayout(l); } })),
    ...DRAW_TOOLS.map((d) => ({ key: `draw ${d}`, title: `Draw: ${d === 'cursor' ? 'cursor' : d}`, tag: 'draw', run: () => { app.tool = d; } })),
    { key: 'draw clear delete all drawings', title: 'Delete all drawings', tag: 'draw', run: () => { app.chart.drawings = app.chart.drawings.filter((d) => d.sym !== app.chart.symbol); } },
    ...(['neon', 'mono', 'classic', 'custom'] as const).map((pl) => ({ key: `palette candles colors ${pl}`, title: `Candle colors: ${pl}`, tag: 'ui', run: () => { app.palette = pl; } })),
    { key: 'theme dark', title: 'Theme: dark', tag: 'ui', run: () => { app.theme = 'dark'; } },
    { key: 'theme light', title: 'Theme: light', tag: 'ui', run: () => { app.theme = 'light'; } },
    { key: 'lang en english', title: 'Language: English', tag: 'ui', run: () => { app.lang = 'en'; } },
    { key: 'lang de deutsch', title: 'Sprache: Deutsch', tag: 'ui', run: () => { app.lang = 'de'; } },
    { id: 'ui:settings', key: 'settings alpaca keys', title: t('settings', app.lang), sub: 'Alpaca keys, theme, language', tag: 'ui', run: () => { app.settingsOpen = true; } },
    { id: 'chart:reset', key: 'chart reset view zoom scale fit', title: 'Reset chart', sub: 'Fit the view like on a fresh timeframe (Alt+R)', tag: 'chart', run: () => { app.resetChart(); } },
    { key: 'replay bar replay mode scissors', title: 'Replay mode', sub: 'Pick a bar and play the market forward from there', tag: 'chart', run: () => { app.replayChart(); } },
    { key: 'log logarithmic scale', title: 'Toggle log scale', tag: 'chart', run: () => { app.chart.log = !app.chart.log; } },
    { key: 'volume toggle add', title: 'Volume indicator: toggle', tag: 'indicator', run: () => { app.chart.volume = !app.chart.volume; app.chart.volumeVisible = true; } },
    { key: 'grid toggle', title: 'Toggle grid', tag: 'chart', run: () => { app.grid = !app.grid; } },
    { key: 'magnet toggle', title: 'Toggle magnet', tag: 'chart', run: () => { app.magnet = !app.magnet; } },
    { key: 'sync crosshair toggle', title: 'Toggle crosshair sync', tag: 'chart', run: () => { app.sync = !app.sync; } },
    { key: 'zoom in app interface bigger', title: 'App zoom in (Ctrl +)', tag: 'ui', run: () => { app.zoomBy(1); } },
    { key: 'zoom out app interface smaller', title: 'App zoom out (Ctrl -)', tag: 'ui', run: () => { app.zoomBy(-1); } },
    { key: 'zoom reset app interface 100', title: 'App zoom reset (Ctrl 0)', tag: 'ui', run: () => { app.setZoom(1); } },
    { key: 'keybinds shortcuts keys bindings hotkeys commands aliases', title: 'Keybinds', sub: 'Shortcuts and command-bar commands, editable', tag: 'ui', run: () => { app.keybindsOpen = true; } },
    { key: 'anim animations toggle', title: 'Toggle animations', tag: 'ui', run: () => { app.anim = !app.anim; } },
    { id: 'watch:add', key: 'watch add watchlist', title: `Add ${app.chart.symbol} to watchlist`, tag: 'watch', run: () => { if (!app.list.symbols.includes(app.chart.symbol)) app.list.symbols = [...app.list.symbols, app.chart.symbol]; } },
    { key: 'watch toggle watchlist panel', title: 'Toggle watchlist panel', tag: 'watch', run: () => { app.showWatchlist = !app.showWatchlist; } },
    { key: 'news open page headlines', title: 'Open news', sub: 'All markets, last weeks', tag: 'news', run: () => { app.openNews(null, null); } },
    { id: 'news:symbol', key: `news symbol ${app.chart.symbol}`, title: `News for ${app.chart.symbol}`, tag: 'news', run: () => { app.openNews(app.chart.symbol, null); } },
    { key: 'calendar economic events macro open page', title: 'Economic calendar', sub: 'Upcoming and past macro events', tag: 'calendar', run: () => { app.page = 'calendar'; } },
    { key: 'news markers toggle chart', title: 'Toggle news markers on charts', tag: 'news', run: () => { app.showNews = !app.showNews; } },
    { key: 'charts back close news', title: 'Back to charts', tag: 'news', run: () => { app.page = 'chart'; } },
    { id: 'chart:clear', key: 'clear chart reset wipe indicators drawings', title: 'Clear chart (remove indicators and drawings)', tag: 'chart', run: () => { const c = newChart(app.chart.symbol, app.chart.tf); Object.assign(app.chart, { indicators: [], drawings: [], type: 'candles', log: false, volume: true, id: c.id }); } }
  ];
  return list.map((c) => ({ ...c, id: c.id ?? `${c.tag}:${c.title}` }));
}

/** The command text of a command: the user's own or the default. */
export const commandText = (c: Command) => app.cmdAlias[c.id] ?? c.key;
