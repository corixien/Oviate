// Oviate command line tool: list / check / add indicators and strategies, and backtest strategies on the candles Oviate has cached.
// Runs on Node 22.18+ (TypeScript by type stripping) and uses the same Pine engine and checks as the app.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runPine } from '../src/lib/pine/index.ts';
import { detailedStats } from '../src/lib/pine/stats.ts';
import { sanity, GUIDE, STRAT_SAMPLE, STRATEGY_EXAMPLE_LONG, STRATEGY_EXAMPLE_BOTH } from '../src/lib/ai/pine.ts';
import type { PineCandles, PineResult } from '../src/lib/pine/types.ts';

const KINDS = ['indicators', 'strategies'] as const;
type Kind = (typeof KINDS)[number];
const TF_SEC: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800, '1M': 2592000 };

const dataDir = process.env.OVIATE_DATA ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'dev.oviate.app');
const dbPath = join(dataDir, 'oviate.db');

class Fail extends Error {}
const fail = (m: string): never => { throw new Fail(m); };

// ---------------------------------------------------------------- args
interface Args { pos: string[]; flags: Map<string, string[]> }
const BOOLEAN_FLAGS = new Set(['json', 'force', 'strict', 'help']);
function parse(argv: string[]): Args {
  const pos: string[] = []; const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
    const v = eq > 0 ? a.slice(eq + 1) : BOOLEAN_FLAGS.has(k) ? 'true' : (argv[++i] ?? fail(`--${k} needs a value`));
    flags.set(k, [...(flags.get(k) ?? []), v]);
  }
  return { pos, flags };
}
const flag = (a: Args, k: string) => a.flags.get(k)?.[a.flags.get(k)!.length - 1];
const has = (a: Args, k: string) => a.flags.has(k);
const numFlag = (a: Args, k: string, d: number): number => { const v = flag(a, k); if (v === undefined) return d; const n = Number(v); return Number.isFinite(n) ? n : fail(`--${k} must be a number, got "${v}"`); };

// ---------------------------------------------------------------- files
function kindOf(s: string): Kind { return /^ind/i.test(s) ? 'indicators' : /^strat/i.test(s) ? 'strategies' : fail(`kind must be "indicators" or "strategies", got "${s}"`); }
const folder = (k: Kind) => join(dataDir, k);
function listScripts(k: Kind): { name: string; title: string; file: string }[] {
  const dir = folder(k);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.pine')).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map((f) => {
    const code = readFileSync(join(dir, f), 'utf8');
    return { name: f.slice(0, -5), title: /(?:indicator|strategy|study)\s*\(\s*(?:title\s*=\s*)?["']([^"']*)["']/.exec(code)?.[1] ?? '', file: join(dir, f) };
  });
}
function sanitize(name: string): string {
  const c = name.trim().replace(/\.pine$/, '').replace(/[^\p{L}\p{N}\-_ .()]/gu, '-').trim().replace(/^\.+/, '').trim().slice(0, 80);
  return c || fail('script name is empty');
}
/** A script given as a file path, "-" (stdin) or a name in the app's folders. */
function readScript(ref: string, kind?: Kind): { code: string; label: string } {
  if (ref === '-') return { code: readFileSync(0, 'utf8'), label: 'stdin' };
  if (existsSync(ref) && ref.endsWith('.pine')) return { code: readFileSync(ref, 'utf8'), label: resolve(ref) };
  for (const k of kind ? [kind] : KINDS) {
    const hit = listScripts(k).find((s) => s.name === ref) ?? listScripts(k).find((s) => s.name.toLowerCase() === ref.toLowerCase());
    if (hit) return { code: readFileSync(hit.file, 'utf8'), label: hit.file };
  }
  return fail(`script "${ref}" not found (give a .pine file path, "-" for stdin, or a name from \`oviate list\`)`);
}

// ---------------------------------------------------------------- data
function openDb(): DatabaseSync {
  if (!existsSync(dbPath)) fail(`no Oviate data at ${dbPath}. Start Oviate once and open a chart, or set OVIATE_DATA.`);
  return new DatabaseSync(dbPath, { readOnly: true });
}
function series(db: DatabaseSync) {
  return db.prepare('SELECT symbol, tf, COUNT(*) AS n, MIN(t) AS t0, MAX(t) AS t1 FROM candles GROUP BY symbol, tf ORDER BY symbol, tf').all() as { symbol: string; tf: string; n: number; t0: number; t1: number }[];
}
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
function loadCandles(symbol: string, tf: string, from?: string, to?: string): PineCandles {
  const db = openDb();
  const t0 = from ? Date.parse(from) / 1000 : 0, t1 = to ? Date.parse(to + (to.length <= 10 ? 'T23:59:59Z' : '')) / 1000 : 9e12;
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) fail('--from / --to must be dates like 2024-01-31');
  const rows = db.prepare('SELECT t, o, h, l, c, v FROM candles WHERE UPPER(symbol) = UPPER(?) AND tf = ? AND t BETWEEN ? AND ? ORDER BY t').all(symbol, tf, t0, t1) as { t: number; o: number; h: number; l: number; c: number; v: number }[];
  if (!rows.length) {
    const have = series(db).filter((s) => s.symbol.toUpperCase() === symbol.toUpperCase());
    fail(`no cached ${symbol} ${tf} candles${from || to ? ' in that range' : ''}.` + (have.length ? ` Cached for ${symbol}: ${have.map((s) => `${s.tf} (${s.n} bars, ${day(s.t0)}..${day(s.t1)})`).join(', ')}.` : ' Open this symbol and timeframe in Oviate once, it caches what a chart loads. See `oviate data`.'));
  }
  const n = rows.length;
  const c: PineCandles = { n, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  rows.forEach((r, i) => { c.t[i] = r.t; c.o[i] = r.o; c.h[i] = r.h; c.l[i] = r.l; c.c[i] = r.c; c.v[i] = r.v; });
  return c;
}

// ---------------------------------------------------------------- output helpers
const money = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-');
const pct = (v: number) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '-');
const pf = (v: number) => (v === Infinity ? 'inf' : v.toFixed(2));
process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
const out = (s = '') => process.stdout.write(s + '\n');
const printJson = (o: unknown) => out(JSON.stringify(o, (_k, v) => (v instanceof Float64Array ? Array.from(v) : v), 2));

function describe(r: PineResult) {
  return { kind: r.meta.kind, title: r.meta.title, overlay: r.meta.overlay, inputs: r.inputs.map((i) => ({ title: i.title, type: i.type, default: i.def })), plots: r.plots.map((p) => p.title), warnings: r.warnings };
}

// ---------------------------------------------------------------- commands
function cmdList(a: Args) {
  const kinds = a.pos[1] ? [kindOf(a.pos[1])] : [...KINDS];
  const rows = kinds.flatMap((k) => listScripts(k).map((s) => ({ kind: k, name: s.name, title: s.title })));
  if (has(a, 'json')) return printJson(rows);
  for (const k of kinds) { out(`${k} (${folder(k)})`); for (const s of rows.filter((r) => r.kind === k)) out(`  ${s.name}${s.title && s.title !== s.name ? `   "${s.title}"` : ''}`); }
}

function cmdShow(a: Args) {
  const kind = kindOf(a.pos[1] ?? fail('usage: oviate show <indicators|strategies> <name>'));
  out(readScript(a.pos[2] ?? fail('usage: oviate show <indicators|strategies> <name>'), kind).code);
}

function cmdCheck(a: Args) {
  const { code, label } = readScript(a.pos[1] ?? fail('usage: oviate check <file.pine|->'));
  const r = runPine(code, loadSample(a));
  const info = describe(r);
  const hint = r.error || r.meta.kind !== 'indicator' ? null : sanity(code);
  if (has(a, 'json')) return printJson({ ok: !r.error && !(has(a, 'strict') && hint), error: r.error ?? null, hint, ...info, trades: r.strategy?.trades.length });
  out(`${label}`);
  if (r.error) { out(`ERROR${r.error.line ? ' line ' + r.error.line : ''}: ${r.error.message}`); process.exitCode = 1; return; }
  out(`OK  ${info.kind} "${info.title}" overlay=${info.overlay}`);
  out(`inputs: ${info.inputs.map((i) => `${i.title}=${i.default}`).join(', ') || '-'}`);
  out(`plots:  ${info.plots.join(', ') || '-'}`);
  if (r.strategy) out(`sample backtest: ${r.strategy.trades.length} trades on ${loadSample(a).n} synthetic bars`);
  for (const w of info.warnings) out(`warning: ${w}`);
  if (hint) { out(`hint: ${hint}`); if (has(a, 'strict')) process.exitCode = 1; }
}
/** Synthetic candles for compile/sanity checks; with --symbol/--tf the real cached candles are used. */
function loadSample(a: Args): PineCandles {
  const sym = flag(a, 'symbol'), tf = flag(a, 'tf');
  return sym ? loadCandles(sym, tf ?? '1d', flag(a, 'from'), flag(a, 'to')) : SAMPLE_CANDLES();
}
const SAMPLE_CANDLES = (): PineCandles => STRAT_SAMPLE;

function cmdAdd(a: Args) {
  const kind = kindOf(a.pos[1] ?? fail('usage: oviate add <indicator|strategy> <file.pine|-> [--name NAME] [--force]'));
  const { code } = readScript(a.pos[2] ?? fail('usage: oviate add <indicator|strategy> <file.pine|-> [--name NAME] [--force]'));
  const r = runPine(code, SAMPLE_CANDLES());
  if (r.error) fail(`script does not compile${r.error.line ? ' (line ' + r.error.line + ')' : ''}: ${r.error.message}`);
  const want = kind === 'indicators' ? 'indicator' : 'strategy';
  if (r.meta.kind !== want) fail(`this file declares ${r.meta.kind}(), but you are adding a ${want}`);
  const name = sanitize(flag(a, 'name') ?? r.meta.title);
  const dir = folder(kind); mkdirSync(dir, { recursive: true });
  const file = join(dir, name + '.pine');
  if (existsSync(file) && !has(a, 'force')) fail(`${file} already exists. Use another --name or --force to overwrite it.`);
  writeFileSync(file, code.endsWith('\n') ? code : code + '\n');
  const hint = kind === 'indicators' ? sanity(code) : null;
  if (has(a, 'json')) return printJson({ ok: true, kind, name, file, hint });
  out(`Added ${want} "${r.meta.title}" as ${name}.pine`);
  out(file);
  if (hint) out(`hint: ${hint}`);
  out('Oviate picks it up when its window is focused. Add it with /ind add or /strat add.');
}

function cmdData(a: Args) {
  const rows = series(openDb());
  if (has(a, 'json')) return printJson(rows.map((r) => ({ ...r, from: day(r.t0), to: day(r.t1) })));
  out('symbol            tf    bars   from        to');
  for (const r of rows) out(`${r.symbol.padEnd(16)}  ${r.tf.padEnd(4)}  ${String(r.n).padStart(6)}  ${day(r.t0)}  ${day(r.t1)}`);
}

function coerce(v: string): number | boolean | string { return v === 'true' ? true : v === 'false' ? false : v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v; }

function cmdBacktest(a: Args) {
  const ref = a.pos[1] ?? fail('usage: oviate backtest <strategy name|file.pine|-> --symbol AAPL --tf 1d [--from DATE] [--to DATE] [--capital N] [--commission PCT] [--slippage TICKS] [--param "Input title=value"] [--trades N] [--json]');
  const symbol = flag(a, 'symbol') ?? fail('--symbol is required (see `oviate data` for cached symbols)');
  const tf = flag(a, 'tf') ?? '1d';
  if (!TF_SEC[tf]) fail(`--tf must be one of ${Object.keys(TF_SEC).join(' ')}`);
  const { code, label } = readScript(ref, 'strategies');
  const data = loadCandles(symbol, tf, flag(a, 'from'), flag(a, 'to'));
  const params: Record<string, number | boolean | string> = {};
  for (const p of a.flags.get('param') ?? []) { const i = p.indexOf('='); if (i < 1) fail(`--param needs "Input title=value", got "${p}"`); params[p.slice(0, i).trim()] = coerce(p.slice(i + 1)); }
  const broker = { initialCapital: numFlag(a, 'capital', 10000), commissionValue: numFlag(a, 'commission', 0), slippageTicks: numFlag(a, 'slippage', 0) };
  const r = runPine(code, data, { params, step: TF_SEC[tf], symbol, broker });
  if (r.error) fail(`script error${r.error.line ? ' (line ' + r.error.line + ')' : ''}: ${r.error.message}`);
  if (!r.strategy) fail('this script is an indicator, not a strategy');
  const s = r.strategy;
  const st = detailedStats(s, { stepSec: TF_SEC[tf], firstClose: data.c[0], lastClose: data.c[data.n - 1] });
  const unknown = Object.keys(params).filter((k) => !r.inputs.some((i) => i.title === k));
  const nTrades = Math.max(0, Math.trunc(numFlag(a, 'trades', 10)));
  const trade = (t: (typeof s.trades)[number], i: number) => ({ n: i + 1, dir: t.dir, entry: day(t.entryTime), entryPrice: +t.entryPrice.toFixed(4), exit: t.open ? 'open' : day(t.exitTime), exitPrice: +t.exitPrice.toFixed(4), qty: +t.qty.toFixed(4), pnl: +t.pnl.toFixed(2), exitComment: t.exitComment });
  const result = {
    strategy: r.meta.title, source: label, symbol, tf, bars: data.n, from: day(data.t[0]), to: day(data.t[data.n - 1]),
    settings: { ...broker, positionSize: `${s.config.qtyValue} ${s.config.qtyType}`, params, unknownParams: unknown },
    inputs: r.inputs.map((i) => ({ title: i.title, default: i.def })),
    stats: { netProfit: st.netProfit, returnPct: st.returnPct, buyHoldPct: st.buyHold, trades: st.trades, winRate: st.winRate, profitFactor: st.profitFactor === Infinity ? 'inf' : st.profitFactor, avgTrade: st.avgTrade, avgWin: st.avgWin, avgLoss: st.avgLoss, expectancy: st.expectancy, best: st.best, worst: st.worst, maxDrawdown: st.maxDrawdown, maxDrawdownPct: st.maxDrawdownPct, sharpe: st.sharpe, sortino: st.sortino, calmar: st.calmar, exposurePct: st.exposurePct, maxWinStreak: st.maxWinStreak, maxLossStreak: st.maxLossStreak, openPnl: st.openPnl, finalEquity: st.equity, long: st.long, short: st.short },
    lastTrades: s.trades.slice(-nTrades).map((t, i, arr) => trade(t, s.trades.length - arr.length + i)),
    openPosition: s.openPosition,
  };
  if (has(a, 'json')) return printJson(result);
  out(`${result.strategy}   ${symbol} ${tf}   ${result.from} .. ${result.to}   ${data.n} bars`);
  out(`capital ${money(broker.initialCapital)}  size ${result.settings.positionSize}  commission ${broker.commissionValue}%  slippage ${broker.slippageTicks} ticks`);
  if (unknown.length) out(`warning: unknown --param ${unknown.join(', ')} (inputs: ${r.inputs.map((i) => i.title).join(', ') || 'none'})`);
  out('');
  out(`Net profit   ${money(st.netProfit)} (${pct(st.returnPct)})   buy & hold ${pct(st.buyHold)}   final equity ${money(st.equity)}`);
  out(`Trades       ${st.trades}   win rate ${st.winRate.toFixed(1)}%   profit factor ${pf(st.profitFactor)}   avg trade ${money(st.avgTrade)}`);
  out(`Win / loss   avg win ${money(st.avgWin)}   avg loss ${money(st.avgLoss)}   best ${money(st.best)}   worst ${money(st.worst)}`);
  out(`Risk         max drawdown ${money(st.maxDrawdown)} (${st.maxDrawdownPct.toFixed(2)}%)   sharpe ${st.sharpe.toFixed(2)}   sortino ${st.sortino.toFixed(2)}   time in market ${st.exposurePct.toFixed(0)}%`);
  out(`Long         ${st.long.trades} trades  win ${st.long.winRate.toFixed(0)}%  net ${money(st.long.net)}      Short  ${st.short.trades} trades  win ${st.short.winRate.toFixed(0)}%  net ${money(st.short.net)}`);
  if (s.openPosition) out(`Open         ${s.openPosition.dir} ${s.openPosition.qty.toFixed(4)} @ ${s.openPosition.avg.toFixed(4)}  (open P&L ${money(st.openPnl)})`);
  if (nTrades && result.lastTrades.length) {
    out(''); out(`last ${result.lastTrades.length} trades`);
    for (const t of result.lastTrades) out(`  #${String(t.n).padEnd(4)} ${t.dir.padEnd(5)} ${t.entry} @ ${t.entryPrice}  ->  ${t.exit} @ ${t.exitPrice}   pnl ${money(t.pnl)}${t.exitComment ? '  ' + t.exitComment : ''}`);
  }
}

function cmdGuide() {
  out(`# Oviate Pine rules for INDICATORS\n\n${GUIDE.indicator}\n\n# Oviate Pine rules for STRATEGIES\n\n${GUIDE.strategy}`);
}
function cmdExamples() { out(`// ---- long only, overlay, SL/TP\n${STRATEGY_EXAMPLE_LONG}\n// ---- long and short, oscillator pane\n${STRATEGY_EXAMPLE_BOTH}`); }

const HELP = `oviate: add and backtest Pine indicators and strategies for the Oviate charting app

  oviate list [indicators|strategies] [--json]        scripts in the app (names to use elsewhere)
  oviate show <indicators|strategies> <name>          print the Pine source
  oviate check <file.pine|-> [--symbol S --tf TF]     compile + run; prints kind, inputs, plots, hints (--strict: exit 1 on hints)
  oviate add <indicator|strategy> <file.pine|-> [--name NAME] [--force]
                                                      validate and install into the app (never overwrites without --force)
  oviate data [--json]                                cached candle series (symbol, timeframe, range) usable for backtests
  oviate backtest <strategy name|file.pine|-> --symbol AAPL --tf 1d
        [--from 2023-01-01] [--to 2024-12-31] [--capital 10000] [--commission 0.05] [--slippage 0]
        [--param "Fast EMA=12"]... [--trades 10] [--json]
  oviate guide                                        the Pine dialect + backtester rules the in-app AI uses (read before writing code)
  oviate examples                                     two complete reference strategies

Data: ${dataDir} (override with OVIATE_DATA). Candles are cached when a chart in Oviate loads them.`;

const HANDLERS: Record<string, (a: Args) => void> = { list: cmdList, show: cmdShow, check: cmdCheck, add: cmdAdd, data: cmdData, backtest: cmdBacktest, guide: cmdGuide, examples: cmdExamples };

export function main(argv: string[]): number {
  const a = parse(argv);
  const cmd = a.pos[0];
  if (!cmd || cmd === 'help' || has(a, 'help')) { out(HELP); return cmd || has(a, 'help') ? 0 : 1; }
  const h = HANDLERS[cmd];
  if (!h) { process.stderr.write(`unknown command "${cmd}"\n\n${HELP}\n`); return 1; }
  try { h(a); return process.exitCode ? Number(process.exitCode) : 0; }
  catch (e) {
    if (e instanceof Fail) { process.stderr.write(`error: ${e.message}\n`); return 1; }
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('oviate.ts')) process.exitCode = main(process.argv.slice(2));
