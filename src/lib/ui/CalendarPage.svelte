<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import { calendarWindow, type CalEvent } from '$lib/api';
  import Select from './Select.svelte';

  const DAY = 86400;
  const RANGES: { id: string; label: string; from: (d: Date) => number; to: (d: Date) => number }[] = [
    { id: 'today', label: 'Today', from: (d) => day0(d), to: (d) => day0(d) + DAY },
    { id: 'week', label: 'This week', from: (d) => day0(d) - ((d.getDay() + 6) % 7) * DAY, to: (d) => day0(d) - ((d.getDay() + 6) % 7) * DAY + 7 * DAY },
    { id: 'next', label: 'Next week', from: (d) => day0(d) - ((d.getDay() + 6) % 7) * DAY + 7 * DAY, to: (d) => day0(d) - ((d.getDay() + 6) % 7) * DAY + 14 * DAY },
    { id: 'past', label: 'Past 7 days', from: (d) => day0(d) - 7 * DAY, to: (d) => day0(d) },
    { id: 'month', label: 'Past 30 days', from: (d) => day0(d) - 30 * DAY, to: (d) => day0(d) + DAY },
  ];
  const day0 = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);

  let range = $state('week');
  let impact = $state<'all' | 'medium' | 'high'>('medium');
  let country = $state('all');
  let kind = $state<'all' | CalEvent['kind']>('all');
  let query = $state('');
  let items = $state<CalEvent[]>([]);
  let errors = $state<{ provider: string; error: string }[]>([]);
  let loading = $state(false);

  const IMP = { high: 3, medium: 2, low: 1, holiday: 0 } as const;
  const minImp = $derived(impact === 'high' ? 3 : impact === 'medium' ? 2 : 0);
  const countries = $derived([...new Set(items.map((e) => e.country))].filter(Boolean).sort());
  const q = $derived(query.trim().toLowerCase());
  // searching a company ignores the impact filter (small caps are "low")
  const shown = $derived(items.filter((e) => (kind === 'all' || e.kind === kind)
    && (q ? (e.symbol ?? '').toLowerCase().includes(q) || e.title.toLowerCase().includes(q) : e.kind === 'macro' || e.kind === 'earnings' ? IMP[e.impact] >= minImp : true)
    && (country === 'all' || e.country === country)));
  const KINDS: [typeof kind, string][] = [['all', 'All'], ['macro', 'Macro'], ['earnings', 'Earnings'], ['dividend', 'Dividends'], ['split', 'Splits'], ['ipo', 'IPOs']];
  const LABELS: Record<string, [string, string, string]> = { macro: ['Actual', 'Forecast', 'Previous'], earnings: ['', 'EPS estimate', 'Last year'], dividend: ['Dividend', '', ''], split: ['', '', ''], ipo: ['', '', ''] };
  const now = $derived(Math.floor(Date.now() / 1000));
  const groups = $derived.by(() => {
    const out: { day: string; rows: CalEvent[] }[] = [];
    for (const e of shown) {
      const day = new Date(e.ts * 1000).toLocaleDateString(app.lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(e); else out.push({ day, rows: [e] });
    }
    return out;
  });
  const nextId = $derived(shown.find((e) => e.ts >= now)?.id);

  let pending = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Shows what is cached at once; while the backend still fetches company days in the background, ask again every 2 s. */
  async function load(force = false, tries = 0) {
    clearTimeout(timer);
    const r = RANGES.find((x) => x.id === range)!, d = new Date();
    const mine = range;
    loading = true;
    try {
      const res = await calendarWindow(r.from(d), r.to(d), force);
      if (mine !== range) return;
      items = res.items; errors = res.errors; pending = res.pending;
      if (res.pending && tries < 60) timer = setTimeout(() => load(false, tries + 1), 2000);
    } catch (e) { errors = [{ provider: 'calendar', error: String(e) }]; pending = false; }
    finally { loading = false; }
  }
  onMount(() => {
    load();
    // keep checking for the latest events: every 5 minutes and when the window gets focus (the backend decides what is stale)
    const iv = setInterval(() => load(), 5 * 60 * 1000), onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearTimeout(timer); clearInterval(iv); window.removeEventListener('focus', onFocus); };
  });
  $effect(() => { void range; load(); });

  const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const back = () => (app.page = 'chart');
</script>

<svelte:window onkeydown={(e) => { if (app.page === 'calendar' && e.key === 'Escape' && !app.spotlight.open) back(); }} />

<div class="page">
  <header>
    <button class="back" onclick={back}>← Charts</button>
    <h1>Economic calendar</h1>
    <div class="seg">
      {#each RANGES as r (r.id)}<button class:on={range === r.id} onclick={() => (range = r.id)}>{r.label}</button>{/each}
    </div>
    <div class="spacer"></div>
    {#if pending}<span class="dim">Loading company data in the background…</span>{/if}
    <button class="ghost" onclick={() => load(true)} disabled={loading}>Refresh</button>
  </header>

  <div class="filters">
    <span class="dim">Impact</span>
    <div class="seg">
      {#each [['all', 'All'], ['medium', 'Medium +'], ['high', 'High']] as [id, label] (id)}<button class:on={impact === id} onclick={() => (impact = id as typeof impact)}>{label}</button>{/each}
    </div>
    <span class="dim">Type</span>
    <div class="seg">
      {#each KINDS as [id, label] (id)}<button class:on={kind === id} onclick={() => (kind = id)}>{label}</button>{/each}
    </div>
    <input class="q" bind:value={query} placeholder="Symbol or company…" spellcheck="false" autocomplete="off" aria-label="Search symbol or company" />
    <span class="dim">Currency</span>
    <Select value={country} options={[{ value: 'all', label: 'All' }, ...countries.map((c) => ({ value: c, label: c }))]} onchange={(v) => (country = v)} width="110px" />
    <div class="spacer"></div>
    <label class="tg"><input type="checkbox" bind:checked={app.showCalendar} onchange={() => app.persist()} /><span>Show on charts</span></label>
    <Select value={app.calImpact} options={[{ value: 'high', label: 'High impact only' }, { value: 'medium', label: 'Medium + High' }, { value: 'low', label: 'All events' }]} onchange={(v) => { app.calImpact = v as typeof app.calImpact; app.persist(); }} width="160px" />
  </div>

  <div class="list">
    {#each groups as g (g.day)}
      <h3>{g.day}</h3>
      {#each g.rows as e (e.id)}
        {@const lab = LABELS[e.kind] ?? LABELS.macro}
        <div class="row" class:past={e.ts < now} class:next={e.id === nextId}>
          <span class="t">{time(e.ts)}</span>
          <span class="c" class:co={e.kind !== 'macro'}>{e.symbol ?? e.country}</span>
          <span class="i {e.impact}" title={e.impact}><i></i><i></i><i></i></span>
          <span class="n">{e.title}{#if e.detail}<small class="det">{e.detail}</small>{/if}</span>
          <span class="v"><small>{lab[0]}</small><b class:has={e.actual}>{lab[0] ? (e.actual ?? '—') : ''}</b></span>
          <span class="v"><small>{lab[1]}</small><b>{lab[1] ? (e.forecast ?? '—') : ''}</b></span>
          <span class="v"><small>{lab[2]}</small><b>{lab[2] ? (e.previous ?? '—') : ''}</b></span>
        </div>
      {/each}
    {:else}
      <p class="empty">{items.length === 0 && (loading || pending) ? 'Loading…' : 'No events for this filter. Widen the impact filter, the type or the range.'}</p>
    {/each}
    {#each errors as er}<p class="err">{er.provider}: {er.error}</p>{/each}
    <p class="note">Macro: Forex Factory weekly calendar (USD, EUR, GBP, JPY, CAD, AUD, NZD, CHF, CNY; no key){items.some((e) => e.provider === 'fmp') ? ' and Financial Modeling Prep' : '. A free Financial Modeling Prep key in Settings adds more countries, a wider range and actual values'}. Companies (earnings, ex-dividends, splits, IPOs): Nasdaq, no key, 30 days back to 21 days ahead; earnings of the symbol on a chart appear on that chart. Times are shown in your local time zone.</p>
  </div>
</div>

<style>
  .page { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
  header { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  h1 { margin: 0; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; }
  .back, .ghost { height: 30px; box-sizing: border-box; background: none; border: 1px solid var(--line); color: var(--fg); padding: 0 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .back:hover, .ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); } .ghost:disabled { opacity: 0.5; cursor: default; }
  .seg { display: flex; border: 1px solid var(--line); }
  .seg button { height: 28px; background: none; border: 0; color: var(--dim); padding: 0 12px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
  .seg button.on { background: var(--accent); color: #fff; }
  .spacer { flex: 1; }
  .filters { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .dim { color: var(--dim); font-size: 12px; }
  .tg { display: flex; align-items: center; gap: 8px; font-size: 12.5px; cursor: pointer; } .tg input { accent-color: var(--accent); }
  .list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px 20px; }
  h3 { margin: 18px 0 6px; font: 700 12px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  .row { display: grid; grid-template-columns: 56px 64px 40px 1fr 100px 110px 100px; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
  .row:hover { background: var(--hover); }
  .row.past { opacity: 0.62; }
  .row.next { border-left: 2px solid var(--accent); background: var(--accent-soft); opacity: 1; }
  .t { font-family: ui-monospace, monospace; color: var(--dim); }
  .c { font: 700 11px ui-monospace, monospace; padding: 2px 6px; border: 1px solid var(--line); text-align: center; }
  .i { display: inline-flex; gap: 2px; } .i i { width: 5px; height: 12px; background: var(--line); }
  .i.high i { background: var(--down); }
  .i.medium i:nth-child(-n + 2) { background: #ff9800; }
  .i.low i:first-child { background: var(--dim); }
  .i.holiday i { background: var(--line); opacity: 0.5; }
  .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; flex-direction: column; }
  .det { color: var(--dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
  .c.co { color: var(--accent); border-color: var(--accent); }
  .q { box-sizing: border-box; height: 30px; width: 200px; background: #000; border: 1px solid var(--line); color: var(--fg); padding: 0 10px; font: 12.5px system-ui, sans-serif; outline: none; } .q:focus { border-color: var(--accent); }
  .v { display: flex; flex-direction: column; font-family: ui-monospace, monospace; font-size: 12.5px; } .v small { font: 10px system-ui, sans-serif; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; }
  .v b { font-weight: 500; } .v b.has { color: var(--up); font-weight: 700; }
  .empty, .note { color: var(--dim); font-size: 12.5px; } .note { margin-top: 20px; max-width: 800px; }
  .err { color: var(--down); font-size: 12.5px; }
</style>
