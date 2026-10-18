<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { getCandles } from '$lib/api';
  import type { Candles } from '$lib/chart/data';
  import { sma, ema, rsi, indicatorById } from '$lib/chart/indicators';
  import { fmtPrice } from '$lib/chart/renderer';

  const symbol = $derived(app.chart.symbol);
  let data = $state<Candles | null>(null);
  let loading = $state(false);
  let now = $state(Date.now());

  $effect(() => {
    const sym = symbol;
    loading = true;
    const to = Math.floor(Date.now() / 1000) + 86400;
    getCandles(sym, '1d', to - 6 * 366 * 86400, to)
      .then((c) => { if (sym === symbol) data = c; })
      .catch(() => { if (sym === symbol) data = null; })
      .finally(() => { loading = false; });
  });
  $effect(() => { const iv = setInterval(() => (now = Date.now()), 30000); return () => clearInterval(iv); });

  const n = $derived(data?.n ?? 0);
  const live = $derived(app.ticks[symbol]?.p);
  const last = $derived(n ? (live ?? data!.c[n - 1]) : NaN);
  const prev = $derived(n > 1 ? data!.c[n - 2] : NaN);
  const chg = $derived(last - prev);
  const chgPct = $derived((chg / prev) * 100);

  const crypto = $derived(symbol.includes('/') || symbol.endsWith('-USD'));
  const status = $derived.by(() => {
    if (crypto) return { text: '24/7', cls: 'open' };
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(now));
    const g = (t: string) => f.find((p) => p.type === t)?.value ?? '';
    const mins = (parseInt(g('hour')) % 24) * 60 + parseInt(g('minute'));
    if (['Sat', 'Sun'].includes(g('weekday'))) return { text: 'Closed', cls: 'closed' };
    if (mins >= 570 && mins < 960) return { text: 'Market open', cls: 'open' };
    if (mins >= 240 && mins < 570) return { text: 'Pre-market', cls: 'pre' };
    if (mins >= 960 && mins < 1200) return { text: 'After hours', cls: 'pre' };
    return { text: 'Closed', cls: 'closed' };
  });

  const range = $derived.by(() => {
    if (!n) return null;
    const lo52 = Math.min(...data!.l.slice(Math.max(0, n - 252), n)), hi52 = Math.max(...data!.h.slice(Math.max(0, n - 252), n));
    return { dayLo: data!.l[n - 1], dayHi: data!.h[n - 1], lo52, hi52 };
  });
  const pos = (v: number, lo: number, hi: number) => (hi > lo ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) : 50);

  const perf = $derived.by(() => {
    if (!n) return [];
    const at = (k: number) => (n - 1 - k >= 0 ? data!.c[n - 1 - k] : NaN);
    const year = new Date().getUTCFullYear();
    let ytdBase = NaN;
    for (let i = 0; i < n; i++) if (new Date(data!.t[i] * 1000).getUTCFullYear() === year) { ytdBase = i > 0 ? data!.c[i - 1] : data!.c[i]; break; }
    const pct = (base: number) => ((last - base) / base) * 100;
    return [['1W', pct(at(5))], ['1M', pct(at(21))], ['3M', pct(at(63))], ['6M', pct(at(126))], ['YTD', pct(ytdBase)], ['1Y', pct(at(252))]] as [string, number][];
  });

  // Seasonals: cumulative % return per calendar year, plus same-period (Jan 1 .. today) returns.
  const seasonal = $derived.by(() => {
    if (!n) return null;
    const dayOf = (t: number) => { const d = new Date(t * 1000); return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000); };
    const cur = new Date().getUTCFullYear();
    const today = dayOf(Date.now() / 1000);
    const years = new Map<number, { d: number; c: number }[]>();
    for (let i = 0; i < n; i++) {
      const y = new Date(data!.t[i] * 1000).getUTCFullYear();
      if (y < cur - 5) continue;
      if (!years.has(y)) years.set(y, []);
      years.get(y)!.push({ d: dayOf(data!.t[i]), c: data!.c[i] });
    }
    const series = [...years.entries()].filter(([, v]) => v.length > 20).map(([y, v]) => {
      const base = v[0].c;
      const pts = v.map((p) => ({ d: p.d, r: ((p.c - base) / base) * 100 }));
      const upTo = pts.filter((p) => p.d <= today);
      return { year: y, pts, same: upTo.length ? upTo[upTo.length - 1].r : NaN };
    });
    let lo = 0, hi = 0;
    for (const s of series) for (const p of s.pts) { lo = Math.min(lo, p.r); hi = Math.max(hi, p.r); }
    return { series, lo, hi, today, cur };
  });
  const sx = (d: number) => 6 + (d / 365) * 288;
  const sy = (r: number, lo: number, hi: number) => 8 + (1 - (r - lo) / (hi - lo || 1)) * 84;
  const path = (pts: { d: number; r: number }[], lo: number, hi: number) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.d).toFixed(1)},${sy(p.r, lo, hi).toFixed(1)}`).join('');

  // Technicals summary from daily data.
  const tech = $derived.by(() => {
    if (n < 60) return null;
    const c = data!.c; const i = n - 1;
    let buy = 0, sell = 0, neutral = 0;
    const vote = (b: boolean | null) => (b === null ? neutral++ : b ? buy++ : sell++);
    for (const len of [10, 20, 50, 100, 200]) {
      if (n < len) continue;
      vote(c[i] > sma(c, len)[i]); vote(c[i] > ema(c, len)[i]);
    }
    const r = rsi(c, 14)[i]; vote(r < 30 ? true : r > 70 ? false : null);
    const st = indicatorById('stoch')!.compute(data!, { k: 14, d: 3 });
    const k = st[0].v[i]; vote(k < 20 ? true : k > 80 ? false : null);
    const mc = indicatorById('macd')!.compute(data!, { fast: 12, slow: 26, signal: 9 });
    vote(mc[1].v[i] > mc[2].v[i]);
    const total = buy + sell + neutral;
    const score = (buy - sell) / (total || 1);
    const label = score > 0.5 ? 'Strong buy' : score > 0.15 ? 'Buy' : score < -0.5 ? 'Strong sell' : score < -0.15 ? 'Sell' : 'Neutral';
    return { buy, sell, neutral, score, label };
  });
  const yearColors = ['#4b2b7f', '#5f35a0', '#7440c4', '#8a4ee6', '#b47cff'];
</script>

<section>
  <div class="hd"><span>{symbol}</span><span class="st {status.cls}">{status.text}</span></div>
  {#if !n}
    <p class="dim">{loading ? 'Loading…' : 'No data'}</p>
  {:else}
    <div class="price">
      <b>{fmtPrice(last)}</b>
      <span class:up={chg >= 0} class:dn={chg < 0}>{chg >= 0 ? '+' : ''}{fmtPrice(chg)} ({chgPct.toFixed(2)}%)</span>
    </div>

    {#if range}
      <h4>Day range</h4>
      <div class="rng"><span>{fmtPrice(range.dayLo)}</span><div class="bar"><i style:left="{pos(last, range.dayLo, range.dayHi)}%"></i></div><span>{fmtPrice(range.dayHi)}</span></div>
      <h4>52 week range</h4>
      <div class="rng"><span>{fmtPrice(range.lo52)}</span><div class="bar"><i style:left="{pos(last, range.lo52, range.hi52)}%"></i></div><span>{fmtPrice(range.hi52)}</span></div>
    {/if}

    <h4>Performance</h4>
    <div class="tiles">
      {#each perf as [k, v]}
        <div class="tile" class:g={v >= 0} class:r={v < 0}><span>{k}</span><b>{Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '—'}</b></div>
      {/each}
    </div>

    {#if tech}
      <h4>Technicals</h4>
      <div class="gauge">
        <div class="gbar"><i style:left="{(tech.score + 1) * 50}%"></i></div>
        <div class="gl"><span>Sell</span><b class:up={tech.score > 0.15} class:dn={tech.score < -0.15}>{tech.label}</b><span>Buy</span></div>
        <div class="gc"><span class="dn">{tech.sell} sell</span><span>{tech.neutral} neutral</span><span class="up">{tech.buy} buy</span></div>
      </div>
    {/if}

    {#if seasonal && seasonal.series.length > 1}
      <h4>Seasonals · same period</h4>
      <svg viewBox="0 0 300 100" class="sea">
        <line x1="6" x2="294" y1={sy(0, seasonal.lo, seasonal.hi)} y2={sy(0, seasonal.lo, seasonal.hi)} class="zero" />
        <line x1={sx(seasonal.today)} x2={sx(seasonal.today)} y1="4" y2="96" class="today" />
        {#each seasonal.series as s, i (s.year)}
          <path d={path(s.pts, seasonal.lo, seasonal.hi)} fill="none" stroke={s.year === seasonal.cur ? 'var(--accent)' : yearColors[i % yearColors.length]} stroke-width={s.year === seasonal.cur ? 2.2 : 1.2} opacity={s.year === seasonal.cur ? 1 : 0.8} />
        {/each}
      </svg>
      <div class="years">
        {#each [...seasonal.series].reverse() as s}
          <div><span>{s.year}</span><b class:up={s.same >= 0} class:dn={s.same < 0}>{Number.isFinite(s.same) ? (s.same >= 0 ? '+' : '') + s.same.toFixed(1) + '%' : '—'}</b></div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  section { min-height: 0; min-width: 0; overflow-y: auto; border: 1px solid var(--line); background: var(--bar); padding: 12px 14px 16px; }
  .hd { display: flex; justify-content: space-between; align-items: center; font: 700 12px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
  .st { padding: 2px 8px; border: 1px solid var(--line); font-size: 10.5px; letter-spacing: 0.04em; }
  .st.open { color: var(--up); border-color: var(--up); } .st.pre { color: var(--accent); border-color: var(--accent); } .st.closed { color: var(--dim); }
  .price { display: flex; align-items: baseline; gap: 10px; margin: 10px 0 4px; font-family: ui-monospace, monospace; }
  .price b { font: 700 24px ui-monospace, monospace; color: var(--fg); }
  .up { color: var(--up); } .dn { color: var(--down); } .dim { color: var(--dim); font-size: 13px; }
  h4 { margin: 14px 0 6px; font: 700 10.5px system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
  .rng { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; font: 11px ui-monospace, monospace; color: var(--dim); }
  .bar { position: relative; height: 2px; background: var(--line); }
  .bar i { position: absolute; top: -4px; width: 2px; height: 10px; background: var(--accent); transform: translateX(-1px); box-shadow: 0 0 8px var(--accent); }
  .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .tile { display: flex; flex-direction: column; gap: 2px; padding: 7px 8px; border: 1px solid var(--line); font: 11px ui-monospace, monospace; color: var(--dim); }
  .tile b { font-size: 12.5px; }
  .tile.g b { color: var(--up); } .tile.r b { color: var(--down); }
  .gbar { position: relative; height: 4px; background: linear-gradient(90deg, var(--down) 0 33%, var(--line) 33% 67%, var(--up) 67%); margin: 8px 0 6px; }
  .gbar i { position: absolute; top: -5px; width: 3px; height: 14px; background: #fff; transform: translateX(-1.5px); box-shadow: 0 0 8px var(--accent); }
  .gl, .gc { display: flex; justify-content: space-between; font: 11px system-ui, sans-serif; color: var(--dim); }
  .gl b { font-size: 13px; color: var(--fg); } .gc { margin-top: 4px; font-family: ui-monospace, monospace; }
  .sea { width: 100%; height: auto; background: #000; border: 1px solid var(--line); }
  .zero { stroke: var(--line); stroke-dasharray: 3 3; } .today { stroke: var(--accent); stroke-width: 1; opacity: 0.6; }
  .years { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 8px; margin-top: 8px; font: 11px ui-monospace, monospace; color: var(--dim); }
  .years div { display: flex; justify-content: space-between; border-bottom: 1px solid var(--line); padding: 2px 0; }
</style>
