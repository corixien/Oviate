<script lang="ts">
  import { paper } from '$lib/paper/paper.svelte';
  import { fmtPrice } from '$lib/chart/renderer';
  import * as J from '$lib/paper/journal.ts';
  import Select from './Select.svelte';

  let accountId = $state('');
  const acc = $derived(paper.accounts.find((a) => a.id === accountId) ?? paper.active);
  let filter = $state<J.JournalFilter>(J.defaultFilter());
  let sub = $state<'trades' | 'calendar'>('trades');
  let month = $state(J.monthKey(Math.floor(Date.now() / 1000)));
  let editing = $state('');

  const now = () => Math.floor(Date.now() / 1000);
  const money = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
  const signed = (v: number, d = 2) => (v >= 0 ? '+' : '') + money(v, d);
  const cls = (v: number) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');
  const when = (t: number) => new Date(t * 1000).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  const pf = (v: number) => (v === Infinity ? '∞' : v.toFixed(2));
  const monthName = (m: string) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  const all = $derived(acc?.trades ?? []);
  const rows = $derived(J.filterTrades(all, filter, now()));
  const sum = $derived(J.summarize(rows));
  // calendar and month list ignore the single-day filter, all other filters apply
  const dayMap = $derived(J.dayStats(J.filterTrades(all, { ...filter, day: '' }, now())));
  const months = $derived(J.monthStats(dayMap));
  const weeks = $derived(J.calendarGrid(month, dayMap));
  const mstat = $derived(months.find((m) => m.month === month));
  const maxAbs = $derived(Math.max(1e-9, ...weeks.flatMap((w) => w.cells).map((c) => Math.abs(c?.stat?.pnl ?? 0))));
  const maxMonth = $derived(Math.max(1e-9, ...months.map((m) => Math.abs(m.pnl))));

  const symbols = $derived([...new Set(all.map((t) => t.symbol))].sort());
  const sources = $derived([...new Set(all.map((t) => t.source))].sort());
  const opt = (all: string, xs: string[]) => [{ value: '', label: all }, ...xs.map((x) => ({ value: x, label: x }))];
  const RANGES: [J.JournalRange, string][] = [['all', 'All time'], ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['year', 'This year']];
  const filtered = $derived(filter.range !== 'all' || filter.symbol || filter.side !== 'all' || filter.result !== 'all' || filter.source || filter.day);

  const tint = (pnl: number, max: number) => (pnl === 0 ? '' : `background: rgba(${pnl > 0 ? '34,197,94' : '239,68,68'}, ${(0.1 + 0.4 * Math.min(1, Math.abs(pnl) / max)).toFixed(2)})`);
  const openDay = (date: string) => { filter.day = date; sub = 'trades'; };
  const saveNote = (id: string, v: string) => { if (acc) paper.setTradeNote(acc.id, id, v); editing = ''; };
  function focusIt(el: HTMLInputElement) { el.focus(); }
</script>

{#if !acc}
  <div class="empty"><p>No paper account yet.</p><button class="primary" onclick={() => (paper.accountDialog = true)}>Create paper account</button></div>
{:else}
  <div class="top">
    <Select value={acc.id} options={paper.accounts.map((a) => ({ value: a.id, label: a.name }))} onchange={(v) => (accountId = v)} width="170px" />
    <Select value={filter.range} options={RANGES.map(([value, label]) => ({ value, label }))} onchange={(v) => (filter.range = v as J.JournalRange)} width="130px" />
    <Select value={filter.symbol} options={opt('All symbols', symbols)} onchange={(v) => (filter.symbol = v)} width="130px" />
    <Select value={filter.side} options={[{ value: 'all', label: 'Long & short' }, { value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} onchange={(v) => (filter.side = v as typeof filter.side)} width="130px" />
    <Select value={filter.result} options={[{ value: 'all', label: 'Wins & losses' }, { value: 'win', label: 'Wins' }, { value: 'loss', label: 'Losses' }]} onchange={(v) => (filter.result = v as typeof filter.result)} width="130px" />
    <Select value={filter.source} options={opt('All sources', sources)} onchange={(v) => (filter.source = v)} width="140px" />
    {#if filter.day}<button class="chip" onclick={() => (filter.day = '')} title="Clear the day filter">{filter.day} ×</button>{/if}
    {#if filtered}<button class="mini" onclick={() => (filter = J.defaultFilter())}>Clear filters</button>{/if}
    <div class="sp"></div>
    <span class="m">{rows.length} of {all.length} trades</span>
  </div>
  <div class="sumrow">
    <span class="m">Net <b class={cls(sum.net)}>{signed(sum.net)}</b></span>
    <span class="m">Win rate <b>{sum.winRate.toFixed(1)}%</b></span>
    <span class="m">Profit factor <b>{pf(sum.profitFactor)}</b></span>
    <span class="m">Avg win <b class="up">{signed(sum.avgWin)}</b></span>
    <span class="m">Avg loss <b class="dn">{signed(sum.avgLoss)}</b></span>
    <span class="m">Expectancy <b class={cls(sum.expectancy)}>{signed(sum.expectancy)}</b></span>
    <span class="m">Best <b class="up">{signed(sum.best)}</b></span>
    <span class="m">Worst <b class="dn">{signed(sum.worst)}</b></span>
    <span class="m">Streak W/L <b>{sum.winStreak}/{sum.lossStreak}</b></span>
    <span class="m">Avg hold <b>{J.holdText(sum.avgHoldSec)}</b></span>
    <span class="m">Fees <b>{money(sum.fees)}</b></span>
  </div>
  <div class="subs">
    <button class:on={sub === 'trades'} onclick={() => (sub = 'trades')}>Trades<i>{rows.length}</i></button>
    <button class:on={sub === 'calendar'} onclick={() => (sub = 'calendar')}>Calendar</button>
  </div>
  <div class="body">
    {#if sub === 'trades'}
      <table>
        <thead><tr><th>Closed</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&L</th><th>P&L %</th><th>Held</th><th>Fees</th><th>Exit reason</th><th>Source</th><th>Note</th></tr></thead>
        <tbody>
          {#each rows as t (t.id)}
            <tr class={t.pnl > 0 ? 'win' : t.pnl < 0 ? 'loss' : ''}>
              <td>{when(t.exitTime)}</td><td><b>{t.symbol}</b></td><td>{t.side}</td><td>{t.qty}</td><td>{fmtPrice(t.entryPrice)}</td><td>{fmtPrice(t.exitPrice)}</td>
              <td class="pnl">{signed(t.pnl)}</td><td class="pnl">{signed((t.pnl / (t.qty * t.entryPrice || 1)) * 100)}%</td>
              <td>{J.holdText(t.exitTime - t.entryTime)}</td><td>{money(t.commission)}</td><td>{t.reason}</td><td class="dim">{t.source}</td>
              <td class="note">
                {#if editing === t.id}
                  <input class="ni" value={t.note ?? ''} use:focusIt onblur={(e) => saveNote(t.id, e.currentTarget.value)} onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') editing = ''; }} placeholder="Why did you take this trade?" />
                {:else}
                  <button class="nb" onclick={() => (editing = t.id)} title="Edit note">{t.note ?? '+ note'}</button>
                {/if}
              </td>
            </tr>
          {:else}<tr><td colspan="13" class="none">{all.length ? 'No trades match the filters.' : 'No closed trades yet.'}</td></tr>{/each}
        </tbody>
      </table>
    {:else}
      <div class="cal">
        <div class="month">
          <div class="mh">
            <button class="mini" onclick={() => (month = J.shiftMonth(month, -1))}>‹</button>
            <b>{monthName(month)}</b>
            <button class="mini" onclick={() => (month = J.shiftMonth(month, 1))}>›</button>
            <button class="mini" onclick={() => (month = J.monthKey(now()))}>Today</button>
            <div class="sp"></div>
            {#if mstat}
              <span class="m">P&L <b class={cls(mstat.pnl)}>{signed(mstat.pnl)}</b></span>
              <span class="m">Trades <b>{mstat.trades}</b></span>
              <span class="m">Days <b><span class="up">{mstat.greenDays}</span> / <span class="dn">{mstat.redDays}</span></b></span>
            {:else}<span class="m">No trades this month</span>{/if}
          </div>
          <div class="grid7">
            {#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'] as d}<div class="dh">{d}</div>{/each}
            {#each weeks as w}
              {#each w.cells as c}
                {#if !c}<div class="day empty"></div>
                {:else if c.stat}
                  <button class="day has" style={tint(c.stat.pnl, maxAbs)} onclick={() => openDay(c.date)} title="Show the trades of {c.date}">
                    <span class="dn1">{c.day}</span><b class={cls(c.stat.pnl)}>{signed(c.stat.pnl)}</b><span class="tc">{c.stat.trades} trade{c.stat.trades === 1 ? '' : 's'}</span>
                  </button>
                {:else}<div class="day"><span class="dn1">{c.day}</span></div>{/if}
              {/each}
              <div class="day wk" style={w.trades ? tint(w.pnl, maxAbs * 3) : ''}>{#if w.trades}<b class={cls(w.pnl)}>{signed(w.pnl)}</b><span class="tc">{w.trades} trades</span>{/if}</div>
            {/each}
          </div>
        </div>
        <div class="mlist">
          <h5>Months</h5>
          {#each months as m (m.month)}
            <button class="mrow" class:on={m.month === month} onclick={() => (month = m.month)}>
              <span class="mn">{monthName(m.month)}</span>
              <span class="bar"><i class={m.pnl >= 0 ? 'g' : 'r'} style:width="{(Math.abs(m.pnl) / maxMonth) * 100}%"></i></span>
              <b class={cls(m.pnl)}>{signed(m.pnl)}</b><span class="tc">{m.trades} trades · {m.greenDays}/{m.redDays} days</span>
            </button>
          {:else}<p class="none">No trades yet.</p>{/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .top { display: flex; align-items: center; gap: 8px; padding: 8px 14px; flex-wrap: wrap; border-bottom: 1px solid var(--line); flex: none; font-size: 12px; }
  .sumrow { display: flex; align-items: center; gap: 16px; padding: 7px 14px; flex-wrap: wrap; border-bottom: 1px solid var(--line); flex: none; font-size: 12px; }
  .sp { flex: 1; }
  .m { color: var(--dim); } .m b { color: var(--fg); font-family: ui-monospace, monospace; }
  .up { color: #22c55e !important; } .dn { color: #ef4444 !important; } .dim { color: var(--dim); }
  .mini { box-sizing: border-box; height: 30px; background: none; border: 1px solid var(--line); color: var(--fg); padding: 0 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .mini:hover { border-color: var(--accent); color: var(--accent); }
  .chip { box-sizing: border-box; height: 30px; background: var(--accent-soft); border: 1px solid var(--accent); color: var(--fg); padding: 0 10px; font: 600 12px ui-monospace, monospace; cursor: pointer; }
  .subs { display: flex; align-items: center; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--line); flex: none; }
  .subs button { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--dim); padding: 7px 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .subs button.on { color: var(--fg); border-bottom-color: var(--accent); } .subs button:hover { color: var(--fg); }
  .subs i { font-style: normal; background: var(--accent-soft); color: var(--accent); padding: 0 6px; margin-left: 6px; font-size: 10.5px; }
  .body { flex: 1; min-height: 0; overflow: auto; }
  table { width: 100%; border-collapse: collapse; font: 12px ui-monospace, monospace; }
  th { position: sticky; top: 0; background: var(--bar); text-align: left; color: var(--dim); font: 600 10.5px system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; padding: 7px 12px; border-bottom: 1px solid var(--line); }
  td { padding: 6px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  tr.win td { background: rgba(34, 197, 94, 0.13); } tr.loss td { background: rgba(239, 68, 68, 0.13); }
  tr.win:hover td { background: rgba(34, 197, 94, 0.22); } tr.loss:hover td { background: rgba(239, 68, 68, 0.22); }
  tr.win .pnl { color: #22c55e; font-weight: 700; } tr.loss .pnl { color: #ef4444; font-weight: 700; }
  .none { text-align: center; color: var(--dim); padding: 22px; font-family: system-ui, sans-serif; }
  .note { max-width: 280px; } .nb { background: none; border: 0; color: var(--dim); font: 12px system-ui, sans-serif; cursor: pointer; padding: 0; max-width: 260px; overflow: hidden; text-overflow: ellipsis; } .nb:hover { color: var(--accent); }
  .ni { width: 240px; height: 24px; box-sizing: border-box; background: #000; border: 1px solid var(--accent); color: var(--fg); font: 12px system-ui, sans-serif; padding: 0 6px; outline: none; }
  .cal { display: flex; gap: 18px; padding: 12px 14px; align-items: flex-start; flex-wrap: wrap; }
  .month { flex: 1 1 560px; min-width: 0; }
  .mh { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; flex-wrap: wrap; } .mh b { min-width: 130px; text-align: center; }
  .grid7 { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)) 1.1fr; gap: 3px; }
  .dh { color: var(--dim); font: 600 10.5px system-ui, sans-serif; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 4px; }
  .day { box-sizing: border-box; min-height: 58px; border: 1px solid var(--line); padding: 4px 6px; display: flex; flex-direction: column; gap: 2px; text-align: left; background: none; color: var(--fg); font: 12px ui-monospace, monospace; }
  .day.empty { border-color: transparent; } .day.has { cursor: pointer; } .day.has:hover { border-color: var(--accent); } .day.wk { background: rgba(255, 255, 255, 0.03); justify-content: center; }
  .dn1 { color: var(--dim); font-size: 10.5px; } .tc { color: var(--dim); font: 10.5px system-ui, sans-serif; }
  .mlist { flex: 0 1 380px; min-width: 260px; } h5 { margin: 0 0 6px; font: 700 10.5px system-ui, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
  .mrow { display: grid; grid-template-columns: 120px 1fr auto; gap: 2px 10px; align-items: center; width: 100%; background: none; border: 1px solid transparent; border-bottom-color: var(--line); color: var(--fg); padding: 6px 8px; cursor: pointer; text-align: left; font: 12px ui-monospace, monospace; }
  .mrow:hover, .mrow.on { border-color: var(--accent); } .mrow .tc { grid-column: 2 / 4; }
  .mn { font-family: system-ui, sans-serif; }
  .bar { height: 6px; background: var(--line); } .bar i { display: block; height: 100%; } .bar i.g { background: #22c55e; } .bar i.r { background: #ef4444; }
  .empty { padding: 26px; text-align: center; color: var(--fg); } .empty p { margin: 6px 0; }
  .primary { background: var(--accent); border: 1px solid var(--accent); color: #fff; padding: 9px 18px; font: 700 13px system-ui, sans-serif; cursor: pointer; margin-top: 8px; }
</style>
