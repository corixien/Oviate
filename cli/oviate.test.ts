import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { STRATEGY_EXAMPLE_LONG } from '../src/lib/ai/pine.ts';

const home = mkdtempSync(join(tmpdir(), 'oviate-cli-'));
const run = (args: string[], input?: string) => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('./oviate.ts', import.meta.url).pathname, ...args], { env: { ...process.env, OVIATE_DATA: home }, input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const file = (name: string, code: string) => { const p = join(home, name); writeFileSync(p, code); return p; };

before(() => {
  const db = new DatabaseSync(join(home, 'oviate.db'));
  db.exec('CREATE TABLE candles(symbol TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL, o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL, PRIMARY KEY(symbol, tf, t)) WITHOUT ROWID');
  const ins = db.prepare('INSERT INTO candles VALUES (?,?,?,?,?,?,?,?)');
  let seed = 7, p = 100;
  for (let i = 0; i < 900; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const open = p; p = Math.max(20, p * (1 + (Math.sin(i / 40) * 0.004 + ((seed / 4294967296) - 0.5) * 0.02)));
    ins.run('TEST/USD', '1d', 1_600_000_000 + i * 86400, open, Math.max(open, p) * 1.004, Math.min(open, p) * 0.996, p, 1000);
  }
  db.close();
  mkdirSync(join(home, 'strategies'), { recursive: true });
});

test('help and unknown command', () => {
  assert.equal(run([]).code, 1);
  assert.match(run(['help']).out, /oviate backtest/);
  assert.match(run(['nope']).err, /unknown command/);
});

test('data lists cached series', () => {
  assert.match(run(['data']).out, /TEST\/USD\s+1d\s+900/);
  const j = JSON.parse(run(['data', '--json']).out);
  assert.equal(j[0].symbol, 'TEST/USD'); assert.equal(j[0].n, 900);
});

test('check reports compile errors and the shape of a good script', () => {
  const bad = run(['check', file('bad.pine', '//@version=6\nindicator("x")\nplot(')]);
  assert.equal(bad.code, 1); assert.match(bad.out, /ERROR/);
  const ok = run(['check', file('ok.pine', STRATEGY_EXAMPLE_LONG)]);
  assert.equal(ok.code, 0); assert.match(ok.out, /OK\s+strategy "EMA Trend Pullback"/); assert.match(ok.out, /Fast EMA=20/);
  const j = JSON.parse(run(['check', file('ok.pine', STRATEGY_EXAMPLE_LONG), '--json']).out);
  assert.equal(j.ok, true); assert.equal(j.kind, 'strategy');
});

test('check --strict fails on an indicator that plots price next to an oscillator', () => {
  const code = '//@version=6\nindicator("m", overlay=false)\nplot(ta.rsi(close, 14), "r")\nplot(close, "price")';
  assert.equal(run(['check', file('m.pine', code)]).code, 0);
  const s = run(['check', file('m.pine', code), '--strict']);
  assert.equal(s.code, 1); assert.match(s.out, /Scale mismatch/);
});

test('add validates kind and compile, installs, and never overwrites without --force', () => {
  assert.match(run(['add', 'indicator', file('s.pine', STRATEGY_EXAMPLE_LONG)]).err, /declares strategy/);
  assert.match(run(['add', 'strategy', file('b.pine', '//@version=6\nstrategy("x"\n')]).err, /does not compile/);
  const r = run(['add', 'strategy', '-'], STRATEGY_EXAMPLE_LONG);
  assert.equal(r.code, 0); assert.match(r.out, /EMA Trend Pullback\.pine/);
  assert.ok(existsSync(join(home, 'strategies', 'EMA Trend Pullback.pine')));
  assert.match(run(['add', 'strategy', file('s.pine', STRATEGY_EXAMPLE_LONG)]).err, /already exists/);
  assert.equal(run(['add', 'strategy', file('s.pine', STRATEGY_EXAMPLE_LONG), '--force']).code, 0);
  const two = run(['add', 'strategy', file('s.pine', STRATEGY_EXAMPLE_LONG), '--name', '../evil/Name']);
  assert.ok(existsSync(join(home, 'strategies', '-evil-Name.pine')), two.err);
  assert.match(run(['list', 'strategies']).out, /EMA Trend Pullback/);
  assert.equal(readFileSync(join(home, 'strategies', 'EMA Trend Pullback.pine'), 'utf8'), STRATEGY_EXAMPLE_LONG);
});

test('backtest by name on cached candles: stats, params and settings', () => {
  const r = run(['backtest', 'EMA Trend Pullback', '--symbol', 'test/usd', '--tf', '1d', '--json', '--commission', '0.1', '--slippage', '0.2', '--capital', '5000', '--param', 'Fast EMA=10', '--param', 'Slow EMA=30']);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.bars, 900); assert.equal(j.settings.initialCapital, 5000); assert.equal(j.settings.commissionValue, 0.1); assert.equal(j.settings.slippagePct, 0.2);
  assert.equal(JSON.parse(run(['backtest', 'EMA Trend Pullback', '--symbol', 'TEST/USD', '--json']).out).settings.slippagePct, 0.1, 'default slippage is 0.1%');
  assert.deepEqual(j.settings.unknownParams, []);
  assert.ok(j.stats.trades > 2, `trades ${j.stats.trades}`);
  for (const k of ['netProfit', 'winRate', 'profitFactor', 'maxDrawdownPct', 'sharpe', 'long', 'short']) assert.ok(k in j.stats, k);
  const base = JSON.parse(run(['backtest', 'EMA Trend Pullback', '--symbol', 'TEST/USD', '--json']).out);
  assert.notEqual(base.stats.trades + ':' + base.stats.netProfit, j.stats.trades + ':' + j.stats.netProfit, 'params change the result');
});

test('backtest range, human output and errors', () => {
  const h = run(['backtest', 'EMA Trend Pullback', '--symbol', 'TEST/USD', '--from', '2021-01-01', '--to', '2021-12-31', '--trades', '2']);
  assert.equal(h.code, 0, h.err); assert.match(h.out, /Net profit/); assert.match(h.out, /last \d+ trades|Trades\s+0/);
  assert.match(run(['backtest', 'EMA Trend Pullback', '--symbol', 'NOPE']).err, /no cached NOPE 1d/);
  assert.match(run(['backtest', 'EMA Trend Pullback', '--symbol', 'TEST/USD', '--tf', '4h']).err, /Cached for TEST\/USD: 1d/);
  assert.match(run(['backtest', 'missing', '--symbol', 'TEST/USD']).err, /not found/);
  assert.match(run(['backtest', 'EMA Trend Pullback']).err, /--symbol is required/);
  assert.match(run(['backtest', 'EMA Trend Pullback', '--symbol', 'TEST/USD', '--param', 'x']).err, /--param needs/);
  assert.match(run(['backtest', 'EMA Trend Pullback', '--symbol', 'TEST/USD', '--param', 'Nope=1', '--json']).out, /"unknownParams": \[\s*"Nope"/);
  const ind = file('i.pine', '//@version=6\nindicator("i")\nplot(close)');
  assert.match(run(['backtest', ind, '--symbol', 'TEST/USD']).err, /indicator, not a strategy/);
});

test('guide and examples print the rules', () => {
  assert.match(run(['guide']).out, /NEXT BAR/);
  assert.match(run(['examples']).out, /strategy\.exit/);
});
